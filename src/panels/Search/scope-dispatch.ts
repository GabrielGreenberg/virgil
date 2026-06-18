/**
 * T5 Pillar D — the scope-completeness guard for the unified SearchPanel.
 *
 * Before this, `SearchPanel.results` ran a hand-written if-ladder, one `if
 * (enabledScopes.has("X"))` per scope. That ladder silently dropped any scope
 * that had a chip + a label + a search function but no `if` branch — exactly
 * what happened to `reports` (SR-F3-02 / SR-A1-01 / SR-F7-01): the chip showed,
 * the `searchReports` helper existed, but nothing ever called it.
 *
 * `SCOPE_DISPATCH` is a `Record<SearchScope, SearchFn>` — a TOTAL map over the
 * `SearchScope` union. TypeScript fails the build if a `SearchScope` member is
 * added without a dispatch entry (a `Record<K, V>` literal must supply every
 * `K`). So a future scope cannot be enumerated in `SCOPE_ORDER`/`SCOPE_LABEL`
 * yet go unsearched — the omission is a compile error, not a runtime no-op.
 *
 * Each entry receives the same `ScopeSearchCtx` bundle (all collections + the
 * editor + the compiled regex) and returns the scope's `SearchHit[]`. The
 * panel calls only the entries whose scope is enabled.
 */

import type { Editor } from "@tiptap/react";
import {
  type SearchScope,
  type SearchHit,
  type FootnoteSearchItem,
  type EditorCitationItem,
  searchFootnotes,
  searchNotes,
  searchCitations,
  searchTodos,
  searchArchive,
  searchCutter,
  searchReports,
  searchComments,
  searchBibliography,
} from "@/lib/search-sources";
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

/** Everything a per-scope search function might need. The editor + regex are
 *  always present; collection arrays default to empty so the Reader path (no
 *  sidecars) can search a subset without threading every prop. */
export interface ScopeSearchCtx {
  editor: Editor;
  re: RegExp;
  /** Lazily-built UUID→pos map, shared across the anchored-collection scopes
   *  (notes/todos/archive/cuts) so the doc is walked once, not per scope. */
  uuidPos: Map<string, number>;
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
  /** Main-text search is editor-coupled and lives in SearchPanel (its PM
   *  block-span index + live-range identity are panel-local); the panel
   *  supplies it here so the dispatch table stays the single enumeration. */
  searchMainText: (editor: Editor, re: RegExp) => SearchHit[];
}

export type ScopeSearchFn = (ctx: ScopeSearchCtx) => SearchHit[];

/**
 * Total map: ONE entry per `SearchScope`. Adding a scope to the union without
 * an entry here is a compile error (the object literal must satisfy
 * `Record<SearchScope, ScopeSearchFn>`).
 */
export const SCOPE_DISPATCH: Record<SearchScope, ScopeSearchFn> = {
  mainText: (c) => c.searchMainText(c.editor, c.re),
  footnotes: (c) => searchFootnotes(c.footnotes, c.orphanedFootnotes, c.re),
  notes: (c) => searchNotes(c.notes, c.editor, c.uuidPos, c.re),
  citations: (c) =>
    searchCitations(
      c.citations,
      c.editorCitations,
      c.getCitationDisplayText,
      c.re,
    ),
  todos: (c) => searchTodos(c.todos, c.uuidPos, c.re),
  archive: (c) => searchArchive(c.archiveSnippets, c.uuidPos, c.re),
  cuts: (c) => searchCutter(c.cutterCards, c.editor, c.uuidPos, c.re),
  reports: (c) => searchReports(c.reportCards, c.editor, c.uuidPos, c.re),
  revisions: (c) => searchComments(c.comments, c.editor, c.re),
  bibliography: (c) => searchBibliography(c.bibEntries, c.re),
};

/** Scopes that need the shared UUID→pos map. The panel builds the map only
 *  when one of these is enabled (the doc walk isn't free). Derived so a new
 *  uuid-anchored scope can't be forgotten — see the test. */
export const UUID_POS_SCOPES: readonly SearchScope[] = [
  "notes",
  "todos",
  "archive",
  "cuts",
  "reports",
];
