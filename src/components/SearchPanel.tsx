"use client";

import { useState, useMemo, useCallback, useRef, useEffect, memo } from "react";
import type { Editor } from "@tiptap/react";
import { panelCard, PANEL } from "./panel-primitives";

/* ── Types ──────────────────────────────────────────────────────────── */

interface SearchResult {
  from: number;
  to: number;
  /** ~40 chars before the match */
  before: string;
  /** The matched text */
  match: string;
  /** ~40 chars after the match */
  after: string;
  /** Breadcrumb path: section hierarchy above the match */
  breadcrumb: string[];
}

interface SearchPanelProps {
  editor: Editor | null;
  onHighlightRange: (range: { from: number; to: number } | null) => void;
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

const CTX = 40; // context chars on each side

/** Build breadcrumb by walking doc nodes up to a position. */
function buildBreadcrumb(editor: Editor, pos: number): string[] {
  const crumbs: string[] = [];
  editor.state.doc.descendants((node, nodePos) => {
    if (nodePos >= pos) return false;
    if (node.type.name === "heading") {
      const level = node.attrs.level as number;
      const text =
        node.textContent?.trim() || "Untitled";
      // Prune deeper headings when a higher-level heading appears
      while (crumbs.length > 0 && crumbs.length >= level) crumbs.pop();
      crumbs.push(text);
    }
    return true;
  });
  return crumbs;
}

/* ── Component ───────────────────────────────────────────────────────── */

function SearchPanel({ editor, onHighlightRange }: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  /* ── Search results (memoised) ────────────────────────────────────── */

  const results: SearchResult[] = useMemo(() => {
    if (!editor || !query) return [];

    const docText = editor.state.doc.textBetween(
      0,
      editor.state.doc.content.size,
      "\n",
    );

    // Escape regex special chars
    let pattern = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (wholeWord) pattern = `\\b${pattern}\\b`;
    const flags = caseSensitive ? "g" : "gi";
    let re: RegExp;
    try {
      re = new RegExp(pattern, flags);
    } catch {
      return [];
    }

    const matches: SearchResult[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(docText)) !== null) {
      const matchStart = m.index;
      const matchEnd = matchStart + m[0].length;

      // Context
      const before = docText.slice(Math.max(0, matchStart - CTX), matchStart);
      const after = docText.slice(matchEnd, matchEnd + CTX);

      // Map text offset → ProseMirror position
      let pmFrom = 0;
      let pmTo = 0;
      let textOffset = 0;
      let foundFrom = false;
      let foundTo = false;

      editor.state.doc.descendants((node, nodePos) => {
        if (foundTo) return false;
        if (node.isText) {
          const len = (node.text || "").length;
          if (!foundFrom && textOffset + len > matchStart) {
            pmFrom = nodePos + (matchStart - textOffset);
            foundFrom = true;
          }
          if (!foundTo && textOffset + len >= matchEnd) {
            pmTo = nodePos + (matchEnd - textOffset);
            foundTo = true;
          }
          textOffset += len;
        } else if (node.isBlock && textOffset > 0) {
          textOffset += 1; // \n separator
        }
        return true;
      });

      if (foundFrom && foundTo) {
        matches.push({
          from: pmFrom,
          to: pmTo,
          before,
          match: m[0],
          after,
          breadcrumb: buildBreadcrumb(editor, pmFrom),
        });
      }
    }

    return matches;
  }, [editor, query, caseSensitive, wholeWord]);

  // Reset selection and clear highlight when results change
  useEffect(() => {
    setSelectedIdx(null);
    onHighlightRange(null);
  }, [results, onHighlightRange]);

  /* ── Navigation ──────────────────────────────────────────────────── */

  const navigateToResult = useCallback(
    (result: SearchResult, idx: number) => {
      if (!editor) return;
      setSelectedIdx(idx);

      // Highlight the match in the editor (position-based)
      onHighlightRange({ from: result.from, to: result.to });

      // Scroll the card into view in the panel list
      requestAnimationFrame(() => {
        const card = listRef.current?.querySelector(
          `[data-result-idx="${idx}"]`,
        );
        card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    },
    [editor, onHighlightRange],
  );

  const goNext = useCallback(() => {
    if (results.length === 0) return;
    const next =
      selectedIdx === null ? 0 : (selectedIdx + 1) % results.length;
    navigateToResult(results[next], next);
  }, [results, selectedIdx, navigateToResult]);

  const goPrev = useCallback(() => {
    if (results.length === 0) return;
    const prev =
      selectedIdx === null
        ? results.length - 1
        : (selectedIdx - 1 + results.length) % results.length;
    navigateToResult(results[prev], prev);
  }, [results, selectedIdx, navigateToResult]);

  /* ── Keyboard handlers ───────────────────────────────────────────── */

  const handleNavKeys = useCallback(
    (e: React.KeyboardEvent) => {
      if (results.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "Enter") {
        e.preventDefault();
        goNext();
      }
    },
    [results, goNext, goPrev],
  );

  /* ── Counter text ────────────────────────────────────────────────── */

  const counterText = useMemo(() => {
    if (!query) return null;
    if (results.length === 0) return "0 results";
    if (selectedIdx === null) return `${results.length} results`;
    return `${selectedIdx + 1} of ${results.length}`;
  }, [query, results.length, selectedIdx]);

  /* ── Render ──────────────────────────────────────────────────────── */

  return (
    <div className="w-full bg-[var(--background)] flex flex-col overflow-hidden h-full">
      {/* Header with counter + nav arrows */}
      <div className={`${PANEL.header} flex items-center justify-between`}>
        <h3 className="text-sm font-semibold text-stone-700">Search</h3>
        {counterText && (
          <div className="flex items-center gap-1">
            <span className="text-xs text-[var(--muted)] tabular-nums mr-1">
              {counterText}
            </span>
            <button
              onClick={goPrev}
              disabled={results.length === 0}
              className="p-0.5 rounded text-[var(--muted)] hover:text-stone-600 hover:bg-stone-100 transition-colors disabled:opacity-30"
              title="Previous match (Up)"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="18 15 12 9 6 15" />
              </svg>
            </button>
            <button
              onClick={goNext}
              disabled={results.length === 0}
              className="p-0.5 rounded text-[var(--muted)] hover:text-stone-600 hover:bg-stone-100 transition-colors disabled:opacity-30"
              title="Next match (Down)"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Search input + toggles */}
      <div className="px-3 py-2 border-b border-[var(--border)] flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleNavKeys}
          placeholder="Find in document..."
          className="flex-1 text-sm bg-transparent outline-none placeholder:text-stone-400"
        />
        <button
          onClick={() => setCaseSensitive((v) => !v)}
          className={`text-[10px] font-bold px-1.5 py-0.5 rounded border transition-colors ${
            caseSensitive
              ? "border-[var(--accent)] text-[var(--accent)] bg-amber-50/60"
              : "border-stone-300 text-stone-400 hover:text-stone-600"
          }`}
          title="Match case"
        >
          Aa
        </button>
        <button
          onClick={() => setWholeWord((v) => !v)}
          className={`text-[10px] font-bold px-1.5 py-0.5 rounded border transition-colors ${
            wholeWord
              ? "border-[var(--accent)] text-[var(--accent)] bg-amber-50/60"
              : "border-stone-300 text-stone-400 hover:text-stone-600"
          }`}
          title="Whole word"
        >
          W
        </button>
      </div>

      {/* Results list */}
      <div
        ref={listRef}
        className={PANEL.list}
        tabIndex={0}
        onKeyDown={handleNavKeys}
        style={{ outline: "none" }}
      >
        {!query && (
          <p className={PANEL.empty}>Type to search your document.</p>
        )}
        {query && results.length === 0 && (
          <p className={PANEL.empty}>No matches found.</p>
        )}
        {results.map((r, i) => (
          <button
            key={`${r.from}-${i}`}
            data-result-idx={i}
            className={`${panelCard(selectedIdx === i)} w-full text-left`}
            onClick={() => {
              navigateToResult(r, i);
              listRef.current?.focus();
            }}
          >
            <div className={PANEL.cardInner}>
              {r.breadcrumb.length > 0 && (
                <div className="text-[10px] text-[var(--muted)] truncate mb-1">
                  {r.breadcrumb.join(" \u203a ")}
                </div>
              )}
              <div className="text-sm text-stone-700 leading-snug break-words">
                {r.before.length > 0 && (
                  <span className="text-stone-400">
                    {r.before.length === CTX ? "\u2026" : ""}
                    {r.before}
                  </span>
                )}
                <mark className="bg-amber-200/80 text-stone-800 rounded-sm px-px">
                  {r.match}
                </mark>
                {r.after.length > 0 && (
                  <span className="text-stone-400">
                    {r.after}
                    {r.after.length === CTX ? "\u2026" : ""}
                  </span>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export default memo(SearchPanel);
