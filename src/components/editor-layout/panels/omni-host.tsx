"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getHiddenTopLevelIndices } from "@/lib/section-folding";
import type { Side } from "@/hooks/useViewPrefs";
import OmniViewPanel, { type OmniItem, type OmniCategory } from "@/panels/Omni";
import { buildCitationOmniItems } from "@/panels/Citations";
import { buildFootnoteOmniItems } from "@/panels/Footnotes";
import { buildQuotationOmniItems } from "@/panels/Quotations";
import { buildNoteOmniItems } from "@/panels/Notes";
import { buildArchiveOmniItems } from "@/panels/Archive";
import { buildTodoOmniItems } from "@/panels/Todo";
import { buildExampleOmniItems } from "@/panels/Examples";
import { buildRevisionOmniItems } from "@/panels/Revisions";
import { buildErrorOmniItems } from "@/panels/Errors";
import { buildCutterOmniItems } from "@/panels/Cutter";
import type { useNotes } from "@/hooks/useNotes";
import type { useTodos } from "@/hooks/useTodos";
import type { useQuotations } from "@/hooks/useQuotations";
import type { useCitations } from "@/hooks/useCitations";
import type { useAnnotations } from "@/hooks/useAnnotations";
import type { useBibReview } from "@/hooks/useBibReview";
import type { useRevisions } from "@/hooks/useRevisions";
import type { useCutter } from "@/hooks/useCutter";
import type { JSONContent } from "@tiptap/react";
import type {
  ArchivedSnippet,
  OrphanedFootnote,
  RevisionCard,
  CutterCard,
  UserNote,
} from "@/lib/types";
import type { LatexError } from "@/lib/latex-errors";
import type { FootnoteInfo, ExampleInfo } from "../../Editor";
import type { CardWithLinks } from "@/links/links";
import type { FocusState } from "@/hooks/useFocusMode";
import { useEditorRefContext } from "../contexts/editor-ref";
import { useSelectionsContext } from "../contexts/selections";
import { useCitationDisplayContext } from "../contexts/citation-display";
import { cardStore } from "@/links/_shared/anchored-card-store";

const EMPTY_HIDDEN: ReadonlySet<number> = new Set<number>();

type NotesHook = ReturnType<typeof useNotes>;
type TodosHook = ReturnType<typeof useTodos>;
type QuotationsHook = ReturnType<typeof useQuotations>;
type CitationsHook = ReturnType<typeof useCitations>;
type AnnotationsHook = ReturnType<typeof useAnnotations>;
type BibReviewHook = ReturnType<typeof useBibReview>;
type RevisionsHook = ReturnType<typeof useRevisions>;
type CutterHook = ReturnType<typeof useCutter>;

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
  deleteCitation: CitationsHook["deleteCitation"];
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
  // Notes (polymorphic: hosts both `note` and `highlight` cards)
  notesCards: NotesHook["cards"];
  updateNote: NotesHook["updateNote"];
  updateNoteTitle: NotesHook["updateNoteTitle"];
  setNoteAiRequest: NotesHook["setNoteAiRequest"];
  setHighlightAiRequest: NotesHook["setHighlightAiRequest"];
  /** Spawn a sibling note for a highlight; routed through cardCreation. */
  addNoteForHighlight: (id: string) => UserNote | null;
  /** Kind-aware delete; routed through cardCreation so deleting a
   *  highlight also strips the in-doc tint. */
  deleteNote: (id: string) => void;
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
  // Examples
  examples: ExampleInfo[];
  // Revisions
  revisionCards: RevisionCard[];
  updateRevisionCommentContent: RevisionsHook["updateCommentContent"];
  setRevisionCommentAiRequest: RevisionsHook["setCommentAiRequest"];
  updateRevisionSuggestionField: RevisionsHook["updateSuggestionField"];
  setRevisionSuggestionStatus: RevisionsHook["setSuggestionStatus"];
  convertRevisionCard: RevisionsHook["convertCard"];
  deleteRevisionCard: RevisionsHook["deleteCard"];
  // Errors
  latexErrors: LatexError[];
  paragraphByErrorId: Map<string, string>;
  errorSnippets: Map<string, string>;
  dismissedErrorIds: Set<string>;
  dismissError: (id: string) => void;
  jumpToError: (err: LatexError) => void;
  selectedErrorId: string | null;
  setSelectedErrorId: (id: string | null) => void;
  // Cutter
  cutterCards: CutterCard[];
  updateCutterCommentText: CutterHook["updateCommentText"];
  setCutterCommentAiRequest: CutterHook["setCommentAiRequest"];
  updateCutterSuggestionField: CutterHook["updateSuggestionField"];
  setCutterSuggestionStatus: CutterHook["setSuggestionStatus"];
  deleteCutterCard: CutterHook["deleteCard"];
  // Shell
  getOmniEnabled: (side: Side) => Set<OmniCategory>;
  getOmniHideAll: (side: Side) => boolean;
  /** When focus mode is active, anchored cards outside the focused block
   *  range are dimmed (unlocked) or hidden (locked) — mirroring the
   *  editor's own focus-dim/hide behavior. Unanchored cards are unaffected. */
  focusState?: FocusState | null;
}

export function OmniHost(p: OmniHostProps) {
  const { editorInstance, editorRef, setOverrideEditor } = useEditorRefContext();

  // Re-render on every editor transaction so we can re-read
  // ProseMirror plugin state (e.g. section-folding) that doesn't
  // change the `editorInstance` reference itself.
  const [editorTick, setEditorTick] = useState(0);
  useEffect(() => {
    if (!editorInstance) return;
    const onTr = () => setEditorTick((v) => v + 1);
    editorInstance.on("transaction", onTr);
    return () => {
      editorInstance.off("transaction", onTr);
    };
  }, [editorInstance]);
  const {
    selectedFootnoteId, setSelectedFootnoteId,
    selectedCitationId, setSelectedCitationId,
    selectedQuotationGroupId, setSelectedQuotationGroupId,
    selectedNoteId, setSelectedNoteId,
    selectedArchiveId, setSelectedArchiveId,
    selectedTodoId, setSelectedTodoId,
    selectedExampleId, setSelectedExampleId,
    selectedCommentId, setSelectedCommentId,
    selectedCutterCardId, setSelectedCutterCardId,
  } = useSelectionsContext();
  const { getCitationDisplayText, onCitationCreated } = useCitationDisplayContext();

  // Click-away in the omni panel clears the transient selection only.
  // Sticky cards (hand-clicked or focus-promoted) survive — they stay
  // expanded until the user clicks the card again to close.
  const handleBackgroundClick = useCallback(() => {
    cardStore.setTransient(null);
  }, []);
  // Focus moving into a card body promotes a transient selection into
  // the sticky set. Wired from OmniViewPanel's focusin listener.
  const handleCardFocus = useCallback(() => {
    cardStore.markSticky();
  }, []);
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
    (card: CardWithLinks, sourceEl?: HTMLElement | null) => {
      editorRef.current?.jumpToCard(card, sourceEl);
    },
    [editorRef],
  );
  const scrollToFootnote = useCallback(
    (id: string, sourceEl?: HTMLElement | null) => editorRef.current?.scrollToFootnote(id, sourceEl),
    [editorRef],
  );
  const scrollToCitation = useCallback(
    (id: string, sourceEl?: HTMLElement | null) => editorRef.current?.scrollToCitation(id, sourceEl),
    [editorRef],
  );
  const scrollToExample = useCallback(
    (id: string, sourceEl?: HTMLElement | null) => editorRef.current?.scrollToExample(id, sourceEl),
    [editorRef],
  );
  const replaceExampleLatex = useCallback(
    (id: string, latex: string) =>
      editorRef.current?.replaceExampleLatex(id, latex) ?? false,
    [editorRef],
  );
  const setExampleInOmni = useCallback(
    (id: string | null) => {
      setSelectedExampleId(id);
      if (id !== null) {
        setSelectedFootnoteId(null);
        setSelectedCitationId(null);
        setSelectedQuotationGroupId(null);
        setSelectedNoteId(null);
        setSelectedArchiveId(null);
        setSelectedTodoId(null);
      }
    },
    [
      setSelectedExampleId,
      setSelectedFootnoteId,
      setSelectedCitationId,
      setSelectedQuotationGroupId,
      setSelectedNoteId,
      setSelectedArchiveId,
      setSelectedTodoId,
    ],
  );

  // Revision/Cutter/Error selections live alongside the rest of the omni
  // selections. Selecting one clears the others so the omni surface stays
  // single-selection.
  const setRevisionInOmni = useCallback((id: string | null) => {
    setSelectedCommentId(id);
  }, [setSelectedCommentId]);
  const setCutterInOmni = useCallback((id: string | null) => {
    setSelectedCutterCardId(id);
  }, [setSelectedCutterCardId]);

  // Suggestion accept/reject — call setSuggestionStatus directly. The
  // native panel hosts also fire follow-up AI requests on accept; keeping
  // omni's accept lean keeps this builder side-effect-free.
  const acceptRevisionInOmni = useCallback(
    (id: string) => p.setRevisionSuggestionStatus(id, "accepted"),
    [p.setRevisionSuggestionStatus],
  );
  const rejectRevisionInOmni = useCallback(
    (id: string) => p.setRevisionSuggestionStatus(id, "rejected"),
    [p.setRevisionSuggestionStatus],
  );
  const acceptCutterInOmni = useCallback(
    (id: string) => p.setCutterSuggestionStatus(id, "accepted"),
    [p.setCutterSuggestionStatus],
  );
  const rejectCutterInOmni = useCallback(
    (id: string) => p.setCutterSuggestionStatus(id, "rejected"),
    [p.setCutterSuggestionStatus],
  );

  // Memoize the `items` array so its identity is stable across re-renders
  // unless the underlying data (or a selection id) actually changed. This
  // lets OmniViewPanel's memoized children (visibleItems, anchored,
  // unanchored, useInTextPositions) stay cached between renders — which
  // matters now that OmniHost is mounted persistently per side.
  const items: OmniItem[] = useMemo(() => [
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
      deleteCitation: p.deleteCitation,
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
      cards: p.notesCards,
      selectedNoteId,
      setSelectedNoteId: setNoteInOmni,
      jumpToCard,
      findParagraphPos,
      updateNote: p.updateNote,
      updateNoteTitle: p.updateNoteTitle,
      setNoteAiRequest: p.setNoteAiRequest,
      setHighlightAiRequest: p.setHighlightAiRequest,
      addNoteForHighlight: p.addNoteForHighlight,
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
    ...buildExampleOmniItems({
      examples: p.examples,
      selectedExampleId,
      setSelectedExampleId: setExampleInOmni,
      onJump: scrollToExample,
      onUpdateLatex: replaceExampleLatex,
    }),
    ...buildRevisionOmniItems({
      cards: p.revisionCards,
      selectedId: selectedCommentId,
      setSelectedId: setRevisionInOmni,
      jumpToCard,
      findParagraphPos,
      editor: editorInstance,
      updateCommentContent: p.updateRevisionCommentContent,
      setCommentAiRequest: p.setRevisionCommentAiRequest,
      updateSuggestionField: p.updateRevisionSuggestionField,
      acceptSuggestion: acceptRevisionInOmni,
      rejectSuggestion: rejectRevisionInOmni,
      convertCard: p.convertRevisionCard,
      deleteCard: p.deleteRevisionCard,
    }),
    ...buildErrorOmniItems({
      errors: p.latexErrors,
      selectedId: p.selectedErrorId,
      setSelectedId: p.setSelectedErrorId,
      paragraphByErrorId: p.paragraphByErrorId,
      snippets: p.errorSnippets,
      anchoredIds: new Set(p.paragraphByErrorId.keys()),
      dismissedIds: p.dismissedErrorIds,
      onDismiss: p.dismissError,
      onJump: p.jumpToError,
      findParagraphPos,
    }),
    ...buildCutterOmniItems({
      cards: p.cutterCards,
      selectedId: selectedCutterCardId,
      setSelectedId: setCutterInOmni,
      jumpToCard,
      findParagraphPos,
      editor: editorInstance,
      updateCommentText: p.updateCutterCommentText,
      setCommentAiRequest: p.setCutterCommentAiRequest,
      updateSuggestionField: p.updateCutterSuggestionField,
      acceptSuggestion: acceptCutterInOmni,
      rejectSuggestion: rejectCutterInOmni,
      deleteCard: p.deleteCutterCard,
    }),
  ], [
    // Data arrays
    p.footnotes, p.orphanedFootnotes,
    p.citations, p.citationPositionMap, p.bibEntries, p.bibPackage,
    p.quotationGroups,
    p.notesCards,
    p.sortedArchiveSnippets, p.anchoredIds,
    p.todoItems,
    p.examples,
    p.revisionCards,
    p.latexErrors, p.paragraphByErrorId, p.errorSnippets, p.dismissedErrorIds,
    p.cutterCards,
    // Selection ids
    selectedFootnoteId, selectedCitationId, selectedQuotationGroupId,
    selectedNoteId, selectedArchiveId, selectedTodoId, selectedExampleId,
    selectedCommentId, selectedCutterCardId, p.selectedErrorId,
    // Stable callbacks from this component
    setFootnoteInOmni, setCitationInOmni, setQuotationGroupInOmni,
    setNoteInOmni, setArchiveInOmni, setTodoInOmni, setExampleInOmni,
    setRevisionInOmni, setCutterInOmni, p.setSelectedErrorId,
    acceptRevisionInOmni, rejectRevisionInOmni, acceptCutterInOmni, rejectCutterInOmni,
    scrollToFootnote, scrollToCitation, scrollToExample, replaceExampleLatex, jumpToCard, findParagraphPos,
    editorInstance,
    // Contexts
    setOverrideEditor, getCitationDisplayText, onCitationCreated,
    // Footnote handlers
    p.handleEditFootnote, p.handleDeleteFootnote, p.handleEditFootnoteTitle,
    p.handleEditOrphan, p.handleDeleteOrphan, p.handleEditOrphanTitle,
    // Citation/bib handlers
    p.updateCitation, p.getFormattedBib, p.updateBibEntry, p.updateBibKeyAndType,
    p.getAnnotation, p.setAnnotation,
    p.requestBibReview, p.cancelBibReview, p.getBibReviewStatus,
    // Quotation handlers
    p.deleteQuotationGroup, p.updateQuotationGroupTitle,
    p.addQuotationReference, p.deleteQuotationReference, p.updateQuotationReferenceCiteKey,
    p.addQuotationQuote, p.updateQuotationQuote, p.deleteQuotationQuote,
    p.updateQuotationNotes,
    // Note handlers
    p.updateNote, p.updateNoteTitle, p.deleteNote,
    // Archive handlers
    p.updateArchiveSnippet, p.updateArchiveSnippetTitle, p.handleDeleteArchive,
    // Todo handlers
    p.toggleTodo, p.updateTodo, p.updateTodoNotes, p.setTodoAiRequest, p.deleteTodo,
    // Revision handlers
    p.updateRevisionCommentContent, p.setRevisionCommentAiRequest,
    p.updateRevisionSuggestionField, p.convertRevisionCard, p.deleteRevisionCard,
    // Error handlers
    p.dismissError, p.jumpToError,
    // Cutter handlers
    p.updateCutterCommentText, p.setCutterCommentAiRequest,
    p.updateCutterSuggestionField, p.deleteCutterCard,
  ]);

  // Hide cards anchored inside a collapsed section. The section-folding
  // plugin already hides the prose via a CSS decoration; mirror that on
  // the omni side so dangling cards don't sit next to a section that's
  // not visible. Native panel lists are unaffected — this only filters
  // the in-text-positioned omni mirror.
  const hiddenTopLevel = useMemo<ReadonlySet<number>>(() => {
    if (!editorInstance) return EMPTY_HIDDEN;
    return getHiddenTopLevelIndices(editorInstance.state);
    // editorTick forces re-eval on every editor transaction (fold toggles
    // dispatch a transaction but don't change editorInstance's identity).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorInstance, editorTick]);

  // Focus view is presentation-only: it never removes or disables cards.
  // Cards whose anchor falls outside [startBlockIndex, endBlockIndex] are
  // tagged for a subtle visual dim that mirrors the editor's outside-band
  // dimming. They remain fully interactive — clickable, editable, deletable.
  //
  // Fold filter (pass 1) runs first and *does* drop cards: folding is an
  // explicit user gesture to hide content; focus view is not.
  const displayedItems: OmniItem[] = useMemo(() => {
    const doc = editorInstance?.state.doc ?? null;

    // Pass 1: fold filter.
    let foldFiltered: OmniItem[];
    if (hiddenTopLevel.size === 0 || !doc) {
      foldFiltered = items;
    } else {
      foldFiltered = [];
      for (const item of items) {
        if (item.pos == null) { foldFiltered.push(item); continue; }
        let bi: number | null = null;
        try { bi = doc.resolve(item.pos).index(0); } catch { /* stale */ }
        if (bi == null || !hiddenTopLevel.has(bi)) {
          foldFiltered.push(item);
        }
        // else: drop — card lives in a collapsed section
      }
    }

    // Pass 2: outside-focus tagging (visual only).
    const fs = p.focusState;
    if (!fs?.active || !doc) return foldFiltered;
    const { startBlockIndex, endBlockIndex } = fs;
    return foldFiltered.map((item) => {
      if (item.pos == null) return item;
      let bi: number | null = null;
      try { bi = doc.resolve(item.pos).index(0); } catch { return item; }
      if (bi == null) return item;
      const outside = bi < startBlockIndex || bi > endBlockIndex;
      if (!outside) return item;
      return {
        ...item,
        content: (
          <div
            data-omni-outside-focus="true"
            style={{ opacity: 0.55, transition: "opacity 200ms ease" }}
          >
            {item.content}
          </div>
        ),
      };
    });
  }, [items, hiddenTopLevel, p.focusState, editorInstance]);

  return (
    <OmniViewPanel
      side={p.side}
      items={displayedItems}
      editor={editorInstance}
      enabledCategories={p.getOmniEnabled(p.side)}
      hideAllCards={p.getOmniHideAll(p.side)}
      onBackgroundClick={handleBackgroundClick}
      onCardFocus={handleCardFocus}
    />
  );
}
