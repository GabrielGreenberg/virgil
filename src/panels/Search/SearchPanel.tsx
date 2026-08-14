"use client";

import {
  useMemo,
  useCallback,
  useRef,
  useEffect,
  useDeferredValue,
  memo,
} from "react";
import type { Editor } from "@tiptap/react";
import {
  themedCard,
  themedCardStyle,
  PANEL,
  PrevNextCounter,
  clearStaleHover,
  useCycle,
} from "@/components/panel-primitives";
import type { PanelId } from "@/hooks/useViewPrefs";
import { AnchoredMenu } from "@/components/menu/AnchoredMenu";
import { MenuToggleRow } from "@/components/menu/MenuToggleRow";
import { useCardTheme, useAllPanelColors } from "@/hooks/usePanelTheme";
import {
  type SearchScope,
  type SearchHit,
  type FootnoteSearchItem,
  type EditorCitationItem,
  SCOPE_LABEL,
  SCOPE_PANEL,
  SCOPE_ORDER,
  SCOPE_TO_CARD_THEME,
  scopeDotBackground,
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
/**
 * The two search-MODE toggles (match-case `Aa`, whole-word `W`), task 309.
 *
 * They used to paint their ON state `border-[var(--accent)]
 * text-[var(--accent)] bg-amber-50/60` — a raw Tailwind amber (which is v4's
 * DEFAULT amber, not the repo's warm `--amber-*` family: there is no
 * `--color-amber-*` in the `@theme inline` block) over a token whose own
 * declaration comment reserves it for the user-overridable link/selection/CTA
 * accent and says the toggle aesthetic is "decoupled from --accent on
 * purpose". Retinting `--accent` therefore moved these two toggles and no
 * other segmented control in the app.
 *
 * The toggle "on" aesthetic has its own SSOT one declaration below `--accent`
 * in globals.css: `--control-selected` (solid path — Outline Edit/Focus,
 * PrintDialog font size) and the TINT path `--control-selected-tint` /
 * `--control-selected-ink` that `.topbarbtn[aria-pressed="true"]` and
 * `.iconbtn-toggle[aria-pressed="true"]` already paint from. These are
 * outlined mini-chips rather than filled segments, so they take the tint path
 * — which is also its first consumer in a `.tsx`.
 *
 * ONE pair of constants, because the two buttons are the same control twice:
 * spelled per-button they had already drifted together and could next drift
 * apart. `aria-pressed` rides along as the semantic the utility form of this
 * treatment keys on (STYLE_GUIDE: toggle state via `aria-pressed`, not a
 * conditional class) — here it is announced state, not a selector.
 */
const MODE_TOGGLE_BASE =
  "text-[10px] font-bold px-1.5 py-0.5 rounded border transition-colors";
const MODE_TOGGLE_ON =
  "border-[var(--control-selected-ink)] text-[var(--control-selected-ink)] bg-[var(--control-selected-tint)]";
const MODE_TOGGLE_OFF = "border-edge-hover text-ink-muted hover:text-ink-body";

const FIELD_LABEL: Record<NonNullable<SearchHit["field"]>, string> = {
  title: "title",
  body: "body",
  text: "text",
  notes: "notes",
  key: "key",
  author: "author",
};

/** How many hits get enriched (breadcrumbs) and mounted as result cards. The
 *  COUNT is always true (`totalResults`), and an overflow note names what's
 *  hidden — but a short query on a long doc can match tens of thousands of
 *  times, and mounting that many cards is reliably multi-second (task 119).
 *  Bounding at the render sink keeps the panel responsive at any hit count. */
export const MAX_RENDERED_RESULTS = 300;

/** Stable empty list for the cleared-query fast path below. */
const EMPTY_RESULTS: SearchResult[] = [];

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

/**
 * Position-indexed breadcrumb source, built in ONE doc walk per search run
 * (task 119). The predecessor `buildBreadcrumb` ran a full `doc.descendants`
 * pass PER anchored hit — O(hits × doc), the quadratic core of the
 * per-character search freeze: a short query on a long doc yields hits
 * proportional to doc length, so result building went quadratic in document
 * size. One walk now collects everything any breadcrumb can need; each hit
 * resolves against it by binary search (`breadcrumbAt`).
 *
 *  - `headings`: every heading in document order, each carrying the FOLDED
 *    ancestry as of that heading — incremental copy-on-write snapshots (≤6
 *    entries each, one heading level per slot) built with the same
 *    pop-by-stored-level rule as `foldHeadingAncestry` (equivalence pinned by
 *    search-breadcrumb-index.test). A hit's section trail is the snapshot of
 *    the last heading strictly BEFORE it.
 *  - `parTitles`: every parTitle-bearing paragraph/list span in walk order
 *    (parents before children), plus a prefix-max of span ends so the
 *    backward containment scan bails as soon as no earlier span can still
 *    reach past the position. The last containing span in walk order wins —
 *    the innermost, matching the old per-hit walk's overwrite semantics.
 *  - `docTitle`: the top-level titleField text (the old per-hit `getDocTitle`
 *    fallback, now collected in the same walk).
 *
 * Exported for tests.
 */
export interface BreadcrumbIndex {
  headings: { pos: number; ancestry: BreadcrumbSegment[] }[];
  parTitles: { start: number; end: number; text: string }[];
  parMaxEnd: number[];
  docTitle: string;
}

export function buildBreadcrumbIndex(editor: Editor): BreadcrumbIndex {
  const headings: BreadcrumbIndex["headings"] = [];
  const parTitles: BreadcrumbIndex["parTitles"] = [];
  const parMaxEnd: number[] = [];
  let docTitle = "";
  const stack: BreadcrumbSegment[] = [];

  editor.state.doc.descendants((node, nodePos, parent) => {
    if (node.type.name === "heading") {
      const level = node.attrs.level as number;
      const text = node.textContent?.trim() || "Untitled";
      while (
        stack.length > 0 &&
        (stack[stack.length - 1].level ?? 0) >= level
      ) {
        stack.pop();
      }
      stack.push({ text, kind: "section", level });
      headings.push({ pos: nodePos, ancestry: stack.slice() });
      return true;
    }

    if (
      node.type.name === "titleField" &&
      node.attrs?.field === "title" &&
      parent?.type.name === "doc"
    ) {
      const text = node.textContent?.trim() || "";
      if (text) docTitle = text;
    }

    const titleAttr = node.attrs?.parTitle as string | null | undefined;
    if (
      titleAttr &&
      (node.type.name === "paragraph" ||
        node.type.name === "bulletList" ||
        node.type.name === "orderedList")
    ) {
      const end = nodePos + node.nodeSize;
      parTitles.push({ start: nodePos, end, text: titleAttr });
      parMaxEnd.push(
        parMaxEnd.length > 0
          ? Math.max(parMaxEnd[parMaxEnd.length - 1], end)
          : end,
      );
    }

    return true;
  });

  return { headings, parTitles, parMaxEnd, docTitle };
}

/** Rightmost index in ascending `arr` whose key is strictly less than `pos`,
 *  or -1. The strict bound mirrors the old walk's `nodePos >= pos` cutoff. */
function lastBefore<T>(arr: T[], key: (t: T) => number, pos: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (key(arr[mid]) < pos) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/** Resolve one hit's breadcrumb from the prebuilt index — O(log doc), no doc
 *  walk. Exported for tests (equivalence with the old per-hit walk). */
export function breadcrumbAt(
  index: BreadcrumbIndex,
  pos: number,
): BreadcrumbSegment[] {
  const h = lastBefore(index.headings, (x) => x.pos, pos);
  const sections = h >= 0 ? index.headings[h].ancestry : [];

  // `slice()` — ancestry snapshots are shared across hits; the parTitle push
  // below must not mutate them.
  const crumbs: BreadcrumbSegment[] =
    sections.length > 0
      ? sections.slice()
      : index.docTitle
        ? [{ text: index.docTitle, kind: "title" }]
        : [{ text: "Document start", kind: "documentStart" }];

  // parTitle: innermost span with `start < pos < end`. Walk back from the
  // last span starting before `pos`; the prefix-max of ends bounds the scan —
  // once no span up to `i` reaches past `pos`, nothing earlier contains it.
  const { parTitles, parMaxEnd } = index;
  for (let i = lastBefore(parTitles, (s) => s.start, pos); i >= 0; i--) {
    if (parMaxEnd[i] <= pos) break;
    if (parTitles[i].end > pos) {
      crumbs.push({ text: parTitles[i].text, kind: "parTitle" });
      break;
    }
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

/** Find the span whose half-open `[textStart, textEnd)` contains `offset`, by
 *  binary search. Spans are ascending and non-overlapping (consecutive blocks
 *  are separated by one "\n" char), so the only candidate is the rightmost
 *  span starting at or before `offset`. The old from-index-0 linear scan was
 *  O(spans) per hit — and hit count scales with doc length for short queries,
 *  so the total went quadratic in document size (task 119). */
function spanAt(spans: BlockSpan[], offset: number): BlockSpan | null {
  let lo = 0;
  let hi = spans.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (spans[mid].textStart <= offset) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (ans < 0) return null;
  const s = spans[ans];
  if (offset >= s.textStart && offset < s.textEnd) return s;
  // A zero-length block (empty paragraph) can host an empty match exactly at
  // its start; tolerate `offset === textStart === textEnd`.
  if (offset === s.textStart && s.textStart === s.textEnd) return s;
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

  // ── Task 119: the search input must never wait on the search ─────────────
  // The query is controlled state, and the results memo used to key on the
  // LIVE value — so the full search ran synchronously in the same render as
  // the input echo, stalling each typed character by the search's cost.
  // `useDeferredValue` over the (memoized, so identity-stable) input tuple
  // splits that: the urgent render echoes the keystroke with the PREVIOUS
  // results (memo deps unchanged), then React re-renders at deferred priority
  // with the new tuple and runs the search — and abandons stale deferred
  // passes when more keystrokes arrive. All four search inputs ride the same
  // tuple so a case/word/scope toggle gets the same treatment.
  const searchInputs = useMemo(
    () => ({
      query,
      caseSensitive,
      wholeWord,
      scopes: state.enabledScopes,
    }),
    [query, caseSensitive, wholeWord, state.enabledScopes],
  );
  const deferred = useDeferredValue(searchInputs);
  const searchPending = deferred !== searchInputs;

  const { results: searchedResults, totalResults: searchedTotal } = useMemo(() => {
    const none = { results: [] as SearchResult[], totalResults: 0 };
    if (!editor) return none;
    const re = compileQuery(deferred.query, {
      caseSensitive: deferred.caseSensitive,
      wholeWord: deferred.wholeWord,
    });
    if (!re) return none;
    const scopes = new Set(deferred.scopes);

    // Build the shared UUID→pos map once, only if a uuid-anchored scope is on
    // (the doc walk isn't free). `UUID_POS_SCOPES` is the single source of
    // truth for which scopes need it (see scope-dispatch.ts).
    const needsUuidMap = UUID_POS_SCOPES.some((s) => scopes.has(s));
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
      if (scopes.has(scope)) hits.push(...SCOPE_DISPATCH[scope](ctx));
    }

    hits.sort((a, b) => a.from - b.from);

    // Enrich + expose only the first MAX_RENDERED_RESULTS hits; the true
    // total survives for the counter and the overflow note. The breadcrumb
    // index is ONE lazy doc walk shared by every displayed hit (built only if
    // some displayed hit is anchored) — never a walk per hit.
    let crumbIndex: BreadcrumbIndex | null = null;
    const shown =
      hits.length > MAX_RENDERED_RESULTS
        ? hits.slice(0, MAX_RENDERED_RESULTS)
        : hits;
    const results = shown.map((h) => ({
      ...h,
      breadcrumb: h.unanchored
        ? []
        : breadcrumbAt((crumbIndex ??= buildBreadcrumbIndex(editor)), h.from),
    }));
    return { results, totalResults: hits.length };
  }, [
    editor,
    deferred,
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

  // A CLEARED input empties the list at urgent priority — otherwise stale
  // cards would linger under the "Type to search" empty state until the
  // deferred pass drains. (Keyed on the live `query`, but this is O(1) — the
  // expensive memo above stays keyed on the deferred tuple.)
  const results = query ? searchedResults : EMPTY_RESULTS;
  const totalResults = query ? searchedTotal : 0;

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
  // and the next Enter starts at the first hit. Keyed on the DEFERRED inputs
  // (the ones the results memo actually consumed) so the cursor resets when
  // the results really swap, never mid-defer against a stale list — and not on
  // the results array (which also changes on a structural edit, where we must
  // NOT drop a live selection). Skips the initial mount.
  const searchKey = `${deferred.query}\0${deferred.caseSensitive}\0${deferred.wholeWord}\0${deferred.scopes.join(",")}`;
  const prevSearchKeyRef = useRef(searchKey);
  useEffect(() => {
    if (prevSearchKeyRef.current === searchKey) return;
    prevSearchKeyRef.current = searchKey;
    setCycleIdx(null);
  }, [searchKey, setCycleIdx]);

  // One stable click callback for every card (the card passes its own
  // `(result, idx)` back), so the memoized ResultCard's props are
  // identity-stable and the urgent echo render (the defer leg above) bails on
  // all unchanged cards instead of re-rendering the whole list per keystroke.
  // Point the shared cursor at the row, then navigate: `setCycleIdx` is the
  // index authority; `onActivateResult` (navigate + persist) runs through it
  // so a click and a keyboard cycle land identically.
  const handleResultClick = useCallback(
    (r: SearchResult, i: number) => {
      setCycleIdx(i);
      onActivateResult(r, i);
      listRef.current?.focus();
    },
    [setCycleIdx, onActivateResult],
  );

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
      total={totalResults}
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
          aria-pressed={caseSensitive}
          className={`${MODE_TOGGLE_BASE} ${caseSensitive ? MODE_TOGGLE_ON : MODE_TOGGLE_OFF}`}
          data-hint="Match case"
        >
          Aa
        </button>
        <button
          onClick={() => setWholeWord((v) => !v)}
          aria-pressed={wholeWord}
          className={`${MODE_TOGGLE_BASE} ${wholeWord ? MODE_TOGGLE_ON : MODE_TOGGLE_OFF}`}
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
      {query && !searchPending && results.length === 0 && (
        <p className={PANEL.empty}>No matches found.</p>
      )}
      {results.map((r, i) => (
        <ResultCard
          key={`${r.scope}-${r.itemId ?? "x"}-${r.from}-${i}`}
          idx={i}
          result={r}
          selected={selectedIdx === i}
          onClick={handleResultClick}
        />
      ))}
      {totalResults > results.length && (
        <p className={PANEL.empty}>
          Showing the first {results.length} of {totalResults} results — refine
          the search to see the rest.
        </p>
      )}
    </Panel>
  );
}

/** The overflow half of the scope chips — the scopes that don't fit the primary
 *  row, as a checkbox menu.
 *
 *  Folded onto `<AnchoredMenu>` + `<MenuToggleRow>` (task 143). It was the most
 *  denuded of the three hand-rolled dropdowns: `top = rect.bottom + 4, left =
 *  rect.left` with no flip in EITHER axis, no clamp, no re-anchor, and no menu
 *  semantics at all — its rows rendered a ✓ with nothing for a screen reader to
 *  read it from. The per-scope colour dot survives as the row's `leading` slot,
 *  which is the one thing these rows had that the shared row didn't. */
function MoreScopesDropdown({
  scopes,
  enabledScopes,
  onToggle,
}: {
  scopes: SearchScope[];
  enabledScopes: Set<SearchScope>;
  onToggle: (scope: SearchScope) => void;
}) {
  const enabledCount = scopes.filter((s) => enabledScopes.has(s)).length;
  // ONE version-subscribed lookup for the whole menu — a per-scope hook inside
  // the `.map` below would be a rules-of-hooks violation.
  const scopeAccent = useScopeAccent();

  const active = enabledCount > 0;

  return (
    <AnchoredMenu
      ariaLabel="More scopes"
      align="start"
      triggerHint="More scopes"
      // The count badge lives INSIDE the trigger, so before the shell owned the
      // button the accessible name was computed from its contents ("More 3").
      // A static `aria-label` would silently swallow that — assistive tech would
      // hear the same name with zero or five overflow scopes on — so the count
      // is folded into the name rather than dropped.
      triggerAriaLabel={
        enabledCount > 0 ? `More scopes, ${enabledCount} on` : "More scopes"
      }
      wrapperClassName="relative"
      menuClassName="min-w-[140px]"
      triggerClassName={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] transition-colors ${
        active
          ? "border-edge-hover bg-white/70 text-ink-body"
          : "border-edge-subtle bg-transparent text-ink-muted hover:text-ink-subtle"
      }`}
      trigger={(open) => (
        <>
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
        </>
      )}
    >
      {scopes.map((s) => (
        <MenuToggleRow
          key={s}
          id={`scope-${s}`}
          label={SCOPE_LABEL[s]}
          checked={enabledScopes.has(s)}
          keepMenuOpen
          leading={
            <span
              aria-hidden
              className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
              style={{
                backgroundColor: scopeDotBackground(scopeAccent(s)),
                opacity: enabledScopes.has(s) ? 1 : 0.4,
              }}
            />
          }
          onToggle={() => onToggle(s)}
        />
      ))}
    </AnchoredMenu>
  );
}

/** Live (user-override-aware) twin of the shipped-defaults `SCOPE_COLOR` table.
 *
 *  Returns a LOOKUP FUNCTION rather than a single color so a caller that paints
 *  N scopes (the scope menu's `.map`) can stay rules-of-hooks-legal: one
 *  version-subscribed hook per component, not one per scope.
 *
 *  `SCOPE_COLOR` itself is an `Object.fromEntries` fold over
 *  `DEFAULT_PANEL_COLORS` evaluated once at module load, so it can never pick up
 *  a panel-color override — see the corrected note on its declaration in
 *  `lib/search-sources.ts`. Search results wear their SOURCE kind's accent, so
 *  reading the frozen table made every scope dot / result border / result card
 *  disagree with the very panel it points at once that panel was re-colored. */
function useScopeAccent(): (scope: SearchScope) => string {
  const colors = useAllPanelColors();
  return (scope) =>
    // mainText has no source kind — it stays transparent (rendered as a neutral
    // stone dot by each call site), exactly as SCOPE_COLOR encodes.
    scope === "mainText" ? "transparent" : colors[SCOPE_TO_CARD_THEME[scope]];
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
  const color = useScopeAccent()(scope);
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
          backgroundColor: scopeDotBackground(color),
          opacity: enabled ? 1 : 0.4,
        }}
      />
      <span>{SCOPE_LABEL[scope]}</span>
      {enabled && <span className="text-[9px] leading-none">✓</span>}
    </button>
  );
}

// memo: with the stable `onClick` (the panel's single `handleResultClick`)
// every prop is identity-stable across the urgent input-echo render, so up to
// MAX_RENDERED_RESULTS cards bail per keystroke instead of re-rendering.
const ResultCard = memo(function ResultCard({
  idx,
  result,
  selected,
  onClick,
}: {
  idx: number;
  result: SearchResult;
  selected: boolean;
  onClick: (result: SearchResult, idx: number) => void;
}) {
  const color = useScopeAccent()(result.scope);
  const borderStyle: React.CSSProperties =
    color === "transparent"
      ? {}
      : { borderLeftColor: color, borderLeftWidth: 3 };
  const scopeLabel = SCOPE_LABEL[result.scope];
  const fieldLabel = result.field ? FIELD_LABEL[result.field] : undefined;
  const showScopeLabel = result.scope !== "mainText";
  // Version-subscribed: this card is `memo`'d on identity-stable props, so the
  // hook subscription is what re-renders it when its source panel is recolored.
  const theme = useCardTheme(SCOPE_TO_CARD_THEME[result.scope]);

  return (
    <button
      data-result-idx={idx}
      className={`${themedCard(theme, selected)} w-full text-left`}
      onClick={() => onClick(result, idx)}
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
          {/* The matched run IS a text highlight, so it takes the purpose-built
              `--amber-highlight-*` family (the wash the app's other lit/selected
              text surfaces read) rather than a raw `bg-amber-200/80`, which
              resolves to Tailwind v4's default amber — a colour this repo's
              amber scale does not contain. Task 309. */}
          <mark className="bg-[var(--amber-highlight-wash-active)] text-[var(--amber-highlight-ink)] rounded-sm px-px">
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
});

export default memo(SearchPanel);
