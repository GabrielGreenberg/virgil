"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Editor } from "@tiptap/react";
import { PanelHeader, PANEL, panelCard } from "./panel-primitives";

interface SearchResult {
  from: number;
  to: number;
  fragment: string;
  matchStart: number;
  matchLen: number;
  /** Breadcrumb path: section > subsection > par title */
  path: string[];
}

interface SearchPanelProps {
  editor: Editor | null;
}

const CONTEXT_CHARS = 40;

/**
 * Build a map of ProseMirror positions to section breadcrumb paths
 * by walking the document's top-level nodes (headings + parTitles).
 */
function buildSectionMap(editor: Editor): { pos: number; path: string[] }[] {
  const sections: { pos: number; path: string[] }[] = [];
  const headingStack: { level: number; text: string }[] = [];
  let currentParTitle: string | null = null;

  editor.state.doc.forEach((node, offset) => {
    if (node.type.name === "heading") {
      const level = node.attrs.level as number;
      const text = node.textContent || "Untitled";
      // Pop headings of equal or deeper level
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, text });
      currentParTitle = null;
      sections.push({ pos: offset, path: headingStack.map((h) => h.text) });
    } else {
      const parTitle = node.attrs?.parTitle as string | null;
      if (parTitle) {
        currentParTitle = parTitle;
      }
      const path = [
        ...headingStack.map((h) => h.text),
        ...(currentParTitle ? [currentParTitle] : []),
      ];
      sections.push({ pos: offset, path });
    }
  });
  return sections;
}

function getPathForPos(sections: { pos: number; path: string[] }[], pos: number): string[] {
  let best: string[] = [];
  for (const s of sections) {
    if (s.pos <= pos) best = s.path;
    else break;
  }
  return best;
}

export default function SearchPanel({ editor }: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Clear highlight when query changes or panel unmounts
  useEffect(() => {
    return () => {
      if (editor) {
        editor.chain().selectAll().unsetHighlight().run();
      }
    };
  }, [editor]);

  const results: SearchResult[] = useMemo(() => {
    if (!editor || !query) return [];

    const sectionMap = buildSectionMap(editor);
    const matches: SearchResult[] = [];

    // Build full plain text and position map
    const textParts: { text: string; pos: number }[] = [];
    let fullText = "";

    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text) {
        textParts.push({ text: node.text, pos });
        fullText += node.text;
      } else if (node.isBlock && fullText.length > 0 && !fullText.endsWith("\n")) {
        textParts.push({ text: "\n", pos: -1 });
        fullText += "\n";
      }
      return true;
    });

    // Search through the full text
    let searchText = fullText;
    let searchQuery = query;
    if (!caseSensitive) {
      searchText = fullText.toLowerCase();
      searchQuery = query.toLowerCase();
    }

    let searchFrom = 0;
    while (searchFrom < searchText.length) {
      const idx = searchText.indexOf(searchQuery, searchFrom);
      if (idx === -1) break;

      // Whole word check
      if (wholeWord) {
        const before = idx > 0 ? fullText[idx - 1] : " ";
        const after = idx + query.length < fullText.length ? fullText[idx + query.length] : " ";
        if (/\w/.test(before) || /\w/.test(after)) {
          searchFrom = idx + 1;
          continue;
        }
      }

      // Convert text offset to ProseMirror position
      let charOffset = 0;
      let fromPos = -1;
      let toPos = -1;

      for (const part of textParts) {
        const partEnd = charOffset + part.text.length;
        if (fromPos === -1 && idx >= charOffset && idx < partEnd) {
          if (part.pos === -1) break;
          fromPos = part.pos + (idx - charOffset);
        }
        if (fromPos !== -1 && toPos === -1) {
          const endIdx = idx + query.length;
          if (endIdx <= partEnd) {
            if (part.pos === -1) break;
            toPos = part.pos + (endIdx - charOffset);
          }
        }
        charOffset = partEnd;
        if (toPos !== -1) break;
      }

      if (fromPos !== -1 && toPos !== -1) {
        // Extract context fragment
        const ctxStart = Math.max(0, idx - CONTEXT_CHARS);
        const ctxEnd = Math.min(fullText.length, idx + query.length + CONTEXT_CHARS);
        const fragment = fullText.slice(ctxStart, ctxEnd).replace(/\n/g, " ");
        const matchStart = idx - ctxStart;

        // Add ellipsis
        let prefix = "";
        let suffix = "";
        if (ctxStart > 0) prefix = "\u2026";
        if (ctxEnd < fullText.length) suffix = "\u2026";

        matches.push({
          from: fromPos,
          to: toPos,
          fragment: prefix + fragment + suffix,
          matchStart: matchStart + prefix.length,
          matchLen: query.length,
          path: getPathForPos(sectionMap, fromPos),
        });
      }

      searchFrom = idx + 1;
    }

    return matches;
  }, [editor, query, caseSensitive, wholeWord]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIdx(null);
    // Clear any previous highlight when search changes
    if (editor) {
      editor.chain().selectAll().unsetHighlight().run();
    }
  }, [results, editor]);

  const navigateToResult = useCallback(
    (result: SearchResult, idx: number) => {
      if (!editor) return;
      setSelectedIdx(idx);

      // Clear previous highlight, apply new one, then position cursor
      editor
        .chain()
        .selectAll()
        .unsetHighlight()
        .setTextSelection({ from: result.from, to: result.to })
        .setHighlight({ color: "#fbbf2480" })
        .setTextSelection(result.from)
        .run();

      // Scroll into view
      const domAtPos = editor.view.domAtPos(result.from);
      const el =
        domAtPos.node instanceof HTMLElement
          ? domAtPos.node
          : domAtPos.node.parentElement;
      el?.scrollIntoView({ behavior: "instant", block: "center" });
    },
    [editor],
  );

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (results.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = selectedIdx === null ? 0 : Math.min(selectedIdx + 1, results.length - 1);
        setSelectedIdx(next);
        navigateToResult(results[next], next);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = selectedIdx === null ? results.length - 1 : Math.max(selectedIdx - 1, 0);
        setSelectedIdx(prev);
        navigateToResult(results[prev], prev);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (selectedIdx !== null) {
          navigateToResult(results[selectedIdx], selectedIdx);
        } else if (results.length > 0) {
          navigateToResult(results[0], 0);
        }
      }
    },
    [results, selectedIdx, navigateToResult],
  );

  return (
    <div className="w-full bg-[var(--background)] flex flex-col overflow-hidden h-full">
      <PanelHeader title="Search" count={query ? results.length : undefined} />

      {/* Search input + options */}
      <div className="px-3 py-2 border-b border-[var(--border)] space-y-2">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search in document..."
          className="w-full px-2.5 py-1.5 text-sm rounded-md border border-stone-200 bg-white
                     focus:outline-none focus:border-stone-400 focus:ring-1 focus:ring-stone-300
                     placeholder:text-stone-400"
        />
        <div className="flex items-center gap-3 text-xs text-stone-500">
          <label className="flex items-center gap-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(e) => setCaseSensitive(e.target.checked)}
              className="rounded border-stone-300 text-stone-600 focus:ring-stone-400
                         w-3.5 h-3.5"
            />
            Match case
          </label>
          <label className="flex items-center gap-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={wholeWord}
              onChange={(e) => setWholeWord(e.target.checked)}
              className="rounded border-stone-300 text-stone-600 focus:ring-stone-400
                         w-3.5 h-3.5"
            />
            Whole word
          </label>
        </div>
      </div>

      {/* Results list */}
      <div ref={listRef} className={PANEL.list}>
        {query && results.length === 0 && (
          <p className={PANEL.empty}>No matches found.</p>
        )}
        {results.map((r, i) => (
          <button
            key={`${r.from}-${i}`}
            className={`${panelCard(selectedIdx === i)} w-full text-left cursor-pointer`}
            onClick={() => navigateToResult(r, i)}
          >
            <div className={`${PANEL.cardInner} py-2`}>
              {r.path.length > 0 && (
                <p className="text-[10px] leading-tight text-stone-400 mb-1 truncate">
                  {r.path.join(" \u203A ")}
                </p>
              )}
              <p className="text-xs leading-relaxed text-stone-600 break-words">
                {r.fragment.slice(0, r.matchStart)}
                <mark className="bg-amber-200/80 text-stone-900 rounded-sm px-0.5">
                  {r.fragment.slice(r.matchStart, r.matchStart + r.matchLen)}
                </mark>
                {r.fragment.slice(r.matchStart + r.matchLen)}
              </p>
            </div>
          </button>
        ))}
        {!query && (
          <p className={PANEL.empty}>Type to search through your document.</p>
        )}
      </div>
    </div>
  );
}
