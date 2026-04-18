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
export type SectionPathEntry = { text: string; index: number };

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

  useEffect(() => { measure(); }, [measure]);

  // Remeasure on container resize or any child layout changes (e.g. focus
  // mode toggling position/z-index on rows shifts offsetTop values).
  useEffect(() => {
    if (!scrollRef.current) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(scrollRef.current);
    const mo = new MutationObserver(() => requestAnimationFrame(measure));
    mo.observe(scrollRef.current, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
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
function InlineLabel({ label, onCommit }: { label: string | null; onCommit: (value: string | null) => void }) {
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

  if (editing) {
    return (
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
        className="text-[11px] text-blue-500 leading-tight mt-0.5 bg-transparent outline-none border-b border-blue-400 w-full"
        placeholder="label key"
      />
    );
  }

  if (label) {
    return (
      <div
        className="text-[11px] text-blue-500 leading-tight mt-0.5 truncate cursor-text hover:underline"
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        title="Click to edit label"
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
    if (node.type === "heading" && node.attrs?.level) {
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
        className={`flex items-start gap-1 group cursor-pointer rounded transition-colors ${isFocusEditing ? "" : "hover:bg-stone-50"}`}
        style={{ paddingLeft: `${depth * 16 + 8}px`, paddingRight: 8, paddingTop: 4, paddingBottom: 4, opacity: isOutsideFocus ? 0.3 : 1, transition: "opacity 200ms ease", position: isOutsideFocus ? undefined : "relative", zIndex: isOutsideFocus ? undefined : 5 }}
        onClick={handleRowClick(node.heading.index)}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.heading.id);
            }}
            className="mt-0.5 p-0.5 rounded text-[var(--muted)] hover:text-stone-600 transition-colors shrink-0"
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
              node.heading.level === 1
                ? "font-semibold text-stone-800"
                : node.heading.level === 2
                  ? "font-medium text-stone-700"
                  : "text-stone-600"
            }`}
          >
            {showNumbers && node.heading.sectionNumber && (
              <span className="text-stone-400 font-normal">{node.heading.sectionNumber}{"\u00a0\u00a0"}</span>
            )}
            {node.heading.text}
          </span>
          {showLabels && onUpdateLabel && (
            <InlineLabel
              label={node.heading.label}
              onCommit={(val) => onUpdateLabel(node.heading.index, val)}
            />
          )}
        </div>
        {showWordCount && (
          <span className="text-[10px] tabular-nums text-stone-400 shrink-0 mt-0.5">
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
                className={`cursor-pointer rounded transition-colors text-[11px] text-[#857070] truncate ${isFocusEditing ? "" : "hover:bg-stone-50"}`}
                style={{
                  paddingLeft: `${(depth + 1) * 16 + 24}px`,
                  paddingRight: 8,
                  paddingTop: 2,
                  paddingBottom: 2,
                  opacity: ptOutside ? 0.3 : 1,
                  transition: "opacity 200ms ease",
                  position: ptOutside ? undefined : "relative",
                  zIndex: ptOutside ? undefined : 5,
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
            ? "opacity-30 border-stone-300 bg-stone-100"
            : isParTitle
              ? "border-stone-200 bg-white hover:border-stone-300"
              : "border-stone-200 bg-white hover:border-stone-300 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
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
            className="p-0.5 rounded text-[var(--muted)] hover:text-stone-600 transition-colors shrink-0"
            title={isCollapsed ? "Expand" : "Collapse"}
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
              isParTitle ? "text-[11px] text-[#857070]" : "text-sm text-stone-800"
            }`}
          />
        ) : (
          <span
            onClick={() => { setEditText(pod.text); setEditing(true); }}
            className={`flex-1 min-w-0 truncate cursor-text ${
              isParTitle
                ? "text-[11px] text-[#857070]"
                : pod.level === 1
                  ? "text-sm font-semibold text-stone-800"
                  : pod.level === 2
                    ? "text-sm font-medium text-stone-700"
                    : "text-sm text-stone-600"
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
  totalBlocks,
  onSnapBoundary,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  focusState: FocusState;
  headings: HeadingItem[];
  preambleTitles: { title: string; index: number }[];
  totalBlocks: number;
  onSnapBoundary?: (edge: "top" | "bottom", blockIndex: number) => void;
}) {
  const [band, setBand] = useState<{ top: number; height: number } | null>(null);
  const draggingRef = useRef<{ edge: "top" | "bottom" } | null>(null);

  // Collect all outline row block indices for resolving drag targets
  const allRowAttrs = useMemo(() => {
    const attrs: { attr: string; blockIndex: number }[] = [];
    // docstart represents block 0
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

  // Measure band position from DOM
  const measure = useCallback(() => {
    if (!scrollRef.current) return;
    const container = scrollRef.current;

    // Find the first outline row >= startBlockIndex
    let topEl: HTMLElement | null = null;
    let botEl: HTMLElement | null = null;

    for (const r of allRowAttrs) {
      if (r.blockIndex >= focusState.startBlockIndex && !topEl) {
        topEl = container.querySelector(`[data-outline-pos="${r.attr}"]`) as HTMLElement | null;
      }
      if (r.blockIndex >= focusState.startBlockIndex && r.blockIndex <= focusState.endBlockIndex) {
        botEl = container.querySelector(`[data-outline-pos="${r.attr}"]`) as HTMLElement | null;
      }
    }

    if (!topEl || !botEl) { setBand(null); return; }
    const top = topEl.offsetTop;
    const height = botEl.offsetTop + botEl.offsetHeight - top;
    setBand({ top, height });
  }, [scrollRef, allRowAttrs, focusState.startBlockIndex, focusState.endBlockIndex]);

  useEffect(() => { measure(); }, [measure]);

  // Remeasure on resize
  useEffect(() => {
    if (!scrollRef.current) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(scrollRef.current);
    return () => ro.disconnect();
  }, [scrollRef, measure]);

  // Handle drag
  useEffect(() => {
    if (!onSnapBoundary || focusState.locked) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current || !scrollRef.current) return;
      const container = scrollRef.current;
      const rect = container.getBoundingClientRect();
      const y = e.clientY - rect.top + container.scrollTop;

      // Find closest outline row
      let closest: { blockIndex: number; dist: number } | null = null;
      for (const r of allRowAttrs) {
        if (r.blockIndex < 0) continue;
        const el = container.querySelector(`[data-outline-pos="${r.attr}"]`) as HTMLElement | null;
        if (!el) continue;
        const mid = el.offsetTop + el.offsetHeight / 2;
        const dist = Math.abs(y - mid);
        if (!closest || dist < closest.dist) {
          closest = { blockIndex: r.blockIndex, dist };
        }
      }
      if (closest) {
        onSnapBoundary(draggingRef.current.edge, closest.blockIndex);
      }
    };

    const handleMouseUp = () => {
      draggingRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [onSnapBoundary, focusState.locked, scrollRef, allRowAttrs]);

  const startDrag = (edge: "top" | "bottom") => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = { edge };
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
  };

  if (!band) return null;

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
          transition: "top 200ms ease, height 200ms ease",
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
          transition: "top 200ms ease, height 200ms ease",
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
            transition: "top 200ms ease",
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
            transition: "top 200ms ease",
            boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
          }}
        />
      )}
    </>
  );
}

/* ── Main OutlinePanel ─────────────────────────────────────────────── */

function OutlinePanel({ content, onScrollTo, onReorderBlocks, onRenameHeading, onRenameParTitle, onUpdateLabel, activeSectionPath, activeParTitleIndex, editorSplit, mirrorSectionPath, mirrorParTitleIndex, focusState, onFocusActivate, onFocusDeactivate, onFocusToggleLock, onFocusMoveTo, onFocusExpandTo, onFocusSnapBoundary }: OutlinePanelProps) {
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

  return (
    <div className="w-full bg-transparent flex flex-col overflow-hidden h-full">
      <div className="px-4 border-b border-[var(--border)] h-[var(--header-h)] shrink-0 flex items-center justify-between bg-[var(--header-bg)]">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-stone-700">Outline</h3>
          {onReorderBlocks && (
            <button
              onClick={() => { if (focusState?.active) return; setEditMode(!editMode); }}
              className={`text-[11px] px-2 py-0.5 rounded-md transition-colors ${
                editMode
                  ? "bg-[var(--accent)] text-white"
                  : focusState?.active
                    ? "text-stone-300 cursor-not-allowed"
                    : "text-[var(--muted)] hover:text-stone-600 hover:bg-stone-100"
              }`}
              title={focusState?.active ? "Exit Focus to use Edit" : undefined}
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
                    ? "text-stone-300 cursor-not-allowed"
                    : "text-[var(--muted)] hover:text-stone-600 hover:bg-stone-100"
              }`}
              title={editMode ? "Exit Edit to use Focus" : focusState?.active ? "Exit Focus mode" : "Enter Focus mode"}
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
                  : "text-[var(--muted)] hover:text-stone-600"
              }`}
              title={focusState.locked ? "Unlock focus (adjust selection)" : "Lock focus (hide other content)"}
            >
              {focusState.locked ? (
                /* Locked: closed shackle, filled body */
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
                  <path d="M5 7V5a3 3 0 0 1 6 0v2" />
                  <circle cx="8" cy="10.5" r="1" fill="var(--header-bg)" stroke="none" />
                </svg>
              ) : (
                /* Unlocked: same shackle shifted left — right leg in body, left leg free */
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="7" width="10" height="7" rx="1.5" />
                  <path d="M1 7V5a3 3 0 0 1 6 0v2" />
                </svg>
              )}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={expandAll}
            className="text-[var(--muted)] hover:text-stone-600 transition-colors"
            title="Expand all"
          >
            <svg width="14" height="12" viewBox="0 0 14 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 1 L7 4.5 L12 1" />
              <path d="M2 6.5 L7 10 L12 6.5" />
            </svg>
          </button>
          <button
            onClick={collapseAll}
            className="text-[var(--muted)] hover:text-stone-600 transition-colors"
            title="Collapse all"
            style={{ marginTop: "-2px" }}
          >
            <svg width="14" height="10" viewBox="0 0 14 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 5.5 L7 2 L12 5.5" />
              <path d="M2 9 L7 5.5 L12 9" />
            </svg>
          </button>
          <div className="relative -mr-1" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-1 rounded text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors"
              title="View options"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <circle cx="8" cy="3" r="1.5" />
                <circle cx="8" cy="8" r="1.5" />
                <circle cx="8" cy="13" r="1.5" />
              </svg>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-[var(--border)] rounded-lg shadow-lg py-1 z-30 min-w-[180px]">
                <button
                  className="w-full text-left px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50 flex items-center justify-between gap-3"
                  onClick={() => { setShowNumbers(!showNumbers); }}
                >
                  <span>Show section numbers</span>
                  <span className="text-[var(--accent)]">{showNumbers ? "✓" : ""}</span>
                </button>
                <button
                  className="w-full text-left px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50 flex items-center justify-between gap-3"
                  onClick={() => { setShowLabels(!showLabels); }}
                >
                  <span>Show labels</span>
                  <span className="text-[var(--accent)]">{showLabels ? "✓" : ""}</span>
                </button>
                <button
                  className="w-full text-left px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50 flex items-center justify-between gap-3"
                  onClick={() => { setShowTitles(!showTitles); }}
                >
                  <span>Show par. titles</span>
                  <span className="text-[var(--accent)]">{showTitles ? "✓" : ""}</span>
                </button>
                <button
                  className="w-full text-left px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50 flex items-center justify-between gap-3"
                  onClick={() => { setShowWordCount(!showWordCount); }}
                >
                  <span>Show word count</span>
                  <span className="text-[var(--accent)]">{showWordCount ? "✓" : ""}</span>
                </button>
                <button
                  className="w-full text-left px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50 flex items-center justify-between gap-3"
                  onClick={() => { setShowPosition(!showPosition); }}
                >
                  <span>Show current position</span>
                  <span className="text-[var(--accent)]">{showPosition ? "✓" : ""}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

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
          <div className="bg-white rounded-lg border border-stone-200 pt-3 pb-5 px-1 relative min-h-full">
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
              className={`flex items-start gap-1 cursor-pointer rounded transition-colors ${focusState?.active && !focusState.locked ? "" : "hover:bg-stone-50"}`}
              style={{
                paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4,
                opacity: focusState?.active && headings.length > 0 && (0 < focusState.startBlockIndex || 0 > focusState.endBlockIndex) ? 0.3 : 1,
                transition: "opacity 200ms ease",
                position: focusState?.active && !(0 < focusState.startBlockIndex || 0 > focusState.endBlockIndex) ? "relative" : undefined,
                zIndex: focusState?.active && !(0 < focusState.startBlockIndex || 0 > focusState.endBlockIndex) ? 5 : undefined,
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
                    <span className="font-normal text-stone-400">Title: </span>
                    <span className="font-semibold text-stone-800">{docTitle}</span>
                  </>
                ) : (
                  <span className="italic text-stone-400">Document start</span>
                )}
              </div>
              {showWordCount && (
                <span className="text-[10px] text-stone-400 shrink-0 mt-0.5">
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
                      className={`cursor-pointer rounded transition-colors text-[11px] text-[#857070] truncate ${focusState?.active && !focusState.locked ? "" : "hover:bg-stone-50"}`}
                      style={{
                        paddingLeft: 40, paddingRight: 8, paddingTop: 2, paddingBottom: 2,
                        opacity: ptOutside ? 0.3 : 1,
                        transition: "opacity 200ms ease",
                        position: ptOutside ? undefined : "relative",
                        zIndex: ptOutside ? undefined : 5,
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
                  focusState={focusState}
                  onFocusMoveTo={onFocusMoveTo}
                  onFocusExpandTo={onFocusExpandTo}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(OutlinePanel);
