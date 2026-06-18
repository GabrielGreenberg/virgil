"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getHiddenTopLevelIndices, sectionFoldingPluginKey } from "@/lib/section-folding";
import { getBus } from "@/lib/tiptap/doc-structure";
import { useLivePosResolver } from "@/hooks/useLivePosResolver";
import { filterOmniItemsByFoldAndFocus } from "./omni-fold-focus-filter";
import { cardPopKey } from "@/panels/panel-registry";
import type { Side } from "@/hooks/useViewPrefs";
import OmniViewPanel, { type OmniItem, type OmniCategory } from "@/panels/Omni";
import { buildCitationOmniItems } from "@/panels/Citations";
import { buildFootnoteOmniItems } from "@/panels/Footnotes";
import { buildNoteOmniItems } from "@/panels/Notes";
import { buildArchiveOmniItems } from "@/panels/Archive";
import { buildTodoOmniItems } from "@/panels/Todo";
import { buildExampleOmniItems } from "@/panels/Examples";
import { buildRevisionOmniItems } from "@/panels/Revisions";
import { buildErrorOmniItems } from "@/panels/Errors";
import { buildCutterOmniItems } from "@/panels/Cutter";
import { buildReportsOmniItems } from "@/panels/Reports";
import type { useNotes } from "@/hooks/useNotes";
import type { useTodos } from "@/hooks/useTodos";
import type { useCitations } from "@/hooks/useCitations";
import type { useAnnotations } from "@/hooks/useAnnotations";
import type { useBibReview } from "@/hooks/useBibReview";
import type { useRevisions } from "@/hooks/useRevisions";
import type { useCutter } from "@/hooks/useCutter";
import type { useReports } from "@/hooks/useReports";
import type { JSONContent } from "@tiptap/react";
import type { Transaction } from "@tiptap/pm/state";
import type {
  ArchivedSnippet,
  OrphanedFootnote,
  RevisionCard,
  CutterCard,
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
type CitationsHook = ReturnType<typeof useCitations>;
type AnnotationsHook = ReturnType<typeof useAnnotations>;
type BibReviewHook = ReturnType<typeof useBibReview>;
type RevisionsHook = ReturnType<typeof useRevisions>;
type CutterHook = ReturnType<typeof useCutter>;
type ReportsHook = ReturnType<typeof useReports>;

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
  // Notes (polymorphic: hosts both `note` and `highlight` cards)
  notesCards: NotesHook["cards"];
  updateNote: NotesHook["updateNote"];
  updateNoteTitle: NotesHook["updateNoteTitle"];
  setNoteAiRequest: NotesHook["setNoteAiRequest"];
  setHighlightAiRequest: NotesHook["setHighlightAiRequest"];
  /** Morph note ⇄ highlight via the kind-chevron (R14) — the EditorPane
   *  morph chokepoint (lossy confirm + float-key remap). */
  convertNotesCard: (id: string, toKind: "note" | "highlight") => void;
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
  /** Controlled error-card expansion (R5): ONE scope owned by EditorPane,
   *  shared with the docked ErrorsPanel — expanding here expands there. */
  expandedErrorIds: Set<string>;
  expandError: (id: string) => void;
  toggleErrorExpanded: (id: string) => void;
  // Cutter
  cutterCards: CutterCard[];
  updateCutterCommentContent: CutterHook["updateCommentContent"];
  setCutterCommentAiRequest: CutterHook["setCommentAiRequest"];
  updateCutterSuggestionField: CutterHook["updateSuggestionField"];
  setCutterSuggestionStatus: CutterHook["setSuggestionStatus"];
  /** Morph cutter comment ⇄ suggestion via the kind-chevron. */
  convertCutterCard: (id: string, toKind: "comment" | "suggestion") => void;
  deleteCutterCard: CutterHook["deleteCard"];
  // Reports
  reportCards: ReportsHook["cards"];
  updateReportContent: ReportsHook["updateReportContent"];
  updateReportTitle: ReportsHook["updateReportTitle"];
  updateRequestContent: ReportsHook["updateRequestContent"];
  setRequestAiRequest: ReportsHook["setRequestAiRequest"];
  /** Morph report ⇄ report-request via the kind-chevron. */
  convertReportCard: (id: string, toKind: "report" | "report-request") => void;
  deleteReportCard: ReportsHook["deleteCard"];
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

  // Re-derive `hiddenTopLevel` only on events that legitimately invalidate
  // it: fold-state changes (via the section-folding plugin's meta) and
  // heading add/remove (via the DocStructureBus — heading positions
  // changing shifts which top-level child indices are folded).
  //
  // Ordinary typing inside any block — including a heading's text —
  // doesn't change which top-level indices are folded. Pre-fix, this
  // bumped on every `docChanged` transaction; the resulting OmniHost
  // re-render cascaded through `useInTextPositions.measure()` into a
  // per-keystroke `coordsAtPos` storm visible as card flicker below
  // the cursor. See plan `ok-lets-do-a-dreamy-thacker.md` (flicker fix).
  const [editorTick, setEditorTick] = useState(0);
  useEffect(() => {
    if (!editorInstance) return;
    const bump = () => setEditorTick((v) => v + 1);
    const bus = getBus(editorInstance);
    // (a) Fold-toggle / collapseAll / expandAll: dispatched as a
    //     transaction carrying `sectionFoldingPluginKey` meta. No bus
    //     event covers this — the plugin's apply runs synchronously
    //     inside the same tx.
    const onTr = (props: { transaction: Transaction }) => {
      if (props.transaction.getMeta(sectionFoldingPluginKey) !== undefined) {
        bump();
      }
    };
    editorInstance.on("transaction", onTr);
    // (b) Heading add/remove: shifts the top-level child index map that
    //     `getHiddenTopLevelIndices` walks. The fold-state plugin
    //     already prunes dead UUIDs from its set on the same tx
    //     (section-folding.ts handles that via the same bus events).
    const u1 = bus?.onHeadingsAdded(bump) ?? (() => {});
    const u2 = bus?.onHeadingsRemoved(bump) ?? (() => {});
    return () => {
      editorInstance.off("transaction", onTr);
      u1();
      u2();
    };
  }, [editorInstance]);
  const {
    selectedFootnoteId, setSelectedFootnoteId,
    selectedCitationId, setSelectedCitationId,
    selectedNoteId, setSelectedNoteId,
    selectedArchiveId, setSelectedArchiveId,
    selectedTodoId, setSelectedTodoId,
    selectedExampleId, setSelectedExampleId,
    selectedCommentId, setSelectedCommentId,
    selectedCutterCardId, setSelectedCutterCardId,
    selectedReportCardId, setSelectedReportCardId,
  } = useSelectionsContext();
  const { getCitationDisplayText, onCitationCreated } = useCitationDisplayContext();

  // Click-away in the omni panel clears the selection (halo) only.
  // Expanded cards survive — expansion is sticky and independent of
  // selection (N1), so they stay open until collapsed via the chevron.
  const handleBackgroundClick = useCallback(() => {
    cardStore.clearSelection();
  }, []);
  // Focus moving into a card body used to promote a transient selection
  // into the sticky set; obsolete now that expansion is sticky by
  // construction (nothing to promote). Kept as a no-op so OmniViewPanel's
  // focusin wiring stays intact (expand-on-focus, if wanted, is an A5 follow-up).
  const handleCardFocus = useCallback(() => {}, []);
  const setFootnoteInOmni = useCallback((id: string | null) => {
    setSelectedFootnoteId(id);
    if (id !== null) {
      setSelectedCitationId(null);
      setSelectedNoteId(null);
      setSelectedArchiveId(null);
      setSelectedTodoId(null);
    }
  }, [
    setSelectedFootnoteId,
    setSelectedCitationId,
    setSelectedNoteId,
    setSelectedArchiveId,
    setSelectedTodoId,
  ]);
  const setCitationInOmni = useCallback((id: string | null) => {
    setSelectedCitationId(id);
    if (id !== null) {
      setSelectedFootnoteId(null);
      setSelectedNoteId(null);
      setSelectedArchiveId(null);
      setSelectedTodoId(null);
    }
  }, [
    setSelectedCitationId,
    setSelectedFootnoteId,
    setSelectedNoteId,
    setSelectedArchiveId,
    setSelectedTodoId,
  ]);
  const setNoteInOmni = useCallback((id: string | null) => {
    setSelectedNoteId(id);
    if (id !== null) {
      setSelectedFootnoteId(null);
      setSelectedCitationId(null);
      setSelectedArchiveId(null);
      setSelectedTodoId(null);
    }
  }, [
    setSelectedNoteId,
    setSelectedFootnoteId,
    setSelectedCitationId,
    setSelectedArchiveId,
    setSelectedTodoId,
  ]);
  const setArchiveInOmni = useCallback((id: string | null) => {
    setSelectedArchiveId(id);
    if (id !== null) {
      setSelectedFootnoteId(null);
      setSelectedCitationId(null);
      setSelectedNoteId(null);
      setSelectedTodoId(null);
    }
  }, [
    setSelectedArchiveId,
    setSelectedFootnoteId,
    setSelectedCitationId,
    setSelectedNoteId,
    setSelectedTodoId,
  ]);
  const setTodoInOmni = useCallback((id: string | null) => {
    setSelectedTodoId(id);
    if (id !== null) {
      setSelectedFootnoteId(null);
      setSelectedCitationId(null);
      setSelectedNoteId(null);
      setSelectedArchiveId(null);
    }
  }, [
    setSelectedTodoId,
    setSelectedFootnoteId,
    setSelectedCitationId,
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
  const setExampleInOmni = useCallback(
    (id: string | null) => {
      setSelectedExampleId(id);
      if (id !== null) {
        setSelectedFootnoteId(null);
        setSelectedCitationId(null);
          setSelectedNoteId(null);
        setSelectedArchiveId(null);
        setSelectedTodoId(null);
      }
    },
    [
      setSelectedExampleId,
      setSelectedFootnoteId,
      setSelectedCitationId,
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
  const setReportInOmni = useCallback((id: string | null) => {
    setSelectedReportCardId(id);
  }, [setSelectedReportCardId]);

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
      convertCard: p.convertNotesCard,
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
      expandedIds: p.expandedErrorIds,
      onExpand: p.expandError,
      onToggleExpanded: p.toggleErrorExpanded,
    }),
    ...buildCutterOmniItems({
      cards: p.cutterCards,
      selectedId: selectedCutterCardId,
      setSelectedId: setCutterInOmni,
      jumpToCard,
      findParagraphPos,
      editor: editorInstance,
      updateCommentContent: p.updateCutterCommentContent,
      setCommentAiRequest: p.setCutterCommentAiRequest,
      updateSuggestionField: p.updateCutterSuggestionField,
      acceptSuggestion: acceptCutterInOmni,
      rejectSuggestion: rejectCutterInOmni,
      convertCard: p.convertCutterCard,
      deleteCard: p.deleteCutterCard,
    }),
    ...buildReportsOmniItems({
      cards: p.reportCards,
      selectedId: selectedReportCardId,
      setSelectedId: setReportInOmni,
      jumpToCard,
      findParagraphPos,
      updateReportContent: p.updateReportContent,
      updateReportTitle: p.updateReportTitle,
      updateRequestContent: p.updateRequestContent,
      setRequestAiRequest: p.setRequestAiRequest,
      convertCard: p.convertReportCard,
      deleteCard: p.deleteReportCard,
    }),
  ], [
    // Data arrays
    p.footnotes, p.orphanedFootnotes,
    p.citations, p.citationPositionMap, p.bibEntries, p.bibPackage,
    p.notesCards,
    p.sortedArchiveSnippets, p.anchoredIds,
    p.todoItems,
    p.examples,
    p.revisionCards,
    p.latexErrors, p.paragraphByErrorId, p.errorSnippets, p.dismissedErrorIds,
    p.cutterCards,
    p.reportCards,
    // Selection ids
    selectedFootnoteId, selectedCitationId,
    selectedNoteId, selectedArchiveId, selectedTodoId, selectedExampleId,
    selectedCommentId, selectedCutterCardId, selectedReportCardId, p.selectedErrorId,
    // Stable callbacks from this component
    setFootnoteInOmni, setCitationInOmni,
    setNoteInOmni, setArchiveInOmni, setTodoInOmni, setExampleInOmni,
    setRevisionInOmni, setCutterInOmni, setReportInOmni, p.setSelectedErrorId,
    acceptRevisionInOmni, rejectRevisionInOmni, acceptCutterInOmni, rejectCutterInOmni,
    scrollToFootnote, scrollToCitation, scrollToExample, jumpToCard, findParagraphPos,
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
    // Note handlers
    p.updateNote, p.updateNoteTitle, p.convertNotesCard, p.deleteNote,
    // Archive handlers
    p.updateArchiveSnippet, p.updateArchiveSnippetTitle, p.handleDeleteArchive,
    // Todo handlers
    p.toggleTodo, p.updateTodo, p.updateTodoNotes, p.setTodoAiRequest, p.deleteTodo,
    // Revision handlers
    p.updateRevisionCommentContent, p.setRevisionCommentAiRequest,
    p.updateRevisionSuggestionField, p.convertRevisionCard, p.deleteRevisionCard,
    // Error handlers
    p.dismissError, p.jumpToError,
    p.expandedErrorIds, p.expandError, p.toggleErrorExpanded,
    // Cutter handlers
    p.updateCutterCommentContent, p.setCutterCommentAiRequest,
    p.updateCutterSuggestionField, p.convertCutterCard, p.deleteCutterCard,
    // Reports handlers
    p.convertReportCard,
  ]);

  // Live in-text position resolver for the fold/focus binning below. The
  // entity-anchored omni kinds (footnote / citation / example) carry a `pos`
  // baked when `items` was last (structurally) rebuilt; plain typing that
  // shifts later content re-maps the LIVE snapshot pos every transaction but
  // leaves that baked `pos` stale, so a fold/boundary classification keyed on
  // the baked pos can land in the WRONG bin (OMNI-F1-02). Resolve the live pos
  // from the DocStructureObserver snapshot — the same engine OmniViewPanel's
  // cascade already uses — and fall back to the baked pos for paragraph-anchored
  // kinds (note/todo/… and the multi-anchor `@N` rows), whose pos is the
  // structurally-rebuilt `findParagraphPos`. Snapshot-identity-cached, so plain
  // typing rebuilds nothing here (keystroke sanctity) — see useLivePosResolver.
  const resolvePos = useLivePosResolver(editorInstance, cardPopKey);

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

  // Focus view: a card whose anchor falls outside the focused band has a
  // hidden in-text anchor (the focusViewPlugin display:none's that block), so
  // it can't cascade inline. Rather than DROP it (which silently hides
  // user-created cards and reads as data loss), we STAMP `outsideFocus` and
  // keep it — OmniViewPanel routes stamped cards into the collapsed "N outside
  // focus" bin. Applies whenever focus is active (locked or not); the in-text
  // anchor is hidden in both modes.
  //
  // Fold filter (pass 1) runs first: cards in a collapsed section are
  // dropped outright, independent of focus.
  const displayedItems: OmniItem[] = useMemo(() => {
    const doc = editorInstance?.state.doc ?? null;
    // Two-pass fold/focus binning on the LIVE pos (resolvePos) — see
    // `filterOmniItemsByFoldAndFocus` (OMNI-F1-02). Pure + unit-tested.
    return filterOmniItemsByFoldAndFocus(items, doc, hiddenTopLevel, p.focusState, resolvePos);
  }, [items, hiddenTopLevel, p.focusState, editorInstance, resolvePos]);

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
