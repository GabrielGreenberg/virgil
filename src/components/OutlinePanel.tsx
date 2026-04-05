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

  // Always insert "Title" entry that scrolls to the top of the document
  headings.push({
    id: "heading-opening",
    level: 1,
    text: "Title",
    label: null,
    index: 0,
    parTitles: [],
    isImplicit: true,
  });

  for (const node of doc.content) {
    if (node.type === "heading" && node.attrs?.level) {
      if (!foundFirstHeading) {
        // Attach any paragraph titles before the first heading to "Title"
        headings[0].parTitles = pendingTitles;
        pendingTitles = [];
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

function OutlinePanel({ content, onScrollTo }: OutlinePanelProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showLabels, setShowLabels] = useState(true);
  const [showTitles, setShowTitles] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
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
      <div className="px-4 border-b border-[var(--border)] h-[var(--header-h)] shrink-0 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-stone-700">Outline</h3>
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
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
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
            />
          ))
        )}
      </div>
    </div>
  );
}

export default memo(OutlinePanel);
