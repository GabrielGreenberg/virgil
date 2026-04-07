"use client";

import { useState, useMemo, useCallback, useRef, useEffect, memo } from "react";
import type { JSONContent } from "@tiptap/react";
import {
  type Category,
  ALL_CATEGORIES,
  CATEGORY_LABELS,
  useWordCountConfig,
} from "@/hooks/useWordCountConfig";

interface HeadingItem {
  id: string;
  level: number;
  text: string;
  label: string | null;
  index: number; // top-level block index in doc.content
  parTitles: { title: string; index: number }[]; // paragraph titles under this heading
}

interface OutlinePanelProps {
  content: JSONContent | null;
  onScrollTo: (headingIndex: number) => void;
  onReorderBlocks?: (fromIndex: number, count: number, toIndex: number) => void;
  onRenameHeading?: (blockIndex: number, newText: string) => void;
  onRenameParTitle?: (blockIndex: number, newTitle: string) => void;
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

function extractHeadings(doc: JSONContent | null): HeadingItem[] {
  if (!doc || !doc.content) return [];
  const headings: HeadingItem[] = [];
  let pendingTitles: { title: string; index: number }[] = [];

  doc.content.forEach((node, idx) => {
    if (node.type === "heading" && node.attrs?.level) {
      // Attach any pending parTitles to the previous heading. Titles
      // before the first heading are dropped — they belong to the
      // "Document start" region which has no editable outline row.
      if (pendingTitles.length > 0 && headings.length > 0) {
        headings[headings.length - 1].parTitles.push(...pendingTitles);
      }
      pendingTitles = [];
      headings.push({
        id: `heading-${idx}`,
        level: node.attrs.level as number,
        text: extractText(node) || "Untitled",
        label: (node.attrs.label as string) || null,
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
  if (pendingTitles.length > 0 && headings.length > 0) {
    headings[headings.length - 1].parTitles.push(...pendingTitles);
  }
  return headings;
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
function walkBlockJson(node: JSONContent): Record<Category, number> {
  const cats: Record<Category, string[]> = {
    mainText: [],
    headings: [],
    footnotes: [],
    blockquotes: [],
    lists: [],
    math: [],
    comments: [],
  };

  const collectInline = (n: JSONContent, bucket: string[]) => {
    if (n.type === "text" && n.text) {
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
        if (n.content) for (const child of n.content) walkBlock(child, "blockquotes");
        return;
      case "bulletList":
      case "orderedList":
        if (n.content) {
          const childCtx: Category = ctx === "blockquotes" ? "blockquotes" : "lists";
          for (const child of n.content) walkBlock(child, childCtx);
        }
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
function buildPerBlockCounts(doc: JSONContent | null): Record<Category, number>[] {
  if (!doc?.content) return [];
  return doc.content.map((node) => walkBlockJson(node));
}

function sumIncludedWords(
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
  sectionWordCount,
  perSectionCounts,
}: {
  node: TreeNode;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  onScrollTo: (index: number) => void;
  depth: number;
  showLabels: boolean;
  showTitles: boolean;
  showWordCount: boolean;
  sectionWordCount: number;
  perSectionCounts: Map<string, number>;
}) {
  const hasSubHeadings = node.children.length > 0;
  const hasTitles = showTitles && node.heading.parTitles.length > 0;
  const hasChildren = hasSubHeadings || hasTitles;
  const isCollapsed = collapsed.has(node.heading.id);

  return (
    <div>
      <div
        className="flex items-start gap-1 group cursor-pointer hover:bg-stone-50 rounded transition-colors"
        style={{ paddingLeft: `${depth * 16 + 8}px`, paddingRight: 8, paddingTop: 4, paddingBottom: 4 }}
        onClick={() => onScrollTo(node.heading.index)}
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
            {node.heading.text}
          </span>
          {showLabels && node.heading.label && (
            <div className="text-[11px] text-blue-500 leading-tight mt-0.5 truncate">
              {node.heading.label}
            </div>
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
          {node.heading.parTitles.map((pt, i) => (
            <div
              key={`pt-${i}`}
              className="cursor-pointer hover:bg-stone-50 rounded transition-colors text-[11px] text-[#c45a5a] truncate"
              style={{ paddingLeft: `${(depth + 1) * 16 + 24}px`, paddingRight: 8, paddingTop: 2, paddingBottom: 2 }}
              onClick={() => onScrollTo(pt.index)}
            >
              {pt.title}
            </div>
          ))}
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
              sectionWordCount={perSectionCounts.get(child.heading.id) ?? 0}
              perSectionCounts={perSectionCounts}
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
              isParTitle ? "text-[11px] text-[#c45a5a]" : "text-sm text-stone-800"
            }`}
          />
        ) : (
          <span
            onClick={() => { setEditText(pod.text); setEditing(true); }}
            className={`flex-1 min-w-0 truncate cursor-text ${
              isParTitle
                ? "text-[11px] text-[#c45a5a]"
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
        {!isParTitle && pod.blockCount > 1 && (
          <span className="text-[10px] text-stone-400 shrink-0">
            {pod.blockCount}
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
}

function loadOutlinePrefs(): OutlinePrefs {
  const defaults: OutlinePrefs = {
    collapsed: [],
    showLabels: true,
    showTitles: true,
    showWordCount: true,
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
) {
  try {
    localStorage.setItem(OUTLINE_STORAGE_KEY, JSON.stringify({
      collapsed: [...collapsed],
      showLabels,
      showTitles,
      showWordCount,
    }));
  } catch {}
}

/* ── Main OutlinePanel ─────────────────────────────────────────────── */

function OutlinePanel({ content, onScrollTo, onReorderBlocks, onRenameHeading, onRenameParTitle }: OutlinePanelProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showLabels, setShowLabels] = useState(true);
  const [showTitles, setShowTitles] = useState(true);
  const [showWordCount, setShowWordCount] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const { config: wcConfig, setInclude: setWcInclude } = useWordCountConfig();

  // Load persisted prefs on mount
  useEffect(() => {
    const saved = loadOutlinePrefs();
    setCollapsed(new Set(saved.collapsed));
    setShowLabels(saved.showLabels);
    setShowTitles(saved.showTitles);
    setShowWordCount(saved.showWordCount);
  }, []);

  // Mark initialized after first render with loaded state
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      return;
    }
    saveOutlinePrefs(collapsed, showLabels, showTitles, showWordCount);
  }, [collapsed, showLabels, showTitles, showWordCount]);

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

  const headings = useMemo(() => extractHeadings(content), [content]);
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
    <div className="w-full bg-[var(--background)] flex flex-col overflow-hidden h-full">
      <div className="px-4 border-b border-[var(--border)] h-[var(--header-h)] shrink-0 flex items-center justify-between bg-[var(--header-bg)]">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-stone-700">Outline</h3>
          {onReorderBlocks && (
            <button
              onClick={() => setEditMode(!editMode)}
              className={`text-[11px] px-2 py-0.5 rounded-md transition-colors ${
                editMode
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--muted)] hover:text-stone-600 hover:bg-stone-100"
              }`}
            >
              Edit
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
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="text-[var(--muted)] hover:text-stone-600 transition-colors p-0.5"
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
                <div className="border-t border-stone-100 my-1" />
                <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-[var(--muted)] font-medium">
                  Include in count
                </div>
                {ALL_CATEGORIES.map((cat) => {
                  const checked = wcConfig.include[cat];
                  return (
                    <button
                      key={cat}
                      onClick={() => setWcInclude(cat, !checked)}
                      className="w-full text-left px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50 flex items-center justify-between gap-3"
                    >
                      <span>{CATEGORY_LABELS[cat]}</span>
                      <span className="text-[var(--accent)]">{checked ? "✓" : ""}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {/* Fixed top row — always visible, both modes. Not draggable.
            Also acts as the column header for the word count column via
            the "words" label on the right. */}
        <div
          className="flex items-start gap-1 cursor-pointer hover:bg-stone-50 rounded transition-colors"
          style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4 }}
          onClick={() => onScrollTo(-1)}
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
        ) : tree.length === 0 ? (
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
              sectionWordCount={perSectionCounts.get(node.heading.id) ?? 0}
              perSectionCounts={perSectionCounts}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default memo(OutlinePanel);
