"use client";

import { useState, useCallback, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { JSONContent } from "@tiptap/react";
import VirgilEditor, { EditorHandle } from "./Editor";
import { VIRGIL_COMMAND_NAMES } from "@/lib/tiptap-extensions";
import { isLabelTaken as isLabelTakenIn } from "@/lib/labels";
import { isDevStorage } from "@/lib/storage-mode";
import MenuBar, { DetachedActionsToolbar, DetachedFormattingToolbar, DetachedMenuToolbar, type MarginaliaType, type DividerLevel, type DividerWidth, type ToolbarOrientation } from "./MenuBar";
import { Editor } from "@tiptap/react";
import { type SectionPathEntry, buildPerBlockCounts, sumIncludedWords, extractHeadings } from "@/panels/Outline";
import { useDragGap } from "@/hooks/useDragGap";
import { useFiles } from "@/hooks/useFiles";
import { useSelectedAnchorSync } from "@/hooks/useSelectedAnchorSync";
import { useDocument } from "@/hooks/useDocument";
import { useLatexCompile } from "@/hooks/useLatexCompile";
import { useLatexLint } from "@/hooks/useLatexLint";
import type { LatexError } from "@/lib/latex-errors";
import { findParagraphUuids, paragraphForLine } from "@/lib/latex-paragraph-map";
import { ErrorsHost } from "./editor-layout/panels/errors-host";
import { IconErrors } from "./editor-layout/panel-icons";
import { useSuggestions } from "@/hooks/useSuggestions";
import { useRevisions } from "@/hooks/useRevisions";
import { useTodos } from "@/hooks/useTodos";
import { useAiRequests } from "@/hooks/useAiRequests";
import { useArchive } from "@/hooks/useArchive";
import { useCitations } from "@/hooks/useCitations";
import { useAnnotations } from "@/hooks/useAnnotations";
import { useBibReview } from "@/hooks/useBibReview";
import { useBibSettings } from "@/hooks/useBibSettings";
import { useDocumentStyle } from "@/hooks/useDocumentStyle";
import { DOCUMENT_STYLES, type DocumentStyleId } from "@/lib/document-styles";
import { useNotes } from "@/hooks/useNotes";
import { useCutter } from "@/hooks/useCutter";
import { useQuotations } from "@/hooks/useQuotations";
import Marginalia from "./Marginalia";
import {
  isAnchorableNode,
  MIME_ARCHIVE,
  MIME_ARCHIVE_ANCHOR,
  MIME_SELECTION_ANCHOR,
  MARKER_META,
  type MarginaliaMarker,
} from "@/lib/marginalia";
import { MIME_PAR_CAPTURE, MIME_TEXT_CAPTURE, extractParagraphByUuid, extractRange } from "@/hooks/usePanelCapture";
import { useSyncExternalStore } from "react";
import {
  deriveMarkerPalette,
  getPanelColor,
  getPanelColorVersion,
  isPanelColorOverridden,
  loadPanelColors,
  subscribePanelColors,
  type PanelThemeKey,
} from "@/lib/panel-theme";
import { loadPanelTypography } from "@/lib/panel-typography";
import { loadPrefLinks } from "@/lib/pref-links";

/** Subscribe the EditorLayout tree to panel-color changes. */
function usePanelColorSubscription(): number {
  // Load overrides on first use (idempotent).
  if (typeof window !== "undefined") {
    loadPanelColors();
    loadPanelTypography();
    loadPrefLinks();
  }
  return useSyncExternalStore(subscribePanelColors, getPanelColorVersion, () => 0);
}

/** Maps the marker kinds that can appear as linked-anchor highlights to their
 *  panel-theme key so the highlight color honors user color overrides. */
const MARKER_KIND_TO_THEME_KEY: Partial<Record<string, PanelThemeKey>> = {
  note: "note",
  revision: "revision",
  // Both cutter card kinds share the panel marker palette ("cut" key).
  "cutter-comment": "cut",
  "cutter-suggestion": "cut",
};
import {
  removeLinkedAnchor,
  reanchorByText,
  getLinkedParagraphIds,
  getTextAnchor,
  createLinkedAnchor,
  updateLinkedAnchorCard,
} from "@/links/links";
import dynamic from "next/dynamic";
import type { CodeEditorHandle } from "./CodeEditor";
const CodeEditor = dynamic(() => import("./CodeEditor"), { ssr: false });
import {
  type SearchPanelState,
  INITIAL_SEARCH_STATE,
} from "@/panels/Search";
import {
  type OmniCategory,
  DEFAULT_OMNI_CATEGORIES,
  migrateOmniCategories,
  deriveCategorySides,
  OmniFilterMenu,
} from "@/panels/Omni";
import { useViewPrefs, PanelId, Side, Half, ALL_HIGHLIGHT_TYPES, HighlightType } from "@/hooks/useViewPrefs";
import { useLinkHighlight } from "@/links/_shared/useLinkHighlight";
import { useCardSelectionHighlight } from "@/links/_shared/useCardSelectionHighlight";
import { PanelChromeProvider } from "./panel-primitives";
import FloatingPanel from "./FloatingPanel";
import {
  FLOATING_PANEL_WIDTH,
  FLOATING_PANEL_HEIGHT,
  FLOATING_PANEL_VIEWPORT_MARGIN,
  FLOATING_PANEL_STACK_OFFSET,
  FLOATING_PANEL_Z_BASE,
} from "./editor-layout/constants";
import { computeSpawnPosition } from "./editor-layout/spawn-position";
import {
  alignEntryToY,
  scrollEntryIntoView,
} from "./editor-layout/layout-scroll";
import {
  PANEL_ICONS,
  panelLabel,
  IconPlus,
  IconX,
  IconBlank,
  IconSplit,
  IconLibrary,
} from "./editor-layout/panel-icons";
import { PanelColumn, PlaceholderPanel } from "./editor-layout/panel-column";
import {
  computeSnapGrid,
  resolveDragPosition,
  type SnapGrid,
  type RectLike,
} from "./editor-layout/snap-grid";
import { ZenMargin } from "./editor-layout/zen-margin";
import { MarginActionToolbar } from "./MarginActionToolbar";
import { SectionLozenge } from "./editor-layout/section-lozenge";
import { SplitEditorPanes } from "./editor-layout/split-editor-panes";
import { StripButton, useStripHandlers } from "./editor-layout/drag-drop";
import { useEditorOps } from "./editor-layout/card-actions/editor-ops";
import { useFocusActions } from "./editor-layout/card-actions/focus";
import { useCommentActions } from "./editor-layout/card-actions/comments";
import { useFileActions } from "./editor-layout/card-actions/files";
import { useArchiveActions } from "./editor-layout/card-actions/archive";
import { useFootnoteActions } from "./editor-layout/card-actions/footnotes";
import { useOrphanActions } from "./editor-layout/card-actions/orphans";
import { useCitationActions } from "./editor-layout/card-actions/citations";
import { useRefActions } from "./editor-layout/card-actions/ref";
import { useMarkerActions } from "./editor-layout/card-actions/markers";
import { useDropActions } from "./editor-layout/card-actions/drops";
import { useSelectionToCardActions } from "./editor-layout/card-actions/selection-to-card";
import { useLibraryBridge } from "./editor-layout/event-bridges/library";
import { useMarkerClickBridges } from "./editor-layout/event-bridges/marker-clicks";
import { useFootnoteSyncBridges } from "./editor-layout/event-bridges/footnote-sync";
import { usePanelDropBridges } from "./editor-layout/event-bridges/panel-drops";
import { useAnchorRebindBridge } from "./editor-layout/event-bridges/anchor-rebind";
import { useCommandInputBridges } from "./editor-layout/event-bridges/command-input";
import { EditorLayoutProvider } from "./editor-layout/context";
import { EditorRefProvider } from "./editor-layout/contexts/editor-ref";
import { AiRequestsProvider } from "./editor-layout/contexts/ai-requests";
import { CitationDisplayProvider } from "./editor-layout/contexts/citation-display";
import { PanelViewModeProvider } from "./editor-layout/contexts/panel-view-mode";
import { SelectionsProvider } from "./editor-layout/contexts/selections";
import { PristineCardsProvider } from "./editor-layout/contexts/pristine-cards";
import { CardCreationProvider } from "./editor-layout/contexts/card-creation";
import { usePristineCardManager } from "@/hooks/usePristineCardManager";
import { useCardCreation } from "./editor-layout/card-actions/card-creation";
import { renderPoppedCard } from "./editor-layout/floating-cards";
import { OutlineHost } from "./editor-layout/panels/outline-host";
import { CutterHost } from "./editor-layout/panels/cutter-host";
import { TodoHost } from "./editor-layout/panels/todo-host";
import { ArchiveHost } from "./editor-layout/panels/archive-host";
import { QuotationsHost } from "./editor-layout/panels/quotations-host";
import { BibliographyHost } from "./editor-layout/panels/bibliography-host";
import { NotesHost } from "./editor-layout/panels/notes-host";
import { FootnotesHost } from "./editor-layout/panels/footnotes-host";
import { RevisionsHost } from "./editor-layout/panels/revisions-host";
import { CitationsHost } from "./editor-layout/panels/citations-host";
import { OmniHost } from "./editor-layout/panels/omni-host";
import { SearchHost } from "./editor-layout/panels/search-host";
import ExamplesPanel from "@/panels/Examples";
import { PoppedCardsContext } from "@/hooks/usePoppedCards";
import { usePreferences } from "@/hooks/usePreferences";
// Preference mode — ctrl+click picker for live token editing. See
// usePreferenceMode.ts for the full architecture / extension guide.
import { usePreferenceMode } from "@/hooks/usePreferenceMode";
import { useZenMode } from "@/hooks/useZenMode";
import PreferenceModePicker from "./PreferenceModePicker";
import { applyTransforms } from "@/lib/color-transforms";
import { PREF_TO_CSS, DERIVED_CSS } from "@/lib/preferences-tree";
import PreferencesModal from "./PreferencesModal";
import AIWindow, { aiRequestDotStatus } from "./AIWindow";
import { useConfirmDialog } from "./ConfirmDialog";
import { useDocumentClassMismatchDialog } from "./DocumentClassMismatchDialog";
import LabelRefPopover from "./LabelRefPopover";
import TexFilePickerModal from "./TexFilePickerModal";
import NewDocumentModal from "./NewDocumentModal";
import { useWordCount } from "@/hooks/useWordCount";
import { useWordCountConfig } from "@/hooks/useWordCountConfig";
import WordCountPanel from "@/panels/WordCount";
import { useFocusMode } from "@/hooks/useFocusMode";
import { serializeToLatex } from "@/lib/latex-serializer";
import pkg from "../../package.json";

const APP_VERSION = pkg.version;
import type { OrphanedFootnote } from "@/lib/types";
import { hasFsaSupport } from "@/lib/fsa-support";
import { queryRW } from "@/lib/fsa-permissions";
import { getDocHandle } from "@/lib/doc-index";
import { UnsupportedBrowserNotice } from "./UnsupportedBrowserNotice";
import { DocPermissionGate } from "./DocPermissionGate";
import { LibraryTabView } from "./library/LibraryTabView";

/**
 * "Style" dropdown for the active document, mounted in the Virgil bar.
 * Shows the currently-selected preamble preset and lets the user swap
 * presets — see useDocumentStyle for the rewrite mechanics. Renders
 * nothing when no doc is open.
 */
function DocStyleDropdown({ docId }: { docId: string | null }) {
  const { style, setStyle } = useDocumentStyle(docId);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left?: number; right?: number }>({});

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!docId) return null;

  const handleToggle = () => {
    if (!open && ref.current) {
      const r = ref.current.getBoundingClientRect();
      const POPUP_H = 24 * DOCUMENT_STYLES.length + 8;
      const POPUP_W = 160;
      const GAP = 4;
      const flipUp = r.bottom + GAP + POPUP_H > window.innerHeight && r.top > POPUP_H + GAP;
      const flipLeft = r.left + POPUP_W > window.innerWidth - 4 && window.innerWidth - r.right > POPUP_W;
      const vertical = flipUp ? { bottom: window.innerHeight - r.top + GAP } : { top: r.bottom + GAP };
      const horizontal = flipLeft ? { right: window.innerWidth - r.right } : { left: r.left };
      setPos({ ...vertical, ...horizontal });
    }
    setOpen(!open);
  };

  const pick = (id: DocumentStyleId) => {
    setOpen(false);
    if (id !== style) void setStyle(id);
  };

  return (
    <div ref={ref} className="relative inline-flex items-center">
      <button
        onClick={handleToggle}
        className="topbarbtn ml-1"
        title="Document style"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        Style
        <svg width="8" height="5" viewBox="0 0 8 5" fill="currentColor"><path d="M0 0l4 5 4-5z"/></svg>
      </button>
      {open && (
        <div
          role="menu"
          className="fixed bg-surface border border-[var(--border)] rounded-md shadow-lg py-1 z-[60] min-w-[140px]"
          style={{ top: pos.top, bottom: pos.bottom, left: pos.left, right: pos.right }}
        >
          {DOCUMENT_STYLES.map((s) => {
            const active = s.id === style;
            return (
              <button
                key={s.id}
                role="menuitem"
                onClick={() => pick(s.id)}
                className="w-full text-left px-3 py-1 text-sm text-[var(--foreground)] hover-on-light flex items-center gap-2"
              >
                <span className="w-3 inline-block text-[var(--accent)]">{active ? "✓" : ""}</span>
                {s.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function EditorLayout() {
  // In-app confirmation dialog — replaces native window.confirm for
  // workflows that benefit from a styled, app-themed modal (e.g.
  // confirming a footnote move on drop). Mount `confirmDialog` once at
  // the layout root so any descendant caller can await `confirm(...)`.
  const { confirm: runConfirm, dialog: confirmDialog } = useConfirmDialog();
  const confirmFootnoteMove = useCallback(
    () =>
      runConfirm({
        title: "Move footnote?",
        message:
          "This will move the footnote from its current position in the document to where you dropped it.",
        confirmLabel: "Move",
        cancelLabel: "Cancel",
        tone: "danger",
      }),
    [runConfirm],
  );
  const confirmLabelRename = useCallback(
    (oldLabel: string, newLabel: string, refCount: number) =>
      runConfirm({
        title: "Update references?",
        message: (
          <>
            <p>
              This label is referenced by {refCount}{" "}
              {refCount === 1 ? "\\ref" : "\\refs"} elsewhere in the document.
            </p>
            <p className="mt-2">
              Rewrite {refCount === 1 ? "it" : "them"} from{" "}
              <code className="px-1 rounded bg-surface-muted text-ink-body">
                {oldLabel}
              </code>{" "}
              to{" "}
              <code className="px-1 rounded bg-surface-muted text-ink-body">
                {newLabel}
              </code>
              ?
            </p>
          </>
        ),
        confirmLabel: refCount === 1 ? "Update ref" : `Update ${refCount} refs`,
        cancelLabel: "Leave refs",
      }),
    [runConfirm],
  );
  const {
    docs,
    openTabs,
    currentDocId,
    currentDoc,
    loading: filesLoading,
    deleteFile,
    renameFile,
    openFile,
    closeTab,
    openExistingFile,
    pendingFolderPick,
    selectFileInFolder,
    cancelFolderPick,
    createFile,
    createFileInPendingFolder,
    activePane,
    activateDocPane,
    activateLibraryPane,
    toggleActivePane,
  } = useFiles();

  useLibraryBridge({ currentDocId, activateLibraryPane });

  // "New document" modal state. `mode: "fresh"` uses the OS directory
  // picker; `mode: "inFolder"` writes into the already-picked folder
  // that's behind the current TexFilePicker modal.
  const [newDocModal, setNewDocModal] = useState<
    { mode: "fresh" } | { mode: "inFolder"; folderName: string } | null
  >(null);

  // Per-doc permission gate state. We query (without prompting) when
  // the active doc changes; if it isn't already granted we show the
  // gate, which calls requestRW from inside its click handler.
  type DocPermState = "loading" | "granted" | "needs-grant" | "no-handle";
  const [docPermState, setDocPermState] = useState<DocPermState>("loading");
  const [activeDocHandle, setActiveDocHandle] = useState<FileSystemDirectoryHandle | null>(null);

  // SSR-safe mirror of `isDevStorage`. The runtime check requires `window`
  // (iframe + FSA detection), so we start false on the server and update
  // after hydration. Used in render to hide FSA-only chrome inside the
  // Claude Preview iframe; in a normal tab it stays false.
  const [devStorage, setDevStorage] = useState(false);
  useEffect(() => { setDevStorage(isDevStorage); }, []);

  // Hooks read from disk, so we gate their docId on the permission
  // state. Until the active folder has been re-granted readwrite
  // permission for this session, every hook sees `null` and stays in
  // its empty state instead of crashing on NotAllowedError. The UI
  // (tab strip, path bar) keeps using the un-gated currentDocId.
  const docIdForHooks: string | null =
    docPermState === "granted" ? currentDocId : null;

  const { content, loading: docLoading, onUpdate, saveStatus, refetch: refetchDoc } = useDocument(docIdForHooks);
  // Mismatch prompt: fired by the compile hook when the source's
  // `\documentclass` doesn't define one of the sectioning commands used
  // (e.g. `\chapter` inside `article`). Mount `docClassDialog` near the
  // other root-level dialogs so it overlays everything.
  const { prompt: promptDocClassMismatch, dialog: docClassDialog } =
    useDocumentClassMismatchDialog();
  const {
    compile: compilePdf,
    isCompiling,
    lastLog: compileLog,
    lastStatus: compileStatus,
    compileErrors,
  } = useLatexCompile(docIdForHooks, {
    onDocumentClassMismatch: promptDocClassMismatch,
  });
  const {
    state: suggestionsState,
    currentSuggestion,
    isComplete,
    actOnSuggestion,
    updateSuggestionField,
    jumpToSuggestion,
    clearSuggestions,
  } = useSuggestions(docIdForHooks);
  const {
    users: revisionUsers,
    comments,
    addComment,
    updateCommentContent,
    setCommentAuthor,
    setCommentAnchor,
    deleteComment,
    refresh: refreshRevisions,
  } = useRevisions(docIdForHooks);
  const activeRevisionsCount = comments.filter((c) => !c.resolved).length;
  // Unified pristine-card manager — tracks blank-on-create cards across all
  // kinds and discards them via a global click-away listener once the user
  // clicks outside the card's DOM. Each per-kind hook gets its slice here.
  const pristineManager = usePristineCardManager();
  const notePristine = useMemo(() => pristineManager.forKind("note"), [pristineManager]);
  const cutPristine = useMemo(() => pristineManager.forKind("cut"), [pristineManager]);
  const todoPristine = useMemo(() => pristineManager.forKind("todo"), [pristineManager]);
  const quotationPristine = useMemo(() => pristineManager.forKind("quotation"), [pristineManager]);
  const citationPristine = useMemo(() => pristineManager.forKind("citation"), [pristineManager]);
  const footnotePristine = useMemo(() => pristineManager.forKind("footnote"), [pristineManager]);
  const {
    notes,
    addNote,
    updateNote,
    updateNoteTitle,
    addNoteParagraphId,
    removeNoteParagraphId,
    deleteNote,
    setNoteAnchor,
    discardPristineNotes,
  } = useNotes(docIdForHooks, notePristine);
  const {
    cards: cutterCards,
    addComment: addCutterComment,
    addSuggestion: addCutterSuggestion,
    updateCommentContent: updateCutterCommentContent,
    setCommentAiRequest: setCutterCommentAiRequest,
    updateSuggestionField: updateCutterSuggestionField,
    setSuggestionStatus: setCutterSuggestionStatus,
    addCardParagraphId,
    removeCardParagraphId,
    deleteCard: deleteCutterCard,
    discardPristineCards,
  } = useCutter(docIdForHooks, cutPristine);
  const [selectedCutterCardId, setSelectedCutterCardId] = useState<string | null>(null);
  const {
    groups: quotationGroups,
    addGroup: addQuotationGroup,
    deleteGroup: deleteQuotationGroup,
    updateGroupTitle: updateQuotationGroupTitle,
    updateNotes: updateQuotationNotes,
    addParagraphId: addQuotationParagraphId,
    removeParagraphId: removeQuotationParagraphId,
    addReference: addQuotationReference,
    deleteReference: deleteQuotationReference,
    updateReferenceCiteKey: updateQuotationReferenceCiteKey,
    addQuote: addQuotationQuote,
    updateQuote: updateQuotationQuote,
    deleteQuote: deleteQuotationQuote,
  } = useQuotations(docIdForHooks, quotationPristine);
  const {
    items: todoItems,
    addItem: addTodo,
    toggleItem: toggleTodo,
    updateItem: updateTodo,
    updateNotes: updateTodoNotes,
    setAiRequest: setTodoAiRequest,
    deleteItem: deleteTodo,
    archiveDone: archiveTodos,
    addParagraphId: addTodoParagraphId,
    removeParagraphId: removeTodoParagraphId,
    discardPristineTodos,
  } = useTodos(docIdForHooks, todoPristine);

  const {
    requests: aiRequests,
    addRequest: addAiRequest,
    updateRequestText: updateAiRequestText,
    deleteRequest: deleteAiRequest,
  } = useAiRequests(docIdForHooks);

  const {
    snippets: archiveSnippets,
    archiveContent,
    updateSnippet: updateArchiveSnippet,
    updateSnippetTitle: updateArchiveSnippetTitle,
    addParagraphId: addArchiveParagraphId,
    removeParagraphId: removeArchiveParagraphId,
    restoreSnippet,
    deleteSnippet,
  } = useArchive(docIdForHooks);

  const {
    citations,
    bibPath,
    citationStyle,
    bibPackage,
    bibEntries,
    addCitation,
    updateCitation,
    deleteCitation,
    setStyle: setCitationStyle,
    setBibPackage,
    addBibEntry,
    updateBibEntry,
    updateBibKeyAndType,
    getDisplayText: getCitationDisplayText,
    getFormattedBib,
    syncFromEditor: syncCitationsFromEditor,
  } = useCitations(docIdForHooks, citationPristine);

  const { getAnnotation, setAnnotation } = useAnnotations(docIdForHooks);
  const {
    requests: bibReviewRequests,
    requestReview: requestBibReview,
    cancelRequest: cancelBibReview,
    getRequestStatus: getBibReviewStatus,
    refresh: refreshBibReview,
  } = useBibReview(docIdForHooks);
  const {
    generalBibPath,
    entryRequests,
    setGeneralBibPath,
    addEntryRequest,
    removeEntryRequest,
    refresh: refreshBibSettings,
  } = useBibSettings(docIdForHooks);

  const {
    prefs,
    leftItems,
    rightItems,
    togglePanel,
    movePanel,
    setPanelWidth,
    getPanelWidth,
    collapseLeft,
    collapseRight,
    expandLeft,
    expandRight,
    closeAllPanels,
    setBlank,
    clearBlankIfSet,
    setActiveLeft,
    setActiveRight,
    setActiveHalf,
    toggleSplit,
    setSplitRatio,
    setEditorSplit,
    setEditorSplitRatio,
    setTopGutter,
    setBottomGutter,
    setShowHighlights,
    toggleHighlightType,
    togglePopout,
    closePopout,
    setFloatPosition,
    toggleCardPopout,
    closeCardPopout,
    setCardFloatPosition,
  } = useViewPrefs();
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const editorSplit = prefs.editorSplit;
  const editorSplitRatio = prefs.editorSplitRatio;

  // Which half (top or bottom) is currently focused on each side. Used to
  // route strip-icon clicks when the side is split. Session-only state.
  const [focusedHalfLeft, setFocusedHalfLeft] = useState<Half>("top");
  const [focusedHalfRight, setFocusedHalfRight] = useState<Half>("top");
  // Which pane last received focus — used to route panel interactions
  // (outline clicks, note jumps, etc.) to the pane the user is in.
  const [activeSplitPane, setActiveSplitPane] = useState<"top" | "bottom">("top");
  const mirrorViewRef = useRef<import("prosemirror-view").EditorView | null>(null);

  // MenuBar lives at home (docked in the Virgil top bar, centered over
  // the document). Tearing off via the grab bar spawns a
  // `DetachedMenuToolbar` copy; the home bar itself never moves.
  const editorColRef = useRef<HTMLDivElement>(null);
  const menuWrapRef = useRef<HTMLDivElement>(null);
  const menuWrapRoRef = useRef<ResizeObserver | null>(null);
  const [menuPortalReady, setMenuPortalReady] = useState(false);

  // Rects of the two non-empty groups in the Virgil top bar — the
  // MenuBar's home position clamps between these so it never overlaps the
  // tabs on the left or the Zen/Prefs/Version cluster on the right.
  const topbarLeftRef = useRef<HTMLDivElement>(null);
  const topbarRightRef = useRef<HTMLDivElement>(null);
  const [topbarGaps, setTopbarGaps] = useState<{
    leftEnd: number;
    rightStart: number;
    top: number;
    bottom: number;
  } | null>(null);

  // Measured size of the rendered menu wrap so we can clamp it against
  // the topbar gaps and center it over the document at "home".
  const [menuWrapSize, setMenuWrapSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    setMenuPortalReady(true);
  }, []);

  // Track the toolbar wrap's measured size via a ResizeObserver bound to
  // the wrap element through a ref callback. This captures the size
  // reliably across portal mount and orientation changes — the
  // home-position calc uses this width to center the pod over the
  // document and clamp it against the top-bar gaps.
  const menuWrapRefCb = useCallback((el: HTMLDivElement | null) => {
    menuWrapRef.current = el;
    menuWrapRoRef.current?.disconnect();
    menuWrapRoRef.current = null;
    if (el) {
      const read = () => {
        const r = el.getBoundingClientRect();
        setMenuWrapSize((prev) =>
          prev && prev.w === r.width && prev.h === r.height ? prev : { w: r.width, h: r.height },
        );
      };
      read();
      if (typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(read);
        ro.observe(el);
        menuWrapRoRef.current = ro;
      }
    }
  }, []);

  // Live rects for every region that contributes grid lines. Snap lines
  // are congruent with the edges of the main-text region (the editor
  // column), plus — when the editor is split — the edges of each split
  // pane. The editor-col ref comes from a callback ref so we can
  // re-attach the observer when the column remounts; split panes mount
  // conditionally and are found via `[data-editor-pane]` attributes.
  const [colRect, setColRect] = useState<RectLike | null>(null);
  const [splitPaneRects, setSplitPaneRects] = useState<RectLike[] | null>(null);
  const [winSize, setWinSize] = useState<{ w: number; h: number } | null>(null);

  const rectsEqual = (a: RectLike | null, b: RectLike | null): boolean => {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;
  };
  const paneListsEqual = (a: RectLike[] | null, b: RectLike[] | null): boolean => {
    if (!a && !b) return true;
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!rectsEqual(a[i], b[i])) return false;
    }
    return true;
  };

  const readAllRects = useCallback(() => {
    setWinSize((prev) => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      return prev && prev.w === w && prev.h === h ? prev : { w, h };
    });
    const el = editorColRef.current;
    const nextCol: RectLike | null = el
      ? (() => {
          const r = el.getBoundingClientRect();
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        })()
      : null;
    setColRect((prev) => (rectsEqual(prev, nextCol) ? prev : nextCol));

    const panes = Array.from(document.querySelectorAll<HTMLElement>('[data-editor-pane]'));
    const nextPanes: RectLike[] | null = panes.length > 0
      ? panes.map((p) => {
          const r = p.getBoundingClientRect();
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        })
      : null;
    setSplitPaneRects((prev) => (paneListsEqual(prev, nextPanes) ? prev : nextPanes));
  }, []);

  const roRef = useRef<ResizeObserver | null>(null);
  const moRef = useRef<MutationObserver | null>(null);
  const editorColRefCb = useCallback((el: HTMLDivElement | null) => {
    editorColRef.current = el;
    roRef.current?.disconnect();
    roRef.current = null;
    if (el && typeof ResizeObserver !== "undefined") {
      readAllRects();
      const ro = new ResizeObserver(readAllRects);
      ro.observe(el);
      roRef.current = ro;
    }
  }, [readAllRects]);

  // Watch panel-pod mount/unmount (panels are conditionally rendered)
  // and re-measure. A MutationObserver on document.body with subtree +
  // attribute watching is coarse but cheap and the measurement is
  // cheap too.
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    let rafId = 0;
    const schedule = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        readAllRects();
      });
    };
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-editor-pane", "style", "class"],
    });
    moRef.current = mo;
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      mo.disconnect();
      moRef.current = null;
    };
  }, [readAllRects]);

  useEffect(() => {
    window.addEventListener("resize", readAllRects);
    return () => {
      window.removeEventListener("resize", readAllRects);
      roRef.current?.disconnect();
      menuWrapRoRef.current?.disconnect();
    };
  }, [readAllRects]);

  // Snap lines disabled — floating toolbars follow the cursor freely
  // (viewport clamp still applies in resolveDragPosition). Re-enable by
  // restoring the computeSnapGrid call and its colRect/splitPaneRects deps.
  const snapGrid = useMemo<SnapGrid>(() => ({ h: [], v: [] }), []);
  const snapGridRef = useRef(snapGrid);
  snapGridRef.current = snapGrid;

  // Track the end of the top bar's tab/logo content (via a zero-width
  // sentinel placed after the "Open folder" "+" button) and the start of
  // the right cluster (Focus / Zen / Prefs / Version / ...). The MenuBar's
  // home position clamps between these so it never overlaps either side,
  // even when tabs crowd the middle.
  const topbarLeftRoRef = useRef<ResizeObserver | null>(null);
  const topbarRightRoRef = useRef<ResizeObserver | null>(null);
  const readTopbarGaps = useCallback(() => {
    const l = topbarLeftRef.current;
    const r = topbarRightRef.current;
    if (!l || !r) return;
    const lRect = l.getBoundingClientRect();
    const rRect = r.getBoundingClientRect();
    setTopbarGaps({
      leftEnd: lRect.left,
      rightStart: rRect.left,
      top: rRect.top,
      bottom: rRect.bottom,
    });
  }, []);
  const topbarLeftRefCb = useCallback((el: HTMLDivElement | null) => {
    topbarLeftRef.current = el;
    topbarLeftRoRef.current?.disconnect();
    topbarLeftRoRef.current = null;
    if (el) {
      readTopbarGaps();
      if (typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(readTopbarGaps);
        ro.observe(el);
        topbarLeftRoRef.current = ro;
      }
    }
  }, [readTopbarGaps]);
  const topbarRightRefCb = useCallback((el: HTMLDivElement | null) => {
    topbarRightRef.current = el;
    topbarRightRoRef.current?.disconnect();
    topbarRightRoRef.current = null;
    if (el) {
      readTopbarGaps();
      if (typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(readTopbarGaps);
        ro.observe(el);
        topbarRightRoRef.current = ro;
      }
    }
  }, [readTopbarGaps]);

  useEffect(() => {
    window.addEventListener("resize", readTopbarGaps);
    return () => {
      window.removeEventListener("resize", readTopbarGaps);
      topbarLeftRoRef.current?.disconnect();
      topbarRightRoRef.current?.disconnect();
    };
  }, [readTopbarGaps]);


  // MenuBar is always home-docked now. The grab bar spawns a detached
  // floating copy instead of moving the bar itself — state below.

  // Detached floating toolbars — the Actions and Formatting popovers in
  // MenuBar can each be torn off by grabbing their trailing grab bar.
  // State lives here so each floating copy can outlive the popover
  // (which closes on tear), and so multiple copies can coexist: every
  // tear-off spawns a new entry. Actions + Formatting share the same
  // shape and the same drag helper below.
  type DetachedToolbarEntry = { id: string; pos: { left: number; top: number } };
  const [detachedActions, setDetachedActions] = useState<DetachedToolbarEntry[]>([]);
  const [detachedFormatting, setDetachedFormatting] = useState<DetachedToolbarEntry[]>([]);
  const [detachedMenus, setDetachedMenus] = useState<DetachedToolbarEntry[]>([]);
  const [toolbarDragging, setToolbarDragging] = useState(false);
  // True while a panel inner-edge is being dragged. Freezes panel flex
  // (grow/shrink to 0) so the dragged edge stays glued to the cursor —
  // outside drag, panels shrink 100× faster than the editor so window
  // downsize pulls from panels first, then the text area.
  const [isResizingPanels, setIsResizingPanels] = useState(false);
  // Dynamic flex-basis for the editor column. Updated only when the
  // panel layout changes (drag, panel toggle, zen). NOT updated on
  // window resize — that's what makes window-shrink pull from panels
  // first: the editor holds its basis while panels' flex-shrink (100)
  // eats the shortage before the editor's (1) contributes.
  const [editorBasis, setEditorBasis] = useState(880);

  // Vertical gutters around the text page. Same design as horizontal
  // panels: gutters absorb window-shrink first, page height is held.
  // Persisted in view-prefs so heights survive reload.
  const topGutterPref = prefs.topGutter;
  const bottomGutterPref = prefs.bottomGutter;
  const setTopGutterPref = setTopGutter;
  const setBottomGutterPref = setBottomGutter;
  const [pageHeightBasis, setPageHeightBasis] = useState(0);
  const [isResizingGutters, setIsResizingGutters] = useState(false);
  const nextActionsIdRef = useRef(0);
  const nextFormattingIdRef = useRef(0);
  const nextMenuIdRef = useRef(0);

  // MRU focus stack for in-app floating windows. Drives Cmd-W (close
  // frontmost). Push on first focus / on open; reconcile when underlying
  // lists shrink. Independent of paint z-index — z is still derived from
  // insertion order in the popped-out arrays.
  type FloatingRef =
    | { kind: "panel"; id: PanelId }
    | { kind: "card"; key: string }
    | { kind: "toolbar"; bucket: "actions" | "formatting" | "menus"; id: string };
  const refKey = (r: FloatingRef): string =>
    r.kind === "panel" ? `panel:${r.id}`
      : r.kind === "card" ? `card:${r.key}`
      : `tb:${r.bucket}:${r.id}`;
  const [focusStack, setFocusStack] = useState<FloatingRef[]>([]);
  const focusFloating = useCallback((ref: FloatingRef) => {
    setFocusStack((prev) => {
      const k = refKey(ref);
      const filtered = prev.filter((r) => refKey(r) !== k);
      filtered.push(ref);
      return filtered;
    });
  }, []);

  // Single pass that (a) prunes stale entries when a window closes by any
  // means, and (b) appends newly-opened windows that aren't yet in the
  // stack — so popping a panel out makes it the Cmd-W target even before
  // the user clicks it.
  useEffect(() => {
    const liveKeys = new Set<string>();
    for (const id of prefs.poppedOutPanels) liveKeys.add(`panel:${id}`);
    for (const key of prefs.poppedOutCards) liveKeys.add(`card:${key}`);
    for (const tb of detachedActions) liveKeys.add(`tb:actions:${tb.id}`);
    for (const tb of detachedFormatting) liveKeys.add(`tb:formatting:${tb.id}`);
    for (const tb of detachedMenus) liveKeys.add(`tb:menus:${tb.id}`);
    setFocusStack((prev) => {
      const known = new Set(prev.map(refKey));
      const pruned = prev.filter((r) => liveKeys.has(refKey(r)));
      const additions: FloatingRef[] = [];
      for (const id of prefs.poppedOutPanels) {
        if (!known.has(`panel:${id}`)) additions.push({ kind: "panel", id });
      }
      for (const key of prefs.poppedOutCards) {
        if (!known.has(`card:${key}`)) additions.push({ kind: "card", key });
      }
      for (const tb of detachedActions) {
        if (!known.has(`tb:actions:${tb.id}`)) additions.push({ kind: "toolbar", bucket: "actions", id: tb.id });
      }
      for (const tb of detachedFormatting) {
        if (!known.has(`tb:formatting:${tb.id}`)) additions.push({ kind: "toolbar", bucket: "formatting", id: tb.id });
      }
      for (const tb of detachedMenus) {
        if (!known.has(`tb:menus:${tb.id}`)) additions.push({ kind: "toolbar", bucket: "menus", id: tb.id });
      }
      if (pruned.length === prev.length && additions.length === 0) return prev;
      return [...pruned, ...additions];
    });
  }, [prefs.poppedOutPanels, prefs.poppedOutCards, detachedActions, detachedFormatting, detachedMenus]);

  // Cmd-W closes the most-recently-focused floating window (the top of
  // the MRU stack). When the stack is empty, preventDefault is skipped so
  // the host (PWA window or browser tab) handles the keystroke as usual.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "w" || !e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const target = focusStack[focusStack.length - 1];
      if (!target) return;
      e.preventDefault();
      if (target.kind === "panel") closePopout(target.id);
      else if (target.kind === "card") closeCardPopout(target.key);
      else if (target.kind === "toolbar") {
        const setter =
          target.bucket === "actions" ? setDetachedActions
            : target.bucket === "formatting" ? setDetachedFormatting
            : setDetachedMenus;
        setter((prev) => prev.filter((t) => t.id !== target.id));
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [focusStack, closePopout, closeCardPopout]);

  // Shared drag routine for every floating toolbar — single-instance
  // (MenuBar) and multi-instance (Actions, Formatting). Runs the snap
  // grid math per frame against the wrapper resolved by `getWrapper()`.
  // `onUpdatePos` receives the final snapped {left, top} that should
  // drive the wrapper's style; the caller decides what state it writes.
  const beginToolbarDrag = useCallback((opts: {
    clientX: number;
    clientY: number;
    podLeft: number;
    podTop: number;
    getWrapper: () => HTMLElement | null;
    onUpdatePos: (pos: { left: number; top: number }) => void;
    onEnd?: (ev: MouseEvent, pos: { left: number; top: number }) => void;
  }) => {
    const { clientX, clientY, podLeft, podTop, getWrapper, onUpdatePos, onEnd } = opts;
    const offX = clientX - podLeft;
    const offY = clientY - podTop;
    setToolbarDragging(true);
    let lastPos = { left: podLeft, top: podTop };
    const onMove = (ev: MouseEvent) => {
      const rawLeft = ev.clientX - offX;
      const rawTop = ev.clientY - offY;
      const snapped = resolveDragPosition({
        rawLeft, rawTop,
        wrapper: getWrapper(),
        grid: snapGridRef.current,
        winW: window.innerWidth,
        winH: window.innerHeight,
      });
      lastPos = snapped;
      onUpdatePos(snapped);
    };
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setToolbarDragging(false);
      onEnd?.(ev, lastPos);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  const handleActionsDetach = useCallback((e: React.MouseEvent<HTMLDivElement>, rect: DOMRect) => {
    e.preventDefault();
    const id = `actions-${++nextActionsIdRef.current}`;
    setDetachedActions(prev => [...prev, { id, pos: { left: rect.left, top: rect.top } }]);
    beginToolbarDrag({
      clientX: e.clientX, clientY: e.clientY,
      podLeft: rect.left, podTop: rect.top,
      getWrapper: () => document.querySelector<HTMLElement>(`[data-actions-id="${id}"]`),
      onUpdatePos: (pos) => setDetachedActions(prev => prev.map(tb => tb.id === id ? { ...tb, pos } : tb)),
    });
  }, [beginToolbarDrag]);

  const handleFormatDetach = useCallback((e: React.MouseEvent<HTMLDivElement>, rect: DOMRect) => {
    e.preventDefault();
    const id = `formatting-${++nextFormattingIdRef.current}`;
    setDetachedFormatting(prev => [...prev, { id, pos: { left: rect.left, top: rect.top } }]);
    beginToolbarDrag({
      clientX: e.clientX, clientY: e.clientY,
      podLeft: rect.left, podTop: rect.top,
      getWrapper: () => document.querySelector<HTMLElement>(`[data-formatting-id="${id}"]`),
      onUpdatePos: (pos) => setDetachedFormatting(prev => prev.map(tb => tb.id === id ? { ...tb, pos } : tb)),
    });
  }, [beginToolbarDrag]);

  useEffect(() => {
    if (!toolbarDragging) return;
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [toolbarDragging]);

  // MenuBar grab — spawns a detached floating copy at the home bar's
  // current viewport position. The home bar stays in place; each grab
  // adds another copy (multi-instance, matching Actions/Formatting).
  // Seamless drag pick-up via the shared snap routine so the new copy
  // follows the cursor and snaps to the same grid as every other
  // floating toolbar.
  const handleMenuGrabStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const menuEl = menuWrapRef.current;
    if (!menuEl) return;
    const menuRect = menuEl.getBoundingClientRect();
    const id = `menu-${++nextMenuIdRef.current}`;
    setDetachedMenus(prev => [...prev, { id, pos: { left: menuRect.left, top: menuRect.top } }]);
    beginToolbarDrag({
      clientX: e.clientX, clientY: e.clientY,
      podLeft: menuRect.left, podTop: menuRect.top,
      getWrapper: () => document.querySelector<HTMLElement>(`[data-menu-id="${id}"]`),
      onUpdatePos: (pos) => setDetachedMenus(prev => prev.map(tb => tb.id === id ? { ...tb, pos } : tb)),
    });
  }, [beginToolbarDrag]);

  // (menuWrapStyle is declared below, after the zen
  // mode hook is available — zen force-pins the toolbar at home regardless
  // of the persisted location.)

  const editorRef = useRef<EditorHandle>(null);
  const mainAreaRef = useRef<HTMLDivElement>(null);
  const [mainAreaMounted, setMainAreaMounted] = useState(false);
  const mainAreaRefCb = useCallback((el: HTMLDivElement | null) => {
    (mainAreaRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    setMainAreaMounted(prev => {
      const next = !!el;
      return prev === next ? prev : next;
    });
  }, []);

  // Central "is this label key already claimed" predicate — consulted
  // by every label-editing surface (heading input in the main editor,
  // InlineLabel in the outline) so they all see the same registry.
  const checkLabelTaken = useCallback(
    (candidate: string, excludeLabel: string | null) => {
      const editor = editorRef.current?.getEditor();
      if (!editor) return false;
      return isLabelTakenIn(editor, candidate, excludeLabel);
    },
    [],
  );
  // Read by the paragraph node view each render to flip the popout
  // button's glyph between docked (arrow up) and popped (arrow down).
  const paragraphIsPoppedRef = useRef<(uuid: string) => boolean>(() => false);
  // When the list of popped-out paragraphs changes from anywhere other
  // than the gutter button (e.g. float's own X, restored from prefs),
  // ping the editor so every paragraph node view rebuilds its glyph.
  const paragraphPoppedKeys = useMemo(
    () =>
      prefs.poppedOutCards
        .filter((k) => k.startsWith("paragraph:"))
        .sort()
        .join("|"),
    [prefs.poppedOutCards],
  );
  useEffect(() => {
    editorRef.current?.refreshParagraphPopouts();
  }, [paragraphPoppedKeys]);
  // Same setup for headings.
  const headingIsPoppedRef = useRef<(uuid: string) => boolean>(() => false);
  const headingPoppedKeys = useMemo(
    () =>
      prefs.poppedOutCards
        .filter((k) => k.startsWith("heading:"))
        .sort()
        .join("|"),
    [prefs.poppedOutCards],
  );
  useEffect(() => {
    editorRef.current?.refreshHeadingPopouts();
  }, [headingPoppedKeys]);
  // Same setup for example blocks.
  const exampleIsPoppedRef = useRef<(uuid: string) => boolean>(() => false);
  const examplePoppedKeys = useMemo(
    () =>
      prefs.poppedOutCards
        .filter((k) => k.startsWith("example:"))
        .sort()
        .join("|"),
    [prefs.poppedOutCards],
  );
  useEffect(() => {
    editorRef.current?.refreshExamplePopouts();
  }, [examplePoppedKeys]);
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null);
  // When a panel mini-editor (e.g. footnote RichTextField) is focused,
  // the main toolbar should route commands to it instead of the main editor.
  const [overrideEditor, setOverrideEditor] = useState<Editor | null>(null);
  const { counts: wordCounts, selection: wordSelection } = useWordCount(editorInstance);
  const focusMode = useFocusMode();
  const { config: focusWcConfig } = useWordCountConfig();
  const [showParTitles, setShowParTitles] = useState(true);
  const [showLatexComments, setShowLatexComments] = useState(true);

  // Marginalia visibility — persisted
  const [showMarginalia, setShowMarginalia] = useState(() => {
    if (typeof window === "undefined") return true;
    try { const v = localStorage.getItem("virgil-show-marginalia"); return v !== "false"; } catch { return true; }
  });
  const [hiddenMarginaliaTypes, setHiddenMarginaliaTypes] = useState<Set<MarginaliaType>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = localStorage.getItem("virgil-hidden-marginalia-types");
      return raw ? new Set(JSON.parse(raw) as MarginaliaType[]) : new Set();
    } catch { return new Set(); }
  });
  const toggleMarginalia = useCallback(() => {
    setShowMarginalia((prev) => {
      const next = !prev;
      try { localStorage.setItem("virgil-show-marginalia", String(next)); } catch {}
      return next;
    });
  }, []);
  const toggleMarginaliaType = useCallback((type: MarginaliaType) => {
    setHiddenMarginaliaTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      try { localStorage.setItem("virgil-hidden-marginalia-types", JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);
  // Section indicator lozenge visibility — persisted
  const [showSectionIndicator, setShowSectionIndicator] = useState(() => {
    if (typeof window === "undefined") return true;
    try { const v = localStorage.getItem("virgil-show-section-indicator"); return v !== "false"; } catch { return true; }
  });
  const toggleSectionIndicator = useCallback(() => {
    setShowSectionIndicator((prev) => {
      const next = !prev;
      try { localStorage.setItem("virgil-show-section-indicator", String(next)); } catch {}
      return next;
    });
  }, []);

  // Heading-divider visibility — persisted per level
  const [dividerLevels, setDividerLevels] = useState<Set<DividerLevel>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = localStorage.getItem("virgil-divider-levels");
      return raw ? new Set(JSON.parse(raw) as DividerLevel[]) : new Set();
    } catch { return new Set(); }
  });
  const toggleDividerLevel = useCallback((level: DividerLevel) => {
    setDividerLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level); else next.add(level);
      try { localStorage.setItem("virgil-divider-levels", JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);

  const [dividerWidth, setDividerWidthState] = useState<DividerWidth>(() => {
    if (typeof window === "undefined") return "full";
    try {
      const raw = localStorage.getItem("virgil-divider-width");
      if (raw === "full" || raw === "mid" || raw === "text") return raw;
    } catch {}
    return "full";
  });
  const setDividerWidth = useCallback((w: DividerWidth) => {
    setDividerWidthState(w);
    try { localStorage.setItem("virgil-divider-width", w); } catch {}
  }, []);

  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [aiWindowOpen, setAiWindowOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [commandsPopoutOpen, setCommandsPopoutOpen] = useState(false);

  useEffect(() => {
    if (!versionOpen) return;
    const close = () => { setVersionOpen(false); setCommandsPopoutOpen(false); };
    const id = window.setTimeout(() => window.addEventListener("click", close), 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("click", close);
    };
  }, [versionOpen]);

  const insertVirgilCommand = useCallback((name: string) => {
    const editor = editorRef.current?.getEditor();
    if (!editor) return;
    editor.chain().focus().insertContent(`\\${name}`).run();
    setVersionOpen(false);
    setCommandsPopoutOpen(false);
  }, []);
  const aiDot = useMemo(() => aiRequestDotStatus({
    bibReviewRequests,
    bibEntryRequests: entryRequests,
    comments,
    panelAiRequests: aiRequests,
  }), [bibReviewRequests, entryRequests, comments, aiRequests]);
  const { prefs: editorPrefs, transforms: editorTransforms, presets: editorPresets, updatePref, updateTransform, resetAll: resetPrefs, savePreset, loadPreset, deletePreset } = usePreferences();
  // Preference mode toggle. `on` drives the top-bar button styling and gates
  // the ctrl+click picker. Read-only here — the button itself calls toggle().
  const { on: prefModeOn, toggle: togglePrefMode } = usePreferenceMode();
  // Zen mode — render-gates editor chrome (strips, panels, MenuBar,
  // marginalia, popouts) so the document area appears alone. Top bar
  // stays so the button is always reachable. See useZenMode.ts.
  const {
    on: zenModeOn,
    toggle: toggleZenMode,
    leftMargin: zenLeftMargin,
    rightMargin: zenRightMargin,
    setLeftMargin: setZenLeftMargin,
    setRightMargin: setZenRightMargin,
    topGutter: zenTopGutter,
    setTopGutter: setZenTopGutter,
    bottomGutter: zenBottomGutter,
    setBottomGutter: setZenBottomGutter,
  } = useZenMode();

  // Snap all panel/margin prefs to their current rendered widths. Called
  // on drag start so that when the flex switches from "1 100 pref"
  // (shrinkable) to "0 0 pref" (pinned), shrunk panels don't snap back
  // to pref and jump the editor.
  const syncPanelPrefsToRendered = useCallback(() => {
    const main = mainAreaRef.current;
    if (!main) return;
    const cols = main.querySelectorAll<HTMLElement>('[data-flex-col]');
    cols.forEach(col => {
      const side = col.getAttribute('data-flex-col') as 'left' | 'right' | null;
      if (side !== 'left' && side !== 'right') return;
      const rendered = col.getBoundingClientRect().width;
      if (zenModeOn) {
        if (side === 'left') {
          if (Math.abs(rendered - zenLeftMargin) > 0.5) setZenLeftMargin(rendered);
        } else {
          if (Math.abs(rendered - zenRightMargin) > 0.5) setZenRightMargin(rendered);
        }
      } else {
        const active = side === 'left' ? prefs.activeLeft : prefs.activeRight;
        if (active == null) return;
        const currentPref = getPanelWidth(side, active);
        if (Math.abs(rendered - currentPref) > 0.5) {
          setPanelWidth(side, active, rendered);
        }
      }
    });
  }, [zenModeOn, zenLeftMargin, zenRightMargin, setZenLeftMargin, setZenRightMargin, prefs.activeLeft, prefs.activeRight, setPanelWidth, getPanelWidth]);

  // Same pattern for vertical gutters (top/bottom of the text page).
  const syncGutterPrefsToRendered = useCallback(() => {
    const col = editorColRef.current;
    if (!col) return;
    const rows = col.querySelectorAll<HTMLElement>('[data-flex-row]');
    rows.forEach(row => {
      const side = row.getAttribute('data-flex-row');
      const rendered = row.getBoundingClientRect().height;
      if (side === 'top') {
        if (zenModeOn) {
          if (Math.abs(rendered - zenTopGutter) > 0.5) setZenTopGutter(rendered);
        } else {
          if (Math.abs(rendered - topGutterPref) > 0.5) setTopGutterPref(rendered);
        }
      }
      if (side === 'bottom') {
        if (zenModeOn) {
          if (Math.abs(rendered - zenBottomGutter) > 0.5) setZenBottomGutter(rendered);
        } else {
          if (Math.abs(rendered - bottomGutterPref) > 0.5) setBottomGutterPref(rendered);
        }
      }
    });
  }, [topGutterPref, bottomGutterPref, zenModeOn, zenTopGutter, setZenTopGutter, zenBottomGutter, setZenBottomGutter]);

  // Recompute the editor's flex-basis whenever the panel layout
  // changes — drag, panel toggle, zen mode. The basis captures the
  // "intended" editor width given current panel prefs + window, so
  // during window resize the editor holds that width and panel
  // flex-shrink eats the shortage first (panels first, then text area).
  useLayoutEffect(() => {
    const main = mainAreaRef.current;
    if (!main) return;
    let reserved = 0;
    for (const child of main.children) {
      const el = child as HTMLElement;
      if (el.hasAttribute('data-editor-col')) continue;
      const basis = parseFloat(getComputedStyle(el).flexBasis);
      reserved += Number.isFinite(basis) ? basis : el.getBoundingClientRect().width;
    }
    const available = main.clientWidth - reserved;
    const next = Math.max(400, Math.min(1400, available));
    setEditorBasis(prev => prev !== next ? next : prev);
  }, [prefs.panelWidths, prefs.activeLeft, prefs.activeRight, prefs.activeLeftBottom, prefs.activeRightBottom, zenLeftMargin, zenRightMargin, zenModeOn, mainAreaMounted]);

  // Page height basis: "intended" page height = editor column height
  // minus padding, gutter prefs, and gap heights. Updated only when
  // gutter prefs change; on window resize the basis holds and gutters
  // shrink first.
  useLayoutEffect(() => {
    const col = editorColRef.current;
    if (!col) return;
    const cs = getComputedStyle(col);
    let reserved = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    for (const child of col.children) {
      const el = child as HTMLElement;
      if (el.hasAttribute('data-editor-page')) continue;
      if (el.hasAttribute('data-flex-row')) {
        const basis = parseFloat(getComputedStyle(el).flexBasis);
        reserved += Number.isFinite(basis) ? basis : el.getBoundingClientRect().height;
      } else if (el.classList.contains('drag-gap-h') && el.hasAttribute('data-gutter-gap')) {
        reserved += el.getBoundingClientRect().height;
      }
    }
    const available = col.clientHeight - reserved;
    const next = Math.max(400, available);
    setPageHeightBasis(prev => prev !== next ? next : prev);
  }, [topGutterPref, bottomGutterPref, zenModeOn, zenTopGutter, zenBottomGutter, mainAreaMounted, currentDocId, docLoading, editorSplit]);

  // Gutter drag state + handlers.
  const gutterStartY = useRef(0);
  const gutterStartVal = useRef(0);

  const clampGutter = useCallback((requested: number, side: 'top' | 'bottom') => {
    const col = editorColRef.current;
    if (!col) return Math.max(0, requested);
    // Reserve: column padding + page min + other gutter + both drag-gap heights.
    const cs = getComputedStyle(col);
    let reserved = 400 + (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const rows = col.querySelectorAll<HTMLElement>('[data-flex-row]');
    rows.forEach(row => {
      if (row.getAttribute('data-flex-row') !== side) {
        const basis = parseFloat(getComputedStyle(row).flexBasis);
        reserved += Number.isFinite(basis) ? basis : row.getBoundingClientRect().height;
      }
    });
    col.querySelectorAll<HTMLElement>('[data-gutter-gap]').forEach(gap => {
      reserved += gap.getBoundingClientRect().height;
    });
    const max = Math.max(0, col.clientHeight - reserved);
    return Math.max(0, Math.min(requested, max));
  }, []);

  const onTopGutterMove = useCallback((e: MouseEvent) => {
    const delta = e.clientY - gutterStartY.current;
    const next = clampGutter(gutterStartVal.current + delta, 'top');
    if (zenModeOn) {
      setZenTopGutter(next);
    } else {
      setTopGutterPref(next);
    }
  }, [clampGutter, zenModeOn, setZenTopGutter, setTopGutterPref]);

  const onBottomGutterMove = useCallback((e: MouseEvent) => {
    const delta = gutterStartY.current - e.clientY;
    const next = clampGutter(gutterStartVal.current + delta, 'bottom');
    if (zenModeOn) {
      setZenBottomGutter(next);
    } else {
      setBottomGutterPref(next);
    }
  }, [clampGutter, zenModeOn, setZenBottomGutter, setBottomGutterPref]);

  const topGutterDrag = useDragGap({ cursor: 'row-resize', onMove: onTopGutterMove, deadzone: 3 });
  const bottomGutterDrag = useDragGap({ cursor: 'row-resize', onMove: onBottomGutterMove, deadzone: 3 });

  const onTopGutterDown = useCallback((e: React.MouseEvent) => {
    gutterStartY.current = e.clientY;
    syncGutterPrefsToRendered();
    const col = editorColRef.current;
    const top = col?.querySelector<HTMLElement>('[data-flex-row="top"]');
    const fallback = zenModeOn ? zenTopGutter : topGutterPref;
    gutterStartVal.current = top ? top.getBoundingClientRect().height : fallback;
    setIsResizingGutters(true);
    const onUp = () => {
      setIsResizingGutters(false);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mouseup', onUp);
    topGutterDrag.onMouseDown(e);
  }, [syncGutterPrefsToRendered, topGutterDrag, topGutterPref, zenModeOn, zenTopGutter]);

  const onBottomGutterDown = useCallback((e: React.MouseEvent) => {
    gutterStartY.current = e.clientY;
    syncGutterPrefsToRendered();
    const col = editorColRef.current;
    const bottom = col?.querySelector<HTMLElement>('[data-flex-row="bottom"]');
    const fallback = zenModeOn ? zenBottomGutter : bottomGutterPref;
    gutterStartVal.current = bottom ? bottom.getBoundingClientRect().height : fallback;
    setIsResizingGutters(true);
    const onUp = () => {
      setIsResizingGutters(false);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mouseup', onUp);
    bottomGutterDrag.onMouseDown(e);
  }, [syncGutterPrefsToRendered, bottomGutterDrag, bottomGutterPref, zenModeOn, zenBottomGutter]);

  // MenuBar is always home-docked in the Virgil top bar, centered
  // between the tabs (left) and Zen/Prefs cluster (right). No free
  // position — tearing off spawns a `DetachedMenuToolbar` instead.
  const menuWrapStyle = useMemo<React.CSSProperties>(() => {
    if (!colRect || !topbarGaps || !menuWrapSize) {
      return { left: -10000, top: -10000, visibility: "hidden" as const };
    }
    const PAD = 8;
    const homeCenterX = (colRect.left + colRect.right) / 2;
    const availMin = topbarGaps.leftEnd + PAD;
    const availMax = topbarGaps.rightStart - PAD;
    const availWidth = availMax - availMin;
    let left: number;
    if (availWidth < menuWrapSize.w) {
      // Not enough room — anchor to the left of the available band and
      // accept overflow into the right cluster (worst case when tabs
      // fully crowd the middle).
      left = availMin;
    } else {
      const desired = homeCenterX - menuWrapSize.w / 2;
      left = Math.max(availMin, Math.min(desired, availMax - menuWrapSize.w));
    }
    const top =
      topbarGaps.top +
      Math.max(0, (topbarGaps.bottom - topbarGaps.top - menuWrapSize.h) / 2);
    return { left, top };
  }, [colRect, topbarGaps, menuWrapSize]);

  // Preserve the editor column's current L/R position when turning Zen
  // on: measure the chrome widths flanking the editor and use those as
  // the Zen margins, so the "page" doesn't jump.
  const handleToggleZen = useCallback(() => {
    if (!zenModeOn) {
      const mainEl = mainAreaRef.current;
      const editorEl = editorColRef.current;
      if (mainEl && editorEl) {
        const mRect = mainEl.getBoundingClientRect();
        const eRect = editorEl.getBoundingClientRect();
        setZenLeftMargin(eRect.left - mRect.left);
        setZenRightMargin(mRect.right - eRect.right);
      }
    }
    toggleZenMode();
  }, [zenModeOn, toggleZenMode, setZenLeftMargin, setZenRightMargin]);
  const [latestDoc, setLatestDoc] = useState<JSONContent | null>(null);
  const [commentHighlight, setCommentHighlight] = useState<string | null>(null);
  const [pendingCommentText, setPendingCommentText] = useState<string | null>(null);
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [selectedQuotationGroupId, setSelectedQuotationGroupId] = useState<string | null>(null);
  const [selectedArchiveId, setSelectedArchiveId] = useState<string | null>(null);
  const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null);
  const [selectedFootnoteId, setSelectedFootnoteId] = useState<string | null>(null);
  const [selectedExampleId, setSelectedExampleId] = useState<string | null>(null);
  const [orphanedFootnotes, setOrphanedFootnotes] = useState<OrphanedFootnote[]>([]);
  const suppressOrphanRef = useRef<Set<string>>(new Set());
  const [selectedCitationId, setSelectedCitationId] = useState<string | null>(null);
  const [selectedBibKey, setSelectedBibKey] = useState<string | null>(null);
  // Linked-anchor activation (shared by Notes / Revisions / Cutter).
  //   activeAnchorId  — sticky, set on click of gutter icon or panel card
  //   hoveredAnchorId — transient, set on hover
  //   activeAnchorKind — drives the highlight color via MARKER_META
  // Effective anchor = hovered ?? active.
  const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null);
  const [hoveredAnchorId, setHoveredAnchorId] = useState<string | null>(null);
  const [activeAnchorKind, setActiveAnchorKind] = useState<"note" | "revision" | "cutter-comment" | "cutter-suggestion" | null>(null);

  // CSS-based coupled highlight: the `.linked-anchor` span for the
  // active/hovered link gets `data-link-highlight`, and the editor root
  // gets `data-show-hl-<kind>` for each visible highlight kind. Margin
  // icons read the same `activeAnchorId`/`hoveredAnchorId` state via
  // their own `selected` prop. Bidirectional by construction.
  const hiddenHighlightTypes = useMemo(
    () => new Set<HighlightType>(prefs.hiddenHighlightTypes),
    [prefs.hiddenHighlightTypes],
  );
  const visibleHighlightKinds = useMemo(() => {
    const out = new Set<"quotation" | "note" | "todo" | "comment" | "cut" | "archive">();
    if (!prefs.showHighlights) return out;
    for (const t of ALL_HIGHLIGHT_TYPES) {
      if (!hiddenHighlightTypes.has(t)) out.add(t);
    }
    // Archive linked anchors aren't toggleable from the menu — keep
    // them visible whenever the master switch is on.
    out.add("archive");
    return out;
  }, [prefs.showHighlights, hiddenHighlightTypes]);
  useLinkHighlight({
    editor: editorInstance,
    activeLinkId: activeAnchorId,
    hoveredLinkId: hoveredAnchorId,
    visibleHighlightKinds,
  });

  // ── LabelRef popover state ──
  const [activeRefLabel, setActiveRefLabel] = useState<string | null>(null);
  const [activeRefRect, setActiveRefRect] = useState<DOMRect | null>(null);
  const [activeRefCommand, setActiveRefCommand] = useState<
    "ref" | "getref" | "getfullref"
  >("ref");
  const [bibActiveCitationId, setBibActiveCitationId] = useState<string | null>(null);
  const [pendingCitationCreate, setPendingCitationCreate] = useState<string | null>(null);
  // Whether the in-flight pending create should be inserted into the
  // editor on save ("anchored", from the \cite typing rule) or kept as
  // a panel-only card the user can later drag into the document
  // ("unanchored", from the panel + button).
  const [pendingCitationMode, setPendingCitationMode] = useState<"anchored" | "unanchored">("anchored");
  const [searchHighlightRange, setSearchHighlightRange] = useState<{ from: number; to: number } | null>(null);
  const [searchState, setSearchState] = useState<SearchPanelState>(INITIAL_SEARCH_STATE);

  /** SearchPanel dispatches selection + opens the target panel (auto-splits
   *  the search side when target is on the same side). */
  const openItemInPanel = useCallback((panel: PanelId, itemId: string) => {
    switch (panel) {
      case "footnotes": setSelectedFootnoteId(itemId); break;
      case "notes": setSelectedNoteId(itemId); break;
      case "citations": setSelectedCitationId(itemId); break;
      case "todo": setSelectedTodoId(itemId); break;
      case "archive": setSelectedArchiveId(itemId); break;
      case "cutter": setSelectedCutterCardId(itemId); break;
      case "quotations": setSelectedQuotationGroupId(itemId); break;
      case "revisions": setSelectedCommentId(itemId); break;
      case "bibliography": setSelectedBibKey(itemId); break;
      default: break;
    }

    const p = prefsRef.current;
    const searchSide = p.placements.find((x) => x.id === "search")?.side ?? "left";
    const targetSide = p.placements.find((x) => x.id === panel)?.side ?? searchSide;

    if (targetSide === searchSide) {
      setActiveHalf(searchSide, "top", "search");
      setActiveHalf(searchSide, "bottom", panel);
    } else {
      setActiveHalf(targetSide, "top", panel);
    }
  }, [setActiveHalf]);

  // Lifted view modes — persist across panel re-mounts and across sessions
  const [panelViewModes, setPanelViewModes] = useState<Record<string, "list" | "in-text">>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = localStorage.getItem("virgil-panel-view-modes");
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  const getPanelViewMode = useCallback((panelId: string) => panelViewModes[panelId] || "list", [panelViewModes]);
  const setPanelViewMode = useCallback((panelId: string, mode: "list" | "in-text") => {
    setPanelViewModes((prev) => {
      const next = { ...prev, [panelId]: mode };
      try { localStorage.setItem("virgil-panel-view-modes", JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  // Persisted omni-view category preferences per side. Older builds
  // stored 2-char prefixes (fn/ci/qu/nt/ar/td); migrateOmniCategories
  // translates them to the new full prefixes (footnote/citation/…)
  // and is idempotent.
  const [omniCategories, setOmniCategories] = useState<Record<"left" | "right", OmniCategory[]>>(() => {
    if (typeof window === "undefined") return DEFAULT_OMNI_CATEGORIES;
    try {
      const raw = localStorage.getItem("virgil-omni-categories");
      if (!raw) return DEFAULT_OMNI_CATEGORIES;
      const parsed = JSON.parse(raw);
      const migrated = {
        left: migrateOmniCategories(parsed.left) ?? DEFAULT_OMNI_CATEGORIES.left,
        right: migrateOmniCategories(parsed.right) ?? DEFAULT_OMNI_CATEGORIES.right,
      };
      // Persist the migrated form so we don't keep translating.
      try {
        localStorage.setItem("virgil-omni-categories", JSON.stringify(migrated));
      } catch {}
      return migrated;
    } catch { return DEFAULT_OMNI_CATEGORIES; }
  });
  const getOmniEnabled = useCallback((side: "left" | "right") => new Set(omniCategories[side]), [omniCategories]);
  const toggleOmniCategory = useCallback((side: "left" | "right", cat: OmniCategory) => {
    setOmniCategories((prev) => {
      const list = prev[side];
      const next = list.includes(cat) ? list.filter((c) => c !== cat) : [...list, cat];
      const updated = { ...prev, [side]: next };
      try { localStorage.setItem("virgil-omni-categories", JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, []);
  const setOmniSideToDefault = useCallback((side: "left" | "right") => {
    setOmniCategories((prev) => {
      const updated = { ...prev, [side]: [...DEFAULT_OMNI_CATEGORIES[side]] };
      try { localStorage.setItem("virgil-omni-categories", JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, []);

  // Derive which strip side each category's native panel lives on
  const categorySides = useMemo(
    () => deriveCategorySides(prefs.placements),
    [prefs.placements],
  );

  // Inject editor preferences as CSS custom properties (with global transforms)
  useEffect(() => {
    const s = document.documentElement.style;
    for (const entry of PREF_TO_CSS) {
      const raw = editorPrefs[entry.key];
      let value: string;
      if (entry.isColor && typeof raw === "string") {
        value = applyTransforms(raw, editorTransforms);
      } else if (entry.transform) {
        value = entry.transform(raw);
      } else {
        value = String(raw);
      }
      s.setProperty(entry.cssVar, value);
    }
    for (const entry of DERIVED_CSS) {
      s.setProperty(entry.cssVar, entry.compute(editorPrefs));
    }
    // Update browser theme-color meta tag. Always mirrors the topbar
    // background — in enhanced zen mode the whole window canvas is also
    // the topbar color, so this stays correct in both modes.
    const tcSource = editorPrefs.topbarBackground;
    const tc = applyTransforms(tcSource, editorTransforms);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", tc);
  }, [editorPrefs, editorTransforms, zenModeOn]);

  const [codeView, setCodeView] = useState(false);
  const [codeViewLine, setCodeViewLine] = useState<number | undefined>(undefined);
  const [codeViewParagraphId, setCodeViewParagraphId] = useState<string | null>(null);
  const codeEditorHandleRef = useRef<CodeEditorHandle | null>(null);
  const pendingScrollText = useRef<string | null>(null);
  const pendingParagraphId = useRef<string | null>(null);

  // Mirrored LaTeX text from the CodeEditor — fed to the live lint hook
  // and to the Errors panel for snippet/paragraph derivation. Persists
  // across view switches so the Errors panel stays populated when the
  // user returns to rich-text view.
  const [codeEditorText, setCodeEditorText] = useState<string | null>(null);
  const knownBibKeys = useMemo(
    () => bibEntries.map((e) => e.key),
    [bibEntries],
  );
  const lintErrors = useLatexLint({
    text: codeEditorText,
    knownBibKeys,
  });
  const allLatexErrors: LatexError[] = useMemo(
    () =>
      [...lintErrors, ...compileErrors].sort(
        (a, b) => a.line - b.line || (a.column ?? 0) - (b.column ?? 0),
      ),
    [lintErrors, compileErrors],
  );
  const jumpToLineInCode = useCallback(
    (line: number, column?: number) => {
      codeEditorHandleRef.current?.scrollToLine?.(line, column);
    },
    [],
  );
  const [errorsSidebarOpen, setErrorsSidebarOpen] = useState(true);

  // Errors panel: selection + session dismissals. Dismissals are keyed
  // by error.id and reset when the error list changes materially (new
  // lint run may regenerate equivalent ids — that's fine, we want the
  // error to re-surface if it's still present).
  const [selectedErrorId, setSelectedErrorId] = useState<string | null>(null);
  const [dismissedErrorIds, setDismissedErrorIds] = useState<Set<string>>(
    () => new Set(),
  );
  // Position range currently highlighted for the selected error. Scoped
  // to the containing paragraph, narrowed to the offending key when one
  // appears in the paragraph's plain text. Null when no selection or no
  // resolvable location.
  const [errorHighlightRange, setErrorHighlightRange] = useState<{
    from: number;
    to: number;
  } | null>(null);
  const dismissError = useCallback((id: string) => {
    setDismissedErrorIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setSelectedErrorId((cur) => (cur === id ? null : cur));
  }, []);

  // Resolve `error.id → paragraphUuid` when the error's line falls inside
  // a UUID-tagged paragraph block. Drives the margin markers and the
  // "jump to in text" target label.
  const paragraphByErrorId = useMemo(() => {
    const m = new Map<string, string>();
    if (!codeEditorText) return m;
    const ranges = findParagraphUuids(codeEditorText);
    if (ranges.length === 0) return m;
    for (const err of allLatexErrors) {
      const uuid = paragraphForLine(ranges, err.line);
      if (uuid) m.set(err.id, uuid);
    }
    return m;
  }, [codeEditorText, allLatexErrors]);

  // Snippet per error (one trimmed source line), computed once from the
  // latest LaTeX text. Shared with ErrorsHost via props and used by
  // jumpToError to seed the editor highlight.
  const errorSnippets = useMemo(() => {
    const m = new Map<string, string>();
    if (!codeEditorText) return m;
    const lines = codeEditorText.split("\n");
    for (const err of allLatexErrors) {
      if (err.line <= 0 || err.line > lines.length) continue;
      const raw = lines[err.line - 1].trim();
      if (!raw) continue;
      m.set(err.id, raw.length > 140 ? raw.slice(0, 140) + "\u2026" : raw);
    }
    return m;
  }, [codeEditorText, allLatexErrors]);

  // Compute the rich-text range to highlight for an error.
  // Strategy:
  //   1. If `err.detail` (the offending key, e.g. "missingKey") is
  //      present as plain text in any text node, pin the range to that
  //      occurrence. Handles ref/cite undefined errors exactly.
  //   2. Else if the error's paragraph UUID resolves in the doc, scope
  //      to the whole paragraph. Handles structural errors.
  //   3. Else return null (no clean way to pin the error to a range).
  // Paragraph UUIDs can drift across view switches (rich-text re-parse
  // may regenerate them), so the text-first path is the robust one.
  const computeErrorHighlightRange = useCallback(
    (err: LatexError): { from: number; to: number } | null => {
      const ed = editorRef.current?.getEditor();
      if (!ed) return null;

      if (err.detail) {
        let hit: { from: number; to: number } | null = null;
        ed.state.doc.descendants((node, pos) => {
          if (hit) return false;
          if (!node.isText || !node.text) return true;
          const i = node.text.indexOf(err.detail!);
          if (i !== -1) {
            hit = { from: pos + i, to: pos + i + err.detail!.length };
            return false;
          }
          return true;
        });
        if (hit) return hit;
      }

      const paraId = paragraphByErrorId.get(err.id);
      if (paraId) {
        let paraFrom: number | null = null;
        let paraTo: number | null = null;
        ed.state.doc.descendants((node, pos) => {
          if (paraFrom !== null) return false;
          if (node.attrs?.uuid === paraId) {
            paraFrom = pos + 1;
            paraTo = pos + node.nodeSize - 1;
            return false;
          }
          return true;
        });
        if (paraFrom !== null && paraTo !== null) {
          return { from: paraFrom, to: paraTo };
        }
      }

      return null;
    },
    [paragraphByErrorId],
  );

  // Jump to the error's location. Always switches to the rich-text
  // editor (never code), scrolls the mapped paragraph into view, and
  // sets the range highlight so the offending passage lights up.
  const jumpToError = useCallback(
    (err: LatexError) => {
      setSelectedErrorId(err.id);
      if (codeView) {
        pendingParagraphId.current = paragraphByErrorId.get(err.id) ?? null;
        pendingScrollText.current = null;
        codeEditorHandleRef.current = null;
        setCodeView(false);
        // Range is computed once the editor mounts, via the selection-
        // sync effect below. Scroll is handled by the mount effect.
        return;
      }
      const range = computeErrorHighlightRange(err);
      setErrorHighlightRange(range);
      const paraId = paragraphByErrorId.get(err.id);
      if (paraId) {
        try {
          editorRef.current?.scrollToParagraphId(paraId);
        } catch {
          /* ignore */
        }
      }
    },
    [codeView, paragraphByErrorId, computeErrorHighlightRange],
  );

  // Keep the error-highlight range in sync with the current selection.
  // Runs when the selection, the error list, or the editor mount state
  // changes (editorDocVersion is bumped on editor updates and mounts).
  useEffect(() => {
    if (!selectedErrorId) {
      setErrorHighlightRange(null);
      return;
    }
    const err = allLatexErrors.find((e) => e.id === selectedErrorId);
    setErrorHighlightRange(err ? computeErrorHighlightRange(err) : null);
  }, [selectedErrorId, allLatexErrors, computeErrorHighlightRange, editorInstance]);

  // Paragraph navigation history (back/forward) — ref-based to avoid stale closures
  const paraHistoryRef = useRef<{ stack: string[]; idx: number }>({ stack: [], idx: -1 });
  const currentParaRef = useRef<string | null>(null);
  const navigatingRef = useRef(false);
  const [paraNavVersion, setParaNavVersion] = useState(0); // bump to re-render toolbar

  // Scroll TipTap to position after returning from code view
  useEffect(() => {
    if (!editorInstance) return;

    // Prefer paragraph UUID for scroll sync
    const paraId = pendingParagraphId.current;
    if (paraId) {
      pendingParagraphId.current = null;
      pendingScrollText.current = null; // clear text fallback
      const doScroll = () => {
        try {
          editorRef.current?.scrollToParagraphId(paraId);
        } catch { /* ignore */ }
      };
      setTimeout(doScroll, 200);
      setTimeout(doScroll, 500);
      return;
    }

    // Fallback: text-based matching (for edge cases where UUID isn't available)
    if (!pendingScrollText.current) return;
    const snippet = pendingScrollText.current;
    pendingScrollText.current = null;

    // Extract meaningful words from the LaTeX lines — strip all commands/braces
    const cleaned = snippet
      .replace(/\\[a-zA-Z]+\*?/g, " ")     // strip command names
      .replace(/\[[^\]]*\]/g, " ")          // strip optional args
      .replace(/[{}\\$~^_&%#]/g, " ")       // strip special chars
      .replace(/\s+/g, " ")
      .trim();

    // Get words long enough to be meaningful (avoid matching "the", "and", etc.)
    const words = cleaned.split(" ").filter((w) => w.length > 3);
    if (words.length < 2) return;

    const docText = editorInstance.state.doc.textBetween(
      0, editorInstance.state.doc.content.size, "\n"
    );

    // Use regex with .*? between words — same approach as V→C (tolerates formatting differences)
    let matchIdx = -1;
    for (let len = Math.min(words.length, 6); len >= 2; len--) {
      // Escape regex special chars in each word
      const escaped = words.slice(0, len).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      const pattern = escaped.join("[\\s\\S]{0,30}");
      try {
        const re = new RegExp(pattern);
        const match = re.exec(docText);
        if (match) {
          matchIdx = match.index;
          break;
        }
      } catch { /* invalid regex — try shorter */ }
    }

    if (matchIdx < 0) return;

    // Convert text offset to ProseMirror doc position
    let pos = 0;
    let textOffset = 0;
    editorInstance.state.doc.descendants((node, nodePos) => {
      if (pos > 0) return false;
      if (node.isText) {
        const len = (node.text || "").length;
        if (textOffset + len > matchIdx) {
          pos = nodePos + (matchIdx - textOffset);
          return false;
        }
        textOffset += len;
      } else if (node.isBlock && textOffset > 0) {
        textOffset += 1; // \n separator
      }
      return true;
    });

    if (pos > 0) {
      const doScroll = () => {
        try {
          editorInstance.commands.setTextSelection(pos);
          const coords = editorInstance.view.coordsAtPos(pos);
          const scrollEl = editorInstance.view.dom.closest(".overflow-y-auto");
          if (scrollEl && coords) {
            const scrollRect = scrollEl.getBoundingClientRect();
            const targetY = coords.top - scrollRect.top + scrollEl.scrollTop - 150;
            scrollEl.scrollTop = Math.max(0, targetY);
          }
        } catch { /* pos out of range */ }
      };
      setTimeout(doScroll, 200);
      setTimeout(doScroll, 500);
    }
  }, [editorInstance]);

  // Track active paragraph and build navigation history
  // Model: stack always includes current position, idx points to where we are now.
  // Back: idx--, Forward: idx++, New position: truncate forward + push.
  useEffect(() => {
    if (!editorInstance && !codeView) return;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const checkParagraph = () => {
      if (navigatingRef.current) return;
      let paraId: string | null = null;
      if (codeView) {
        paraId = codeEditorHandleRef.current?.getActiveParagraphId() ?? null;
      } else if (editorRef.current) {
        paraId = editorRef.current.getActiveParagraphId();
      }
      if (!paraId || paraId === currentParaRef.current) return;
      currentParaRef.current = paraId;
      const h = paraHistoryRef.current;
      h.stack = h.stack.slice(0, h.idx + 1);
      h.stack.push(paraId);
      if (h.stack.length > 100) h.stack.shift();
      h.idx = h.stack.length - 1;
      setParaNavVersion((v) => v + 1);
    };

    const debouncedCheck = () => {
      if (timerId) clearTimeout(timerId);
      timerId = setTimeout(checkParagraph, 1000);
    };

    if (!codeView && editorInstance) {
      const scrollEl = editorInstance.view.dom.closest(".overflow-y-auto");
      scrollEl?.addEventListener("scroll", debouncedCheck, { passive: true });
      const interval = setInterval(debouncedCheck, 2000);
      return () => {
        scrollEl?.removeEventListener("scroll", debouncedCheck);
        clearInterval(interval);
        if (timerId) clearTimeout(timerId);
      };
    } else if (codeView) {
      const interval = setInterval(debouncedCheck, 2000);
      return () => {
        clearInterval(interval);
        if (timerId) clearTimeout(timerId);
      };
    }
  }, [editorInstance, codeView]);

  // Clear history on document change
  useEffect(() => {
    paraHistoryRef.current = { stack: [], idx: -1 };
    currentParaRef.current = null;
    setParaNavVersion((v) => v + 1);
  }, [currentDocId]);

  const scrollToParagraph = useCallback((uuid: string) => {
    // Sentinel for document top / title area
    if (uuid === "__DOC_TOP__") {
      editorRef.current?.scrollToHeading(-1);
      return;
    }
    if (codeView) {
      codeEditorHandleRef.current?.scrollToParagraphId?.(uuid);
    } else {
      editorRef.current?.scrollToParagraphId(uuid);
    }
  }, [codeView]);

  const paraNavBack = useCallback(() => {
    const h = paraHistoryRef.current;
    if (h.idx <= 0) return;
    h.idx--;
    const targetId = h.stack[h.idx];
    navigatingRef.current = true;
    currentParaRef.current = targetId;
    scrollToParagraph(targetId);
    setParaNavVersion((v) => v + 1);
    setTimeout(() => { navigatingRef.current = false; }, 1500);
  }, [scrollToParagraph]);

  const paraNavForward = useCallback(() => {
    const h = paraHistoryRef.current;
    if (h.idx >= h.stack.length - 1) return;
    h.idx++;
    const targetId = h.stack[h.idx];
    navigatingRef.current = true;
    currentParaRef.current = targetId;
    scrollToParagraph(targetId);
    setParaNavVersion((v) => v + 1);
    setTimeout(() => { navigatingRef.current = false; }, 1500);
  }, [scrollToParagraph]);

  // Derive citation order from editor state
  // Debounced citation order and editor citations (avoid recomputing on every keystroke)
  const [citationOrder, setCitationOrder] = useState<string[]>([]);
  const [allEditorCitations, setAllEditorCitations] = useState<Array<{ citationId: string; command: string; keys: string[]; pos: number }>>([]);
  const citationPositionMap = useMemo(
    () => new Map(allEditorCitations.map((c) => [c.citationId, c.pos])),
    [allEditorCitations]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setCitationOrder(editorRef.current?.getCitationOrder() ?? []);
      const cits = editorRef.current?.getCitations() ?? [];
      setAllEditorCitations(
        cits.map((c) => {
          // Match all {key} groups — handles \cites{a}{b}{c} and \citep{a,b,c}
          const allMatches = [...c.command.matchAll(/\{([^}]+)\}/g)];
          const keys = allMatches.flatMap((m) => m[1].split(",").map((k: string) => k.trim()));
          return { citationId: c.citationId, command: c.command, keys, pos: c.pos };
        })
      );
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestDoc, editorInstance]);

  // Update citation display text when bib entries or style changes
  useEffect(() => {
    if (!editorInstance || bibEntries.length === 0) return;
    const cits = editorRef.current?.getCitations() ?? [];
    for (const c of cits) {
      const display = getCitationDisplayText(c.command);
      if (display !== c.displayText) {
        editorRef.current?.updateCitationDisplay(c.citationId, display);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bibEntries, editorInstance, getCitationDisplayText]);

  // Sync citation nodes from editor into citations state on load.
  // Editor is source of truth (IDs are regenerated each parse), so we
  // always run sync — even when there are zero editor citations — so
  // stale anchored ids from a previous session get dropped (only
  // explicitly-unanchored entries survive the merge).
  useEffect(() => {
    if (!editorInstance) return;
    const editorCits = editorRef.current?.getCitations() ?? [];
    syncCitationsFromEditor(editorCits);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorInstance]);

  // Highlight citation nodes in editor when a bib key is selected in Bibliography panel
  useEffect(() => {
    if (!selectedBibKey) return;
    // Find all citation nodes whose keys include the selected bib key
    const matching = allEditorCitations.filter((c) => c.keys.includes(selectedBibKey));
    const els: HTMLElement[] = [];
    for (const c of matching) {
      const el = document.querySelector(
        `[data-link-kind="citation"][data-link-id="${c.citationId}"]`,
      ) as HTMLElement | null;
      if (el) {
        el.classList.add("citation-highlight-bib");
        els.push(el);
      }
    }
    return () => {
      for (const el of els) el.classList.remove("citation-highlight-bib");
    };
  }, [selectedBibKey, allEditorCitations]);

  // Persistent in-editor highlight of whatever card is selected — one
  // hook covers every card kind. Supersedes previously per-kind effects
  // for footnote/citation and extends the coverage to paragraph (Mode A)
  // anchors on notes/cuts/todos/archive/quotations/comments, which
  // previously had no selected-state highlight at all.
  useCardSelectionHighlight({
    editor: editorInstance,
    selectedNoteId,
    selectedFootnoteId,
    selectedCitationId,
    selectedCutterCardId,
    selectedCommentId,
    selectedTodoId,
    selectedArchiveId,
    selectedQuotationGroupId,
    notes,
    cutterCards,
    archiveSnippets,
    quotationGroups,
    todos: todoItems,
    comments,
  });

  // Clear the toolbar-override editor when the main editor regains focus,
  // so the MenuBar switches back to controlling the document editor.
  useEffect(() => {
    if (!editorInstance) return;
    const clearOverride = () => setOverrideEditor(null);
    editorInstance.on("focus", clearOverride);
    return () => { editorInstance.off("focus", clearOverride); };
  }, [editorInstance]);

  // ── Focus mode: inject a <style> tag to hide/dim editor blocks ───
  // ProseMirror's DOM reconciliation strips classes and inline styles
  // from its managed nodes. A <style> tag with nth-child selectors is
  // immune to this since PM doesn't touch <style> elements.
  const focusStyleRef = useRef<HTMLStyleElement | null>(null);
  const focusStateRef = useRef(focusMode.state);
  focusStateRef.current = focusMode.state;

  useEffect(() => {
    const fs = focusMode.state;

    // Remove previous style tag
    if (focusStyleRef.current) {
      focusStyleRef.current.remove();
      focusStyleRef.current = null;
    }

    if (!fs.active || !editorInstance) return;

    const style = document.createElement("style");
    style.setAttribute("data-virgil-focus", "true");

    // Build CSS rules using nth-child to target blocks outside the range
    const rules: string[] = [];
    const selector = ".tiptap > *";
    const totalChildren = editorInstance.view.dom.children.length;

    for (let i = 0; i < totalChildren; i++) {
      const outside = i < fs.startBlockIndex || i > fs.endBlockIndex;
      if (outside) {
        const nth = i + 1; // nth-child is 1-based
        if (fs.locked) {
          rules.push(`.tiptap > :nth-child(${nth}) { display: none !important; }`);
        } else {
          rules.push(`.tiptap > :nth-child(${nth}) { opacity: 0.25 !important; pointer-events: none !important; }`);
        }
      }
    }

    style.textContent = rules.join("\n");
    document.head.appendChild(style);
    focusStyleRef.current = style;

    // When locking, move cursor into visible range if needed
    if (fs.locked) {
      const doc = editorInstance.view.state.doc;
      const { from } = editorInstance.view.state.selection;
      let firstVisiblePos = 0;
      let selBlockIdx = 0;
      let needsMove = false;
      doc.forEach((node, offset) => {
        if (selBlockIdx === fs.startBlockIndex) firstVisiblePos = offset + 1;
        if (from >= offset && from < offset + node.nodeSize) {
          if (selBlockIdx < fs.startBlockIndex || selBlockIdx > fs.endBlockIndex) needsMove = true;
        }
        selBlockIdx++;
      });
      if (needsMove) {
        try { editorInstance.commands.setTextSelection(firstVisiblePos); } catch {}
      }
    }

    return () => {
      if (focusStyleRef.current) {
        focusStyleRef.current.remove();
        focusStyleRef.current = null;
      }
    };
  }, [editorInstance, focusMode.state]);

  // Current-section breadcrumb: tracks the heading chain of whatever
  // the reader is currently looking at — i.e., the topmost heading
  // above the visible viewport. Headings are collected from the doc,
  // their viewport-relative positions are measured, and we pick the
  // last one whose top is above (or at) a reference line just below
  // the toolbar. Recomputes on scroll, doc change, and resize.
  const [currentSectionPath, setCurrentSectionPath] = useState<SectionPathEntry[]>([]);
  // Top-level block index of the paragraph/list whose parTitle the
  // reader has most recently scrolled past within the current section.
  // Resets whenever a new heading is crossed. null when none.
  const [currentParTitleIndex, setCurrentParTitleIndex] = useState<number | null>(null);
  useEffect(() => {
    if (!editorInstance) return;
    const view = editorInstance.view;
    const scrollEl = view.dom.closest(".overflow-y-auto") as HTMLElement | null;
    if (!scrollEl) return;

    const compute = () => {
      const doc = editorInstance.state.doc;
      // Collect all top-level headings with their text + level + DOM top
      const scrollRect = scrollEl.getBoundingClientRect();
      // Reference line: the vertical middle of the editor viewport. A
      // heading/parTitle becomes "active" once it has scrolled past
      // this midline. Using the middle (instead of just under the top)
      // matches the natural reading focus and makes click-to-scroll
      // align cleanly: scrollToHeading uses block:"center", so the
      // jumped-to heading lands on the reference line and the dot
      // animates straight to it.
      const referenceY = scrollRect.top + scrollRect.height / 2;

      const stack: { level: number; text: string; index: number; sectionNumber: string | null }[] = [];
      let lastCrossedStack: { level: number; text: string; index: number; sectionNumber: string | null }[] = [];
      // Track the last parTitle paragraph whose top has scrolled past
      // the reference line, within the current section scope. Reset
      // whenever a heading is crossed.
      let activeParTitleIdx: number | null = null;

      // When focus is locked, skip blocks outside the focus range — their
      // DOM nodes are hidden and would report bogus viewport positions.
      const fs = focusStateRef.current;
      const skipHidden = fs.active && fs.locked;

      doc.forEach((node, offset, index) => {
        if (skipHidden && (index < fs.startBlockIndex || index > fs.endBlockIndex)) return;

        if (node.type.name === "heading" && node.attrs?.level) {
          const level = node.attrs.level as number;
          // Measure where this heading is on screen
          let headingTop: number | null = null;
          try {
            const coords = view.coordsAtPos(offset + 1);
            headingTop = coords.top;
          } catch {
            headingTop = null;
          }
          if (headingTop == null) return;

          // If the heading has scrolled past the reference line (its
          // top is above the reference), include it in the active
          // stack. Otherwise stop scanning — later headings haven't
          // been reached yet.
          if (headingTop <= referenceY) {
            while (stack.length > 0 && stack[stack.length - 1].level >= level) {
              stack.pop();
            }
            stack.push({ level, text: node.textContent || "Untitled", index, sectionNumber: (node.attrs?.sectionNumber as string) ?? null });
            lastCrossedStack = [...stack];
            // New section scope — clear any active parTitle from the
            // previous section so we re-scan within this one.
            activeParTitleIdx = null;
          }
          return;
        }

        // Paragraph/list with a parTitle — track the most recent one
        // above the reference line inside the current section.
        if (
          (node.type.name === "paragraph" ||
            node.type.name === "bulletList" ||
            node.type.name === "orderedList") &&
          node.attrs?.parTitle
        ) {
          let top: number | null = null;
          try {
            const coords = view.coordsAtPos(offset + 1);
            top = coords.top;
          } catch {
            top = null;
          }
          if (top == null) return;
          if (top <= referenceY) {
            activeParTitleIdx = index;
          }
        }
      });

      const path: SectionPathEntry[] = lastCrossedStack.map((s) => ({ text: s.text, index: s.index, sectionNumber: s.sectionNumber }));
      setCurrentSectionPath((prev) => {
        if (prev.length === path.length && prev.every((v, i) => v.text === path[i].text && v.index === path[i].index && v.sectionNumber === path[i].sectionNumber)) {
          return prev;
        }
        return path;
      });
      setCurrentParTitleIndex((prev) =>
        prev === activeParTitleIdx ? prev : activeParTitleIdx,
      );
    };

    // Initial + event-driven recompute. Throttle scroll via RAF.
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(compute);
    };
    compute();
    scrollEl.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    editorInstance.on("update", schedule);
    return () => {
      cancelAnimationFrame(raf);
      scrollEl.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      editorInstance.off("update", schedule);
    };
  }, [editorInstance]);

  // Mirror (second pane) position tracking — same logic as above but
  // scoped to the mirror ProseMirror view's scroll container.
  const [mirrorSectionPath, setMirrorSectionPath] = useState<SectionPathEntry[]>([]);
  const [mirrorParTitleIndex, setMirrorParTitleIndex] = useState<number | null>(null);
  // Re-run when the mirror view is (re)created: we store a generation
  // counter that bumps whenever onMirrorViewReady fires.
  const [mirrorViewGen, setMirrorViewGen] = useState(0);
  useEffect(() => {
    const mirrorView = mirrorViewRef.current;
    if (!editorSplit || !mirrorView) {
      setMirrorSectionPath([]);
      setMirrorParTitleIndex(null);
      return;
    }
    const scrollEl = mirrorView.dom.closest(".overflow-y-auto") as HTMLElement | null;
    if (!scrollEl) return;

    const compute = () => {
      const doc = mirrorView.state.doc;
      const scrollRect = scrollEl.getBoundingClientRect();
      const referenceY = scrollRect.top + scrollRect.height / 2;

      const stack: { level: number; text: string; index: number; sectionNumber: string | null }[] = [];
      let lastCrossedStack: { level: number; text: string; index: number; sectionNumber: string | null }[] = [];
      let activeParTitleIdx: number | null = null;

      doc.forEach((node, offset, index) => {
        if (node.type.name === "heading" && node.attrs?.level) {
          const level = node.attrs.level as number;
          let headingTop: number | null = null;
          try { headingTop = mirrorView.coordsAtPos(offset + 1).top; } catch { headingTop = null; }
          if (headingTop == null) return;
          if (headingTop <= referenceY) {
            while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
            stack.push({ level, text: node.textContent || "Untitled", index, sectionNumber: (node.attrs?.sectionNumber as string) ?? null });
            lastCrossedStack = [...stack];
            activeParTitleIdx = null;
          }
          return;
        }
        if (
          (node.type.name === "paragraph" || node.type.name === "bulletList" || node.type.name === "orderedList") &&
          node.attrs?.parTitle
        ) {
          let top: number | null = null;
          try { top = mirrorView.coordsAtPos(offset + 1).top; } catch { top = null; }
          if (top != null && top <= referenceY) activeParTitleIdx = index;
        }
      });

      const path: SectionPathEntry[] = lastCrossedStack.map((s) => ({ text: s.text, index: s.index, sectionNumber: s.sectionNumber }));
      setMirrorSectionPath((prev) =>
        prev.length === path.length && prev.every((v, i) => v.text === path[i].text && v.index === path[i].index && v.sectionNumber === path[i].sectionNumber) ? prev : path,
      );
      setMirrorParTitleIndex((prev) => (prev === activeParTitleIdx ? prev : activeParTitleIdx));
    };

    let raf = 0;
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(compute); };
    compute();
    scrollEl.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // Re-compute when the doc changes (shared state with main editor).
    editorInstance?.on("update", schedule);
    return () => {
      cancelAnimationFrame(raf);
      scrollEl.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      editorInstance?.off("update", schedule);
    };
  }, [editorSplit, mirrorViewGen, editorInstance]);

  // Derive footnotes list from editor state (sorted by document position).
  // Depends on `content` as well so the list populates on initial hydration,
  // not only after the first user edit (which is what drives `latestDoc`).
  const footnotes = useMemo(() => {
    return editorRef.current?.getFootnotes() ?? [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestDoc, content, editorInstance]);

  // Derive expex examples list from the editor on the same trigger cadence
  // as footnotes — numbering + sub-labels come from the live plugin.
  const examples = useMemo(() => {
    return editorRef.current?.getExamples() ?? [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestDoc, content, editorInstance]);

  // Set of archive snippet IDs that have at least one paragraph anchor
  const anchoredIds = useMemo<Set<string>>(() => {
    const ids = new Set<string>();
    for (const s of archiveSnippets) {
      if (getLinkedParagraphIds(s).length > 0) ids.add(s.id);
    }
    return ids;
  }, [archiveSnippets]);

  // Snippets sorted: anchored first (by paragraph position in doc), orphaned after
  const sortedArchiveSnippets = useMemo(() => {
    // Build a paragraph-order map from the editor doc
    const paragraphOrder = new Map<string, number>();
    const ed = editorRef.current?.getEditor();
    if (ed) {
      let idx = 0;
      ed.state.doc.descendants((node) => {
        if (isAnchorableNode(node.type) && node.attrs?.uuid) {
          paragraphOrder.set(node.attrs.uuid as string, idx++);
        }
        return true;
      });
    }
    return [...archiveSnippets].sort((a, b) => {
      const aPids = getLinkedParagraphIds(a);
      const bPids = getLinkedParagraphIds(b);
      const aPos = aPids.length > 0 ? paragraphOrder.get(aPids[0]) : undefined;
      const bPos = bPids.length > 0 ? paragraphOrder.get(bPids[0]) : undefined;
      if (aPos != null && bPos != null) return aPos - bPos;
      if (aPos != null) return -1;
      if (bPos != null) return 1;
      return 0;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archiveSnippets, latestDoc, editorInstance]);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  // FSA browser support — defaults to true for SSR/initial render to
  // avoid a flash, then re-checks after mount.
  const [fsaSupported, setFsaSupported] = useState(true);
  useEffect(() => {
    setFsaSupported(hasFsaSupport());
  }, []);
  const nameInputRef = useRef<HTMLInputElement>(null);


  const hasSuggestions = suggestionsState.suggestions.length > 0;

  // Auto-show the Revisions panel when suggestions load (suggestions
  // now live inside that merged panel alongside comment cards).
  useEffect(() => {
    if (hasSuggestions) {
      const hasPending = suggestionsState.suggestions.some((s) => s.status === "pending");
      if (hasPending && prefsRef.current.activeRight !== "revisions") setActiveRight("revisions");
    }
  }, [suggestionsState.suggestions.length, hasSuggestions, setActiveRight]);

  useEffect(() => {
    if (editingTabId) nameInputRef.current?.focus();
  }, [editingTabId]);

  // Whenever the active doc changes, look up its handle in idb and
  // query (don't request) readwrite permission. The result drives the
  // gate vs editor render decision below.
  // In dev-storage mode we skip the FSA permission dance entirely.
  useEffect(() => {
    if (!currentDocId) {
      setDocPermState("no-handle");
      setActiveDocHandle(null);
      return;
    }
    if (isDevStorage) {
      setDocPermState("granted");
      return;
    }
    let cancelled = false;
    setDocPermState("loading");
    (async () => {
      try {
        const handle = await getDocHandle(currentDocId);
        if (cancelled) return;
        if (!handle) {
          setActiveDocHandle(null);
          setDocPermState("no-handle");
          return;
        }
        setActiveDocHandle(handle);
        const state = await queryRW(handle);
        if (cancelled) return;
        setDocPermState(state === "granted" ? "granted" : "needs-grant");
      } catch (err) {
        console.error("Failed to query doc permission:", err);
        if (!cancelled) setDocPermState("needs-grant");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentDocId]);

  const {
    handleUpdate,
    handleScrollToHeading,
    handleReorderBlocks,
    handleRenameHeading,
    handleUpdateLabel,
    handleRenameParTitle,
  } = useEditorOps({
    editorRef,
    mirrorViewRef,
    editorSplit,
    activeSplitPane,
    onUpdate,
    setLatestDoc,
  });

  // ── Focus mode helpers ─────────────────────────────────────────────
  const docForOutline = latestDoc || content;
  const outlineHeadings = useMemo(() => extractHeadings(docForOutline).headings, [docForOutline]);
  const outlineTotalBlocks = useMemo(() => docForOutline?.content?.length ?? 0, [docForOutline]);
  const availableDividerLevels = useMemo(() => {
    const s = new Set<DividerLevel>();
    outlineHeadings.forEach((h) => {
      if (h.level >= 1 && h.level <= 4) s.add(h.level as DividerLevel);
    });
    return s;
  }, [outlineHeadings]);
  const activeDividerLevels = useMemo(() => {
    const s = new Set<DividerLevel>();
    dividerLevels.forEach((lvl) => { if (availableDividerLevels.has(lvl)) s.add(lvl); });
    return s;
  }, [dividerLevels, availableDividerLevels]);
  const dividerClassName = useMemo(() => (
    [...activeDividerLevels].map((lvl) => `show-dividers-${lvl}`).join(" ")
  ), [activeDividerLevels]);

  const {
    handleFocusActivate,
    handleFocusMoveTo,
    handleFocusExpandTo,
    handleFocusSnapBoundary,
  } = useFocusActions({ focusMode, outlineHeadings, outlineTotalBlocks });

  // Focus word count: sum per-block counts within the focused range
  const focusWordCount = useMemo(() => {
    if (!focusMode.state.active) return null;
    const perBlock = buildPerBlockCounts(docForOutline);
    const words = sumIncludedWords(perBlock, focusMode.state.startBlockIndex, focusMode.state.endBlockIndex + 1, focusWcConfig.include);
    return { words };
  }, [focusMode.state, docForOutline, focusWcConfig.include]);

  const {
    handleAct,
    handleCreateFootnote,
    handleQuoteSelection,
    handleAddNoteFromSelection,
    handleCutSelection,
  } = useSelectionToCardActions({
    editorRef,
    addNote,
    addCutterComment,
    addQuotationGroup,
    actOnSuggestion,
    currentSuggestion,
    setSelectedNoteId,
    setSelectedCutterCardId,
    setSelectedQuotationGroupId,
    setSelectedFootnoteId,
    prefs,
    setActiveLeft,
    setActiveRight,
  });

  const {
    handleArchive,
    handleArchiveCapture,
    handleInsertArchive,
    handleRestoreArchive,
    handleDeleteArchive,
  } = useArchiveActions({
    editorRef,
    archiveContent,
    updateArchiveSnippet,
    addArchiveParagraphId,
    archiveSnippets,
    deleteSnippet,
    restoreSnippet,
    setSelectedArchiveId,
    prefs,
    setActiveLeft,
    setActiveRight,
  });



  // Selection ↔ linked-anchor highlight binding for each panel-anchored entity
  // (notes, text revisions, cuts). Each hook:
  //   • syncs `activeAnchorId`/`activeAnchorKind` to the selected entity, so
  //     every setter (toolbar buttons, chip drops, marginalia clicks, kbd nav)
  //     automatically drives the highlight,
  //   • registers a document-level mousedown click-away that clears the
  //     selection when the click lands outside the entity's card and its
  //     anchor span.
  // Text revisions don't carry a `data-revision-entry` card attribute the
  // same way notes/cuts do, but the hook resolves the anchor span and the
  // selection clears via a sibling `data-revision-entry` we add below.
  useSelectedAnchorSync({
    selectedId: selectedNoteId,
    entities: notes,
    kind: "note",
    dataAttrName: "note-entry",
    setSelectedId: setSelectedNoteId,
    setActiveAnchorId,
    setActiveAnchorKind,
    skipSelectors: ['[data-selection-chip]', '[data-add-note-button]'],
  });
  // Cutter shares one selection across both card kinds. Anchor sync
  // happens for both — the kind reported to setActiveAnchorKind is
  // derived per-card by markers.ts when the user clicks a gutter icon;
  // for selection-driven sync, both kinds resolve to "cutter-comment"
  // since the only currently auto-anchored kind is the comment.
  useSelectedAnchorSync({
    selectedId: selectedCutterCardId,
    entities: cutterCards,
    kind: "cutter-comment",
    dataAttrName: "cutter-comment-entry",
    setSelectedId: setSelectedCutterCardId,
    setActiveAnchorId,
    setActiveAnchorKind,
    skipSelectors: ['[data-selection-chip]', '[data-cut-selection-button]'],
  });
  useSelectedAnchorSync({
    selectedId: selectedCommentId,
    entities: comments,
    kind: "revision",
    dataAttrName: "revision-entry",
    setSelectedId: setSelectedCommentId,
    setActiveAnchorId,
    setActiveAnchorKind,
    skipSelectors: ['[data-selection-chip]', '[data-add-comment-button]'],
  });


  // When the user clicks a linking element in the editor, route the
  // scroll target based on whether OmniView is currently visible. If a
  // card with `data-omni-entry="${key}"` exists in the DOM, OmniView is
  // active AND displaying this kind of pod — scroll there. Otherwise
  // the caller falls back to the specialized panel.
  //
  // This is purely a DOM presence check, so it automatically handles
  // every case (left omni, right omni, both, neither) without the
  // callers needing to know about panel placement.
  const tryScrollOmniEntry = useCallback(
    (key: string, targetY?: number): boolean => {
      // Use starts-with selector so multi-paragraph instances (e.g. "nt:id@0")
      // are found when searching for the base key ("nt:id").
      const entry = document.querySelector(
        `[data-omni-entry="${key}"], [data-omni-entry^="${key}@"]`,
      ) as HTMLElement | null;
      if (!entry) return false;
      requestAnimationFrame(() => {
        if (typeof targetY === "number") {
          alignEntryToY(entry, targetY);
        } else {
          scrollEntryIntoView(entry);
        }
      });
      return true;
    },
    [],
  );

  const {
    handleQuotationMarkerClick,
    handleNoteMarkerClick,
    handleHoverNote,
    handleCutMarkerClick,
    handleHoverCut,
    handleTodoMarkerClick,
  } = useMarkerActions({
    prefsRef,
    setActiveLeft,
    setActiveRight,
    setActiveHalf,
    tryScrollOmniEntry,
    getOmniEnabled,
    setActiveAnchorId,
    setHoveredAnchorId,
    setActiveAnchorKind,
    notes,
    selectedNoteId,
    setSelectedNoteId,
    cutterCards,
    selectedCutterCardId,
    setSelectedCutterCardId,
    selectedTodoId,
    setSelectedTodoId,
    setSelectedQuotationGroupId,
    quotationGroups,
  });


  const {
    handleDropSelectionOnNotes,
    handleDropParagraphOnNotes,
    handleDropSelectionOnCutter,
    handleDropParagraphOnCutter,
  } = useDropActions({
    editorRef,
    addNote,
    addCutterComment,
    setSelectedNoteId,
    setSelectedCutterCardId,
  });





  const {
    handleEditFootnote,
    handleEditFootnoteTitle,
    handleDeleteFootnote,
    handleAddFootnote,
  } = useFootnoteActions({
    editorRef,
    suppressOrphanRef,
    setSelectedFootnoteId,
    setOrphanedFootnotes,
  });

  const { handleCitationCreated, handleCitationDrop } = useCitationActions({
    editorRef,
    getCitationDisplayText,
    addCitation,
  });


  const { handleDeleteOrphan, handleEditOrphan, handleEditOrphanTitle } = useOrphanActions({
    setOrphanedFootnotes,
  });

  // Listen for archive marker clicks from the editor
  useMarkerClickBridges({
    prefsRef,
    setActiveLeft,
    setActiveRight,
    setActiveHalf,
    tryScrollOmniEntry,
    getOmniEnabled,
    setSelectedArchiveId,
    setSelectedFootnoteId,
    setSelectedCitationId,
    setActiveRefLabel,
    setActiveRefRect,
    setActiveRefCommand,
  });

  useFootnoteSyncBridges({ suppressOrphanRef, setOrphanedFootnotes, deleteSnippet });

  usePanelDropBridges({
    addQuotationParagraphId,
    setSelectedQuotationGroupId,
    addTodoParagraphId,
    setSelectedTodoId,
    addNoteParagraphId,
    setSelectedNoteId,
    addCardParagraphId,
    setSelectedCutterCardId,
  });

  useAnchorRebindBridge({
    addQuotationParagraphId, removeQuotationParagraphId,
    addTodoParagraphId, removeTodoParagraphId,
    addNoteParagraphId, removeNoteParagraphId,
    addArchiveParagraphId, removeArchiveParagraphId,
    addCardParagraphId, removeCardParagraphId,
  });

  // Highlight the active \ref node with yellow while the popover is open
  useEffect(() => {
    if (!activeRefLabel) return;
    const els = document.querySelectorAll(
      `.label-ref-node[data-label="${activeRefLabel}"]`,
    );
    for (const el of els) el.classList.add("label-ref-active");
    return () => {
      for (const el of els) el.classList.remove("label-ref-active");
    };
  }, [activeRefLabel]);

  // ── LabelRef popover helpers ──
  const {
    gatherLabels,
    handleRefChangeLabel,
    handleRefChangeCommand,
    handleRefJump,
    handleInsertRef,
  } = useRefActions({
    editorRef,
    setActiveRefLabel,
  });

  // Click on empty editor space → deselect all panel items.
  // Marker click handlers call stopPropagation(), so this only fires
  // for non-marker clicks (regular text, whitespace, etc.).
  useEffect(() => {
    const editor = editorRef.current?.getEditor();
    if (!editor) return;
    const editorDom = editor.view.dom;
    const handler = () => {
      setSelectedCommentId(null);
      setSelectedNoteId(null);
      setSelectedQuotationGroupId(null);
      setSelectedArchiveId(null);
      setSelectedTodoId(null);
      setSelectedFootnoteId(null);
      setSelectedCitationId(null);
      setSelectedBibKey(null);
    };
    editorDom.addEventListener("click", handler);
    return () => editorDom.removeEventListener("click", handler);
  }, [editorInstance]);

  useCommandInputBridges({
    editorRef,
    prefsRef,
    setActiveLeft,
    setActiveRight,
    setPendingCitationMode,
    setPendingCitationCreate,
    setActiveRefLabel,
    setActiveRefRect,
    setSelectedFootnoteId,
    setSelectedExampleId,
  });

  // Handle drag-and-drop of archive snippets into the editor.
  // - "card" drag (application/x-virgil-archive-id): ProseMirror inserts the
  //   text from text/plain; we then delete the snippet from archive.
  // - "anchor" drag (application/x-virgil-archive-anchor-id): re-anchor an
  //   orphaned snippet by setting its paragraphId to the drop paragraph.
  useEffect(() => {
    const editor = editorRef.current?.getEditor();
    if (!editor) return;
    const editorDom = editor.view.dom;

    const handleDragOver = (e: DragEvent) => {
      const types = e.dataTransfer?.types;
      if (!types) return;
      if (types.includes(MIME_ARCHIVE_ANCHOR)) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
        editorDom.classList.add("virgil-archive-drop-target");
      }
    };
    const handleDragLeave = (e: DragEvent) => {
      const related = e.relatedTarget as Node | null;
      if (!related || !editorDom.contains(related)) {
        editorDom.classList.remove("virgil-archive-drop-target");
      }
    };

    const handleDrop = (e: DragEvent) => {
      editorDom.classList.remove("virgil-archive-drop-target");
      const anchorData = e.dataTransfer?.getData(MIME_ARCHIVE_ANCHOR);
      if (anchorData) {
        // Re-anchor: resolve drop position to a paragraph UUID
        e.preventDefault();
        e.stopPropagation();
        try {
          const { archiveId } = JSON.parse(anchorData);
          if (!archiveId) return;
          const paragraphId = editorRef.current?.ensureParagraphUuidAtCoords(e.clientX, e.clientY);
          if (paragraphId) {
            addArchiveParagraphId(archiveId, paragraphId);
          }
        } catch { /* ignore */ }
        return;
      }
      const archiveId = e.dataTransfer?.getData(MIME_ARCHIVE);
      if (archiveId) {
        // Let ProseMirror handle the text insertion; just clean up archive
        setTimeout(() => {
          deleteSnippet(archiveId);
        }, 0);
      }
    };

    editorDom.addEventListener("dragover", handleDragOver);
    editorDom.addEventListener("dragleave", handleDragLeave);
    editorDom.addEventListener("drop", handleDrop);
    return () => {
      editorDom.removeEventListener("dragover", handleDragOver);
      editorDom.removeEventListener("dragleave", handleDragLeave);
      editorDom.removeEventListener("drop", handleDrop);
    };
  }, [editorInstance, deleteSnippet, addArchiveParagraphId]);

  // Todo drop actions — create a new todo, link its paragraph, seed its
  // text from the dropped selection where applicable. Used both by the
  // open TodoPanel (via onDropSelection/onDropParagraph props) and by
  // the sidebar icon-drop router (`handleIconDrop`).
  const handleDropSelectionOnTodo = useCallback(
    (payload: { from: number; to: number; selectedText: string }) => {
      if (!editorRef.current) return;
      const paragraphId = editorRef.current.ensureParagraphUuid(payload.from);
      const todo = addTodo();
      if (payload.selectedText) updateTodo(todo.id, payload.selectedText);
      if (paragraphId) addTodoParagraphId(todo.id, paragraphId);
      setSelectedTodoId(todo.id);
    },
    [editorRef, addTodo, updateTodo, addTodoParagraphId, setSelectedTodoId],
  );
  const handleDropParagraphOnTodo = useCallback(
    (paragraphId: string) => {
      if (!paragraphId) return;
      const todo = addTodo();
      addTodoParagraphId(todo.id, paragraphId);
      setSelectedTodoId(todo.id);
    },
    [addTodo, addTodoParagraphId, setSelectedTodoId],
  );

  const pendingRevisionAnchorIdRef = useRef<string | null>(null);

  const { handleAddComment } = useCommentActions({
    editorRef,
    pendingRevisionAnchorIdRef,
    prefs,
    setActiveLeft,
    setActiveRight,
    setPendingCommentText,
  });

  /** Default floating-card popup size (matches FloatingCards.tsx). */
  const POPUP_W = 360;
  const POPUP_H = 280;

  /** Position-and-pop a newly-created card as a floating popover near
   *  the action toolbar. Uses the quadrant-aware spawn helper so the
   *  popup biases inward (above bottom-half triggers, below top-half;
   *  drifts right of left-side triggers, left of right-side). When no
   *  anchor rect is available (e.g. a keyboard shortcut), the popup
   *  centers in the viewport. */
  const popCardAtAnchor = useCallback(
    (cardKind: string, cardId: string, anchorRect: DOMRect | null) => {
      const key = `${cardKind}:${cardId}`;
      const pos = computeSpawnPosition(anchorRect, {
        width: POPUP_W,
        height: POPUP_H,
      });
      setCardFloatPosition(key, pos);
      if (!prefsRef.current.poppedOutCards.includes(key)) {
        toggleCardPopout(key);
      }
    },
    [setCardFloatPosition, toggleCardPopout],
  );

  /** Snapshot the live editor selection. Callers use this to branch
   *  between selection-anchored and blank-card creation paths. */
  const readSelection = useCallback(() => {
    const ed = editorRef.current?.getEditor();
    if (!ed || !editorRef.current) return null;
    const { from, to } = ed.state.selection;
    if (from === to) return null;
    const text = ed.state.doc.textBetween(from, to, " ").trim();
    if (!text) return null;
    return { ed, from, to, text, editorHandle: editorRef.current };
  }, []);

  // Footnotes live in the editor rather than a per-doc hook, so pristine
  // marking is done explicitly from the card-creation layer and discarded
  // via the editor's deleteFootnote handle.
  const markFootnotePristine = useCallback(
    (id: string) => { footnotePristine.markNew(id); },
    [footnotePristine],
  );

  // Central card-creation API — every "+" / toolbar / drop / selection
  // path routes through this so pristine marking, selection setting,
  // panel activation, and floating-popup spawning stay consistent.
  const cardCreation = useCardCreation({
    editorRef,
    addNote,
    addCutterComment,
    addCutterSuggestion,
    addTodo,
    updateTodo,
    addTodoParagraphId,
    addQuotationGroup,
    addCitation,
    setSelectedNoteId,
    setSelectedCutterCardId,
    setSelectedTodoId,
    setSelectedFootnoteId,
    setSelectedQuotationGroupId,
    setSelectedCitationId,
    prefs,
    setActiveLeft,
    setActiveRight,
    popCardAtAnchor,
    markFootnotePristine,
    getFootnoteCount: () =>
      (editorRef.current?.getFootnotes().length ?? 0) + orphanedFootnotes.length,
  });

  // Register per-kind discard callbacks. When the click-away watcher in
  // the pristine manager sees a pointerdown outside a pristine card, it
  // calls the kind's registered discard callback to remove the card.
  useEffect(() => notePristine.registerDiscard((id) => deleteNote(id)), [notePristine, deleteNote]);
  useEffect(() => cutPristine.registerDiscard((id) => deleteCutterCard(id)), [cutPristine, deleteCutterCard]);
  useEffect(() => todoPristine.registerDiscard((id) => deleteTodo(id)), [todoPristine, deleteTodo]);
  useEffect(
    () => quotationPristine.registerDiscard((id) => deleteQuotationGroup(id)),
    [quotationPristine, deleteQuotationGroup],
  );
  useEffect(
    () => citationPristine.registerDiscard((id) => deleteCitation(id)),
    [citationPristine, deleteCitation],
  );
  useEffect(
    () => footnotePristine.registerDiscard((id) => handleDeleteFootnote(id)),
    [footnotePristine, handleDeleteFootnote],
  );

  // ─── Toolbar action handlers ────────────────────────────────────────
  // Each handler creates a card in its corresponding panel — selection-
  // anchored when text is selected, blank otherwise — then spawns a
  // floating popup via popCardAtAnchor. `anchorRect` comes from the
  // Actions toolbar pod via the ActionButton click handler in MenuBar.

  const handleToolbarAddComment = useCallback((anchorRect: DOMRect | null) => {
    const sel = readSelection();
    let anchorId: string | null = null;
    if (sel) {
      const record = createLinkedAnchor(sel.ed, "revision");
      anchorId = record?.anchorId ?? null;
      try { window.getSelection()?.removeAllRanges(); } catch { /* ignore */ }
    }
    const created = addComment({
      text: sel?.text ?? "",
      selectedText: sel?.text || undefined,
      anchorId,
    });
    if (anchorId) {
      const ed = editorRef.current?.getEditor();
      if (ed) updateLinkedAnchorCard(ed, anchorId, "comment", created.id);
    }
    popCardAtAnchor("revision", created.id, anchorRect);
  }, [readSelection, addComment, popCardAtAnchor]);

  const handleToolbarAddNote = useCallback((anchorRect: DOMRect | null) => {
    const sel = readSelection();
    let anchor: { anchorId: string; anchorText: string } | undefined;
    let paragraphId: string | null = null;
    if (sel) {
      paragraphId = sel.editorHandle.ensureParagraphUuid(sel.from);
      const record = createLinkedAnchor(sel.ed, "note");
      if (record) anchor = { anchorId: record.anchorId, anchorText: record.text };
    }
    const note = cardCreation.createNote({ paragraphId, anchor, anchorRect });
    if (sel && anchor) {
      updateLinkedAnchorCard(sel.ed, anchor.anchorId, "note", note.id);
      try { window.getSelection()?.removeAllRanges(); } catch { /* ignore */ }
    }
  }, [readSelection, cardCreation]);

  const handleToolbarAddTodo = useCallback((anchorRect: DOMRect | null) => {
    const sel = readSelection();
    const paragraphId = sel ? sel.editorHandle.ensureParagraphUuid(sel.from) : null;
    cardCreation.createTodo({ text: sel?.text, paragraphId, anchorRect });
    if (sel) {
      try { window.getSelection()?.removeAllRanges(); } catch { /* ignore */ }
    }
  }, [readSelection, cardCreation]);

  const handleToolbarAddCut = useCallback((anchorRect: DOMRect | null) => {
    const sel = readSelection();
    let anchor: { anchorId: string; anchorText: string } | undefined;
    let paragraphId: string | null = null;
    if (sel) {
      paragraphId = sel.editorHandle.ensureParagraphUuid(sel.from);
      const record = createLinkedAnchor(sel.ed, "cutter-comment");
      if (record) anchor = { anchorId: record.anchorId, anchorText: record.text };
    }
    // Toolbar Cutter button defaults to creating a comment from selection.
    // Use the +-dropdown in the panel to create a suggestion explicitly.
    const card = cardCreation.createCutterComment({ paragraphId, anchor, anchorRect });
    if (sel && anchor) {
      updateLinkedAnchorCard(sel.ed, anchor.anchorId, "cutter-comment", card.id);
      try { window.getSelection()?.removeAllRanges(); } catch { /* ignore */ }
    }
  }, [readSelection, cardCreation]);

  const handleToolbarArchive = useCallback((anchorRect: DOMRect | null) => {
    const sel = readSelection();
    if (sel && editorRef.current) {
      const snippet = archiveContent(sel.text);
      const result = editorRef.current.archiveSelection(snippet.id);
      if (result) {
        if (result.content) updateArchiveSnippet(snippet.id, result.content);
        if (result.paragraphId) addArchiveParagraphId(snippet.id, result.paragraphId);
      }
      popCardAtAnchor("archive", snippet.id, anchorRect);
    } else {
      const snippet = archiveContent("");
      popCardAtAnchor("archive", snippet.id, anchorRect);
    }
  }, [readSelection, archiveContent, updateArchiveSnippet, addArchiveParagraphId, popCardAtAnchor]);

  const handleToolbarCreateFootnote = useCallback((anchorRect: DOMRect | null) => {
    cardCreation.createFootnote({ fromSelection: !!readSelection(), anchorRect });
  }, [readSelection, cardCreation]);

  const handleToolbarInsertCitation = useCallback((anchorRect: DOMRect | null) => {
    // Citations don't wrap selected text — a blank unanchored citation
    // is created and popped; the user types the cite key in the card.
    // The in-text atom is inserted separately from the panel's builder
    // flow once the card has a key.
    cardCreation.createCitation({ anchorRect });
  }, [cardCreation]);

  const handleToolbarQuoteSelection = useCallback((anchorRect: DOMRect | null) => {
    const sel = readSelection();
    cardCreation.createQuotation({
      text: sel?.text,
      paragraphId: sel ? sel.editorHandle.ensureParagraphUuid(sel.from) : null,
      anchorRect,
    });
    if (sel) {
      try { window.getSelection()?.removeAllRanges(); } catch { /* ignore */ }
    }
  }, [readSelection, cardCreation]);

  // Callbacks bag shared by the detached Actions toolbar and the per-margin
  // toolbars shown when Omni-view is docked on a side.
  const marginToolbarActions = useMemo(() => ({
    onAddComment: handleToolbarAddComment,
    onAddNote: handleToolbarAddNote,
    onAddTodo: handleToolbarAddTodo,
    onCutSelection: handleToolbarAddCut,
    onArchive: handleToolbarArchive,
    onCreateFootnote: handleToolbarCreateFootnote,
    onInsertCitation: handleToolbarInsertCitation,
    onQuoteSelection: handleToolbarQuoteSelection,
  }), [
    handleToolbarAddComment,
    handleToolbarAddNote,
    handleToolbarAddTodo,
    handleToolbarAddCut,
    handleToolbarArchive,
    handleToolbarCreateFootnote,
    handleToolbarInsertCitation,
    handleToolbarQuoteSelection,
  ]);

  // ── Sidebar panel-icon drop routing ──────────────────────────────────
  // Maps each drop-accepting panel to the MIME types its icon accepts,
  // and a handler that takes the DataTransfer and routes to the same
  // action the open panel would invoke. StripButton reads this per-icon
  // and shows a blue pod highlight on dragover.
  const iconDropMimesByPanel = useMemo<Partial<Record<PanelId, readonly string[]>>>(
    () => ({
      notes: [MIME_SELECTION_ANCHOR, MIME_PAR_CAPTURE],
      cutter: [MIME_SELECTION_ANCHOR, MIME_PAR_CAPTURE],
      revisions: [MIME_SELECTION_ANCHOR, MIME_PAR_CAPTURE],
      todo: [MIME_SELECTION_ANCHOR, MIME_PAR_CAPTURE],
      archive: [MIME_TEXT_CAPTURE, MIME_PAR_CAPTURE],
    }),
    [],
  );
  // Opens a panel on its placed side without toggling. Safe to call when
  // the panel is already active (no-op in that case).
  const ensurePanelActive = useCallback(
    (id: PanelId) => {
      clearBlankIfSet();
      const placement = prefs.placements.find((p) => p.id === id);
      const side = placement?.side ?? "right";
      if (side === "left") {
        if (prefs.activeLeft !== id) setActiveLeft(id);
      } else {
        if (prefs.activeRight !== id) setActiveRight(id);
      }
    },
    [clearBlankIfSet, prefs.placements, prefs.activeLeft, prefs.activeRight, setActiveLeft, setActiveRight],
  );
  const handleIconDrop = useCallback(
    (targetPanelId: PanelId, dt: DataTransfer): boolean => {
      const ed = editorRef.current?.getEditor();
      if (!ed || !editorRef.current) return false;
      // Notes / Cutter / Todo use the same selection+paragraph MIME contract.
      if (
        targetPanelId === "notes" ||
        targetPanelId === "cutter" ||
        targetPanelId === "todo"
      ) {
        const parRaw = dt.getData(MIME_PAR_CAPTURE);
        if (parRaw) {
          try {
            const { uuid } = JSON.parse(parRaw) as { uuid: string };
            if (uuid) {
              if (targetPanelId === "notes") handleDropParagraphOnNotes(uuid);
              else if (targetPanelId === "cutter") handleDropParagraphOnCutter(uuid);
              else handleDropParagraphOnTodo(uuid);
              ensurePanelActive(targetPanelId);
              return true;
            }
          } catch { /* fall through */ }
        }
        const selRaw = dt.getData(MIME_SELECTION_ANCHOR);
        if (selRaw) {
          try {
            const payload = JSON.parse(selRaw) as { from: number; to: number; selectedText: string };
            if (typeof payload.from === "number" && typeof payload.to === "number") {
              if (targetPanelId === "notes") handleDropSelectionOnNotes(payload);
              else if (targetPanelId === "cutter") handleDropSelectionOnCutter(payload);
              else handleDropSelectionOnTodo(payload);
              ensurePanelActive(targetPanelId);
              return true;
            }
          } catch { /* ignore */ }
        }
        return false;
      }
      if (targetPanelId === "revisions") {
        // Mirror the inline logic in revisions-host — stash anchorId in
        // the ref and set pendingCommentText so the RevisionsHost effect
        // creates an empty text revision anchored to the dropped range.
        const parRaw = dt.getData(MIME_PAR_CAPTURE);
        if (parRaw) {
          try {
            const { uuid } = JSON.parse(parRaw) as { uuid: string };
            if (uuid) {
              let from: number | null = null;
              let to: number | null = null;
              ed.state.doc.descendants((node, pos) => {
                if (from !== null) return false;
                if (node.attrs?.uuid === uuid) {
                  from = pos + 1;
                  to = pos + node.nodeSize - 1;
                  return false;
                }
                return true;
              });
              if (from !== null && to !== null && from < to) {
                const record = createLinkedAnchor(ed, "revision", { from, to });
                if (record) {
                  pendingRevisionAnchorIdRef.current = record.anchorId;
                  setPendingCommentText(record.text);
                  ensurePanelActive("revisions");
                  return true;
                }
              }
            }
          } catch { /* fall through */ }
        }
        const selRaw = dt.getData(MIME_SELECTION_ANCHOR);
        if (selRaw) {
          try {
            const payload = JSON.parse(selRaw) as { from: number; to: number; selectedText: string };
            if (typeof payload.from === "number" && typeof payload.to === "number") {
              const record = createLinkedAnchor(ed, "revision", { from: payload.from, to: payload.to });
              if (record) {
                pendingRevisionAnchorIdRef.current = record.anchorId;
                setPendingCommentText(payload.selectedText || record.text);
                ensurePanelActive("revisions");
                return true;
              }
            }
          } catch { /* ignore */ }
        }
        return false;
      }
      if (targetPanelId === "archive") {
        // Archive uses the capture flow — extract content and hand to
        // handleArchiveCapture, which creates an archive snippet and
        // already activates the panel. No `ensurePanelActive` call here.
        const parRaw = dt.getData(MIME_PAR_CAPTURE);
        if (parRaw) {
          try {
            const { uuid } = JSON.parse(parRaw) as { uuid: string };
            if (uuid) {
              const captured = extractParagraphByUuid(ed, uuid);
              if (captured) {
                handleArchiveCapture({ content: captured.content, paragraphId: captured.paragraphId });
                return true;
              }
            }
          } catch { /* fall through */ }
        }
        const textRaw = dt.getData(MIME_TEXT_CAPTURE);
        if (textRaw) {
          try {
            const { from, to } = JSON.parse(textRaw) as { from: number; to: number };
            if (typeof from === "number" && typeof to === "number") {
              const captured = extractRange(ed, from, to);
              if (captured) {
                handleArchiveCapture({ content: captured.content, paragraphId: captured.paragraphId });
                return true;
              }
            }
          } catch { /* ignore */ }
        }
        return false;
      }
      return false;
    },
    [
      editorRef,
      handleDropSelectionOnNotes,
      handleDropParagraphOnNotes,
      handleDropSelectionOnCutter,
      handleDropParagraphOnCutter,
      handleDropSelectionOnTodo,
      handleDropParagraphOnTodo,
      handleArchiveCapture,
      ensurePanelActive,
      pendingRevisionAnchorIdRef,
      setPendingCommentText,
    ],
  );

  const {
    handleDocPermissionGranted,
    handleNativeOpen,
  } = useFileActions({
    openExistingFile,
    setDocPermState,
    refetchDoc,
  });


  const switchToCodeView = useCallback(() => {
    // Get the active paragraph UUID using rules 1-3
    const paraId = editorRef.current?.getActiveParagraphId() ?? null;
    setCodeViewParagraphId(paraId);

    // Fallback: compute line number from text matching
    let line: number | undefined;
    if (!paraId) {
      try {
        const editor = editorRef.current?.getEditor();
        if (editor && content) {
          const scrollEl = editor.view.dom.closest(".overflow-y-auto") as HTMLElement | null;
          const topPos = editor.view.posAtCoords({
            left: editor.view.dom.getBoundingClientRect().left + 50,
            top: (scrollEl?.getBoundingClientRect().top ?? 0) + 20,
          });
          const pos = topPos?.pos ?? editor.state.selection.from;
          const start = Math.max(0, pos - 10);
          const end = Math.min(editor.state.doc.content.size, pos + 60);
          const snippet = editor.state.doc.textBetween(start, end, " ").trim();
          const words = snippet.split(/\s+/).filter((w) => w.length > 3);
          if (words.length >= 2) {
            const latex = serializeToLatex(content);
            for (let len = Math.min(words.length, 6); len >= 2; len--) {
              const phrase = words.slice(0, len).join(".*?");
              const re = new RegExp(phrase, "s");
              const match = re.exec(latex);
              if (match) {
                line = latex.substring(0, match.index).split("\n").length;
                break;
              }
            }
          }
        }
      } catch { /* fallback: no line */ }
    }
    setCodeViewLine(line);
    setEditorInstance(null);
    setCodeView(true);
  }, [content]);

  const switchToVisualView = useCallback(() => {
    // Capture text around visible area before destroying code editor
    const handle = codeEditorHandleRef.current;
    if (handle) {
      // Prefer paragraph UUID; fall back to text matching
      const paraId = handle.getActiveParagraphId();
      if (paraId) {
        pendingParagraphId.current = paraId;
        pendingScrollText.current = null;
      } else {
        pendingScrollText.current = handle.getTextAroundCursor();
        pendingParagraphId.current = null;
      }
    }
    codeEditorHandleRef.current = null;
    setCodeView(false);
    refetchDoc();
  }, [refetchDoc]);

  const selectionsForStrip = useMemo(
    () => ({
      selectedNoteId, setSelectedNoteId,
      selectedFootnoteId, setSelectedFootnoteId,
      selectedCitationId, setSelectedCitationId,
      selectedTodoId, setSelectedTodoId,
      selectedArchiveId, setSelectedArchiveId,
      selectedCutterCardId, setSelectedCutterCardId,
      selectedQuotationGroupId, setSelectedQuotationGroupId,
      selectedCommentId, setSelectedCommentId,
      selectedBibKey, setSelectedBibKey,
      selectedExampleId, setSelectedExampleId,
    }),
    [
      selectedNoteId, setSelectedNoteId,
      selectedFootnoteId, setSelectedFootnoteId,
      selectedCitationId, setSelectedCitationId,
      selectedTodoId, setSelectedTodoId,
      selectedArchiveId, setSelectedArchiveId,
      selectedCutterCardId, setSelectedCutterCardId,
      selectedQuotationGroupId, setSelectedQuotationGroupId,
      selectedCommentId, setSelectedCommentId,
      selectedBibKey, setSelectedBibKey,
      selectedExampleId, setSelectedExampleId,
    ],
  );

  const { handleStripClick, handleMove } = useStripHandlers({
    prefs,
    focusedHalfLeft,
    focusedHalfRight,
    togglePanel,
    movePanel,
    setActiveHalf,
    selections: selectionsForStrip,
  });

  // Clear search highlight when the search panel is no longer visible
  const searchPanelOpen = prefs.activeLeft === "search" || prefs.activeRight === "search";
  useEffect(() => {
    if (!searchPanelOpen) setSearchHighlightRange(null);
  }, [searchPanelOpen]);

  // --- Marginalia: build the marker list and side map ---
  // (Hooks must run on every render — placed before any early returns.)
  // OmniView aggregates several panels on one side, so when omni is
  // active the child panels count as "on that side" for marginalia too.
  const marginaliaPanelSides = useMemo(() => {
    const omniLeft = prefs.activeLeft === "omni";
    const omniRight = prefs.activeRight === "omni";
    // Quotations is a left-side child of OmniView
    const quotationsSide: "left" | "right" | null =
      prefs.activeLeft === "quotations" || omniLeft
        ? "left"
        : prefs.activeRight === "quotations"
          ? "right"
          : null;
    // Notes, archive, revisions, cutter are right-side children of OmniView
    const notesSide: "left" | "right" | null =
      prefs.activeLeft === "notes"
        ? "left"
        : prefs.activeRight === "notes" || omniRight
          ? "right"
          : null;
    const archiveSide: "left" | "right" | null =
      prefs.activeLeft === "archive"
        ? "left"
        : prefs.activeRight === "archive" || omniRight
          ? "right"
          : null;
    const revisionsSide: "left" | "right" | null =
      prefs.activeLeft === "revisions"
        ? "left"
        : prefs.activeRight === "revisions" || omniRight
          ? "right"
          : null;
    const cutterSide: "left" | "right" | null =
      prefs.activeLeft === "cutter"
        ? "left"
        : prefs.activeRight === "cutter" || omniRight
          ? "right"
          : null;
    const todoSide: "left" | "right" | null =
      prefs.activeLeft === "todo"
        ? "left"
        : prefs.activeRight === "todo" || omniRight
          ? "right"
          : null;
    return {
      quotations: quotationsSide,
      notes: notesSide,
      archive: archiveSide,
      revisions: revisionsSide,
      cutter: cutterSide,
      todo: todoSide,
    };
  }, [prefs.activeLeft, prefs.activeRight]);

  // Bump a version counter on editor updates so marginalia markers recompute
  // (quotation/archive/todo markers depend on paragraph visibility metrics).
  const [editorDocVersion, setEditorDocVersion] = useState(0);
  useEffect(() => {
    if (!editorInstance) return;
    const bump = () => setEditorDocVersion((v) => v + 1);
    editorInstance.on("update", bump);
    return () => {
      editorInstance.off("update", bump);
    };
  }, [editorInstance]);

  // Track focus on the canonical editor — interactions with the top pane
  // mark it active so panels route their jumps there.
  useEffect(() => {
    if (!editorInstance) return;
    const dom = editorInstance.view.dom as HTMLElement;
    const mark = () => setActiveSplitPane("top");
    dom.addEventListener("focusin", mark);
    dom.addEventListener("mousedown", mark);
    return () => {
      dom.removeEventListener("focusin", mark);
      dom.removeEventListener("mousedown", mark);
    };
  }, [editorInstance]);

  // Reset to the top pane whenever the split closes.
  useEffect(() => {
    if (!editorSplit) setActiveSplitPane("top");
  }, [editorSplit]);

  const marginaliaMarkers = useMemo<MarginaliaMarker[]>(() => {
    // Touch editorDocVersion so this memo recomputes when the doc changes
    void editorDocVersion;
    const result: MarginaliaMarker[] = [];

    // Quotation markers — one marker per paragraphId
    for (const g of quotationGroups) {
      const pids = getLinkedParagraphIds(g);
      if (pids.length === 0) continue;
      for (const pid of pids) {
        result.push({
          id: `${g.id}:${pid}`,
          entityId: g.id,
          type: "quote",
          paragraphId: pid,
          selected: selectedQuotationGroupId === g.id,
          title: g.title || g.references[0]?.citeKey || "Quotation",
          onClick: (clickY?: number) => handleQuotationMarkerClick(g.id, clickY),
          onDelete: () => removeQuotationParagraphId(g.id, pid),
        });
      }
    }

    // Note markers — one marker per paragraphId (same pattern as quotations)
    for (const n of notes) {
      const pids = getLinkedParagraphIds(n);
      if (pids.length === 0) continue;
      const noteAnchor = getTextAnchor(n);
      for (const pid of pids) {
        result.push({
          id: `${n.id}:${pid}`,
          entityId: n.id,
          type: "note",
          paragraphId: pid,
          selected: selectedNoteId === n.id,
          title: n.title || "Note",
          onClick: (clickY?: number) => handleNoteMarkerClick(n.id, clickY),
          onDelete: () => {
            // Drop the text anchor first so the highlight clears. The
            // orphan guard fires `virgil-anchor-orphaned` which clears
            // the note's text anchor via the useNotes listener; the
            // selection-sync effect then releases `activeAnchorId`.
            const ed = editorRef.current?.getEditor();
            if (ed && noteAnchor) removeLinkedAnchor(ed, noteAnchor.anchorId);
            removeNoteParagraphId(n.id, pid);
          },
          anchorId: noteAnchor?.anchorId,
          onHover: noteAnchor
            ? (hovering: boolean) => {
                if (hovering) {
                  setHoveredAnchorId(noteAnchor.anchorId);
                  setActiveAnchorKind("note");
                } else {
                  setHoveredAnchorId(null);
                }
              }
            : undefined,
        });
      }
    }

    // Archive markers — one marker per paragraphId
    for (const snippet of archiveSnippets) {
      const pids = getLinkedParagraphIds(snippet);
      if (pids.length === 0) continue;
      for (const pid of pids) {
        result.push({
          id: `${snippet.id}:${pid}`,
          entityId: snippet.id,
          type: "archive",
          paragraphId: pid,
          selected: selectedArchiveId === snippet.id,
          title: "Archived snippet",
          onClick: () => {
            setSelectedArchiveId(snippet.id);
            editorRef.current?.scrollToParagraphId(pid);
          },
          onDelete: () => removeArchiveParagraphId(snippet.id, pid),
        });
      }
    }

    // Anchored-comment markers — one marker per comment with a text
    // anchor. The paragraph uuid is resolved live from the mark's range;
    // if the mark is gone the comment becomes orphaned and gets no marker.
    const ed = editorRef.current?.getEditor();
    if (ed) {
      for (const r of comments) {
        if (r.resolved) continue;
        const revAnchor = getTextAnchor(r);
        if (!revAnchor) continue;
        const anchorId = revAnchor.anchorId;
        // Find paragraphId by walking to the containing anchorable node
        let paragraphId: string | null = null;
        try {
          ed.state.doc.descendants((node, pos) => {
            if (paragraphId) return false;
            if (node.isText) {
              const hasMark = node.marks.some(
                (m) => m.type.name === "linkedAnchor" && m.attrs.anchorId === anchorId,
              );
              if (hasMark) {
                const $p = ed.state.doc.resolve(pos);
                for (let d = $p.depth; d >= 0; d--) {
                  const n = $p.node(d);
                  if (n.attrs?.uuid) { paragraphId = n.attrs.uuid as string; return false; }
                }
              }
            }
            return true;
          });
        } catch { /* ignore */ }
        if (!paragraphId) continue;
        result.push({
          id: `${r.id}:${paragraphId}`,
          entityId: r.id,
          type: "revision",
          paragraphId,
          selected: selectedCommentId === r.id,
          title: r.selectedText || "Revision",
          anchorId,
          onClick: () => {
            const nextSelected = selectedCommentId === r.id ? null : r.id;
            setSelectedCommentId(nextSelected);
            if (nextSelected) {
              setActiveAnchorId(anchorId);
              setActiveAnchorKind("revision");
            } else {
              setActiveAnchorId(null);
              setActiveAnchorKind(null);
            }
            const p = prefsRef.current;
            const placement = p.placements.find((pl) => pl.id === "revisions");
            if (placement?.side === "left") {
              if (p.activeLeft !== "revisions") setActiveLeft("revisions");
            } else {
              if (p.activeRight !== "revisions") setActiveRight("revisions");
            }
          },
          onHover: (hovering: boolean) => {
            if (hovering) {
              setHoveredAnchorId(anchorId);
              setActiveAnchorKind("revision");
            } else {
              setHoveredAnchorId(null);
            }
          },
        });
      }
    }

    // Cutter markers — one per paragraphId. Both card kinds share the
    // "cut" gutter marker; the kind discriminates only the active-anchor
    // hint passed to setActiveAnchorKind.
    for (const c of cutterCards) {
      const pids = getLinkedParagraphIds(c);
      if (pids.length === 0) continue;
      const cardAnchor = getTextAnchor(c);
      const anchorKind: "cutter-comment" | "cutter-suggestion" =
        c.kind === "suggestion" ? "cutter-suggestion" : "cutter-comment";
      const title =
        c.kind === "suggestion"
          ? c.explanation || "Suggestion"
          : c.text || "Comment";
      for (const pid of pids) {
        result.push({
          id: `${c.id}:${pid}`,
          entityId: c.id,
          type: "cut",
          paragraphId: pid,
          selected: selectedCutterCardId === c.id,
          title,
          onClick: () => handleCutMarkerClick(c.id),
          onDelete: () => {
            // Drop the text anchor first: the orphan guard fires
            // `virgil-anchor-orphaned`, useCutter clears the card's
            // text-anchor link, and the selection-sync hook then releases
            // `activeAnchorId` — so the highlight goes away.
            const ed = editorRef.current?.getEditor();
            if (ed && cardAnchor) removeLinkedAnchor(ed, cardAnchor.anchorId);
            removeCardParagraphId(c.id, pid);
          },
          anchorId: cardAnchor?.anchorId,
          onHover: cardAnchor
            ? (hovering: boolean) => {
                if (hovering) {
                  setHoveredAnchorId(cardAnchor.anchorId);
                  setActiveAnchorKind(anchorKind);
                } else {
                  setHoveredAnchorId(null);
                }
              }
            : undefined,
        });
      }
    }

    // Todo markers — one marker per paragraphId
    for (const item of todoItems) {
      const pids = getLinkedParagraphIds(item);
      if (pids.length === 0) continue;
      for (const pid of pids) {
        result.push({
          id: `${item.id}:${pid}`,
          entityId: item.id,
          type: "todo",
          paragraphId: pid,
          selected: selectedTodoId === item.id,
          title: item.text || "Todo",
          muted: item.done,
          onClick: (clickY?: number) => handleTodoMarkerClick(item.id, clickY),
          onDelete: () => removeTodoParagraphId(item.id, pid),
        });
      }
    }

    // Error markers — one per error whose line resolved to a paragraph
    // UUID. Dismissed errors are filtered out so they don't hang around
    // in the gutter.
    for (const err of allLatexErrors) {
      if (dismissedErrorIds.has(err.id)) continue;
      const pid = paragraphByErrorId.get(err.id);
      if (!pid) continue;
      result.push({
        id: `${err.id}:${pid}`,
        entityId: err.id,
        type: "error",
        paragraphId: pid,
        selected: selectedErrorId === err.id,
        title:
          err.message.length > 80
            ? err.message.slice(0, 80) + "\u2026"
            : err.message,
        muted: err.severity === "info",
        onClick: () => {
          const next = selectedErrorId === err.id ? null : err.id;
          setSelectedErrorId(next);
          if (next) {
            const p = prefsRef.current;
            const placement = p.placements.find((pl) => pl.id === "errors");
            if (placement?.side === "left") {
              if (p.activeLeft !== "errors") setActiveLeft("errors");
            } else {
              if (p.activeRight !== "errors") setActiveRight("errors");
            }
          }
        },
        onDelete: () => dismissError(err.id),
      });
    }

    return result;
  }, [
    quotationGroups,
    selectedQuotationGroupId,
    removeQuotationParagraphId,
    notes,
    selectedNoteId,
    removeNoteParagraphId,
    archiveSnippets,
    selectedArchiveId,
    removeArchiveParagraphId,
    todoItems,
    selectedTodoId,
    removeTodoParagraphId,
    editorDocVersion,
    handleQuotationMarkerClick,
    handleNoteMarkerClick,
    handleTodoMarkerClick,
    comments,
    selectedCommentId,
    setActiveLeft,
    setActiveRight,
    cutterCards,
    selectedCutterCardId,
    removeCardParagraphId,
    handleCutMarkerClick,
    allLatexErrors,
    dismissedErrorIds,
    paragraphByErrorId,
    selectedErrorId,
    dismissError,
    setActiveLeft,
    setActiveRight,
  ]);

  // Subscribe to panel-color changes so linked-anchor highlight updates live.
  usePanelColorSubscription();
  // Effective linked-anchor activation: hovered takes priority over sticky-active.
  const effectiveAnchorId = hoveredAnchorId ?? activeAnchorId;
  const effectiveAnchorColor = (() => {
    if (!activeAnchorKind) return null;
    // LinkedAnchorKind → MarkerType. Both cutter card kinds share the
    // single "cut" marker entry; revisions panel uses the "revision"
    // marker.
    const markerType =
      activeAnchorKind === "cutter-comment" ||
      activeAnchorKind === "cutter-suggestion"
        ? "cut"
        : activeAnchorKind;
    const meta = MARKER_META[markerType];
    const key = MARKER_KIND_TO_THEME_KEY[activeAnchorKind];
    if (key && isPanelColorOverridden(key)) {
      return deriveMarkerPalette(getPanelColor(key)).selectedBg;
    }
    return meta.selectedBg;
  })();

  // Re-apply linked-anchor marks on load. Each sidecar stores (anchorId, anchorText);
  // we walk the doc and try to re-attach each mark via text search. For legacy
  // text revisions that have `selectedText` but no `anchorId`, we do a best-
  // effort reanchor and persist the resulting anchorId back onto the revision.
  // Guarded on docIdForHooks so we only run once per open document.
  const anchorsAppliedDocRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editorInstance || !editorRef.current || !docIdForHooks) return;
    if (anchorsAppliedDocRef.current === docIdForHooks) return;
    anchorsAppliedDocRef.current = docIdForHooks;
    const records: Array<{ anchorId: string; kind: "note" | "revision" | "cutter-comment" | "cutter-suggestion"; text: string }> = [];
    for (const n of notes) {
      const ta = getTextAnchor(n);
      if (ta && ta.anchorText) {
        records.push({ anchorId: ta.anchorId, kind: "note", text: ta.anchorText });
      }
    }
    for (const c of comments) {
      const ta = getTextAnchor(c);
      if (ta) {
        records.push({ anchorId: ta.anchorId, kind: "revision", text: ta.anchorText || (c.selectedText ?? "") });
      }
    }
    for (const c of cutterCards) {
      const ta = getTextAnchor(c);
      if (ta && ta.anchorText) {
        records.push({
          anchorId: ta.anchorId,
          kind: c.kind === "suggestion" ? "cutter-suggestion" : "cutter-comment",
          text: ta.anchorText,
        });
      }
    }
    if (records.length > 0) {
      editorRef.current.applyLinkedAnchors(records);
    }

    // Legacy anchored comments: no text-anchor link yet, only `selectedText`.
    // Try to reanchor by searching for that text; on success, persist the
    // new id onto the comment.
    for (const c of comments) {
      if (getTextAnchor(c) || !c.selectedText) continue;
      const rec = reanchorByText(editorInstance, "revision", c.selectedText);
      if (rec) setCommentAnchor(c.id, rec.anchorId);
    }
  }, [editorInstance, docIdForHooks, notes, comments, cutterCards, setCommentAnchor]);

  // Filter marginalia by visibility settings
  const visibleMarginaliaMarkers = useMemo(() => {
    if (!showMarginalia) return [];
    if (hiddenMarginaliaTypes.size === 0) return marginaliaMarkers;
    return marginaliaMarkers.filter((m) => !hiddenMarginaliaTypes.has(m.type as MarginaliaType));
  }, [marginaliaMarkers, showMarginalia, hiddenMarginaliaTypes]);

  // Compute the set of paragraph UUIDs that have marginalia anchored to them,
  // used by MarginaliaAnchorGuard to preserve paragraphs on deletion.
  // Use the full unfiltered list so hiding markers doesn't lose anchors.
  const anchoredUuidsRef = useRef(new Set<string>());
  useMemo(() => {
    const set = new Set<string>();
    for (const m of marginaliaMarkers) set.add(m.paragraphId);
    anchoredUuidsRef.current = set;
  }, [marginaliaMarkers]);

  // Loading
  if (filesLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--background)] text-[var(--muted)]">
        Loading...
      </div>
    );
  }

  const activeLeft = prefs.activeLeft;
  const activeRight = prefs.activeRight;

  // Search range highlight takes priority — skip text-based highlight when active
  const highlightText = searchHighlightRange || errorHighlightRange
    ? null
    : !visibleHighlightKinds.has("comment")
      ? null
      : pendingCommentText
        ? pendingCommentText
        : commentHighlight
          ? commentHighlight
          : (activeLeft === "revisions" || activeRight === "revisions") &&
              currentSuggestion &&
              currentSuggestion.status === "pending"
            ? currentSuggestion.original_text
            : null;
  // Range-based highlights — search wins over error (search is an
  // explicit user action, error highlight is derived from selection).
  const effectiveHighlightRange = searchHighlightRange ?? errorHighlightRange;
  // OmniView aggregates several child panels on one side; when omni is
  // active, the side-of-panel lookups must include its children so
  // connector lines render from the correct side.
  //   Left omni children:  footnotes, citations, quotations
  //   Right omni children: notes, revisions, cutter, archive
  const omniLeftActive = activeLeft === "omni";
  const omniRightActive = activeRight === "omni";
  const notesPanelSide: "left" | "right" | null =
    activeLeft === "notes" ? "left" : activeRight === "notes" || omniRightActive ? "right" : null;
  const todoPanelSide: "left" | "right" | null =
    activeLeft === "todo" ? "left" : activeRight === "todo" || omniRightActive ? "right" : null;
  const cutterPanelSide: "left" | "right" | null =
    activeLeft === "cutter" ? "left" : activeRight === "cutter" || omniRightActive ? "right" : null;
  const revisionsPanelSide: "left" | "right" | null =
    activeLeft === "revisions" ? "left" : activeRight === "revisions" || omniRightActive ? "right" : null;
  const bibliographyPanelSide: "left" | "right" | null =
    activeLeft === "bibliography" ? "left" : activeRight === "bibliography" ? "right" : null;

  // Wrap a rendered panel in the PanelChrome context so its PanelHeader
  // can render the pop-out and close buttons bound to this panel id.
  // `half` is provided when the panel is rendered inside a split column;
  // omitted for single-column and floating panels.
  const renderPanelWithChrome = (panelId: PanelId, side: Side, half?: "top" | "bottom"): React.ReactNode => {
    const inner = renderPanelInner(panelId, side);
    if (panelId === "blank" || panelId === "omni") return inner;
    const isPoppedOut = prefs.poppedOutPanels.includes(panelId);
    const onClose = () => {
      if (isPoppedOut) {
        closePopout(panelId);
      } else {
        setActiveHalf(side, half ?? "top", "omni");
      }
    };
    const onTogglePopout = (anchor?: DOMRect | null) => {
      // Going docked → popped: seed a quadrant-aware spawn position so the
      // float appears near the docked panel (forget-on-close in
      // togglePopout/closePopout means this seed is fresh every time).
      if (!prefsRef.current.poppedOutPanels.includes(panelId)) {
        const pos = computeSpawnPosition(anchor ?? null, {
          width: FLOATING_PANEL_WIDTH,
          height: FLOATING_PANEL_HEIGHT,
        });
        setFloatPosition(panelId, pos);
      }
      togglePopout(panelId);
    };
    return (
      <PanelChromeProvider
        value={{
          isPoppedOut,
          onTogglePopout,
          side,
          onClose,
        }}
      >
        {inner}
      </PanelChromeProvider>
    );
  };

  // Render the inner JSX for a panel by id, without any column wrapper.
  // The caller is responsible for wrapping in <PanelColumn> (or rendering
  // it inside a split half).
  function renderPanelInner(panelId: PanelId, side: Side): React.ReactNode {
    if (!(panelId in PANEL_ICONS)) return null;

    if (panelId === "blank") {
      return <div className="w-full h-full bg-[var(--background)]" />;
    }

    if (panelId === "todo") {
      return (
        <TodoHost
          side={side}
          panelSide={todoPanelSide}
          todoItems={todoItems}
          addTodo={addTodo}
          toggleTodo={toggleTodo}
          updateTodo={updateTodo}
          updateTodoNotes={updateTodoNotes}
          setTodoAiRequest={setTodoAiRequest}
          deleteTodo={deleteTodo}
          archiveTodos={archiveTodos}
          discardPristine={discardPristineTodos}
          onDropSelection={handleDropSelectionOnTodo}
          onDropParagraph={handleDropParagraphOnTodo}
        />
      );
    }

    if (panelId === "outline") {
      return (
        <OutlineHost
          content={latestDoc || content}
          onScrollTo={handleScrollToHeading}
          onReorderBlocks={handleReorderBlocks}
          onRenameHeading={handleRenameHeading}
          onRenameParTitle={handleRenameParTitle}
          onUpdateLabel={handleUpdateLabel}
          isLabelTaken={checkLabelTaken}
          activeSectionPath={currentSectionPath}
          activeParTitleIndex={currentParTitleIndex}
          editorSplit={editorSplit}
          mirrorSectionPath={mirrorSectionPath}
          mirrorParTitleIndex={mirrorParTitleIndex}
          focusState={focusMode.state}
          onFocusActivate={handleFocusActivate}
          onFocusDeactivate={focusMode.deactivate}
          onFocusToggleLock={focusMode.toggleLock}
          onFocusMoveTo={handleFocusMoveTo}
          onFocusExpandTo={handleFocusExpandTo}
          onFocusSnapBoundary={handleFocusSnapBoundary}
        />
      );
    }

    if (panelId === "notes") {
      return (
        <NotesHost
          side={side}
          panelSide={notesPanelSide}
          notes={notes}
          addNote={addNote}
          updateNote={updateNote}
          updateNoteTitle={updateNoteTitle}
          deleteNote={deleteNote}
          discardPristine={discardPristineNotes}
          onHoverNote={handleHoverNote}
          onDropSelection={handleDropSelectionOnNotes}
          onDropParagraph={handleDropParagraphOnNotes}
        />
      );
    }

    if (panelId === "revisions") {
      return (
        <RevisionsHost
          side={side}
          panelSide={revisionsPanelSide}
          comments={comments}
          addComment={addComment}
          updateCommentContent={updateCommentContent}
          setCommentAuthor={setCommentAuthor}
          deleteComment={deleteComment}
          suggestions={suggestionsState.suggestions}
          currentSuggestionIndex={suggestionsState.currentIndex}
          actOnSuggestion={handleAct}
          updateSuggestionField={updateSuggestionField}
          jumpToSuggestion={jumpToSuggestion}
          pendingCommentText={pendingCommentText}
          setPendingCommentText={setPendingCommentText}
          pendingRevisionAnchorIdRef={pendingRevisionAnchorIdRef}
          setCommentHighlight={setCommentHighlight}
          setHoveredAnchorId={setHoveredAnchorId}
          setActiveAnchorKind={setActiveAnchorKind}
        />
      );
    }

    if (panelId === "archive") {
      return (
        <ArchiveHost
          side={side}
          sortedArchiveSnippets={sortedArchiveSnippets}
          archiveSnippets={archiveSnippets}
          updateArchiveSnippet={updateArchiveSnippet}
          updateArchiveSnippetTitle={updateArchiveSnippetTitle}
          onInsert={handleInsertArchive}
          onRestore={handleRestoreArchive}
          onDelete={handleDeleteArchive}
          anchoredIds={anchoredIds}
          onCapture={handleArchiveCapture}
        />
      );
    }

    if (panelId === "footnotes") {
      return (
        <FootnotesHost
          side={side}
          footnotes={footnotes}
          orphanedFootnotes={orphanedFootnotes}
          onEdit={handleEditFootnote}
          onEditTitle={handleEditFootnoteTitle}
          onDelete={handleDeleteFootnote}
          onAdd={handleAddFootnote}
          onDeleteOrphan={handleDeleteOrphan}
          onEditOrphan={handleEditOrphan}
          onEditOrphanTitle={handleEditOrphanTitle}
        />
      );
    }

    if (panelId === "citations") {
      return (
        <CitationsHost
          side={side}
          citations={citations}
          bibEntries={bibEntries}
          citationStyle={citationStyle}
          bibPackage={bibPackage}
          bibPath={bibPath}
          citationOrder={citationOrder}
          addCitation={addCitation}
          updateCitation={updateCitation}
          deleteCitation={deleteCitation}
          setCitationStyle={setCitationStyle}
          setBibPackage={setBibPackage}
          updateBibEntry={updateBibEntry}
          updateBibKeyAndType={updateBibKeyAndType}
          getFormattedBib={getFormattedBib}
          getAnnotation={getAnnotation}
          setAnnotation={setAnnotation}
          requestBibReview={requestBibReview}
          cancelBibReview={cancelBibReview}
          getBibReviewStatus={getBibReviewStatus}
          citationPositionMap={citationPositionMap}
          pendingCitationCreate={pendingCitationCreate}
          setPendingCitationCreate={setPendingCitationCreate}
          pendingCitationMode={pendingCitationMode}
          setPendingCitationMode={setPendingCitationMode}
        />
      );
    }

    if (panelId === "bibliography") {
      return (
        <BibliographyHost
          side={side}
          panelSide={bibliographyPanelSide}
          citations={citations}
          bibEntries={bibEntries}
          bibPackage={bibPackage}
          addBibEntry={addBibEntry}
          updateBibEntry={updateBibEntry}
          updateBibKeyAndType={updateBibKeyAndType}
          getFormattedBib={getFormattedBib}
          getAnnotation={getAnnotation}
          setAnnotation={setAnnotation}
          requestBibReview={requestBibReview}
          cancelBibReview={cancelBibReview}
          getBibReviewStatus={getBibReviewStatus}
          allEditorCitations={allEditorCitations}
          citationPositionMap={citationPositionMap}
          setBibActiveCitationId={setBibActiveCitationId}
          currentDocId={currentDocId}
          generalBibPath={generalBibPath}
          setGeneralBibPath={setGeneralBibPath}
          entryRequests={entryRequests}
          addEntryRequest={addEntryRequest}
          removeEntryRequest={removeEntryRequest}
        />
      );
    }

    if (panelId === "wordcount") {
      return <WordCountPanel counts={wordCounts} selection={wordSelection} focusCounts={focusWordCount} />;
    }

    if (panelId === "quotations") {
      return (
        <QuotationsHost
          side={side}
          quotationGroups={quotationGroups}
          bibEntries={bibEntries}
          bibPackage={bibPackage}
          citationStyle={citationStyle}
          addQuotationGroup={addQuotationGroup}
          deleteQuotationGroup={deleteQuotationGroup}
          updateQuotationGroupTitle={updateQuotationGroupTitle}
          addQuotationReference={addQuotationReference}
          deleteQuotationReference={deleteQuotationReference}
          updateQuotationReferenceCiteKey={updateQuotationReferenceCiteKey}
          addQuotationQuote={addQuotationQuote}
          updateQuotationQuote={updateQuotationQuote}
          deleteQuotationQuote={deleteQuotationQuote}
          updateQuotationNotes={updateQuotationNotes}
        />
      );
    }

    if (panelId === "examples") {
      const examplesPanelSide: "left" | "right" =
        prefs.placements.find((p) => p.id === "examples")?.side ?? "left";
      return (
        <ExamplesPanel
          examples={examples}
          selectedId={selectedExampleId}
          onSelect={setSelectedExampleId}
          onJump={(id, sourceEl) => editorRef.current?.scrollToExample(id, sourceEl)}
          editor={editorRef.current?.getEditor() ?? null}
          panelSide={examplesPanelSide}
          viewMode={getPanelViewMode("examples")}
          onViewModeChange={(m) => setPanelViewMode("examples", m)}
          onAdd={() => {
            const res = editorRef.current?.insertExample("single");
            if (res) setSelectedExampleId(res.exampleId);
          }}
        />
      );
    }

    if (panelId === "search") {
      return (
        <SearchHost
          footnotes={footnotes}
          orphanedFootnotes={orphanedFootnotes}
          notes={notes}
          citations={citations}
          allEditorCitations={allEditorCitations}
          todoItems={todoItems}
          archiveSnippets={archiveSnippets}
          cutterCards={cutterCards}
          quotationGroups={quotationGroups}
          comments={comments}
          bibEntries={bibEntries}
          openItemInPanel={openItemInPanel}
          searchState={searchState}
          setSearchState={setSearchState}
          setSearchHighlightRange={setSearchHighlightRange}
        />
      );
    }

    if (panelId === "errors") {
      return (
        <ErrorsHost
          errors={allLatexErrors}
          selectedId={selectedErrorId}
          onSelect={setSelectedErrorId}
          dismissedIds={dismissedErrorIds}
          onDismiss={dismissError}
          onJump={jumpToError}
          snippets={errorSnippets}
          paragraphByErrorId={paragraphByErrorId}
        />
      );
    }

    if (panelId === "omni") {
      return (
        <OmniHost
          side={side}
          footnotes={footnotes}
          orphanedFootnotes={orphanedFootnotes}
          handleEditFootnote={handleEditFootnote}
          handleDeleteFootnote={handleDeleteFootnote}
          handleEditFootnoteTitle={handleEditFootnoteTitle}
          handleEditOrphan={handleEditOrphan}
          handleDeleteOrphan={handleDeleteOrphan}
          handleEditOrphanTitle={handleEditOrphanTitle}
          citations={citations}
          citationPositionMap={citationPositionMap}
          bibEntries={bibEntries}
          bibPackage={bibPackage}
          updateCitation={updateCitation}
          getFormattedBib={getFormattedBib}
          updateBibEntry={updateBibEntry}
          updateBibKeyAndType={updateBibKeyAndType}
          getAnnotation={getAnnotation}
          setAnnotation={setAnnotation}
          requestBibReview={requestBibReview}
          cancelBibReview={cancelBibReview}
          getBibReviewStatus={getBibReviewStatus}
          quotationGroups={quotationGroups}
          deleteQuotationGroup={deleteQuotationGroup}
          updateQuotationGroupTitle={updateQuotationGroupTitle}
          addQuotationReference={addQuotationReference}
          deleteQuotationReference={deleteQuotationReference}
          updateQuotationReferenceCiteKey={updateQuotationReferenceCiteKey}
          addQuotationQuote={addQuotationQuote}
          updateQuotationQuote={updateQuotationQuote}
          deleteQuotationQuote={deleteQuotationQuote}
          updateQuotationNotes={updateQuotationNotes}
          notes={notes}
          updateNote={updateNote}
          updateNoteTitle={updateNoteTitle}
          deleteNote={deleteNote}
          sortedArchiveSnippets={sortedArchiveSnippets}
          anchoredIds={anchoredIds}
          updateArchiveSnippet={updateArchiveSnippet}
          updateArchiveSnippetTitle={updateArchiveSnippetTitle}
          handleDeleteArchive={handleDeleteArchive}
          todoItems={todoItems}
          toggleTodo={toggleTodo}
          updateTodo={updateTodo}
          updateTodoNotes={updateTodoNotes}
          setTodoAiRequest={setTodoAiRequest}
          deleteTodo={deleteTodo}
          examples={examples}
          getOmniEnabled={getOmniEnabled}
        />
      );
    }

    if (panelId === "cutter") {
      return (
        <CutterHost
          side={side}
          panelSide={cutterPanelSide}
          cards={cutterCards}
          updateCommentContent={updateCutterCommentContent}
          setCommentAiRequest={setCutterCommentAiRequest}
          updateSuggestionField={updateCutterSuggestionField}
          setSuggestionStatus={setCutterSuggestionStatus}
          deleteCard={deleteCutterCard}
          discardPristine={discardPristineCards}
          onHoverCard={handleHoverCut}
          onDropSelection={handleDropSelectionOnCutter}
          onDropParagraph={handleDropParagraphOnCutter}
        />
      );
    }

    return <PlaceholderPanel title={panelLabel(panelId)} hasViewToggle={false} />;
  }

  // Render a side's panel column, or null when the side is collapsed so
  // the editor runs flush to the icon strip (the editor column's flex
  // basis flips to grow in that case — see the main-area JSX below).
  //
  // Omni-view is mounted persistently inside every slot (`slot.omni`) so
  // closing a specific panel just drops its overlay and reveals the
  // already-live omni — no re-render flash.
  function renderPanelColumn(side: Side): React.ReactNode {
    const top = side === "left" ? activeLeft : activeRight;
    const bottom = side === "left" ? prefs.activeLeftBottom : prefs.activeRightBottom;
    const ratio = side === "left" ? prefs.splitLeftRatio : prefs.splitRightRatio;
    const focused = side === "left" ? focusedHalfLeft : focusedHalfRight;
    const setFocused = side === "left" ? setFocusedHalfLeft : setFocusedHalfRight;

    if (!top && !bottom) return null;

    const omniActive = top === "omni" || bottom === "omni";
    const toolbarOverlay = omniActive ? (
      <MarginActionToolbar
        side={side}
        actions={marginToolbarActions}
        placements={prefs.placements}
      />
    ) : undefined;

    // The omni layer is always mounted per slot. `renderPanelInner("omni",
    // side)` returns an <OmniHost /> element — two separate instances for
    // the top and bottom slots so they remain independent React subtrees.
    const slotOmni = () => renderPanelInner("omni", side);
    const slotOverlay = (active: PanelId | null | undefined, half?: "top" | "bottom"): React.ReactNode | null => {
      // When a half's active id is null (e.g. the top half is collapsed
      // in split mode), treat it as "blank" so the half still occludes
      // the always-mounted omni layer below, matching the pre-refactor
      // blank-placeholder behavior.
      const effective: PanelId = active ?? "blank";
      if (effective === "omni") return null;
      return renderPanelWithChrome(effective, side, half);
    };

    if (bottom != null) {
      // Split mode
      return (
        <PanelColumn
          side={side}
          panelPref={getPanelWidth(side, top ?? "blank")}
          onPanelPrefChange={(w) => setPanelWidth(side, top ?? "blank", w)}
          isResizing={isResizingPanels}
          onResizingChange={setIsResizingPanels}
          onSyncBeforeDrag={syncPanelPrefsToRendered}
          split
          focusedHalf={focused}
          onFocusHalf={setFocused}
          topPanelId={top ?? "blank"}
          bottomPanelId={bottom}
          topOverlay={toolbarOverlay}
        >
          {{
            top: { omni: slotOmni(), overlay: slotOverlay(top, "top") },
            bottom: { omni: slotOmni(), overlay: slotOverlay(bottom, "bottom") },
            ratio,
            onRatioChange: (r: number) => setSplitRatio(side, r),
          }}
        </PanelColumn>
      );
    }

    // Single mode. Omni-view renders chromeless — no pod background/border —
    // so its cards float directly on the blank canvas behind the panels.
    return (
      <PanelColumn
        side={side}
        panelPref={getPanelWidth(side, top ?? "blank")}
        onPanelPrefChange={(w) => setPanelWidth(side, top ?? "blank", w)}
        isResizing={isResizingPanels}
        onResizingChange={setIsResizingPanels}
        onSyncBeforeDrag={syncPanelPrefsToRendered}
        topPanelId={top ?? undefined}
        topOverlay={toolbarOverlay}
      >
        {{ omni: slotOmni(), overlay: slotOverlay(top) }}
      </PanelColumn>
    );
  }

  // Build strip icon list.
  // The Errors panel lives in the strip on both sides — its cards (with
  // jump-to, margin markers, etc.) are useful in the rich-text view too.
  const leftStripItems = leftItems.filter((p) => p.id !== "blank");
  const rightStripItems = rightItems.filter((p) => p.id !== "blank");

  if (!fsaSupported) {
    return <UnsupportedBrowserNotice />;
  }

  const poppedCardsValue = {
    poppedKeys: prefs.poppedOutCards,
    isPopped: (key: string) => prefs.poppedOutCards.includes(key),
    toggle: toggleCardPopout,
    toggleAtAnchor: (key: string, anchor: DOMRect | null) => {
      // Going docked → popped: seed a quadrant-aware spawn position so the
      // float appears near the docked card. Re-dock branch ignores anchor;
      // toggleCardPopout already wipes the saved position on re-dock.
      if (!prefsRef.current.poppedOutCards.includes(key)) {
        const pos = computeSpawnPosition(anchor, {
          width: POPUP_W,
          height: POPUP_H,
        });
        setCardFloatPosition(key, pos);
      }
      toggleCardPopout(key);
    },
    close: closeCardPopout,
    getFloatPosition: (key: string) => prefs.cardFloatPositions[key],
    setFloatPosition: setCardFloatPosition,
    recordFocus: (key: string) => focusFloating({ kind: "card", key }),
  };

  // Paragraph popout: click the gutter button in the editor to toggle a
  // floating paragraph card. Keyed as `paragraph:${uuid}` in poppedCards.
  // Anchor (when supplied) seeds a quadrant-aware spawn position so the
  // float appears near the gutter button it came from.
  const handleToggleParagraphPopout = (uuid: string, anchor?: DOMRect | null) => {
    const key = `paragraph:${uuid}`;
    if (!prefsRef.current.poppedOutCards.includes(key) && anchor) {
      const pos = computeSpawnPosition(anchor, { width: POPUP_W, height: POPUP_H });
      setCardFloatPosition(key, pos);
    }
    toggleCardPopout(key);
  };
  paragraphIsPoppedRef.current = (uuid: string) =>
    prefs.poppedOutCards.includes(`paragraph:${uuid}`);
  // Same for headings (chapters/sections/subsections etc.). Keyed as
  // `heading:${uuid}` in poppedCards.
  const handleToggleHeadingPopout = (uuid: string) => {
    toggleCardPopout(`heading:${uuid}`);
  };
  headingIsPoppedRef.current = (uuid: string) =>
    prefs.poppedOutCards.includes(`heading:${uuid}`);
  // Same for example blocks. Anchor seeds the spawn position so the
  // float appears near the gutter button. Keyed as `example:${uuid}` in
  // poppedCards — paired with the `case "example"` renderer in
  // floating-cards.tsx.
  const handleToggleExamplePopout = (uuid: string, anchor?: DOMRect | null) => {
    const key = `example:${uuid}`;
    if (!prefsRef.current.poppedOutCards.includes(key) && anchor) {
      const pos = computeSpawnPosition(anchor, { width: POPUP_W, height: POPUP_H });
      setCardFloatPosition(key, pos);
    }
    toggleCardPopout(key);
  };
  exampleIsPoppedRef.current = (uuid: string) =>
    prefs.poppedOutCards.includes(`example:${uuid}`);

  // Popped-out card rendering lives in ./editor-layout/floating-cards.tsx —
  // the deps bundle below is the contract for what a popped card needs.
  const poppedCardDeps = {
    notes, footnotes, archiveSnippets, cutterCards, todoItems, bibEntries,
    citations, citationPositionMap, allEditorCitations,
    comments,
    quotationGroups, aiRequests, anchoredIds, examples,
    selectedNoteId, selectedFootnoteId, selectedArchiveId, selectedCutterCardId,
    selectedTodoId, selectedBibKey, selectedCitationId, selectedCommentId,
    selectedQuotationGroupId, selectedExampleId,
    setSelectedNoteId, setSelectedFootnoteId, setSelectedArchiveId,
    setSelectedCutterCardId, setSelectedTodoId, setSelectedBibKey,
    setSelectedCitationId, setSelectedCommentId, setSelectedQuotationGroupId,
    setSelectedExampleId,
    editorRef,
    setOverrideEditor, getCitationDisplayText, handleCitationCreated,
    handleHoverNote, handleHoverCut, bibPackage,
    updateNote, updateNoteTitle, deleteNote,
    handleEditFootnote, handleDeleteFootnote, handleEditFootnoteTitle,
    updateArchiveSnippet, updateArchiveSnippetTitle, handleDeleteArchive,
    updateCutterCommentContent, setCutterCommentAiRequest,
    updateCutterSuggestionField, setCutterSuggestionStatus, deleteCutterCard,
    toggleTodo, updateTodo, updateTodoNotes, deleteTodo, setTodoAiRequest,
    getFormattedBib, getAnnotation, setAnnotation,
    requestBibReview, cancelBibReview, getBibReviewStatus,
    updateBibEntry, updateBibKeyAndType,
    updateCitation,
    updateCommentContent, setCommentAuthor, deleteComment,
    deleteQuotationGroup, updateQuotationGroupTitle,
    addQuotationReference, deleteQuotationReference, updateQuotationReferenceCiteKey,
    addQuotationQuote, updateQuotationQuote, deleteQuotationQuote, updateQuotationNotes,
    updateAiRequestText, deleteAiRequest,
  };

  return (
    <EditorLayoutProvider
      state={{ prefs, focusedHalfLeft, focusedHalfRight }}
      actions={{ togglePanel, movePanel, setActiveHalf }}
    >
    <EditorRefProvider value={{ editorInstance, editorRef, setOverrideEditor }}>
    <AiRequestsProvider value={{ aiRequests, addAiRequest, updateAiRequestText, deleteAiRequest }}>
    <CitationDisplayProvider value={{ getCitationDisplayText, onCitationCreated: handleCitationCreated }}>
    <PanelViewModeProvider value={{ getPanelViewMode, setPanelViewMode }}>
    <SelectionsProvider value={{
      selectedNoteId, setSelectedNoteId,
      selectedFootnoteId, setSelectedFootnoteId,
      selectedCitationId, setSelectedCitationId,
      selectedTodoId, setSelectedTodoId,
      selectedArchiveId, setSelectedArchiveId,
      selectedCutterCardId, setSelectedCutterCardId,
      selectedQuotationGroupId, setSelectedQuotationGroupId,
      selectedCommentId, setSelectedCommentId,
      selectedBibKey, setSelectedBibKey,
      selectedExampleId, setSelectedExampleId,
    }}>
    <PristineCardsProvider value={pristineManager}>
    <CardCreationProvider value={cardCreation}>
    <PoppedCardsContext.Provider value={poppedCardsValue}>
    <div className="flex flex-col h-screen bg-[var(--background)]">
      {/* Top bar: logo + tabs */}
      <div
        // Preference-mode: the VIRGIL top bar. topbarBackground is locked to
        // the PWA/browser theme-color (see globals.css merger notes), so
        // changing it updates both the in-app bar and the browser chrome.
        // min-height gives the docked MenuBar breathing room inside the
        // bar without pushing the tabs taller (tabs are items-end anchored
        // at the bottom edge, so the extra space accumulates above them).
        // In zen mode the bar collapses to 0 height with a transparent
        // background — the only visible chrome is the floating Zen toggle
        // (fixed top-3 right-3 z-50), which renders independent of its
        // parent's size.
        data-prefs="topbarBackground,topbarBackgroundBottom,virgilBarText"
        className={`virgil-bar flex items-center relative ${zenModeOn ? '' : 'min-h-[34px]'}`}
        style={{
          color: "var(--virgil-bar-text)",
          background: zenModeOn
            ? "transparent"
            : "linear-gradient(to bottom, var(--topbar-bg), var(--topbar-bg-bottom))",
          boxShadow: zenModeOn ? "none" : "inset 0 -2px 4px -1px rgba(0,0,0,0.10)",
        }}
      >
        {/* Logo + file buttons + tabs — all bottom-aligned. The MenuBar's
            "home" position clamps against the topbar-left sentinel at the
            end of this group (after the "Open folder" "+" button), so the
            toolbar never overlaps tabs even when they crowd the middle.
            Zen mode hides this whole group; the MenuBar is also gated off
            in zen, so dropping the sentinel is safe. The flex spacer below
            keeps the right-group buttons (incl. Zen toggle) right-aligned. */}
        {zenModeOn ? (
          <div className="flex-1" />
        ) : (
        <div className="flex items-end flex-1 min-w-0 overflow-clip gap-0.5 px-2 self-end" style={{ overflowClipMargin: '0px 0px 1px 0px' }}>
          {/* VIRGIL logo as first "tab-like" item */}
          <div className="flex items-center gap-1.5 px-3 pt-1 pb-1 shrink-0">
            <h1
              className="text-base font-semibold tracking-widest"
              style={{ fontFamily: "var(--font-logo), Cinzel, serif" }}
            >
              VIRGIL
            </h1>
          </div>
          {openTabs.map((doc) => {
            const isCurrentDoc = doc.id === currentDocId;
            const isDocPaneActive = isCurrentDoc && activePane === "doc";
            return (
              <div key={doc.id} className="flex items-end shrink-0" style={{ filter: "var(--shadow-ambient-filter)" }}>
                {/* Doc tab */}
                <div
                  data-prefs={isDocPaneActive ? "backgroundColor,topbarBorder" : "tabBg,topbarBorder"}
                  className={`group flex items-center gap-1.5 pl-3.5 pr-2 pt-[1px] pb-0 text-sm cursor-default shrink-0 transition-all rounded-t-[10px] relative z-[1] ${
                    isDocPaneActive
                      ? "browser-tab-swoop bg-[var(--main-tab-bg)] text-ink-strong -mb-px z-10 border-t border-l border-r border-[var(--topbar-border,#d5d3ce)]"
                      : "bg-[var(--tab-bg)] text-ink-subtle border border-[var(--topbar-border,#d5d3ce)] hover:brightness-[0.97] hover:text-ink-body"
                  }`}
                  onClick={() => {
                    if (!isDocPaneActive) activateDocPane(doc.id);
                  }}
                >
                  <div className="flex flex-col min-w-0">
                    <span className="text-[13px] leading-4 truncate" title={doc.folderName}>
                      {doc.folderName}
                    </span>
                    <span className="text-[10px] leading-[13px] text-ink-muted truncate" title={doc.texFilename}>
                      {doc.texFilename}
                    </span>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); closeTab(doc.id); }}
                    className="topbarbtn topbarbtn-icon"
                    title="Close tab"
                  >
                    <IconX />
                  </button>
                </div>
                {/* Library shadow tab suppressed for now. */}
              </div>
            );
          })}
          <button
            onClick={handleNativeOpen}
            className="topbarbtn topbarbtn-icon self-center"
            title="Open folder"
          >
            <IconPlus />
          </button>
          {/* Zero-width sentinel marking the end of the top-bar's left
              content (tabs + logo + "+" button). The floating MenuBar's
              home position uses this x-coordinate as its left clamp —
              measuring the flex-1 parent's right edge would be wrong
              because flex-1 expands to fill the whole middle gap. */}
          <div ref={topbarLeftRefCb} aria-hidden className="shrink-0 self-stretch" style={{ width: 0 }} />
        </div>
        )}

        <div ref={topbarRightRefCb} className="shrink-0 flex items-center px-2">
          {!zenModeOn && focusMode.state.active && (
            <button
              onClick={focusMode.deactivate}
              className="topbarbtn"
              aria-pressed="true"
              title="Exit focus view"
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="8" cy="8" r="2.25" />
                <path d="M8 2.5v1.5M8 12v1.5M2.5 8H4M12 8h1.5" />
              </svg>
              Focus view
            </button>
          )}
          {/* ── Zen mode toggle ────────────────────────────────────────
              Render-gates editor chrome (icon strips, panel columns,
              floating MenuBar, marginalia, popped-out panels/cards) so
              the document area stands alone. Top bar stays visible so
              this button is always reachable. State is render-only —
              layout prefs are untouched, so toggling off restores the
              exact prior layout. */}
          <button
            onClick={handleToggleZen}
            className={zenModeOn ? "topbarbtn fixed top-3 right-3 z-50" : "topbarbtn"}
            title={zenModeOn ? "Zen mode: on" : "Zen mode: off"}
            aria-pressed={zenModeOn}
          >
            Zen
          </button>
          {!zenModeOn && (<>
          {/* ── Preference Mode toggle ─────────────────────────────────
              Flips the global preference-mode state. When on, every DOM
              element with `data-prefs="<pref-key>"` becomes ctrl+clickable
              and opens a picker showing just those preference entries.

              Related files (keep in sync):
                - src/hooks/usePreferenceMode.ts   — state + architecture guide
                - src/components/PreferenceModePicker.tsx — picker + ctrl+click listener
                - src/app/globals.css "Preference mode" — hover outline rule

              The active-state styling matches the AI-requests button
              directly below: accent text/bg when on, subtle ink-subtle
              when off. Keep them visually parallel if you restyle either.

              To move / restyle this button without changing its behaviour,
              edit this JSX only. Don't hardcode the on/off logic anywhere
              else — always drive it through usePreferenceMode(). */}
          <button
            onClick={() => setPreferencesOpen(true)}
            className="topbarbtn topbarbtn-icon"
            title="Preferences"
          >
            {/* Painter's palette icon — solid silhouette with the classic
                thumb-hole cutout on the right and four color wells punched
                through via fill-rule="evenodd". */}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c1.1 0 2-.9 2-2 0-.52-.2-.97-.54-1.32-.34-.36-.54-.82-.54-1.33 0-1.1.9-2 2-2h2.35C19.93 15.35 22 13.24 22 10.65 22 5.88 17.52 2 12 2zM6.5 12a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" />
            </svg>
          </button>
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setVersionOpen((v) => !v); }}
              className="topbarbtn topbarbtn-icon"
              title={`Virgil v${APP_VERSION}`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </button>
            {versionOpen && (
              <div
                className="absolute right-0 top-full mt-1 z-20 bg-surface border border-edge-subtle rounded shadow-md text-xs text-ink-body whitespace-nowrap text-left min-w-[160px]"
                onClick={(e) => e.stopPropagation()}
                onMouseLeave={() => setCommandsPopoutOpen(false)}
              >
                <div className="px-3 py-2">
                  <div className="font-medium text-ink-body mb-0.5">Version</div>
                  <div>Virgil v{APP_VERSION}</div>
                </div>
                <div className="border-t border-edge-subtle" />
                <div
                  className="relative flex items-center justify-between px-3 py-2 cursor-default hover-on-light"
                  onMouseEnter={() => setCommandsPopoutOpen(true)}
                >
                  <span className="font-medium text-ink-body">Commands</span>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-muted">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                  {commandsPopoutOpen && (
                    <div
                      className="absolute right-full top-0 mr-1 bg-surface border border-edge-subtle rounded shadow-md text-xs text-ink-body py-1 min-w-[160px]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {VIRGIL_COMMAND_NAMES.map((name) => (
                        <button
                          key={name}
                          onClick={() => insertVirgilCommand(name)}
                          className="block w-full text-left px-3 py-1 font-mono text-ink-body hover-on-light"
                        >
                          {`\\${name}`}
                        </button>
                      ))}
                      <div className="border-t border-edge-subtle mt-1 pt-1.5 pb-1 px-3 text-[10px] text-ink-muted flex items-center gap-1">
                        <span>Type text +</span>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="9 10 4 15 9 20" />
                          <path d="M20 4v7a4 4 0 0 1-4 4H4" />
                        </svg>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          {/* AI request — sun-star: eight equal-length rays meeting
              at the center. Cardinal lines span 20 units (2→22);
              diagonals span ~20 units using 12 ± 7.07 ≈ 4.93/19.07. */}
          <button
            onClick={() => setAiWindowOpen(true)}
            className="topbarbtn topbarbtn-icon relative"
            aria-pressed={aiWindowOpen}
            title="AI requests"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <g transform="rotate(15 12 12)">
                {/* Cardinals */}
                <line x1="12" y1="2" x2="12" y2="22" />
                <line x1="2" y1="12" x2="22" y2="12" />
                {/* Diagonals (length 10 each half = matches cardinals) */}
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                <line x1="19.07" y1="4.93" x2="4.93" y2="19.07" />
              </g>
            </svg>
            {aiDot && (
              <span
                className="absolute top-0 right-0 w-1.5 h-1.5 rounded-full"
                style={{
                  backgroundColor:
                    aiDot === "red" ? "#ef4444"
                    : aiDot === "green" ? "#22c55e"
                    : "#eab308",
                }}
              />
            )}
          </button>
          {/* ── Document style dropdown ────────────────────────────────
              Per-doc preamble preset selector. Switching style rewrites
              the bytes before \begin{document} in the active doc's .tex
              file (see useDocumentStyle). Sits just left of Code/Compile
              so it reads as part of the doc-action cluster. */}
          <DocStyleDropdown docId={currentDocId} />
          <button
            onClick={codeView ? switchToVisualView : switchToCodeView}
            className="topbarbtn ml-1"
            title={codeView ? "Visual Editor" : "Code Editor"}
          >
            {codeView ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                Visual
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="16 18 22 12 16 6" />
                  <polyline points="8 6 2 12 8 18" />
                  <line x1="14.5" y1="4" x2="9.5" y2="20" />
                </svg>
                Code
              </>
            )}
          </button>
          {/* Compile — runs SwiftLaTeX's pdfTeX over the paper folder and
              opens the resulting PDF in a new window. Disabled while a
              compile is in flight; spinner replaces the play-triangle. */}
          <button
            onClick={compilePdf}
            disabled={!currentDocId || isCompiling}
            className="topbarbtn ml-1"
            title={isCompiling ? "Compiling…" : "Compile to PDF"}
          >
            {isCompiling ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <polygon points="6 4 20 12 6 20 6 4" />
              </svg>
            )}
            Compile
          </button>
          </>)}
        </div>
      </div>

      {/* Per-doc permission gate. When the active doc's folder handle
          needs a fresh readwrite grant, we replace everything below the
          tab strip with the gate so the user clicks once and the editor
          mounts. The tabs themselves stay visible so the user can still
          switch papers. */}
      {currentDoc && docPermState === "needs-grant" && activeDocHandle && (
        <DocPermissionGate
          docName={currentDoc.name}
          handle={activeDocHandle}
          onGranted={handleDocPermissionGranted}
        />
      )}

      {/* Path bar removed — podification */}

      {/* Main area */}
      {currentDoc && docPermState !== "granted" ? null : activePane === "library" && currentDocId ? (
        <div className="flex flex-1 overflow-hidden">
          <LibraryTabView />
        </div>
      ) : codeView && currentDocId ? (
        <div className="flex flex-1 overflow-hidden">
          <CodeEditor
            docId={currentDocId!}
            initialLine={codeViewLine}
            initialParagraphId={codeViewParagraphId}
            onReady={(handle) => { codeEditorHandleRef.current = handle; }}
            onTextChange={setCodeEditorText}
            compileLog={compileLog}
            compileStatus={compileStatus}
            isCompiling={isCompiling}
          />
          {errorsSidebarOpen ? (
            <div className="w-[260px] shrink-0 border-l border-edge-subtle bg-surface flex flex-col h-full relative">
              <button
                type="button"
                onClick={() => setErrorsSidebarOpen(false)}
                className="absolute top-2 right-2 z-10 w-5 h-5 flex items-center justify-center rounded text-ink-muted hover:text-ink-body hover-on-light text-sm leading-none"
                title="Hide errors panel"
                aria-label="Hide errors panel"
              >
                ×
              </button>
              <ErrorsHost
                errors={allLatexErrors}
                selectedId={selectedErrorId}
                onSelect={setSelectedErrorId}
                dismissedIds={dismissedErrorIds}
                onDismiss={dismissError}
                onJump={jumpToError}
                snippets={errorSnippets}
                paragraphByErrorId={paragraphByErrorId}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setErrorsSidebarOpen(true)}
              className="w-7 shrink-0 border-l border-edge-subtle bg-surface flex items-start justify-center pt-3 hover-on-light relative text-ink-muted hover:text-ink-body"
              title={`Show errors (${allLatexErrors.length})`}
              aria-label="Show errors panel"
            >
              <IconErrors active={false} />
              {allLatexErrors.length > 0 && (
                <span
                  className="absolute top-1 right-1 min-w-[14px] h-[14px] px-1 rounded-full text-[9px] leading-[14px] tabular-nums text-white text-center"
                  style={{ backgroundColor: "var(--danger)" }}
                >
                  {allLatexErrors.length > 99 ? "99+" : allLatexErrors.length}
                </span>
              )}
            </button>
          )}
        </div>
      ) : (
      <div ref={mainAreaRefCb} className="flex flex-1 overflow-x-auto overflow-y-hidden relative" style={{ ['--page-preferred' as string]: `${prefs.pageWidth}px` }}>
        {/* ── Linking lines suppressed (may re-enable later) ──
        {archivePanelSide && selectedArchiveId && anchoredIds.has(selectedArchiveId) && (
          <ArchiveConnectors
            editor={editorInstance}
            selectedId={selectedArchiveId}
            panelSide={archivePanelSide}
            mainRef={mainAreaRef}
          />
        )}
        {footnotePanelSide && selectedFootnoteId && (
          <LinkConnector
            editor={editorInstance}
            linkId={selectedFootnoteId}
            linkKind="footnote"
            targetCard={{ kind: "footnote", id: selectedFootnoteId }}
            panelSide={footnotePanelSide}
            mainRef={mainAreaRef}
            docVersion={latestDoc}
          />
        )}
        {citationPanelSide && selectedCitationId && (
          <LinkConnector
            editor={editorInstance}
            linkId={selectedCitationId}
            linkKind="citation"
            targetCard={{ kind: "citation", id: selectedCitationId }}
            panelSide={citationPanelSide}
            mainRef={mainAreaRef}
          />
        )}
        {citationPanelSide && getPanelViewMode("citations") === "in-text" && selectedCitationId && (
          <LinkConnector
            editor={editorInstance}
            linkId={selectedCitationId}
            linkKind="citation"
            targetCard={{ kind: "citation", id: selectedCitationId }}
            panelSide={citationPanelSide}
            mainRef={mainAreaRef}
            variant="in-text"
          />
        )}
        {bibliographyPanelSide && bibActiveCitationId && selectedBibKey && (
          <LinkConnector
            editor={editorInstance}
            linkId={bibActiveCitationId}
            linkKind="citation"
            targetCard={{ kind: "citation", id: bibActiveCitationId }}
            panelSide={bibliographyPanelSide}
            mainRef={mainAreaRef}
            panelEntrySelector={`[data-bib-entry="${selectedBibKey}"]`}
          />
        )}
        ── end suppressed linking lines ── */}


        {/* Left icon strip — hidden in Zen mode */}
        {!zenModeOn && (
        <div data-strip-side="left" data-prefs="backgroundColor" className="flex flex-col items-center pt-2 pb-3 px-1.5 bg-[var(--background)] shrink-0 gap-1.5">
          {/* Presentation-tools pod: collapse/expand, blank, split — grouped as view controls */}
          <div className="flex flex-col items-center gap-0.5 p-1 rounded-md bg-surface/70 border border-edge-hover">
            {/* Sidebar toggle — panel-left icon indicates the left sidebar */}
            <button
              onClick={() => { activeLeft ? collapseLeft() : expandLeft(); }}
              className="iconbtn-md iconbtn-toggle"
              aria-pressed={!!activeLeft}
              title={activeLeft ? "Collapse panel" : "Expand panel"}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="4" width="16" height="16" rx="1.5" />
                {activeLeft && <rect x="4" y="4" width="5" height="16" fill="currentColor" opacity="0.25" stroke="none" />}
                <line x1="9" y1="4" x2="9" y2="20" />
              </svg>
            </button>
            {/* Blank — suppresses the default omni-view on this side. Auto-clears
                when a strip panel is opened or a new card is created. */}
            <button
              onClick={() => { activeLeft === "blank" ? setActiveLeft("omni") : setBlank("left"); }}
              className="iconbtn-md iconbtn-toggle"
              aria-pressed={activeLeft === "blank"}
              title={activeLeft === "blank" ? "Show omni-view" : "Hide omni-view"}
            >
              <IconBlank active={activeLeft === "blank"} />
            </button>
            {/* Split panel toggle — shaded half reflects which pane is focused */}
            <button
              onClick={() => toggleSplit("left")}
              className="iconbtn-md iconbtn-toggle"
              aria-pressed={prefs.activeLeftBottom != null}
              title={prefs.activeLeftBottom != null ? "Unsplit panel" : "Split panel horizontally"}
            >
              <IconSplit
                active={prefs.activeLeftBottom != null}
                focusedHalf={prefs.activeLeftBottom != null ? focusedHalfLeft : undefined}
              />
            </button>
          </div>
          {leftStripItems.map((p) => (
            <StripButton
              key={p.id}
              panelId={p.id}
              active={activeLeft === p.id || prefs.activeLeftBottom === p.id}
              onClick={() => handleStripClick(p.id, "left")}
              onMove={handleMove}
              side="left"
              badge={p.id === "revisions" && activeRevisionsCount > 0}
              stripRef={null as any}
              iconDropMimes={iconDropMimesByPanel[p.id]}
              onIconDrop={(dt) => handleIconDrop(p.id, dt)}
            />
          ))}
          <div className="mt-auto">
            <OmniFilterMenu
              side="left"
              enabled={getOmniEnabled("left")}
              onToggle={(cat) => toggleOmniCategory("left", cat)}
              onSelectDefault={() => setOmniSideToDefault("left")}
              categorySides={categorySides}
              defaultCategories={DEFAULT_OMNI_CATEGORIES.left}
            />
          </div>
        </div>
        )}

        {/* Left panel column. In Zen mode this position becomes an empty
            adjustable margin; when the side is collapsed the column is
            simply absent so the editor runs flush to the icon strip. */}
        {zenModeOn ? (
          <ZenMargin side="left" marginPref={zenLeftMargin} onMarginPrefChange={setZenLeftMargin} isResizing={isResizingPanels} onResizingChange={setIsResizingPanels} onSyncBeforeDrag={syncPanelPrefsToRendered} />
        ) : (
          renderPanelColumn("left")
        )}

        {/* Editor column. Flex behavior flips on panel collapse state:
            both open → fixed at --page-preferred (panels absorb leftover);
            one collapsed → grows from --page-preferred up to --page-max
            (the open panel absorbs past-max leftover);
            both collapsed → grows uncapped so the right strip stays
            flush to the window edge. */}
        <div ref={editorColRefCb} data-editor-col="true" className={`flex flex-col min-h-0 overflow-x-hidden relative${showParTitles ? "" : " hide-par-titles"}${showLatexComments ? "" : " hide-latex-comments"}${dividerClassName ? " " + dividerClassName : ""} dividers-width-${dividerWidth}`} style={{
          // Grow 1000 vs panel grow 1 → window-upsize feeds the text
          // area almost entirely until it hits page-max, then panels
          // absorb the leftover. Shrink 1 vs panel shrink 100 → window-
          // downsize pulls from panels first, then the text area shrinks
          // toward its 400 min. Basis is dynamic (state): it captures
          // the intended editor width given current panel prefs, so
          // window-resize flex-shrink math yields "panels first" until
          // they hit their min, only then does the editor give way.
          flex: `1000 1 ${editorBasis}px`,
          minWidth: 400,
          maxWidth: (activeLeft != null || activeRight != null) ? 'var(--page-max)' : undefined,
          // 8px target icon-top minus 4px MenuBar button padding so the
          // SVG glyphs (not the hover-button outlines) sit 8px below the
          // column edge — matches the strip pod's icon top.
          paddingTop: 4,
          // In zen mode, match the top chrome (4 px column padding +
          // 4 px drag gap = 8 px) at the bottom too — so the lowest
          // possible point of the page lines up symmetrically with
          // its highest possible point.
          paddingBottom: zenModeOn ? 4 : 'var(--pod-gap)',
          paddingLeft: 4,
          paddingRight: 4,
        }}>
          {menuPortalReady && detachedActions.map(tb => createPortal(
            <div
              key={tb.id}
              data-actions-id={tb.id}
              className="fixed z-[9999] pointer-events-auto"
              style={{ left: tb.pos.left, top: tb.pos.top }}
              onMouseDownCapture={() => focusFloating({ kind: "toolbar", bucket: "actions", id: tb.id })}
            >
              <DetachedActionsToolbar
                actions={{
                  onAddComment: handleToolbarAddComment,
                  onAddNote: handleToolbarAddNote,
                  onAddTodo: handleToolbarAddTodo,
                  onCutSelection: handleToolbarAddCut,
                  onArchive: handleToolbarArchive,
                  onCreateFootnote: handleToolbarCreateFootnote,
                  onInsertCitation: handleToolbarInsertCitation,
                  onQuoteSelection: handleToolbarQuoteSelection,
                }}
                onGrabStart={(e) => {
                  e.preventDefault();
                  beginToolbarDrag({
                    clientX: e.clientX, clientY: e.clientY,
                    podLeft: tb.pos.left, podTop: tb.pos.top,
                    getWrapper: () => document.querySelector<HTMLElement>(`[data-actions-id="${tb.id}"]`),
                    onUpdatePos: (pos) => setDetachedActions(prev => prev.map(x => x.id === tb.id ? { ...x, pos } : x)),
                  });
                }}
                onReattach={() => setDetachedActions(prev => prev.filter(x => x.id !== tb.id))}
                pos={tb.pos}
                onSetPos={(pos) => setDetachedActions(prev => prev.map(x => x.id === tb.id ? { ...x, pos } : x))}
              />
            </div>,
            document.body,
          ))}
          {menuPortalReady && (overrideEditor ?? editorInstance) && detachedFormatting.map(tb => createPortal(
            <div
              key={tb.id}
              data-formatting-id={tb.id}
              className="fixed z-[9999] pointer-events-auto"
              style={{ left: tb.pos.left, top: tb.pos.top }}
              onMouseDownCapture={() => focusFloating({ kind: "toolbar", bucket: "formatting", id: tb.id })}
            >
              <DetachedFormattingToolbar
                editor={(overrideEditor ?? editorInstance)!}
                onGrabStart={(e) => {
                  e.preventDefault();
                  beginToolbarDrag({
                    clientX: e.clientX, clientY: e.clientY,
                    podLeft: tb.pos.left, podTop: tb.pos.top,
                    getWrapper: () => document.querySelector<HTMLElement>(`[data-formatting-id="${tb.id}"]`),
                    onUpdatePos: (pos) => setDetachedFormatting(prev => prev.map(x => x.id === tb.id ? { ...x, pos } : x)),
                  });
                }}
                onReattach={() => setDetachedFormatting(prev => prev.filter(x => x.id !== tb.id))}
                pos={tb.pos}
                onSetPos={(pos) => setDetachedFormatting(prev => prev.map(x => x.id === tb.id ? { ...x, pos } : x))}
              />
            </div>,
            document.body,
          ))}
          {menuPortalReady && (overrideEditor ?? editorInstance) && detachedMenus.map(tb => createPortal(
            <div
              key={tb.id}
              data-menu-id={tb.id}
              className="fixed z-[9999] pointer-events-auto"
              style={{ left: tb.pos.left, top: tb.pos.top }}
              onMouseDownCapture={() => focusFloating({ kind: "toolbar", bucket: "menus", id: tb.id })}
            >
              <DetachedMenuToolbar
                menuProps={{
                  editor: (overrideEditor ?? editorInstance)!,
                  onAddComment: handleToolbarAddComment,
                  onArchive: handleToolbarArchive,
                  onCreateFootnote: handleToolbarCreateFootnote,
                  onQuoteSelection: handleToolbarQuoteSelection,
                  onAddNote: handleToolbarAddNote,
                  onAddTodo: handleToolbarAddTodo,
                  onCutSelection: handleToolbarAddCut,
                  onInsertCitation: handleToolbarInsertCitation,
                  showParTitles,
                  onToggleParTitles: () => setShowParTitles((p) => !p),
                  showLatexComments,
                  onToggleLatexComments: () => setShowLatexComments((p) => !p),
                  showSectionIndicator,
                  onToggleSectionIndicator: toggleSectionIndicator,
                  onOpenPreferences: () => setPreferencesOpen(true),
                  editorSplit,
                  onToggleEditorSplit: () => setEditorSplit((s) => !s),
                  activeSplitPane: editorSplit ? activeSplitPane : undefined,
                  showMarginalia,
                  onToggleMarginalia: toggleMarginalia,
                  hiddenMarginaliaTypes,
                  onToggleMarginaliaType: toggleMarginaliaType,
                  showHighlights: prefs.showHighlights,
                  onToggleHighlights: () => setShowHighlights((v) => !v),
                  hiddenHighlightTypes,
                  onToggleHighlightType: toggleHighlightType,
                  availableDividerLevels,
                  dividerLevels: activeDividerLevels,
                  onToggleDividerLevel: toggleDividerLevel,
                  dividerWidth,
                  onSetDividerWidth: setDividerWidth,
                  onParaNavBack: paraNavBack,
                  onParaNavForward: paraNavForward,
                  paraNavBackDisabled: paraHistoryRef.current.idx <= 0,
                  paraNavForwardDisabled: paraHistoryRef.current.idx >= paraHistoryRef.current.stack.length - 1,
                  onCloseAllPanels: closeAllPanels,
                  onActionsDetach: handleActionsDetach,
                  onFormatDetach: handleFormatDetach,
                }}
                onGrabStart={(e) => {
                  e.preventDefault();
                  beginToolbarDrag({
                    clientX: e.clientX, clientY: e.clientY,
                    podLeft: tb.pos.left, podTop: tb.pos.top,
                    getWrapper: () => document.querySelector<HTMLElement>(`[data-menu-id="${tb.id}"]`),
                    onUpdatePos: (pos) => setDetachedMenus(prev => prev.map(x => x.id === tb.id ? { ...x, pos } : x)),
                  });
                }}
                onReattach={() => setDetachedMenus(prev => prev.filter(x => x.id !== tb.id))}
                pos={tb.pos}
                onSetPos={(pos) => setDetachedMenus(prev => prev.map(x => x.id === tb.id ? { ...x, pos } : x))}
              />
            </div>,
            document.body,
          ))}
          {/* Docked MenuBar — sits at the very top of the editor
              column, centered over the text window so it tracks the
              column as panels open and close. Hidden in zen mode so
              the page can extend to the top of the window. */}
          {!zenModeOn && (overrideEditor ?? editorInstance) && (
            <div className="flex justify-center shrink-0">
              <MenuBar
                editor={overrideEditor ?? editorInstance}
                onAddComment={handleToolbarAddComment}
                onArchive={handleToolbarArchive}
                onCreateFootnote={handleToolbarCreateFootnote}
                onQuoteSelection={handleToolbarQuoteSelection}
                onAddNote={handleToolbarAddNote}
                onAddTodo={handleToolbarAddTodo}
                onCutSelection={handleToolbarAddCut}
                onInsertCitation={handleToolbarInsertCitation}
                showParTitles={showParTitles}
                onToggleParTitles={() => setShowParTitles((p) => !p)}
                showLatexComments={showLatexComments}
                onToggleLatexComments={() => setShowLatexComments((p) => !p)}
                showSectionIndicator={showSectionIndicator}
                onToggleSectionIndicator={toggleSectionIndicator}
                onOpenPreferences={() => setPreferencesOpen(true)}
                editorSplit={editorSplit}
                onToggleEditorSplit={() => setEditorSplit((s) => !s)}
                activeSplitPane={editorSplit ? activeSplitPane : undefined}
                showMarginalia={showMarginalia}
                onToggleMarginalia={toggleMarginalia}
                hiddenMarginaliaTypes={hiddenMarginaliaTypes}
                onToggleMarginaliaType={toggleMarginaliaType}
                showHighlights={prefs.showHighlights}
                onToggleHighlights={() => setShowHighlights((v) => !v)}
                hiddenHighlightTypes={hiddenHighlightTypes}
                onToggleHighlightType={toggleHighlightType}
                availableDividerLevels={availableDividerLevels}
                dividerLevels={activeDividerLevels}
                onToggleDividerLevel={toggleDividerLevel}
                dividerWidth={dividerWidth}
                onSetDividerWidth={setDividerWidth}
                onParaNavBack={paraNavBack}
                onParaNavForward={paraNavForward}
                paraNavBackDisabled={paraHistoryRef.current.idx <= 0}
                paraNavForwardDisabled={paraHistoryRef.current.idx >= paraHistoryRef.current.stack.length - 1}
                onCloseAllPanels={closeAllPanels}
                orientation="horizontal"
                onSetOrientation={() => {}}
                onActionsDetach={handleActionsDetach}
                onFormatDetach={handleFormatDetach}
                atHome
              />
            </div>
          )}
          {/* Top gutter — flex-shrink 100 so window-downsize eats it first
              before touching the page height. In zen mode the gutter has
              its own pref (zenTopGutter, default 0) so the page extends
              to the top of the window by default while still being
              draggable down by hand. */}
          <div
            data-flex-row="top"
            style={{
              flex: isResizingGutters
                ? `0 0 ${zenModeOn ? zenTopGutter : topGutterPref}px`
                : `1 100 ${zenModeOn ? zenTopGutter : topGutterPref}px`,
              minHeight: 0,
            }}
          />
          {/* Top drag gap — grab bar above the page. Tightened to 4px
              so the icon row above ends 8px above the pod (4px button
              bottom-padding + 4px gap), matching the strip pod's
              vertical rhythm. */}
          <div
            data-gutter-gap="top"
            ref={topGutterDrag.gapRef}
            className="drag-gap drag-gap-h shrink-0"
            style={{ height: 4 }}
            onMouseDown={onTopGutterDown}
          />
          {/* Page wrapper — holds the pref page height; panels/omni are
              unaffected. Flex-grow 1000 so window-upsize feeds the page
              first, shrink 1 so panels absorb window-downsize first. */}
          <div
            data-editor-page="true"
            className="flex flex-col min-h-0 relative"
            style={{
              flex: `1000 1 ${pageHeightBasis}px`,
              minHeight: 400,
            }}
          >
          {currentDocId && content && !docLoading ? (
            editorSplit ? (
              /* When split, each pane is its own pod so the gap reveals the canvas */
              <SplitEditorPanes
                editorInstance={editorInstance}
                ratio={editorSplitRatio}
                onRatioChange={setEditorSplitRatio}
                onClose={() => setEditorSplit(false)}
                onMirrorFocus={() => setActiveSplitPane("bottom")}
                onMirrorViewReady={(v) => { mirrorViewRef.current = v; setMirrorViewGen((n) => n + 1); }}
                sectionPath={currentSectionPath}
                mirrorSectionPath={mirrorSectionPath}
                showSectionIndicator={showSectionIndicator}
                canonical={
                  <>
                    <VirgilEditor
                      ref={editorRef}
                      initialContent={content}
                      onUpdate={handleUpdate}
                      highlightText={highlightText}
                      highlightRange={effectiveHighlightRange}
                      onAddComment={handleAddComment}
                      onArchive={handleArchive}
                      onEditorReady={setEditorInstance}
                      onCitationDrop={handleCitationDrop}
                      onConfirmFootnoteMove={confirmFootnoteMove}
                      onConfirmLabelRename={confirmLabelRename}
                      isLabelTaken={checkLabelTaken}
                      anchoredUuidsRef={anchoredUuidsRef}
                      activeAnchorId={effectiveAnchorId}
                      activeAnchorColor={effectiveAnchorColor}
                      onToggleParagraphPopout={handleToggleParagraphPopout}
                      paragraphIsPoppedRef={paragraphIsPoppedRef}
                      onToggleHeadingPopout={handleToggleHeadingPopout}
                      headingIsPoppedRef={headingIsPoppedRef}
                      onToggleExamplePopout={handleToggleExamplePopout}
                      exampleIsPoppedRef={exampleIsPoppedRef}
                    />
                    {!zenModeOn && (
                      <Marginalia
                        editor={editorInstance}
                        markers={visibleMarginaliaMarkers}
                        panelSides={marginaliaPanelSides}
                      />
                    )}
                  </>
                }
              />
            ) : (
              /* Single editor — one white pod.
                 Preference-mode: the pod uses --pod-editor which is locked
                 to --surface (see globals.css), and the text inside uses
                 editor typography tokens. Annotating the pod means any
                 ctrl+click on the "paper" area — including body text that
                 doesn't set its own data-prefs — surfaces these controls. */
              <div
                data-prefs="surfaceColor,editorTextColor,editorFontSize,editorLineHeight"
                className="flex-1 flex flex-col min-h-0 overflow-hidden relative" style={{ background: 'var(--pod-editor)', borderRadius: 'var(--pod-radius)', border: 'var(--pod-border)', boxShadow: 'var(--pod-shadow)' }}>
                <VirgilEditor
                  ref={editorRef}
                  initialContent={content}
                  onUpdate={handleUpdate}
                  highlightText={highlightText}
                  highlightRange={effectiveHighlightRange}
                  onAddComment={handleAddComment}
                  onArchive={handleArchive}
                  onEditorReady={setEditorInstance}
                  onCitationDrop={handleCitationDrop}
                  onConfirmFootnoteMove={confirmFootnoteMove}
                  onConfirmLabelRename={confirmLabelRename}
                  isLabelTaken={checkLabelTaken}
                  activeAnchorId={effectiveAnchorId}
                  activeAnchorColor={effectiveAnchorColor}
                  onToggleParagraphPopout={handleToggleParagraphPopout}
                  paragraphIsPoppedRef={paragraphIsPoppedRef}
                  onToggleHeadingPopout={handleToggleHeadingPopout}
                  headingIsPoppedRef={headingIsPoppedRef}
                  onToggleExamplePopout={handleToggleExamplePopout}
                  exampleIsPoppedRef={exampleIsPoppedRef}
                />
                {!zenModeOn && (
                  <div className="group absolute top-0 left-0 right-0 h-6 z-20">
                    <div className="absolute top-2 left-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150">
                      <button
                        onClick={() => editorRef.current?.expandAllSections()}
                        className="text-[var(--muted)] hover:text-ink-body transition-colors"
                        title="Expand all sections"
                      >
                        <svg width="11" height="8" viewBox="0 0 14 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M2 1 L7 4.5 L12 1" />
                          <path d="M2 5.5 L7 9 L12 5.5" />
                        </svg>
                      </button>
                      <button
                        onClick={() => editorRef.current?.collapseAllSections()}
                        className="text-[var(--muted)] hover:text-ink-body transition-colors"
                        title="Collapse all sections"
                      >
                        <svg width="11" height="8" viewBox="0 0 14 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M2 4.5 L7 1 L12 4.5" />
                          <path d="M2 9 L7 5.5 L12 9" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
                {!zenModeOn && (
                  <Marginalia
                    editor={editorInstance}
                    markers={visibleMarginaliaMarkers}
                    panelSides={marginaliaPanelSides}
                  />
                )}
                {!zenModeOn && showSectionIndicator && <SectionLozenge sectionPath={currentSectionPath} />}
              </div>
            )
          ) : (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden" style={{ background: 'var(--pod-editor)', borderRadius: 'var(--pod-radius)', border: 'var(--pod-border)', boxShadow: 'var(--pod-shadow)' }}>
              <div className="flex-1 flex items-center justify-center">
                {docLoading ? (
                  <div className="text-[var(--muted)] text-sm">Loading...</div>
                ) : (
                  <div className="flex flex-col items-center gap-3 px-6 py-8">
                    <div className="text-ink-subtle text-sm">No document open</div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setNewDocModal({ mode: "fresh" })}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[var(--accent)] rounded-md hover:opacity-90 transition-opacity"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 5v14" />
                          <path d="M5 12h14" />
                        </svg>
                        Create new document
                      </button>
                      {!devStorage && (
                        <button
                          type="button"
                          onClick={openExistingFile}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-ink-body bg-surface border border-edge-hover rounded-md hover-on-light"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
                          </svg>
                          Open existing folder
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          </div>
          {/* Bottom drag gap — grab bar below the page. Matches the top
              drag gap's 4px height in zen mode so the lowest possible
              point for the page is symmetric with the topmost. */}
          <div
            data-gutter-gap="bottom"
            ref={bottomGutterDrag.gapRef}
            className="drag-gap drag-gap-h shrink-0"
            style={{ height: zenModeOn ? 4 : 'var(--pod-gap)' }}
            onMouseDown={onBottomGutterDown}
          />
          {/* Bottom gutter — in zen mode the page extends to the bottom
              edge of the window by default (zenBottomGutter = 0); the
              user can drag it taller from the bottom drag handle. */}
          <div
            data-flex-row="bottom"
            style={{
              flex: isResizingGutters
                ? `0 0 ${zenModeOn ? zenBottomGutter : bottomGutterPref}px`
                : `1 100 ${zenModeOn ? zenBottomGutter : bottomGutterPref}px`,
              minHeight: 0,
            }}
          />
        </div>

        {/* Right panel column. In Zen mode this position becomes an empty
            adjustable margin; when the side is collapsed the column is
            simply absent so the editor runs flush to the icon strip. */}
        {zenModeOn ? (
          <ZenMargin side="right" marginPref={zenRightMargin} onMarginPrefChange={setZenRightMargin} isResizing={isResizingPanels} onResizingChange={setIsResizingPanels} onSyncBeforeDrag={syncPanelPrefsToRendered} />
        ) : (
          renderPanelColumn("right")
        )}

        {/* Right icon strip — hidden in Zen mode */}
        {!zenModeOn && (
        <div data-strip-side="right" data-prefs="backgroundColor" className="flex flex-col items-center pt-2 pb-3 px-1.5 bg-[var(--background)] shrink-0 gap-1.5">
          {/* Presentation-tools pod: collapse/expand, blank, split — grouped as view controls */}
          <div className="flex flex-col items-center gap-0.5 p-1 rounded-md bg-surface/70 border border-edge-hover">
            {/* Sidebar toggle — panel-right icon indicates the right sidebar */}
            <button
              onClick={() => { activeRight ? collapseRight() : expandRight(); }}
              className="iconbtn-md iconbtn-toggle"
              aria-pressed={!!activeRight}
              title={activeRight ? "Collapse panel" : "Expand panel"}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="4" width="16" height="16" rx="1.5" />
                {activeRight && <rect x="15" y="4" width="5" height="16" fill="currentColor" opacity="0.25" stroke="none" />}
                <line x1="15" y1="4" x2="15" y2="20" />
              </svg>
            </button>
            {/* Blank — suppresses the default omni-view on this side. Auto-clears
                when a strip panel is opened or a new card is created. */}
            <button
              onClick={() => { activeRight === "blank" ? setActiveRight("omni") : setBlank("right"); }}
              className="iconbtn-md iconbtn-toggle"
              aria-pressed={activeRight === "blank"}
              title={activeRight === "blank" ? "Show omni-view" : "Hide omni-view"}
            >
              <IconBlank active={activeRight === "blank"} />
            </button>
            {/* Split panel toggle — shaded half reflects which pane is focused */}
            <button
              onClick={() => toggleSplit("right")}
              className="iconbtn-md iconbtn-toggle"
              aria-pressed={prefs.activeRightBottom != null}
              title={prefs.activeRightBottom != null ? "Unsplit panel" : "Split panel horizontally"}
            >
              <IconSplit
                active={prefs.activeRightBottom != null}
                focusedHalf={prefs.activeRightBottom != null ? focusedHalfRight : undefined}
              />
            </button>
          </div>
          {rightStripItems.map((p) => (
            <StripButton
              key={p.id}
              panelId={p.id}
              active={activeRight === p.id || prefs.activeRightBottom === p.id}
              onClick={() => handleStripClick(p.id, "right")}
              onMove={handleMove}
              side="right"
              badge={p.id === "revisions" && activeRevisionsCount > 0}
              stripRef={null as any}
              iconDropMimes={iconDropMimesByPanel[p.id]}
              onIconDrop={(dt) => handleIconDrop(p.id, dt)}
            />
          ))}
          <div className="mt-auto">
            <OmniFilterMenu
              side="right"
              enabled={getOmniEnabled("right")}
              onToggle={(cat) => toggleOmniCategory("right", cat)}
              onSelectDefault={() => setOmniSideToDefault("right")}
              categorySides={categorySides}
              defaultCategories={DEFAULT_OMNI_CATEGORIES.right}
            />
          </div>
        </div>
        )}
      </div>
      )}
      {preferencesOpen && (
        <PreferencesModal
          prefs={editorPrefs}
          transforms={editorTransforms}
          presets={editorPresets}
          onUpdate={updatePref}
          onUpdateTransform={updateTransform}
          onReset={resetPrefs}
          onClose={() => setPreferencesOpen(false)}
          onSavePreset={savePreset}
          onLoadPreset={loadPreset}
          onDeletePreset={deletePreset}
        />
      )}
      <AIWindow
        open={aiWindowOpen}
        onClose={() => setAiWindowOpen(false)}
        bibReviewRequests={bibReviewRequests}
        bibEntryRequests={entryRequests}
        comments={comments}
        users={revisionUsers}
        bibEntries={bibEntries}
        panelAiRequests={aiRequests}
        addPanelAiRequest={addAiRequest}
        deletePanelAiRequest={deleteAiRequest}
        requestBibReview={requestBibReview}
        cancelBibReview={cancelBibReview}
        addEntryRequest={addEntryRequest}
        removeEntryRequest={removeEntryRequest}
        addComment={addComment}
        refreshAll={() => {
          refreshBibReview();
          refreshBibSettings();
          refreshRevisions();
        }}
      />
      {confirmDialog}
      {docClassDialog}
      {activeRefLabel != null && activeRefRect && (
        <LabelRefPopover
          label={activeRefLabel}
          anchorRect={activeRefRect}
          labels={gatherLabels()}
          refCommand={activeRefCommand}
          onChangeLabel={handleRefChangeLabel}
          onChangeRefCommand={(lbl, cmd) => {
            handleRefChangeCommand(lbl, cmd);
            setActiveRefCommand(cmd);
          }}
          onJumpToLabel={handleRefJump}
          onInsertRef={handleInsertRef}
          onClose={() => {
            setActiveRefLabel(null);
            setActiveRefRect(null);
          }}
        />
      )}
      {pendingFolderPick && !newDocModal && (
        <TexFilePickerModal
          folderName={pendingFolderPick.folderName}
          texFiles={pendingFolderPick.texFiles}
          onSelect={selectFileInFolder}
          onCreateNew={() =>
            setNewDocModal({
              mode: "inFolder",
              folderName: pendingFolderPick.folderName,
            })
          }
          onCancel={cancelFolderPick}
        />
      )}
      {newDocModal && (
        <NewDocumentModal
          subtitle={
            newDocModal.mode === "inFolder"
              ? `Will be created in "${newDocModal.folderName}"`
              : devStorage
                ? "Will be created in virgil-data/."
                : "You'll pick where to save the folder after naming it."
          }
          onCancel={() => setNewDocModal(null)}
          onCreate={async (name, templateId) => {
            if (newDocModal.mode === "inFolder") {
              await createFileInPendingFolder(name, templateId);
            } else {
              await createFile(name, templateId);
            }
            setNewDocModal(null);
          }}
        />
      )}
      {/* Floating (popped-out) cards — rendered at the EditorLayout root so
          they survive closing the source panel. Each wrapper card receives
          `isPoppedOut={true}`, which makes it wrap itself in a FloatCard
          (portal to document.body). The wrapper-internal null-return for
          in-list renders prevents double-mounting when the source panel
          is also open. Hidden in Zen mode — prefs state is retained. */}
      {!zenModeOn && prefs.poppedOutCards.map((key) => renderPoppedCard(key, poppedCardDeps))}
      {/* Floating (popped-out) panels — rendered via portal above everything.
          Hidden in Zen mode. */}
      {!zenModeOn && prefs.poppedOutPanels.map((pid, i) => {
        const placement = prefs.placements.find((pl) => pl.id === pid);
        const side: Side = placement?.side ?? "right";
        const saved = prefs.floatPositions[pid];
        const initialX = saved?.x ?? Math.max(
          FLOATING_PANEL_VIEWPORT_MARGIN,
          window.innerWidth / 2 - FLOATING_PANEL_WIDTH / 2 + i * FLOATING_PANEL_STACK_OFFSET,
        );
        const initialY = saved?.y ?? Math.max(
          FLOATING_PANEL_VIEWPORT_MARGIN,
          window.innerHeight / 2 - FLOATING_PANEL_HEIGHT / 2 + i * FLOATING_PANEL_STACK_OFFSET,
        );
        const initialWidth = saved?.width ?? FLOATING_PANEL_WIDTH;
        const initialHeight = saved?.height ?? FLOATING_PANEL_HEIGHT;
        return (
          <FloatingPanel
            key={pid}
            initialX={initialX}
            initialY={initialY}
            initialWidth={initialWidth}
            initialHeight={initialHeight}
            zIndex={FLOATING_PANEL_Z_BASE + i}
            onChange={(pos) => setFloatPosition(pid, pos)}
            onFocus={() => focusFloating({ kind: "panel", id: pid })}
          >
            {renderPanelWithChrome(pid, side)}
          </FloatingPanel>
        );
      })}
    </div>
    </PoppedCardsContext.Provider>
    </CardCreationProvider>
    </PristineCardsProvider>
    </SelectionsProvider>
    </PanelViewModeProvider>
    </CitationDisplayProvider>
    </AiRequestsProvider>
    </EditorRefProvider>
    </EditorLayoutProvider>
  );
}
