"use client";

import { useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect, useSyncExternalStore, memo } from "react";
import type { JSONContent } from "@tiptap/react";
import { useWordCountConfig } from "@/hooks/useWordCountConfig";
import { buildPerBlockCounts, sumIncludedWords } from "@/lib/word-count-core";
import type { FocusState } from "@/hooks/useFocusMode";
import { sectionRange, INACTIVE_FOCUS_STATE } from "@/hooks/useFocusMode";
import type { FocusBand } from "@/lib/focus-view";
import { Panel } from "@/panels/_shared/Panel";
import { ItemMenu, PANEL } from "@/components/panel-primitives";
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
import { useFocusBandEdgeDrag, type FocusBandRow } from "./focus-band-drag";
import { landingBlockIndex, isRejectedDrop, resolveDropIndicator } from "./outline-drop";
import {
  sectionExtentFromHeadings,
  type BlockAddress,
  type BlockSpanAddress,
} from "@/lib/tiptap/block-address";
import { attachClampedDragGhost, buildTextDragGhost } from "@/lib/drag-ghost";
import { iconHint } from "@/components/Hint";

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
 * shows through).
 *
 * It used to take a `variant`: "fill" (this soft red wash, the canonical
 * pane's current-section selector) vs "edge" (a slim green bar tracking the
 * MIRROR pane of a split editor). The editor split was retired in task 115 —
 * the toggle flipped a persisted pref no pane read, and with no mirror the
 * mirror section path resolved to Document-start, so one click painted a
 * permanent green bar on the Outline's title row that survived reloads. The
 * mirror was the "edge" branch's ONLY caller, so the variant went with it.
 *
 * (Historic text: `variant` distinguished the canonical pane ("fill", a soft
 * red wash — the primary current-section selector) from the mirror pane
 * ("edge", a slim accent bar) so a split view showed both without two
 * clashing washes.)
 *
 * The wash is an ACCENT tint (task 284). It used to be
 * `rgba(180, 87, 87, 0.13)` — `--footnote-500` at 13%, spelled in decimal, a
 * borrowed colour for a job that has nothing to do with footnotes. "Where the
 * caret is" is what `--accent` names ("Links, selections, and active
 * controls"), and `--accent` is user-themeable, so the selector now follows the
 * user's accent instead of a frozen red.
 */
function PositionHighlight({ scrollRef, attr, color }: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  attr: string | null;
  color: string;
}) {
  const [pos, setPos] = useState<{ y: number; h: number } | null>(null);

  const measure = useCallback(() => {
    if (!attr || !scrollRef.current) { setPos(null); return; }
    const el = scrollRef.current.querySelector(`[data-outline-pos="${attr}"]`) as HTMLElement | null;
    if (!el) { setPos(null); return; }
    const y = el.offsetTop;
    const h = el.offsetHeight;
    // Equality bail (task 317): the RO/MO pair below fires per frame of a
    // window or pane resize, and a fresh object literal re-rendered this
    // overlay every time even when the tracked row had not moved. Its sibling
    // (the focus band's `measure`) has always bailed; this one didn't.
    setPos((prev) => (prev && prev.y === y && prev.h === h ? prev : { y, h }));
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

/**
 * Inline label: shows existing label (click to edit) or a "+" on hover to create one.
 *
 * This is the PANEL-SIDE twin of the in-prose heading-label chrome
 * (`globals.css` `.heading-label-input` / `.heading-label-add` / the
 * `.heading-annotation` lozenge) — the same `\label{key}` on the same heading,
 * rendered in the Outline instead of the margin. So it takes the same tokens
 * (task 284): `--heading-annotation-color` for the key + its underline + the
 * "+" affordance, `--danger-muted` for the rename-conflict ink and border and
 * the ⚠ line, exactly as `.heading-label-input.has-conflict` and
 * `.heading-label-warning` do.
 *
 * It previously painted stock Tailwind `blue-500`/`blue-400` and a raw
 * `#b45757` — the one blue in either silo, and a hand-spelling of
 * `--footnote-500` used for an error. `--heading-annotation-color` is
 * user-themeable (Preferences › Editor › "Annotations displayed alongside
 * headings"), so the frozen blue also meant recolouring your heading
 * annotations moved the margin lozenge and left the Outline behind.
 */
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
              ? "text-danger-muted border-danger-muted"
              : "text-[var(--heading-annotation-color,#6b9ac4)] border-[var(--heading-annotation-color,#6b9ac4)]"
          }`}
          placeholder="label key"
        />
        {conflict && (
          <div className="text-[10px] text-danger-muted leading-tight mt-0.5">
            ⚠ label already in use
          </div>
        )}
      </>
    );
  }

  if (label) {
    return (
      <div
        className="text-[11px] text-[var(--heading-annotation-color,#6b9ac4)] leading-tight mt-0.5 truncate cursor-text hover:underline"
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
      className="text-[11px] text-[var(--heading-annotation-color,#6b9ac4)] leading-tight mt-0.5 pl-[1px] opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer select-none"
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
  /** Jump to a block. `null` is the Document-start row. Task 285: the address
   *  is a durable block uuid (+ a pre-hydration index fallback), never a bare
   *  snapshot index — see `@/lib/tiptap/block-address`. */
  onScrollTo: (target: BlockAddress | null) => void;
  /** Move `source` (a heading pod = its whole live section; a parTitle pod =
   *  that one block) to the `side` of `target`. Both ends are durable
   *  addresses; the landing index and both extents are resolved against the
   *  LIVE doc at apply time (task 285). */
  onReorderBlocks?: (
    source: BlockSpanAddress,
    target: BlockSpanAddress,
    side: "above" | "below",
  ) => void;
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
  /** Focus mode band — the UUID-anchored truth from `useFocusMode.band`, null
   *  when the feature isn't wired. The outline resolves it to index boundaries
   *  against its OWN `content` snapshot (`resolveFocusStateFromSnapshot`), so
   *  boundary + heading indices always share one revision (task 307). */
  focusBand?: FocusBand | null;
  /** Callbacks for focus mode. */
  onFocusActivate?: () => void;
  onFocusDeactivate?: () => void;
  onFocusToggleLock?: () => void;
  // Task 285: the focus band's three WRITE callbacks take a durable address
  // too. The engine already reads its heading list and total from the LIVE
  // doc, so the row index the outline handed over was the one stale input.
  onFocusMoveTo?: (target: BlockAddress) => void;
  onFocusExpandTo?: (target: BlockAddress) => void;
  onFocusSnapBoundary?: (edge: "top" | "bottom", target: BlockAddress) => void;
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
 * Resolve the UUID-anchored focus `band` to an index-based `FocusState`
 * **against the outline's own `content` snapshot** — the SAME revision that
 * `extractHeadings` reads, so the boundary indices and the heading indices can
 * never describe two different doc revisions.
 *
 * This is the outline's snapshot twin of `resolveFocusBand(doc, band)`
 * ([focus-view.ts]): identical semantics — `null` anchors are doc-start /
 * doc-end sentinels, a NAMED anchor missing from the snapshot degrades to
 * "no band → show everything" (never a phantom range), and crossed anchors
 * swap — but it walks `content.content` (top-level array index == the block
 * index `extractHeadings` records) instead of the live PM doc.
 *
 * WHY (task 307, the "mirror drifts from source on structural change" class,
 * task 126): the outline previously compared snapshot-fresh heading indices
 * against `useFocusMode.state`, whose index projection re-resolves ONLY on
 * `rev.blocks` while the outline snapshot refreshes on a 300ms catch-all tick.
 * Within that window the two clocks describe different revisions, so a
 * stale `endBlockIndex` + the inclusive boundary leaked the NEXT section into
 * the focused outline. Resolving the boundary from the outline's OWN snapshot
 * collapses them onto one revision — the editor plugin already does the live
 * equivalent against the live doc.
 *
 * Pure + O(top-level-count); called from a `useMemo` gated on
 * `[focusBand, content]`, never on the keystroke path (a plain keystroke
 * changes neither the band nor the snapshot).
 */
export function resolveFocusStateFromSnapshot(
  band: FocusBand | null | undefined,
  content: JSONContent | null,
): FocusState {
  if (!band || !band.active) return INACTIVE_FOCUS_STATE;
  const nodes = content?.content;
  if (!nodes || nodes.length === 0) return INACTIVE_FOCUS_STATE;
  const lastIdx = nodes.length - 1;

  let startIdx = band.startUuid == null ? 0 : -1;
  let endIdx = band.endUuid == null ? lastIdx : -1;

  if (startIdx === -1 || endIdx === -1) {
    for (let i = 0; i < nodes.length; i++) {
      const uuid = (nodes[i]?.attrs?.uuid as string | null | undefined) ?? null;
      if (uuid == null) continue;
      if (startIdx === -1 && uuid === band.startUuid) startIdx = i;
      if (endIdx === -1 && uuid === band.endUuid) endIdx = i;
    }
  }

  // A named anchor wasn't found in this snapshot → it died (or hasn't been
  // hydrated into this snapshot yet). Degrade to no band rather than honour a
  // phantom range — exactly as `resolveFocusBand` does on the live doc.
  if (startIdx === -1 || endIdx === -1) return INACTIVE_FOCUS_STATE;
  if (startIdx > endIdx) [startIdx, endIdx] = [endIdx, startIdx];
  return {
    active: true,
    locked: band.locked,
    startBlockIndex: startIdx,
    endBlockIndex: endIdx,
  };
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
  onScrollTo: (target: BlockAddress | null) => void;
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
  onFocusMoveTo?: (target: BlockAddress) => void;
  onFocusExpandTo?: (target: BlockAddress) => void;
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

  const handleRowClick = (target: BlockAddress) => (e: React.MouseEvent) => {
    if (isFocusEditing && onFocusMoveTo && onFocusExpandTo) {
      if (e.shiftKey) {
        onFocusExpandTo(target);
      } else {
        onFocusMoveTo(target);
      }
    } else {
      onScrollTo(target);
    }
  };

  return (
    <div>
      <div
        data-outline-pos={`h-${node.heading.index}`}
        className={`flex items-start group cursor-pointer rounded ${isFocusEditing ? "" : "hover-on-light"}`}
        style={{ paddingLeft: `${headingIndent(depth)}px`, paddingRight: 8, paddingTop: 4, paddingBottom: 4, gap: OUTLINE_ROW_GAP, opacity: dimOutsideFocus ? 0.3 : 1, transition: "opacity 200ms ease", position: "relative", zIndex: 5 }}
        onClick={handleRowClick({ uuid: node.heading.uuid, index: node.heading.index })}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.heading.id);
            }}
            /* Name only, no tooltip: the twisty sits under the pointer for the
               whole of a row hover, and a bubble there would cover the row it
               belongs to. Its `EditablePod` sibling below is a distinct
               control (it folds the POD) and keeps its hint. */
            aria-label={isCollapsed ? "Expand section" : "Collapse section"}
            className="mt-0.5 rounded text-[var(--muted)] hover:text-ink-body transition-colors shrink-0 flex items-center justify-center focus-ring"
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
                className={`cursor-pointer rounded text-[11px] text-[var(--par-title-color,#c45a5a)] truncate ${isFocusEditing ? "" : "hover-on-light"}`}
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
                onClick={handleRowClick({ uuid: pt.uuid, index: pt.index })}
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

/**
 * The durable address of a pod's own top-level block (task 285). A heading pod
 * owns its whole SECTION — `section: true` tells the resolver to re-derive that
 * extent from the live doc rather than trust the snapshot's `blockCount`; a
 * parTitle pod owns exactly its own block.
 */
function podAddress(pod: OutlinePod): BlockSpanAddress {
  return { uuid: pod.uuid, index: pod.blockIndex, section: pod.type === "heading" };
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

    // blockCount: from this heading to the next heading of same/higher level —
    // through the SHARED section rule (task 285), whose doc-side adapter the
    // reorder handler uses. The indicator paints from this snapshot copy and
    // the drop lands by the live one, so a second implementation here would be
    // a line that can lie about where the blocks go.
    const blockCount = sectionExtentFromHeadings(h.index, headings, totalBlocks);

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

// Memoized with pod-taking STABLE callbacks (no per-pod closures at the render
// site), so a dragover storm re-renders at most the pods whose isDragging /
// dropPosition actually flipped — not all N per event.
const EditablePod = memo(function EditablePod({
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
  onToggleCollapse: (podId: string) => void;
  onDragStart: (pod: OutlinePod, e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (podId: string, e: React.DragEvent) => void;
  onDragLeave: (podId: string) => void;
  onDrop: (podId: string, e: React.DragEvent) => void;
  onRename: (pod: OutlinePod, newText: string) => void;
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
      onRename(pod, trimmed);
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
      onDragOver={(e) => onDragOver(pod.id, e)}
      onDragLeave={() => onDragLeave(pod.id)}
      onDrop={(e) => onDrop(pod.id, e)}
    >
      {dropPosition === "above" && (
        <div className="absolute top-0 left-2 right-2 h-[2px] bg-[var(--accent)] rounded-full z-10 -translate-y-1/2" />
      )}
      <div
        draggable
        onDragStart={(e) => onDragStart(pod, e)}
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
              onToggleCollapse(pod.id);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="p-0.5 rounded text-[var(--muted)] hover:text-ink-body transition-colors shrink-0 focus-ring"
            {...iconHint({ label: isCollapsed ? "Expand" : "Collapse", pos: "above" })}
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
              isParTitle ? "text-[11px] text-[var(--par-title-color,#c45a5a)]" : "text-sm text-ink-strong"
            }`}
          />
        ) : (
          <span
            onClick={() => { setEditText(pod.text); setEditing(true); }}
            className={`flex-1 min-w-0 truncate cursor-text ${
              isParTitle
                ? "text-[11px] text-[var(--par-title-color,#c45a5a)]"
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
});

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
  onReorderBlocks: (
    source: BlockSpanAddress,
    target: BlockSpanAddress,
    side: "above" | "below",
  ) => void;
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
    // Custom ghost via the clamped-ghost SSOT: suppresses the native OS drag
    // image (so an upward drag toward the Virgil bar can't tear off / flip to
    // no-drop) and viewport-clamps the neutral row card. Palette via tokens.
    attachClampedDragGhost({
      dragStartEvent: e,
      buildGhost: () =>
        buildTextDragGhost(pod.text, {
          maxWidthPx: 200,
          padding: "4px 12px",
          radius: "var(--radius-md, 6px)",
          fontSizePx: 13,
          bg: "var(--surface, #ffffff)",
          border: "var(--edge-hover, #d6d3d1)",
          ink: "var(--ink-body, #44403c)",
          shadow: "0 2px 8px rgba(0,0,0,0.12)",
        }),
      cursorOffsetX: 10,
      cursorOffsetY: 14,
    });
  }, []);

  const handleDragOver = useCallback((podId: string, e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    // Determine above/below based on mouse position
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const position = e.clientY < midY ? "above" : "below";
    // Equality bail: HTML5 dragover fires uncoalesced at raw event rate, and
    // an unconditional fresh object here re-rendered every pod per event.
    // Returning the same reference lets React skip the render entirely, so a
    // hover only costs a rect read until the target actually changes.
    setDropTarget((prev) =>
      prev && prev.podId === podId && prev.position === position
        ? prev
        : { podId, position },
    );
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggingId(null);
    setDropTarget(null);
  }, []);

  const handleDragLeave = useCallback((podId: string) => {
    setDropTarget((prev) => (prev?.podId === podId ? null : prev));
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

    // Own-range rejection through the shared outline-drop helpers — the same
    // SNAPSHOT math the indicator paints from (task 114), so a hover the drop
    // will refuse lights nothing. It is the affordance half only: the handler
    // re-runs the same rejection against the live spans, which is what
    // actually protects the document (task 285).
    const targetBlockIndex = landingBlockIndex(targetPod, dropTarget.position);
    if (isRejectedDrop(sourcePod, targetPod, targetBlockIndex)) {
      setDraggingId(null);
      setDropTarget(null);
      return;
    }

    // Hand over DURABLE addresses, not the snapshot's integers. A heading pod
    // moves its whole section, so its extent is re-derived live at apply time;
    // the pod's own `blockCount` is as stale as its `blockIndex` and — under an
    // edit INSIDE the section — stale in a way no index fix would catch.
    onReorderBlocks(podAddress(sourcePod), podAddress(targetPod), dropTarget.position);
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
      <div className={PANEL.empty}>
        No sections yet. Type \section in the editor to add one.
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
          onToggleCollapse={onToggleCollapse}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onRename={handleRename}
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
  preambleTitles: ParTitleItem[];
  totalBlocks: number;
  onSnapBoundary?: (edge: "top" | "bottom", target: BlockAddress) => void;
}) {
  // The band's measured rectangle. Once a real measurement lands, we never
  // reset this to null — keeping the last good value avoids the flicker
  // where a transient querySelector miss (during reflows or row remounts)
  // would otherwise unmount the band entirely.
  const [band, setBand] = useState<{ top: number; height: number } | null>(null);
  // Whether to animate top/height. We disable transitions during drag so
  // the band tracks the cursor instead of trailing 200ms behind it.
  const [animated, setAnimated] = useState(true);

  // Whether an edge drag is live. The gesture itself (its snapshot, its
  // listeners, and its single end path) lives in useFocusBandEdgeDrag — this
  // ref is the one bit of it `measure()` needs to read, so the authoritative
  // rect can't clobber the transient one mid-drag. The hook owns every write.
  const isDraggingRef = useRef(false);

  // Minimum band height in pixels so a drag past the opposite edge clamps to a
  // thin band instead of inverting/collapsing (mirrors snapBoundary's 1-row
  // clamp in useFocusMode — CHIP E).
  const MIN_PX = 12;

  // Stable identity for outline row attrs, used both for measurement and as
  // the candidate set for drag snapping.
  // Each row carries its durable `uuid` alongside the snapshot index: the index
  // measures and matches WITHIN this snapshot (band rect, nearest-row snap),
  // and the uuid is what the single commit hands to the engine (task 285). The
  // Document-start row is deliberately uuid-less — "the first block" is a
  // positional fact, not an identity, and stays true under an insert above.
  const allRowAttrs = useMemo(() => {
    const attrs: { attr: string; blockIndex: number; uuid: string | null }[] = [];
    attrs.push({ attr: "docstart", blockIndex: 0, uuid: null });
    for (const pt of preambleTitles) {
      attrs.push({ attr: `pt-${pt.index}`, blockIndex: pt.index, uuid: pt.uuid });
    }
    for (const h of headings) {
      attrs.push({ attr: `h-${h.index}`, blockIndex: h.index, uuid: h.uuid });
      for (const pt of h.parTitles) {
        attrs.push({ attr: `pt-${pt.index}`, blockIndex: pt.index, uuid: pt.uuid });
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
    if (isDraggingRef.current) return;
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

  // Candidate snap rows, measured fresh at each mousedown. The drag never
  // changes row layout, so this one read serves the whole gesture — we keep
  // top/mid/bottom: `mid` for nearest-row snapping, `top`/`bottom` for the
  // transient rect.
  const measureRows = useCallback((): FocusBandRow[] => {
    const container = scrollRef.current;
    if (!container) return [];
    const rowMap = new Map<string, HTMLElement>();
    container.querySelectorAll<HTMLElement>("[data-outline-pos]").forEach((el) => {
      const attr = el.dataset.outlinePos;
      if (attr) rowMap.set(attr, el);
    });
    const rows: FocusBandRow[] = [];
    for (const r of allRowAttrs) {
      const el = rowMap.get(r.attr);
      if (!el) continue;
      const top = el.offsetTop;
      const bottom = el.offsetTop + el.offsetHeight;
      rows.push({ index: r.blockIndex, uuid: r.uuid, top, mid: top + el.offsetHeight / 2, bottom });
    }
    return rows;
  }, [scrollRef, allRowAttrs]);

  // The edge-drag gesture. Mid-drag is purely LOCAL (CHIP B): the rect is
  // driven from the mousedown snapshot via setBand — no parent state, no disk
  // — and the single onSnapBoundary commit happens on the end edge, so an
  // N-row drag = 1 state write + 1 re-render + 1 breadcrumb recompute (not N).
  // The hook also owns the two pointer invariants a released-but-unobserved
  // pointer would otherwise break (task 185).
  const { startDrag } = useFocusBandEdgeDrag({
    getScrollContainer: () => scrollRef.current,
    enabled: !!onSnapBoundary && !focusState.locked,
    measureRows,
    getBand: () => band,
    getRange: () => ({
      startBlockIndex: focusState.startBlockIndex,
      endBlockIndex: focusState.endBlockIndex,
    }),
    minPx: MIN_PX,
    setBand,
    setAnimated,
    restore: measure,
    setDragging: (dragging) => {
      isDraggingRef.current = dragging;
    },
    onSnapBoundary,
  });

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
          // The focus band is the app's "lit region" language, so it takes the
          // shared amber-highlight family rather than a private yellow (task
          // 284). `--amber-highlight-wash` is #fef3c3 against the retired
          // #fef9c3 — green alone, 6/255, and at opacity .55 over a white panel
          // that is 3.3/255 on screen.
          background: "var(--amber-highlight-wash)",
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
          // `--amber-highlight-edge` (= --amber-500, #d4a843) is the family's
          // stated "border + ring" rung. Against the retired #d4aa17 only RED
          // is identical: green moves 170 → 168 and blue 23 → 67, i.e. warmer
          // and a hair less saturated. At 1.5px and opacity .5 over the panel
          // that composites to a 22/255 move in blue alone.
          border: "1.5px solid var(--amber-highlight-edge)",
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
            border: "2px solid var(--pod-panel, #fffdfa)",
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
            border: "2px solid var(--pod-panel, #fffdfa)",
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

function OutlinePanel({ content, docId, onScrollTo, onReorderBlocks, onRenameHeading, onRenameParTitle, onUpdateLabel, isLabelTaken, activeSectionPath, activeParTitleIndex, focusBand, onFocusActivate, onFocusDeactivate, onFocusToggleLock, onFocusMoveTo, onFocusExpandTo, onFocusSnapBoundary }: OutlinePanelProps) {
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

  // Focus boundary resolved from the SAME `content` snapshot as `headings`
  // above, so the cull comparisons below (`heading.index` vs
  // `focusState.startBlockIndex/endBlockIndex`) never straddle two doc
  // revisions — the drift that leaked the next section into the focused
  // outline (task 307). Gated on `[focusBand, content]`, off the keystroke
  // path. Every downstream consumer (`OutlineNode`, `FocusBand` overlay,
  // position clamp) reads THIS `focusState`, not a prop.
  const focusState = useMemo(
    () => resolveFocusStateFromSnapshot(focusBand, content),
    [focusBand, content],
  );

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
    for (const h of headings) {
      // The section's end through the SHARED rule (task 285) — the FOURTH
      // copy, found by the adversarial pass on that fix. Display-only, so a
      // divergence here misreports a number rather than moving blocks; it is
      // still the copy a future edit to the rule would forget, on the same row
      // whose `blockCount` drives the drop indicator.
      const toIdx = h.index + sectionExtentFromHeadings(h.index, headings, totalBlocks);
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
          } focus-ring`}
          {...iconHint({ label: focusState.locked ? "Unlock focus" : "Lock focus" })}
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
        className="p-0.5 rounded-md text-[var(--muted)] hover:text-ink-body transition-colors focus-ring"
        {...iconHint({ label: "Expand all" })}
      >
        <svg width="12" height="9" viewBox="0 0 14 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 1 L7 4.5 L12 1" />
          <path d="M2 5.5 L7 9 L12 5.5" />
        </svg>
      </button>
      <button
        onClick={collapseAll}
        className="p-0.5 rounded-md text-[var(--muted)] hover:text-ink-body transition-colors focus-ring"
        {...iconHint({ label: "Collapse all" })}
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
                active section (#3), not a sliding bar. There is exactly ONE:
                the mirror pane's green edge bar retired with the editor split
                (task 115), where it had been painting Document-start with no
                mirror to track. */}
            {showPosition && (
              <PositionHighlight scrollRef={scrollRef} attr={posToAttr(pos1)} color="color-mix(in oklab, var(--accent) 13%, transparent)" />
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
                  // "Document start" is a POSITIONAL fact — whatever block is
                  // first — so it addresses index 0 with no uuid by design, and
                  // stays correct under an insert above (task 285).
                  if (focusState?.active && !focusState.locked && onFocusMoveTo) {
                    const docStart = { uuid: null, index: 0 };
                    if (e.shiftKey && onFocusExpandTo) onFocusExpandTo(docStart);
                    else onFocusMoveTo(docStart);
                  } else {
                    onScrollTo(null);
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
                      className={`cursor-pointer rounded text-[11px] text-[var(--par-title-color,#c45a5a)] truncate ${focusState?.active && !focusState.locked ? "" : "hover-on-light"}`}
                      style={{
                        paddingLeft: parTitleIndent(0), paddingRight: 8, paddingTop: 2, paddingBottom: 2,
                        opacity: ptDim ? 0.3 : 1,
                        transition: "opacity 200ms ease",
                        position: "relative",
                        zIndex: 5,
                      }}
                      onClick={(e) => {
                        const target = { uuid: pt.uuid, index: pt.index };
                        if (focusState?.active && !focusState.locked && onFocusMoveTo) {
                          if (e.shiftKey && onFocusExpandTo) onFocusExpandTo(target);
                          else onFocusMoveTo(target);
                        } else {
                          onScrollTo(target);
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
              <div className={PANEL.empty}>
                No sections yet. Type \section in the editor to add one.
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
