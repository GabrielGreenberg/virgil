import {
  cloneElement,
  isValidElement,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
  type RefObject,
} from "react";
import type { JSONContent, Editor } from "@tiptap/react";
import { TextObjectFloat } from "@/text-objects/TextObjectFloat";
import {
  parseTextObjectPopoutKey,
  TEXT_OBJECT_REGISTRY,
} from "@/text-objects/text-object-registry";
import type { EditorHandle, FootnoteInfo, ExampleInfo } from "../Editor";
// Card popout bodies register onto CARD_REGISTRY via this side-effect import;
// renderPoppedCard delegates to CARD_REGISTRY[kind].toFloatable below.
import "@/cards/floats";
import { CARD_REGISTRY } from "@/cards/card-registry";
import type { CardKind } from "@/cards/types";
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
  addNoteForHighlight: (id: string) => UserNote | null;
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
  deleteCutterCard: (id: string) => void;

  // Reports (polymorphic: report + report-request)
  updateReportContent: (id: string, content: JSONContent) => void;
  updateReportTitle: (id: string, title: string) => void;
  updateRequestContent: (id: string, content: JSONContent) => void;
  setRequestAiRequest: (id: string, value: boolean) => void;
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

/** Legacy popout-key prefixes that map 1:1 to a CardKind. The shared
 *  `revision` prefix is handled separately (resolved from the record's kind);
 *  `suggestion` / `revision-suggestion` / `error` are intentionally absent
 *  (they never dispatched in the old switch). */
const POPOUT_PREFIX_KINDS = new Set<string>([
  "note",
  "highlight",
  "footnote",
  "archive",
  "cutter-comment",
  "cutter-suggestion",
  "report",
  "report-request",
  "todo",
  "bib",
  "citation",
  "ai",
  "example",
]);

/** Resolve a legacy popout-key prefix to a concrete CardKind. The shared
 *  `revision` prefix resolves comment-vs-suggestion from the record's kind,
 *  exactly as the old switch did — preserving the `revision:s:<id>` quirk: the
 *  id parses to `"s:<id>"`, the `comments.find` misses, and the float renders
 *  nothing (the suggestion float was served by the panel's own self-wrap path,
 *  not this dispatcher). AF replaces this legacy prefix dispatch with the
 *  `float:<domain>:<kind>:<id>` grammar. */
function cardKindForPopoutKey(
  prefix: string,
  id: string,
  d: PoppedCardDeps,
): CardKind | null {
  if (prefix === "revision") {
    const card = d.comments.find((c) => c.id === id);
    if (!card) return null;
    // card.kind is the on-disk data discriminator ("comment"/"suggestion");
    // map it to the spine CardKind.
    return card.kind === "suggestion" ? "revision-suggestion" : "revision-comment";
  }
  return POPOUT_PREFIX_KINDS.has(prefix) ? (prefix as CardKind) : null;
}

/**
 * Render a popped-out card matching `key` (shaped `${prefix}:${id}`). Card
 * bodies live in the card registry now: this dispatcher resolves the prefix to
 * a `CardKind` and delegates to `CARD_REGISTRY[kind].toFloatable(id, d)`,
 * rendering its `renderBody()`. Returns null if the prefix is unknown / not
 * poppable (`error`) or the backing entity is missing (e.g. the note was
 * deleted while a float of it was open). `textobject:` keys are a separate
 * ontology, dispatched inline to `TextObjectFloat`.
 */
export function renderPoppedCard(key: string, d: PoppedCardDeps): ReactNode {
  const sep = key.indexOf(":");
  if (sep <= 0) return null;
  const prefix = key.slice(0, sep);
  const id = key.slice(sep + 1);

  if (prefix === "textobject") {
    const ref = parseTextObjectPopoutKey(key);
    if (!ref) return null;
    const meta = TEXT_OBJECT_REGISTRY[ref.kind];
    if (!meta.floatBodyComponent) return null;
    return (
      <TextObjectFloat
        key={key}
        cardKey={key}
        kind={ref.kind}
        id={ref.id}
        editorRef={d.editorRef}
      />
    );
  }

  const cardKind = cardKindForPopoutKey(prefix, id, d);
  if (!cardKind) return null;
  const node = CARD_REGISTRY[cardKind].toFloatable(id, d)?.renderBody() ?? null;
  // Preserve the popout key as the React list key (was `key={key}` per card).
  return isValidElement(node) ? cloneElement(node, { key }) : node;
}
