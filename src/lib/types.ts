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
