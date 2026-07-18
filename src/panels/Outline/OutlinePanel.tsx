"use client";

import { useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect, useSyncExternalStore, memo } from "react";
import type { JSONContent } from "@tiptap/react";
import { useWordCountConfig } from "@/hooks/useWordCountConfig";
import { buildPerBlockCounts, sumIncludedWords } from "@/lib/word-count-core";
import type { FocusState } from "@/hooks/useFocusMode";
import { sectionRange } from "@/hooks/useFocusMode";
import { Panel } from "@/panels/_shared/Panel";
import { ItemMenu } from "@/components/panel-primitives";
import { MenuToggleRow } from "@/components/menu/MenuToggleRow";
import { flattenInlineText } from "@/lib/inline-content";
import {
  subscribeOutlinePrefs,
  getOutlinePrefsSnapshot,
  getOutlinePrefsServerSnapshot,
  setOutlinePrefs,
  setOutlineCollapsedForDoc,
  getOutlineCollapsedForDoc,
} from "./outline-prefs-store";
import { resolveDragCommit } from "./focus-band-drag";
import { landingBlockIndex, isRejectedDrop, resolveDropIndicator } from "./outline-drop";

/* ── Indentation model (single source of truth) ─────────────────────────
 * One place defines the outline's left-edge geometry, used by both the view
 * tree and the edit-mode pods (and the focus-band / position measurement that
 * key off the same rows). Goals: minimize the fixed left inset (#4), deepen
 * the per-level step so nesting reads clearly (#5), and give a fixed number
 * column so wrapped heading text hangs like a numbered list (#2). */
const OUTLINE_BASE_INSET = 2;    // px — fixed left gutter (was 8)
const OUTLINE_INDENT_STEP = 20;  // px per heading level (was 16)
const OUTLINE_TWIST_COL = 15;    // px — chevron / spacer column width
const OUTLINE_ROW_GAP = 4;       // px — gap between twist column and text

/** Left pad (px) for a heading row at the given tree depth. */
function headingIndent(depth: number): number {
  return OUTLINE_BASE_INSET + depth * OUTLINE_INDENT_STEP;
}
/** Left pad (px) for a parTitle row under a heading at `depth` — one step
 *  deeper than the heading text so it reads as belonging to the section. */
function parTitleIndent(depth: number): number {
  return headingIndent(depth) + OUTLINE_TWIST_COL + OUTLINE_ROW_GAP + OUTLINE_INDENT_STEP;
}

interface HeadingItem {
  id: string;
  /** Durable block uuid — the address the structural-edit mutators key on
   *  (T3 / W3a). Null until the block is hydrated (lazy uuid backfill); a
   *  rename then no-ops gracefully rather than mis-addressing by index. */
  uuid: string | null;
  level: number;
  text: string;
  label: string | null;
  sectionNumber: string | null;
  index: number; // top-level block index in doc.content
  // paragraph titles under this heading — each carries its own durable uuid.
  parTitles: { title: string; index: number; uuid: string | null }[];
}

/* ── Position indicator helpers ─────────────────────────────────────── */

/** An entry in the section path: heading text + its top-level block index. */
export type SectionPathEntry = { text: string; index: number; sectionNumber: string | null };

/** Where a pane's position chevron should appear in the outline. */
interface ResolvedPosition {
  headingText: string | null;
  /** Top-level block index of the resolved heading — unique, used for matching. */
  headingIndex: number | null;
  parTitleIndex: number | null;
  isDocStart: boolean;
}

/**
 * Walk the active section path and determine where the position chevron
 * should land, bubbling up to a collapsed ancestor when the innermost
 * heading (or its parTitle children) aren't visible.
 */
function resolvePosition(
  sectionPath: SectionPathEntry[] | undefined,
  parTitleIndex: number | null | undefined,
  headings: HeadingItem[],
  collapsed: Set<string>,
  showTitles: boolean,
  preambleTitles: { title: string; index: number }[],
): ResolvedPosition | null {
  if (!sectionPath) return null;

  // Document-start region (before any heading)
  if (sectionPath.length === 0) {
    if (showTitles && parTitleIndex != null && preambleTitles.some((pt) => pt.index === parTitleIndex)) {
      return { headingText: null, headingIndex: null, parTitleIndex, isDocStart: false };
    }
    return { headingText: null, headingIndex: null, parTitleIndex: null, isDocStart: true };
  }

  // Walk from outermost to innermost — first collapsed heading wins.
  // Match by block index (unique) rather than text to handle duplicate
  // heading names and inline non-text content (math, etc.).
  for (const entry of sectionPath) {
    const heading = headings.find((h) => h.index === entry.index);
    if (heading && collapsed.has(heading.id)) {
      return { headingText: heading.text, headingIndex: heading.index, parTitleIndex: null, isDocStart: false };
    }
  }

  // Nothing collapsed — check if a parTitle should take the chevron
  if (showTitles && parTitleIndex != null) {
    const exists =
      preambleTitles.some((pt) => pt.index === parTitleIndex) ||
      headings.some((h) => h.parTitles.some((pt) => pt.index === parTitleIndex));
    if (exists) {
      return { headingText: null, headingIndex: null, parTitleIndex, isDocStart: false };
    }
  }

  // Default: innermost heading
  const innermost = sectionPath[sectionPath.length - 1];
  const innermostHeading = headings.find((h) => h.index === innermost.index);
  return {
    headingText: innermostHeading?.text ?? innermost.text,
    headingIndex: innermostHeading?.index ?? innermost.index,
    parTitleIndex: null,
    isDocStart: false,
  };
}

/** Convert a resolved position into the data-outline-pos attribute value. */
function posToAttr(pos: ResolvedPosition | null): string | null {
  if (!pos) return null;
  if (pos.isDocStart) return "docstart";
  if (pos.parTitleIndex != null) return `pt-${pos.parTitleIndex}`;
  return `h-${pos.headingIndex}`;
}

/**
 * Light selector that highlights the whole row of the current section,
 * instead of a thin bar sliding up and down the gutter (#3). It reuses the
 * by-`data-outline-pos` measurement and paints a soft full-width tint BEHIND
 * the row (rows sit at zIndex 5 with transparent backgrounds, so the tint
 * shows through). `variant` distinguishes the canonical pane ("fill", a soft
 * red wash — the primary current-section selector) from the mirror pane
 * ("edge", a slim accent bar) so a split view shows both without two clashing
 * washes.
 */
function PositionHighlight({ scrollRef, attr, color, variant }: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  attr: string | null;
  color: string;
  variant: "fill" | "edge";
}) {
  const [pos, setPos] = useState<{ y: number; h: number } | null>(null);

  const measure = useCallback(() => {
    if (!attr || !scrollRef.current) { setPos(null); return; }
    const el = scrollRef.current.querySelector(`[data-outline-pos="${attr}"]`) as HTMLElement | null;
    if (!el) { setPos(null); return; }
    setPos({ y: el.offsetTop, h: el.offsetHeight });
  }, [attr, scrollRef]);

  // Run before paint so the selector lands on the right pixel without a
  // visible "old position then new" flash.
  useLayoutEffect(() => { measure(); }, [measure]);

  // Remeasure on container resize and on row tree changes (collapse/expand,
  // headings added/removed). We deliberately do NOT observe attribute
  // mutations: every focus-state-driven opacity tween used to fire this
  // observer dozens of times per render and was a major thrash source.
  useEffect(() => {
    if (!scrollRef.current) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(scrollRef.current);
    const mo = new MutationObserver(() => measure());
    mo.observe(scrollRef.current, { childList: true, subtree: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, [scrollRef, measure]);

  if (!pos) return null;

  // zIndex 6 puts the selector ABOVE the rows (zIndex 5) and therefore above
  // their hover background (`hover-on-light` paints --surface-muted-strong on
  // the row). Behind the rows it was covered — so hovering the current row made
  // the selector vanish. It's a translucent, pointer-events-none wash, so it
  // reads over the hover without eating clicks or hiding the text.
  if (variant === "edge") {
    return (
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 3,
          borderRadius: 1.5,
          background: color,
          opacity: 0.75,
          transform: `translateY(${pos.y}px)`,
          height: pos.h,
          transition: "transform 200ms ease-out, height 200ms ease-out, opacity 200ms ease",
          pointerEvents: "none",
          zIndex: 6,
        }}
      />
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        background: color,
        transform: `translateY(${pos.y}px)`,
        height: pos.h,
        borderRadius: "var(--radius-md)",
        transition: "transform 200ms ease-out, height 200ms ease-out",
        pointerEvents: "none",
        zIndex: 6,
      }}
    />
  );
}

/** Inline label: shows existing label (click to edit) or a "+" on hover to create one. */
function InlineLabel({
  label,
  onCommit,
  isTaken,
}: {
  label: string | null;
  onCommit: (value: string | null) => void;
  /** Consults the central label registry via EditorLayout's
   *  `checkLabelTaken`. Called on each keystroke so the warning stays
   *  live as the user types. */
  isTaken?: (candidate: string, excludeLabel: string | null) => boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(label ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setText(label ?? "");
      // Focus after React renders the input
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [editing, label]);

  const commit = () => {
    const trimmed = text.trim();
    onCommit(trimmed || null);
    setEditing(false);
  };

  const conflict =
    editing && isTaken ? isTaken(text.trim(), label ?? null) : false;

  if (editing) {
    return (
      <>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          onBlur={commit}
          onClick={(e) => e.stopPropagation()}
          className={`text-[11px] leading-tight mt-0.5 bg-transparent outline-none border-b w-full ${
            conflict
              ? "text-[#b45757] border-[#b45757]"
              : "text-blue-500 border-blue-400"
          }`}
          placeholder="label key"
        />
        {conflict && (
          <div className="text-[10px] text-[#b45757] leading-tight mt-0.5">
            ⚠ label already in use
          </div>
        )}
      </>
    );
  }

  if (label) {
    return (
      <div
        className="text-[11px] text-blue-500 leading-tight mt-0.5 truncate cursor-text hover:underline"
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        data-hint="Edit label"
        data-hint-pos="above"
      >
        {label}
      </div>
    );
  }

  // No label — show "+" on hover (parent row has `group` class)
  return (
    <span
      className="text-[11px] text-blue-400 leading-tight mt-0.5 pl-[1px] opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer select-none"
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      data-hint="Add label"
      data-hint-pos="above"
    >
      +
    </span>
  );
}

interface OutlinePanelProps {
  content: JSONContent | null;
  /** Document id scoping the persisted fold set (task 111 — folds are
      per-doc; 4-hex block uuids are only unique within one doc). Optional
      for type permissiveness; an omitted id shares the "" bucket. */
  docId?: string;
  onScrollTo: (headingIndex: number) => void;
  onReorderBlocks?: (fromIndex: number, count: number, toIndex: number) => void;
  // T3 (W3a): rename/label address by durable block uuid, not integer index.
  onRenameHeading?: (uuid: string, newText: string) => void;
  onRenameParTitle?: (uuid: string, newTitle: string) => void;
  onUpdateLabel?: (uuid: string, newLabel: string | null) => void;
  /** Central label-conflict predicate — thread down to every label
      input so they all agree on what counts as a collision. */
  isLabelTaken?: (candidate: string, excludeLabel: string | null) => boolean;
  /** Heading chain currently visible in the editor viewport. The last
      entry is the closest enclosing heading. Empty means the reader
      is in the Document start region. */
  activeSectionPath?: SectionPathEntry[];
  /** Top-level block index of the paragraph/list whose parTitle the
      reader is currently reading, or null if none. Used to move the
      position chevron onto a paragraph row when par titles are enabled. */
  activeParTitleIndex?: number | null;
  /** True when the editor is in split-pane mode. */
  editorSplit?: boolean;
  /** Heading chain for the mirror (second) pane. */
  mirrorSectionPath?: SectionPathEntry[];
  /** Active parTitle index for the mirror pane. */
  mirrorParTitleIndex?: number | null;
  /** Focus mode state — null when feature not wired. */
  focusState?: FocusState | null;
  /** Callbacks for focus mode. */
  onFocusActivate?: () => void;
  onFocusDeactivate?: () => void;
  onFocusToggleLock?: () => void;
  onFocusMoveTo?: (blockIndex: number) => void;
  onFocusExpandTo?: (blockIndex: number) => void;
  onFocusSnapBoundary?: (edge: "top" | "bottom", blockIndex: number) => void;
}

/* ── Doc text extraction ───────────────────────────────────────────── */

// `extractText` (a flat `type==="text"`-only walk that dropped every inline
// atom) was replaced by the atom-aware `flattenInlineText` from
// `@/lib/inline-content` — so an outline row / drag-ghost / doc-title keeps the
// text of nested math / \cite / \ref (OUT-F1-01 / OUT-F4-01).

function getDocTitle(doc: JSONContent | null): string {
  if (!doc?.content) return "";
  for (const node of doc.content) {
    if (node.type === "titleField" && node.attrs?.field === "title") {
      // Atom-aware (OUT-F4-01): a title containing math / \cite keeps its text.
      return flattenInlineText(node).trim();
    }
  }
  return "";
}

interface ParTitleItem {
  title: string;
  index: number;
  uuid: string | null;
}

interface ExtractResult {
  headings: HeadingItem[];
  /** Par titles that appear before the first heading (Document start region). */
  preambleTitles: ParTitleItem[];
}

export function extractHeadings(doc: JSONContent | null): ExtractResult {
  if (!doc || !doc.content) return { headings: [], preambleTitles: [] };
  const headings: HeadingItem[] = [];
  let pendingTitles: ParTitleItem[] = [];
  const preambleTitles: ParTitleItem[] = [];

  doc.content.forEach((node, idx) => {
    if (node.type === "heading" && typeof node.attrs?.level === "number") {
      // Attach any pending parTitles to the previous heading. Titles
      // before the first heading go to the preamble list so they can
      // appear under the "Document start" row.
      if (pendingTitles.length > 0) {
        if (headings.length > 0) {
          headings[headings.length - 1].parTitles.push(...pendingTitles);
        } else {
          preambleTitles.push(...pendingTitles);
        }
      }
      pendingTitles = [];
      // OUT-A2-01: key the heading's stable address on its durable block `uuid`,
      // NOT its positional `heading-${idx}`. The persisted fold/collapse Set
      // (and the pods parent-chain) keys on `id`; an index-based id DRIFTS the
      // moment a block is inserted above a collapsed section — the heading
      // formerly `heading-3` becomes `heading-4`, so the saved fold key no
      // longer matches and the section silently un-collapses (and an unrelated
      // section may collapse). The block uuid is insert-stable, so the fold
      // survives. Un-hydrated headings (uuid still null — lazy-backfilled on
      // first interaction) fall back to the positional id so they remain
      // foldable until they earn a uuid; once hydrated they key durably.
      const uuid = (node.attrs.uuid as string | null) || null;
      headings.push({
        id: uuid ?? `heading-${idx}`,
        uuid,
        level: node.attrs.level as number,
        text: flattenInlineText(node) || "Untitled",
        label: (node.attrs.label as string) || null,
        sectionNumber: (node.attrs.sectionNumber as string) || null,
        index: idx,
        parTitles: [],
      });
    } else if (
      (node.type === "paragraph" ||
        node.type === "bulletList" ||
        node.type === "orderedList") &&
      node.attrs?.parTitle
    ) {
      pendingTitles.push({
        title: node.attrs.parTitle as string,
        index: idx,
        uuid: (node.attrs.uuid as string | null) || null,
      });
    }
  });
  if (pendingTitles.length > 0) {
    if (headings.length > 0) {
      headings[headings.length - 1].parTitles.push(...pendingTitles);
    } else {
      preambleTitles.push(...pendingTitles);
    }
  }
  return { headings, preambleTitles };
}

/* ── Tree builder (view mode) ──────────────────────────────────────── */

interface TreeNode {
  heading: HeadingItem;
  children: TreeNode[];
}

function buildTree(headings: HeadingItem[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const stack: TreeNode[] = [];

  for (const h of headings) {
    const node: TreeNode = { heading: h, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].heading.level >= h.level) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    stack.push(node);
  }

  return roots;
}

/**
 * True when the node, any of its parTitles, or any descendant has an
 * index inside the focused band. Used to decide whether a locked-mode
 * outside heading should still render to host its in-focus children.
 */
function nodeIntersectsFocus(node: TreeNode, focus: FocusState): boolean {
  if (node.heading.index >= focus.startBlockIndex && node.heading.index <= focus.endBlockIndex) return true;
  for (const pt of node.heading.parTitles) {
    if (pt.index >= focus.startBlockIndex && pt.index <= focus.endBlockIndex) return true;
  }
  for (const child of node.children) {
    if (nodeIntersectsFocus(child, focus)) return true;
  }
  return false;
}

/* ── Per-section word counting (view mode) ─────────────────────────── */

// Per-block categorization + section summing live in the shared
// word-count-core walker — the SSOT with useWordCount's panel totals, so
// the same include-config bit always filters the same word set on both
// surfaces (task 112). Re-exported for the ./index barrel consumers.
export { buildPerBlockCounts, sumIncludedWords };

/* ── View-mode tree row ────────────────────────────────────────────── */

function OutlineNode({
  node,
  collapsed,
  onToggle,
  onScrollTo,
  depth,
  showLabels,
  showTitles,
  showWordCount,
  showNumbers,
  sectionWordCount,
  perSectionCounts,
  onUpdateLabel,
  isLabelTaken,
  focusState,
  onFocusMoveTo,
  onFocusExpandTo,
}: {
  node: TreeNode;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  onScrollTo: (index: number) => void;
  depth: number;
  showLabels: boolean;
  showTitles: boolean;
  showWordCount: boolean;
  showNumbers: boolean;
  sectionWordCount: number;
  perSectionCounts: Map<string, number>;
  onUpdateLabel?: (uuid: string, newLabel: string | null) => void;
  isLabelTaken?: (candidate: string, excludeLabel: string | null) => boolean;
  focusState?: FocusState | null;
  onFocusMoveTo?: (blockIndex: number) => void;
  onFocusExpandTo?: (blockIndex: number) => void;
}) {
  const hasSubHeadings = node.children.length > 0;
  const hasTitles = showTitles && node.heading.parTitles.length > 0;
  const hasChildren = hasSubHeadings || hasTitles;
  const isCollapsed = collapsed.has(node.heading.id);

  const isFocusEditing = focusState?.active && !focusState.locked;
  // `isOutsideFocus` drives the LOCKED subtree cull (below). The visual DIM is a
  // SEPARATE, lock-gated concern: a mere focus selection (active && !locked)
  // shows the band overlay only and dims NOTHING (CHIP A), so out-of-band rows
  // stay full opacity until the band is locked.
  const isOutsideFocus = focusState?.active
    ? node.heading.index < focusState.startBlockIndex || node.heading.index > focusState.endBlockIndex
    : false;
  const dimOutsideFocus = isOutsideFocus && !!focusState?.locked;

  // Locked mode: drop the entire subtree when nothing in it intersects
  // the focused band. If something does intersect (e.g., focus on a
  // sub-heading whose parent's index is outside the band), render the
  // heading row at its existing dim so the in-focus children render in
  // place with structural context.
  if (focusState?.active && focusState.locked && isOutsideFocus && !nodeIntersectsFocus(node, focusState)) {
    return null;
  }

  const handleRowClick = (blockIndex: number) => (e: React.MouseEvent) => {
    if (isFocusEditing && onFocusMoveTo && onFocusExpandTo) {
      if (e.shiftKey) {
        onFocusExpandTo(blockIndex);
      } else {
        onFocusMoveTo(blockIndex);
      }
    } else {
      onScrollTo(blockIndex);
    }
  };

  return (
    <div>
      <div
        data-outline-pos={`h-${node.heading.index}`}
        className={`flex items-start group cursor-pointer rounded ${isFocusEditing ? "" : "hover-on-light"}`}
        style={{ paddingLeft: `${headingIndent(depth)}px`, paddingRight: 8, paddingTop: 4, paddingBottom: 4, gap: OUTLINE_ROW_GAP, opacity: dimOutsideFocus ? 0.3 : 1, transition: "opacity 200ms ease", position: "relative", zIndex: 5 }}
        onClick={handleRowClick(node.heading.index)}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.heading.id);
            }}
            className="mt-0.5 rounded text-[var(--muted)] hover:text-ink-body transition-colors shrink-0 flex items-center justify-center"
            style={{ width: OUTLINE_TWIST_COL, height: 16 }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`transition-transform ${isCollapsed ? "" : "rotate-90"}`}
            >
              <path d="M4.5 2l4 4-4 4" />
            </svg>
          </button>
        ) : (
          <span className="shrink-0" style={{ width: OUTLINE_TWIST_COL }} />
        )}
        <div className="min-w-0 flex-1">
          {/* Number + text as a two-column flex row so a wrapped heading hangs
              under its own text, not under the number (#2 \u2014 like a numbered
              list). */}
          <div className="flex">
            {showNumbers && node.heading.sectionNumber && (
              <span
                className="shrink-0 text-ink-muted font-normal text-sm leading-snug tabular-nums"
                style={{ paddingRight: 5 }}
              >
                {node.heading.sectionNumber}
              </span>
            )}
            <span
              className={`min-w-0 flex-1 text-sm leading-snug break-words ${
                node.heading.level <= 1
                  ? "font-semibold text-ink-strong"
                  : node.heading.level === 2
                    ? "font-medium text-ink-body"
                    : "text-ink-body"
              }`}
            >
              {node.heading.text}
            </span>
          </div>
          {showLabels && onUpdateLabel && node.heading.uuid && (
            <InlineLabel
              label={node.heading.label}
              onCommit={(val) => onUpdateLabel(node.heading.uuid!, val)}
              isTaken={isLabelTaken}
            />
          )}
        </div>
        {showWordCount && (
          <span className="text-[10px] tabular-nums text-ink-muted shrink-0 mt-0.5">
            {sectionWordCount}
          </span>
        )}
      </div>

      {!isCollapsed && hasTitles && (
        <div>
          {node.heading.parTitles.map((pt, i) => {
            const ptOutside = focusState?.active
              ? pt.index < focusState.startBlockIndex || pt.index > focusState.endBlockIndex
              : false;
            // Locked: cull out-of-band parTitles. Unlocked (mere selection):
            // show them at full opacity, no dim (CHIP A).
            if (focusState?.active && focusState.locked && ptOutside) return null;
            const ptDim = ptOutside && !!focusState?.locked;
            return (
              <div
                key={`pt-${i}`}
                data-outline-pos={`pt-${pt.index}`}
                className={`cursor-pointer rounded text-[11px] text-[#857070] truncate ${isFocusEditing ? "" : "hover-on-light"}`}
                style={{
                  paddingLeft: `${parTitleIndent(depth)}px`,
                  paddingRight: 8,
                  paddingTop: 2,
                  paddingBottom: 2,
                  opacity: ptDim ? 0.3 : 1,
                  transition: "opacity 200ms ease",
                  position: "relative",
                  zIndex: 5,
                }}
                onClick={handleRowClick(pt.index)}
              >
                {pt.title}
              </div>
            );
          })}
        </div>
      )}

      {hasSubHeadings && !isCollapsed && (
        <div>
          {node.children.map((child) => (
            <OutlineNode
              key={child.heading.id}
              node={child}
              collapsed={collapsed}
              onToggle={onToggle}
              onScrollTo={onScrollTo}
              depth={depth + 1}
              showLabels={showLabels}
              showTitles={showTitles}
              showWordCount={showWordCount}
              showNumbers={showNumbers}
              sectionWordCount={perSectionCounts.get(child.heading.id) ?? 0}
              perSectionCounts={perSectionCounts}
              onUpdateLabel={onUpdateLabel}
              isLabelTaken={isLabelTaken}
              focusState={focusState}
              onFocusMoveTo={onFocusMoveTo}
              onFocusExpandTo={onFocusExpandTo}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Edit mode types & helpers ─────────────────────────────────────── */

interface OutlinePod {
  type: "heading" | "parTitle";
  level: number;        // 1-3 for headings, 4 for parTitles
  text: string;
  blockIndex: number;   // top-level block index in doc.content (reorder/scroll)
  blockCount: number;   // how many top-level blocks this pod covers
  id: string;
  /** Durable block uuid — the address the rename/label mutators key on (T3 /
   *  W3a). Null when the block hasn't earned a uuid yet; rename then no-ops. */
  uuid: string | null;
  parentHeadingId?: string; // parTitles & sub-headings collapse under this id
  hasCollapsibleChildren?: boolean; // headings only — true when something
                                    // would be hidden by collapsing
}

function buildPods(headings: HeadingItem[], totalBlocks: number): OutlinePod[] {
  const pods: OutlinePod[] = [];

  // Walk a stack of ancestor headings so each item knows which heading
  // would hide it when collapsed. The "owner" of a pod for collapsing
  // purposes is its nearest strictly-higher-level heading ancestor.
  const stack: { id: string; level: number }[] = [];

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];

    // Pop ancestors at our level or deeper before recording our parent.
    while (stack.length > 0 && stack[stack.length - 1].level >= h.level) {
      stack.pop();
    }
    const parentHeadingId = stack[stack.length - 1]?.id;

    // blockCount: from this heading to the next heading of same/higher level
    let blockCount = 1;
    const nextSameOrHigher = headings.find((nh, ni) => ni > i && nh.level <= h.level);
    if (nextSameOrHigher) {
      blockCount = nextSameOrHigher.index - h.index;
    } else {
      blockCount = totalBlocks - h.index;
    }

    const hasSubHeading = i < headings.length - 1 && headings[i + 1].level > h.level;
    const hasCollapsibleChildren = hasSubHeading || h.parTitles.length > 0;

    pods.push({
      type: "heading",
      level: h.level,
      text: h.text,
      blockIndex: h.index,
      blockCount,
      id: h.id,
      uuid: h.uuid,
      parentHeadingId,
      hasCollapsibleChildren,
    });

    // Push this heading onto the stack so its descendants can find it.
    stack.push({ id: h.id, level: h.level });

    // Add parTitle pods under this heading
    for (const pt of h.parTitles) {
      pods.push({
        type: "parTitle",
        level: 4,
        text: pt.title,
        blockIndex: pt.index,
        blockCount: 1,
        id: pt.uuid ?? `pt-${pt.index}`,
        uuid: pt.uuid,
        parentHeadingId: h.id,
      });
    }
  }

  return pods;
}

/**
 * Decide which pods are hidden because some ancestor heading is collapsed.
 * A pod is hidden if any heading on its parent chain is in `collapsed`.
 */
function computeHiddenPods(
  pods: OutlinePod[],
  collapsed: Set<string>,
): Set<string> {
  const hidden = new Set<string>();
  // Map each heading id to its parent heading id for fast walks.
  const parentOf = new Map<string, string | undefined>();
  for (const p of pods) {
    if (p.type === "heading") parentOf.set(p.id, p.parentHeadingId);
  }
  const isAncestorCollapsed = (startParentId: string | undefined): boolean => {
    let cur = startParentId;
    while (cur) {
      if (collapsed.has(cur)) return true;
      cur = parentOf.get(cur);
    }
    return false;
  };
  for (const p of pods) {
    if (isAncestorCollapsed(p.parentHeadingId)) hidden.add(p.id);
  }
  return hidden;
}

/* ── Drag handle icon ──────────────────────────────────────────────── */

function DragHandle() {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" className="shrink-0 opacity-40">
      <circle cx="3" cy="2" r="1.2" />
      <circle cx="7" cy="2" r="1.2" />
      <circle cx="3" cy="7" r="1.2" />
      <circle cx="7" cy="7" r="1.2" />
      <circle cx="3" cy="12" r="1.2" />
      <circle cx="7" cy="12" r="1.2" />
    </svg>
  );
}

/* ── Editable pod component ────────────────────────────────────────── */

function EditablePod({
  pod,
  isDragging,
  dropPosition,
  isCollapsed,
  onToggleCollapse,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onRename,
}: {
  pod: OutlinePod;
  isDragging: boolean;
  dropPosition: "above" | "below" | null;
  isCollapsed: boolean;
  onToggleCollapse?: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onRename: (newText: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(pod.text);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commitRename = () => {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== pod.text) {
      onRename(trimmed);
    }
    setEditing(false);
  };

  // Edit-mode pods indent by their level through the shared model (parTitles
  // are level 4). Same base-inset + per-level step as the view tree.
  const indent = headingIndent(pod.level - 1);

  const isParTitle = pod.type === "parTitle";
  const showChevron = !isParTitle && pod.hasCollapsibleChildren;

  return (
    <div
      className="relative"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dropPosition === "above" && (
        <div className="absolute top-0 left-2 right-2 h-[2px] bg-[var(--accent)] rounded-full z-10 -translate-y-1/2" />
      )}
      <div
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        className={`flex items-center gap-1.5 rounded-md border transition-all cursor-grab active:cursor-grabbing ${
          isDragging
            ? "opacity-30 border-edge-hover bg-surface-muted-strong"
            : isParTitle
              ? "border-edge-hover bg-surface hover:border-edge-strong"
              : "border-edge-hover bg-surface hover:border-edge-strong shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
        }`}
        style={{
          marginLeft: `${indent}px`,
          marginRight: 8,
          paddingTop: isParTitle ? 3 : 5,
          paddingBottom: isParTitle ? 3 : 5,
          paddingLeft: 6,
          paddingRight: 8,
          marginTop: 2,
          marginBottom: 2,
        }}
      >
        {showChevron ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse?.();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="p-0.5 rounded text-[var(--muted)] hover:text-ink-body transition-colors shrink-0"
            data-hint={isCollapsed ? "Expand" : "Collapse"}
            data-hint-pos="above"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`transition-transform ${isCollapsed ? "" : "rotate-90"}`}
            >
              <path d="M4.5 2l4 4-4 4" />
            </svg>
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <DragHandle />
        {editing ? (
          <input
            ref={inputRef}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") { setEditText(pod.text); setEditing(false); }
            }}
            onBlur={commitRename}
            className={`flex-1 min-w-0 bg-transparent outline-none border-b border-[var(--accent)] ${
              isParTitle ? "text-[11px] text-[#857070]" : "text-sm text-ink-strong"
            }`}
          />
        ) : (
          <span
            onClick={() => { setEditText(pod.text); setEditing(true); }}
            className={`flex-1 min-w-0 truncate cursor-text ${
              isParTitle
                ? "text-[11px] text-[#857070]"
                : pod.level <= 1
                  ? "text-sm font-semibold text-ink-strong"
                  : pod.level === 2
                    ? "text-sm font-medium text-ink-body"
                    : "text-sm text-ink-body"
            }`}
          >
            {pod.text}
          </span>
        )}
      </div>
      {dropPosition === "below" && (
        <div className="absolute bottom-0 left-2 right-2 h-[2px] bg-[var(--accent)] rounded-full z-10 translate-y-1/2" />
      )}
    </div>
  );
}

/* ── Editable outline (edit mode container) ────────────────────────── */

function EditableOutline({
  headings,
  totalBlocks,
  collapsed,
  onToggleCollapse,
  onReorderBlocks,
  onRenameHeading,
  onRenameParTitle,
}: {
  headings: HeadingItem[];
  totalBlocks: number;
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
  onReorderBlocks: (fromIndex: number, count: number, toIndex: number) => void;
  onRenameHeading: (uuid: string, newText: string) => void;
  onRenameParTitle: (uuid: string, newTitle: string) => void;
}) {
  const pods = useMemo(() => buildPods(headings, totalBlocks), [headings, totalBlocks]);
  const hiddenIds = useMemo(() => computeHiddenPods(pods, collapsed), [pods, collapsed]);
  const visiblePods = useMemo(() => pods.filter((p) => !hiddenIds.has(p.id)), [pods, hiddenIds]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ podId: string; position: "above" | "below" } | null>(null);

  // The painted drop-line derives from the LANDING index via the same
  // outline-drop helpers handleDrop uses, so indicator and effect can't
  // disagree (task 114): a "below" hover on an EXPANDED heading paints after
  // the section's last visible member (where the blocks actually land), not
  // between the heading and its first child; a hover whose drop handleDrop
  // would reject (own pod / inside the dragged section) lights nothing.
  const dropIndicator = useMemo(() => {
    if (!dropTarget) return null;
    const target = pods.find((p) => p.id === dropTarget.podId);
    if (!target) return null;
    const source = draggingId ? pods.find((p) => p.id === draggingId) : undefined;
    return resolveDropIndicator(visiblePods, target, dropTarget.position, source);
  }, [dropTarget, pods, visiblePods, draggingId]);

  const handleDragStart = useCallback((pod: OutlinePod, e: React.DragEvent) => {
    setDraggingId(pod.id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", pod.id);
    // Custom ghost
    const ghost = document.createElement("div");
    ghost.textContent = pod.text;
    ghost.style.cssText = "position:fixed;top:-1000px;padding:4px 12px;background:#fff;border:1px solid #d6d3d1;border-radius:var(--radius-md);font-size:13px;color:#44403c;box-shadow:0 2px 8px rgba(0,0,0,0.12);max-width:200px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;";
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 10, 14);
    requestAnimationFrame(() => document.body.removeChild(ghost));
  }, []);

  const handleDragOver = useCallback((podId: string, e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    // Determine above/below based on mouse position
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const position = e.clientY < midY ? "above" : "below";
    setDropTarget({ podId, position });
  }, []);

  const handleDrop = useCallback((targetPodId: string, e: React.DragEvent) => {
    e.preventDefault();
    if (!draggingId || !dropTarget) { setDraggingId(null); setDropTarget(null); return; }

    const sourcePod = pods.find((p) => p.id === draggingId);
    const targetPod = pods.find((p) => p.id === targetPodId);
    if (!sourcePod || !targetPod || sourcePod.id === targetPod.id) {
      setDraggingId(null);
      setDropTarget(null);
      return;
    }

    // Landing index + own-range rejection through the shared outline-drop
    // helpers — the same math the indicator paints from (task 114).
    const targetBlockIndex = landingBlockIndex(targetPod, dropTarget.position);
    if (isRejectedDrop(sourcePod, targetPod, targetBlockIndex)) {
      setDraggingId(null);
      setDropTarget(null);
      return;
    }

    onReorderBlocks(sourcePod.blockIndex, sourcePod.blockCount, targetBlockIndex);
    setDraggingId(null);
    setDropTarget(null);
  }, [draggingId, dropTarget, pods, onReorderBlocks]);

  const handleRename = useCallback((pod: OutlinePod, newText: string) => {
    // Address by durable uuid (T3 / W3a). A pod that hasn't earned a uuid yet
    // (lazy backfill) can't be safely renamed by index — skip rather than
    // mis-address the live doc.
    if (!pod.uuid) return;
    if (pod.type === "heading") {
      onRenameHeading(pod.uuid, newText);
    } else {
      onRenameParTitle(pod.uuid, newText);
    }
  }, [onRenameHeading, onRenameParTitle]);

  if (pods.length === 0) {
    return (
      <div className="p-6 text-center text-[var(--muted)] text-sm">
        No sections found.
      </div>
    );
  }

  return (
    <div className="py-1">
      {visiblePods.map((pod) => (
        <EditablePod
          key={pod.id}
          pod={pod}
          isDragging={draggingId === pod.id}
          dropPosition={
            dropIndicator?.podId === pod.id ? dropIndicator.position : null
          }
          isCollapsed={collapsed.has(pod.id)}
          onToggleCollapse={
            pod.type === "heading" && pod.hasCollapsibleChildren
              ? () => onToggleCollapse(pod.id)
              : undefined
          }
          onDragStart={(e) => handleDragStart(pod, e)}
          onDragEnd={() => { setDraggingId(null); setDropTarget(null); }}
          onDragOver={(e) => handleDragOver(pod.id, e)}
          onDragLeave={() => {
            setDropTarget((prev) => prev?.podId === pod.id ? null : prev);
          }}
          onDrop={(e) => handleDrop(pod.id, e)}
          onRename={(newText) => handleRename(pod, newText)}
        />
      ))}
    </div>
  );
}

/* ── Storage ───────────────────────────────────────────────────────────
 * View prefs now live in a shared, localStorage-backed external store
 * (./outline-prefs-store) consumed via useSyncExternalStore, so they survive
 * BOTH reload and the docked↔popped-out remount (OUT-#7). The old per-instance
 * useState + load/save-effects pair lived here. */

/* ── Focus band overlay ──────────────────────────────────────────── */

function FocusBand({
  scrollRef,
  focusState,
  headings,
  preambleTitles,
  totalBlocks: _totalBlocks,
  onSnapBoundary,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  focusState: FocusState;
  headings: HeadingItem[];
  preambleTitles: { title: string; index: number }[];
  totalBlocks: number;
  onSnapBoundary?: (edge: "top" | "bottom", blockIndex: number) => void;
}) {
  // The band's measured rectangle. Once a real measurement lands, we never
  // reset this to null — keeping the last good value avoids the flicker
  // where a transient querySelector miss (during reflows or row remounts)
  // would otherwise unmount the band entirely.
  const [band, setBand] = useState<{ top: number; height: number } | null>(null);
  // Whether to animate top/height. We disable transitions during drag so
  // the band tracks the cursor instead of trailing 200ms behind it.
  const [animated, setAnimated] = useState(true);

  // Drag state: a snapshot of all candidate row positions taken at drag
  // start. The drag is a purely LOCAL overlay gesture (CHIP B) — mid-drag we
  // drive the band rect from this snapshot + the fixed-edge pixel/block (no
  // parent state, no disk write), then commit ONCE on mouseup.
  //  - `fixedPx`: pixel position of the edge that stays put (the band's bottom
  //    when dragging "top", its top when dragging "bottom"), captured at
  //    mousedown so the transient rect is computed against it.
  //  - `startBlockIndex`/`endBlockIndex`: the committed range at mousedown.
  //    On mouseup, resolveDragCommit derives the dragged edge's OWN row from
  //    these to decide whether it actually moved (task 113 — comparing against
  //    the FIXED edge's row silently dropped the shrink-onto-opposite-edge
  //    gesture and let a drag back to the origin row commit a no-op).
  //  - `pendingBlockIndex`: the block the dragged edge is currently snapped to
  //    (the single value committed via onSnapBoundary on mouseup).
  const dragRef = useRef<{
    edge: "top" | "bottom";
    rows: { blockIndex: number; top: number; mid: number; bottom: number }[];
    fixedPx: number;
    startBlockIndex: number;
    endBlockIndex: number;
    pendingBlockIndex: number | null;
  } | null>(null);

  // Minimum band height in pixels so a drag past the opposite edge clamps to a
  // thin band instead of inverting/collapsing (mirrors snapBoundary's 1-row
  // clamp in useFocusMode — CHIP E).
  const MIN_PX = 12;

  // Stable identity for outline row attrs, used both for measurement and as
  // the candidate set for drag snapping.
  const allRowAttrs = useMemo(() => {
    const attrs: { attr: string; blockIndex: number }[] = [];
    attrs.push({ attr: "docstart", blockIndex: 0 });
    for (const pt of preambleTitles) {
      attrs.push({ attr: `pt-${pt.index}`, blockIndex: pt.index });
    }
    for (const h of headings) {
      attrs.push({ attr: `h-${h.index}`, blockIndex: h.index });
      for (const pt of h.parTitles) {
        attrs.push({ attr: `pt-${pt.index}`, blockIndex: pt.index });
      }
    }
    return attrs;
  }, [headings, preambleTitles]);

  // Synchronous measure — runs before paint, reads DOM in one querySelectorAll
  // pass, and only updates state if the rectangle actually changed.
  const measure = useCallback(() => {
    // During a drag the rect is driven LOCALLY from the mousedown snapshot
    // (see the rAF flush). measure() derives the rect from focusState, which
    // hasn't moved yet (we only commit on mouseup) — letting it run here would
    // clobber the live transient band. Bail; the post-commit measure restores
    // the authoritative rect.
    if (dragRef.current) return;
    const container = scrollRef.current;
    if (!container) return;

    const rowMap = new Map<string, HTMLElement>();
    container.querySelectorAll<HTMLElement>("[data-outline-pos]").forEach((el) => {
      const attr = el.dataset.outlinePos;
      if (attr) rowMap.set(attr, el);
    });

    let topEl: HTMLElement | null = null;
    let botEl: HTMLElement | null = null;
    for (const r of allRowAttrs) {
      const el = rowMap.get(r.attr);
      if (!el) continue;
      if (r.blockIndex >= focusState.startBlockIndex && !topEl) topEl = el;
      if (r.blockIndex >= focusState.startBlockIndex && r.blockIndex <= focusState.endBlockIndex) botEl = el;
    }
    // Keep the previous band rather than blanking it. Transient misses
    // happen during row remounts and would otherwise flash the band off.
    if (!topEl || !botEl) return;
    const top = topEl.offsetTop;
    const height = botEl.offsetTop + botEl.offsetHeight - top;
    setBand((prev) => (prev && prev.top === top && prev.height === height ? prev : { top, height }));
  }, [scrollRef, allRowAttrs, focusState.startBlockIndex, focusState.endBlockIndex]);

  // Layout effect so the band lands on the right pixel before the browser
  // paints, eliminating the "old position then snap" flash on state change.
  useLayoutEffect(() => {
    measure();
  }, [measure]);

  // Remeasure on container resize *and* on inner row reflows (e.g.
  // collapse/expand). MutationObserver is scoped to childList only so it
  // doesn't fire on every style/class change — the unscoped attribute
  // observer was a major source of measurement thrash.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(container);
    const mo = new MutationObserver(() => measure());
    mo.observe(container, { childList: true, subtree: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [scrollRef, measure]);

  // Drag — snapshot row positions at mousedown and reuse them for every
  // mousemove (CHIP B). Mid-drag is a PURELY LOCAL overlay gesture: we drive
  // the band rect from the snapshot via setBand and do NOT touch parent state
  // or disk. Throttle with requestAnimationFrame. The single onSnapBoundary
  // commit happens on mouseup, so an N-row drag = 1 state write + 1 re-render
  // + 1 breadcrumb recompute (not N).
  useEffect(() => {
    if (!onSnapBoundary || focusState.locked) return;

    let rafScheduled = false;
    let lastY = 0;

    const flush = () => {
      rafScheduled = false;
      const drag = dragRef.current;
      if (!drag) return;
      // Nearest snapped row to the cursor.
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < drag.rows.length; i++) {
        const dist = Math.abs(lastY - drag.rows[i].mid);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      }
      const row = drag.rows[bestIdx];
      drag.pendingBlockIndex = row.blockIndex;
      // Transient rect against the fixed edge. Clamp so the band never inverts
      // or collapses (consistent with snapBoundary's 1-row clamp).
      if (drag.edge === "top") {
        const newTop = Math.min(row.top, drag.fixedPx - MIN_PX);
        setBand({ top: newTop, height: drag.fixedPx - newTop });
      } else {
        const newBottom = Math.max(row.bottom, drag.fixedPx + MIN_PX);
        setBand({ top: drag.fixedPx, height: newBottom - drag.fixedPx });
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      const container = scrollRef.current;
      if (!drag || !container) return;
      const rect = container.getBoundingClientRect();
      lastY = e.clientY - rect.top + container.scrollTop;
      if (!rafScheduled) {
        rafScheduled = true;
        requestAnimationFrame(flush);
      }
    };

    const handleMouseUp = () => {
      const drag = dragRef.current;
      if (!drag) return;
      // Commit ONCE — but only if the dragged edge actually moved off its OWN
      // committed row (otherwise it's a no-op click/return-to-origin and we
      // skip the state write + re-render + breadcrumb recompute). The decision
      // lives in resolveDragCommit (pure, unit-tested — task 113).
      const decision = resolveDragCommit({
        edge: drag.edge,
        pendingBlockIndex: drag.pendingBlockIndex,
        startBlockIndex: drag.startBlockIndex,
        endBlockIndex: drag.endBlockIndex,
      });
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setAnimated(true);
      if (decision.commit) {
        // After this lands, focusState updates and the (now un-guarded)
        // measure() recomputes the authoritative rect — which matches the
        // transient rect we already painted (same snapped row → same offsetTop/
        // offsetHeight), so there is no visible jump.
        onSnapBoundary(drag.edge, decision.blockIndex);
      } else {
        // No commit → focusState is untouched, so nothing re-runs measure()
        // for us (the MO fires on childList only). Restore the authoritative
        // rect ourselves — the mid-drag transient rect may still be painted
        // (dragRef is cleared, so measure() no longer bails).
        measure();
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    // `measure` re-identifies only on focusState/row changes (commit-time,
    // never mid-drag), so this re-subscribe stays off the drag path.
  }, [onSnapBoundary, focusState.locked, scrollRef, measure]);

  const startDrag = (edge: "top" | "bottom") => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const container = scrollRef.current;
    if (!container || !band) return;
    // Snapshot row geometry once. Drag doesn't change row layout, so we never
    // need to re-read the DOM during the drag itself. We keep top/mid/bottom:
    // `mid` for nearest-row snapping, `top`/`bottom` for the transient rect.
    const rowMap = new Map<string, HTMLElement>();
    container.querySelectorAll<HTMLElement>("[data-outline-pos]").forEach((el) => {
      const attr = el.dataset.outlinePos;
      if (attr) rowMap.set(attr, el);
    });
    const rows: { blockIndex: number; top: number; mid: number; bottom: number }[] = [];
    for (const r of allRowAttrs) {
      const el = rowMap.get(r.attr);
      if (!el) continue;
      const top = el.offsetTop;
      const bottom = el.offsetTop + el.offsetHeight;
      rows.push({ blockIndex: r.blockIndex, top, mid: top + el.offsetHeight / 2, bottom });
    }
    // The OPPOSITE edge stays put for the whole drag. Capture its pixel position
    // from the current band rect so the transient rect references it, plus the
    // full committed range so the moved-check on commit compares the dragged
    // edge against its OWN row (task 113).
    const fixedPx = edge === "top" ? band.top + band.height : band.top;
    dragRef.current = {
      edge,
      rows,
      fixedPx,
      startBlockIndex: focusState.startBlockIndex,
      endBlockIndex: focusState.endBlockIndex,
      pendingBlockIndex: null,
    };
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    // Disable transitions during drag so the band tracks the cursor.
    setAnimated(false);
  };

  if (!band) return null;

  const transition = animated ? "top 180ms ease, height 180ms ease" : "none";

  return (
    <>
      {/* Highlight band — light yellow */}
      <div
        style={{
          position: "absolute",
          left: 2,
          right: 2,
          top: band.top,
          height: band.height,
          background: "#fef9c3",
          opacity: 0.55,
          borderRadius: "var(--radius-md)",
          pointerEvents: "none",
          zIndex: 3,
          transition,
        }}
      />
      {/* Border */}
      <div
        style={{
          position: "absolute",
          left: 2,
          right: 2,
          top: band.top,
          height: band.height,
          border: "1.5px solid #d4aa17",
          opacity: 0.5,
          borderRadius: "var(--radius-md)",
          pointerEvents: "none",
          zIndex: 4,
          transition,
        }}
      />
      {/* Top handle */}
      {!focusState.locked && (
        <div
          onMouseDown={startDrag("top")}
          style={{
            position: "absolute",
            left: "50%",
            top: band.top - 5,
            width: 10,
            height: 10,
            marginLeft: -5,
            borderRadius: "50%",
            background: "var(--accent)",
            border: "2px solid white",
            cursor: "ns-resize",
            zIndex: 6,
            transition: animated ? "top 180ms ease" : "none",
            boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
          }}
        />
      )}
      {/* Bottom handle */}
      {!focusState.locked && (
        <div
          onMouseDown={startDrag("bottom")}
          style={{
            position: "absolute",
            left: "50%",
            top: band.top + band.height - 5,
            width: 10,
            height: 10,
            marginLeft: -5,
            borderRadius: "50%",
            background: "var(--accent)",
            border: "2px solid white",
            cursor: "ns-resize",
            zIndex: 6,
            transition: animated ? "top 180ms ease" : "none",
            boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
          }}
        />
      )}
    </>
  );
}

/* ── Main OutlinePanel ─────────────────────────────────────────────── */

function OutlinePanel({ content, docId, onScrollTo, onReorderBlocks, onRenameHeading, onRenameParTitle, onUpdateLabel, isLabelTaken, activeSectionPath, activeParTitleIndex, editorSplit, mirrorSectionPath, mirrorParTitleIndex, focusState, onFocusActivate, onFocusDeactivate, onFocusToggleLock, onFocusMoveTo, onFocusExpandTo, onFocusSnapBoundary }: OutlinePanelProps) {
  // View prefs come from the shared external store — survive reload AND the
  // docked↔popped-out remount (OUT-#7). No per-instance useState/localStorage.
  const prefs = useSyncExternalStore(
    subscribeOutlinePrefs,
    getOutlinePrefsSnapshot,
    getOutlinePrefsServerSnapshot,
  );
  // Folds are per-document (task 111). The selector returns a referentially
  // stable array while THIS doc's bucket is untouched, so unrelated store
  // writes (flat pref toggles, another doc's folds) don't churn the Set.
  const foldDocId = docId ?? "";
  const collapsedArr = getOutlineCollapsedForDoc(prefs, foldDocId);
  // `collapsed` is exposed as a mutable Set for the existing consumers; its
  // identity only changes when the stored fold set does.
  const collapsed = useMemo(() => new Set(collapsedArr), [collapsedArr]);
  const { showLabels, showTitles, showWordCount, showPosition, showNumbers } = prefs;
  // Flat-pref writes go straight to the stable module setter; fold writes go
  // through setOutlineCollapsedForDoc(foldDocId, …) so only this document's
  // bucket is touched (the toggle/collapse callbacks depend on foldDocId).
  const setShowLabels = (v: boolean) => setOutlinePrefs({ showLabels: v });
  const setShowTitles = (v: boolean) => setOutlinePrefs({ showTitles: v });
  const setShowWordCount = (v: boolean) => setOutlinePrefs({ showWordCount: v });
  const setShowPosition = (v: boolean) => setOutlinePrefs({ showPosition: v });
  const setShowNumbers = (v: boolean) => setOutlinePrefs({ showNumbers: v });

  const [editMode, setEditMode] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Per-section counts inherit the shared Word Count config — the
  // outline view menu no longer exposes category toggles of its own.
  const { config: wcConfig } = useWordCountConfig();

  // (The bespoke outside-click closer that used to live here went with the
  //  hand-rolled dropdown — `MenuProvider` owns dismissal now. See `headerLeading`.)

  const { headings, preambleTitles } = useMemo(() => extractHeadings(content), [content]);
  const tree = useMemo(() => buildTree(headings), [headings]);
  const docTitle = useMemo(() => getDocTitle(content), [content]);

  const totalBlocks = useMemo(() => {
    if (!content || !content.content) return 0;
    return content.content.length;
  }, [content]);

  // Per-block category counts — recomputed when content changes.
  const perBlockCounts = useMemo(() => buildPerBlockCounts(content), [content]);

  // Per-section word counts (view mode only). Keyed by heading id.
  const perSectionCounts = useMemo(() => {
    const result = new Map<string, number>();
    if (editMode || !showWordCount) return result; // skip work — not displayed
    for (let i = 0; i < headings.length; i++) {
      const h = headings[i];
      const next = headings.find((nh, ni) => ni > i && nh.level <= h.level);
      const toIdx = next ? next.index : totalBlocks;
      result.set(
        h.id,
        sumIncludedWords(perBlockCounts, h.index, toIdx, wcConfig.include),
      );
    }
    return result;
  }, [editMode, showWordCount, headings, perBlockCounts, totalBlocks, wcConfig.include]);

  const toggleNode = useCallback((id: string) => {
    setOutlineCollapsedForDoc(foldDocId, (prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, [foldDocId]);

  // Resolve where each pane's position chevron should appear, accounting
  // for collapsed sections (chevron bubbles up to the visible ancestor).
  // When focus is LOCKED, clamp the position to the focused range so the
  // indicator never sits on a grayed-out (hidden) section. A mere focus
  // SELECTION (active && !locked) grays/hides nothing (CHIP A), so the chevron
  // must report the cursor's real row — no clamp.
  const clampToFocus = useCallback((pos: ResolvedPosition | null): ResolvedPosition | null => {
    if (!pos || !focusState?.active || !focusState.locked) return pos;
    // Determine the block index the position points at
    const blockIdx = pos.parTitleIndex ?? pos.headingIndex;
    if (blockIdx == null) {
      // docstart — clamp to first focused heading
      const first = headings.find((h) => h.index >= focusState.startBlockIndex && h.index <= focusState.endBlockIndex);
      if (first) return { headingText: first.text, headingIndex: first.index, parTitleIndex: null, isDocStart: false };
      return pos;
    }
    if (blockIdx < focusState.startBlockIndex) {
      const first = headings.find((h) => h.index >= focusState.startBlockIndex && h.index <= focusState.endBlockIndex);
      if (first) return { headingText: first.text, headingIndex: first.index, parTitleIndex: null, isDocStart: false };
    }
    if (blockIdx > focusState.endBlockIndex) {
      const last = [...headings].reverse().find((h) => h.index >= focusState.startBlockIndex && h.index <= focusState.endBlockIndex);
      if (last) return { headingText: last.text, headingIndex: last.index, parTitleIndex: null, isDocStart: false };
    }
    return pos;
  }, [focusState, headings]);

  const pos1 = useMemo(() => {
    if (!showPosition) return null;
    const raw = resolvePosition(activeSectionPath, activeParTitleIndex, headings, collapsed, showTitles, preambleTitles);
    return clampToFocus(raw);
  }, [showPosition, activeSectionPath, activeParTitleIndex, headings, collapsed, showTitles, preambleTitles, clampToFocus]);

  const pos2 = useMemo(() => {
    if (!showPosition || !editorSplit) return null;
    const raw = resolvePosition(mirrorSectionPath, mirrorParTitleIndex, headings, collapsed, showTitles, preambleTitles);
    return clampToFocus(raw);
  }, [showPosition, editorSplit, mirrorSectionPath, mirrorParTitleIndex, headings, collapsed, showTitles, preambleTitles, clampToFocus]);

  const isSplit = !!editorSplit;

  // Collapse/expand-all replace ONLY this doc's fold bucket — they can no
  // longer wipe another paper's persisted folds (task 111 member 1).
  const collapseAll = useCallback(() => {
    setOutlineCollapsedForDoc(foldDocId, new Set(headings.filter((h, i) => {
      const hasSubHeading = i < headings.length - 1 && headings[i + 1].level > h.level;
      const hasTitles = showTitles && h.parTitles.length > 0;
      return hasSubHeading || hasTitles;
    }).map((h) => h.id)));
  }, [foldDocId, headings, showTitles]);

  const expandAll = useCallback(() => {
    setOutlineCollapsedForDoc(foldDocId, new Set());
  }, [foldDocId]);

  /* The view-options kebab (task 180). This was the last hand-rolled panel-header
   * dropdown: an `absolute … z-30` div laid out INSIDE `Panel`'s
   * `overflow-hidden` wrapper, so at the `MIN_BAND_PX` (140) band height its last
   * rows rendered outside the clip and were unreachable — and `z-30` sat off the
   * ladder entirely, under the float layer (1200) at every band height. Folding
   * onto `ItemMenu` retires the clip (body-portaled at OPEN_CHROME_MENU_Z),
   * the missing viewport flip/clamp, the missing Escape + menu ARIA, and the
   * un-ringed trigger in one move — all five were properties of not being on the
   * primitive. `align="left"` also auto-injects `PanelTextSizeRow` when the
   * enclosing panel has a body key; Outline has no card-body typography, so
   * `bodyKey` is null and nothing is injected (see `panel-typography.ts:176`).
   *
   * `keepMenuOpen` on every row: `ItemMenu` closes on any bubbled click, and
   * these five are independent checkboxes the user commonly flips in a run —
   * closing after each one would be a regression against the old dropdown. */
  const headerLeading = (
    <ItemMenu align="left" hint="View options">
      <MenuToggleRow
        id="outline-show-numbers"
        label="Show section numbers"
        checked={showNumbers}
        keepMenuOpen
        onToggle={() => setShowNumbers(!showNumbers)}
      />
      <MenuToggleRow
        id="outline-show-labels"
        label="Show labels"
        checked={showLabels}
        keepMenuOpen
        onToggle={() => setShowLabels(!showLabels)}
      />
      <MenuToggleRow
        id="outline-show-titles"
        label="Show par. titles"
        checked={showTitles}
        keepMenuOpen
        onToggle={() => setShowTitles(!showTitles)}
      />
      <MenuToggleRow
        id="outline-show-word-count"
        label="Show word count"
        checked={showWordCount}
        keepMenuOpen
        onToggle={() => setShowWordCount(!showWordCount)}
      />
      <MenuToggleRow
        id="outline-show-position"
        label="Show current position"
        checked={showPosition}
        keepMenuOpen
        onToggle={() => setShowPosition(!showPosition)}
      />
    </ItemMenu>
  );

  const headerTitleAfter = (
    <div className="flex items-center gap-2 ml-2">
      {onReorderBlocks && (
        <button
          onClick={() => { if (focusState?.active) return; setEditMode(!editMode); }}
          className={`text-[11px] px-1.5 py-0 rounded-md transition-colors ${
            editMode
              ? "bg-[var(--control-selected)] text-white"
              : focusState?.active
                ? "bg-surface/50 text-ink-faint cursor-not-allowed"
                : "bg-surface/50 text-ink-body hover:bg-surface/80 hover:text-ink-strong"
          }`}
          data-hint="Edit mode"
        >
          Edit
        </button>
      )}
      {onFocusActivate && (
        <button
          onClick={() => {
            if (editMode) return;
            if (focusState?.active) {
              onFocusDeactivate?.();
            } else {
              onFocusActivate();
            }
          }}
          className={`text-[11px] px-1.5 py-0 rounded-md transition-colors ${
            focusState?.active
              ? "bg-[var(--control-selected)] text-white"
              : editMode
                ? "bg-surface/50 text-ink-faint cursor-not-allowed"
                : "bg-surface/50 text-ink-body hover:bg-surface/80 hover:text-ink-strong"
          }`}
          data-hint="Focus mode"
        >
          Focus
        </button>
      )}
      {focusState?.active && onFocusToggleLock && (
        <button
          onClick={onFocusToggleLock}
          className={`p-0.5 rounded-md transition-colors ${
            focusState.locked
              ? "text-[var(--accent)]"
              : "text-[var(--muted)] hover:text-ink-body"
          }`}
          data-hint={focusState.locked ? "Unlock focus" : "Lock focus"}
        >
          {focusState.locked ? (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
              <path d="M5 7V5a3 3 0 0 1 6 0v2" />
              <circle cx="8" cy="10.5" r="1" fill="var(--header-bg)" stroke="none" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="7" width="10" height="7" rx="1.5" />
              <path d="M1 7V5a3 3 0 0 1 6 0v2" />
            </svg>
          )}
        </button>
      )}
      {/* Expand / collapse all — relocated from the scroll body into the
          header, after Focus/Lock (#9). */}
      <span className="w-px h-3.5 bg-[var(--border)] mx-0.5" aria-hidden="true" />
      <button
        onClick={expandAll}
        className="p-0.5 rounded-md text-[var(--muted)] hover:text-ink-body transition-colors"
        data-hint="Expand all"
      >
        <svg width="12" height="9" viewBox="0 0 14 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 1 L7 4.5 L12 1" />
          <path d="M2 5.5 L7 9 L12 5.5" />
        </svg>
      </button>
      <button
        onClick={collapseAll}
        className="p-0.5 rounded-md text-[var(--muted)] hover:text-ink-body transition-colors"
        data-hint="Collapse all"
      >
        <svg width="12" height="9" viewBox="0 0 14 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 4.5 L7 1 L12 4.5" />
          <path d="M2 9 L7 5.5 L12 9" />
        </svg>
      </button>
    </div>
  );

  return (
    <Panel
      kind="outline"
      headerLeading={headerLeading}
      headerTitleAfter={headerTitleAfter}
      variant="raw"
      panelExtras={<div className="mx-3 h-px bg-[var(--border)] shrink-0" />}
    >
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-1 relative">
        {editMode && onReorderBlocks && onRenameHeading && onRenameParTitle ? (
          <EditableOutline
            headings={headings}
            totalBlocks={totalBlocks}
            collapsed={collapsed}
            onToggleCollapse={toggleNode}
            onReorderBlocks={onReorderBlocks}
            onRenameHeading={onRenameHeading}
            onRenameParTitle={onRenameParTitle}
          />
        ) : (
          // No inner card — the outline sits directly on the panel's warm
          // sheet (#1). This div stays `relative` as the positioning context
          // for the focus band + the current-section selector.
          <div className="relative min-h-full pt-1.5 pb-4">
            {/* Focus band overlay — only in unlocked mode */}
            {focusState?.active && !focusState.locked && (
              <FocusBand
                scrollRef={scrollRef}
                focusState={focusState}
                headings={headings}
                preambleTitles={preambleTitles}
                totalBlocks={totalBlocks}
                onSnapBoundary={onFocusSnapBoundary}
              />
            )}
            {/* Current-position selector — a soft full-row tint behind the
                active section (#3), not a sliding bar. Mirror pane (split) gets
                a slim green edge so both panes stay legible. */}
            {showPosition && (
              <>
                <PositionHighlight scrollRef={scrollRef} attr={posToAttr(pos1)} color="rgba(180, 87, 87, 0.13)" variant="fill" />
                {isSplit && <PositionHighlight scrollRef={scrollRef} attr={posToAttr(pos2)} color="#5b8a72" variant="edge" />}
              </>
            )}

            {/* Fixed top row — document start / title. Hidden when locked
                focus excludes block index 0. */}
            {!(focusState?.active && focusState.locked && headings.length > 0 && (0 < focusState.startBlockIndex || 0 > focusState.endBlockIndex)) && (
              <div
                data-outline-pos="docstart"
                className={`flex items-start cursor-pointer rounded ${focusState?.active && !focusState.locked ? "" : "hover-on-light"}`}
                style={{
                  paddingLeft: headingIndent(0), paddingRight: 8, paddingTop: 4, paddingBottom: 4, gap: OUTLINE_ROW_GAP,
                  // Dim docstart only when LOCKED focus excludes block 0 — a mere
                  // selection dims nothing (CHIP A).
                  opacity: focusState?.active && focusState.locked && headings.length > 0 && (0 < focusState.startBlockIndex || 0 > focusState.endBlockIndex) ? 0.3 : 1,
                  transition: "opacity 200ms ease",
                  position: "relative",
                  zIndex: 5,
                }}
                onClick={(e) => {
                  if (focusState?.active && !focusState.locked && onFocusMoveTo) {
                    if (e.shiftKey && onFocusExpandTo) onFocusExpandTo(0);
                    else onFocusMoveTo(0);
                  } else {
                    onScrollTo(-1);
                  }
                }}
              >
                <span className="shrink-0" style={{ width: OUTLINE_TWIST_COL }} />
                <div className="min-w-0 flex-1 text-sm leading-snug break-words">
                  {docTitle ? (
                    <span className="font-semibold text-ink-strong">{docTitle}</span>
                  ) : (
                    <span className="italic text-ink-muted">Document start</span>
                  )}
                </div>
                {showWordCount && (
                  <span className="text-[10px] text-ink-muted shrink-0 mt-0.5">
                    words
                  </span>
                )}
              </div>
            )}

            {showTitles && preambleTitles.length > 0 && (
              <div>
                {preambleTitles.map((pt, i) => {
                  const ptOutside = focusState?.active
                    ? pt.index < focusState.startBlockIndex || pt.index > focusState.endBlockIndex
                    : false;
                  // Locked: cull out-of-band preamble parTitles. Unlocked (mere
                  // selection): full opacity, no dim (CHIP A).
                  if (focusState?.active && focusState.locked && ptOutside) return null;
                  const ptDim = ptOutside && !!focusState?.locked;
                  return (
                    <div
                      key={`preamble-pt-${i}`}
                      data-outline-pos={`pt-${pt.index}`}
                      className={`cursor-pointer rounded text-[11px] text-[#857070] truncate ${focusState?.active && !focusState.locked ? "" : "hover-on-light"}`}
                      style={{
                        paddingLeft: parTitleIndent(0), paddingRight: 8, paddingTop: 2, paddingBottom: 2,
                        opacity: ptDim ? 0.3 : 1,
                        transition: "opacity 200ms ease",
                        position: "relative",
                        zIndex: 5,
                      }}
                      onClick={(e) => {
                        if (focusState?.active && !focusState.locked && onFocusMoveTo) {
                          if (e.shiftKey && onFocusExpandTo) onFocusExpandTo(pt.index);
                          else onFocusMoveTo(pt.index);
                        } else {
                          onScrollTo(pt.index);
                        }
                      }}
                    >
                      {pt.title}
                    </div>
                  );
                })}
              </div>
            )}

            {tree.length === 0 ? (
              <div className="p-6 text-center text-[var(--muted)] text-sm">
                No sections found. Use the Section dropdown in the toolbar to add headings.
              </div>
            ) : (
              tree.map((node) => (
                <OutlineNode
                  key={node.heading.id}
                  node={node}
                  collapsed={collapsed}
                  onToggle={toggleNode}
                  onScrollTo={onScrollTo}
                  depth={0}
                  showLabels={showLabels}
                  showTitles={showTitles}
                  showWordCount={showWordCount}
                  showNumbers={showNumbers}
                  sectionWordCount={perSectionCounts.get(node.heading.id) ?? 0}
                  perSectionCounts={perSectionCounts}
                  onUpdateLabel={onUpdateLabel}
                  isLabelTaken={isLabelTaken}
                  focusState={focusState}
                  onFocusMoveTo={onFocusMoveTo}
                  onFocusExpandTo={onFocusExpandTo}
                />
              ))
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

export default memo(OutlinePanel);
