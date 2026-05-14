import type { Link } from "@/links/_shared/types";

export interface ParagraphMeta {
  title?: string;
  fingerprint?: string;
}

export interface VirgilSidecar {
  paragraphs: Record<string, ParagraphMeta>;
}

export interface EditorStateData {
  cursorPosition: number;
  selection: { anchor: number; head: number } | null;
  lastModified: string;
}

export interface Suggestion {
  id: string;
  explanation: string;
  original_text: string;
  suggested_text: string;
  revision: string;
  note: string;
  status: "pending" | "accepted" | "rejected" | "skipped";
}

export interface SuggestionsState {
  suggestions: Suggestion[];
  currentIndex: number;
  reviewedAt: string;
  documentHash: string;
}

export interface SessionState {
  lastReviewedAt: string | null;
  lastSavedAt: string;
  totalReviews: number;
}

export interface DocumentPayload {
  content: Record<string, unknown>;
  editorState: EditorStateData;
}

export interface ReviewRequest {
  proseText: string;
}

export interface ClaudeSuggestion {
  explanation: string;
  original_text: string;
  suggested_text: string;
}

export interface UserComment {
  id: string;
  selectedText: string;
  comment: string;
  createdAt: string;
  resolved: boolean;
}

export interface CommentsState {
  comments: UserComment[];
}

// --- Revisions ---
//
// The Revisions panel hosts two polymorphic card kinds — comments and
// suggestions — sharing the structure of the Cutter cards. The two panels
// hold distinct sets of cards (different sidecar files). The Revisions
// panel additionally tracks a per-document "revisions accepted" counter
// (see RevisionsTracker), in lieu of Cutter's word-count goal.

export interface RevisionCommentCard {
  kind: "comment";
  id: string;
  createdAt: string;
  /** Plain-text mirror of `content`, kept in sync on every write. */
  text: string;
  /** Tiptap JSONContent — canonical editable body. */
  content: unknown;
  /** Flags this comment as something the user wants Claude to act on. */
  aiRequest: boolean;
  /** Mode B captured text (undefined for paragraph-only / unanchored). */
  selectedText?: string;
  links: Link[];
}

export interface RevisionSuggestionCard {
  kind: "suggestion";
  id: string;
  createdAt: string;
  author: "human" | "ai";
  original_text: string;
  suggested_text: string;
  explanation: string;
  user_text: string;
  instructions: string;
  status: "pending" | "accepted" | "rejected";
  selectedText?: string;
  links: Link[];
}

export type RevisionCard = RevisionCommentCard | RevisionSuggestionCard;

export interface RevisionsTracker {
  /** Optional target number of accepted revisions to aim for. */
  target?: number | null;
  /** ISO timestamp the target was set. */
  setAt?: string | null;
}

export interface RevisionsState {
  cards: RevisionCard[];
  tracker?: RevisionsTracker | null;
}

export interface ArchivedSnippet {
  id: string;
  /** Optional display title (empty string if untitled). */
  title: string;
  /** Rich content (Tiptap JSONContent). Legacy snippets stored plain `text`;
   *  the useArchive hook migrates them to JSONContent on load. */
  content: unknown;
  createdAt: string;
  /** All paragraphs this snippet is anchored to. See src/links/links.ts
   *  for helpers (getLinkedParagraphIds, addParagraphLink, …). */
  links: Link[];
}

export interface ArchiveState {
  snippets: ArchivedSnippet[];
}

export interface TodoItem {
  id: string;
  text: string;
  notes: string;
  done: boolean;
  aiRequest: boolean;
  createdAt: string;
  links: Link[];
}

export interface TodoState {
  items: TodoItem[];
}

// --- AI Requests (unified parallel store across panels) ---

export type AiRequestKind =
  | "footnote"
  | "note"
  | "highlight"
  | "quotation"
  | "citation"
  | "todo"
  | "suggestion"
  | "style-merge";

/**
 * Kind-specific structured payload. The `style-merge` payload inlines
 * the source and target preambles because the agent that fulfills the
 * request runs outside the app and can't import the style library.
 */
export type AiRequestPayload =
  | {
      kind: "style-merge";
      targetStyleId: string;
      targetStyleName: string;
      targetPreamble: string;
      currentPreamble: string;
    };

/** Origin card when a request was emitted by toggling a card-level
 *  `aiRequest: true` flag (notes / todos / cutter-comments / revision-comments).
 *  Lets a fulfillment skill load the source card and update it on completion. */
export interface AiRequestLink {
  panel: "notes" | "todos" | "cutter" | "revisions";
  cardId: string;
}

export interface AiRequest {
  id: string;
  kind: AiRequestKind;
  text: string;
  createdAt: string;
  status: "draft" | "submitted" | "complete";
  resultId?: string;
  /** Kind-specific structured payload. Set for `style-merge` (and any
   *  future kind that needs more than free-form `text`). */
  payload?: AiRequestPayload;
  /** Paragraph UUID(s) (`%!v:xxxx` markers) the request anchors to. Set on
   *  creation so a fulfillment skill can load the surrounding .tex without
   *  re-deriving from the source card. */
  paragraphIds?: string[];
  /** Text the user had selected (Mode B) when filing the request. */
  selectedText?: string;
  /** Origin card if this request was bridged from a card-level flag. */
  linkedTo?: AiRequestLink;
}

export interface AiRequestsState {
  requests: AiRequest[];
}

// --- Doc-scoped notifications (skill completions) ---

/** One item Claude appends to the doc's `virgil/notifications.json` inbox
 *  when an AI request completes (or fails). The frontend polling hook
 *  toasts every new entry. */
export interface DocNotification {
  kind: "ai-request-complete" | "ai-request-failed";
  at: string;
  summary: string;
  requestId?: string;
}

export interface DocNotificationsInbox {
  items: DocNotification[];
}

// --- Citations ---

export interface BibEntry {
  key: string;
  type: string; // "article", "book", "inproceedings", etc.
  fields: Record<string, string>;
  raw: string; // original BibTeX source for this entry
}

export interface CitationRef {
  id: string;
  command: string; // full LaTeX command, e.g. "\citep[see][ch.2]{jones1990,smith2001}"
  keys: string[]; // extracted cite keys
  createdAt: string;
  /** When true, this citation has no corresponding node in the editor —
   *  the user created it via the panel + button and may later drag it
   *  into the document to anchor it. Anchored citations omit this flag.
   *  Persisted alongside the rest of the citation state so an unanchored
   *  card survives across reloads (the editor regenerates anchored ids
   *  on every parse, so we can only carry forward entries flagged here).
   *  Read this through `isUnanchored(card)` in @/links/links.ts rather
   *  than accessing the field directly. */
  unanchored?: boolean;
}

export interface CitationsState {
  citations: CitationRef[];
  bibPath: string; // relative path to .bib file
  citationStyle: string; // CSL template name: "apa", "chicago-author-date", "mla"
  bibPackage: string; // "natbib" | "biblatex"
}

export interface CitationInfo {
  citationId: string;
  command: string;
  displayText: string;
  pos: number;
}

// --- Footnotes (persistent state, supports unanchored) ---

export interface FootnoteRef {
  id: string;
  // Tiptap JSONContent doc — see normalizeRichContent for accepted shapes.
  // Legacy footnotes stored HTML strings; migrated on read.
  content: unknown;
  createdAt: string;
}

export interface FootnotesState {
  footnotes: FootnoteRef[];
}

// --- Examples (expex package, persistent metadata sidecar) ---

/** Sidecar shadow of an `exampleBlock` node. The canonical representation
 *  lives in the `.tex` (as `\ex … \xe` / `\pex … \xe`) — this ref carries
 *  per-example panel metadata the editor can't easily re-derive (custom
 *  title override, timestamps). Matched back to the editor by `id`, which
 *  is the `\vexid{…}` uuid. */
export interface ExampleRef {
  id: string;
  /** `\ex<tag>` angle-bracket tag, if any. Mirrors the node attr for quick
   *  panel filtering without re-walking the doc. */
  tag: string;
  /** Inner `\label{…}` on the example, if any. Mirror of node attr. */
  label: string;
  /** Optional panel-only display title. Doesn't serialize back to the
   *  `.tex` — this is a panel UX affordance. */
  title: string;
  createdAt: string;
}

export interface ExamplesState {
  examples: ExampleRef[];
}

// --- Notes ---
//
// The Notes panel hosts two polymorphic card kinds — notes and highlights.
// Highlights wrap a text range with a colored tint (Adobe-style); notes
// carry a rich-text body. Adding a note to an existing highlight spawns a
// SIBLING note card sharing the same anchor (no morph; both cards live
// alongside one another in the panel). The two coexist in a single
// `cards` array; legacy `{ notes: [...] }` sidecars are migrated on load.

/**
 * Sidecar field set when a Mode B (text-range-anchored) card is
 * re-anchored to a paragraph-only Mode A anchor via drop mode. Saves
 * the original anchor data so future UX can restore the text range
 * or surface a "was a highlight" affordance. Drop mode only writes
 * this field; nothing reads it yet.
 */
export interface OriginalAnchor {
  /** ISO timestamp of when the swap to Mode A happened. */
  droppedAt: string;
  /** Original linkedAnchor mark id (before strip). */
  anchorId: string;
  /** Text inside the original range (for fuzzy re-anchoring later). */
  textSnapshot: string;
  /** Paragraph UUID(s) the original anchor sat in. */
  paragraphIds: string[];
}

export interface UserNote {
  kind: "note";
  id: string;
  title: string; // optional display title (empty string if untitled)
  // Tiptap JSONContent doc — see normalizeRichContent for accepted shapes.
  // Legacy notes were stored as HTML strings; the helper migrates them on read.
  content: unknown;
  createdAt: string;
  /** Mirror of TodoItem.aiRequest — flags this note as something the user
   *  wants Claude to act on. Toggled via the per-card AiRequestCheckbox. */
  aiRequest: boolean;
  links: Link[];
  /** Set when a Mode B note was re-anchored to a paragraph via drop
   *  mode; preserves the original textRange data for future use. */
  originalAnchor?: OriginalAnchor;
}

export interface HighlightCard {
  kind: "highlight";
  id: string;
  createdAt: string;
  /** Hex color override; null = panel-theme default. v1 always null. */
  highlightColor: string | null;
  aiRequest: boolean;
  /** Must carry exactly one text-range anchor link. */
  links: Link[];
  /** Set when this highlight was re-anchored to a paragraph via drop
   *  mode; preserves the original textRange + tint so we can later
   *  offer to restore the highlight from sidecar data. */
  originalAnchor?: OriginalAnchor;
}

export type NoteCardItem = UserNote | HighlightCard;

export interface NotesState {
  cards: NoteCardItem[];
}

// --- Cutter ---
//
// The Cutter panel hosts two polymorphic card kinds: comments and
// suggestions. Anchored cards may be paragraph-only (Mode A) or carry a
// text-range linkedAnchor mark (Mode B). Suggestion cards expose an
// Accept action that flips status and enqueues an AiRequest so Claude
// can apply the textual replacement out-of-band; the editor never
// mutates the document on accept.

export interface CutterCommentCard {
  kind: "comment";
  id: string;
  createdAt: string;
  /** Plain-text mirror of `content`, kept in sync on every write. */
  text: string;
  /** Tiptap JSONContent — canonical editable body. */
  content: unknown;
  /** Mirror of TodoItem.aiRequest — flags this comment as something the
   *  user wants Claude to act on. */
  aiRequest: boolean;
  /** Mode B captured text (undefined for paragraph-only / unanchored). */
  selectedText?: string;
  links: Link[];
}

export interface CutterSuggestionCard {
  kind: "suggestion";
  id: string;
  createdAt: string;
  /** Who composed this suggestion. Human-authored cards default to filling
   *  any of the fields directly; AI-authored cards typically arrive with
   *  the first three fields populated and `user_text` empty for the human
   *  to refine before accepting. */
  author: "human" | "ai";
  /** Target text reproduced (captured at creation; user-editable). */
  original_text: string;
  /** Suggested replacement (user-editable). */
  suggested_text: string;
  /** Comment / explanation of the cut/replacement. */
  explanation: string;
  /** Human's revised version of `suggested_text`. Empty until the user
   *  copies + edits the AI suggestion (or types their own). */
  user_text: string;
  /** Optional free-form instructions for the AI on AI-authored cards
   *  (e.g. "make it punchier", "preserve the citation"). Hidden behind
   *  a collapsed affordance on human-authored cards — empty in practice. */
  instructions: string;
  status: "pending" | "accepted" | "rejected";
  selectedText?: string;
  links: Link[];
}

export type CutterCard = CutterCommentCard | CutterSuggestionCard;

export interface CutterGoal {
  /** Desired final word count for the document. */
  target: number;
  /** Live word count snapshotted at the moment the goal was set, used to
   *  compute progress without replaying cut history. */
  initialWords: number;
  /** ISO timestamp the goal was set. */
  setAt: string;
}

export interface CutterState {
  cards: CutterCard[];
  goal?: CutterGoal | null;
}

/** Legacy shape — kept only for the migration path in useCutter.ts. */
export interface CutItemLegacy {
  id: string;
  title: string;
  content: unknown;
  createdAt: string;
  links: Link[];
}

// --- Annotations ---

export interface AnnotationsState {
  [bibKey: string]: string; // bib key → annotation text
}

// --- Bib Review Requests ---

export interface BibReviewRequest {
  bibKey: string;
  type: "fields" | "notes";
  requestedAt: string;
  status: "pending" | "complete";
  requestNotes?: string;
}

export interface BibReviewState {
  requests: BibReviewRequest[];
}

// --- Bib Settings (general bibliography, entry requests) ---

export interface BibEntryRequest {
  id: string;
  description: string;
  status: "pending" | "complete";
  createdAt: string;
  resolvedKey?: string;
}

export interface BibSettings {
  generalBibPath: string | null;
  entryRequests: BibEntryRequest[];
}

/**
 * Quotation hierarchy:
 *   QuotationGroup
 *     ├─ title (one big title for the whole group)
 *     ├─ references: Reference[]
 *     │     ├─ citeKey (each reference has its own citation)
 *     │     └─ quotes: Quote[]
 *     │           ├─ text
 *     │           └─ page
 *     └─ notes / paragraphId
 */

export interface Quote {
  id: string;
  text: string;
  page: string;
}

export interface Reference {
  id: string;
  citeKey: string;
  quotes: Quote[];
}

export interface QuotationGroup {
  id: string;
  title: string;
  references: Reference[];
  notes: string;
  createdAt: string;
  links: Link[];
}

export interface QuotationsState {
  groups: QuotationGroup[];
}

// --- Orphaned Footnotes ---

export interface OrphanedFootnote {
  footnoteId: string;
  // Tiptap JSONContent doc — see normalizeRichContent for accepted shapes.
  content: unknown;
  title?: string;
  orphanedAt: string;
}
