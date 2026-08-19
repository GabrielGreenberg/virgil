"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getHiddenTopLevelIndices } from "@/lib/section-folding";
import { getBus } from "@/lib/tiptap/doc-structure";
import { useStructuralRevisions } from "@/hooks/useStructuralRevisions";
import { useLivePosResolver, buildParagraphAnchorMap } from "@/hooks/useLivePosResolver";
import { filterOmniItemsByFoldAndFocus } from "./omni-fold-focus-filter";
import { subscribeFoldMirrorInvalidation } from "./omni-fold-mirror-invalidation";
import {
  buildNestedContainerChildMap,
  nestContainerChildren,
  type NestedContainer,
} from "./nest-footnote-children";
import { cardPopKey } from "@/panels/panel-registry";
import type { Side } from "@/hooks/useViewPrefs";
import OmniViewPanel, {
  type OmniItem,
  type OmniCategory,
  type OmniBulkPendingChanges,
} from "@/panels/Omni";
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
import type {
  ArchivedSnippet,
  OrphanedFootnote,
  FootnoteRef,
  RevisionCard,
  CutterCard,
} from "@/lib/types";
import type { LatexError } from "@/lib/latex-errors";
import type { ErrorJump } from "@/panels/Errors";
import type { FootnoteInfo, ExampleInfo } from "../../Editor";
import type { CardWithLinks } from "@/links/links";
import { buildCardAnchorPass } from "@/links/card-anchor-rows";
import type { FocusState } from "@/hooks/useFocusMode";
import { useEditorRefContext } from "../contexts/editor-ref";
import { useSelectionsContext } from "../contexts/selections";
import { useCitationDisplayContext } from "../contexts/citation-display";
import { useCardStore } from "@/links/_shared/anchored-card-store";

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
  /** Task 077: atomless footnote refs (archive-born `FootnoteRef`), plus the
   *  ref-delete handler (removes only the sidecar ref — no atom to splice). Edit
   *  reuses `handleEditFootnote` (the docked panel wires the same handler). The
   *  builder filters archived refs out, so this may carry the full ref list. */
  unanchoredFootnotes: FootnoteRef[];
  onDeleteUnanchoredFootnote: (id: string) => void;
  /** BUG #55: per-footnote AI-request flags + toggle (from the footnotes.json
   *  sidecar via EditorPane). */
  footnoteAiRequests: Record<string, boolean>;
  setFootnoteAiRequest: (id: string, value: boolean) => void;
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
  /** The visual errors jump, as an `ErrorJump` capability (task 125) — mode +
   *  handler together, forwarded whole from `useDiagnostics`. */
  errorJump: ErrorJump;
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
  /** When true, omni cards rest dimmed and brighten on hover (the
   *  `omniDimResting` view-pref). Forwarded to OmniViewPanel as `dimResting`. */
  omniDimResting?: boolean;
  /** Only when focus is LOCKED, anchored cards outside the focused block range
   *  are routed to the "outside focus" bin — mirroring the editor's own
   *  lock-gated hide. A mere focus selection (active && !locked) confines
   *  nothing, so no card is binned. Unanchored cards are always unaffected. */
  focusState?: FocusState | null;
  /** Reports this side's visible-card count up to the PanelColumn so a column
   *  showing omni cards (but no docked band) stays open in the narrow Reader
   *  pane. Passed straight through to OmniViewPanel; never fires on a plain
   *  keystroke. */
  onVisibleCardsChange?: (count: number) => void;
  /** Phase 3 / task 023 — the applied-pending NAVIGATOR affordance (prev/next
   *  cursor + Keep-all / Dismiss-all kebab). EditorPane derives the cursor +
   *  drains from the applied revision + cutter cards (routed through the shared
   *  `pending-change-actions` sequence). The header renders only when this side
   *  actually SHOWS an applied pending card (computed below from the enabled
   *  categories), so it appears once — on whichever side hosts the
   *  revisions/cutter omni cards. Absent / count 0 → no header (flag-OFF never
   *  produces applied cards). */
  bulkPendingChanges?: OmniBulkPendingChanges;
}

export function OmniHost(p: OmniHostProps) {
  const { editorInstance, editorRef, setOverrideEditor } = useEditorRefContext();

  // Per-category structural counters (DocStructureBus-backed). Used to gate the
  // footnote-child nesting derivation below: `rev.citations` bumps on citation
  // add/remove/reorder/attr-change AND on footnote-body edits (where a nested
  // cite lives) — but stays SILENT on a plain keystroke, so the nesting map is
  // never re-derived per keystroke (keystroke sanctity).
  const rev = useStructuralRevisions(editorInstance);

  // Re-derive `hiddenTopLevel` only on events that legitimately invalidate
  // it: fold-state changes AND anything that shifts the absolute top-level
  // child index map `getHiddenTopLevelIndices` reads — heading add/remove
  // AND plain block add/remove/reorder. The invalidation set lives in
  // `subscribeFoldMirrorInvalidation`, which MIRRORS the section-folding
  // plugin's own `hiddenIdx`-rebuild triggers (task 126: bumping on
  // "headings only" left the mirror stale after a block edit while a
  // section was folded, mis-binning cards until the next fold toggle).
  //
  // Ordinary typing inside any block — including a heading's text —
  // doesn't change which top-level indices are folded, and every source
  // is fold-meta or a structural bus event, so this stays keystroke-safe
  // (`emitCount` flat). Pre-flicker-fix this bumped on every `docChanged`
  // transaction; the resulting OmniHost re-render cascaded through
  // `useInTextPositions.measure()` into a per-keystroke `coordsAtPos`
  // storm. See plan `ok-lets-do-a-dreamy-thacker.md` (flicker fix).
  const [editorTick, setEditorTick] = useState(0);
  useEffect(() => {
    if (!editorInstance) return;
    return subscribeFoldMirrorInvalidation(editorInstance, () =>
      setEditorTick((v) => v + 1),
    );
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
  // This doc's interaction store (OmniHost renders inside EditorPane's
  // CardStoreProvider). Click-away clears THIS doc's selection only.
  const cardStore = useCardStore();

  // Click-away in the omni panel clears the selection (halo) only.
  // Expanded cards survive — expansion is sticky and independent of
  // selection (N1), so they stay open until collapsed via the chevron.
  const handleBackgroundClick = useCallback(() => {
    cardStore.clearSelection();
  }, [cardStore]);
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

  /**
   * ONE anchor-resolution pass for the whole omni surface (task 369).
   *
   * Every paragraph-anchored builder used to answer "which paragraph is this
   * card on?" for itself, with a bare live-uuid lookup — while the margin
   * marker builder routed the same question through the four-rung
   * anchor-recovery SSOT. So a card the margin RECOVERED (surviving
   * `linkedAnchor` mark, or a text snapshot that still matches a live
   * paragraph) painted an ordinary marker in the margin and was binned
   * `pos: null` into the omni orphan strip: marker in the margin, card nowhere
   * near it. Both surfaces now read the SAME rows.
   *
   * Keystroke sanctity — and a net REDUCTION: this builds ONE
   * `buildResolveIndex` (O(doc), card-count-independent) per STRUCTURAL change
   * and resolves each card in O(1) against it, where the retired
   * `findParagraphPos` ran a full `descendants` walk PER PID (O(doc · anchors))
   * on every items rebuild. `rev.anchors` / `rev.blocks` are the
   * DocStructureBus counters, so plain typing rebuilds nothing here.
   */
  const anchorPass = useMemo(
    () => buildCardAnchorPass(editorInstance),
    // The counters are the structural GATE, not a value the factory reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editorInstance, rev.anchors, rev.blocks],
  );
  const resolveCardRows = anchorPass.resolve;
  // The bare uuid→pos lookup off the SAME index — Errors only (its paragraph
  // ids come from the diagnostics pass, not from a card's links, so it has no
  // recovery ladder to run). Never use this to answer "where is a CARD
  // anchored?"; that is `resolveCardRows`.
  const findParagraphPos = anchorPass.posOf;
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
  const items: OmniItem[] = useMemo(() => {
    // Archived cards never appear in OmniView — they live only under their home
    // panel's View Archives/All. Each card carries its own `archived` flag, so
    // this is a local filter (no archived-id set needed). The docked panels
    // still receive the FULL arrays (CardListPanel filters by view mode).
    const active = <T extends { archived?: boolean }>(arr: readonly T[]): T[] =>
      arr.filter((c) => !c.archived);
    const activeNotes = active(p.notesCards);
    const activeArchive = active(p.sortedArchiveSnippets);
    const activeTodos = active(p.todoItems);
    const activeRevisions = active(p.revisionCards);
    const activeCutter = active(p.cutterCards);
    const activeReports = active(p.reportCards);
    return [
    ...buildFootnoteOmniItems({
      footnotes: p.footnotes,
      orphanedFootnotes: p.orphanedFootnotes,
      // Task 077: surface active unanchored refs in Omni too. The builder filters
      // archived out; edit reuses handleEditFootnote (same as the docked panel).
      unanchoredFootnotes: p.unanchoredFootnotes,
      onEditUnanchored: p.handleEditFootnote,
      onDeleteUnanchored: p.onDeleteUnanchoredFootnote,
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
      footnoteAiRequests: p.footnoteAiRequests,
      onSetFootnoteAiRequest: p.setFootnoteAiRequest,
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
      cards: activeNotes,
      selectedNoteId,
      setSelectedNoteId: setNoteInOmni,
      jumpToCard,
      resolveCardRows,
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
      archiveSnippets: activeArchive,
      selectedArchiveId,
      setSelectedArchiveId: setArchiveInOmni,
      jumpToCard,
      resolveCardRows,
      updateArchiveSnippet: p.updateArchiveSnippet,
      updateArchiveSnippetTitle: p.updateArchiveSnippetTitle,
      handleDeleteArchive: p.handleDeleteArchive,
      setOverrideEditor,
      getCitationDisplayText,
      onCitationCreated,
    }),
    ...buildTodoOmniItems({
      todoItems: activeTodos,
      selectedTodoId,
      setSelectedTodoId: setTodoInOmni,
      jumpToCard,
      resolveCardRows,
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
      cards: activeRevisions,
      selectedId: selectedCommentId,
      setSelectedId: setRevisionInOmni,
      jumpToCard,
      resolveCardRows,
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
      jump: p.errorJump,
      findParagraphPos,
      expandedIds: p.expandedErrorIds,
      onExpand: p.expandError,
      onToggleExpanded: p.toggleErrorExpanded,
    }),
    ...buildCutterOmniItems({
      cards: activeCutter,
      selectedId: selectedCutterCardId,
      setSelectedId: setCutterInOmni,
      jumpToCard,
      resolveCardRows,
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
      cards: activeReports,
      selectedId: selectedReportCardId,
      setSelectedId: setReportInOmni,
      jumpToCard,
      resolveCardRows,
      updateReportContent: p.updateReportContent,
      updateReportTitle: p.updateReportTitle,
      updateRequestContent: p.updateRequestContent,
      setRequestAiRequest: p.setRequestAiRequest,
      convertCard: p.convertReportCard,
      deleteCard: p.deleteReportCard,
      setOverrideEditor,
      getCitationDisplayText,
      onCitationCreated,
    }),
  ];
  }, [
    // Data arrays
    p.footnotes, p.orphanedFootnotes, p.unanchoredFootnotes,
    p.citations, p.citationPositionMap, p.bibEntries, p.bibPackage,
    p.notesCards,
    p.sortedArchiveSnippets,
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
    scrollToFootnote, scrollToCitation, scrollToExample, jumpToCard,
    findParagraphPos, resolveCardRows,
    editorInstance,
    // Contexts
    setOverrideEditor, getCitationDisplayText, onCitationCreated,
    // Footnote handlers
    p.handleEditFootnote, p.handleDeleteFootnote, p.handleEditFootnoteTitle,
    p.handleEditOrphan, p.handleDeleteOrphan, p.handleEditOrphanTitle,
    p.onDeleteUnanchoredFootnote,
    // #55b: the footnote AI-request flag lives in a SEPARATE `footnoteAiRequests`
    // map (not carried by `p.footnotes`, unlike note/todo whose flag rides their
    // card array), so without these deps the omni checkbox wouldn't re-render on
    // toggle until an unrelated rebuild. Both are stable refs/maps (the map only
    // identity-changes when a flag flips; the setter is a stable useCallback) —
    // not per-keystroke recomputation, so no keystroke-sanctity cost.
    p.footnoteAiRequests, p.setFootnoteAiRequest,
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
    p.dismissError, p.errorJump,
    p.expandedErrorIds, p.expandError, p.toggleErrorExpanded,
    // Cutter handlers
    p.updateCutterCommentContent, p.setCutterCommentAiRequest,
    p.updateCutterSuggestionField, p.convertCutterCard, p.deleteCutterCard,
    // Reports handlers
    p.convertReportCard,
  ]);

  // Container-child nesting (PHASE 1 footnotes + PHASE 2a examples). Derive the
  // `citationId → { kind, id }` container-owner map from the DocStructureObserver
  // snapshot (`nestedInContainerId`, already in the snapshot — no doc walk).
  // Gated on `[editorInstance, rev.citations]`: it runs once the editor mounts
  // (the counter is silent on load, so the editor dep triggers the first derive)
  // and re-runs only when citations / footnote-bodies / example-bodies change —
  // NEVER on a plain keystroke, so `window.__virgilBusStats().emitCount` stays
  // flat while typing (keystroke sanctity; see AGENTS.md "Card-source
  // derivation"). `rev.citations` bumps on example-body cite changes too (the
  // structural counter folds in `addedCitations`/`removedCitations`).
  const nestedContainerChildMap = useMemo(() => {
    if (!editorInstance) return new Map<string, NestedContainer>();
    const bus = getBus(editorInstance);
    if (!bus) return new Map<string, NestedContainer>();
    return buildNestedContainerChildMap(bus.structure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorInstance, rev.citations]);

  // Apply the nesting transform: stamp `parentCardId` on container-nested cites
  // + reorder so each child immediately follows its parent container item
  // (footnote OR example card). Pure + identity-stable (returns `items`
  // unchanged when nothing nests), so this adds no churn for docs without nested
  // cites and downstream memos stay cached. Children REMAIN in the list (they
  // keep cascading as their own cards, sharing the container's pos — the
  // useInTextPositions overlap pass stacks them directly below the container).
  const nestedItems: OmniItem[] = useMemo(
    () => nestContainerChildren(items, nestedContainerChildMap),
    [items, nestedContainerChildMap],
  );

  // Live in-text position resolver for the fold/focus binning below. The
  // entity-anchored omni kinds (footnote / citation / example) carry a `pos`
  // baked when `items` was last (structurally) rebuilt; plain typing that
  // shifts later content re-maps the LIVE snapshot pos every transaction but
  // leaves that baked `pos` stale, so a fold/boundary classification keyed on
  // the baked pos can land in the WRONG bin (OMNI-F1-02). Resolve the live pos
  // from the DocStructureObserver snapshot — the same engine OmniViewPanel's
  // cascade already uses. PARAGRAPH-anchored kinds (note/todo/cutter/revision/
  // report/archive, incl. the multi-anchor `@N` rows) now ALSO resolve live via
  // their `anchorUuid` → block snapshot pos (the `paragraphAnchors` map), closing
  // the gap that left their baked `pos` stale (note cards drifting/stacking at
  // the top while typing). Snapshot/anchors-identity-cached, so plain typing
  // rebuilds nothing here (keystroke sanctity) — see useLivePosResolver.
  const paragraphAnchors = useMemo(
    () => buildParagraphAnchorMap(nestedItems),
    [nestedItems],
  );
  const resolvePos = useLivePosResolver(editorInstance, cardPopKey, paragraphAnchors);

  // Hide cards anchored inside a collapsed section. The section-folding
  // plugin already hides the prose via a CSS decoration; mirror that on
  // the omni side so dangling cards don't sit next to a section that's
  // not visible. Native panel lists are unaffected — this only filters
  // the in-text-positioned omni mirror.
  const hiddenTopLevel = useMemo<ReadonlySet<number>>(() => {
    if (!editorInstance) return EMPTY_HIDDEN;
    return getHiddenTopLevelIndices(editorInstance.state);
    // editorTick forces a re-read on exactly the transactions that can shift
    // the folded absolute-top-level-index set — fold toggles, heading
    // add/remove, and block add/remove/reorder (see the editorTick effect
    // above, via subscribeFoldMirrorInvalidation). editorInstance identity is
    // stable across those, so editorTick is the reactive dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorInstance, editorTick]);

  // Focus view: when the band is LOCKED, a card whose anchor falls outside it
  // has a hidden in-text anchor (the focusViewPlugin display:none's that block),
  // so it can't cascade inline. Rather than DROP it (which silently hides
  // user-created cards and reads as data loss), we STAMP `outsideFocus` and
  // keep it — OmniViewPanel routes stamped cards into the collapsed "N outside
  // focus" bin. Applies ONLY when locked; a mere focus selection
  // (active && !locked) hides nothing (CHIP A), so no card is binned.
  //
  // Fold filter (pass 1) runs first: cards in a collapsed section are
  // dropped outright, independent of focus.
  const displayedItems: OmniItem[] = useMemo(() => {
    const doc = editorInstance?.state.doc ?? null;
    // Two-pass fold/focus binning on the LIVE pos (resolvePos) — see
    // `filterOmniItemsByFoldAndFocus` (OMNI-F1-02). Pure + unit-tested.
    return filterOmniItemsByFoldAndFocus(nestedItems, doc, hiddenTopLevel, p.focusState, resolvePos);
  }, [nestedItems, hiddenTopLevel, p.focusState, editorInstance, resolvePos]);

  // Phase 3 — show the bulk Keep-all / Revert-all header on THIS side only when
  // applied pending cards exist AND this side hosts the revisions/cutter omni
  // cards (so it appears exactly once, not on both strips). `getOmniEnabled`
  // returns the enabled categories for this side; the applied cards live under
  // the `revisions` / `cutter` categories. Gated this way the header tracks the
  // panels' placement (drag a panel to the other strip → the header follows).
  const enabledForSide = p.getOmniEnabled(p.side);
  const bulkForSide =
    p.bulkPendingChanges &&
    p.bulkPendingChanges.count > 0 &&
    (enabledForSide.has("revisions") || enabledForSide.has("cutter"))
      ? p.bulkPendingChanges
      : undefined;

  return (
    <OmniViewPanel
      side={p.side}
      items={displayedItems}
      editor={editorInstance}
      enabledCategories={enabledForSide}
      hideAllCards={p.getOmniHideAll(p.side)}
      dimResting={p.omniDimResting}
      onBackgroundClick={handleBackgroundClick}
      onCardFocus={handleCardFocus}
      onVisibleCardsChange={p.onVisibleCardsChange}
      bulkPendingChanges={bulkForSide}
    />
  );
}
