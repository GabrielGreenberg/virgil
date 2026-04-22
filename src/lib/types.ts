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

// --- Revisions (Claude-cowork dialogue) ---

export interface RevisionUser {
  id: string;
  name: string;
  color: string; // hex
  isDefault?: boolean; // locked / built-in
}

export interface RevisionTurn {
  id: string;
  authorId: string;
  createdAt: string;
  text: string;
}

export interface GeneralRevision {
  id: string;
  authorId: string;
  createdAt: string;
  text: string;
  turns: RevisionTurn[];
  resolved: boolean;
}

export interface TextRevision {
  id: string;
  authorId: string;
  createdAt: string;
  resolved: boolean;
  selectedText: string;
  text: string;
  turns: RevisionTurn[];
  /** All connections this revision makes to the editor: Mode B
   *  text-range anchor, paragraph anchors, etc. See src/links/links.ts. */
  links: Link[];
}

export interface RevisionsState {
  users: RevisionUser[];
  generalRevisions: GeneralRevision[];
  textRevisions: TextRevision[];
  activeUserId?: string;
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
  | "quotation"
  | "citation"
  | "todo";

export interface AiRequest {
  id: string;
  kind: AiRequestKind;
  text: string;
  createdAt: string;
  status: "draft" | "submitted" | "complete";
  // Reserved for the AI fulfillment follow-up. Unused in this PR.
  resultId?: string;
}

export interface AiRequestsState {
  requests: AiRequest[];
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

// --- Notes ---

export interface UserNote {
  id: string;
  title: string; // optional display title (empty string if untitled)
  // Tiptap JSONContent doc — see normalizeRichContent for accepted shapes.
  // Legacy notes were stored as HTML strings; the helper migrates them on read.
  content: unknown;
  createdAt: string;
  links: Link[];
}

export interface NotesState {
  notes: UserNote[];
}

// --- Cutter ---

export interface CutItem {
  id: string;
  title: string;
  /** Tiptap JSONContent — the cut text body (editable once on the card). */
  content: unknown;
  createdAt: string;
  links: Link[];
}

export interface CutterState {
  cuts: CutItem[];
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
