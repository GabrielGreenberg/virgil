"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { JSONContent } from "@tiptap/react";
import VirgilEditor, { EditorHandle } from "./Editor";
import { VIRGIL_COMMAND_NAMES } from "@/lib/tiptap-extensions";
import MenuBar, { type MarginaliaType, type DividerLevel, type DividerWidth } from "./MenuBar";
import { Editor } from "@tiptap/react";
import SelectionChip from "./SelectionChip";
import { type SectionPathEntry, buildPerBlockCounts, sumIncludedWords, extractHeadings } from "@/panels/Outline";
import ProgressBar from "./ProgressBar";
import { useFiles } from "@/hooks/useFiles";
import { useSelectedAnchorSync } from "@/hooks/useSelectedAnchorSync";
import { useDocument } from "@/hooks/useDocument";
import { useSuggestions } from "@/hooks/useSuggestions";
import { useRevisions } from "@/hooks/useRevisions";
import { useTodos } from "@/hooks/useTodos";
import { useAiRequests } from "@/hooks/useAiRequests";
import { useArchive } from "@/hooks/useArchive";
import { useCitations } from "@/hooks/useCitations";
import { useAnnotations } from "@/hooks/useAnnotations";
import { useBibReview } from "@/hooks/useBibReview";
import { useBibSettings } from "@/hooks/useBibSettings";
import { useNotes } from "@/hooks/useNotes";
import { useCutter } from "@/hooks/useCutter";
import { useQuotations } from "@/hooks/useQuotations";
import Marginalia from "./Marginalia";
import {
  isAnchorableNode,
  MIME_ARCHIVE,
  MIME_ARCHIVE_ANCHOR,
  MARKER_META,
  type MarginaliaMarker,
} from "@/lib/marginalia";
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

/** Subscribe the EditorLayout tree to panel-color changes. */
function usePanelColorSubscription(): number {
  // Load overrides on first use (idempotent).
  if (typeof window !== "undefined") loadPanelColors();
  return useSyncExternalStore(subscribePanelColors, getPanelColorVersion, () => 0);
}

/** Maps the marker kinds that can appear as linked-anchor highlights to their
 *  panel-theme key so the highlight color honors user color overrides. */
const MARKER_KIND_TO_THEME_KEY: Partial<Record<string, PanelThemeKey>> = {
  note: "note",
  revision: "revision",
  cut: "cut",
};
import {
  removeLinkedAnchor,
  reanchorByText,
  getLinkedParagraphIds,
  getTextAnchor,
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
} from "@/panels/Omni";
import { useViewPrefs, PanelId, Side, Half } from "@/hooks/useViewPrefs";
import { useLinkHighlight } from "@/links/_shared/useLinkHighlight";
import { PanelChromeProvider } from "./panel-primitives";
import FloatingPanel from "./FloatingPanel";
import {
  FLOATING_PANEL_WIDTH,
  FLOATING_PANEL_HEIGHT,
  FLOATING_PANEL_VIEWPORT_MARGIN,
  FLOATING_PANEL_STACK_OFFSET,
  FLOATING_PANEL_Z_BASE,
} from "./editor-layout/constants";
import {
  alignEntryToY,
  scrollEntryIntoView,
} from "./editor-layout/layout-scroll";
import {
  PANEL_ICONS,
  panelLabel,
  IconPlus,
  IconX,
  IconOmni,
  IconSplit,
  IconLibrary,
} from "./editor-layout/panel-icons";
import { PanelColumn, PlaceholderPanel } from "./editor-layout/panel-column";
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
import { SuggestionsHost } from "./editor-layout/panels/suggestions-host";
import { PoppedCardsContext } from "@/hooks/usePoppedCards";
import { usePreferences } from "@/hooks/usePreferences";
// Preference mode — ctrl+click picker for live token editing. See
// usePreferenceMode.ts for the full architecture / extension guide.
import { usePreferenceMode } from "@/hooks/usePreferenceMode";
import PreferenceModePicker from "./PreferenceModePicker";
import { applyTransforms } from "@/lib/color-transforms";
import { PREF_TO_CSS, DERIVED_CSS } from "@/lib/preferences-tree";
import PreferencesModal from "./PreferencesModal";
import AIWindow, { aiRequestDotStatus } from "./AIWindow";
import { useConfirmDialog } from "./ConfirmDialog";
import LabelRefPopover from "./LabelRefPopover";
import TexFilePickerModal from "./TexFilePickerModal";
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
  // The per-doc library tab is visually in place but the feature is
  // still under construction — clicking the shadow tab surfaces a
  // single-button info dialog rather than activating the pane.
  const showLibraryUnderConstruction = useCallback(() => {
    runConfirm({
      title: "Virgil library",
      message: "This function is still under construction.",
      confirmLabel: "Got it",
      hideCancel: true,
    });
  }, [runConfirm]);

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
    activePane,
    activateDocPane,
    activateLibraryPane,
    toggleActivePane,
  } = useFiles();

  useLibraryBridge({ currentDocId, activateLibraryPane });

  // Per-doc permission gate state. We query (without prompting) when
  // the active doc changes; if it isn't already granted we show the
  // gate, which calls requestRW from inside its click handler.
  type DocPermState = "loading" | "granted" | "needs-grant" | "no-handle";
  const [docPermState, setDocPermState] = useState<DocPermState>("loading");
  const [activeDocHandle, setActiveDocHandle] = useState<FileSystemDirectoryHandle | null>(null);

  // Hooks read from disk, so we gate their docId on the permission
  // state. Until the active folder has been re-granted readwrite
  // permission for this session, every hook sees `null` and stays in
  // its empty state instead of crashing on NotAllowedError. The UI
  // (tab strip, path bar) keeps using the un-gated currentDocId.
  const docIdForHooks: string | null =
    docPermState === "granted" ? currentDocId : null;

  const { content, loading: docLoading, onUpdate, saveStatus, refetch: refetchDoc } = useDocument(docIdForHooks);
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
    generalRevisions,
    textRevisions,
    addGeneralRevision,
    addTextRevision,
    setRevisionAnchor,
    deleteRevision,
    refresh: refreshRevisions,
  } = useRevisions(docIdForHooks);
  const activeRevisionsCount =
    generalRevisions.filter((r) => !r.resolved).length +
    textRevisions.filter((r) => !r.resolved).length;
  const {
    notes,
    addNote,
    updateNote,
    updateNoteTitle,
    addNoteParagraphId,
    removeNoteParagraphId,
    deleteNote,
    setNoteAnchor,
  } = useNotes(docIdForHooks);
  const {
    cuts,
    addCut,
    updateCut,
    updateCutTitle,
    addCutParagraphId,
    removeCutParagraphId,
    deleteCut,
  } = useCutter(docIdForHooks);
  const [selectedCutId, setSelectedCutId] = useState<string | null>(null);
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
  } = useQuotations(docIdForHooks);
  const {
    items: todoItems,
    addItem: addTodo,
    toggleItem: toggleTodo,
    updateItem: updateTodo,
    updateNotes: updateTodoNotes,
    deleteItem: deleteTodo,
    archiveDone: archiveTodos,
    addParagraphId: addTodoParagraphId,
    removeParagraphId: removeTodoParagraphId,
  } = useTodos(docIdForHooks);

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
  } = useCitations(docIdForHooks);

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
    setActiveLeft,
    setActiveRight,
    setActiveHalf,
    toggleSplit,
    setSplitRatio,
    setEditorSplit,
    setEditorSplitRatio,
    setAlwaysShowLinkedText,
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

  const editorRef = useRef<EditorHandle>(null);
  const mainAreaRef = useRef<HTMLDivElement>(null);
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
    generalRevisions,
    textRevisions,
    panelAiRequests: aiRequests,
  }), [bibReviewRequests, entryRequests, generalRevisions, textRevisions, aiRequests]);
  const { prefs: editorPrefs, transforms: editorTransforms, presets: editorPresets, updatePref, updateTransform, resetAll: resetPrefs, savePreset, loadPreset, deletePreset } = usePreferences();
  // Preference mode toggle. `on` drives the top-bar button styling and gates
  // the ctrl+click picker. Read-only here — the button itself calls toggle().
  const { on: prefModeOn, toggle: togglePrefMode } = usePreferenceMode();
  const [latestDoc, setLatestDoc] = useState<JSONContent | null>(null);
  const [commentHighlight, setCommentHighlight] = useState<string | null>(null);
  const [pendingCommentText, setPendingCommentText] = useState<string | null>(null);
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [selectedQuotationGroupId, setSelectedQuotationGroupId] = useState<string | null>(null);
  const [selectedArchiveId, setSelectedArchiveId] = useState<string | null>(null);
  const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null);
  const [selectedFootnoteId, setSelectedFootnoteId] = useState<string | null>(null);
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
  const [activeAnchorKind, setActiveAnchorKind] = useState<"note" | "revision" | "cut" | null>(null);

  // CSS-based coupled highlight: the `.linked-anchor` span for the
  // active/hovered link gets `data-link-highlight`, and the editor root
  // gets `data-always-show-links` when the pref is on. Margin icons read
  // the same `activeAnchorId`/`hoveredAnchorId` state via their own
  // `selected` prop. Bidirectional by construction.
  useLinkHighlight({
    editor: editorInstance,
    activeLinkId: activeAnchorId,
    hoveredLinkId: hoveredAnchorId,
    alwaysShowLinkedText: prefs.alwaysShowLinkedText,
  });

  // ── LabelRef popover state ──
  const [activeRefLabel, setActiveRefLabel] = useState<string | null>(null);
  const [activeRefRect, setActiveRefRect] = useState<DOMRect | null>(null);
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
      case "cutter": setSelectedCutId(itemId); break;
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
    // Update browser theme-color meta tag (locked to topbarBackground)
    const tc = applyTransforms(editorPrefs.topbarBackground, editorTransforms);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", tc);
  }, [editorPrefs, editorTransforms]);

  const [codeView, setCodeView] = useState(false);
  const [codeViewLine, setCodeViewLine] = useState<number | undefined>(undefined);
  const [codeViewParagraphId, setCodeViewParagraphId] = useState<string | null>(null);
  const codeEditorHandleRef = useRef<CodeEditorHandle | null>(null);
  const pendingScrollText = useRef<string | null>(null);
  const pendingParagraphId = useRef<string | null>(null);

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

  // Persistent highlight sync: whenever a citation card is selected in
  // the Citations panel or OmniView, mirror that selection onto the
  // citation node(s) in the editor with the `citation-highlight-bib`
  // class. The highlight stays on until a different citation is
  // selected or the selection is cleared. There can be multiple DOM
  // nodes for the same citation id if the editor is split.
  useEffect(() => {
    if (!selectedCitationId) return;
    const els = Array.from(
      document.querySelectorAll(
        `[data-link-kind="citation"][data-link-id="${selectedCitationId}"]`,
      ),
    ) as HTMLElement[];
    for (const el of els) el.classList.add("citation-highlight-bib");
    return () => {
      for (const el of els) el.classList.remove("citation-highlight-bib");
    };
  }, [selectedCitationId, allEditorCitations]);

  // Persistent highlight sync for footnotes: mirrors the citation
  // pattern above, adding `footnote-highlight-marker` to the inline
  // footnote marker in the editor when its card is selected.
  useEffect(() => {
    if (!selectedFootnoteId) return;
    const els = Array.from(
      document.querySelectorAll(
        `[data-link-kind="footnote"][data-link-id="${selectedFootnoteId}"]`,
      ),
    ) as HTMLElement[];
    for (const el of els) el.classList.add("footnote-highlight-marker");
    return () => {
      for (const el of els) el.classList.remove("footnote-highlight-marker");
    };
  }, [selectedFootnoteId]);

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

      const stack: { level: number; text: string; index: number }[] = [];
      let lastCrossedStack: { level: number; text: string; index: number }[] = [];
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
            stack.push({ level, text: node.textContent || "Untitled", index });
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

      const path: SectionPathEntry[] = lastCrossedStack.map((s) => ({ text: s.text, index: s.index }));
      setCurrentSectionPath((prev) => {
        if (prev.length === path.length && prev.every((v, i) => v.text === path[i].text && v.index === path[i].index)) {
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

      const stack: { level: number; text: string; index: number }[] = [];
      let lastCrossedStack: { level: number; text: string; index: number }[] = [];
      let activeParTitleIdx: number | null = null;

      doc.forEach((node, offset, index) => {
        if (node.type.name === "heading" && node.attrs?.level) {
          const level = node.attrs.level as number;
          let headingTop: number | null = null;
          try { headingTop = mirrorView.coordsAtPos(offset + 1).top; } catch { headingTop = null; }
          if (headingTop == null) return;
          if (headingTop <= referenceY) {
            while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
            stack.push({ level, text: node.textContent || "Untitled", index });
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

      const path: SectionPathEntry[] = lastCrossedStack.map((s) => ({ text: s.text, index: s.index }));
      setMirrorSectionPath((prev) =>
        prev.length === path.length && prev.every((v, i) => v.text === path[i].text && v.index === path[i].index) ? prev : path,
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

  // Auto-show suggestions panel when suggestions load
  useEffect(() => {
    if (hasSuggestions) {
      const hasPending = suggestionsState.suggestions.some((s) => s.status === "pending");
      if (hasPending && prefsRef.current.activeRight !== "suggestions") setActiveRight("suggestions");
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
    if (process.env.NEXT_PUBLIC_DEV_STORAGE) {
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
    addCut,
    addQuotationGroup,
    actOnSuggestion,
    currentSuggestion,
    setSelectedNoteId,
    setSelectedCutId,
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
  useSelectedAnchorSync({
    selectedId: selectedCutId,
    entities: cuts,
    kind: "cut",
    dataAttrName: "cut-entry",
    setSelectedId: setSelectedCutId,
    setActiveAnchorId,
    setActiveAnchorKind,
    skipSelectors: ['[data-selection-chip]', '[data-cut-selection-button]'],
  });
  useSelectedAnchorSync({
    selectedId: selectedCommentId,
    entities: textRevisions,
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
    tryScrollOmniEntry,
    setActiveAnchorId,
    setHoveredAnchorId,
    setActiveAnchorKind,
    notes,
    selectedNoteId,
    setSelectedNoteId,
    cuts,
    selectedCutId,
    setSelectedCutId,
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
    addCut,
    setSelectedNoteId,
    setSelectedCutId,
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
    setSelectedArchiveId,
    setSelectedFootnoteId,
    setSelectedCitationId,
    setActiveRefLabel,
    setActiveRefRect,
  });

  useFootnoteSyncBridges({ suppressOrphanRef, setOrphanedFootnotes, deleteSnippet });

  usePanelDropBridges({
    addQuotationParagraphId,
    setSelectedQuotationGroupId,
    addTodoParagraphId,
    setSelectedTodoId,
    addNoteParagraphId,
    setSelectedNoteId,
    addCutParagraphId,
    setSelectedCutId,
  });

  useAnchorRebindBridge({
    addQuotationParagraphId, removeQuotationParagraphId,
    addTodoParagraphId, removeTodoParagraphId,
    addNoteParagraphId, removeNoteParagraphId,
    addArchiveParagraphId, removeArchiveParagraphId,
    addCutParagraphId, removeCutParagraphId,
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
  const { gatherLabels, handleRefChangeLabel, handleRefJump, handleInsertRef } = useRefActions({
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

  const pendingRevisionAnchorIdRef = useRef<string | null>(null);

  const { handleAddComment, handleSubmitComment, handleCancelComment } = useCommentActions({
    editorRef,
    pendingRevisionAnchorIdRef,
    prefs,
    setActiveLeft,
    setActiveRight,
    pendingCommentText,
    setPendingCommentText,
    addTextRevision,
  });

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

  const { handleStripClick, handleMove } = useStripHandlers({
    prefs,
    focusedHalfLeft,
    focusedHalfRight,
    togglePanel,
    movePanel,
    setActiveHalf,
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
          onClick: () => handleQuotationMarkerClick(g.id),
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
          onClick: () => handleNoteMarkerClick(n.id),
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

    // Text revision markers — one marker per anchored revision. The
    // paragraph uuid is resolved live from the mark's range; if the mark
    // is gone the revision becomes orphaned and gets no marker.
    const ed = editorRef.current?.getEditor();
    if (ed) {
      for (const r of textRevisions) {
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

    // Cut markers — one per paragraphId
    for (const c of cuts) {
      const pids = getLinkedParagraphIds(c);
      if (pids.length === 0) continue;
      const cutAnchor = getTextAnchor(c);
      for (const pid of pids) {
        result.push({
          id: `${c.id}:${pid}`,
          entityId: c.id,
          type: "cut",
          paragraphId: pid,
          selected: selectedCutId === c.id,
          title: c.title || "Cut",
          onClick: () => handleCutMarkerClick(c.id),
          onDelete: () => {
            // Drop the text anchor first (mirrors the Notes flow): the orphan
            // guard fires `virgil-anchor-orphaned`, useCutter clears the
            // cut's text-anchor link, and the selection-sync hook then
            // releases `activeAnchorId` — so the highlight goes away.
            const ed = editorRef.current?.getEditor();
            if (ed && cutAnchor) removeLinkedAnchor(ed, cutAnchor.anchorId);
            removeCutParagraphId(c.id, pid);
          },
          anchorId: cutAnchor?.anchorId,
          onHover: cutAnchor
            ? (hovering: boolean) => {
                if (hovering) {
                  setHoveredAnchorId(cutAnchor.anchorId);
                  setActiveAnchorKind("cut");
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
          onClick: () => handleTodoMarkerClick(item.id),
          onDelete: () => removeTodoParagraphId(item.id, pid),
        });
      }
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
    textRevisions,
    selectedCommentId,
    setActiveLeft,
    setActiveRight,
    cuts,
    selectedCutId,
    removeCutParagraphId,
    handleCutMarkerClick,
  ]);

  // Subscribe to panel-color changes so linked-anchor highlight updates live.
  usePanelColorSubscription();
  // Effective linked-anchor activation: hovered takes priority over sticky-active.
  const effectiveAnchorId = hoveredAnchorId ?? activeAnchorId;
  const effectiveAnchorColor = (() => {
    if (!activeAnchorKind) return null;
    const meta = MARKER_META[activeAnchorKind];
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
    const records: Array<{ anchorId: string; kind: "note" | "revision" | "cut"; text: string }> = [];
    for (const n of notes) {
      const ta = getTextAnchor(n);
      if (ta && ta.anchorText) {
        records.push({ anchorId: ta.anchorId, kind: "note", text: ta.anchorText });
      }
    }
    for (const r of textRevisions) {
      const ta = getTextAnchor(r);
      if (ta) {
        records.push({ anchorId: ta.anchorId, kind: "revision", text: ta.anchorText || r.selectedText });
      }
    }
    for (const c of cuts) {
      const ta = getTextAnchor(c);
      if (ta && ta.anchorText) {
        records.push({ anchorId: ta.anchorId, kind: "cut", text: ta.anchorText });
      }
    }
    if (records.length > 0) {
      editorRef.current.applyLinkedAnchors(records);
    }

    // Legacy text revisions: no text-anchor link yet, only `selectedText`.
    // Try to reanchor by searching for that text; on success, persist the
    // new id onto the revision.
    for (const r of textRevisions) {
      if (getTextAnchor(r) || !r.selectedText) continue;
      const rec = reanchorByText(editorInstance, "revision", r.selectedText);
      if (rec) setRevisionAnchor(r.id, rec.anchorId);
    }
  }, [editorInstance, docIdForHooks, notes, textRevisions, cuts, setRevisionAnchor]);

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
  const highlightText = searchHighlightRange
    ? null
    : pendingCommentText
      ? pendingCommentText
      : commentHighlight
        ? commentHighlight
        : (activeLeft === "suggestions" || activeRight === "suggestions") && currentSuggestion
          ? currentSuggestion.original_text
          : null;

  const suggestionPanelVisible = (activeLeft === "suggestions" || activeRight === "suggestions") && hasSuggestions;
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
    if (panelId === "blank" || panelId === "omni" || panelId === "suggestions") return inner;
    const isPoppedOut = prefs.poppedOutPanels.includes(panelId);
    const onClose = () => {
      if (isPoppedOut) {
        closePopout(panelId);
      } else {
        setActiveHalf(side, half ?? "top", "blank");
      }
    };
    return (
      <PanelChromeProvider
        value={{
          isPoppedOut,
          onTogglePopout: () => togglePopout(panelId),
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
  // it inside a split half). The "suggestions" panel is special-cased
  // because it manages its own layout.
  function renderPanelInner(panelId: PanelId, side: Side): React.ReactNode {
    if (!(panelId in PANEL_ICONS)) return null;

    if (panelId === "blank") {
      return <div className="w-full h-full bg-[var(--background)]" />;
    }

    if (panelId === "suggestions" && hasSuggestions) {
      return (
        <SuggestionsHost
          side={side}
          currentSuggestion={currentSuggestion}
          isComplete={isComplete}
          onAct={handleAct}
          updateSuggestionField={updateSuggestionField}
          clearSuggestions={clearSuggestions}
          setActiveLeft={setActiveLeft}
          setActiveRight={setActiveRight}
        />
      );
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
          deleteTodo={deleteTodo}
          archiveTodos={archiveTodos}
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
          generalRevisions={generalRevisions}
          textRevisions={textRevisions}
          addGeneralRevision={addGeneralRevision}
          deleteRevision={deleteRevision}
          pendingCommentText={pendingCommentText}
          setPendingCommentText={setPendingCommentText}
          pendingRevisionAnchorIdRef={pendingRevisionAnchorIdRef}
          handleSubmitComment={handleSubmitComment}
          handleCancelComment={handleCancelComment}
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
          cuts={cuts}
          quotationGroups={quotationGroups}
          textRevisions={textRevisions}
          generalRevisions={generalRevisions}
          bibEntries={bibEntries}
          openItemInPanel={openItemInPanel}
          searchState={searchState}
          setSearchState={setSearchState}
          setSearchHighlightRange={setSearchHighlightRange}
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
          deleteTodo={deleteTodo}
          getOmniEnabled={getOmniEnabled}
          toggleOmniCategory={toggleOmniCategory}
          categorySides={categorySides}
        />
      );
    }

    if (panelId === "cutter") {
      return (
        <CutterHost
          side={side}
          panelSide={cutterPanelSide}
          cuts={cuts}
          addCut={addCut}
          updateCut={updateCut}
          updateCutTitle={updateCutTitle}
          deleteCut={deleteCut}
          onHoverCut={handleHoverCut}
          onDropSelection={handleDropSelectionOnCutter}
          onDropParagraph={handleDropParagraphOnCutter}
        />
      );
    }

    return <PlaceholderPanel title={panelLabel(panelId)} hasViewToggle={false} />;
  }

  // Render a side's panel column. Always returns a PanelColumn so the
  // editor's flex context never changes — collapsed slots reserve space.
  function renderPanelColumn(side: Side): React.ReactNode {
    const top = side === "left" ? activeLeft : activeRight;
    const bottom = side === "left" ? prefs.activeLeftBottom : prefs.activeRightBottom;
    const ratio = side === "left" ? prefs.splitLeftRatio : prefs.splitRightRatio;
    const focused = side === "left" ? focusedHalfLeft : focusedHalfRight;
    const setFocused = side === "left" ? setFocusedHalfLeft : setFocusedHalfRight;

    const width = getPanelWidth(side, top ?? "blank");
    const onWidthChange = (w: number) => setPanelWidth(side, top ?? "blank", w);

    if (!top && !bottom) {
      // Fully collapsed — column gone, text extends to strip edge
      return null;
    }

    if (bottom != null) {
      // Split mode
      return (
        <PanelColumn
          side={side}
          width={width}
          onWidthChange={onWidthChange}
          split
          focusedHalf={focused}
          onFocusHalf={setFocused}
          topPanelId={top ?? "blank"}
          bottomPanelId={bottom}
        >
          {{
            top: top ? renderPanelWithChrome(top, side, "top") : <div className="w-full h-full bg-[var(--background)]" />,
            bottom: renderPanelWithChrome(bottom, side, "bottom"),
            ratio,
            onRatioChange: (r: number) => setSplitRatio(side, r),
          }}
        </PanelColumn>
      );
    }

    // Single mode. Omni-view renders chromeless — no pod background/border —
    // so its cards float directly on the blank canvas behind the panels.
    return (
      <PanelColumn side={side} width={width} onWidthChange={onWidthChange} blank={top === "blank" || top === "omni"} topPanelId={top ?? undefined}>

        {renderPanelWithChrome(top!, side)}
      </PanelColumn>
    );
  }

  // Build strip icon list, filtering out suggestions if none exist
  const leftStripItems = leftItems.filter((p) => p.id !== "blank" && (p.id !== "suggestions" || hasSuggestions));
  const rightStripItems = rightItems.filter((p) => p.id !== "blank" && (p.id !== "suggestions" || hasSuggestions));

  if (!fsaSupported) {
    return <UnsupportedBrowserNotice />;
  }

  const poppedCardsValue = {
    poppedKeys: prefs.poppedOutCards,
    isPopped: (key: string) => prefs.poppedOutCards.includes(key),
    toggle: toggleCardPopout,
    close: closeCardPopout,
    getFloatPosition: (key: string) => prefs.cardFloatPositions[key],
    setFloatPosition: setCardFloatPosition,
  };

  // Popped-out card rendering lives in ./editor-layout/floating-cards.tsx —
  // the deps bundle below is the contract for what a popped card needs.
  const poppedCardDeps = {
    notes, footnotes, archiveSnippets, cuts, todoItems, bibEntries,
    citations, citationPositionMap, allEditorCitations,
    generalRevisions, textRevisions,
    quotationGroups, aiRequests, anchoredIds,
    selectedNoteId, selectedFootnoteId, selectedArchiveId, selectedCutId,
    selectedTodoId, selectedBibKey, selectedCitationId, selectedCommentId,
    selectedQuotationGroupId,
    setSelectedNoteId, setSelectedFootnoteId, setSelectedArchiveId,
    setSelectedCutId, setSelectedTodoId, setSelectedBibKey,
    setSelectedCitationId, setSelectedCommentId, setSelectedQuotationGroupId,
    editorRef,
    setOverrideEditor, getCitationDisplayText, handleCitationCreated,
    handleHoverNote, handleHoverCut, bibPackage,
    updateNote, updateNoteTitle, deleteNote,
    handleEditFootnote, handleDeleteFootnote, handleEditFootnoteTitle,
    updateArchiveSnippet, updateArchiveSnippetTitle, handleDeleteArchive,
    updateCut, updateCutTitle, deleteCut,
    toggleTodo, updateTodo, updateTodoNotes, deleteTodo,
    getFormattedBib, getAnnotation, setAnnotation,
    requestBibReview, cancelBibReview, getBibReviewStatus,
    updateBibEntry, updateBibKeyAndType,
    updateCitation,
    deleteRevision,
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
      selectedCutId, setSelectedCutId,
      selectedQuotationGroupId, setSelectedQuotationGroupId,
      selectedCommentId, setSelectedCommentId,
      selectedBibKey, setSelectedBibKey,
    }}>
    <PoppedCardsContext.Provider value={poppedCardsValue}>
    <div className="flex flex-col h-screen bg-[var(--background)]">
      {/* Preference mode picker — renders nothing until a ctrl+click on an
          annotated element opens it. Mounted at the layout root so its
          global ctrl+click listener is active for the whole app. */}
      <PreferenceModePicker />
      {/* Progress bar */}
      {suggestionPanelVisible && (
        <ProgressBar
          suggestions={suggestionsState.suggestions}
          currentIndex={suggestionsState.currentIndex}
          onJump={jumpToSuggestion}
        />
      )}

      {/* Top bar: logo + tabs */}
      <div
        // Preference-mode: the VIRGIL top bar. topbarBackground is locked to
        // the PWA/browser theme-color (see globals.css merger notes), so
        // changing it updates both the in-app bar and the browser chrome.
        data-prefs="topbarBackground,topbarBorder"
        className={`flex items-center relative bg-[var(--topbar-bg)] top-bar-border ${
        suggestionPanelVisible ? "mt-10" : ""
      }`}>
        {/* Logo + file buttons + tabs — all bottom-aligned */}
        <div className="flex items-end flex-1 min-w-0 overflow-clip gap-0.5 px-2 self-end" style={{ overflowClipMargin: '0px 0px 1px 0px' }}>
          {/* VIRGIL logo as first "tab-like" item */}
          <div className="flex items-center gap-1.5 px-3 pt-1 pb-1 shrink-0">
            <h1
              className="text-[var(--accent)] text-base font-semibold tracking-widest"
              style={{ fontFamily: "var(--font-logo), Cinzel, serif" }}
            >
              VIRGIL
            </h1>
          </div>
          {openTabs.map((doc) => {
            const isCurrentDoc = doc.id === currentDocId;
            const isDocPaneActive = isCurrentDoc && activePane === "doc";
            return (
              <div key={doc.id} className="flex items-end shrink-0">
                {/* Doc tab */}
                <div
                  className={`group flex items-center gap-1.5 pl-3.5 pr-2 pt-[1px] pb-0 text-sm cursor-default shrink-0 transition-all rounded-t-[10px] relative z-[1] ${
                    isDocPaneActive
                      ? "browser-tab-swoop bg-[var(--background)] text-ink-strong -mb-px z-10"
                      : "border border-[var(--topbar-border,#d5d3ce)] text-ink-subtle hover:bg-surface/30 hover:text-ink-body"
                  }`}
                  onClick={() => {
                    if (!isDocPaneActive) activateDocPane(doc.id);
                  }}
                >
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm leading-none truncate pt-[3px]" title={doc.folderName}>
                      {doc.folderName}
                    </span>
                    <span className="text-[10px] leading-none text-ink-muted truncate mt-[2px]" title={doc.texFilename}>
                      {doc.texFilename}
                    </span>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); closeTab(doc.id); }}
                    className="p-0.5 rounded text-ink-subtle hover:text-ink-body hover:bg-surface/40 transition-all"
                    title="Close tab"
                  >
                    <IconX />
                  </button>
                </div>
                {/* Library shadow tab — a full-width tab (matches a
                    regular doc tab) tucked behind the main tab; only
                    the right ~30px peeks out. The swoop (library-tab-
                    swoop) flares the cup color outward so the tab
                    silhouette matches a browser tab, just darker.
                    Feature is WIP, so clicking pops an under-
                    construction notice. */}
                <button
                  type="button"
                  onClick={showLibraryUnderConstruction}
                  title={`Virgil library (under construction)`}
                  className="library-tab-swoop group flex items-center justify-end h-[30px] w-[140px] -ml-[108px] pr-1.5 cursor-pointer shrink-0 transition-colors rounded-t-[10px] relative z-0 bg-[#cbc8c2] text-ink-subtle hover:bg-[#bcb8b2] hover:text-ink-body"
                >
                  <IconLibrary />
                </button>
              </div>
            );
          })}
          <button
            onClick={handleNativeOpen}
            className="p-1 mb-1 ml-1 rounded text-ink-subtle hover:bg-surface/30 hover:text-[var(--accent)] transition-colors shrink-0"
            title="Open folder"
          >
            <IconPlus />
          </button>
        </div>

        <div className="shrink-0 flex items-center px-2 gap-1">
          {focusMode.state.active && (
            <button
              onClick={focusMode.deactivate}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-[var(--accent)] bg-[var(--accent-light)] hover:bg-surface/30 transition-colors"
              title="Exit focus view"
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="8" cy="8" r="2.25" />
                <path d="M8 2.5v1.5M8 12v1.5M2.5 8H4M12 8h1.5" />
              </svg>
              Focus view
            </button>
          )}
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
            onClick={togglePrefMode}
            className={`p-1 rounded transition-colors ${
              prefModeOn
                ? "text-[var(--accent)] bg-[var(--accent-light)]"
                : "text-ink-subtle hover:bg-surface/30 hover:text-[var(--accent)]"
            }`}
            title={prefModeOn ? "Preference mode: on (ctrl-click to edit)" : "Preference mode: off"}
            aria-pressed={prefModeOn}
          >
            {/* Painter's palette icon — solid silhouette with the classic
                thumb-hole cutout on the right and four color wells punched
                through via fill-rule="evenodd". Solid (not stroked) so the
                shape stays legible at 14px; this deliberately reads as
                more visually present than the neighbouring (i) and
                AI-star icons, because it toggles a *mode* rather than
                opening a menu. */}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c1.1 0 2-.9 2-2 0-.52-.2-.97-.54-1.32-.34-.36-.54-.82-.54-1.33 0-1.1.9-2 2-2h2.35C19.93 15.35 22 13.24 22 10.65 22 5.88 17.52 2 12 2zM6.5 12a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" />
            </svg>
          </button>
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setVersionOpen((v) => !v); }}
              className="p-1 rounded transition-colors text-ink-subtle hover:bg-surface/30 hover:text-[var(--accent)]"
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
                  className="relative flex items-center justify-between px-3 py-2 cursor-default hover:bg-surface-muted"
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
                          className="block w-full text-left px-3 py-1 font-mono text-ink-body hover:bg-surface-muted-strong"
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
            className={`relative p-1 rounded transition-colors ${aiWindowOpen ? "text-[var(--accent)] bg-[var(--accent-light)]" : "text-ink-subtle hover:bg-sky-50/50 hover:text-sky-600"}`}
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
          <button
            onClick={codeView ? switchToVisualView : switchToCodeView}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs text-ink-subtle hover:bg-surface/30 hover:text-[var(--accent)] transition-colors"
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
                </svg>
                Code
              </>
            )}
          </button>
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
          <LibraryTabView docId={currentDocId} />
        </div>
      ) : codeView && currentDocId ? (
        <div className="flex flex-1 overflow-hidden">
          <CodeEditor
            docId={currentDocId!}
            initialLine={codeViewLine}
            initialParagraphId={codeViewParagraphId}
            onReady={(handle) => { codeEditorHandleRef.current = handle; }}
          />
        </div>
      ) : (
      <div ref={mainAreaRef} className="flex flex-1 overflow-hidden relative">
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


        {/* Left icon strip */}
        <div data-strip-side="left" data-prefs="backgroundColor" className="flex flex-col items-center pt-2 pb-3 px-1.5 bg-[var(--background)] shrink-0 gap-1.5">
          {/* Presentation-tools pod: collapse/expand, blank, split — grouped as view controls */}
          <div className="flex flex-col items-center gap-0.5 p-1 rounded-md bg-surface/70 border border-edge-hover">
            {/* Sidebar toggle — panel-left icon indicates the left sidebar */}
            <button
              onClick={() => { activeLeft ? collapseLeft() : expandLeft(); }}
              className={`p-1.5 rounded transition-colors flex items-center justify-center ${activeLeft ? "text-[var(--accent)] bg-[var(--accent-light)] shadow-[inset_0_0_0_1px_rgba(124,94,60,0.3)]" : "text-[var(--muted)] hover:bg-surface-muted-strong hover:text-ink-body"}`}
              title={activeLeft ? "Collapse panel" : "Expand panel"}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="4" width="16" height="16" rx="1.5" />
                {activeLeft && <rect x="4" y="4" width="5" height="16" fill="currentColor" opacity="0.25" stroke="none" />}
                <line x1="9" y1="4" x2="9" y2="20" />
              </svg>
            </button>
            {/* OmniView — Shows all left-side elements (footnotes, citations, quotes). */}
            <button
              onClick={() => { setActiveLeft(activeLeft === "omni" ? "blank" : "omni"); }}
              className={`p-1.5 rounded transition-colors flex items-center justify-center ${activeLeft === "omni" ? "text-[var(--accent)] bg-[var(--accent-light)] shadow-[inset_0_0_0_1px_rgba(124,94,60,0.3)]" : "text-[var(--muted)] hover:bg-surface-muted-strong hover:text-ink-body"}`}
              title="Omni-view — show all left panels"
            >
              <IconOmni active={activeLeft === "omni"} />
            </button>
            {/* Split panel toggle — shaded half reflects which pane is focused */}
            <button
              onClick={() => toggleSplit("left")}
              className={`p-1.5 rounded transition-colors flex items-center justify-center ${prefs.activeLeftBottom != null ? "text-[var(--accent)] bg-[var(--accent-light)] shadow-[inset_0_0_0_1px_rgba(124,94,60,0.3)]" : "text-[var(--muted)] hover:bg-surface-muted-strong hover:text-ink-body"}`}
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
            />
          ))}
        </div>

        {/* Left panel column (always present; collapsed when inactive) */}
        {renderPanelColumn("left")}

        {/* Editor column: floating toolbar overlays the editor pod's
            top-right corner; the editor pod itself runs all the way to
            the top of the column so the text reaches the tab area. */}
        <div className={`flex-1 flex flex-col min-w-0 min-h-0 overflow-x-hidden relative${showParTitles ? "" : " hide-par-titles"}${showLatexComments ? "" : " hide-latex-comments"}${dividerClassName ? " " + dividerClassName : ""} dividers-width-${dividerWidth}`} style={{
          paddingTop: 'var(--pod-gap)',
          paddingBottom: 'var(--pod-gap)',
          paddingLeft: 4,
          paddingRight: 4,
        }}>
          {/* Floating toolbar — top-right of the editor column, overlays
              the editor pod. Sits above the pod via z-index. */}
          <div className="absolute z-30 pointer-events-none" style={{ top: 'calc(var(--pod-gap) + 6px)', right: 10, left: 10 }}>
            <div className="flex justify-end pointer-events-auto">
              <MenuBar
                editor={overrideEditor ?? editorInstance}
                onAddComment={handleAddComment}
                onArchive={handleArchive}
                onCreateFootnote={handleCreateFootnote}
                onQuoteSelection={handleQuoteSelection}
                onAddNote={handleAddNoteFromSelection}
                onCutSelection={handleCutSelection}
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
                alwaysShowLinkedText={prefs.alwaysShowLinkedText}
                onToggleAlwaysShowLinkedText={() => setAlwaysShowLinkedText((v) => !v)}
                availableDividerLevels={availableDividerLevels}
                dividerLevels={activeDividerLevels}
                onToggleDividerLevel={toggleDividerLevel}
                dividerWidth={dividerWidth}
                onSetDividerWidth={setDividerWidth}
                onParaNavBack={paraNavBack}
                onParaNavForward={paraNavForward}
                paraNavBackDisabled={paraHistoryRef.current.idx <= 0}
                paraNavForwardDisabled={paraHistoryRef.current.idx >= paraHistoryRef.current.stack.length - 1}
                onExpandAllSections={() => editorRef.current?.expandAllSections()}
                onCollapseAllSections={() => editorRef.current?.collapseAllSections()}
                onCloseAllPanels={closeAllPanels}
              />
            </div>
          </div>
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
                      highlightRange={searchHighlightRange}
                      onAddComment={handleAddComment}
                      onArchive={handleArchive}
                      onEditorReady={setEditorInstance}
                      onCitationDrop={handleCitationDrop}
                      onConfirmFootnoteMove={confirmFootnoteMove}
                      anchoredUuidsRef={anchoredUuidsRef}
                      activeAnchorId={effectiveAnchorId}
                      activeAnchorColor={effectiveAnchorColor}
                    />
                    <Marginalia
                      editor={editorInstance}
                      markers={visibleMarginaliaMarkers}
                      panelSides={marginaliaPanelSides}
                    />
                    <SelectionChip editor={editorInstance} />
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
                  highlightRange={searchHighlightRange}
                  onAddComment={handleAddComment}
                  onArchive={handleArchive}
                  onEditorReady={setEditorInstance}
                  onCitationDrop={handleCitationDrop}
                  onConfirmFootnoteMove={confirmFootnoteMove}
                  activeAnchorId={effectiveAnchorId}
                  activeAnchorColor={effectiveAnchorColor}
                />
                <Marginalia
                  editor={editorInstance}
                  markers={visibleMarginaliaMarkers}
                  panelSides={marginaliaPanelSides}
                />
                <SelectionChip editor={editorInstance} />
                {showSectionIndicator && <SectionLozenge sectionPath={currentSectionPath} />}
              </div>
            )
          ) : (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden" style={{ background: 'var(--pod-editor)', borderRadius: 'var(--pod-radius)', border: 'var(--pod-border)', boxShadow: 'var(--pod-shadow)' }}>
              <div className="flex-1 flex items-center justify-center text-[var(--muted)] text-sm">
                {docLoading ? "Loading..." : ""}
              </div>
            </div>
          )}
        </div>

        {/* Right panel column (always present; collapsed when inactive) */}
        {renderPanelColumn("right")}

        {/* Right icon strip */}
        <div data-strip-side="right" data-prefs="backgroundColor" className="flex flex-col items-center pt-2 pb-3 px-1.5 bg-[var(--background)] shrink-0 gap-1.5">
          {/* Presentation-tools pod: collapse/expand, blank, split — grouped as view controls */}
          <div className="flex flex-col items-center gap-0.5 p-1 rounded-md bg-surface/70 border border-edge-hover">
            {/* Sidebar toggle — panel-right icon indicates the right sidebar */}
            <button
              onClick={() => { activeRight ? collapseRight() : expandRight(); }}
              className={`p-1.5 rounded transition-colors flex items-center justify-center ${activeRight ? "text-[var(--accent)] bg-[var(--accent-light)] shadow-[inset_0_0_0_1px_rgba(124,94,60,0.3)]" : "text-[var(--muted)] hover:bg-surface-muted-strong hover:text-ink-body"}`}
              title={activeRight ? "Collapse panel" : "Expand panel"}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="4" width="16" height="16" rx="1.5" />
                {activeRight && <rect x="15" y="4" width="5" height="16" fill="currentColor" opacity="0.25" stroke="none" />}
                <line x1="15" y1="4" x2="15" y2="20" />
              </svg>
            </button>
            {/* OmniView — Shows all right-side elements (notes, revisions, cuts, archive). */}
            <button
              onClick={() => { setActiveRight(activeRight === "omni" ? "blank" : "omni"); }}
              className={`p-1.5 rounded transition-colors flex items-center justify-center ${activeRight === "omni" ? "text-[var(--accent)] bg-[var(--accent-light)] shadow-[inset_0_0_0_1px_rgba(124,94,60,0.3)]" : "text-[var(--muted)] hover:bg-surface-muted-strong hover:text-ink-body"}`}
              title="Omni-view — show all right panels"
            >
              <IconOmni active={activeRight === "omni"} />
            </button>
            {/* Split panel toggle — shaded half reflects which pane is focused */}
            <button
              onClick={() => toggleSplit("right")}
              className={`p-1.5 rounded transition-colors flex items-center justify-center ${prefs.activeRightBottom != null ? "text-[var(--accent)] bg-[var(--accent-light)] shadow-[inset_0_0_0_1px_rgba(124,94,60,0.3)]" : "text-[var(--muted)] hover:bg-surface-muted-strong hover:text-ink-body"}`}
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
            />
          ))}
        </div>
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
        generalRevisions={generalRevisions}
        textRevisions={textRevisions}
        users={revisionUsers}
        bibEntries={bibEntries}
        panelAiRequests={aiRequests}
        addPanelAiRequest={addAiRequest}
        deletePanelAiRequest={deleteAiRequest}
        requestBibReview={requestBibReview}
        cancelBibReview={cancelBibReview}
        addEntryRequest={addEntryRequest}
        removeEntryRequest={removeEntryRequest}
        addGeneralRevision={addGeneralRevision}
        refreshAll={() => {
          refreshBibReview();
          refreshBibSettings();
          refreshRevisions();
        }}
      />
      {confirmDialog}
      {activeRefLabel != null && activeRefRect && (
        <LabelRefPopover
          label={activeRefLabel}
          anchorRect={activeRefRect}
          labels={gatherLabels()}
          onChangeLabel={handleRefChangeLabel}
          onJumpToLabel={handleRefJump}
          onInsertRef={handleInsertRef}
          onClose={() => {
            setActiveRefLabel(null);
            setActiveRefRect(null);
          }}
        />
      )}
      {pendingFolderPick && (
        <TexFilePickerModal
          folderName={pendingFolderPick.folderName}
          texFiles={pendingFolderPick.texFiles}
          onSelect={selectFileInFolder}
          onCancel={cancelFolderPick}
        />
      )}
      {/* Floating (popped-out) cards — rendered at the EditorLayout root so
          they survive closing the source panel. Each wrapper card receives
          `isPoppedOut={true}`, which makes it wrap itself in a FloatCard
          (portal to document.body). The wrapper-internal null-return for
          in-list renders prevents double-mounting when the source panel
          is also open. */}
      {prefs.poppedOutCards.map((key) => renderPoppedCard(key, poppedCardDeps))}
      {/* Floating (popped-out) panels — rendered via portal above everything. */}
      {prefs.poppedOutPanels.map((pid, i) => {
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
          >
            {renderPanelWithChrome(pid, side)}
          </FloatingPanel>
        );
      })}
    </div>
    </PoppedCardsContext.Provider>
    </SelectionsProvider>
    </PanelViewModeProvider>
    </CitationDisplayProvider>
    </AiRequestsProvider>
    </EditorRefProvider>
    </EditorLayoutProvider>
  );
}
