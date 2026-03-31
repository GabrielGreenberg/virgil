"use client";

import { useState, useMemo, useCallback, memo } from "react";
import type { JSONContent } from "@tiptap/react";

interface HeadingItem {
  id: string;
  level: number;
  text: string;
  index: number; // position in doc for scrolling
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
  for (const node of doc.content) {
    if (node.type === "heading" && node.attrs?.level) {
      headings.push({
        id: `heading-${idx}`,
        level: node.attrs.level as number,
        text: extractText(node) || "Untitled",
        index: idx,
      });
    }
    idx++;
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
}: {
  node: TreeNode;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  onScrollTo: (index: number) => void;
  depth: number;
}) {
  const hasChildren = node.children.length > 0;
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
      </div>

      {hasChildren && !isCollapsed && (
        <div>
          {node.children.map((child) => (
            <OutlineNode
              key={child.heading.id}
              node={child}
              collapsed={collapsed}
              onToggle={onToggle}
              onScrollTo={onScrollTo}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function OutlinePanel({ content, onScrollTo }: OutlinePanelProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

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
    setCollapsed(new Set(headings.filter((h) => {
      // Collapse any heading that has a child with a higher level number
      const idx = headings.indexOf(h);
      return idx < headings.length - 1 && headings[idx + 1].level > h.level;
    }).map((h) => h.id)));
  }, [headings]);

  const expandAll = useCallback(() => {
    setCollapsed(new Set());
  }, []);

  return (
    <div className="w-full bg-[var(--background)] flex flex-col overflow-hidden h-full">
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
        <h3 className="text-sm font-semibold text-stone-700">Outline</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={expandAll}
            className="text-[10px] text-[var(--muted)] hover:text-stone-600 transition-colors"
            title="Expand all"
          >
            Expand
          </button>
          <button
            onClick={collapseAll}
            className="text-[10px] text-[var(--muted)] hover:text-stone-600 transition-colors"
            title="Collapse all"
          >
            Collapse
          </button>
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
            />
          ))
        )}
      </div>
    </div>
  );
}

export default memo(OutlinePanel);
