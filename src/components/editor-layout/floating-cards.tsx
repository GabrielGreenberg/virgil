import { type ReactNode, type Dispatch, type SetStateAction, type RefObject } from "react";
import type { JSONContent, Editor } from "@tiptap/react";
import { NoteCard } from "@/panels/Notes";
import { FootnoteCard } from "@/panels/Footnotes";
import { ArchiveCard } from "@/panels/Archive";
import { CutCard } from "@/panels/Cutter";
import { TodoRow } from "@/panels/Todo";
import { CitationCard } from "@/panels/Citations";
import { RevisionCard } from "@/panels/Revisions";
import { QuotationGroupCard } from "@/panels/Quotations";
import BibEntryCard from "../BibEntryCard";
import { AiRequestCard } from "../panel-primitives";
import { ParagraphFloat } from "../ParagraphFloat";
import type { EditorHandle, FootnoteInfo } from "../Editor";
import { getLinkedParagraphIds } from "@/links/links";
import type {
  UserNote,
  ArchivedSnippet,
  CutItem,
  TodoItem,
  BibEntry,
  CitationRef,
  GeneralRevision,
  TextRevision,
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
  footnotes: FootnoteInfo[];
  archiveSnippets: ArchivedSnippet[];
  cuts: CutItem[];
  todoItems: TodoItem[];
  bibEntries: BibEntry[];
  citations: CitationRef[];
  citationPositionMap: Map<string, number>;
  allEditorCitations: Array<{ citationId: string; command: string; keys: string[]; pos: number }>;
  generalRevisions: GeneralRevision[];
  textRevisions: TextRevision[];
  quotationGroups: QuotationGroup[];
  aiRequests: AiRequest[];
  anchoredIds?: Set<string>;

  // Selected-id slots
  selectedNoteId: string | null;
  selectedFootnoteId: string | null;
  selectedArchiveId: string | null;
  selectedCutId: string | null;
  selectedTodoId: string | null;
  selectedBibKey: string | null;
  selectedCitationId: string | null;
  selectedCommentId: string | null;
  selectedQuotationGroupId: string | null;
  setSelectedNoteId: Dispatch<SetStateAction<string | null>>;
  setSelectedFootnoteId: Dispatch<SetStateAction<string | null>>;
  setSelectedArchiveId: Dispatch<SetStateAction<string | null>>;
  setSelectedCutId: Dispatch<SetStateAction<string | null>>;
  setSelectedTodoId: Dispatch<SetStateAction<string | null>>;
  setSelectedBibKey: Dispatch<SetStateAction<string | null>>;
  setSelectedCitationId: Dispatch<SetStateAction<string | null>>;
  setSelectedCommentId: Dispatch<SetStateAction<string | null>>;
  setSelectedQuotationGroupId: Dispatch<SetStateAction<string | null>>;

  // Editor handle (for scroll-to-X navigation)
  editorRef: RefObject<EditorHandle | null>;

  // Shared actions
  setOverrideEditor: (editor: Editor | null) => void;
  getCitationDisplayText: (command: string) => string;
  handleCitationCreated: (command: string) => { id: string; displayText: string };
  handleHoverNote: (noteId: string | null) => void;
  handleHoverCut: (cutId: string | null) => void;
  bibPackage: string;

  // Notes
  updateNote: (id: string, content: JSONContent) => void;
  updateNoteTitle: (id: string, title: string) => void;
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
  updateCut: (id: string, content: JSONContent) => void;
  updateCutTitle: (id: string, title: string) => void;
  deleteCut: (id: string) => void;

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

  // Revisions
  updateRevisionContent: (kind: "general" | "text", id: string, content: JSONContent) => void;
  setRevisionAuthor: (kind: "general" | "text", id: string, authorId: string) => void;
  deleteRevision: (kind: "general" | "text", id: string) => void;

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
      const pid = getLinkedParagraphIds(note)[0];
      return (
        <NoteCard
          key={key}
          note={note}
          selected={d.selectedNoteId === note.id}
          onUpdate={d.updateNote}
          onUpdateTitle={d.updateNoteTitle}
          onDelete={d.deleteNote}
          onSelect={d.setSelectedNoteId}
          onJump={pid ? () => d.editorRef.current?.scrollToParagraphId(pid) : undefined}
          onEditorFocus={d.setOverrideEditor}
          getCitationDisplayText={d.getCitationDisplayText}
          onCitationCreated={d.handleCitationCreated}
          onHoverChange={(hovering) => d.handleHoverNote(hovering ? note.id : null)}
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
          onJump={() => d.editorRef.current?.scrollToFootnote(fn.footnoteId)}
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
          onScrollToMarker={(sid) => {
            const s = d.archiveSnippets.find((x) => x.id === sid);
            const p = s ? getLinkedParagraphIds(s)[0] : undefined;
            if (p) d.editorRef.current?.scrollToParagraphId(p);
          }}
          onEditorFocus={d.setOverrideEditor}
          getCitationDisplayText={d.getCitationDisplayText}
          onCitationCreated={d.handleCitationCreated}
          isPoppedOut
        />
      );
    }
    case "cut": {
      const cut = d.cuts.find((c) => c.id === id);
      if (!cut) return null;
      const pid = getLinkedParagraphIds(cut)[0];
      return (
        <CutCard
          key={key}
          cut={cut}
          selected={d.selectedCutId === cut.id}
          onUpdate={d.updateCut}
          onUpdateTitle={d.updateCutTitle}
          onDelete={d.deleteCut}
          onSelect={d.setSelectedCutId}
          onJump={pid ? () => d.editorRef.current?.scrollToParagraphId(pid) : undefined}
          onHoverChange={(hovering) => d.handleHoverCut(hovering ? cut.id : null)}
          isPoppedOut
        />
      );
    }
    case "todo": {
      const item = d.todoItems.find((t) => t.id === id);
      if (!item) return null;
      const itemPids = getLinkedParagraphIds(item);
      const pid = itemPids[0];
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
          isAnchored={itemPids.length > 0}
          onJump={pid ? () => d.editorRef.current?.scrollToParagraphId(pid) : undefined}
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
          onJump={() => {
            d.setSelectedCitationId(cit.id);
            d.editorRef.current?.scrollToCitation(cit.id);
          }}
          onUpdateCitation={d.updateCitation}
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
      const gen = d.generalRevisions.find((r) => r.id === id);
      const text = d.textRevisions.find((r) => r.id === id);
      const rev = gen ?? text;
      if (!rev) return null;
      const rkind: "general" | "text" = gen ? "general" : "text";
      return (
        <RevisionCard
          key={key}
          kind={rkind}
          revision={rev}
          selected={d.selectedCommentId === rev.id}
          onSelect={(nextId) => d.setSelectedCommentId(nextId)}
          onUpdateContent={d.updateRevisionContent}
          onSetAuthor={d.setRevisionAuthor}
          onDelete={d.deleteRevision}
          isPoppedOut
        />
      );
    }
    case "quotation": {
      const group = d.quotationGroups.find((g) => g.id === id);
      if (!group) return null;
      const pid = getLinkedParagraphIds(group)[0];
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
          onJump={pid ? () => d.editorRef.current?.scrollToParagraphId(pid) : undefined}
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
    default:
      return null;
  }
}
