"use client";

import { useState, useMemo, useCallback, useRef, useEffect, memo } from "react";
import type { JSONContent } from "@tiptap/react";

interface HeadingItem {
  id: string;
  level: number;
  text: string;
  label: string | null;
  index: number; // position in doc for scrolling
  parTitles: { title: string; index: number }[]; // paragraph titles under this heading
  isImplicit?: boolean; // true for the synthetic "Start" entry
}

interface OutlinePanelProps {
  content: JSONContent | null;
  onScrollTo: (headingIndex: number) => void;
  onReorderBlocks?: (fromIndex: number, count: number, toIndex: number) => void;
  onRenameHeading?: (blockIndex: number, newText: string) => void;
  onRenameParTitle?: (blockIndex: number, newTitle: string) => void;
}

function extractText(node: JSONContent): string {
  if (node.type === "text") return node.text || "";
  if (node.content) return node.content.map(extractText).join("");
  return "";
}

function extractHeadings(doc: JSONContent | null): HeadingItem[] {
  if (!doc || !doc.content) return [];
  const headings: HeadingItem[] = [];
  let idx = 0;
  let pendingTitles: { title: string; index: number }[] = [];
  let foundFirstHeading = false;

  // Extract document title from titleField nodes
  let docTitle = "";
  for (const node of doc.content) {
    if (node.type === "titleField" && node.attrs?.field === "title") {
      docTitle = extractText(node).trim();
      break;
    }
  }

  // Always insert the title entry at the top — scrolls to very top of document
  headings.push({
    id: "heading-title",
    level: 1,
    text: docTitle || "Untitled",
    label: null,
    index: -1, // sentinel: means "scroll to very top"
    parTitles: [],
    isImplicit: true,
  });

  for (const node of doc.content) {
    if (node.type === "heading" && node.attrs?.level) {
      if (!foundFirstHeading) {
        // Attach any pending parTitles to the title entry
        if (pendingTitles.length > 0) {
          headings[0].parTitles.push(...pendingTitles);
          pendingTitles = [];
        }
        foundFirstHeading = true;
      } else if (pendingTitles.length > 0) {
        headings[headings.length - 1].parTitles.push(...pendingTitles);
        pendingTitles = [];
      }
      headings.push({
        id: `heading-${idx}`,
        level: node.attrs.level as number,
        text: extractText(node) || "Untitled",
        label: (node.attrs.label as string) || null,
        index: idx,
        parTitles: [],
      });
    } else if ((node.type === "paragraph" || node.type === "bulletList" || node.type === "orderedList") && node.attrs?.parTitle) {
      pendingTitles.push({ title: node.attrs.parTitle as string, index: idx });
    }
    idx++;
  }
  // Attach any trailing paragraph titles to the last heading
  if (pendingTitles.length > 0 && headings.length > 0) {
    headings[headings.length - 1].parTitles.push(...pendingTitles);
  }
  return headings;
}

// Build a tree structure from flat headings
interface TreeNode {
  heading: HeadingItem;
  children: TreeNode[];
}

function buildTree(headings: HeadingItem[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const stack: TreeNode[] = [];

  for (const h of headings) {
    const node: TreeNode = { heading: h, children: [] };

    // Pop stack until we find a parent with a lower level
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

function OutlineNode({
  node,
  collapsed,
  onToggle,
  onScrollTo,
  depth,
  showLabels,
  showTitles,
}: {
  node: TreeNode;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  onScrollTo: (index: number) => void;
  depth: number;
  showLabels: boolean;
  showTitles: boolean;
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
        <div className="min-w-0">
          <span
            className={`text-sm leading-snug ${
              node.heading.isImplicit
                ? "text-stone-400"
                : node.heading.level === 1
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
}

function buildPods(headings: HeadingItem[], totalBlocks: number): OutlinePod[] {
  const pods: OutlinePod[] = [];
  // Skip the implicit title entry (index === -1)
  const realHeadings = headings.filter((h) => !h.isImplicit);

  for (let i = 0; i < realHeadings.length; i++) {
    const h = realHeadings[i];
    // blockCount: from this heading to the next heading of same or higher level
    let blockCount = 1;
    const nextSameOrHigher = realHeadings.find(
      (nh, ni) => ni > i && nh.level <= h.level
    );
    if (nextSameOrHigher) {
      blockCount = nextSameOrHigher.index - h.index;
    } else {
      blockCount = totalBlocks - h.index;
    }

    pods.push({
      type: "heading",
      level: h.level,
      text: h.text,
      blockIndex: h.index,
      blockCount,
      id: h.id,
    });

    // Add parTitle pods under this heading
    for (const pt of h.parTitles) {
      pods.push({
        type: "parTitle",
        level: 4,
        text: pt.title,
        blockIndex: pt.index,
        blockCount: 1,
        id: `pt-${pt.index}`,
      });
    }
  }

  return pods;
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
  onReorderBlocks,
  onRenameHeading,
  onRenameParTitle,
}: {
  headings: HeadingItem[];
  totalBlocks: number;
  onReorderBlocks: (fromIndex: number, count: number, toIndex: number) => void;
  onRenameHeading: (blockIndex: number, newText: string) => void;
  onRenameParTitle: (blockIndex: number, newTitle: string) => void;
}) {
  const pods = useMemo(() => buildPods(headings, totalBlocks), [headings, totalBlocks]);
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
      {pods.map((pod) => (
        <EditablePod
          key={pod.id}
          pod={pod}
          isDragging={draggingId === pod.id}
          dropPosition={
            dropTarget?.podId === pod.id ? dropTarget.position : null
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

function loadOutlinePrefs(): { collapsed: string[]; showLabels: boolean; showTitles: boolean } {
  if (typeof window === "undefined") return { collapsed: [], showLabels: true, showTitles: true };
  try {
    const raw = localStorage.getItem(OUTLINE_STORAGE_KEY);
    if (!raw) return { collapsed: [], showLabels: true, showTitles: true };
    return JSON.parse(raw);
  } catch {
    return { collapsed: [], showLabels: true, showTitles: true };
  }
}

function saveOutlinePrefs(collapsed: Set<string>, showLabels: boolean, showTitles: boolean) {
  try {
    localStorage.setItem(OUTLINE_STORAGE_KEY, JSON.stringify({
      collapsed: [...collapsed],
      showLabels,
      showTitles,
    }));
  } catch {}
}

/* ── Main OutlinePanel ─────────────────────────────────────────────── */

function OutlinePanel({ content, onScrollTo, onReorderBlocks, onRenameHeading, onRenameParTitle }: OutlinePanelProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showLabels, setShowLabels] = useState(true);
  const [showTitles, setShowTitles] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  // Load persisted prefs on mount
  useEffect(() => {
    const saved = loadOutlinePrefs();
    setCollapsed(new Set(saved.collapsed));
    setShowLabels(saved.showLabels);
    setShowTitles(saved.showTitles);
  }, []);

  // Mark initialized after first render with loaded state
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      return;
    }
    saveOutlinePrefs(collapsed, showLabels, showTitles);
  }, [collapsed, showLabels, showTitles]);

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

  const totalBlocks = useMemo(() => {
    if (!content || !content.content) return 0;
    return content.content.length;
  }, [content]);

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
        <h3 className="text-sm font-semibold text-stone-700">Outline</h3>
        <div className="flex items-center gap-2">
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
          {!editMode && (
            <>
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
                  <div className="absolute right-0 top-full mt-1 bg-white border border-[var(--border)] rounded-lg shadow-lg py-1 z-30 min-w-[140px]">
                    <button
                      className="w-full text-left px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50 flex items-center justify-between gap-3"
                      onClick={() => { setShowLabels(!showLabels); setMenuOpen(false); }}
                    >
                      <span>Show labels</span>
                      <span className="text-[var(--accent)]">{showLabels ? "✓" : ""}</span>
                    </button>
                    <button
                      className="w-full text-left px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50 flex items-center justify-between gap-3"
                      onClick={() => { setShowTitles(!showTitles); setMenuOpen(false); }}
                    >
                      <span>Show par. titles</span>
                      <span className="text-[var(--accent)]">{showTitles ? "✓" : ""}</span>
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {editMode && onReorderBlocks && onRenameHeading && onRenameParTitle ? (
          <EditableOutline
            headings={headings}
            totalBlocks={totalBlocks}
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
            />
          ))
        )}
      </div>
    </div>
  );
}

export default memo(OutlinePanel);
