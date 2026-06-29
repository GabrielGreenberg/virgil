import type { Link } from "@/links/_shared/types";

export interface ParagraphMeta {
  title?: string;
  fingerprint?: string;
  /** Sticky collapse state. Currently only set by texBlock — true means the
   *  block should render its compact preview instead of the full editor. */
  collapsed?: boolean;
}

export interface VirgilSidecar {
  paragraphs: Record<string, ParagraphMeta>;
}

export interface EditorStateData {
  /** Paragraph UUID the cursor was in at last write. null = unknown / top of doc. */
  lastParagraphId: string | null;
  /** UUIDs of top-level headings currently folded. */
  foldedSections: string[];
  /** Scroll offset (px) of the editor's scroll container at last write. Restored
   *  on cold mount so an evicted/reloaded doc returns to exactly where it was —
   *  matching the warm-mount experience (Phase D). undefined = top / unknown. */
  scrollTop?: number;
  lastModified: string;
  /** @deprecated kept optional so older on-disk sidecars don't error on read. */
  cursorPosition?: number;
  /** @deprecated kept optional so older on-disk sidecars don't error on read. */
  selection?: { anchor: number; head: number } | null;
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
  /** Archived (set aside): hidden from active list / omni / in-doc; shown under
   *  View Archives/All. Absent ≡ active. See isArchivable (cards/predicates.ts). */
  archived?: boolean;
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
  /** Archived (set aside): hidden from active list / omni / in-doc; shown under
   *  View Archives/All. Absent ≡ active. See isArchivable (cards/predicates.ts). */
  archived?: boolean;
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

// --- Reports ---
//
// The Reports panel hosts two polymorphic card kinds — reports and report
// requests — sharing the free-form rich-text body of Notes. A Report is an
// authored content card (carries an `author` + a name/timestamp byline); a
// Report Request is the user's "ask": a titleless card with an `aiRequest`
// flag. A Report is normally produced by the answer-report-request skill
// answering a Request, but a human can also author one directly.

export interface ReportCard {
  kind: "report";
  id: string;
  createdAt: string;
  /** Archived (set aside): hidden from active list / omni / in-doc; shown under
   *  View Archives/All. Absent ≡ active. See isArchivable (cards/predicates.ts). */
  archived?: boolean;
  /** Display author. "ai" renders as "AI"; "human" renders the user's name. */
  author: "human" | "ai";
  title: string;
  /** Title provenance (T6/C12). `true` = the title was machine-supplied and
   *  may be discarded on load / never persisted as user content; `false` =
   *  user-owned (typed into the title field), never strip. `undefined` =
   *  pre-T6 legacy record — `resolveLoadedTitle` falls back to the shape
   *  heuristic once, then self-stamps the bit. Records the fact we used to
   *  guess from the title's shape (the auto-title false-positive class). */
  titleAuto?: boolean;
  /** Plain-text mirror of `content`, kept in sync on every write. */
  text: string;
  /** Tiptap JSONContent — canonical editable body. */
  content: unknown;
  /** Mode B captured text (undefined for paragraph-only / unanchored). */
  selectedText?: string;
  links: Link[];
}

export interface ReportRequestCard {
  kind: "report-request";
  id: string;
  createdAt: string;
  /** Archived (set aside): hidden from active list / omni / in-doc; shown under
   *  View Archives/All. Absent ≡ active. See isArchivable (cards/predicates.ts). */
  archived?: boolean;
  /** Plain-text mirror of `content`, kept in sync on every write. */
  text: string;
  /** Tiptap JSONContent — canonical editable body. */
  content: unknown;
  /** Flags this request as something the user wants Claude to act on. */
  aiRequest: boolean;
  /** Mode B captured text (undefined for paragraph-only / unanchored). */
  selectedText?: string;
  links: Link[];
}

export type ReportItem = ReportCard | ReportRequestCard;

export interface ReportsState {
  cards: ReportItem[];
}

export interface ArchivedSnippet {
  id: string;
  /** Archived (set aside): hidden from active list / omni / in-doc; shown under
   *  View Archives/All. Absent ≡ active. Distinct from this card being an Archive
   *  text-object snippet — see isArchivable (cards/predicates.ts). */
  archived?: boolean;
  /** Optional display title (empty string if untitled). */
  title: string;
  /** Title provenance (T6/C12). See `ReportCard.titleAuto`. */
  titleAuto?: boolean;
  /** Rich content (Tiptap JSONContent). Legacy snippets stored plain `text`;
   *  the useArchive hook migrates them to JSONContent on load. */
  content: unknown;
  createdAt: string;
  /** All paragraphs this snippet is anchored to. See src/links/links.ts
   *  for helpers (getLinkedTextObjectIds, addTextObjectLink, …). */
  links: Link[];
}

export interface ArchiveState {
  snippets: ArchivedSnippet[];
}

export interface TodoItem {
  id: string;
  /** Archived (set aside): hidden from active list / omni / in-doc; shown under
   *  View Archives/All. Absent ≡ active. Orthogonal to `done`. See isArchivable
   *  (cards/predicates.ts). */
  archived?: boolean;
  text: string;
  /** Title provenance (T6/C12) — for a todo the "title" IS the body `text`
   *  (the legacy seed put a generated "Task N" there). `true` = machine-seeded
   *  body, strippable on load; `false` = user-typed. See `ReportCard.titleAuto`. */
  titleAuto?: boolean;
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
  | "citation"
  | "todo"
  | "suggestion"
  | "report"
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
  panel: "notes" | "todos" | "cutter" | "revisions" | "reports" | "footnotes";
  cardId: string;
}

/** Lifecycle of a Task — *where it is* (EDITOR_SKILLS_V1 §7). The legacy
 *  `draft` / `submitted` values still appear on disk in papers created before
 *  v1; they parse fine and are treated as open (≈ `pending`) by readers
 *  (`list_requests.py`, the card-flag bridge). New writes use the v1 values. */
export type AiRequestStatus =
  | "pending"
  | "in-progress"
  | "complete"
  | "failed"
  | "draft"
  | "submitted";

/** Outcome of a Task — *how it ended* (EDITOR_SKILLS_V1 §7). Set only on a
 *  terminal status (`complete` / `failed`); absent while `pending` /
 *  `in-progress`. Distinct from `resultId`, which points at the produced card. */
export type AiRequestResult =
  | "accepted"
  | "rejected"
  | "auto-applied"
  | "silent-applied"
  | "direct-created"
  | "refused"
  | "impossible"
  | "errored";

export interface AiRequest {
  id: string;
  kind: AiRequestKind;
  text: string;
  createdAt: string;
  /** Lifecycle (where it is). See {@link AiRequestStatus}. */
  status: AiRequestStatus;
  /** Outcome (how it ended) — set only on a terminal status. */
  result?: AiRequestResult;
  /** How aggressively the user wants the change landed (per-Task). Drives the
   *  `apply_response.py` subcommand: 1→write-silent, 2→write-with-comment,
   *  3→complete-task (propose). Absent ⇒ the skill asks, or treats it as a
   *  direct create the user opted into. */
  safetyLevel?: 1 | 2 | 3;
  /** Pointer to the result card this request produced. Distinct from `result`
   *  (the outcome enum). */
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
  /** Durable internal id, minted once and round-tripped via a `\vbid{}`
   *  marker in the `.bib`. Decoupled from the renameable citekey: a rename
   *  changes `key`, never `uid`, so uid-keyed sidecars never strand, and two
   *  entries that share a citekey get two distinct uids. Minted on first
   *  parse for a markerless `.bib`; not yet consumed by UI (T1 Stage 0). */
  uid: string;
  key: string;
  type: string; // "article", "book", "inproceedings", etc.
  fields: Record<string, string>;
  raw: string; // original BibTeX source for this entry
}

export interface CitationRef {
  id: string;
  /** Archived (set aside): hidden from active list / omni / in-doc; shown under
   *  View Archives/All. Absent ≡ active. Archiving a citation splices its `\cite`
   *  atom out (becomes `unanchored`); see archiveRemovesAtom (cards/predicates.ts). */
  archived?: boolean;
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
  /** Archived (set aside): hidden from active list / omni / in-doc; shown under
   *  View Archives/All. Absent ≡ active. Archiving a footnote splices its
   *  `\footnote` atom out (survives sync as an unanchored ref); see
   *  archiveRemovesAtom (cards/predicates.ts). */
  archived?: boolean;
  /** Per-card "AI request" flag (BUG #55). Mirrors note/todo/comment.aiRequest:
   *  flags this footnote as something the user wants Claude to act on. Toggling
   *  it bridges a `kind: "footnote"` entry into `ai-requests.json` (the unified
   *  queue) via `bridgeCardAiRequestFlag`. Absent ≡ false. The flag lives in
   *  the `footnotes.json` sidecar (not the live `FootnoteInfo`, which is derived
   *  from the .tex) — the same home as `archived`. */
  aiRequest?: boolean;
  /** When true, this footnote has no corresponding `\footnote` atom in the
   *  editor — it was set aside (archived) or the user may later re-place it.
   *  Mirrors CitationRef.unanchored: archiving sets BOTH `archived` and
   *  `unanchored` so the atomless ref survives `syncFromEditor` (which keeps any
   *  ref absent from the editor) and the panel can list it under Archives. An
   *  unarchive clears `archived` but leaves `unanchored` (the atom is NOT
   *  re-inserted — the card returns as a re-placeable unanchored ref). */
  unanchored?: boolean;
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
  /** Title provenance (T6/C12). See `ReportCard.titleAuto`. */
  titleAuto?: boolean;
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
  /** Archived (set aside): hidden from active list / omni / in-doc; shown under
   *  View Archives/All. Absent ≡ active. See isArchivable (cards/predicates.ts). */
  archived?: boolean;
  title: string; // optional display title (empty string if untitled)
  /** Title provenance (T6/C12). See `ReportCard.titleAuto`. */
  titleAuto?: boolean;
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
  /** Archived (set aside): hidden from active list / omni / in-doc; shown under
   *  View Archives/All. Absent ≡ active. See isArchivable (cards/predicates.ts). */
  archived?: boolean;
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
  /** Archived (set aside): hidden from active list / omni / in-doc; shown under
   *  View Archives/All. Absent ≡ active. See isArchivable (cards/predicates.ts). */
  archived?: boolean;
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
  /** Archived (set aside): hidden from active list / omni / in-doc; shown under
   *  View Archives/All. Absent ≡ active. See isArchivable (cards/predicates.ts). */
  archived?: boolean;
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

/**
 * Legacy annotations sidecar shape: a flat `citekey → html` record. A renamed
 * citekey stranded its annotation here (DATA-LOSS, BIB-A2-01). Kept as a named
 * type for the migration path; the live shape under the identity-cascade flag
 * is {@link AnnotationsStateV2}.
 */
export interface AnnotationsState {
  [bibKey: string]: string; // bib key → annotation text
}

/**
 * Uid-keyed annotations sidecar (T1 Stage 1). Annotations now key on the
 * durable {@link BibEntry.uid} so a citekey rename is a no-op here — they were
 * never pointing at the mutable thing.
 *
 * Migration is NON-DESTRUCTIVE (PLAN D4): a legacy citekey-keyed record is
 * mapped to uids via the freshly-parsed entries; any citekey that can't be
 * matched (e.g. renamed before the upgrade) lands in `orphanByKey`, never
 * dropped — a wrong/unmatched mapping is recoverable, not silent prose loss.
 */
export interface AnnotationsStateV2 {
  v: 2;
  /** uid → annotation html. */
  byUid: Record<string, string>;
  /** Legacy citekey → annotation html for entries whose uid couldn't be
   *  resolved at migration time. Re-homed onto `byUid` the next time an entry
   *  with that citekey is parsed and the annotation is touched. */
  orphanByKey: Record<string, string>;
}

// --- Bib Review Requests ---

export interface BibReviewRequest {
  bibKey: string;
  type: "fields" | "notes";
  requestedAt: string;
  status: "pending" | "complete";
  requestNotes?: string;
  /** Durable {@link BibEntry.uid} the request targets (T1 Stage 1). When set,
   *  this — not `bibKey` — is the identity: a citekey rename re-points nothing.
   *  `bibKey` is kept as a human-readable mirror (and the legacy fallback when
   *  the uid couldn't be resolved at migration time). */
  entryUid?: string;
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
  /** @deprecated The "general bibliography" feature (a user-picked
   *  external .bib file per doc) has been superseded by the central
   *  Virgil Library, which is now the only "global" bib. Preserved on
   *  read so old sidecars round-trip, but never written from the UI. */
  generalBibPath: string | null;
  entryRequests: BibEntryRequest[];
}

// --- Orphaned Footnotes ---

export interface OrphanedFootnote {
  footnoteId: string;
  // Tiptap JSONContent doc — see normalizeRichContent for accepted shapes.
  content: unknown;
  title?: string;
  // The dying footnote's `\thanks` attr, preserved so a re-dropped orphan
  // restores it (FN-A2-02 — full-attr orphan clone, T2 §3b.1/§4.2).
  thanks?: boolean;
  orphanedAt: string;
}

/**
 * The persisted shape of `virgil/orphaned-footnotes.json` (T2 §4.1, D4).
 * Carries an explicit `version` integer — the family standard for any NEW
 * sidecar file (PLAN D4). Absent file ⇒ `{ version: 1, orphans: [] }`; there
 * is nothing to migrate FROM (orphans were never durable before this), so an
 * existing paper simply starts empty.
 */
export interface OrphanedFootnotesState {
  version: 1;
  orphans: OrphanedFootnote[];
}
