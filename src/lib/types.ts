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

export interface DocMeta {
  id: string;
  name: string;
  createdAt: string;
  lastModifiedAt: string;
  sourcePath: string; // absolute path to the .tex file
}

export interface FileIndex {
  docs: DocMeta[];
}

export interface ArchivedSnippet {
  id: string;
  text: string;
  createdAt: string;
}

export interface ArchiveState {
  snippets: ArchivedSnippet[];
}

export interface TodoItem {
  id: string;
  text: string;
  notes: string;
  done: boolean;
  createdAt: string;
}

export interface TodoState {
  items: TodoItem[];
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
  content: string;
  createdAt: string;
}

export interface FootnotesState {
  footnotes: FootnoteRef[];
}

// --- Notes ---

export interface UserNote {
  id: string;
  title: string; // optional display title (empty string if untitled)
  content: string; // HTML string (rich text from mini editor)
  anchorPos: number; // document position the note is tied to
  createdAt: string;
}

export interface NotesState {
  notes: UserNote[];
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
  paragraphId: string | null;
  notes: string;
  createdAt: string;
}

export interface QuotationsState {
  groups: QuotationGroup[];
}

// --- Orphaned Footnotes ---

export interface OrphanedFootnote {
  footnoteId: string;
  content: string;
  orphanedAt: string;
}
