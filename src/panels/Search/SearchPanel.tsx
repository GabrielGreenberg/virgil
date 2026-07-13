"use client";

import { useState, useMemo, useCallback, useRef, useEffect, memo } from "react";
import type { Editor } from "@tiptap/react";
import {
  themedCard,
  themedCardStyle,
  CARD_THEMES,
  PANEL,
  PrevNextCounter,
  clearStaleHover,
  useCycle,
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
  SCOPE_TO_CARD_THEME,
  compileQuery,
  buildUuidPosMap,
} from "@/lib/search-sources";
import { SCOPE_DISPATCH, UUID_POS_SCOPES } from "@/panels/Search/scope-dispatch";
import {
  resolveLiveBlockRange,
  type BlockRangeId,
} from "@/hooks/useLivePosResolver";
import type {
  ArchivedSnippet,
  BibEntry,
  CitationRef,
  RevisionCard,
  CutterCard,
  OrphanedFootnote,
  ReportItem,
  TodoItem,
  UserNote,
} from "@/lib/types";
import { Panel } from "@/panels/_shared/Panel";

type BreadcrumbSegment = {
  text: string;
  kind: "section" | "parTitle" | "documentStart" | "title";
  /** Heading level (1-6) for `section` segments — drives level-aware ancestry
   *  popping (SR-F1-05). Absent for non-section kinds. */
  level?: number;
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
  cutterCards: CutterCard[];
  reportCards: ReportItem[];
  comments: RevisionCard[];
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
// SR-F1-03: the matched run rendered inside the amber <mark> was unclamped — a
// multi-thousand-char pasted query rendered its entire matched text, blowing
// out the result card. The before/after context is already capped at CTX; cap
// the match at a generous multiple of it (enough to read a sentence-length
// match in full, but bounded) and append an ellipsis when truncated. Clamping
// at the render sink covers EVERY scope's `match` uniformly (mainText + the
// search-sources hits) without touching the position/live-range logic.
const MARK_MAX = CTX * 3;
export function clampMark(match: string): string {
  if (match.length <= MARK_MAX) return match;
  return match.slice(0, MARK_MAX).trimEnd() + "…";
}
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

/**
 * SR-F1-05: fold a left-to-right sequence of headings (each `{level, text}`)
 * into the section-ancestry breadcrumb. Pops by the STORED heading level of
 * each ancestor, NOT by the running stack LENGTH. With skipped levels (e.g. H1
 * then H4) the old `stack.length >= level` test never popped (1 >= 4 is false),
 * so a second H4 sibling APPENDED under the first (`[H1, H4, H4]`) instead of
 * replacing it. Popping every entry whose level is >= this heading's level
 * keeps only the true ancestor chain and replaces same/deeper siblings —
 * correct for skip-level documents. Exported for direct unit testing.
 */
export function foldHeadingAncestry(
  headings: { level: number; text: string }[],
): BreadcrumbSegment[] {
  const sections: BreadcrumbSegment[] = [];
  for (const { level, text } of headings) {
    while (
      sections.length > 0 &&
      (sections[sections.length - 1].level ?? 0) >= level
    ) {
      sections.pop();
    }
    sections.push({ text, kind: "section", level });
  }
  return sections;
}

function buildBreadcrumb(editor: Editor, pos: number): BreadcrumbSegment[] {
  const headings: { level: number; text: string }[] = [];
  let parTitle = "";

  editor.state.doc.descendants((node, nodePos) => {
    if (nodePos >= pos) return false;

    if (node.type.name === "heading") {
      const level = node.attrs.level as number;
      const text = node.textContent?.trim() || "Untitled";
      headings.push({ level, text });
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

  const sections = foldHeadingAncestry(headings);
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

/**
 * A textblock's span in the joined-document-text coordinate space, paired with
 * the PM coordinates and stable uuid needed to (a) map a match start to a live
 * range at click time and (b) compute the PM `from/to` for ordering.
 *
 * `textStart`/`textEnd` are offsets into the SAME joined string the matcher
 * runs over; `contentStart` is the PM position of the first character inside
 * the block (`nodePos + 1`).
 */
interface TextRun {
  /** Offset of this run's first char in the joined doc text. */
  charStart: number;
  /** PM position of this run's first char. */
  pmStart: number;
  /** Number of chars in the run. */
  len: number;
}

interface BlockSpan {
  uuid: string | null;
  /** PM position of the first inline slot in the block (`nodePos + 1`). */
  contentStart: number;
  /** Offsets into the joined doc text spanned by this block. */
  textStart: number;
  textEnd: number;
  /** Per-text-node runs, in ascending char order. An inline ATOM
   *  (footnote/citation/inline-math) contributes ZERO chars but occupies one
   *  PM slot, so consecutive runs are NOT PM-contiguous — the run table is
   *  what makes char→PM conversion atom-accurate. */
  runs: TextRun[];
}

/**
 * Build the joined main-text string AND the aligned per-textblock span/run
 * table in ONE walk, so the matcher's offsets and the PM positions can never
 * drift apart. Mirrors `doc.textBetween(0, size, "\n")`: consecutive
 * textblocks are joined by a single "\n" separator.
 *
 * The previous implementation matched over `textBetween(...)` but RE-derived
 * PM positions in a SEPARATE descendant walk that incremented a `textOffset`
 * counter (`+= 1` per textblock boundary) — the two counters could disagree on
 * a multi-block match, landing the highlight one position off. Deriving the
 * joined text AND the PM-coordinate run table from the SAME walk removes that
 * whole failure mode, and the per-run table keeps char→PM conversion correct
 * across inline atoms (an atom occupies a PM slot but no chars).
 */
function buildMainTextIndex(editor: Editor): {
  text: string;
  spans: BlockSpan[];
} {
  const spans: BlockSpan[] = [];
  let text = "";
  let seenFirst = false;

  editor.state.doc.descendants((node, nodePos) => {
    if (!node.isTextblock) return true;
    // Separator between consecutive textblocks (matches `textBetween`'s "\n").
    if (seenFirst) text += "\n";
    seenFirst = true;
    const uuid = (node.attrs?.uuid as string | undefined) ?? null;
    const contentStart = nodePos + 1;
    const textStart = text.length;
    const runs: TextRun[] = [];

    // Walk the block's inline content. Text nodes contribute chars + a run;
    // inline atoms advance the PM cursor but add no chars (and no run).
    let pmCursor = contentStart;
    node.forEach((child) => {
      if (child.isText) {
        const t = child.text ?? "";
        runs.push({ charStart: text.length, pmStart: pmCursor, len: t.length });
        text += t;
      }
      pmCursor += child.nodeSize;
    });

    spans.push({ uuid, contentStart, textStart, textEnd: text.length, runs });
    // Don't descend further — we already consumed the block's inline content,
    // and nested textblocks don't occur inside a leaf textblock in this schema.
    return false;
  });

  return { text, spans };
}

/** Find the span whose half-open `[textStart, textEnd)` contains `offset`.
 *  Spans are ascending, so a small linear scan is fine (result building is
 *  event-time, not per keystroke). */
function spanAt(spans: BlockSpan[], offset: number): BlockSpan | null {
  for (const s of spans) {
    if (offset >= s.textStart && offset < s.textEnd) return s;
    // A zero-length block (empty paragraph) can host an empty match exactly at
    // its start; tolerate `offset === textStart === textEnd`.
    if (offset === s.textStart && s.textStart === s.textEnd) return s;
  }
  return null;
}

/** Convert a joined-text char offset to a PM position WITHIN `span`, walking
 *  its run table so inline atoms (0 chars / 1 PM slot) don't skew the result.
 *
 *  Runs are char-contiguous but NOT PM-contiguous: inline atoms between two
 *  text nodes contribute 0 chars but ≥1 PM slot, so the char offset at a
 *  run boundary names TWO distinct PM positions — before the atoms (the
 *  preceding run's end) and after them (the following run's start). Which one
 *  is right depends on the endpoint being converted:
 *
 *  - `"start"` — a match STARTING at the boundary begins with the following
 *    run's first char, so it resolves AFTER the atoms. (The old single
 *    inclusive-bound scan resolved it to the preceding run's end — the atom's
 *    own slot — anchoring the highlight one PM slot early and painting the
 *    atom pill.)
 *  - `"end"` — a match ENDING at the boundary must stop BEFORE the atoms,
 *    at the preceding run's end.
 *
 *  A block-final boundary (no following run) resolves to the last run's end
 *  for both endpoints. Falls back to `contentStart + (offset - textStart)`
 *  for the degenerate empty-block case (no runs). */
function charOffsetToPm(
  span: BlockSpan,
  charOffset: number,
  endpoint: "start" | "end",
): number {
  const runs = span.runs;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const upper = run.charStart + run.len;
    if (charOffset >= run.charStart && charOffset < upper) {
      return run.pmStart + (charOffset - run.charStart);
    }
    if (charOffset === upper) {
      if (endpoint === "end") return run.pmStart + run.len;
      // Start endpoint at a shared boundary: defer to the following run
      // (char-contiguous, so its charStart === upper) to land after the
      // atoms; block-final (no following run) resolves here.
      if (!runs[i + 1]) return run.pmStart + run.len;
    }
  }
  return span.contentStart + (charOffset - span.textStart);
}

export function searchMainText(editor: Editor, re: RegExp): SearchHit[] {
  const { text: docText, spans } = buildMainTextIndex(editor);

  const out: SearchHit[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(docText)) !== null) {
    const matchStart = m.index;
    const matchEnd = matchStart + m[0].length;

    const before = docText.slice(Math.max(0, matchStart - CTX), matchStart);
    const after = docText.slice(matchEnd, matchEnd + CTX);

    // Anchor the hit to the block the match STARTS in. A match that crosses a
    // block boundary (rare — only a query containing the "\n" separator) is
    // clamped to its starting block, which is the correct, safe behavior:
    // `to` is computed from the END offset clamped to the start block's text.
    const startSpan = spanAt(spans, matchStart);
    if (startSpan) {
      const pmFrom = charOffsetToPm(startSpan, matchStart, "start");
      const clampedEnd = Math.min(matchEnd, startSpan.textEnd);
      // A zero-length match sits at ONE position — reuse `pmFrom` rather than
      // converting the same offset with "end" semantics, which at an atom
      // boundary would resolve BEFORE the atoms and invert the range.
      const pmTo =
        clampedEnd === matchStart
          ? pmFrom
          : charOffsetToPm(startSpan, clampedEnd, "end");
      out.push({
        scope: "mainText",
        from: pmFrom,
        to: pmTo,
        before,
        match: m[0],
        after,
        field: "body",
        // `offset` is the PM-position offset within the block (NOT a char
        // offset) so `resolveLiveBlockRange` can recover `from` as
        // `block.pos + 1 + offset` against the LIVE (re-mapped) block pos.
        blockId: startSpan.uuid
          ? {
              blockUuid: startSpan.uuid,
              offset: pmFrom - startSpan.contentStart,
              length: pmTo - pmFrom,
            }
          : undefined,
      });
    }
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

/**
 * Decide the highlight range for a block-anchored main-text hit at CLICK time
 * (SR-F1-01 / SR-F3-04): re-resolve the durable `{blockUuid, offset, length}`
 * identity to a LIVE PM range from the DocStructure snapshot, never the baked
 * search-time `{from,to}`. If the user typed in an earlier paragraph after
 * searching, the block shifted — the live range tracks it.
 *
 * The resolver's two failure modes get DIFFERENT treatment (its contract):
 * - `null` (snapshot present, block deleted) → return `null` so the caller
 *   no-ops the highlight. The baked range is still in bounds after a mid-doc
 *   deletion, so falling back would amber-highlight and scroll-center whatever
 *   unrelated text now occupies those coordinates.
 * - `undefined` (no snapshot at all — an editor surface without the
 *   DocStructureObserver) → fall back to the baked range. On the main editor
 *   this never fires: `buildInitial` populates the snapshot at plugin-state
 *   init, so every uuid-bearing block is carried from doc load.
 *
 * Exported for tests (like `searchMainText` above).
 */
export function resolveAnchoredHighlight(
  editor: Editor | null,
  blockId: BlockRangeId,
  baked: { from: number; to: number },
): { from: number; to: number } | null {
  const live = resolveLiveBlockRange(editor, blockId);
  if (live === undefined) return baked;
  return live;
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
  cutterCards,
  reportCards,
  comments,
  bibEntries,
  onOpenItem,
  state,
  onStateChange,
}: SearchPanelProps) {
  const { query, caseSensitive, wholeWord } = state;
  const enabledScopes = useMemo(
    () => new Set(state.enabledScopes),
    [state.enabledScopes],
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // SR-C1-01 / SR-F2-01 / SR-F1-02: the result cursor is owned by the SHARED
  // `useCycle` read-clamp, not a hand-rolled `selectedIdx`. `useCycle` clamps
  // its index on READ against the live `results.length`, so the counter can
  // never report "16 of 10" after the list shrinks, and Enter/arrows wrap at
  // both ends through the one primitive every other panel uses. The persisted
  // `state.selectedIdx` is now just a back-compat mirror written on navigate —
  // never the live cursor (the clamp makes a stale persisted value harmless).
  const setPersistedIdx = useCallback(
    (idx: number | null) => {
      onStateChange((s) => (s.selectedIdx === idx ? s : { ...s, selectedIdx: idx }));
    },
    [onStateChange],
  );

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

    // Build the shared UUID→pos map once, only if a uuid-anchored scope is on
    // (the doc walk isn't free). `UUID_POS_SCOPES` is the single source of
    // truth for which scopes need it (see scope-dispatch.ts).
    const needsUuidMap = UUID_POS_SCOPES.some((s) => enabledScopes.has(s));
    const uuidPos = needsUuidMap
      ? buildUuidPosMap(editor)
      : new Map<string, number>();

    const ctx = {
      editor,
      re,
      uuidPos,
      footnotes,
      orphanedFootnotes,
      notes,
      citations,
      editorCitations,
      getCitationDisplayText,
      todos,
      archiveSnippets,
      cutterCards,
      reportCards,
      comments,
      bibEntries,
      searchMainText,
    };

    // Drive every enabled scope through the exhaustive dispatch table — a
    // scope enumerated in SCOPE_ORDER but missing a dispatch entry is a
    // COMPILE error, so the panel can never silently skip one (SR-F3-02).
    const hits: SearchHit[] = [];
    for (const scope of SCOPE_ORDER) {
      if (enabledScopes.has(scope)) hits.push(...SCOPE_DISPATCH[scope](ctx));
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
    cutterCards,
    reportCards,
    comments,
    bibEntries,
  ]);

  // Pure navigation: highlight + open + scroll. The cursor index is owned by
  // `useCycle` (below) — this only consumes `idx` to scroll the matching card
  // into view. Persisting the index is the cycle-activate's job.
  const navigateToResult = useCallback(
    (result: SearchResult, idx: number) => {
      if (!editor) return;

      if (result.unanchored) {
        onHighlightRange(null);
      } else if (result.blockId) {
        // Live re-resolution + the deleted-block no-op — the full policy
        // (including why the baked fallback is reserved for the no-snapshot
        // case) lives on `resolveAnchoredHighlight`.
        onHighlightRange(
          resolveAnchoredHighlight(editor, result.blockId, {
            from: result.from,
            to: result.to,
          }),
        );
      } else {
        // Collection hits (footnote/citation/etc.) anchor on a paragraph; the
        // baked `from` was resolved at search time. They scroll-to + open their
        // native panel; the editor highlight is best-effort.
        onHighlightRange({ from: result.from, to: result.to });
      }

      const targetPanel = SCOPE_PANEL[result.scope];
      if (targetPanel && result.itemId) {
        // No cast: SCOPE_PANEL values are literal-typed PanelKind members.
        onOpenItem(targetPanel, result.itemId);
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

  // `useCycle` owns the live result cursor and clamps it on READ against the
  // current `results.length` — so `goNext`/`goPrev`/the counter all read the
  // same always-valid index and the counter can never exceed total. The
  // persisted `state.selectedIdx` mirror is updated on navigate for
  // back-compat / remount restore; the clamp makes a stale persisted value
  // harmless.
  const onActivateResult = useCallback(
    (result: SearchResult, idx: number) => {
      navigateToResult(result, idx);
      setPersistedIdx(idx);
    },
    [navigateToResult, setPersistedIdx],
  );

  const {
    idx: selectedIdx,
    setIdx: setCycleIdx,
    next: goNext,
    prev: goPrev,
  } = useCycle(results, onActivateResult);

  // A new query / scope / option change starts a fresh search — reset the
  // cursor so the counter shows "<total> results" (not a carried-over "N of M")
  // and the next Enter starts at the first hit. Keyed on the search inputs, not
  // the results array (which also changes on a structural edit, where we must
  // NOT drop a live selection). Skips the initial mount.
  const searchKey = `${query} ${caseSensitive} ${wholeWord} ${state.enabledScopes.join(",")}`;
  const prevSearchKeyRef = useRef(searchKey);
  useEffect(() => {
    if (prevSearchKeyRef.current === searchKey) return;
    prevSearchKeyRef.current = searchKey;
    setCycleIdx(null);
  }, [searchKey, setCycleIdx]);

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
          data-hint="Match case"
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
          data-hint="Whole word"
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
            // Point the shared cursor at this row, then navigate. `setCycleIdx`
            // is the index authority; `onActivateResult` (navigate + persist)
            // runs through it so a click and a keyboard cycle land identically.
            setCycleIdx(i);
            onActivateResult(r, i);
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
            ? "border-edge-hover bg-white/70 text-ink-body"
            : "border-edge-subtle bg-transparent text-ink-muted hover:text-ink-subtle"
        }`}
        data-hint="More scopes"
      >
        <span>More</span>
        {active && (
          <span className="text-[9px] leading-none tabular-nums text-ink-subtle">
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
                className="w-full flex items-center gap-2 px-2.5 py-1 text-[11px] text-left hover-on-light"
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
          ? "border-edge-hover bg-white/70 text-ink-body"
          : "border-edge-subtle bg-transparent text-ink-muted hover:text-ink-subtle"
      }`}
      data-hint={`${enabled ? "Hide" : "Show"} scope`}
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
  const theme = CARD_THEMES[SCOPE_TO_CARD_THEME[result.scope]];

  return (
    <button
      data-result-idx={idx}
      className={`${themedCard(theme, selected)} w-full text-left`}
      onClick={onClick}
      style={{ ...themedCardStyle(theme, selected), ...borderStyle }}
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
                  {/* "(archived)" wins over "(unanchored)": archiving an
                      atom card (footnote/citation) splices its atom out, so
                      an archived hit is usually ALSO unanchored — archived
                      is the cause, unanchored the symptom. */}
                  {result.archived
                    ? " (archived)"
                    : result.unanchored
                      ? " (unanchored)"
                      : ""}
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
            {clampMark(result.match)}
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
