"use client";

import { useCallback } from "react";
import type { Side } from "@/hooks/useViewPrefs";
import OmniViewPanel, { type OmniItem, type OmniCategory } from "@/panels/Omni";
import { buildCitationOmniItems } from "@/panels/Citations";
import { buildFootnoteOmniItems } from "@/panels/Footnotes";
import { buildQuotationOmniItems } from "@/panels/Quotations";
import { buildNoteOmniItems } from "@/panels/Notes";
import { buildArchiveOmniItems } from "@/panels/Archive";
import { buildTodoOmniItems } from "@/panels/Todo";
import type { useNotes } from "@/hooks/useNotes";
import type { useTodos } from "@/hooks/useTodos";
import type { useQuotations } from "@/hooks/useQuotations";
import type { useCitations } from "@/hooks/useCitations";
import type { useAnnotations } from "@/hooks/useAnnotations";
import type { useBibReview } from "@/hooks/useBibReview";
import type { JSONContent } from "@tiptap/react";
import type { ArchivedSnippet, OrphanedFootnote } from "@/lib/types";
import type { FootnoteInfo } from "../../Editor";
import type { CardWithLinks } from "@/links/links";
import { useEditorRefContext } from "../contexts/editor-ref";
import { useSelectionsContext } from "../contexts/selections";
import { useCitationDisplayContext } from "../contexts/citation-display";

type NotesHook = ReturnType<typeof useNotes>;
type TodosHook = ReturnType<typeof useTodos>;
type QuotationsHook = ReturnType<typeof useQuotations>;
type CitationsHook = ReturnType<typeof useCitations>;
type AnnotationsHook = ReturnType<typeof useAnnotations>;
type BibReviewHook = ReturnType<typeof useBibReview>;

export interface OmniHostProps {
  side: Side;
  // Footnotes
  footnotes: FootnoteInfo[];
  orphanedFootnotes: OrphanedFootnote[];
  handleEditFootnote: (id: string, newContent: JSONContent) => void;
  handleDeleteFootnote: (id: string) => void;
  handleEditFootnoteTitle: (id: string, title: string) => void;
  handleEditOrphan: (id: string, newContent: unknown) => void;
  handleDeleteOrphan: (id: string) => void;
  handleEditOrphanTitle: (id: string, title: string) => void;
  // Citations
  citations: CitationsHook["citations"];
  citationPositionMap: Map<string, number>;
  bibEntries: CitationsHook["bibEntries"];
  bibPackage: CitationsHook["bibPackage"];
  updateCitation: CitationsHook["updateCitation"];
  getFormattedBib: CitationsHook["getFormattedBib"];
  updateBibEntry: CitationsHook["updateBibEntry"];
  updateBibKeyAndType: CitationsHook["updateBibKeyAndType"];
  getAnnotation: AnnotationsHook["getAnnotation"];
  setAnnotation: AnnotationsHook["setAnnotation"];
  requestBibReview: BibReviewHook["requestReview"];
  cancelBibReview: BibReviewHook["cancelRequest"];
  getBibReviewStatus: BibReviewHook["getRequestStatus"];
  // Quotations
  quotationGroups: QuotationsHook["groups"];
  deleteQuotationGroup: QuotationsHook["deleteGroup"];
  updateQuotationGroupTitle: QuotationsHook["updateGroupTitle"];
  addQuotationReference: QuotationsHook["addReference"];
  deleteQuotationReference: QuotationsHook["deleteReference"];
  updateQuotationReferenceCiteKey: QuotationsHook["updateReferenceCiteKey"];
  addQuotationQuote: QuotationsHook["addQuote"];
  updateQuotationQuote: QuotationsHook["updateQuote"];
  deleteQuotationQuote: QuotationsHook["deleteQuote"];
  updateQuotationNotes: QuotationsHook["updateNotes"];
  // Notes
  notes: NotesHook["notes"];
  updateNote: NotesHook["updateNote"];
  updateNoteTitle: NotesHook["updateNoteTitle"];
  deleteNote: NotesHook["deleteNote"];
  // Archive
  sortedArchiveSnippets: ArchivedSnippet[];
  anchoredIds: Set<string>;
  updateArchiveSnippet: (id: string, content: unknown) => void;
  updateArchiveSnippetTitle: (id: string, title: string) => void;
  handleDeleteArchive: (id: string) => void;
  // Todo
  todoItems: TodosHook["items"];
  toggleTodo: TodosHook["toggleItem"];
  updateTodo: TodosHook["updateItem"];
  updateTodoNotes: TodosHook["updateNotes"];
  setTodoAiRequest: TodosHook["setAiRequest"];
  deleteTodo: TodosHook["deleteItem"];
  // Shell
  getOmniEnabled: (side: Side) => Set<OmniCategory>;
  toggleOmniCategory: (side: Side, cat: OmniCategory) => void;
  categorySides: Record<OmniCategory, "left" | "right">;
}

export function OmniHost(p: OmniHostProps) {
  const { editorInstance, editorRef, setOverrideEditor } = useEditorRefContext();
  const {
    selectedFootnoteId, setSelectedFootnoteId,
    selectedCitationId, setSelectedCitationId,
    selectedQuotationGroupId, setSelectedQuotationGroupId,
    selectedNoteId, setSelectedNoteId,
    selectedArchiveId, setSelectedArchiveId,
    selectedTodoId, setSelectedTodoId,
  } = useSelectionsContext();
  const { getCitationDisplayText, onCitationCreated } = useCitationDisplayContext();

  // Omniview is a single-selection surface: selecting any card clears the
  // other omni-eligible selections. Non-omni fields (bib, comments, cuts)
  // are left alone.
  const clearAllOmniSelections = useCallback(() => {
    setSelectedFootnoteId(null);
    setSelectedCitationId(null);
    setSelectedQuotationGroupId(null);
    setSelectedNoteId(null);
    setSelectedArchiveId(null);
    setSelectedTodoId(null);
  }, [
    setSelectedFootnoteId,
    setSelectedCitationId,
    setSelectedQuotationGroupId,
    setSelectedNoteId,
    setSelectedArchiveId,
    setSelectedTodoId,
  ]);
  const setFootnoteInOmni = useCallback((id: string | null) => {
    setSelectedFootnoteId(id);
    if (id !== null) {
      setSelectedCitationId(null);
      setSelectedQuotationGroupId(null);
      setSelectedNoteId(null);
      setSelectedArchiveId(null);
      setSelectedTodoId(null);
    }
  }, [
    setSelectedFootnoteId,
    setSelectedCitationId,
    setSelectedQuotationGroupId,
    setSelectedNoteId,
    setSelectedArchiveId,
    setSelectedTodoId,
  ]);
  const setCitationInOmni = useCallback((id: string | null) => {
    setSelectedCitationId(id);
    if (id !== null) {
      setSelectedFootnoteId(null);
      setSelectedQuotationGroupId(null);
      setSelectedNoteId(null);
      setSelectedArchiveId(null);
      setSelectedTodoId(null);
    }
  }, [
    setSelectedCitationId,
    setSelectedFootnoteId,
    setSelectedQuotationGroupId,
    setSelectedNoteId,
    setSelectedArchiveId,
    setSelectedTodoId,
  ]);
  const setQuotationGroupInOmni = useCallback((id: string | null) => {
    setSelectedQuotationGroupId(id);
    if (id !== null) {
      setSelectedFootnoteId(null);
      setSelectedCitationId(null);
      setSelectedNoteId(null);
      setSelectedArchiveId(null);
      setSelectedTodoId(null);
    }
  }, [
    setSelectedQuotationGroupId,
    setSelectedFootnoteId,
    setSelectedCitationId,
    setSelectedNoteId,
    setSelectedArchiveId,
    setSelectedTodoId,
  ]);
  const setNoteInOmni = useCallback((id: string | null) => {
    setSelectedNoteId(id);
    if (id !== null) {
      setSelectedFootnoteId(null);
      setSelectedCitationId(null);
      setSelectedQuotationGroupId(null);
      setSelectedArchiveId(null);
      setSelectedTodoId(null);
    }
  }, [
    setSelectedNoteId,
    setSelectedFootnoteId,
    setSelectedCitationId,
    setSelectedQuotationGroupId,
    setSelectedArchiveId,
    setSelectedTodoId,
  ]);
  const setArchiveInOmni = useCallback((id: string | null) => {
    setSelectedArchiveId(id);
    if (id !== null) {
      setSelectedFootnoteId(null);
      setSelectedCitationId(null);
      setSelectedQuotationGroupId(null);
      setSelectedNoteId(null);
      setSelectedTodoId(null);
    }
  }, [
    setSelectedArchiveId,
    setSelectedFootnoteId,
    setSelectedCitationId,
    setSelectedQuotationGroupId,
    setSelectedNoteId,
    setSelectedTodoId,
  ]);
  const setTodoInOmni = useCallback((id: string | null) => {
    setSelectedTodoId(id);
    if (id !== null) {
      setSelectedFootnoteId(null);
      setSelectedCitationId(null);
      setSelectedQuotationGroupId(null);
      setSelectedNoteId(null);
      setSelectedArchiveId(null);
    }
  }, [
    setSelectedTodoId,
    setSelectedFootnoteId,
    setSelectedCitationId,
    setSelectedQuotationGroupId,
    setSelectedNoteId,
    setSelectedArchiveId,
  ]);

  // Resolve a paragraph UUID to its doc position (used by panels that
  // anchor by paragraphId not pos).
  const findParagraphPos = useCallback(
    (uuid: string | null): number | null => {
      if (!uuid || !editorInstance) return null;
      let result: number | null = null;
      editorInstance.state.doc.descendants((node, pos) => {
        if (result != null) return false;
        if (node.attrs?.uuid === uuid) {
          result = pos;
          return false;
        }
        return true;
      });
      return result;
    },
    [editorInstance],
  );
  const jumpToCard = useCallback(
    (card: CardWithLinks) => {
      editorRef.current?.jumpToCard(card);
    },
    [editorRef],
  );
  const scrollToFootnote = useCallback(
    (id: string) => editorRef.current?.scrollToFootnote(id),
    [editorRef],
  );
  const scrollToCitation = useCallback(
    (id: string) => editorRef.current?.scrollToCitation(id),
    [editorRef],
  );

  const items: OmniItem[] = [
    ...buildFootnoteOmniItems({
      footnotes: p.footnotes,
      orphanedFootnotes: p.orphanedFootnotes,
      selectedFootnoteId,
      setSelectedFootnoteId: setFootnoteInOmni,
      scrollToFootnote,
      onEditFootnote: p.handleEditFootnote,
      onDeleteFootnote: p.handleDeleteFootnote,
      onEditFootnoteTitle: p.handleEditFootnoteTitle,
      onEditOrphan: p.handleEditOrphan,
      onDeleteOrphan: p.handleDeleteOrphan,
      onEditOrphanTitle: p.handleEditOrphanTitle,
      setOverrideEditor,
      getCitationDisplayText,
      onCitationCreated,
    }),
    ...buildCitationOmniItems({
      citations: p.citations,
      citationPositionMap: p.citationPositionMap,
      selectedCitationId,
      setSelectedCitationId: setCitationInOmni,
      scrollToCitation,
      bibEntries: p.bibEntries,
      bibPackage: p.bibPackage,
      getCitationDisplayText,
      updateCitation: p.updateCitation,
      getFormattedBib: p.getFormattedBib,
      getAnnotation: p.getAnnotation,
      setAnnotation: p.setAnnotation,
      requestBibReview: p.requestBibReview,
      cancelBibReview: p.cancelBibReview,
      getBibReviewStatus: p.getBibReviewStatus,
      updateBibEntry: p.updateBibEntry,
      updateBibKeyAndType: p.updateBibKeyAndType,
    }),
    ...buildQuotationOmniItems({
      quotationGroups: p.quotationGroups,
      selectedQuotationGroupId,
      setSelectedQuotationGroupId: setQuotationGroupInOmni,
      jumpToCard,
      findParagraphPos,
      bibEntries: p.bibEntries,
      bibPackage: p.bibPackage,
      deleteQuotationGroup: p.deleteQuotationGroup,
      updateQuotationGroupTitle: p.updateQuotationGroupTitle,
      addQuotationReference: p.addQuotationReference,
      deleteQuotationReference: p.deleteQuotationReference,
      updateQuotationReferenceCiteKey: p.updateQuotationReferenceCiteKey,
      addQuotationQuote: p.addQuotationQuote,
      updateQuotationQuote: p.updateQuotationQuote,
      deleteQuotationQuote: p.deleteQuotationQuote,
      updateQuotationNotes: p.updateQuotationNotes,
    }),
    ...buildNoteOmniItems({
      notes: p.notes,
      selectedNoteId,
      setSelectedNoteId: setNoteInOmni,
      jumpToCard,
      findParagraphPos,
      updateNote: p.updateNote,
      updateNoteTitle: p.updateNoteTitle,
      deleteNote: p.deleteNote,
      setOverrideEditor,
      getCitationDisplayText,
      onCitationCreated,
    }),
    ...buildArchiveOmniItems({
      archiveSnippets: p.sortedArchiveSnippets,
      anchoredIds: p.anchoredIds,
      selectedArchiveId,
      setSelectedArchiveId: setArchiveInOmni,
      jumpToCard,
      findParagraphPos,
      updateArchiveSnippet: p.updateArchiveSnippet,
      updateArchiveSnippetTitle: p.updateArchiveSnippetTitle,
      handleDeleteArchive: p.handleDeleteArchive,
      setOverrideEditor,
      getCitationDisplayText,
      onCitationCreated,
    }),
    ...buildTodoOmniItems({
      todoItems: p.todoItems,
      selectedTodoId,
      setSelectedTodoId: setTodoInOmni,
      jumpToCard,
      findParagraphPos,
      toggleTodo: p.toggleTodo,
      updateTodo: p.updateTodo,
      updateTodoNotes: p.updateTodoNotes,
      setTodoAiRequest: p.setTodoAiRequest,
      deleteTodo: p.deleteTodo,
    }),
  ];

  return (
    <OmniViewPanel
      side={p.side}
      items={items}
      editor={editorInstance}
      enabledCategories={p.getOmniEnabled(p.side)}
      onToggleCategory={(cat) => p.toggleOmniCategory(p.side, cat)}
      categorySides={p.categorySides}
      onBackgroundClick={clearAllOmniSelections}
    />
  );
}
