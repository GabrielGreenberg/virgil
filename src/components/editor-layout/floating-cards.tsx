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
  FootnoteRef,
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
 *
 * **Every field here is READ by a float, or it does not belong here** (task
 * 436 — the task-227 dead-context-field law in its cross-tree tense).
 * Construction is not consumption: five fields (`aiRequests`,
 * `updateAiRequestText`, `deleteAiRequest`, `updateCutterCommentText`,
 * `updateRevisionCommentText`) were declared here, populated by `EditorPane`
 * and read by nothing — and three of them dragged `aiRequestsHook` into the
 * `popoutsDeps` memo's dependency array, so every AI-request edit rebuilt this
 * whole bag and re-resolved every open float. Re-add any of them WITH its
 * first real reader, never ahead of one.
 *
 * The census that keeps this drained is
 * `src/floats/__tests__/card-float-ctx-honesty.test.ts`. It asks about the
 * READERS (`src/cards/`, `src/floats/`, `src/text-objects/`), not about this
 * file — `dead-panel-prop-guardrail`'s per-FILE question ("a declared prop
 * appears once more in its own file") has no useful answer for a bag whose
 * consumers live in three other trees: every field would flag, dead and live
 * alike.
 */
export interface PoppedCardDeps {
  // Entity collections
  notes: UserNote[];
  highlights: HighlightCardData[];
  footnotes: FootnoteInfo[];
  /** Task 316: the ATOMLESS footnote refs (`selectAtomlessFootnoteRefs`) — the
   *  sidecar half of the footnote collection. `footnotes` above is derived from
   *  the live editor and therefore cannot see a parked ref, so a footnote float
   *  resolves here when no `\footnote` atom carries the id. Required, not
   *  optional: a bag that can omit it would silently reinstate the blank-float
   *  case for every host that forgets. */
  unanchoredFootnotes: FootnoteRef[];
  archiveSnippets: ArchivedSnippet[];
  cutterCards: CutterCard[];
  todoItems: TodoItem[];
  bibEntries: BibEntry[];
  citations: CitationRef[];
  citationPositionMap: Map<string, number>;
  allEditorCitations: Array<{ citationId: string; command: string; keys: string[]; pos: number }>;
  comments: RevisionCard[];
  reportCards: ReportItem[];
  examples: ExampleInfo[];
  /** The ids of archive clips whose anchor the task-369 authority RESOLVES —
   *  `anchoredArchiveIds` in `EditorPane`, a fold over `anchorPass.resolve()`.
   *  The archive float derives BOTH its `orphaned` body state and its jump
   *  affordance from it (task 435). Required, not optional, for the reason
   *  `unanchoredFootnotes` above states: an optional field makes the derived
   *  answer silently `undefined` for every host that forgets, which is exactly
   *  how the float came to paint a live Jump over an orphaned clip. */
  anchoredIds: Set<string>;

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
  /** Permanent delete of an ATOMLESS ref: the anchored `handleDeleteFootnote`
   *  no-ops on the missing atom and would leave the sidecar ref behind. */
  handleDeleteUnanchoredFootnote: (id: string) => void;
  /** BUG #55: per-footnote AI-request flags (footnoteId → bool, from the
   *  footnotes.json sidecar) + the toggle callback. The float/omni footnote
   *  cards read these to render the unified AI-request checkbox. */
  footnoteAiRequests: Record<string, boolean>;
  setFootnoteAiRequest: (id: string, value: boolean) => void;

  // Archive
  updateArchiveSnippet: (id: string, content: unknown) => void;
  updateArchiveSnippetTitle: (id: string, title: string) => void;
  handleDeleteArchive: (id: string) => void;

  // Cutter
  updateCutterCommentContent: (id: string, content: JSONContent) => void;
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
  replaceBibEntry: (key: string, fields: Record<string, string>, type?: string) => void;
  updateBibKeyAndType: (oldKey: string, newKey: string, newType: string) => void;
  addBibEntry: (entry: import("@/lib/types").BibEntry) => void;

  // Citations
  updateCitation: (id: string, command: string) => void;
  deleteCitation: (id: string) => void;

  // Revisions panel (mirrors Cutter)
  updateRevisionCommentContent: (id: string, content: JSONContent) => void;
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
}

// The legacy prefix dispatcher (`renderPoppedCard` + `cardKindForPopoutKey` +
// `POPOUT_PREFIX_KINDS`) is RETIRED — AF's generic `src/floats/FloatHost`
// now dispatches every popout key (card + text-object) via `parseAnyKey` +
// the one registry. This module is reduced to the `PoppedCardDeps` (=
// `CardFloatCtx`) shape, the per-doc dependency bag the card builders consume.
