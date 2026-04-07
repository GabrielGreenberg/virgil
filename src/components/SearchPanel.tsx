"use client";

import { useState, useMemo, useCallback, useRef, useEffect, memo } from "react";
import type { Editor } from "@tiptap/react";
import { panelCard, PANEL, PanelHeader, PrevNextCounter } from "./panel-primitives";

/* ── Types ──────────────────────────────────────────────────────────── */

type BreadcrumbSegment = {
  text: string;
  kind: "section" | "parTitle" | "documentStart" | "title";
};

interface SearchResult {
  from: number;
  to: number;
  /** ~40 chars before the match */
  before: string;
  /** The matched text */
  match: string;
  /** ~40 chars after the match */
  after: string;
  /** Breadcrumb path: section hierarchy + paragraph title above the match */
  breadcrumb: BreadcrumbSegment[];
}

interface SearchPanelProps {
  editor: Editor | null;
  onHighlightRange: (range: { from: number; to: number } | null) => void;
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

const CTX = 40; // context chars on each side

/**
 * Extract the document's title (from the titleField node) if present.
 * Returns empty string when there's no title, so callers can fall back
 * to "Document start".
 */
function getDocTitle(editor: Editor): string {
  let title = "";
  editor.state.doc.forEach((node) => {
    if (
      node.type.name === "titleField" &&
      node.attrs?.field === "title"
    ) {
      const text = node.textContent?.trim() || "";
      if (text) title = text;
    }
  });
  return title;
}

/** Build breadcrumb by walking doc nodes up to a position. */
function buildBreadcrumb(editor: Editor, pos: number): BreadcrumbSegment[] {
  const sections: BreadcrumbSegment[] = [];
  // Use empty string as the "no title found" sentinel — this avoids
  // TypeScript closure-narrowing issues that come with `string | null`.
  let parTitle = "";

  editor.state.doc.descendants((node, nodePos) => {
    if (nodePos >= pos) return false;

    if (node.type.name === "heading") {
      const level = node.attrs.level as number;
      const text = node.textContent?.trim() || "Untitled";
      // Prune deeper headings when a higher-level heading appears
      while (sections.length > 0 && sections.length >= level) sections.pop();
      sections.push({ text, kind: "section" });
      return true;
    }

    // Pick up the closest paragraph title from any ancestor that contains pos.
    // parTitle lives on paragraph / bulletList / orderedList nodes; descendants
    // visits parents before children, so a deeper match overwrites a shallower
    // one — we end up with the most specific containing title.
    const titleAttr = node.attrs?.parTitle as string | null | undefined;
    if (
      titleAttr &&
      (node.type.name === "paragraph" ||
        node.type.name === "bulletList" ||
        node.type.name === "orderedList") &&
      nodePos + node.nodeSize > pos
    ) {
      parTitle = titleAttr;
    }

    return true;
  });

  let crumbs: BreadcrumbSegment[];
  if (sections.length > 0) {
    crumbs = sections;
  } else {
    // Before the first heading. If the document has a title, use it as
    // the de-facto name of this first region; otherwise fall back to
    // "Document start".
    const docTitle = getDocTitle(editor);
    crumbs = docTitle
      ? [{ text: docTitle, kind: "title" }]
      : [{ text: "Document start", kind: "documentStart" }];
  }

  if (parTitle) {
    crumbs.push({ text: parTitle, kind: "parTitle" });
  }

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

  /* ── Render ──────────────────────────────────────────────────────── */

  return (
    <div className="w-full bg-[var(--background)] flex flex-col overflow-hidden h-full">
      <PanelHeader title="Search">
        {query && (
          <PrevNextCounter
            current={selectedIdx}
            total={results.length}
            onPrev={goPrev}
            onNext={goNext}
            label="results"
          />
        )}
      </PanelHeader>

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
                <div className="text-[10px] truncate mb-1">
                  {r.breadcrumb.map((seg, segIdx) => (
                    <span key={segIdx}>
                      {segIdx > 0 && (
                        <span className="text-[var(--muted)]">
                          {" \u203a "}
                        </span>
                      )}
                      {seg.kind === "title" ? (
                        <>
                          <span className="text-[var(--muted)]">Title: </span>
                          <span className="text-stone-600 font-medium">
                            {seg.text}
                          </span>
                        </>
                      ) : (
                        <span
                          className={
                            seg.kind === "parTitle"
                              ? "text-[#c45a5a]"
                              : seg.kind === "documentStart"
                                ? "italic text-[var(--muted)] opacity-70"
                                : "text-[var(--muted)]"
                          }
                        >
                          {seg.text}
                        </span>
                      )}
                    </span>
                  ))}
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
