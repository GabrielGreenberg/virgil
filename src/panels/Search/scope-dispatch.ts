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
import type { CardAnchorResolver } from "@/links/card-anchor-rows";
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
  /** The pane's card-anchor authority (`CardAnchorPass.resolve`, task 369) —
   *  the SAME resolution the margin marker and omni card read. Every card
   *  scope asks it "where is this card anchored?"; none re-derives it (task
   *  758). The pass is built once per structural change by its owner, so a
   *  search run walks no doc for card positions. */
  resolveCardAnchor: CardAnchorResolver;
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
  notes: (c) => searchNotes(c.notes, c.resolveCardAnchor, c.re),
  citations: (c) =>
    searchCitations(
      c.citations,
      c.editorCitations,
      c.getCitationDisplayText,
      c.re,
    ),
  todos: (c) => searchTodos(c.todos, c.resolveCardAnchor, c.re),
  archive: (c) => searchArchive(c.archiveSnippets, c.resolveCardAnchor, c.re),
  cuts: (c) => searchCutter(c.cutterCards, c.resolveCardAnchor, c.re),
  reports: (c) => searchReports(c.reportCards, c.resolveCardAnchor, c.re),
  revisions: (c) => searchComments(c.comments, c.resolveCardAnchor, c.re),
  bibliography: (c) => searchBibliography(c.bibEntries, c.re),
};
