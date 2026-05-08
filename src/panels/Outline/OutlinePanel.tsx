"use client";

import { useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect, memo } from "react";
import type { JSONContent } from "@tiptap/react";
import {
  type Category,
  ALL_CATEGORIES,
  useWordCountConfig,
} from "@/hooks/useWordCountConfig";
import type { FocusState } from "@/hooks/useFocusMode";
import { sectionRange } from "@/hooks/useFocusMode";
import { Panel } from "@/panels/_shared/Panel";

interface HeadingItem {
  id: string;
  level: number;
  text: string;
  label: string | null;
  sectionNumber: string | null;
  index: number; // top-level block index in doc.content
  parTitles: { title: string; index: number }[]; // paragraph titles under this heading
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

/** Thin lozenge that slides along the left gutter of the outline. */
function PositionLozenge({ scrollRef, attr, color }: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  attr: string | null;
  color: string;
}) {
  const [pos, setPos] = useState<{ y: number; h: number } | null>(null);

  const measure = useCallback(() => {
    if (!attr || !scrollRef.current) { setPos(null); return; }
    const el = scrollRef.current.querySelector(`[data-outline-pos="${attr}"]`) as HTMLElement | null;
    if (!el) { setPos(null); return; }
    setPos({ y: el.offsetTop, h: el.offsetHeight });
  }, [attr, scrollRef]);

  // Run before paint so the lozenge lands on the right pixel without a
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

  return (
    <div
      style={{
        position: "absolute",
        left: 5,
        top: 0,
        width: 3,
        borderRadius: 1.5,
        background: color,
        opacity: 0.7,
        transform: `translateY(${pos.y}px)`,
        height: pos.h,
        transition: "transform 250ms ease-out, height 250ms ease-out, opacity 200ms ease",
        pointerEvents: "none",
        zIndex: 10,
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
        title="Click to edit label"
        data-helper="Edit label"
        data-helper-pos="above"
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
      title="Add label"
      data-helper="Add label"
      data-helper-pos="above"
    >
      +
    </span>
  );
}

interface OutlinePanelProps {
  content: JSONContent | null;
  onScrollTo: (headingIndex: number) => void;
  onReorderBlocks?: (fromIndex: number, count: number, toIndex: number) => void;
  onRenameHeading?: (blockIndex: number, newText: string) => void;
  onRenameParTitle?: (blockIndex: number, newTitle: string) => void;
  onUpdateLabel?: (blockIndex: number, newLabel: string | null) => void;
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

function extractText(node: JSONContent): string {
  if (node.type === "text") return node.text || "";
  if (node.content) return node.content.map(extractText).join("");
  return "";
}

function getDocTitle(doc: JSONContent | null): string {
  if (!doc?.content) return "";
  for (const node of doc.content) {
    if (node.type === "titleField" && node.attrs?.field === "title") {
      return extractText(node).trim();
    }
  }
  return "";
}

interface ExtractResult {
  headings: HeadingItem[];
  /** Par titles that appear before the first heading (Document start region). */
  preambleTitles: { title: string; index: number }[];
}

export function extractHeadings(doc: JSONContent | null): ExtractResult {
  if (!doc || !doc.content) return { headings: [], preambleTitles: [] };
  const headings: HeadingItem[] = [];
  let pendingTitles: { title: string; index: number }[] = [];
  const preambleTitles: { title: string; index: number }[] = [];

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
      headings.push({
        id: `heading-${idx}`,
        level: node.attrs.level as number,
        text: extractText(node) || "Untitled",
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
      pendingTitles.push({ title: node.attrs.parTitle as string, index: idx });
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

/* ── Per-section word counting (view mode) ─────────────────────────── */

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Walk a single top-level JSONContent block and bucket its text by category.
 * Mirrors the PmNode walker in useWordCount.ts so the per-section outline
 * counts and the panel-level totals stay in agreement.
 */
/**
 * Extract plain text from `\caption{...}` commands inside raw LaTeX strings.
 * Handles nested braces.
 */
function extractCaptionText(raw: string): string[] {
  const results: string[] = [];
  let i = 0;
  while (i < raw.length) {
    const idx = raw.indexOf("\\caption", i);
    if (idx === -1) break;
    let pos = idx + "\\caption".length;
    if (pos < raw.length && raw[pos] === "*") pos++;
    if (pos < raw.length && raw[pos] === "[") {
      const close = raw.indexOf("]", pos);
      if (close !== -1) pos = close + 1;
    }
    if (pos < raw.length && raw[pos] === "{") {
      let depth = 1;
      const start = pos + 1;
      pos++;
      while (pos < raw.length && depth > 0) {
        if (raw[pos] === "\\" && pos + 1 < raw.length) { pos += 2; continue; }
        if (raw[pos] === "{") depth++;
        else if (raw[pos] === "}") depth--;
        if (depth > 0) pos++;
      }
      if (depth === 0) {
        const inner = raw.slice(start, pos);
        const plain = inner
          .replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])*\{([^}]*)\}/g, "$2")
          .replace(/\\[a-zA-Z]+\*?/g, "")
          .replace(/[{}]/g, "")
          .trim();
        if (plain) results.push(plain);
      }
    }
    i = pos + 1;
  }
  return results;
}

function walkBlockJson(node: JSONContent): Record<Category, number> {
  const cats: Record<Category, string[]> = {
    mainText: [],
    headings: [],
    footnotes: [],
    captions: [],
    math: [],
    comments: [],
  };

  const collectInline = (n: JSONContent, bucket: string[]) => {
    if (n.type === "text" && n.text) {
      // Text marked as latexCommand is raw LaTeX — not prose.
      // Extract any \caption{...} text into captions, skip the rest.
      if (n.marks?.some((m) => m.type === "latexCommand")) {
        const capts = extractCaptionText(n.text);
        for (const c of capts) cats.captions.push(c);
        return;
      }
      bucket.push(n.text);
      return;
    }
    if (n.type === "inlineMath") {
      const latex = (n.attrs?.latex as string) || "";
      if (latex) cats.math.push(latex);
      return;
    }
    if (n.type === "citation") return;
    if (n.type === "footnote") {
      const content = (n.attrs?.content as string) || "";
      if (content) cats.footnotes.push(content);
      return;
    }
    if (n.type === "hardBreak") {
      bucket.push(" ");
      return;
    }
    if (n.content) {
      for (const child of n.content) collectInline(child, bucket);
    }
  };

  const walkBlock = (n: JSONContent, ctx: Category) => {
    switch (n.type) {
      case "heading":
        collectInline(n, cats.headings);
        return;
      case "blockquote":
        if (n.content) for (const child of n.content) walkBlock(child, ctx);
        return;
      case "bulletList":
      case "orderedList":
        if (n.content) for (const child of n.content) walkBlock(child, ctx);
        return;
      case "listItem":
        if (n.content) for (const child of n.content) walkBlock(child, ctx);
        return;
      case "displayMath": {
        const latex = (n.attrs?.latex as string) || "";
        if (latex) cats.math.push(latex);
        return;
      }
      case "latexComment": {
        const text = (n.attrs?.text as string) || "";
        if (text) cats.comments.push(text);
        return;
      }
      case "paragraph":
      case "codeBlock":
        collectInline(n, cats[ctx]);
        return;
      default:
        if (n.content && n.content.length > 0) {
          for (const child of n.content) walkBlock(child, ctx);
        }
        return;
    }
  };

  walkBlock(node, "mainText");

  const out = {} as Record<Category, number>;
  for (const cat of ALL_CATEGORIES) {
    out[cat] = countWords(cats[cat].join(" "));
  }
  return out;
}

/**
 * Precompute per-block category word counts so per-heading section sums
 * are O(blocks) instead of O(blocks × headings).
 */
export function buildPerBlockCounts(doc: JSONContent | null): Record<Category, number>[] {
  if (!doc?.content) return [];
  return doc.content.map((node) => walkBlockJson(node));
}

export function sumIncludedWords(
  perBlock: Record<Category, number>[],
  fromIdx: number,
  toIdx: number, // exclusive
  include: Record<Category, boolean>,
): number {
  let total = 0;
  for (let i = fromIdx; i < toIdx; i++) {
    const counts = perBlock[i];
    if (!counts) continue;
    for (const cat of ALL_CATEGORIES) {
      if (include[cat]) total += counts[cat];
    }
  }
  return total;
}

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
  onUpdateLabel?: (blockIndex: number, newLabel: string | null) => void;
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
  const isOutsideFocus = focusState?.active
    ? node.heading.index < focusState.startBlockIndex || node.heading.index > focusState.endBlockIndex
    : false;

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
        className={`flex items-start gap-1 group cursor-pointer rounded ${isFocusEditing ? "" : "hover-on-light"}`}
        style={{ paddingLeft: `${depth * 16 + 8}px`, paddingRight: 8, paddingTop: 4, paddingBottom: 4, opacity: isOutsideFocus ? 0.3 : 1, transition: "opacity 200ms ease", position: "relative", zIndex: 5 }}
        onClick={handleRowClick(node.heading.index)}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.heading.id);
            }}
            className="mt-0.5 p-0.5 rounded text-[var(--muted)] hover:text-ink-body transition-colors shrink-0"
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
          <span className="w-4 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <span
            className={`text-sm leading-snug ${
              node.heading.level <= 1
                ? "font-semibold text-ink-strong"
                : node.heading.level === 2
                  ? "font-medium text-ink-body"
                  : "text-ink-body"
            }`}
          >
            {showNumbers && node.heading.sectionNumber && (
              <span className="text-ink-muted font-normal">{node.heading.sectionNumber}{"\u00a0\u00a0"}</span>
            )}
            {node.heading.text}
          </span>
          {showLabels && onUpdateLabel && (
            <InlineLabel
              label={node.heading.label}
              onCommit={(val) => onUpdateLabel(node.heading.index, val)}
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
            return (
              <div
                key={`pt-${i}`}
                data-outline-pos={`pt-${pt.index}`}
                className={`cursor-pointer rounded text-[11px] text-[#857070] truncate ${isFocusEditing ? "" : "hover-on-light"}`}
                style={{
                  paddingLeft: `${(depth + 1) * 16 + 24}px`,
                  paddingRight: 8,
                  paddingTop: 2,
                  paddingBottom: 2,
                  opacity: ptOutside ? 0.3 : 1,
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
  blockIndex: number;   // top-level block index in doc.content
  blockCount: number;   // how many top-level blocks this pod covers
  id: string;
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
        id: `pt-${pt.index}`,
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

  const indent = pod.type === "parTitle"
    ? (3 * 16 + 8) // parTitles indent at level 4
    : ((pod.level - 1) * 16 + 8);

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
            title={isCollapsed ? "Expand" : "Collapse"}
            data-helper={isCollapsed ? "Expand" : "Collapse"}
            data-helper-pos="above"
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
  onRenameHeading: (blockIndex: number, newText: string) => void;
  onRenameParTitle: (blockIndex: number, newTitle: string) => void;
}) {
  const pods = useMemo(() => buildPods(headings, totalBlocks), [headings, totalBlocks]);
  const hiddenIds = useMemo(() => computeHiddenPods(pods, collapsed), [pods, collapsed]);
  const visiblePods = useMemo(() => pods.filter((p) => !hiddenIds.has(p.id)), [pods, hiddenIds]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ podId: string; position: "above" | "below" } | null>(null);

  const handleDragStart = useCallback((pod: OutlinePod, e: React.DragEvent) => {
    setDraggingId(pod.id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", pod.id);
    // Custom ghost
    const ghost = document.createElement("div");
    ghost.textContent = pod.text;
    ghost.style.cssText = "position:fixed;top:-1000px;padding:4px 12px;background:#fff;border:1px solid #d6d3d1;border-radius:6px;font-size:13px;color:#44403c;box-shadow:0 2px 8px rgba(0,0,0,0.12);max-width:200px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;";
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

    // Compute the target block index
    let targetBlockIndex: number;
    if (dropTarget.position === "above") {
      targetBlockIndex = targetPod.blockIndex;
    } else {
      targetBlockIndex = targetPod.blockIndex + targetPod.blockCount;
    }

    // Don't drop within source's own range
    if (targetBlockIndex > sourcePod.blockIndex && targetBlockIndex < sourcePod.blockIndex + sourcePod.blockCount) {
      setDraggingId(null);
      setDropTarget(null);
      return;
    }

    onReorderBlocks(sourcePod.blockIndex, sourcePod.blockCount, targetBlockIndex);
    setDraggingId(null);
    setDropTarget(null);
  }, [draggingId, dropTarget, pods, onReorderBlocks]);

  const handleRename = useCallback((pod: OutlinePod, newText: string) => {
    if (pod.type === "heading") {
      onRenameHeading(pod.blockIndex, newText);
    } else {
      onRenameParTitle(pod.blockIndex, newText);
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
            dropTarget?.podId === pod.id ? dropTarget.position : null
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

/* ── Storage ───────────────────────────────────────────────────────── */

const OUTLINE_STORAGE_KEY = "virgil-outline-prefs";

interface OutlinePrefs {
  collapsed: string[];
  showLabels: boolean;
  showTitles: boolean;
  showWordCount: boolean;
  showPosition: boolean;
  showNumbers: boolean;
}

function loadOutlinePrefs(): OutlinePrefs {
  const defaults: OutlinePrefs = {
    collapsed: [],
    showLabels: true,
    showTitles: true,
    showWordCount: true,
    showPosition: true,
    showNumbers: false,
  };
  if (typeof window === "undefined") return defaults;
  try {
    const raw = localStorage.getItem(OUTLINE_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<OutlinePrefs>;
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

function saveOutlinePrefs(
  collapsed: Set<string>,
  showLabels: boolean,
  showTitles: boolean,
  showWordCount: boolean,
  showPosition: boolean,
  showNumbers: boolean,
) {
  try {
    localStorage.setItem(OUTLINE_STORAGE_KEY, JSON.stringify({
      collapsed: [...collapsed],
      showLabels,
      showTitles,
      showWordCount,
      showPosition,
      showNumbers,
    }));
  } catch {}
}

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
  // start, plus the last index we reported (so we only call onSnapBoundary
  // when the closest row actually changes).
  const dragRef = useRef<{
    edge: "top" | "bottom";
    rows: { blockIndex: number; mid: number }[];
    lastIdx: number;
  } | null>(null);

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
  // mousemove. Throttle with requestAnimationFrame and only call back when
  // the snapped row index actually changes.
  useEffect(() => {
    if (!onSnapBoundary || focusState.locked) return;

    let rafScheduled = false;
    let lastY = 0;

    const flush = () => {
      rafScheduled = false;
      const drag = dragRef.current;
      if (!drag) return;
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < drag.rows.length; i++) {
        const dist = Math.abs(lastY - drag.rows[i].mid);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      }
      if (bestIdx !== drag.lastIdx) {
        drag.lastIdx = bestIdx;
        onSnapBoundary(drag.edge, drag.rows[bestIdx].blockIndex);
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
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setAnimated(true);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [onSnapBoundary, focusState.locked, scrollRef]);

  const startDrag = (edge: "top" | "bottom") => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const container = scrollRef.current;
    if (!container) return;
    // Snapshot row mids once. Drag doesn't change row layout, so we never
    // need to re-read the DOM during the drag itself.
    const rowMap = new Map<string, HTMLElement>();
    container.querySelectorAll<HTMLElement>("[data-outline-pos]").forEach((el) => {
      const attr = el.dataset.outlinePos;
      if (attr) rowMap.set(attr, el);
    });
    const rows: { blockIndex: number; mid: number }[] = [];
    for (const r of allRowAttrs) {
      const el = rowMap.get(r.attr);
      if (!el) continue;
      rows.push({ blockIndex: r.blockIndex, mid: el.offsetTop + el.offsetHeight / 2 });
    }
    dragRef.current = { edge, rows, lastIdx: -1 };
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
          borderRadius: 6,
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
          borderRadius: 6,
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

function OutlinePanel({ content, onScrollTo, onReorderBlocks, onRenameHeading, onRenameParTitle, onUpdateLabel, isLabelTaken, activeSectionPath, activeParTitleIndex, editorSplit, mirrorSectionPath, mirrorParTitleIndex, focusState, onFocusActivate, onFocusDeactivate, onFocusToggleLock, onFocusMoveTo, onFocusExpandTo, onFocusSnapBoundary }: OutlinePanelProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showLabels, setShowLabels] = useState(true);
  const [showTitles, setShowTitles] = useState(true);
  const [showWordCount, setShowWordCount] = useState(true);
  const [showPosition, setShowPosition] = useState(true);
  const [showNumbers, setShowNumbers] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  // Per-section counts inherit the shared Word Count config — the
  // outline view menu no longer exposes category toggles of its own.
  const { config: wcConfig } = useWordCountConfig();

  // Load persisted prefs on mount
  useEffect(() => {
    const saved = loadOutlinePrefs();
    setCollapsed(new Set(saved.collapsed));
    setShowLabels(saved.showLabels);
    setShowTitles(saved.showTitles);
    setShowWordCount(saved.showWordCount);
    setShowPosition(saved.showPosition);
    setShowNumbers(saved.showNumbers);
  }, []);

  // Mark initialized after first render with loaded state
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      return;
    }
    saveOutlinePrefs(collapsed, showLabels, showTitles, showWordCount, showPosition, showNumbers);
  }, [collapsed, showLabels, showTitles, showWordCount, showPosition, showNumbers]);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

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
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Resolve where each pane's position chevron should appear, accounting
  // for collapsed sections (chevron bubbles up to the visible ancestor).
  // When focus is active, clamp the position to the focused range so the
  // indicator never sits on a grayed-out section.
  const clampToFocus = useCallback((pos: ResolvedPosition | null): ResolvedPosition | null => {
    if (!pos || !focusState?.active) return pos;
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

  const collapseAll = useCallback(() => {
    setCollapsed(new Set(headings.filter((h, i) => {
      const hasSubHeading = i < headings.length - 1 && headings[i + 1].level > h.level;
      const hasTitles = showTitles && h.parTitles.length > 0;
      return hasSubHeading || hasTitles;
    }).map((h) => h.id)));
  }, [headings, showTitles]);

  const expandAll = useCallback(() => {
    setCollapsed(new Set());
  }, []);

  const headerLeading = (
    <div className="relative -ml-3" ref={menuRef}>
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="p-0.5 text-ink-muted hover:text-ink-body transition-colors"
        title="View options"
        data-helper="View options"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="8" cy="3" r="1.5" />
          <circle cx="8" cy="8" r="1.5" />
          <circle cx="8" cy="13" r="1.5" />
        </svg>
      </button>
      {menuOpen && (
        <div className="absolute left-0 top-full mt-1 bg-surface border border-[var(--border)] rounded-lg shadow-lg py-1 z-30 min-w-[180px]">
          <button
            className="w-full text-left px-3 py-1.5 text-xs text-ink-body hover-on-light flex items-center justify-between gap-3"
            onClick={() => { setShowNumbers(!showNumbers); }}
          >
            <span>Show section numbers</span>
            <span className="text-[var(--accent)]">{showNumbers ? "✓" : ""}</span>
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-xs text-ink-body hover-on-light flex items-center justify-between gap-3"
            onClick={() => { setShowLabels(!showLabels); }}
          >
            <span>Show labels</span>
            <span className="text-[var(--accent)]">{showLabels ? "✓" : ""}</span>
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-xs text-ink-body hover-on-light flex items-center justify-between gap-3"
            onClick={() => { setShowTitles(!showTitles); }}
          >
            <span>Show par. titles</span>
            <span className="text-[var(--accent)]">{showTitles ? "✓" : ""}</span>
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-xs text-ink-body hover-on-light flex items-center justify-between gap-3"
            onClick={() => { setShowWordCount(!showWordCount); }}
          >
            <span>Show word count</span>
            <span className="text-[var(--accent)]">{showWordCount ? "✓" : ""}</span>
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-xs text-ink-body hover-on-light flex items-center justify-between gap-3"
            onClick={() => { setShowPosition(!showPosition); }}
          >
            <span>Show current position</span>
            <span className="text-[var(--accent)]">{showPosition ? "✓" : ""}</span>
          </button>
        </div>
      )}
    </div>
  );

  const headerTitleAfter = (
    <div className="flex items-center gap-2">
      {onReorderBlocks && (
        <button
          onClick={() => { if (focusState?.active) return; setEditMode(!editMode); }}
          className={`text-[11px] px-2 py-0.5 rounded-md transition-colors ${
            editMode
              ? "bg-[var(--accent)] text-white"
              : focusState?.active
                ? "text-ink-faint cursor-not-allowed"
                : "text-[var(--muted)] hover:text-ink-body hover-on-light"
          }`}
          title={focusState?.active ? "Exit Focus to use Edit" : undefined}
          data-helper="Edit mode"
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
          className={`text-[11px] px-2 py-0.5 rounded-md transition-colors ${
            focusState?.active
              ? "bg-[var(--accent)] text-white"
              : editMode
                ? "text-ink-faint cursor-not-allowed"
                : "text-[var(--muted)] hover:text-ink-body hover-on-light"
          }`}
          title={editMode ? "Exit Edit to use Focus" : focusState?.active ? "Exit Focus mode" : "Enter Focus mode"}
          data-helper="Focus mode"
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
          title={focusState.locked ? "Unlock focus (adjust selection)" : "Lock focus (hide other content)"}
          data-helper={focusState.locked ? "Unlock focus" : "Lock focus"}
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
    </div>
  );

  return (
    <Panel
      kind="outline"
      headerLeading={headerLeading}
      headerTitleAfter={headerTitleAfter}
      variant="raw"
    >
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-1 relative">
        <div className="absolute top-2.5 left-3 z-10 flex items-center gap-1">
          <button
            onClick={expandAll}
            className="text-[var(--muted)] hover:text-ink-body transition-colors"
            title="Expand all"
            data-helper="Expand all"
          >
            <svg width="11" height="8" viewBox="0 0 14 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 1 L7 4.5 L12 1" />
              <path d="M2 5.5 L7 9 L12 5.5" />
            </svg>
          </button>
          <button
            onClick={collapseAll}
            className="text-[var(--muted)] hover:text-ink-body transition-colors"
            title="Collapse all"
            data-helper="Collapse all"
          >
            <svg width="11" height="8" viewBox="0 0 14 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 4.5 L7 1 L12 4.5" />
              <path d="M2 9 L7 5.5 L12 9" />
            </svg>
          </button>
        </div>
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
          <div className="bg-surface rounded-lg border border-edge-subtle pt-3 pb-5 px-1 relative min-h-full">
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
            {/* Position lozenge(s) — absolutely positioned, slides to current row */}
            {showPosition && (
              <>
                <PositionLozenge scrollRef={scrollRef} attr={posToAttr(pos1)} color="var(--footnote-color, #b45757)" />
                {isSplit && <PositionLozenge scrollRef={scrollRef} attr={posToAttr(pos2)} color="#5b8a72" />}
              </>
            )}

            {/* Fixed top row — document start / title */}
            <div
              data-outline-pos="docstart"
              className={`flex items-start gap-1 cursor-pointer rounded ${focusState?.active && !focusState.locked ? "" : "hover-on-light"}`}
              style={{
                paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4,
                opacity: focusState?.active && headings.length > 0 && (0 < focusState.startBlockIndex || 0 > focusState.endBlockIndex) ? 0.3 : 1,
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
              <span className="w-4 shrink-0" />
              <div className="min-w-0 flex-1 text-sm leading-snug truncate">
                {docTitle ? (
                  <>
                    <span className="font-normal text-ink-muted">Title: </span>
                    <span className="font-semibold text-ink-strong">{docTitle}</span>
                  </>
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

            {showTitles && preambleTitles.length > 0 && (
              <div>
                {preambleTitles.map((pt, i) => {
                  const ptOutside = focusState?.active
                    ? pt.index < focusState.startBlockIndex || pt.index > focusState.endBlockIndex
                    : false;
                  return (
                    <div
                      key={`preamble-pt-${i}`}
                      data-outline-pos={`pt-${pt.index}`}
                      className={`cursor-pointer rounded text-[11px] text-[#857070] truncate ${focusState?.active && !focusState.locked ? "" : "hover-on-light"}`}
                      style={{
                        paddingLeft: 40, paddingRight: 8, paddingTop: 2, paddingBottom: 2,
                        opacity: ptOutside ? 0.3 : 1,
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
