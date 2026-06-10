import type {
  Dispatch,
  SetStateAction,
  RefObject,
} from "react";
import type { JSONContent, Editor } from "@tiptap/react";
import type { EditorHandle, FootnoteInfo, ExampleInfo } from "../Editor";
import type {
  UserNote,
  HighlightCard as HighlightCardData,
  ArchivedSnippet,
  CutterCard,
  CutterSuggestionCard as CutterSuggestionCardData,
  RevisionCard,
  RevisionSuggestionCard as RevisionSuggestionCardData,
  ReportItem,
  TodoItem,
  BibEntry,
  CitationRef,
  AiRequest,
} from "@/lib/types";

/**
 * Deps bundle for the popped-card renderer. Sourced entirely from the
 * EditorLayout shell; passed as one object to avoid a prop-list that
 * dominates the call site. Treat this as the public surface of "what
 * a popped-out card needs" — new card kinds extend this, not the
 * EditorLayout signature.
 *
 * Re-exported to the card spine as `CardFloatCtx` (`src/cards/card-float-ctx`);
 * the registry's per-kind `toFloatable(id, ctx)` builders receive this bag.
 */
export interface PoppedCardDeps {
  // Entity collections
  notes: UserNote[];
  highlights: HighlightCardData[];
  footnotes: FootnoteInfo[];
  archiveSnippets: ArchivedSnippet[];
  cutterCards: CutterCard[];
  todoItems: TodoItem[];
  bibEntries: BibEntry[];
  citations: CitationRef[];
  citationPositionMap: Map<string, number>;
  allEditorCitations: Array<{ citationId: string; command: string; keys: string[]; pos: number }>;
  comments: RevisionCard[];
  reportCards: ReportItem[];
  aiRequests: AiRequest[];
  examples: ExampleInfo[];
  anchoredIds?: Set<string>;

  // Selected-id slots
  selectedNoteId: string | null;
  selectedFootnoteId: string | null;
  selectedArchiveId: string | null;
  selectedCutterCardId: string | null;
  selectedReportCardId: string | null;
  selectedTodoId: string | null;
  selectedBibKey: string | null;
  selectedCitationId: string | null;
  selectedCommentId: string | null;
  selectedExampleId: string | null;
  setSelectedNoteId: Dispatch<SetStateAction<string | null>>;
  setSelectedFootnoteId: Dispatch<SetStateAction<string | null>>;
  setSelectedArchiveId: Dispatch<SetStateAction<string | null>>;
  setSelectedCutterCardId: Dispatch<SetStateAction<string | null>>;
  setSelectedReportCardId: Dispatch<SetStateAction<string | null>>;
  setSelectedTodoId: Dispatch<SetStateAction<string | null>>;
  setSelectedBibKey: Dispatch<SetStateAction<string | null>>;
  setSelectedCitationId: Dispatch<SetStateAction<string | null>>;
  setSelectedCommentId: Dispatch<SetStateAction<string | null>>;
  setSelectedExampleId: Dispatch<SetStateAction<string | null>>;

  // Editor handle (for scroll-to-X navigation)
  editorRef: RefObject<EditorHandle | null>;

  // Shared actions
  setOverrideEditor: (editor: Editor | null) => void;
  getCitationDisplayText: (command: string) => string;
  handleCitationCreated: (command: string) => { id: string; displayText: string };
  bibPackage: string;

  // Notes
  updateNote: (id: string, content: JSONContent) => void;
  updateNoteTitle: (id: string, title: string) => void;
  setNoteAiRequest: (id: string, value: boolean) => void;
  setHighlightAiRequest: (id: string, value: boolean) => void;
  /** Morph a notes-panel card note ⇄ highlight (A9 kind-chevron, R14). */
  convertNotesCard: (id: string, toKind: "note" | "highlight") => void;
  deleteNote: (id: string) => void;

  // Footnotes
  handleEditFootnote: (id: string, content: JSONContent) => void;
  handleDeleteFootnote: (id: string) => void;
  handleEditFootnoteTitle: (id: string, title: string) => void;

  // Archive
  updateArchiveSnippet: (id: string, content: unknown) => void;
  updateArchiveSnippetTitle: (id: string, title: string) => void;
  handleDeleteArchive: (id: string) => void;

  // Cutter
  updateCutterCommentContent: (id: string, content: JSONContent) => void;
  updateCutterCommentText: (id: string, text: string) => void;
  setCutterCommentAiRequest: (id: string, value: boolean) => void;
  updateCutterSuggestionField: (
    id: string,
    field:
      | "original_text"
      | "suggested_text"
      | "explanation"
      | "user_text"
      | "instructions",
    value: string,
  ) => void;
  setCutterSuggestionStatus: (
    id: string,
    status: CutterSuggestionCardData["status"],
  ) => void;
  /** Morph a cutter card comment ⇄ suggestion (A9 kind-chevron). */
  convertCutterCard: (id: string, toKind: "comment" | "suggestion") => void;
  deleteCutterCard: (id: string) => void;

  // Reports (polymorphic: report + report-request)
  updateReportContent: (id: string, content: JSONContent) => void;
  updateReportTitle: (id: string, title: string) => void;
  updateRequestContent: (id: string, content: JSONContent) => void;
  setRequestAiRequest: (id: string, value: boolean) => void;
  /** Morph a report card report ⇄ report-request (A9 kind-chevron). */
  convertReportCard: (id: string, toKind: "report" | "report-request") => void;
  deleteReportCard: (id: string) => void;

  // Todos
  toggleTodo: (id: string) => void;
  updateTodo: (id: string, text: string) => void;
  updateTodoNotes: (id: string, notes: string) => void;
  setTodoAiRequest: (id: string, value: boolean) => void;
  deleteTodo: (id: string) => void;

  // Bibliography
  getFormattedBib: (entry: BibEntry) => string;
  getAnnotation: (key: string) => string;
  setAnnotation: (key: string, text: string) => void;
  requestBibReview: (bibKey: string, type: "fields" | "notes", requestNotes?: string) => void;
  cancelBibReview: (bibKey: string, type: "fields" | "notes") => void;
  getBibReviewStatus: (bibKey: string, type: "fields" | "notes") => "none" | "pending" | "complete";
  updateBibEntry: (key: string, fields: Record<string, string>) => void;
  updateBibKeyAndType: (oldKey: string, newKey: string, newType: string) => void;
  addBibEntry: (entry: import("@/lib/types").BibEntry) => void;

  // Citations
  updateCitation: (id: string, command: string) => void;
  deleteCitation: (id: string) => void;

  // Revisions panel (mirrors Cutter)
  updateRevisionCommentContent: (id: string, content: JSONContent) => void;
  updateRevisionCommentText: (id: string, text: string) => void;
  setRevisionCommentAiRequest: (id: string, value: boolean) => void;
  updateRevisionSuggestionField: (
    id: string,
    field:
      | "original_text"
      | "suggested_text"
      | "explanation"
      | "user_text"
      | "instructions",
    value: string,
  ) => void;
  setRevisionSuggestionStatus: (
    id: string,
    status: RevisionSuggestionCardData["status"],
  ) => void;
  convertRevisionCard: (id: string, toKind: "comment" | "suggestion") => void;
  deleteRevisionCard: (id: string) => void;

  // AI Requests
  updateAiRequestText: (id: string, text: string) => void;
  deleteAiRequest: (id: string) => void;
}

// The legacy prefix dispatcher (`renderPoppedCard` + `cardKindForPopoutKey` +
// `POPOUT_PREFIX_KINDS`) is RETIRED — AF's generic `src/floats/FloatHost`
// now dispatches every popout key (card + text-object) via `parseAnyKey` +
// the one registry. This module is reduced to the `PoppedCardDeps` (=
// `CardFloatCtx`) shape, the per-doc dependency bag the card builders consume.
