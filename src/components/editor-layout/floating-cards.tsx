import { type ReactNode, type Dispatch, type SetStateAction, type RefObject } from "react";
import type { JSONContent, Editor } from "@tiptap/react";
import { NoteCard, HighlightCard } from "@/panels/Notes";
import { FootnoteCard } from "@/panels/Footnotes";
import { ArchiveCard } from "@/panels/Archive";
import { CutterCommentCard, CutterSuggestionCard } from "@/panels/Cutter";
import { TodoRow } from "@/panels/Todo";
import { CitationCard } from "@/panels/Citations";
import { RevisionCommentCard, RevisionSuggestionCard } from "@/panels/Revisions";
import { QuotationGroupCard } from "@/panels/Quotations";
import { ExampleCard } from "@/panels/Examples/ExampleCard";
import BibEntryCard from "../BibEntryCard";
import { AiRequestCard } from "../panel-primitives";
import { ParagraphFloat } from "../ParagraphFloat";
import { HeadingFloat } from "../HeadingFloat";
import { SelectionFloat } from "../SelectionFloat";
import type { EditorHandle, FootnoteInfo, ExampleInfo } from "../Editor";
import { getLinkedParagraphIds } from "@/links/links";
import type {
  UserNote,
  HighlightCard as HighlightCardData,
  ArchivedSnippet,
  CutterCard,
  CutterSuggestionCard as CutterSuggestionCardData,
  RevisionCard,
  RevisionSuggestionCard as RevisionSuggestionCardData,
  TodoItem,
  BibEntry,
  CitationRef,
  QuotationGroup,
  Quote,
  AiRequest,
} from "@/lib/types";

/**
 * Deps bundle for the popped-card renderer. Sourced entirely from the
 * EditorLayout shell; passed as one object to avoid a prop-list that
 * dominates the call site. Treat this as the public surface of "what
 * a popped-out card needs" — new card kinds extend this, not the
 * EditorLayout signature.
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
  quotationGroups: QuotationGroup[];
  aiRequests: AiRequest[];
  examples: ExampleInfo[];
  anchoredIds?: Set<string>;

  // Selected-id slots
  selectedNoteId: string | null;
  selectedFootnoteId: string | null;
  selectedArchiveId: string | null;
  selectedCutterCardId: string | null;
  selectedTodoId: string | null;
  selectedBibKey: string | null;
  selectedCitationId: string | null;
  selectedCommentId: string | null;
  selectedQuotationGroupId: string | null;
  selectedExampleId: string | null;
  setSelectedNoteId: Dispatch<SetStateAction<string | null>>;
  setSelectedFootnoteId: Dispatch<SetStateAction<string | null>>;
  setSelectedArchiveId: Dispatch<SetStateAction<string | null>>;
  setSelectedCutterCardId: Dispatch<SetStateAction<string | null>>;
  setSelectedTodoId: Dispatch<SetStateAction<string | null>>;
  setSelectedBibKey: Dispatch<SetStateAction<string | null>>;
  setSelectedCitationId: Dispatch<SetStateAction<string | null>>;
  setSelectedCommentId: Dispatch<SetStateAction<string | null>>;
  setSelectedQuotationGroupId: Dispatch<SetStateAction<string | null>>;
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
  deleteRevisionCard: (id: string) => void;

  // Quotations
  deleteQuotationGroup: (id: string) => void;
  updateQuotationGroupTitle: (id: string, title: string) => void;
  addQuotationReference: (groupId: string) => string;
  deleteQuotationReference: (groupId: string, referenceId: string) => void;
  updateQuotationReferenceCiteKey: (groupId: string, referenceId: string, citeKey: string) => void;
  addQuotationQuote: (groupId: string, referenceId: string) => string;
  updateQuotationQuote: (
    groupId: string,
    referenceId: string,
    quoteId: string,
    fields: Partial<Pick<Quote, "text" | "page">>,
  ) => void;
  deleteQuotationQuote: (groupId: string, referenceId: string, quoteId: string) => void;
  updateQuotationNotes: (groupId: string, notes: string) => void;

  // AI Requests
  updateAiRequestText: (id: string, text: string) => void;
  deleteAiRequest: (id: string) => void;
}

/**
 * Render a popped-out card matching `key` (shaped `${kind}:${id}`).
 * Returns null if the card kind is unknown or the backing entity is
 * missing (e.g. the note was deleted while a float of it was open).
 */
export function renderPoppedCard(key: string, d: PoppedCardDeps): ReactNode {
  const sep = key.indexOf(":");
  if (sep <= 0) return null;
  const kind = key.slice(0, sep);
  const id = key.slice(sep + 1);
  switch (kind) {
    case "note": {
      const note = d.notes.find((n) => n.id === id);
      if (!note) return null;
      const canJump = getLinkedParagraphIds(note).length > 0;
      return (
        <NoteCard
          key={key}
          note={note}
          selected={d.selectedNoteId === note.id}
          onUpdate={d.updateNote}
          onUpdateTitle={d.updateNoteTitle}
          onSetAiRequest={d.setNoteAiRequest}
          onDelete={d.deleteNote}
          onSelect={d.setSelectedNoteId}
          onJump={canJump ? (sourceEl) => d.editorRef.current?.jumpToCard(note, sourceEl) : undefined}
          onEditorFocus={d.setOverrideEditor}
          getCitationDisplayText={d.getCitationDisplayText}
          onCitationCreated={d.handleCitationCreated}
          isPoppedOut
        />
      );
    }
    case "highlight": {
      const hl = d.highlights.find((h) => h.id === id);
      if (!hl) return null;
      const canJump = getLinkedParagraphIds(hl).length > 0;
      return (
        <HighlightCard
          key={key}
          card={hl}
          selected={d.selectedNoteId === hl.id}
          onAddNote={(hid) => d.addNoteForHighlight(hid)}
          onSetAiRequest={d.setHighlightAiRequest}
          onDelete={d.deleteNote}
          onSelect={d.setSelectedNoteId}
          onJump={canJump ? (sourceEl) => d.editorRef.current?.jumpToCard(hl, sourceEl) : undefined}
          isPoppedOut
        />
      );
    }
    case "footnote": {
      // Read directly from the editor so the float renders on first paint
      // even before the `footnotes` memo has recomputed (its deps only
      // update on content edits, not on initial hydration).
      const liveFootnotes = d.editorRef.current?.getFootnotes() ?? d.footnotes;
      const fn = liveFootnotes.find((f) => f.footnoteId === id);
      if (!fn) return null;
      const isSelected = d.selectedFootnoteId === fn.footnoteId;
      return (
        <FootnoteCard
          key={key}
          footnote={fn}
          isSelected={isSelected}
          onSelect={() => d.setSelectedFootnoteId(isSelected ? null : fn.footnoteId)}
          onJump={(sourceEl) => d.editorRef.current?.scrollToFootnote(fn.footnoteId, sourceEl)}
          onEdit={(json) => d.handleEditFootnote(fn.footnoteId, json)}
          onDelete={() => d.handleDeleteFootnote(fn.footnoteId)}
          onEditTitle={(title) => d.handleEditFootnoteTitle(fn.footnoteId, title)}
          onEditorFocus={d.setOverrideEditor}
          getCitationDisplayText={d.getCitationDisplayText}
          onCitationCreated={d.handleCitationCreated}
          isPoppedOut
        />
      );
    }
    case "archive": {
      const snippet = d.archiveSnippets.find((s) => s.id === id);
      if (!snippet) return null;
      const orphaned = d.anchoredIds && !d.anchoredIds.has(snippet.id);
      return (
        <ArchiveCard
          key={key}
          snippet={snippet}
          selected={d.selectedArchiveId === snippet.id}
          orphaned={orphaned}
          onSelect={d.setSelectedArchiveId}
          onEdit={d.updateArchiveSnippet}
          onUpdateTitle={d.updateArchiveSnippetTitle}
          onDelete={d.handleDeleteArchive}
          onJump={(sourceEl) => d.editorRef.current?.jumpToCard(snippet, sourceEl)}
          onEditorFocus={d.setOverrideEditor}
          getCitationDisplayText={d.getCitationDisplayText}
          onCitationCreated={d.handleCitationCreated}
          isPoppedOut
        />
      );
    }
    case "cutter-comment": {
      const card = d.cutterCards.find(
        (c) => c.id === id && c.kind === "comment",
      );
      if (!card || card.kind !== "comment") return null;
      const canJump = getLinkedParagraphIds(card).length > 0;
      return (
        <CutterCommentCard
          key={key}
          card={card}
          selected={d.selectedCutterCardId === card.id}
          onUpdateText={d.updateCutterCommentText}
          onSetAiRequest={d.setCutterCommentAiRequest}
          onDelete={d.deleteCutterCard}
          onSelect={d.setSelectedCutterCardId}
          onJump={canJump ? (sourceEl) => d.editorRef.current?.jumpToCard(card, sourceEl) : undefined}
          isPoppedOut
        />
      );
    }
    case "cutter-suggestion": {
      const card = d.cutterCards.find(
        (c) => c.id === id && c.kind === "suggestion",
      );
      if (!card || card.kind !== "suggestion") return null;
      const canJump = getLinkedParagraphIds(card).length > 0;
      // Popped suggestions mirror status changes locally; the panel-host
      // owns the AiRequest enqueue path. Both buttons in popped mode just
      // flip status — the user can re-open the panel to trigger enqueue
      // there (out-of-scope for v1).
      return (
        <CutterSuggestionCard
          key={key}
          card={card}
          selected={d.selectedCutterCardId === card.id}
          onUpdateField={d.updateCutterSuggestionField}
          onAccept={(cid) => d.setCutterSuggestionStatus(cid, "accepted")}
          onReject={(cid) => d.setCutterSuggestionStatus(cid, "rejected")}
          onDelete={d.deleteCutterCard}
          onSelect={d.setSelectedCutterCardId}
          onJump={canJump ? (sourceEl) => d.editorRef.current?.jumpToCard(card, sourceEl) : undefined}
          isPoppedOut
        />
      );
    }
    case "todo": {
      const item = d.todoItems.find((t) => t.id === id);
      if (!item) return null;
      const canJump = getLinkedParagraphIds(item).length > 0;
      return (
        <TodoRow
          key={key}
          item={item}
          selected={d.selectedTodoId === item.id}
          onToggle={d.toggleTodo}
          onUpdate={d.updateTodo}
          onUpdateNotes={d.updateTodoNotes}
          onSetAiRequest={d.setTodoAiRequest}
          onDelete={d.deleteTodo}
          onSelect={d.setSelectedTodoId}
          isAnchored={canJump}
          onJump={canJump ? (sourceEl) => d.editorRef.current?.jumpToCard(item, sourceEl) : undefined}
          isPoppedOut
        />
      );
    }
    case "bib": {
      const entry = d.bibEntries.find((e) => e.key === id);
      if (!entry) return null;
      const isCited = d.allEditorCitations.some((c) => c.keys.includes(entry.key));
      return (
        <BibEntryCard
          key={key}
          entry={entry}
          isSelected={d.selectedBibKey === entry.key}
          onClick={() => d.setSelectedBibKey(d.selectedBibKey === entry.key ? null : entry.key)}
          getFormattedBib={d.getFormattedBib}
          getAnnotation={d.getAnnotation}
          setAnnotation={d.setAnnotation}
          onRequestReview={d.requestBibReview}
          onCancelReview={d.cancelBibReview}
          getReviewStatus={d.getBibReviewStatus}
          onUpdateBibEntry={d.updateBibEntry}
          onUpdateBibKeyAndType={d.updateBibKeyAndType}
          bibPackage={d.bibPackage}
          bibEntries={d.bibEntries}
          isCited={isCited}
          isPoppedOut
        />
      );
    }
    case "citation": {
      const cit = d.citations.find((c) => c.id === id);
      if (!cit) return null;
      const pos = d.citationPositionMap.get(cit.id) ?? null;
      const isSelected = d.selectedCitationId === cit.id;
      return (
        <CitationCard
          key={key}
          citation={cit}
          isSelected={isSelected}
          isAnchored={pos !== null}
          bibEntries={d.bibEntries}
          bibPackage={d.bibPackage}
          getDisplayText={d.getCitationDisplayText}
          onSelect={() => d.setSelectedCitationId(isSelected ? null : cit.id)}
          onJump={(sourceEl) => {
            d.setSelectedCitationId(cit.id);
            d.editorRef.current?.scrollToCitation(cit.id, sourceEl);
          }}
          onUpdateCitation={d.updateCitation}
          onDelete={d.deleteCitation}
          getFormattedBib={d.getFormattedBib}
          getAnnotation={d.getAnnotation}
          setAnnotation={d.setAnnotation}
          onRequestReview={d.requestBibReview}
          onCancelReview={d.cancelBibReview}
          getReviewStatus={d.getBibReviewStatus}
          onUpdateBibEntry={d.updateBibEntry}
          onUpdateBibKeyAndType={d.updateBibKeyAndType}
          isPoppedOut
        />
      );
    }
    case "revision": {
      const card = d.comments.find((c) => c.id === id);
      if (!card) return null;
      if (card.kind === "suggestion") {
        return (
          <RevisionSuggestionCard
            key={key}
            card={card}
            selected={d.selectedCommentId === card.id}
            onUpdateField={d.updateRevisionSuggestionField}
            onAccept={(cid) => d.setRevisionSuggestionStatus(cid, "accepted")}
            onReject={(cid) => d.setRevisionSuggestionStatus(cid, "rejected")}
            onDelete={d.deleteRevisionCard}
            onSelect={d.setSelectedCommentId}
            isPoppedOut
          />
        );
      }
      return (
        <RevisionCommentCard
          key={key}
          card={card}
          selected={d.selectedCommentId === card.id}
          onUpdateText={d.updateRevisionCommentText}
          onSetAiRequest={d.setRevisionCommentAiRequest}
          onDelete={d.deleteRevisionCard}
          onSelect={d.setSelectedCommentId}
          isPoppedOut
        />
      );
    }
    case "quotation": {
      const group = d.quotationGroups.find((g) => g.id === id);
      if (!group) return null;
      const canJump = getLinkedParagraphIds(group).length > 0;
      return (
        <QuotationGroupCard
          key={key}
          group={group}
          bibEntries={d.bibEntries}
          bibPackage={d.bibPackage}
          selected={d.selectedQuotationGroupId === group.id}
          onSelect={() =>
            d.setSelectedQuotationGroupId(
              d.selectedQuotationGroupId === group.id ? null : group.id,
            )
          }
          onDelete={() => d.deleteQuotationGroup(group.id)}
          onJump={canJump ? (sourceEl) => d.editorRef.current?.jumpToCard(group, sourceEl) : undefined}
          onUpdateGroupTitle={d.updateQuotationGroupTitle}
          onAddReference={d.addQuotationReference}
          onDeleteReference={d.deleteQuotationReference}
          onUpdateReferenceCiteKey={d.updateQuotationReferenceCiteKey}
          onAddQuote={d.addQuotationQuote}
          onUpdateQuote={d.updateQuotationQuote}
          onDeleteQuote={d.deleteQuotationQuote}
          onUpdateNotes={d.updateQuotationNotes}
          isPoppedOut
        />
      );
    }
    case "ai": {
      const req = d.aiRequests.find((r) => r.id === id);
      if (!req) return null;
      return (
        <AiRequestCard
          key={key}
          request={req}
          onChangeText={(text) => d.updateAiRequestText(req.id, text)}
          onDelete={() => d.deleteAiRequest(req.id)}
          isPoppedOut
        />
      );
    }
    case "paragraph": {
      return <ParagraphFloat key={key} cardKey={key} uuid={id} editorRef={d.editorRef} />;
    }
    case "heading": {
      return <HeadingFloat key={key} cardKey={key} uuid={id} editorRef={d.editorRef} />;
    }
    case "selection": {
      return (
        <SelectionFloat
          key={key}
          cardKey={key}
          selectionFloatId={id}
          editorRef={d.editorRef}
        />
      );
    }
    case "example": {
      const ex = d.examples.find((e) => e.exampleId === id);
      if (!ex) return null;
      return (
        <ExampleCard
          key={key}
          example={ex}
          isSelected={d.selectedExampleId === ex.exampleId}
          onSelect={() =>
            d.setSelectedExampleId(d.selectedExampleId === ex.exampleId ? null : ex.exampleId)
          }
          onJump={() => d.editorRef.current?.scrollToExample(ex.exampleId)}
          isPoppedOut
        />
      );
    }
    default:
      return null;
  }
}
