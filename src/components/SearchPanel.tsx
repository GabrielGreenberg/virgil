"use client";

import { useState, useMemo, useCallback, useRef, useEffect, memo } from "react";
import type { Editor } from "@tiptap/react";
import { panelCard, PANEL, PanelHeader, PrevNextCounter, clearStaleHover } from "./panel-primitives";
import type { PanelId } from "@/hooks/useViewPrefs";
import {
  type SearchScope,
  type SearchHit,
  type FootnoteSearchItem,
  type EditorCitationItem,
  SCOPE_LABEL,
  SCOPE_PANEL,
  SCOPE_COLOR,
  SCOPE_ORDER,
  compileQuery,
  buildUuidPosMap,
  searchFootnotes,
  searchNotes,
  searchCitations,
  searchTodos,
  searchArchive,
  searchCuts,
  searchQuotations,
  searchHeadings,
  searchRevisions,
  searchBibliography,
} from "@/lib/search-sources";
import type {
  ArchivedSnippet,
  BibEntry,
  CitationRef,
  CutItem,
  GeneralRevision,
  OrphanedFootnote,
  QuotationGroup,
  TextRevision,
  TodoItem,
  UserNote,
} from "@/lib/types";

/* ── Types ──────────────────────────────────────────────────────────── */

type BreadcrumbSegment = {
  text: string;
  kind: "section" | "parTitle" | "documentStart" | "title";
};

interface SearchResult extends SearchHit {
  /** Breadcrumb path: section hierarchy + paragraph title above the match. */
  breadcrumb: BreadcrumbSegment[];
}

interface SearchPanelProps {
  editor: Editor | null;
  onHighlightRange: (range: { from: number; to: number } | null) => void;

  /* Collections searched beyond the main text body. */
  footnotes: FootnoteSearchItem[];
  orphanedFootnotes: OrphanedFootnote[];
  notes: UserNote[];
  citations: CitationRef[];
  editorCitations: EditorCitationItem[];
  getCitationDisplayText: (command: string) => string;
  todos: TodoItem[];
  archiveSnippets: ArchivedSnippet[];
  cuts: CutItem[];
  quotationGroups: QuotationGroup[];
  textRevisions: TextRevision[];
  generalRevisions: GeneralRevision[];
  bibEntries: BibEntry[];

  /** Open the item's native panel and focus it there. */
  onOpenItem: (panel: PanelId, itemId: string) => void;
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

const CTX = 40;
const FIELD_LABEL: Record<NonNullable<SearchHit["field"]>, string> = {
  title: "title",
  body: "body",
  text: "text",
  notes: "notes",
  key: "key",
  author: "author",
};

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
  let parTitle = "";

  editor.state.doc.descendants((node, nodePos) => {
    if (nodePos >= pos) return false;

    if (node.type.name === "heading") {
      const level = node.attrs.level as number;
      const text = node.textContent?.trim() || "Untitled";
      while (sections.length > 0 && sections.length >= level) sections.pop();
      sections.push({ text, kind: "section" });
      return true;
    }

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

/** Search the main editor text, returning hits with true PM positions. */
function searchMainText(editor: Editor, re: RegExp): SearchHit[] {
  const docText = editor.state.doc.textBetween(
    0,
    editor.state.doc.content.size,
    "\n",
  );

  const out: SearchHit[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(docText)) !== null) {
    const matchStart = m.index;
    const matchEnd = matchStart + m[0].length;

    const before = docText.slice(Math.max(0, matchStart - CTX), matchStart);
    const after = docText.slice(matchEnd, matchEnd + CTX);

    // Mirror ProseMirror's textBetween separator logic (one "\n" before
    // each textblock except the first) to map text offset → PM position.
    let pmFrom = 0;
    let pmTo = 0;
    let textOffset = 0;
    let seenFirstTextblock = false;
    let foundFrom = false;
    let foundTo = false;

    editor.state.doc.descendants((node, nodePos) => {
      if (foundTo) return false;
      if (node.isTextblock) {
        if (seenFirstTextblock) {
          textOffset += 1;
        } else {
          seenFirstTextblock = true;
        }
      }
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
      }
      return true;
    });

    if (foundFrom && foundTo) {
      out.push({
        scope: "mainText",
        from: pmFrom,
        to: pmTo,
        before,
        match: m[0],
        after,
        field: "body",
      });
    }
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

/* ── Component ───────────────────────────────────────────────────────── */

function SearchPanel({
  editor,
  onHighlightRange,
  footnotes,
  orphanedFootnotes,
  notes,
  citations,
  editorCitations,
  getCitationDisplayText,
  todos,
  archiveSnippets,
  cuts,
  quotationGroups,
  textRevisions,
  generalRevisions,
  bibEntries,
  onOpenItem,
}: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [enabledScopes, setEnabledScopes] = useState<Set<SearchScope>>(
    () => new Set(["mainText", "footnotes"]),
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const toggleScope = useCallback((scope: SearchScope) => {
    setEnabledScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  }, []);

  /* ── Combined search (memoised) ────────────────────────────────────── */

  const results: SearchResult[] = useMemo(() => {
    if (!editor) return [];
    const re = compileQuery(query, { caseSensitive, wholeWord });
    if (!re) return [];

    const hits: SearchHit[] = [];

    if (enabledScopes.has("mainText")) {
      hits.push(...searchMainText(editor, re));
    }

    const needsUuidMap =
      enabledScopes.has("notes") ||
      enabledScopes.has("todos") ||
      enabledScopes.has("archive") ||
      enabledScopes.has("cuts") ||
      enabledScopes.has("quotations");
    const uuidPos = needsUuidMap ? buildUuidPosMap(editor) : new Map<string, number>();

    if (enabledScopes.has("footnotes")) {
      hits.push(...searchFootnotes(footnotes, orphanedFootnotes, re));
    }
    if (enabledScopes.has("headings")) {
      hits.push(...searchHeadings(editor, re));
    }
    if (enabledScopes.has("notes")) {
      hits.push(...searchNotes(notes, editor, uuidPos, re));
    }
    if (enabledScopes.has("citations")) {
      hits.push(...searchCitations(citations, editorCitations, getCitationDisplayText, re));
    }
    if (enabledScopes.has("todos")) {
      hits.push(...searchTodos(todos, uuidPos, re));
    }
    if (enabledScopes.has("archive")) {
      hits.push(...searchArchive(archiveSnippets, uuidPos, re));
    }
    if (enabledScopes.has("cuts")) {
      hits.push(...searchCuts(cuts, editor, uuidPos, re));
    }
    if (enabledScopes.has("quotations")) {
      hits.push(...searchQuotations(quotationGroups, uuidPos, re));
    }
    if (enabledScopes.has("revisions")) {
      hits.push(...searchRevisions(textRevisions, generalRevisions, editor, re));
    }
    if (enabledScopes.has("bibliography")) {
      hits.push(...searchBibliography(bibEntries, re));
    }

    hits.sort((a, b) => a.from - b.from);

    return hits.map((h) => ({
      ...h,
      breadcrumb: h.unanchored ? [] : buildBreadcrumb(editor, h.from),
    }));
  }, [
    editor,
    query,
    caseSensitive,
    wholeWord,
    enabledScopes,
    footnotes,
    orphanedFootnotes,
    notes,
    citations,
    editorCitations,
    getCitationDisplayText,
    todos,
    archiveSnippets,
    cuts,
    quotationGroups,
    textRevisions,
    generalRevisions,
    bibEntries,
  ]);

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

      if (result.unanchored) {
        onHighlightRange(null);
      } else {
        onHighlightRange({ from: result.from, to: result.to });
      }

      const targetPanel = SCOPE_PANEL[result.scope];
      if (targetPanel && result.itemId) {
        onOpenItem(targetPanel as PanelId, result.itemId);
      }

      requestAnimationFrame(() => {
        const card = listRef.current?.querySelector(
          `[data-result-idx="${idx}"]`,
        );
        card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    },
    [editor, onHighlightRange, onOpenItem],
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

  const handleNavKeys = useCallback(
    (e: React.KeyboardEvent) => {
      if (results.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        goNext();
        clearStaleHover(listRef.current);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        goPrev();
        clearStaleHover(listRef.current);
      } else if (e.key === "Enter") {
        e.preventDefault();
        goNext();
        clearStaleHover(listRef.current);
      }
    },
    [results, goNext, goPrev],
  );

  /* ── Render ──────────────────────────────────────────────────────── */

  return (
    <div className="w-full bg-transparent flex flex-col overflow-hidden h-full">
      <PanelHeader title="Search">
        {query && (
          <PrevNextCounter
            current={selectedIdx}
            total={results.length}
            label="results"
          />
        )}
      </PanelHeader>

      {/* Search input + Aa/W toggles */}
      <div className="px-3 py-2 border-b border-[var(--border-light)] flex items-center gap-2">
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

      {/* Scope chips */}
      <div className="px-3 pb-2 pt-2 flex flex-wrap gap-1 border-b border-[var(--border)]">
        {SCOPE_ORDER.map((s) => (
          <ScopeChip
            key={s}
            scope={s}
            enabled={enabledScopes.has(s)}
            onToggle={() => toggleScope(s)}
          />
        ))}
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
          <ResultCard
            key={`${r.scope}-${r.itemId ?? "x"}-${r.from}-${i}`}
            idx={i}
            result={r}
            selected={selectedIdx === i}
            onClick={() => {
              navigateToResult(r, i);
              listRef.current?.focus();
            }}
          />
        ))}
      </div>
    </div>
  );
}

/* ── Subcomponents ───────────────────────────────────────────────────── */

function ScopeChip({
  scope,
  enabled,
  onToggle,
}: {
  scope: SearchScope;
  enabled: boolean;
  onToggle: () => void;
}) {
  const color = SCOPE_COLOR[scope];
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] transition-colors ${
        enabled
          ? "border-stone-300 bg-white/70 text-stone-700"
          : "border-stone-200 bg-transparent text-stone-400 hover:text-stone-600"
      }`}
      title={`${enabled ? "Hide" : "Show"} ${SCOPE_LABEL[scope]}`}
    >
      <span
        aria-hidden
        className="inline-block w-1.5 h-1.5 rounded-full"
        style={{
          backgroundColor: color === "transparent" ? "#78716c" : color,
          opacity: enabled ? 1 : 0.4,
        }}
      />
      <span>{SCOPE_LABEL[scope]}</span>
      {enabled && <span className="text-[9px] leading-none">✓</span>}
    </button>
  );
}

function ResultCard({
  idx,
  result,
  selected,
  onClick,
}: {
  idx: number;
  result: SearchResult;
  selected: boolean;
  onClick: () => void;
}) {
  const color = SCOPE_COLOR[result.scope];
  const borderStyle: React.CSSProperties =
    color === "transparent"
      ? {}
      : { borderLeftColor: color, borderLeftWidth: 3 };
  const scopeLabel = SCOPE_LABEL[result.scope];
  const fieldLabel = result.field ? FIELD_LABEL[result.field] : undefined;
  const showScopeLabel = result.scope !== "mainText";

  return (
    <button
      data-result-idx={idx}
      className={`${panelCard(selected)} w-full text-left`}
      onClick={onClick}
      style={borderStyle}
    >
      <div className={PANEL.cardInner}>
        {(showScopeLabel || result.breadcrumb.length > 0) && (
          <div className="text-[10px] truncate mb-1">
            {showScopeLabel && (
              <>
                <span
                  className="font-medium"
                  style={{ color: color === "transparent" ? undefined : color }}
                >
                  {scopeLabel}
                  {fieldLabel ? ` ${fieldLabel}` : ""}
                  {result.unanchored ? " (unanchored)" : ""}
                </span>
                {result.breadcrumb.length > 0 && (
                  <span className="text-[var(--muted)]">{" \u203a "}</span>
                )}
              </>
            )}
            {result.breadcrumb.map((seg, segIdx) => (
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
                        ? "text-[var(--par-title-color,#c45a5a)]"
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
          {result.before.length > 0 && (
            <span className="text-stone-400">
              {result.before.length === CTX ? "\u2026" : ""}
              {result.before}
            </span>
          )}
          <mark className="bg-amber-200/80 text-stone-800 rounded-sm px-px">
            {result.match}
          </mark>
          {result.after.length > 0 && (
            <span className="text-stone-400">
              {result.after}
              {result.after.length === CTX ? "\u2026" : ""}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

export default memo(SearchPanel);
