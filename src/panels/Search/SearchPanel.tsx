"use client";

import { useState, useMemo, useCallback, useRef, useEffect, memo } from "react";
import type { Editor } from "@tiptap/react";
import {
  themedCard,
  CARD_THEMES,
  PANEL,
  PrevNextCounter,
  clearStaleHover,
} from "@/components/panel-primitives";
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
import { Panel } from "@/panels/_shared/Panel";

type BreadcrumbSegment = {
  text: string;
  kind: "section" | "parTitle" | "documentStart" | "title";
};

interface SearchResult extends SearchHit {
  breadcrumb: BreadcrumbSegment[];
}

export interface SearchPanelState {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  enabledScopes: SearchScope[];
  selectedIdx: number | null;
}

export const INITIAL_SEARCH_STATE: SearchPanelState = {
  query: "",
  caseSensitive: false,
  wholeWord: false,
  enabledScopes: ["mainText", "footnotes"],
  selectedIdx: null,
};

interface SearchPanelProps {
  editor: Editor | null;
  onHighlightRange: (range: { from: number; to: number } | null) => void;
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
  onOpenItem: (panel: PanelId, itemId: string) => void;
  state: SearchPanelState;
  onStateChange: React.Dispatch<React.SetStateAction<SearchPanelState>>;
}

const PRIMARY_SCOPES: SearchScope[] = ["mainText", "footnotes"];
const DROPDOWN_SCOPES: SearchScope[] = SCOPE_ORDER.filter(
  (s) => !PRIMARY_SCOPES.includes(s),
);

const CTX = 40;
const FIELD_LABEL: Record<NonNullable<SearchHit["field"]>, string> = {
  title: "title",
  body: "body",
  text: "text",
  notes: "notes",
  key: "key",
  author: "author",
};

function getDocTitle(editor: Editor): string {
  let title = "";
  editor.state.doc.forEach((node) => {
    if (node.type.name === "titleField" && node.attrs?.field === "title") {
      const text = node.textContent?.trim() || "";
      if (text) title = text;
    }
  });
  return title;
}

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
  state,
  onStateChange,
}: SearchPanelProps) {
  const { query, caseSensitive, wholeWord, selectedIdx } = state;
  const enabledScopes = useMemo(
    () => new Set(state.enabledScopes),
    [state.enabledScopes],
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const setQuery = useCallback(
    (q: string) => {
      onStateChange((s) => ({ ...s, query: q, selectedIdx: null }));
      onHighlightRange(null);
    },
    [onStateChange, onHighlightRange],
  );
  const setCaseSensitive = useCallback(
    (fn: (v: boolean) => boolean) => {
      onStateChange((s) => ({
        ...s,
        caseSensitive: fn(s.caseSensitive),
        selectedIdx: null,
      }));
      onHighlightRange(null);
    },
    [onStateChange, onHighlightRange],
  );
  const setWholeWord = useCallback(
    (fn: (v: boolean) => boolean) => {
      onStateChange((s) => ({
        ...s,
        wholeWord: fn(s.wholeWord),
        selectedIdx: null,
      }));
      onHighlightRange(null);
    },
    [onStateChange, onHighlightRange],
  );
  const setSelectedIdx = useCallback(
    (idx: number | null) => {
      onStateChange((s) => ({ ...s, selectedIdx: idx }));
    },
    [onStateChange],
  );
  const toggleScope = useCallback(
    (scope: SearchScope) => {
      onStateChange((s) => {
        const has = s.enabledScopes.includes(scope);
        const nextScopes = has
          ? s.enabledScopes.filter((x) => x !== scope)
          : [...s.enabledScopes, scope];
        return { ...s, enabledScopes: nextScopes, selectedIdx: null };
      });
      onHighlightRange(null);
    },
    [onStateChange, onHighlightRange],
  );

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
    const uuidPos = needsUuidMap
      ? buildUuidPosMap(editor)
      : new Map<string, number>();

    if (enabledScopes.has("footnotes")) {
      hits.push(...searchFootnotes(footnotes, orphanedFootnotes, re));
    }
    if (enabledScopes.has("notes")) {
      hits.push(...searchNotes(notes, editor, uuidPos, re));
    }
    if (enabledScopes.has("citations")) {
      hits.push(
        ...searchCitations(
          citations,
          editorCitations,
          getCitationDisplayText,
          re,
        ),
      );
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
      hits.push(
        ...searchRevisions(textRevisions, generalRevisions, editor, re),
      );
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
    [editor, onHighlightRange, onOpenItem, setSelectedIdx],
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

  const headerExtras = query ? (
    <PrevNextCounter
      current={selectedIdx}
      total={results.length}
      label="results"
    />
  ) : undefined;

  const panelExtras = (
    <>
      <div className="px-3 py-2 border-b border-[var(--border-light)] flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleNavKeys}
          placeholder="Find in document..."
          className="flex-1 text-sm bg-transparent outline-none placeholder:text-ink-muted"
        />
        <button
          onClick={() => setCaseSensitive((v) => !v)}
          className={`text-[10px] font-bold px-1.5 py-0.5 rounded border transition-colors ${
            caseSensitive
              ? "border-[var(--accent)] text-[var(--accent)] bg-amber-50/60"
              : "border-edge-hover text-ink-muted hover:text-ink-body"
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
              : "border-edge-hover text-ink-muted hover:text-ink-body"
          }`}
          title="Whole word"
        >
          W
        </button>
      </div>

      <div className="px-3 pb-2 pt-2 flex flex-wrap items-center gap-1 border-b border-[var(--border)]">
        {PRIMARY_SCOPES.map((s) => (
          <ScopeChip
            key={s}
            scope={s}
            enabled={enabledScopes.has(s)}
            onToggle={() => toggleScope(s)}
          />
        ))}
        <MoreScopesDropdown
          scopes={DROPDOWN_SCOPES}
          enabledScopes={enabledScopes}
          onToggle={toggleScope}
        />
      </div>
    </>
  );

  return (
    <Panel
      kind="search"
      headerExtras={headerExtras}
      panelExtras={panelExtras}
      scrollRef={listRef}
      onKeyDown={handleNavKeys}
      scrollTabIndex={0}
    >
      {!query && <p className={PANEL.empty}>Type to search your document.</p>}
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
    </Panel>
  );
}

function MoreScopesDropdown({
  scopes,
  enabledScopes,
  onToggle,
}: {
  scopes: SearchScope[];
  enabledScopes: Set<SearchScope>;
  onToggle: (scope: SearchScope) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const enabledCount = scopes.filter((s) => enabledScopes.has(s)).length;

  useEffect(() => {
    if (!open) return;
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left });
    }
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        btnRef.current &&
        !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const active = enabledCount > 0;

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] transition-colors ${
          active
            ? "border-stone-300 bg-white/70 text-stone-700"
            : "border-stone-200 bg-transparent text-stone-400 hover:text-stone-600"
        }`}
        title="More search scopes"
      >
        <span>More</span>
        {active && (
          <span className="text-[9px] leading-none tabular-nums text-stone-500">
            {enabledCount}
          </span>
        )}
        <svg
          width="8"
          height="8"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d={open ? "M2 6 L5 3 L8 6" : "M2 4 L5 7 L8 4"} />
        </svg>
      </button>
      {open && (
        <div
          ref={menuRef}
          className="fixed bg-surface border border-[var(--border)] rounded-md shadow-lg py-1 z-[9999] min-w-[140px]"
          style={{ top: pos.top, left: pos.left }}
        >
          {scopes.map((s) => {
            const enabled = enabledScopes.has(s);
            const color = SCOPE_COLOR[s];
            return (
              <button
                key={s}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(s);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1 text-[11px] text-left hover-on-light transition-colors"
              >
                <span
                  aria-hidden
                  className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                  style={{
                    backgroundColor:
                      color === "transparent" ? "#78716c" : color,
                    opacity: enabled ? 1 : 0.4,
                  }}
                />
                <span className={enabled ? "text-ink-body" : "text-ink-muted"}>
                  {SCOPE_LABEL[s]}
                </span>
                {enabled && (
                  <span className="ml-auto text-[10px] leading-none text-ink-muted">
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

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
      className={`${themedCard(CARD_THEMES.comment, selected)} w-full text-left`}
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
                  style={{
                    color: color === "transparent" ? undefined : color,
                  }}
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
                  <span className="text-[var(--muted)]">{" \u203a "}</span>
                )}
                {seg.kind === "title" ? (
                  <>
                    <span className="text-[var(--muted)]">Title: </span>
                    <span className="text-ink-body font-medium">
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
        <div className="text-sm text-ink-body leading-snug break-words">
          {result.before.length > 0 && (
            <span className="text-ink-muted">
              {result.before.length === CTX ? "\u2026" : ""}
              {result.before}
            </span>
          )}
          <mark className="bg-amber-200/80 text-ink-strong rounded-sm px-px">
            {result.match}
          </mark>
          {result.after.length > 0 && (
            <span className="text-ink-muted">
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
