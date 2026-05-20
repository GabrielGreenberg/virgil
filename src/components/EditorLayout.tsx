"use client";

import { useState, useCallback, useEffect, useLayoutEffect, useRef, useMemo, type ReactNode } from "react";
import { JSONContent } from "@tiptap/react";
import VirgilEditor, { EditorHandle } from "./Editor";
import { VIRGIL_COMMAND_NAMES } from "@/lib/tiptap-extensions";
import { isLabelTaken as isLabelTakenIn } from "@/lib/labels";
import { isDevStorage } from "@/lib/storage-mode";
import { readPdf } from "@/lib/storage";
import { type MarginaliaType, type DividerLevel, type DividerWidth } from "./MenuBar";
import { Editor } from "@tiptap/react";
import { type SectionPathEntry, buildPerBlockCounts, sumIncludedWords, extractHeadings } from "@/panels/Outline";
import { useFiles } from "@/hooks/useFiles";
import { useMyPapers } from "@/hooks/useMyPapers";
import { useUpdateAvailable, applyUpdate } from "@/hooks/useUpdateAvailable";
import { DocPipeline } from "./editor-layout/DocPipeline";
import { useSelectedAnchorSync } from "@/hooks/useSelectedAnchorSync";
import { CollabProvider, COLLAB_INERT, type CollabHook } from "@/hooks/useCollab";
import CollabStatusPill from "./CollabStatusPill";
import { useCollaboratorIdentity } from "./CollaboratorIdentityDialog";
import { useLatexCompile } from "@/hooks/useLatexCompile";
import { useLatexLint } from "@/hooks/useLatexLint";
import type { LatexError } from "@/lib/latex-errors";
import { findParagraphUuids, paragraphForLine } from "@/lib/latex-paragraph-map";
import { ErrorsHost } from "./editor-layout/panels/errors-host";
import { IconErrors } from "./editor-layout/panel-icons";
import PrintDialog from "./PrintDialog";
import FontsDialog from "./FontsDialog";
import { useSuggestions } from "@/hooks/useSuggestions";
import { useRevisions } from "@/hooks/useRevisions";
import { useTodos } from "@/hooks/useTodos";
import { useAiRequests } from "@/hooks/useAiRequests";
import type { AiRequest } from "@/lib/types";
import { useArchive } from "@/hooks/useArchive";
import { useCitations } from "@/hooks/useCitations";
import ManageStylesModal from "./ManageStylesModal";
import { useNotes } from "@/hooks/useNotes";
import { useCutter } from "@/hooks/useCutter";
import { useQuotations } from "@/hooks/useQuotations";
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
import { useDevPrefsMirror } from "@/lib/dev-prefs-mirror";
import { useScrollActivityTracker } from "@/hooks/useScrollActivityTracker";

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
import { useViewPrefs, PanelId, Side, Half, ALL_HIGHLIGHT_TYPES, HighlightType, type DockSlotKey } from "@/hooks/useViewPrefs";
import { useLinkHighlight } from "@/links/_shared/useLinkHighlight";
import {
  entityToAnchorId,
  entityKindToAnchorKind,
  type EntityKind,
} from "@/links/_shared/entity-hover";
import { PanelChromeProvider } from "./panel-primitives";
import FloatingPanel from "./FloatingPanel";
import { DockOutline } from "./editor-layout/DockOutline";
import { CardLiftOutline } from "./CardLiftOutline";
import {
  findDockTargetAtPoint,
  setDockDragTarget,
  getDockDragTarget,
} from "./editor-layout/dock-drag";
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
  findEditorScrollFor,
} from "./editor-layout/layout-scroll";
import { omniPinStore } from "./editor-layout/omni-pin-store";
import {
  IconX,
  IconLibrary,
} from "./editor-layout/panel-icons";
import { DocumentFolderTab } from "./editor-layout/DocumentFolderTab";
import { useStripHandlers } from "./editor-layout/drag-drop";
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
import { openForCard } from "./editor-layout/event-bridges/open-for-card";
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
import { SelectionsProvider, useAnchoredSelectionSlots } from "./editor-layout/contexts/selections";
import { cardStore } from "@/links/_shared/anchored-card-store";
import { PristineCardsProvider } from "./editor-layout/contexts/pristine-cards";
import { RecentlyAddedProvider } from "./editor-layout/contexts/recently-added";
import { RecentlyAddedAutoClear } from "./editor-layout/recently-added-auto-clear";
import { usePristineCardManager } from "@/hooks/usePristineCardManager";
import { useRecentlyAddedTracker } from "@/hooks/useRecentlyAddedTracker";
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
import { usePreferences } from "@/hooks/usePreferences";
// Preference mode — ctrl+click picker for live token editing. See
// usePreferenceMode.ts for the full architecture / extension guide.
import { usePreferenceMode } from "@/hooks/usePreferenceMode";
import { useHelperMode } from "@/hooks/useHelperMode";
import { useZenMode } from "@/hooks/useZenMode";
import PreferenceModePicker from "./PreferenceModePicker";
import { applyTransforms } from "@/lib/color-transforms";
import { PREF_TO_CSS, DERIVED_CSS } from "@/lib/preferences-tree";
import PreferencesModal from "./PreferencesModal";
import EditorPane, { stubAddStyleMergeRequest } from "./EditorPane";
import type { PaneState, EditorPaneViewPrefs, EditorPaneMenuBarBundle } from "./EditorPane";
import { FULL_CHROME } from "./editor-layout/chrome-config";
import { useConfirmDialog } from "./ConfirmDialog";
import { useDocumentClassMismatchDialog } from "./DocumentClassMismatchDialog";
import LabelRefPopover from "./LabelRefPopover";
import MathPopover from "./MathPopover";
import TexFilePickerModal from "./TexFilePickerModal";
import NewDocumentModal from "./NewDocumentModal";
import { useWordCount } from "@/hooks/useWordCount";
import { useWordCountConfig } from "@/hooks/useWordCountConfig";
import WordCountPanel from "@/panels/WordCount";
import { useFocusMode } from "@/hooks/useFocusMode";
import { serializeToLatex } from "@/lib/latex-serializer";
import pkg from "../../package.json";

const APP_VERSION = pkg.version;

// Stable no-op fallback for the `paneState?.X ?? noop` reads in the
// vbar source. Module-scope so JSX references stay referentially
// stable across renders.
const noop = () => {};
import type { OrphanedFootnote } from "@/lib/types";
import { hasFsaSupport } from "@/lib/fsa-support";
import { queryRW } from "@/lib/fsa-permissions";
import { getDocHandle } from "@/lib/doc-index";
import { UnsupportedBrowserNotice } from "./UnsupportedBrowserNotice";
import { DocPermissionGate } from "./DocPermissionGate";
import { RecentPapersList } from "./RecentPapersList";
import { InstallPwaPrompt } from "./InstallPwaPrompt";
import { TabPlusMenu } from "./TabPlusMenu";
import { LibraryTabView } from "./library/LibraryTabView";
import PaperOuterView from "./library/PaperOuterView";
import LibraryOuterView from "./library/LibraryOuterView";
import {
  OUTER_LIBRARY_PREFIX,
  OUTER_LIBRARY_ROOT_ID,
  OUTER_PAPER_PREFIX,
} from "@/lib/doc-index";
import { ENTRY_DT_TYPE, LIBRARY_DT_TYPE, PAPER_DT_TYPE } from "@library/lib/dnd-types";
import { addEntryToLibraryGlobal } from "@library/lib/library-store";
import { useLibraryRegistry } from "@library/hooks/useLibraryRegistry";

/**
 * Negative margins applied to the active folder tab's wrapper so the
 * layout stays pixel-stable when promoting/demoting an inline tab:
 *
 *   • LEFT (-18px): the folder's content text sits 26px in from its visual
 *     left edge (12px swoop + 14px pl-3.5). Inline labels place text 8px
 *     in (pl-2). Shifting the active wrapper left by their difference
 *     keeps the text x-position fixed across activation.
 *
 *   • RIGHT (-8px): the folder is 26px wider than the inline (12+14+4+12
 *     vs 8+8 of horizontal padding). After the -18 left shift, the folder
 *     still claims 8 more px on the right of the layout slot than the
 *     inline did. The negative marginRight reclaims that space so right-
 *     hand neighbors don't shift when a tab is activated.
 *
 * The silhouette visually extends past the inline slot on both sides —
 * fine because only one active tab exists at a time and the swoop just
 * pleasantly overlaps the gap between adjacent items.
 *
 * Both margins assume the inline label uses gap-1.5 (matching the folder's
 * child gap), so the children's combined width is identical in both
 * states regardless of the number of children (icon + label + close X).
 */
const ACTIVE_TAB_LEFT_SHIFT_PX = 18;
const ACTIVE_TAB_RIGHT_SHIFT_PX = 8;

/**
 * Inline (inactive) tab label rendered as flat clickable text in the Virgil
 * bar. Used for every outer tab that isn't the currently-active item —
 * those keep the full DocumentFolderTab silhouette.
 *
 * `variant` defaults to "tight" (pl-2 pr-2): used by paper/library/doc
 * tabs whose active counterpart applies negative margins to keep text and
 * neighbors pixel-stable across activation. The Library root tab passes
 * "library-pinned" instead (pl-[26px] pr-[26px]) — Library can't shift
 * its silhouette leftward (it's the leftmost item), so the inline label
 * pre-reserves the swoop+inner-padding space, matching the folder
 * geometry exactly.
 *
 * Omitting `onClose` hides the × button (used by the Library root tab,
 * which is permanent and can't be closed).
 */
function InlineTabLabel({
  icon,
  label,
  title,
  monospace,
  variant = "tight",
  onClick,
  onClose,
}: {
  icon?: ReactNode;
  label: string;
  title: string;
  monospace?: boolean;
  variant?: "tight" | "library-pinned";
  onClick: () => void;
  onClose?: () => void;
}) {
  const padding =
    variant === "library-pinned" ? "pl-[26px] pr-[26px]" : "pl-2 pr-2";
  // Hover lozenge hugs the content with ~8px breathing room on each
  // side. The tight variant's wrapper already sits at content + 8px,
  // so `inset-x-0` is correct. The library-pinned wrapper carries 26px
  // of padding (to keep the inline footprint stable with the active
  // Library folder silhouette), so the lozenge insets 18px to land at
  // the same content + 8px feel.
  const hoverBgInsetX =
    variant === "library-pinned" ? "inset-x-[18px]" : "inset-x-0";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      title={title}
      className={`group relative flex items-center gap-1.5 ${padding} h-[24px] cursor-default shrink-0`}
    >
      <div
        aria-hidden
        className={`absolute inset-y-0 rounded transition-colors group-hover:bg-black/5 ${hoverBgInsetX}`}
      />
      {icon ? <span className="relative inline-flex">{icon}</span> : null}
      <span
        className="relative text-[13px] leading-4 truncate max-w-[220px]"
        style={monospace ? { fontFamily: "var(--mono)" } : undefined}
      >
        {label}
      </span>
      {onClose ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="relative topbarbtn topbarbtn-icon opacity-40 group-hover:opacity-100 hover:!opacity-100 transition-opacity"
          title="Close tab"
          data-helper="Close tab"
        >
          <IconX />
        </button>
      ) : null}
    </div>
  );
}

/** Thin vertical divider drawn between non-Library tabs. Always occupies
 *  layout space (so promoting/demoting a tab doesn't shift its neighbors);
 *  only painted when both adjacent tabs are inline — adjacent to the active
 *  folder tab, the silhouette's edge serves as the divider so the line is
 *  hidden via `visibility: hidden`. Same pattern as Chrome/Edge. */
function TabSeparator({ visible }: { visible: boolean }) {
  return (
    <span
      aria-hidden
      className="self-center inline-block shrink-0 w-px h-4 mx-1"
      style={{
        background: "var(--edge-strong, #a8a29e)",
        visibility: visible ? "visible" : "hidden",
      }}
    />
  );
}

export default function EditorLayout() {
  // Dev-only: mirror personal localStorage prefs to disk for the
  // promote-defaults pipeline. No-op in production builds.
  useDevPrefsMirror();

  // Global auto-hide scrollbars: paints `data-scroll-active` on the
  // scrolled element for 1s after the last scroll event so CSS can
  // reveal the thumb on activity. Hover-reveal is CSS-only.
  useScrollActivityTracker();

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
    focusDoc,
    outerOrder,
    currentPaperCitekey,
    openPaperTab,
    closePaperTab,
    activatePaperPane,
    currentLibraryOuterId,
    openLibraryOuterTab,
    closeLibraryOuterTab,
    activateLibraryOuterPane,
  } = useFiles();
  const libraryRegistry = useLibraryRegistry();
  const { myPaperIds, addMyPaper, removeMyPaper } = useMyPapers();

  useLibraryBridge({ activateLibraryOuterPane });

  // "New document" modal state. `mode: "fresh"` uses the OS directory
  // picker; `mode: "inFolder"` writes into the already-picked folder
  // that's behind the current TexFilePicker modal. `onCreated` is fired
  // with the new doc id after creation — the inline Library tab's
  // "+ Add paper → Create new…" path uses it to auto-add to My Papers.
  const [newDocModal, setNewDocModal] = useState<
    | { mode: "fresh"; onCreated?: (id: string) => void }
    | { mode: "inFolder"; folderName: string; onCreated?: (id: string) => void }
    | null
  >(null);

  // Per-doc permission gate state. We query (without prompting) when
  // the active doc changes; if it isn't already granted we show the
  // gate, which calls requestRW from inside its click handler.
  type DocPermState = "loading" | "granted" | "needs-grant" | "no-handle";
  const [docPermState, setDocPermState] = useState<DocPermState>("loading");
  const [activeDocHandle, setActiveDocHandle] = useState<FileSystemDirectoryHandle | null>(null);

  // EditorPane bubbles its per-doc state here via `onPaneStateChange`
  // so the Virgil bar can read editor / compile / view-switch / AI-dot
  // status against the live values without owning the hooks itself.
  const [paneState, setPaneState] = useState<PaneState | null>(null);

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

  // Per-doc write pipeline lifecycle is now owned by the `<DocPipeline
  // key={currentDocId}>` boundary that wraps the EditorPane mount below
  // (search this file for "<DocPipeline"). That boundary's `key=` is
  // the architectural wall against the cross-doc autosave bug — every
  // doc switch fully remounts EditorPane, useDocument, and TipTap, so
  // no stale closure or editor state can carry the prior doc's content
  // into the next doc's save.
  //
  // Mismatch prompt: fired by the compile hook when the source's
  // `\documentclass` doesn't define one of the sectioning commands used
  // (e.g. `\chapter` inside `article`). Mount `docClassDialog` near the
  // other root-level dialogs so it overlays everything.
  const [pdfView, setPdfView] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [lastCompileTime, setLastCompileTime] = useState<number | null>(null);
  // See EditorPane.tsx for the rationale — `lastEditTime` is a ref so
  // typing doesn't force a per-keystroke EditorLayout re-render. The
  // `pdfStale` boolean carries the only observable signal React needs.
  const lastEditTimeRef = useRef<number | null>(null);
  const [pdfStale, setPdfStale] = useState(false);
  const pdfStaleRef = useRef(false);
  pdfStaleRef.current = pdfStale;
  const lastCompileTimeRef = useRef<number | null>(null);
  lastCompileTimeRef.current = lastCompileTime;
  const latestPdfBytes = useRef<Uint8Array | null>(null);

  useEffect(() => {
    setPdfView(false);
    setLastCompileTime(null);
    setPdfStale(false);
    lastEditTimeRef.current = null;
    latestPdfBytes.current = null;
    return () => {
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
      setPdfBlobUrl(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDocId]);

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
    onCompileSuccess: useCallback((pdfBytes: Uint8Array) => {
      latestPdfBytes.current = pdfBytes;
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
      setPdfBlobUrl(URL.createObjectURL(blob));
      setLastCompileTime(Date.now());
      // Compile lands fresh → PDF is in sync until next edit.
      setPdfStale(false);
      if (docIdForHooks) activateDocPane(docIdForHooks);
      setCodeView(false);
      setPdfView(true);
    }, [pdfBlobUrl, activateDocPane, docIdForHooks]),
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
    cards: revisionCards,
    addComment: addRevisionComment,
    addSuggestion: addRevisionSuggestion,
  } = useRevisions(docIdForHooks);
  const comments = revisionCards;
  // Unified pristine-card manager — tracks blank-on-create cards across all
  // kinds and discards them via a global click-away listener once the user
  // clicks outside the card's DOM. Each per-kind hook gets its slice here.
  const pristineManager = usePristineCardManager();
  const recentlyAdded = useRecentlyAddedTracker();
  const notePristine = useMemo(() => pristineManager.forKind("note"), [pristineManager]);
  const cutPristine = useMemo(() => pristineManager.forKind("cut"), [pristineManager]);
  const todoPristine = useMemo(() => pristineManager.forKind("todo"), [pristineManager]);
  const quotationPristine = useMemo(() => pristineManager.forKind("quotation"), [pristineManager]);
  const citationPristine = useMemo(() => pristineManager.forKind("citation"), [pristineManager]);
  const footnotePristine = useMemo(() => pristineManager.forKind("footnote"), [pristineManager]);
  const {
    notes,
    highlights,
    addNote,
    addHighlight,
    addNoteParagraphId,
    removeNoteParagraphId,
    deleteNote,
    setNoteAnchor,
    discardPristineNotes,
  } = useNotes(docIdForHooks, notePristine);
  const {
    cards: cutterCards,
    goal: cutterGoal,
    addComment: addCutterComment,
    addSuggestion: addCutterSuggestion,
    setGoal: setCutterGoal,
    clearGoal: clearCutterGoal,
    addCardParagraphId,
    removeCardParagraphId,
    deleteCard: deleteCutterCard,
    discardPristineCards,
  } = useCutter(docIdForHooks, cutPristine);
  // Anchored selection slots (note, footnote, citation, quotation, example,
  // todo, archive, comment, cutter-comment) are now derived from the global
  // cardStore via this hook — single source of truth, shared with EditorPane
  // and any other surface. The legacy useState declarations they replaced
  // lived here and around line 1403.
  const {
    selectedNoteId, setSelectedNoteId,
    selectedFootnoteId, setSelectedFootnoteId,
    selectedCitationId, setSelectedCitationId,
    selectedTodoId, setSelectedTodoId,
    selectedArchiveId, setSelectedArchiveId,
    selectedCutterCardId, setSelectedCutterCardId,
    selectedQuotationGroupId, setSelectedQuotationGroupId,
    selectedCommentId, setSelectedCommentId,
    selectedExampleId, setSelectedExampleId,
  } = useAnchoredSelectionSlots();
  const {
    groups: quotationGroups,
    addGroup: addQuotationGroup,
    deleteGroup: deleteQuotationGroup,
    addParagraphId: addQuotationParagraphId,
    removeParagraphId: removeQuotationParagraphId,
  } = useQuotations(docIdForHooks, quotationPristine);
  const {
    items: todoItems,
    addItem: addTodo,
    updateItem: updateTodo,
    deleteItem: deleteTodo,
    archiveDone: archiveTodos,
    addParagraphId: addTodoParagraphId,
    removeParagraphId: removeTodoParagraphId,
    discardPristineTodos,
  } = useTodos(docIdForHooks, todoPristine);

  const {
    requests: aiRequests,
    addRequest: addAiRequest,
    addStyleMergeRequest,
    updateRequestText: updateAiRequestText,
    deleteRequest: deleteAiRequest,
  } = useAiRequests(docIdForHooks);

  const {
    snippets: archiveSnippets,
    archiveContent,
    updateSnippet: updateArchiveSnippet,
    addParagraphId: addArchiveParagraphId,
    removeParagraphId: removeArchiveParagraphId,
    restoreSnippet,
    deleteSnippet,
  } = useArchive(docIdForHooks);

  const {
    citations,
    bibPath,
    citationStyle,
    bibEntries,
    addCitation,
    deleteCitation,
    setStyle: setCitationStyle,
    setBibPackage,
    addBibEntry,
    getDisplayText: getCitationDisplayText,
  } = useCitations(docIdForHooks, citationPristine);

  // The live collab hook lives in EditorPane (which mounts inside
  // <DocPipeline> and therefore holds a valid write handle). We read
  // it back here so the topbar's collab icon/badge drive real
  // mutations. Falls back to the inert no-op hook when no doc is
  // loaded — every action is a safe no-op until paneState bubbles up.
  const collab: CollabHook = paneState?.collab ?? COLLAB_INERT;
  const { ensureIdentity, dialog: identityDialog } = useCollaboratorIdentity();

  const handleEnableCollab = useCallback(async () => {
    const id = await ensureIdentity();
    if (!id) return;
    collab.setIdentity(id);
    await collab.enableCollab();
  }, [ensureIdentity, collab]);

  const handleEditIdentity = useCallback(async () => {
    const id = await ensureIdentity({ force: true });
    if (id) collab.setIdentity(id);
  }, [ensureIdentity, collab]);

  const handleDisableCollab = useCallback(() => {
    void collab.disableCollab();
  }, [collab]);

  const collabIconBtn = (
    <CollabStatusPill
      collab={collab}
      onEnableRequest={() => void handleEnableCollab()}
      onEditIdentity={() => void handleEditIdentity()}
      onDisable={handleDisableCollab}
      variant="icon"
    />
  );
  const collabBadge = (
    <CollabStatusPill
      collab={collab}
      onEnableRequest={() => void handleEnableCollab()}
      onEditIdentity={() => void handleEditIdentity()}
      onDisable={handleDisableCollab}
      variant="badge"
    />
  );

  const {
    prefs,
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
    setShowHighlights,
    toggleHighlightType,
    togglePopout,
    closePopout,
    openPanelFloat,
    openPanelDocked,
    undockPanel,
    redockPanel,
    setFloatPosition,
    toggleCardPopout,
    closeCardPopout,
    setCardFloatPosition,
    setPrintOptions,
    setEditorLeftMargin,
    setEditorRightMargin,
    setTopGutter,
    setBottomGutter,
    setTopbarRightCollapsed,
  } = useViewPrefs();
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const editorSplit = prefs.editorSplit;
  const editorSplitRatio = prefs.editorSplitRatio;

  // Which half (top or bottom) is currently focused on each side. Used to
  // route strip-icon clicks when the side is split. Session-only state.
  const [focusedHalfLeft, setFocusedHalfLeft] = useState<Half>("top");
  const [focusedHalfRight, setFocusedHalfRight] = useState<Half>("top");

  // Transient dock-zone flash on split toggle. Splitting a side doesn't
  // visually change the column when no panels are docked; this brief
  // outline pulse communicates *where* the two dock zones live so the
  // toggle isn't silent. Reuses the DockOutline machinery (primary +
  // companion rects with WAAPI fade) for a ~720ms pulse.
  const prevSplitLeftRef = useRef(prefs.activeLeftBottom != null);
  const prevSplitRightRef = useRef(prefs.activeRightBottom != null);
  useEffect(() => {
    const isSplitLeft = prefs.activeLeftBottom != null;
    const isSplitRight = prefs.activeRightBottom != null;
    const flash = (side: Side) => {
      const col = document.querySelector<HTMLElement>(
        `[data-panel-column-side="${side}"]`,
      );
      if (!col) return;
      const r = col.getBoundingClientRect();
      const splitState = { left: isSplitLeft, right: isSplitRight };
      const target = findDockTargetAtPoint(
        r.left + r.width / 2,
        r.top + r.height * 0.25,
        splitState,
      );
      if (!target) return;
      setDockDragTarget(target);
      window.setTimeout(() => {
        const cur = getDockDragTarget();
        // Only clear if the flash is still the active target — if a
        // drag started in the meantime its mousemove already overwrote.
        if (cur && cur.slotKey === target.slotKey && !cur.companionRect === !target.companionRect) {
          setDockDragTarget(null);
        }
      }, 720);
    };
    if (isSplitLeft && !prevSplitLeftRef.current) flash("left");
    if (isSplitRight && !prevSplitRightRef.current) flash("right");
    prevSplitLeftRef.current = isSplitLeft;
    prevSplitRightRef.current = isSplitRight;
  }, [prefs.activeLeftBottom, prefs.activeRightBottom]);
  // Which pane last received focus — used to route panel interactions
  // (outline clicks, note jumps, etc.) to the pane the user is in.
  const [activeSplitPane, setActiveSplitPane] = useState<"top" | "bottom">("top");
  const mirrorViewRef = useRef<import("prosemirror-view").EditorView | null>(null);

  // Editor column ref — kept here as a placeholder; the actual
  // editor column rendering lives inside EditorPane post-7.8.
  // Some legacy code paths (search, error highlight scroll) still
  // need to address it; they consult `editorRef` directly now.

  // Detached-toolbar state (Actions / Formatting / Menu copies) lives
  // inside EditorPane post-7.8; the EditorLayout shell only references
  // toolbar refs (menuWrapRef, topbarLeftRef, topbarRightRef, etc.) for
  // home-position computation, which remain in scope below.

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
      if (pruned.length === prev.length && additions.length === 0) return prev;
      return [...pruned, ...additions];
    });
  }, [prefs.poppedOutPanels, prefs.poppedOutCards]);

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
      // `toolbar` kind no longer originates here — EditorPane owns
      // the detached toolbars and dismisses them via its own MRU.
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [focusStack, closePopout, closeCardPopout]);

  // (menuWrapStyle is declared below, after the zen
  // mode hook is available — zen force-pins the toolbar at home regardless
  // of the persisted location.)

  const editorRef = useRef<EditorHandle>(null);

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
  // When the list of popped-out paragraphs changes from anywhere other
  // than the gutter button (e.g. float's own X, restored from prefs),
  // ping the editor so every paragraph node view rebuilds its glyph.
  // (The ref EditorPane passes to its VirgilEditor handles the per-render
  // glyph predicate; this just nudges the editor on prefs change.)
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

  // ── Collab pen → TipTap read-only gate.
  // When collab is enabled and the partner holds the pen, the editor is
  // locked. When collab is off or we hold the pen, full editing.
  useEffect(() => {
    if (!editorInstance) return;
    const want = collab.canEditMainText;
    if (editorInstance.isEditable !== want) {
      editorInstance.setEditable(want);
    }
  }, [editorInstance, collab.canEditMainText]);

  // ── Activity tracker — bump pen activity on real input while we hold it.
  // Throttled inside useCollab.bumpActivity.
  useEffect(() => {
    if (!editorInstance || !collab.iHavePen) return;
    const onTr = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (transaction.docChanged) collab.bumpActivity();
    };
    editorInstance.on("transaction", onTr);
    return () => {
      editorInstance.off("transaction", onTr);
    };
  }, [editorInstance, collab.iHavePen, collab.bumpActivity]);
  // useWordCount is consumed inside EditorPane (per-doc); no shell-side
  // counter needed.
  const focusMode = useFocusMode(docIdForHooks);
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
  // Heading labels visibility — persisted
  const [showHeadingLabels, setShowHeadingLabels] = useState(() => {
    if (typeof window === "undefined") return true;
    try { const v = localStorage.getItem("virgil-show-heading-labels"); return v !== "false"; } catch { return true; }
  });
  const toggleHeadingLabels = useCallback(() => {
    setShowHeadingLabels((prev) => {
      const next = !prev;
      try { localStorage.setItem("virgil-show-heading-labels", String(next)); } catch {}
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
  const [commandsPopoutOpen, setCommandsPopoutOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [fontsOpen, setFontsOpen] = useState(false);
  const [helperMenuOpen, setHelperMenuOpen] = useState(false);
  // Open state for ManageStylesModal — lifted from the old
  // DocStyleDropdown so the Virgil bar's Style mode button can mirror
  // its aria-pressed state.
  const [manageStylesOpen, setManageStylesOpen] = useState(false);

  // Margin-edit mode (interactive page-margin guides) was deleted with
  // the visual editor JSX; reintroduce inside EditorPane to bring it
  // back. The bundle's `onOpenMarginsMode` is currently a noop so the
  // ViewMenu item simply does nothing.
  const enterMarginEditMode = useCallback(() => {
    /* margin-edit UI not yet ported to EditorPane */
  }, []);

  useEffect(() => {
    if (!helperMenuOpen) return;
    const close = () => { setHelperMenuOpen(false); setCommandsPopoutOpen(false); };
    const id = window.setTimeout(() => window.addEventListener("click", close), 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("click", close);
    };
  }, [helperMenuOpen]);

  const insertVirgilCommand = useCallback((name: string) => {
    const editor = editorRef.current?.getEditor();
    if (!editor) return;
    editor.chain().focus().insertContent(`\\${name}`).run();
    setHelperMenuOpen(false);
    setCommandsPopoutOpen(false);
  }, []);
  const { prefs: editorPrefs, transforms: editorTransforms, presets: editorPresets, updatePref, updateTransform, resetAll: resetPrefs, savePreset, loadPreset, deletePreset } = usePreferences();
  // Preference mode toggle. `on` drives the top-bar button styling and gates
  // the ctrl+click picker. Read-only here — the button itself calls toggle().
  const { on: prefModeOn, toggle: togglePrefMode } = usePreferenceMode();
  const helperMode = useHelperMode();
  const updateAvailable = useUpdateAvailable();
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
  } = useZenMode();

  // Snap all panel/margin prefs to their current rendered widths. Called
  // on drag start so that when the flex switches from "1 100 pref"
  // (shrinkable) to "0 0 pref" (pinned), shrunk panels don't snap back
  // to pref and jump the editor. Scoped to the document — `[data-flex-col]`
  // is a unique attribute on the active EditorPane's panel columns.
  const syncPanelPrefsToRendered = useCallback(() => {
    const cols = document.querySelectorAll<HTMLElement>('[data-flex-col]');
    cols.forEach((col) => {
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

  // The editor-basis recompute, panel-min-height observer, MenuBar
  // home-position style, and zen-margin-snapshot toggle that used
  // `mainAreaRef` / `editorColRef` / `colRect` / `topbarGaps` /
  // `menuWrapSize` all moved into EditorPane (or were dropped) along
  // with the visual editor JSX. The shell-side zen toggle is a
  // straight pass-through now.
  const handleToggleZen = useCallback(() => {
    toggleZenMode();
  }, [toggleZenMode]);
  const [latestDoc, setLatestDoc] = useState<JSONContent | null>(null);
  const [commentHighlight, setCommentHighlight] = useState<string | null>(null);
  const [pendingCommentText, setPendingCommentText] = useState<string | null>(null);
  // Anchored selection slots are declared above near useCutter — derived
  // from the cardStore via useAnchoredSelectionSlots.
  const [orphanedFootnotes, setOrphanedFootnotes] = useState<OrphanedFootnote[]>([]);
  const suppressOrphanRef = useRef<Set<string>>(new Set());
  const [selectedBibKey, setSelectedBibKey] = useState<string | null>(null);
  // Marker-click → omni card alignment. The user clicked at viewport Y
  // `clickY` and we want the corresponding omni card to lock there.
  // Conversion to pod-relative happens here, at the publish site: the
  // wrapper's `.parentElement` is the pod that hosts all absolute card
  // wrappers, and `clickY - podRect.top` is the pod-relative Y that the
  // OmniViewPanel renders directly (no further conversion in the hook).
  // Scroll-invariant by construction — the pod scrolls with the row, so
  // pod-relative stays valid through any subsequent natural scroll.
  //
  // If the panel isn't yet mounted (omni column was activated this
  // render), retry one frame later — that's enough for `openForCard`'s
  // setActiveLeft/setActiveRight to commit and the OmniViewPanel to
  // render its first frame.
  const alignOmniCardWithClick = useCallback(
    (cardId: string, clickY: number, _sourceEl: HTMLElement | null) => {
      let tried = false;
      const apply = () => {
        const wrapper = document.querySelector(
          `[data-omni-entry-wrapper="${cardId}"]`,
        ) as HTMLElement | null;
        const sideEl = wrapper?.closest("[data-panel-column-side]") as HTMLElement | null;
        const side = sideEl?.dataset.panelColumnSide;
        const pod = wrapper?.parentElement as HTMLElement | null;
        if ((side !== "left" && side !== "right") || !pod) {
          if (!tried) {
            tried = true;
            requestAnimationFrame(apply);
          }
          return;
        }
        const pinTop = clickY - pod.getBoundingClientRect().top;
        omniPinStore.requestPin(side, cardId, pinTop);
      };
      apply();
    },
    [],
  );

  // Card-body click → editor scroll alignment. `jumpToLink`/`jumpToCard`
  // (links.ts) scroll the row so the in-text anchor lands at the card's
  // pre-jump viewport Y. The publisher there computes `pinTop` from the
  // pre-scroll pod rect (pod-relative is scroll-invariant under unified
  // scroll, so the pre-scroll value is already correct post-scroll) and
  // hands it to us as `detail.pinTop`. We just route to the right side
  // and publish — no rAF, no post-scroll measurement.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { omniKey?: string; pinTop?: number }
        | undefined;
      if (!detail?.omniKey || typeof detail.pinTop !== "number") return;
      const { omniKey, pinTop } = detail;
      const wrapper = document.querySelector(
        `[data-omni-entry-wrapper="${omniKey}"]`,
      );
      const sideEl = wrapper?.closest("[data-panel-column-side]") as HTMLElement | null;
      const side = sideEl?.dataset.panelColumnSide;
      if (side !== "left" && side !== "right") return;
      omniPinStore.requestPin(side, omniKey, pinTop);
    };
    window.addEventListener("virgil-card-jumped", handler);
    return () => window.removeEventListener("virgil-card-jumped", handler);
  }, []);
  // Auto-clear-on-offscreen: keep the infrastructure here but disabled
  // for now. Flip CLEAR_OFFSET_ON_OFFSCREEN to true to clear a side's
  // offset once its anchor scrolls out of the visible row band. With it
  // (Auto-clear-on-offscreen for omni cards was kept disabled here and
  // depended on the EditorLayout-side mainAreaRef. Removed with the
  // 7.8 mount swap; reintroduce inside EditorPane if needed.)

  // Linked-entity hover/activation. One pair drives all three linked
  // surfaces (text passages, margin icons, panel cards). Per-kind
  // selected*Id slots remain for backwards compatibility, but hover is
  // entirely centralized — no per-kind hover handlers anywhere.
  //   activeAnchorId / activeAnchorKind — sticky, set on click of icon
  //     or card (for Mode B kinds: note / revision / cutter)
  //   hoveredEntityId / hoveredEntityKind — transient, set on hover
  //     of any of the three surfaces, generic across all card kinds
  // Effective anchor for the in-text highlight = hover ?? active.
  const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null);
  const [activeAnchorKind, setActiveAnchorKind] = useState<"note" | "highlight" | "revision" | "cutter-comment" | "cutter-suggestion" | null>(null);
  // Hover state for legacy EditorLayout-side consumers (color-theming for
  // active anchors, MARKER_KIND_TO_THEME_KEY lookup). Kept synced from the
  // canonical cardStore.hover via useSyncExternalStore-style subscription
  // so callers can read it without subscribing themselves. New code should
  // read cardStore directly via useHover().
  const _paneHoverState = useSyncExternalStore(
    cardStore.subscribe,
    () => cardStore.getState().hover,
    () => null,
  );
  const hoveredEntityId = _paneHoverState?.id ?? null;
  const hoveredEntityKind = _paneHoverState?.kind ?? null;

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
  // Derive Mode B text-range anchor id from the central hovered-entity
  // state. Generic — works for note / revision / cut without per-kind code.
  const hoveredAnchorId = useMemo(() => {
    if (!hoveredEntityId || !hoveredEntityKind) return null;
    return entityToAnchorId(
      { id: hoveredEntityId, kind: hoveredEntityKind },
      { notes, cutterCards, comments, todos: todoItems, archiveSnippets, quotationGroups, examples: [] },
    );
  }, [hoveredEntityId, hoveredEntityKind, notes, cutterCards, comments, todoItems, archiveSnippets, quotationGroups]);

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
  // ── Math popover state ──
  const [activeMath, setActiveMath] = useState<{
    kind: "inline" | "display";
    latex: string;
    pos: number;
    rect: DOMRect;
  } | null>(null);
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

  // Per-side "hide all cards in omni-view" mode. Sticky toggle driven by
  // the dashed-square button in each strip's presentation-tools pod.
  const [omniHideAllCards, setOmniHideAllCards] = useState<Record<"left" | "right", boolean>>(() => {
    if (typeof window === "undefined") return { left: false, right: false };
    try {
      const raw = localStorage.getItem("virgil-omni-hide-all-cards");
      if (!raw) return { left: false, right: false };
      const parsed = JSON.parse(raw);
      return {
        left: Boolean(parsed?.left),
        right: Boolean(parsed?.right),
      };
    } catch { return { left: false, right: false }; }
  });
  const toggleOmniHideAllCards = useCallback((side: "left" | "right") => {
    setOmniHideAllCards((prev) => {
      const next = { ...prev, [side]: !prev[side] };
      try { localStorage.setItem("virgil-omni-hide-all-cards", JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);
  const getOmniHideAll = useCallback(
    (side: "left" | "right") => omniHideAllCards[side],
    [omniHideAllCards],
  );

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
        value = raw == null ? "" : entry.transform(raw);
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

  // Route Cmd/Ctrl+P to our Print dialog instead of the browser's bare
  // print sheet. Falls through to the browser when there's no active
  // doc or in code view (where our dialog is disabled).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isPrint = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "p";
      if (!isPrint) return;
      if (!currentDocId || codeView || pdfView) return;
      e.preventDefault();
      setPrintOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [currentDocId, codeView, pdfView]);

  // Mirrored LaTeX text from the CodeEditor — fed to the live lint hook
  // and to the Errors panel for snippet/paragraph derivation. Persists
  // across view switches so the Errors panel stays populated when the
  // user returns to rich-text view.
  const [codeEditorText, setCodeEditorText] = useState<string | null>(null);
  const handleCodeEditorTextChange = useCallback((text: string) => {
    setCodeEditorText(text);
    // Write the edit timestamp to the ref (no re-render). Flip
    // pdfStale false→true once per compile cycle, mirroring the
    // visual-editor onUpdate handler below.
    lastEditTimeRef.current = Date.now();
    if (lastCompileTimeRef.current != null && !pdfStaleRef.current) {
      setPdfStale(true);
    }
  }, []);
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

  // Click-away: clear the transient selection when the user clicks
  // outside any anchored surface. Sticky selections (hand-clicked cards
  // and transients promoted via focus-in) are never touched here — they
  // close only by clicking the card again. Bib and error are non-anchored
  // — they get their own local clear so unrelated selection is cleared too.
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (
        t.closest("[data-card-key]") ||
        t.closest("[data-marginalia-marker]") ||
        t.closest(".linked-anchor") ||
        t.closest(".footnote-marker") ||
        t.closest('[data-type="citation"]')
      ) {
        return;
      }
      cardStore.setTransient(null);
      setSelectedBibKey(null);
      setSelectedErrorId(null);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
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
      if (codeView || pdfView) {
        pendingParagraphId.current = paragraphByErrorId.get(err.id) ?? null;
        pendingScrollText.current = null;
        codeEditorHandleRef.current = null;
        setCodeView(false);
        setPdfView(false);
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
    [codeView, pdfView, paragraphByErrorId, computeErrorHighlightRange],
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
          const scrollEl = findEditorScrollFor(editorInstance.view.dom);
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
      // Soft-presence: broadcast cursor paragraph for the partner. The
      // hook de-dupes if unchanged, so safe to call every tick.
      collab.updateCursorParagraph(paraId);
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
      const scrollEl = findEditorScrollFor(editorInstance.view.dom);
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

  // Para nav disabled state — derived from `paraHistoryRef.current` so it
  // updates when paraNavVersion bumps. Bumped from `paraNavBack` and
  // `paraNavForward` plus the history-recording effect.
  const paraNavBackDisabled = paraHistoryRef.current.idx <= 0;
  const paraNavForwardDisabled =
    paraHistoryRef.current.idx >= paraHistoryRef.current.stack.length - 1;

  // Derive citation order from editor state
  // Debounced citation order and editor citations (avoid recomputing on every keystroke)
  const [citationOrder, setCitationOrder] = useState<string[]>([]);
  const [allEditorCitations, setAllEditorCitations] = useState<Array<{ citationId: string; command: string; keys: string[]; pos: number }>>([]);

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

  // Anchored-card hover/selection bridges + highlight painters are
  // mounted inside EditorPane (U3). EditorPane is always rendered
  // by EditorLayout in editor mode and standalone by the Library
  // Reader, so both surfaces inherit identical plumbing without
  // duplication. EditorLayout's local hoveredEntityId/Kind stays
  // in sync via the cardStore.subscribe effect declared above.

  // Clear the toolbar-override editor when the main editor regains focus,
  // so the MenuBar switches back to controlling the document editor.
  useEffect(() => {
    if (!editorInstance) return;
    const clearOverride = () => setOverrideEditor(null);
    editorInstance.on("focus", clearOverride);
    return () => { editorInstance.off("focus", clearOverride); };
  }, [editorInstance]);

  // ── Focus mode ──────────────────────────────────────────────────
  // Focus view confines the visible band of the editor: when focus is
  // active, top-level children outside [startBlockIndex, endBlockIndex]
  // are hidden via `display: none`. The active/locked distinction lives
  // only in the Outline panel — for the editor itself, active === hide.
  //
  // Mechanism: an injected <style> tag with nth-child selectors. We
  // can't stamp a data attribute on the children themselves because
  // ProseMirror's DOM reconciliation strips classes/attrs from its
  // managed nodes. A <style> tag is outside the editor and immune.
  //
  // The stylesheet is rebuilt only when the focus range, the lock state,
  // or the top-level child count change — not on every transaction.
  const focusStyleRef = useRef<HTMLStyleElement | null>(null);
  const focusStateRef = useRef(focusMode.state);
  focusStateRef.current = focusMode.state;
  const prevLockedRef = useRef(false);

  // Track the top-level child count so we rebuild the stylesheet when
  // blocks are added/removed (only docChanged transactions can change
  // it, so listening on `update` is sufficient).
  const [editorChildCount, setEditorChildCount] = useState(0);
  useEffect(() => {
    if (!editorInstance) return;
    let editorDom: HTMLElement | null = null;
    try { editorDom = editorInstance.view.dom; } catch { editorDom = null; }
    if (!editorDom) return;
    setEditorChildCount(editorDom.children.length);
    const onUpdate = () => {
      if (!editorDom) return;
      setEditorChildCount(editorDom.children.length);
    };
    editorInstance.on("update", onUpdate);
    return () => { editorInstance.off("update", onUpdate); };
  }, [editorInstance]);

  useEffect(() => {
    // Tear down any previous stylesheet.
    if (focusStyleRef.current) {
      focusStyleRef.current.remove();
      focusStyleRef.current = null;
    }

    const fs = focusMode.state;
    if (!fs.active || !editorInstance || editorChildCount === 0) return;

    const rules: string[] = [];
    for (let i = 0; i < editorChildCount; i++) {
      const outside = i < fs.startBlockIndex || i > fs.endBlockIndex;
      if (outside) {
        rules.push(`.tiptap > :nth-child(${i + 1}) { display: none !important; }`);
      }
    }
    if (rules.length === 0) return;

    const style = document.createElement("style");
    style.setAttribute("data-virgil-focus", "true");
    style.textContent = rules.join("\n");
    document.head.appendChild(style);
    focusStyleRef.current = style;

    return () => {
      if (focusStyleRef.current) {
        focusStyleRef.current.remove();
        focusStyleRef.current = null;
      }
    };
  }, [editorInstance, focusMode.state, editorChildCount]);

  // One-shot cursor coercion: fires only on the false→true lock
  // transition, not on every focus-state change. This decouples it
  // from range moves, expansions, and unlocks — and from any
  // concurrent card-creation transaction that might race with it.
  useEffect(() => {
    if (!editorInstance) return;
    const fs = focusMode.state;
    const nowLocked = fs.active && fs.locked;
    if (nowLocked && !prevLockedRef.current) {
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
    prevLockedRef.current = nowLocked;
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
    const scrollEl = findEditorScrollFor(view.dom);
    if (!scrollEl) return;

    const compute = () => {
      const doc = editorInstance.state.doc;
      // Collect all top-level headings with their text + level + DOM top
      const scrollRect = scrollEl.getBoundingClientRect();
      // Reference line: top 25% of the editor viewport. A heading or
      // parTitle becomes "active" once it has scrolled above this line.
      // Conservative on purpose — when a doc first opens the user is
      // typically looking at the title, and we don't want to announce
      // the first section until they've actually scrolled toward it.
      const referenceY = scrollRect.top + scrollRect.height * 0.25;

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
    const scrollEl = findEditorScrollFor(mirrorView.dom);
    if (!scrollEl) return;

    const compute = () => {
      const doc = mirrorView.state.doc;
      const scrollRect = scrollEl.getBoundingClientRect();
      // Same top-25% reference as the canonical pane — see note above.
      const referenceY = scrollRect.top + scrollRect.height * 0.25;

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
  // Recomputes on `editorInstance` change (initial mount + doc-switch
  // remount via the DocPipeline boundary) and on `latestDoc` (debounced
  // post-edit), which together cover hydration and ongoing edits.
  const footnotes = useMemo(() => {
    return editorRef.current?.getFootnotes() ?? [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestDoc, editorInstance]);

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
  // Refs to each rendered outer-tab pair (keyed by entry id — doc id or
  // `paper:<citekey>`). Used by the tab-strip's drop handler to compute
  // an insertion index when a paper inner tab is dragged onto the bar.
  const outerTabRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [paperDropIndex, setPaperDropIndex] = useState<number | null>(null);
  // Library outer tab id currently being hovered with an entry drag.
  // Drives the accent outline / fill on that tab so the user sees the
  // drop target light up.
  const [entryDropOuterLibId, setEntryDropOuterLibId] = useState<string | null>(
    null,
  );
  const tabStripRef = useRef<HTMLDivElement | null>(null);
  // FSA browser support — defaults to true for SSR/initial render to
  // avoid a flash, then re-checks after mount.
  const [fsaSupported, setFsaSupported] = useState(true);
  useEffect(() => {
    setFsaSupported(hasFsaSupport());
  }, []);
  const nameInputRef = useRef<HTMLInputElement>(null);


  useEffect(() => {
    if (editingTabId) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
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
    setLatestDoc,
  });

  // ── Focus mode helpers ─────────────────────────────────────────────
  const docForOutline = latestDoc;
  const outlineHeadings = useMemo(() => extractHeadings(docForOutline).headings, [docForOutline]);
  const outlineTotalBlocks = useMemo(() => docForOutline?.content?.length ?? 0, [docForOutline]);
  const availableDividerLevels = useMemo(() => {
    const s = new Set<DividerLevel>();
    outlineHeadings.forEach((h) => {
      if (h.level >= 0 && h.level <= 6) s.add(h.level as DividerLevel);
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
    handleArchiveCapture,
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
    setActiveAnchorId,
    setActiveAnchorKind,
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
    setActiveAnchorId,
    setActiveAnchorKind,
  });
  useSelectedAnchorSync({
    selectedId: selectedCommentId,
    entities: comments,
    kind: "revision",
    setActiveAnchorId,
    setActiveAnchorKind,
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
    handleCutMarkerClick,
    handleTodoMarkerClick,
  } = useMarkerActions({
    prefsRef,
    setActiveLeft,
    setActiveRight,
    setActiveHalf,
    tryScrollOmniEntry,
    getOmniEnabled,
    setActiveAnchorId,
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
    alignOmniCardWithClick,
  });


  const {
    handleDropSelectionOnNotes,
    handleDropParagraphOnNotes,
    handleDropSelectionOnCutter,
    handleDropParagraphOnCutter,
  } = useDropActions({
    editorRef,
    addNote,
    addHighlight,
    addCutterComment,
    setSelectedNoteId,
    setSelectedCutterCardId,
  });

  const handleDropSelectionOnRevisions = useCallback(
    (payload: { from: number; to: number; selectedText: string }) => {
      const ed = editorRef.current?.getEditor();
      if (!ed) return;
      const record = createLinkedAnchor(ed, "revision", { from: payload.from, to: payload.to });
      if (!record) return;
      const created = addRevisionComment(null, undefined, {
        anchorId: record.anchorId,
        anchorText: payload.selectedText || record.text,
      });
      updateLinkedAnchorCard(ed, record.anchorId, "comment", created.id);
      setSelectedCommentId(created.id);
    },
    [addRevisionComment, editorRef, setSelectedCommentId],
  );

  const handleDropParagraphOnRevisions = useCallback(
    (paragraphId: string) => {
      const created = addRevisionComment(paragraphId);
      setSelectedCommentId(created.id);
    },
    [addRevisionComment, setSelectedCommentId],
  );





  const {
    handleDeleteFootnote,
  } = useFootnoteActions({
    editorRef,
    suppressOrphanRef,
    setSelectedFootnoteId,
    setOrphanedFootnotes,
  });

  const { handleCitationCreated } = useCitationActions({
    editorRef,
    getCitationDisplayText,
    addCitation,
  });


  const { handleDeleteOrphan, handleEditOrphan, handleEditOrphanTitle } = useOrphanActions({
    setOrphanedFootnotes,
  });

  // ─── Path A 7.8: bundle construction for EditorPane ────────────────
  // The `editorPaneViewPrefs` bundle (which references handleIconDrop
  // and iconDropMimesByPanel) is constructed later in the file, after
  // those functions are declared. The MenuBar bundle has no such
  // forward reference and is built here.

  const editorPaneMenuBar: EditorPaneMenuBarBundle = useMemo(() => ({
    showParTitles,
    showLatexComments,
    showHeadingLabels,
    showSectionIndicator,
    showMarginalia,
    hiddenMarginaliaTypes,
    hiddenHighlightTypes,
    availableDividerLevels,
    activeDividerLevels,
    dividerWidth,
    editorSplit,
    activeSplitPane,
    setShowParTitles,
    setShowLatexComments,
    toggleHeadingLabels,
    toggleSectionIndicator,
    toggleMarginalia,
    toggleMarginaliaType,
    toggleHighlightType,
    toggleDividerLevel,
    setDividerWidth,
    setShowHighlights,
    toggleEditorSplit: () => setEditorSplit((s) => !s),
    closeAllPanels,
    paraNavBack,
    paraNavForward,
    paraNavBackDisabled,
    paraNavForwardDisabled,
    onOpenPreferences: () => setPreferencesOpen(true),
    onOpenFontsDialog: () => setFontsOpen(true),
    onOpenMarginsMode: enterMarginEditMode,
  }), [
    showParTitles,
    showLatexComments,
    showHeadingLabels,
    showSectionIndicator,
    showMarginalia,
    hiddenMarginaliaTypes,
    hiddenHighlightTypes,
    availableDividerLevels,
    activeDividerLevels,
    dividerWidth,
    editorSplit,
    activeSplitPane,
    toggleHeadingLabels,
    toggleSectionIndicator,
    toggleMarginalia,
    toggleMarginaliaType,
    toggleHighlightType,
    toggleDividerLevel,
    setDividerWidth,
    setShowHighlights,
    setEditorSplit,
    closeAllPanels,
    paraNavBack,
    paraNavForward,
    paraNavBackDisabled,
    paraNavForwardDisabled,
    enterMarginEditMode,
  ]);

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
    setSelectedNoteId,
    setSelectedCutterCardId,
    setSelectedCommentId,
    setActiveRefLabel,
    setActiveRefRect,
    setActiveRefCommand,
    setActiveMath,
    alignOmniCardWithClick,
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

  // ── Math popover save handler ──
  const handleMathSave = useCallback((pos: number, newLatex: string) => {
    const editor = editorRef.current?.getEditor();
    if (!editor) return;
    const node = editor.state.doc.nodeAt(pos);
    if (!node) return;
    if (node.type.name !== "inlineMath" && node.type.name !== "displayMath") return;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        latex: newLatex,
      }),
    );
  }, []);

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

  // Toolbar action handlers (handleToolbarAdd* and the marginToolbarActions
  // bag) moved into EditorPane along with the toolbar machinery they
  // serve. EditorLayout no longer needs them.

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

  // ─── Path A 7.8: editorPaneViewPrefs bundle (post-handleIconDrop) ───
  // Sits after `handleIconDrop` / `iconDropMimesByPanel` declarations
  // because the bundle closes over them. The MenuBar bundle (above)
  // has no such forward references.
  const editorPaneViewPrefs: EditorPaneViewPrefs = useMemo(() => ({
    prefs,
    focusedHalfLeft,
    focusedHalfRight,
    isResizingPanels,
    focusState: focusMode.state,
    activeSectionPath: currentSectionPath,
    activeParTitleIndex: currentParTitleIndex,
    mirrorSectionPath,
    mirrorParTitleIndex,
    setFocusedHalfLeft,
    setFocusedHalfRight,
    setIsResizingPanels,
    syncPanelPrefsToRendered,
    getPanelWidth,
    setPanelWidth,
    setSplitRatio,
    setEditorLeftMargin,
    setEditorRightMargin,
    topGutter: prefs.topGutter,
    bottomGutter: prefs.bottomGutter,
    setEditorTopGutter: setTopGutter,
    setEditorBottomGutter: setBottomGutter,
    zenMode: zenModeOn,
    zenLeftMargin,
    zenRightMargin,
    setZenLeftMargin,
    setZenRightMargin,
    setActiveLeft,
    setActiveRight,
    setActiveHalf,
    togglePanel,
    movePanel,
    closePopout,
    setFloatPosition,
    undockPanel,
    redockPanel,
    toggleCardPopout,
    closeCardPopout,
    setCardFloatPosition,
    getOmniEnabled,
    getOmniHideAll,
    toggleOmniHideAllCards,
    orphanedFootnotes,
    onEditOrphan: handleEditOrphan,
    onDeleteOrphan: handleDeleteOrphan,
    onEditOrphanTitle: handleEditOrphanTitle,
    onScrollToHeading: handleScrollToHeading,
    onReorderBlocks: handleReorderBlocks,
    onRenameHeading: handleRenameHeading,
    onRenameParTitle: handleRenameParTitle,
    onUpdateLabel: handleUpdateLabel,
    isLabelTaken: checkLabelTaken,
    onFocusActivate: handleFocusActivate,
    onFocusDeactivate: focusMode.deactivate,
    onFocusToggleLock: focusMode.toggleLock,
    onFocusMoveTo: handleFocusMoveTo,
    onFocusExpandTo: handleFocusExpandTo,
    onFocusSnapBoundary: handleFocusSnapBoundary,
    focusFloating,
    // ── Icon strip ─────────────────────────────────────────────────
    collapseLeft,
    collapseRight,
    expandLeft,
    expandRight,
    setBlank,
    clearBlankIfSet,
    toggleSplit,
    openPanelDocked,
    iconDropMimesByPanel,
    handleIconDrop,
    toggleOmniCategory,
    setOmniSideToDefault,
    categorySides,
  }), [
    prefs,
    focusedHalfLeft,
    focusedHalfRight,
    isResizingPanels,
    focusMode.state,
    focusMode.deactivate,
    focusMode.toggleLock,
    currentSectionPath,
    currentParTitleIndex,
    mirrorSectionPath,
    mirrorParTitleIndex,
    setFocusedHalfLeft,
    setFocusedHalfRight,
    syncPanelPrefsToRendered,
    getPanelWidth,
    setPanelWidth,
    setSplitRatio,
    setEditorLeftMargin,
    setEditorRightMargin,
    prefs.topGutter,
    prefs.bottomGutter,
    setTopGutter,
    setBottomGutter,
    zenModeOn,
    zenLeftMargin,
    zenRightMargin,
    setZenLeftMargin,
    setZenRightMargin,
    setActiveLeft,
    setActiveRight,
    setActiveHalf,
    togglePanel,
    movePanel,
    closePopout,
    setFloatPosition,
    undockPanel,
    redockPanel,
    toggleCardPopout,
    closeCardPopout,
    setCardFloatPosition,
    getOmniEnabled,
    getOmniHideAll,
    toggleOmniHideAllCards,
    orphanedFootnotes,
    handleEditOrphan,
    handleDeleteOrphan,
    handleEditOrphanTitle,
    handleScrollToHeading,
    handleReorderBlocks,
    handleRenameHeading,
    handleRenameParTitle,
    handleUpdateLabel,
    checkLabelTaken,
    handleFocusActivate,
    handleFocusMoveTo,
    handleFocusExpandTo,
    handleFocusSnapBoundary,
    focusFloating,
    setIsResizingPanels,
    collapseLeft,
    collapseRight,
    expandLeft,
    expandRight,
    setBlank,
    clearBlankIfSet,
    toggleSplit,
    openPanelDocked,
    iconDropMimesByPanel,
    handleIconDrop,
    toggleOmniCategory,
    setOmniSideToDefault,
    categorySides,
  ]);

  const {
    handleDocPermissionGranted,
    handleNativeOpen,
  } = useFileActions({
    openExistingFile,
    setDocPermState,
  });

  // "+ Add paper" variants for the Library pod — these wrap the same
  // folder-pick / new-doc-modal flows used elsewhere, and additionally
  // add the resulting doc to the user's curated My Papers list. The
  // Virgil-bar TabPlusMenu deliberately uses the unwrapped versions so
  // opening a doc from there doesn't touch My Papers.
  const onOpenFolderAndAdd = useCallback(async () => {
    const meta = await handleNativeOpen();
    if (meta) addMyPaper(meta.id);
  }, [handleNativeOpen, addMyPaper]);

  const onCreateNewAndAdd = useCallback(() => {
    setNewDocModal({ mode: "fresh", onCreated: addMyPaper });
  }, [addMyPaper]);

  // Spawn a fresh Virgil window. The new window boots with no
  // sessionStorage carried over, so it generates its own windowId
  // and hydrates an empty tab set.
  //
  // Window features matter for PWA UX: a bare window.open(url) from
  // inside an installed PWA defaults to a browser tab (with the
  // annoying "Open in app" prompt). Passing `popup` plus explicit
  // dimensions signals "new top-level window", and Chromium honours
  // this by opening the new window in PWA chrome when the caller is
  // already a PWA. In a normal browser tab the same call opens a
  // standard tab — no degradation.
  //
  // `noopener` is safe here — peer windows talk to each other via
  // BroadcastChannel, which is same-origin and does not require an
  // opener relationship.
  const openNewVirgilWindow = useCallback(() => {
    try {
      const url = window.location.pathname + window.location.search;
      const features = [
        "popup",
        "noopener",
        "noreferrer",
        `width=${Math.round(window.innerWidth * 0.9)}`,
        `height=${Math.round(window.innerHeight * 0.9)}`,
      ].join(",");
      window.open(url, "_blank", features);
    } catch (err) {
      console.error("Failed to open new window:", err);
    }
  }, []);

  // Cmd-Shift-N → new window. Distinct from Cmd-N (browser default)
  // and Cmd-Shift-P / Cmd-P (used by Print + paragraph nav).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isNew =
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === "n";
      if (!isNew) return;
      e.preventDefault();
      openNewVirgilWindow();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openNewVirgilWindow]);


  const switchToCodeView = useCallback(() => {
    // Get the active paragraph UUID using rules 1-3
    const paraId = editorRef.current?.getActiveParagraphId() ?? null;
    setCodeViewParagraphId(paraId);

    // Fallback: compute line number from text matching against the
    // live editor doc (the same JSON the code editor will reserialize
    // from disk; close enough for a line lookup).
    let line: number | undefined;
    if (!paraId && latestDoc) {
      try {
        const editor = editorRef.current?.getEditor();
        if (editor) {
          const scrollEl = findEditorScrollFor(editor.view.dom);
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
            const latex = serializeToLatex(latestDoc);
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
    setPdfView(false);
    setCodeView(true);
  }, [latestDoc]);

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
    // No explicit refetch needed: setCodeView(false) re-enters the
    // visual branch, EditorPane (and its `<DocPipeline>` boundary)
    // remount, and useDocument's load effect reads the latest .tex
    // from disk on remount.
    setCodeView(false);
    setPdfView(false);
  }, []);

  const switchToPdfView = useCallback(async () => {
    if (latestPdfBytes.current) {
      const blob = new Blob([latestPdfBytes.current.buffer as ArrayBuffer], { type: "application/pdf" });
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
      setPdfBlobUrl(URL.createObjectURL(blob));
    } else if (currentDocId) {
      const bytes = await readPdf(currentDocId);
      if (bytes) {
        const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" });
        if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
        setPdfBlobUrl(URL.createObjectURL(blob));
      } else {
        setPdfBlobUrl(null);
      }
    }
    if (currentDocId) activateDocPane(currentDocId);
    setCodeView(false);
    setPdfView(true);
  }, [currentDocId, pdfBlobUrl, activateDocPane]);

  const switchFromPdfView = useCallback(() => {
    setPdfView(false);
  }, []);

  // Memoized toggles for the EditorPane mount — without these, inline
  // arrows (`() => setPdfView((v) => !v)`) would get a fresh identity
  // every render, propagating through EditorPane's `onTogglePdfView`
  // prop into VirgilEditor's `[onEditorReady]` effect, retriggering
  // `setEditor` on every parent render and infinite-looping.
  const togglePdfView = useCallback(() => {
    if (pdfView) switchFromPdfView();
    else void switchToPdfView();
  }, [pdfView, switchFromPdfView, switchToPdfView]);
  const toggleCodeView = useCallback(() => {
    if (codeView) switchToVisualView();
    else switchToCodeView();
  }, [codeView, switchToVisualView, switchToCodeView]);
  const handleEditorPaneActivate = useCallback(() => {
    if (currentDocId) activateDocPane(currentDocId);
  }, [currentDocId, activateDocPane]);

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

  // ── Soft presence: broadcast our card selections to the partner.
  // Mapping uses the same `panelKind` strings as per-card claims so the
  // partner-color dot lines up with the card chrome.
  useEffect(() => {
    if (!collab.enabled) return;
    const cards: { panelKind: string; cardId: string }[] = [];
    if (selectedNoteId) cards.push({ panelKind: "note", cardId: selectedNoteId });
    if (selectedFootnoteId) cards.push({ panelKind: "footnote", cardId: selectedFootnoteId });
    if (selectedCitationId) cards.push({ panelKind: "citation", cardId: selectedCitationId });
    if (selectedTodoId) cards.push({ panelKind: "todo", cardId: selectedTodoId });
    if (selectedArchiveId) cards.push({ panelKind: "archive", cardId: selectedArchiveId });
    if (selectedCutterCardId) cards.push({ panelKind: "cut", cardId: selectedCutterCardId });
    if (selectedQuotationGroupId) cards.push({ panelKind: "quote", cardId: selectedQuotationGroupId });
    if (selectedCommentId) cards.push({ panelKind: "comment", cardId: selectedCommentId });
    if (selectedBibKey) cards.push({ panelKind: "bib", cardId: selectedBibKey });
    if (selectedExampleId) cards.push({ panelKind: "example", cardId: selectedExampleId });
    collab.updateSelection(cards);
  }, [
    collab.enabled,
    collab.updateSelection,
    selectedNoteId, selectedFootnoteId, selectedCitationId, selectedTodoId,
    selectedArchiveId, selectedCutterCardId, selectedQuotationGroupId,
    selectedCommentId, selectedBibKey, selectedExampleId,
  ]);

  const { handleStripClick, handleMove } = useStripHandlers({
    prefs,
    openPanelDocked,
    closePopout,
    movePanel,
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
  // Mirrors EditorPane's `docVersion` discipline — see the comment
  // block there. Per-keystroke setEditorDocVersion was triggering the
  // marginaliaMarkers useMemo (and several others) every character;
  // debouncing to ~100ms keeps panels visibly fresh while clearing
  // the keystroke hot path.
  const [editorDocVersion, setEditorDocVersion] = useState(0);
  const editorDocVersionTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!editorInstance) return;
    const bumpDebounced = () => {
      if (editorDocVersionTimerRef.current !== null) {
        window.clearTimeout(editorDocVersionTimerRef.current);
      }
      editorDocVersionTimerRef.current = window.setTimeout(() => {
        editorDocVersionTimerRef.current = null;
        setEditorDocVersion((v) => v + 1);
      }, 100);
    };
    const bump = () => {
      bumpDebounced();
      // Same ref-write + lazy pdfStale flip as EditorPane's onUpdate.
      lastEditTimeRef.current = Date.now();
      if (lastCompileTimeRef.current != null && !pdfStaleRef.current) {
        setPdfStale(true);
      }
    };
    editorInstance.on("update", bump);
    return () => {
      editorInstance.off("update", bump);
      if (editorDocVersionTimerRef.current !== null) {
        window.clearTimeout(editorDocVersionTimerRef.current);
        editorDocVersionTimerRef.current = null;
      }
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

    // Tag every marker with its anchored-card kind. Markers self-subscribe
    // to the cardStore via (entityKind, entityId) — no per-marker hover
    // wiring or selection threading needed. Replaces the old hoverPropsFor
    // decoration that wrote per-marker (selected/hovered/onHover) props.
    const hoverPropsFor = (_entityId: string, kind: EntityKind) => ({
      entityKind: kind,
    });

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
          title: g.title || g.references[0]?.citeKey || "Quotation",
          onClick: (clickY?: number) => handleQuotationMarkerClick(g.id, clickY),
          onDelete: () => removeQuotationParagraphId(g.id, pid),
          ...hoverPropsFor(g.id, "quotation"),
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
          ...hoverPropsFor(n.id, "note"),
        });
      }
    }

    // Archive markers — one marker per paragraphId. Routes through
    // `openForCard` so the card aligns to the click Y like other kinds.
    for (const snippet of archiveSnippets) {
      const pids = getLinkedParagraphIds(snippet);
      if (pids.length === 0) continue;
      for (const pid of pids) {
        result.push({
          id: `${snippet.id}:${pid}`,
          entityId: snippet.id,
          type: "archive",
          paragraphId: pid,
          title: "Archived snippet",
          onClick: (clickY?: number) => {
            setSelectedArchiveId(snippet.id);
            openForCard(
              {
                omniKey: `archive:${snippet.id}`,
                entrySelector: `[data-archive-entry="${snippet.id}"]`,
                panelId: "archive",
                cardKind: "archive",
                skipScroll: true,
              },
              {
                prefs: prefsRef.current,
                setActiveLeft,
                setActiveRight,
                setActiveHalf,
                tryScrollOmniEntry,
                getOmniEnabled,
              },
            );
            if (typeof clickY === "number") {
              const sourceEl = document.querySelector(
                `[data-marginalia-marker^="archive:${snippet.id}:"]`,
              ) as HTMLElement | null;
              requestAnimationFrame(() => {
                alignOmniCardWithClick(`archive:${snippet.id}`, clickY, sourceEl);
              });
            }
          },
          onDelete: () => removeArchiveParagraphId(snippet.id, pid),
          ...hoverPropsFor(snippet.id, "archive"),
        });
      }
    }

    // Anchored-comment markers — one marker per comment with a text
    // anchor. The paragraph uuid is resolved live from the mark's range;
    // if the mark is gone the comment becomes orphaned and gets no marker.
    const ed = editorRef.current?.getEditor();
    if (ed) {
      for (const r of comments) {
        if (r.kind === "suggestion" && r.status !== "pending") continue;
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
          title: r.selectedText || "Revision",
          anchorId,
          onClick: (clickY?: number) => {
            const nextSelected = selectedCommentId === r.id ? null : r.id;
            setSelectedCommentId(nextSelected);
            if (nextSelected) {
              setActiveAnchorId(anchorId);
              setActiveAnchorKind("revision");
            } else {
              setActiveAnchorId(null);
              setActiveAnchorKind(null);
              return;
            }
            // Route through `openForCard` so the card lands on the
            // correct side / split. Revisions aren't omni-eligible, so
            // this falls through to the native panel; alignOmniCardWithClick
            // no-ops when the omni wrapper isn't present, leaving the
            // native panel's own scrolling intact.
            openForCard(
              {
                omniKey: `revision:${r.id}`,
                entrySelector: `[data-card-key="revision:${r.id}"]`,
                panelId: "revisions",
                cardKind: "comment",
                skipScroll: true,
              },
              {
                prefs: prefsRef.current,
                setActiveLeft,
                setActiveRight,
                setActiveHalf,
                tryScrollOmniEntry,
                getOmniEnabled,
              },
            );
            if (typeof clickY === "number") {
              const sourceEl = document.querySelector(
                `[data-marginalia-marker^="revision:${r.id}:"]`,
              ) as HTMLElement | null;
              requestAnimationFrame(() => {
                alignOmniCardWithClick(`revision:${r.id}`, clickY, sourceEl);
              });
            }
          },
          ...hoverPropsFor(r.id, r.kind === "suggestion" ? "revision-suggestion" : "comment"),
        });
      }
    }

    // Cutter markers — one per paragraphId. Both card kinds share the
    // "cut" gutter marker.
    for (const c of cutterCards) {
      const pids = getLinkedParagraphIds(c);
      if (pids.length === 0) continue;
      const cardAnchor = getTextAnchor(c);
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
          title,
          onClick: (clickY?: number) => handleCutMarkerClick(c.id, clickY),
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
          ...hoverPropsFor(c.id, c.kind === "suggestion" ? "cutter-suggestion" : "cutter-comment"),
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
          title: item.text || "Todo",
          muted: item.done,
          onClick: (clickY?: number) => handleTodoMarkerClick(item.id, clickY),
          onDelete: () => removeTodoParagraphId(item.id, pid),
          ...hoverPropsFor(item.id, "todo"),
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
    setActiveHalf,
    tryScrollOmniEntry,
    getOmniEnabled,
    cutterCards,
    selectedCutterCardId,
    removeCardParagraphId,
    handleCutMarkerClick,
    allLatexErrors,
    dismissedErrorIds,
    paragraphByErrorId,
    selectedErrorId,
    dismissError,
    hoveredEntityId,
    hoveredEntityKind,
    setSelectedArchiveId,
    setSelectedCommentId,
    setActiveAnchorId,
    setActiveAnchorKind,
  ]);

  // Subscribe to panel-color changes so linked-anchor highlight updates live.
  usePanelColorSubscription();
  // Effective linked-anchor activation: hovered takes priority over sticky-active.
  const effectiveAnchorId = hoveredAnchorId ?? activeAnchorId;
  // When hovering, derive the anchor kind from the hovered entity so the
  // color matches the hover target (not whatever was previously selected).
  const hoveredAnchorKind = useMemo(
    () =>
      entityKindToAnchorKind(
        hoveredEntityId && hoveredEntityKind
          ? { id: hoveredEntityId, kind: hoveredEntityKind }
          : null,
        { notes, cutterCards, comments, todos: todoItems, archiveSnippets, quotationGroups, examples: [] },
      ),
    [hoveredEntityId, hoveredEntityKind, notes, cutterCards, comments, todoItems, archiveSnippets, quotationGroups],
  );
  const effectiveAnchorKind = hoveredAnchorKind ?? activeAnchorKind;
  const effectiveAnchorColor = (() => {
    const activeAnchorKind = effectiveAnchorKind;
    if (!activeAnchorKind) return null;
    // LinkedAnchorKind → MarkerType. Both cutter card kinds share the
    // single "cut" marker entry; revisions panel uses the "revision"
    // marker; highlights have no marker of their own (pure text-tint),
    // so they reuse the "note" marker for active-anchor coloring.
    const markerType =
      activeAnchorKind === "cutter-comment" ||
      activeAnchorKind === "cutter-suggestion"
        ? "cut"
        : activeAnchorKind === "highlight"
        ? "note"
        : activeAnchorKind;
    const meta = MARKER_META[markerType];
    const key = MARKER_KIND_TO_THEME_KEY[activeAnchorKind];
    if (key && isPanelColorOverridden(key)) {
      return deriveMarkerPalette(getPanelColor(key)).border;
    }
    return meta.border;
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
    const records: Array<{ anchorId: string; kind: "note" | "highlight" | "revision" | "cutter-comment" | "cutter-suggestion"; text: string }> = [];
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
    // Highlights are applied last so a highlight whose range sits inside a
    // broader revision/cutter selection wins the overlap. (setMark replaces
    // earlier linkedAnchor marks in the overlap, and if a highlight mark
    // were overwritten LinkedAnchorGuard would fire an orphan event and
    // strip the textRange from the sidecar.)
    for (const h of highlights) {
      const ta = getTextAnchor(h);
      if (ta && ta.anchorText) {
        records.push({ anchorId: ta.anchorId, kind: "highlight", text: ta.anchorText });
      }
    }
    if (records.length > 0) {
      editorRef.current.applyLinkedAnchors(records);
    }

    // Legacy anchored comments path retired with the revisions cutter rewrite.
    // Mode B (selection) anchors now persist via the unified link helpers,
    // so there's nothing to reanchor here.
  }, [editorInstance, docIdForHooks, notes, highlights, comments, cutterCards]);

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

  // Render helpers (renderPanelWithChrome / renderPanelInner / renderPanelColumn)
  // moved into EditorPane along with the panel mount itself. The icon
  // strip (and its `leftStripItems` / `rightStripItems` derivation) also
  // moved into EditorPane's `IconStrip` — it now derives its items
  // directly from `visiblePanels` via `placementSideByKind`.

  if (!fsaSupported) {
    return <UnsupportedBrowserNotice />;
  }

  // Paragraph / heading / example popout handlers and their is-popped
  // predicates now live inside EditorPane (which owns the gutter buttons
  // and the popouts mount). EditorPane also owns the
  // `PoppedCardsContext.Provider` post-7.8.1 so the same provider value
  // covers both the main app and the Library Reader without EditorLayout
  // having to know whether the descendant is read-only. EditorLayout
  // retains only the `*PoppedKeys` memo + refresh effects above so the
  // editor refreshes its node-view glyphs when prefs change.

  // Virgil-bar right-cluster source: post-7.8 the bar reads per-doc
  // state from `paneState`, populated by EditorPane via
  // `onPaneStateChange`. EditorLayout's own per-doc hooks (compile,
  // ai-requests) feed dialogs and other shell-only consumers; the
  // bar's view of them comes through here.
  const vbar = {
    aiDot: paneState?.aiDot ?? null,
    aiRequests: paneState?.aiRequests ?? [],
    addStyleMergeRequest: paneState?.addStyleMergeRequest ?? stubAddStyleMergeRequest,
    compilePdf: paneState?.compilePdf ?? noop,
    isCompiling: paneState?.isCompiling ?? false,
    pdfStale: paneState?.pdfStale ?? false,
    pdfBlobUrl: paneState?.pdfBlobUrl ?? null,
    pdfView: paneState?.pdfView ?? false,
    codeView: paneState?.codeView ?? false,
    switchToPdfView: paneState?.switchToPdfView ?? noop,
    switchFromPdfView: paneState?.switchFromPdfView ?? noop,
    switchToCodeView: paneState?.switchToCodeView ?? noop,
    switchToVisualView: paneState?.switchToVisualView ?? noop,
  };

  return (
    <EditorLayoutProvider
      state={{ prefs, focusedHalfLeft, focusedHalfRight }}
      actions={{ togglePanel, movePanel, setActiveHalf }}
    >
    <EditorRefProvider value={{ editorInstance, editorRef, setOverrideEditor }}>
    <AiRequestsProvider value={{ aiRequests, addAiRequest, updateAiRequestText, deleteAiRequest }}>
    <CitationDisplayProvider value={{ getCitationDisplayText, onCitationCreated: handleCitationCreated }}>
    {/* SelectionsProvider derives the 9 anchored slots from the cardStore;
        we only thread the bib slot in through `value` because bib isn't
        an anchored kind. The other 9 props on the legacy value shape are
        ignored by the provider. */}
    <SelectionsProvider value={{ selectedBibKey, setSelectedBibKey }}>
    <PristineCardsProvider value={pristineManager}>
    <RecentlyAddedProvider value={recentlyAdded}>
    <RecentlyAddedAutoClear />
    <CollabProvider value={collab}>
    <div className="flex flex-col h-screen bg-[var(--background)]">
      {/* Top bar: logo + tabs */}
      <div
        // Preference-mode: the VIRGIL top bar. topbarBackground is locked to
        // the PWA/browser theme-color (see globals.css merger notes), so
        // changing it updates both the in-app bar and the browser chrome.
        // min-height gives the docked MenuBar breathing room inside the
        // bar without pushing the tabs taller (tabs are items-end anchored
        // at the bottom edge, so the extra space accumulates above them).
        // In zen mode the bar's background and bottom border drop out so
        // it visually melts into the canvas, but the height stays so the
        // Zen toggle (last child of the right cluster) keeps the same Y
        // position in both modes.
        data-prefs="topbarBackground,topbarBackgroundBottom,virgilBarText"
        data-bar-h="32"
        className={`virgil-bar flex items-center min-h-[32px] sticky top-0 z-30 ${zenModeOn ? '' : 'border-b border-[var(--topbar-border,#d5d3ce)]'}`}
        style={{
          color: "var(--virgil-bar-text)",
          background: zenModeOn
            ? "transparent"
            : "linear-gradient(to bottom, var(--topbar-bg), var(--topbar-bg-bottom))",
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
        <div
          ref={tabStripRef}
          className="flex items-end flex-1 min-w-0 gap-0.5 px-2 self-stretch relative"
          onDragOver={(e) => {
            const types = e.dataTransfer.types;
            let acceptable = false;
            for (let i = 0; i < types.length; i++) {
              if (types[i] === PAPER_DT_TYPE || types[i] === LIBRARY_DT_TYPE) {
                acceptable = true;
                break;
              }
            }
            if (!acceptable) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            // Insertion index = first outer-tab whose midpoint is right of cursor.
            let idx = outerOrder.length;
            for (let i = 0; i < outerOrder.length; i++) {
              const el = outerTabRefs.current.get(outerOrder[i]);
              if (!el) continue;
              const r = el.getBoundingClientRect();
              if (e.clientX < r.left + r.width / 2) { idx = i; break; }
            }
            if (paperDropIndex !== idx) setPaperDropIndex(idx);
          }}
          onDragLeave={(e) => {
            const next = e.relatedTarget as Node | null;
            if (next && tabStripRef.current?.contains(next)) return;
            setPaperDropIndex(null);
          }}
          onDrop={(e) => {
            const citekey = e.dataTransfer.getData(PAPER_DT_TYPE);
            const libId = e.dataTransfer.getData(LIBRARY_DT_TYPE);
            if (!citekey && !libId) return;
            e.preventDefault();
            const dropIdx = paperDropIndex ?? outerOrder.length;
            setPaperDropIndex(null);
            if (citekey) {
              // Paper tearout (move): close the donor inner tab first so
              // the paper exists in only one place. The LibraryView
              // listener writes its panel state to localStorage on the
              // next render. We defer activating the new outer paper tab
              // to the next macrotask so React processes the inner-tab
              // close + persist BEFORE switching activePane to "paper"
              // (which unmounts LibraryView and would otherwise drop the
              // queued persist).
              window.dispatchEvent(
                new CustomEvent("virgil-library-close-paper-tab", {
                  detail: { citekey },
                }),
              );
              setTimeout(() => openPaperTab(citekey, dropIdx), 0);
              return;
            }
            // Library copy: donor inner tab stays put. Just spawn the
            // outer tab synchronously and activate it.
            openLibraryOuterTab(libId, dropIdx);
          }}
        >
          <TabPlusMenu
            docs={docs}
            openTabIds={openTabs.map((t) => t.id)}
            onOpenRecent={openFile}
            onOpenFolder={handleNativeOpen}
            onCreateNew={() => setNewDocModal({ mode: "fresh" })}
            onOpenNewWindow={openNewVirgilWindow}
            devStorage={devStorage}
          />
          {(() => {
            // Outer-tab strip render. Library root + the currently active
            // entry render as full DocumentFolderTab silhouettes; every
            // other entry collapses to a flat InlineTabLabel. A vertical
            // separator slot sits between every pair of non-Library tabs
            // and is only painted when both neighbors are inline — when
            // one side is the active folder, the silhouette's edge takes
            // the divider's job and we hide the line via `visibility`
            // (without removing it from layout, so promoting/demoting a
            // tab leaves the surrounding layout pixel-stable). Click an
            // inline label to promote it; the previously active tab
            // demotes back to inline. Order in `outerOrder` is preserved.
            const tabNodes: ReactNode[] = [];
            type PrevKind = "inline" | "folder" | null;
            let prevKind: PrevKind = null;
            const pushSeparator = (currentKind: "inline" | "folder", entryId: string) => {
              if (prevKind !== null) {
                const visible = prevKind === "inline" && currentKind === "inline";
                tabNodes.push(<TabSeparator key={`sep-${entryId}`} visible={visible} />);
              }
            };
            for (const entryId of outerOrder) {
              if (entryId === OUTER_LIBRARY_ROOT_ID) {
                const isActive =
                  activePane === "library-outer" &&
                  currentLibraryOuterId === OUTER_LIBRARY_ROOT_ID;
                if (isActive) {
                  pushSeparator("folder", entryId);
                  tabNodes.push(
                    <div
                      key={entryId}
                      ref={(el) => {
                        if (el) outerTabRefs.current.set(entryId, el);
                        else outerTabRefs.current.delete(entryId);
                      }}
                      className="flex items-end shrink-0"
                    >
                      <DocumentFolderTab
                        active
                        fill="var(--library-bg)"
                        dataPrefs="libraryBg,topbarBorder"
                        title="Library"
                        onClick={() => {}}
                      >
                        <IconLibrary />
                        <span className="text-[13px] leading-4 mr-2.5">Library</span>
                      </DocumentFolderTab>
                    </div>,
                  );
                  prevKind = "folder";
                } else {
                  pushSeparator("inline", entryId);
                  tabNodes.push(
                    <div
                      key={entryId}
                      ref={(el) => {
                        if (el) outerTabRefs.current.set(entryId, el);
                        else outerTabRefs.current.delete(entryId);
                      }}
                      className="self-center shrink-0"
                    >
                      <InlineTabLabel
                        icon={<IconLibrary />}
                        label="Library"
                        title="Library"
                        variant="library-pinned"
                        onClick={() =>
                          activateLibraryOuterPane(OUTER_LIBRARY_ROOT_ID)
                        }
                      />
                    </div>,
                  );
                  prevKind = "inline";
                }
                continue;
              }

              if (entryId.startsWith(OUTER_PAPER_PREFIX)) {
                const citekey = entryId.slice(OUTER_PAPER_PREFIX.length);
                const isActive =
                  activePane === "paper" && currentPaperCitekey === citekey;
                if (isActive) {
                  pushSeparator("folder", entryId);
                  tabNodes.push(
                    <div
                      key={entryId}
                      ref={(el) => {
                        if (el) outerTabRefs.current.set(entryId, el);
                        else outerTabRefs.current.delete(entryId);
                      }}
                      className="flex items-end shrink-0"
                      style={{
                        marginLeft: -ACTIVE_TAB_LEFT_SHIFT_PX,
                        marginRight: -ACTIVE_TAB_RIGHT_SHIFT_PX,
                      }}
                    >
                      <DocumentFolderTab
                        active
                        fill="var(--background)"
                        dataPrefs="background,topbarBorder"
                        title={citekey}
                        onClick={() => {}}
                      >
                        <span
                          className="text-[13px] leading-4 truncate min-w-0"
                          style={{ fontFamily: "var(--mono)" }}
                        >
                          {citekey}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            closePaperTab(citekey);
                          }}
                          className="topbarbtn topbarbtn-icon"
                          title="Close tab"
                          data-helper="Close tab"
                        >
                          <IconX />
                        </button>
                      </DocumentFolderTab>
                    </div>,
                  );
                  prevKind = "folder";
                } else {
                  pushSeparator("inline", entryId);
                  tabNodes.push(
                    <div
                      key={entryId}
                      ref={(el) => {
                        if (el) outerTabRefs.current.set(entryId, el);
                        else outerTabRefs.current.delete(entryId);
                      }}
                      className="self-center shrink-0"
                    >
                      <InlineTabLabel
                        label={citekey}
                        title={citekey}
                        monospace
                        onClick={() => activatePaperPane(citekey)}
                        onClose={() => closePaperTab(citekey)}
                      />
                    </div>,
                  );
                  prevKind = "inline";
                }
                continue;
              }

              if (entryId.startsWith(OUTER_LIBRARY_PREFIX)) {
                const libId = entryId.slice(OUTER_LIBRARY_PREFIX.length);
                const isActive =
                  activePane === "library-outer" && currentLibraryOuterId === libId;
                const lib = libraryRegistry.get(libId);
                const label = lib?.label ?? libId;
                // Entry drops are accepted on custom libraries only —
                // Central / Project / paper compute their membership and
                // can't be appended to. (Mirrors useLibraryTabs's
                // addEntryToLibrary guard.)
                const acceptsEntryDrop = lib?.kind === "custom";
                const isEntryDropTarget =
                  acceptsEntryDrop && entryDropOuterLibId === libId;
                const dropHandlers = {
                  onDragOver: (e: React.DragEvent<HTMLDivElement>) => {
                    if (!acceptsEntryDrop) return;
                    const types = e.dataTransfer.types;
                    let hasEntry = false;
                    for (let i = 0; i < types.length; i++) {
                      if (types[i] === ENTRY_DT_TYPE) { hasEntry = true; break; }
                    }
                    if (!hasEntry) return;
                    e.preventDefault();
                    e.stopPropagation(); // beat the strip-level paper-tab handler
                    e.dataTransfer.dropEffect = "copy";
                    if (entryDropOuterLibId !== libId) setEntryDropOuterLibId(libId);
                  },
                  onDragLeave: (e: React.DragEvent<HTMLDivElement>) => {
                    const next = e.relatedTarget as Node | null;
                    if (next && (e.currentTarget as HTMLElement).contains(next)) return;
                    if (entryDropOuterLibId === libId) setEntryDropOuterLibId(null);
                  },
                  onDrop: (e: React.DragEvent<HTMLDivElement>) => {
                    if (!acceptsEntryDrop) return;
                    const entryKey = e.dataTransfer.getData(ENTRY_DT_TYPE);
                    if (!entryKey) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setEntryDropOuterLibId(null);
                    addEntryToLibraryGlobal(libId, entryKey);
                  },
                };
                const dropStyle = {
                  outline: isEntryDropTarget
                    ? "2px solid var(--accent)"
                    : undefined,
                  outlineOffset: isEntryDropTarget ? -2 : undefined,
                  borderRadius: isEntryDropTarget ? 8 : undefined,
                  background: isEntryDropTarget
                    ? "var(--accent-light)"
                    : undefined,
                };
                if (isActive) {
                  pushSeparator("folder", entryId);
                  tabNodes.push(
                    <div
                      key={entryId}
                      ref={(el) => {
                        if (el) outerTabRefs.current.set(entryId, el);
                        else outerTabRefs.current.delete(entryId);
                      }}
                      className="flex items-end shrink-0"
                      {...dropHandlers}
                      style={{
                        ...dropStyle,
                        marginLeft: -ACTIVE_TAB_LEFT_SHIFT_PX,
                        marginRight: -ACTIVE_TAB_RIGHT_SHIFT_PX,
                      }}
                    >
                      <DocumentFolderTab
                        active
                        fill="var(--library-bg)"
                        dataPrefs="libraryBg,topbarBorder"
                        title={label}
                        onClick={() => {}}
                      >
                        <IconLibrary />
                        <span className="text-[13px] leading-4 truncate min-w-0">
                          {label}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            closeLibraryOuterTab(libId);
                          }}
                          className="topbarbtn topbarbtn-icon"
                          title="Close tab"
                          data-helper="Close tab"
                        >
                          <IconX />
                        </button>
                      </DocumentFolderTab>
                    </div>,
                  );
                  prevKind = "folder";
                } else {
                  pushSeparator("inline", entryId);
                  tabNodes.push(
                    <div
                      key={entryId}
                      ref={(el) => {
                        if (el) outerTabRefs.current.set(entryId, el);
                        else outerTabRefs.current.delete(entryId);
                      }}
                      className="self-center shrink-0"
                      {...dropHandlers}
                      style={dropStyle}
                    >
                      <InlineTabLabel
                        icon={<IconLibrary />}
                        label={label}
                        title={label}
                        onClick={() => activateLibraryOuterPane(libId)}
                        onClose={() => closeLibraryOuterTab(libId)}
                      />
                    </div>,
                  );
                  prevKind = "inline";
                }
                continue;
              }

              const doc = docs.find((d) => d.id === entryId);
              if (!doc) continue;
              const isCurrentDoc = doc.id === currentDocId;
              const isDocPaneActive = isCurrentDoc && activePane === "doc";
              const composedDefault = `${doc.folderName}: ${doc.texFilename}`;
              const displayName =
                doc.name && doc.name !== doc.folderName ? doc.name : composedDefault;
              if (isDocPaneActive) {
                const isEditing = editingTabId === doc.id;
                const commit = () => {
                  const next = nameInput.trim();
                  if (next && next !== displayName) renameFile(doc.id, next);
                  setEditingTabId(null);
                };
                pushSeparator("folder", doc.id);
                tabNodes.push(
                  <div
                    key={doc.id}
                    ref={(el) => {
                      if (el) outerTabRefs.current.set(doc.id, el);
                      else outerTabRefs.current.delete(doc.id);
                    }}
                    className="flex items-end shrink-0"
                    style={{
                      marginLeft: -ACTIVE_TAB_LEFT_SHIFT_PX,
                      marginRight: -ACTIVE_TAB_RIGHT_SHIFT_PX,
                    }}
                  >
                    <DocumentFolderTab
                      active
                      fill="var(--main-tab-bg)"
                      dataPrefs="backgroundColor,topbarBorder"
                      title={displayName}
                      onClick={() => {
                        if (isEditing) return;
                      }}
                    >
                      {isEditing ? (
                        <input
                          ref={nameInputRef}
                          type="text"
                          value={nameInput}
                          size={Math.max(nameInput.length + 1, 8)}
                          onChange={(e) => setNameInput(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commit();
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              setEditingTabId(null);
                            }
                          }}
                          onBlur={commit}
                          className="text-[13px] leading-4 bg-transparent outline-none border-b border-ink-muted min-w-0 px-0"
                        />
                      ) : (
                        <span
                          className="text-[13px] leading-4 truncate min-w-0"
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            setNameInput(displayName);
                            setEditingTabId(doc.id);
                          }}
                        >
                          {displayName}
                        </span>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); closeTab(doc.id); }}
                        className="topbarbtn topbarbtn-icon"
                        title="Close tab"
                        data-helper="Close tab"
                      >
                        <IconX />
                      </button>
                    </DocumentFolderTab>
                  </div>,
                );
                prevKind = "folder";
              } else {
                pushSeparator("inline", doc.id);
                tabNodes.push(
                  <div
                    key={doc.id}
                    ref={(el) => {
                      if (el) outerTabRefs.current.set(doc.id, el);
                      else outerTabRefs.current.delete(doc.id);
                    }}
                    className="self-center shrink-0"
                  >
                    <InlineTabLabel
                      label={displayName}
                      title={displayName}
                      onClick={() => activateDocPane(doc.id)}
                      onClose={() => closeTab(doc.id)}
                    />
                  </div>,
                );
                prevKind = "inline";
              }
            }
            return tabNodes;
          })()}
          {paperDropIndex !== null && (
            <PaperDropIndicator
              stripEl={tabStripRef.current}
              tabRefs={outerTabRefs.current}
              order={outerOrder}
              index={paperDropIndex}
            />
          )}
          {/* Zero-width sentinel marking the end of the top-bar's left
              content (tabs + logo + "+" button). The floating MenuBar's
              home position uses this x-coordinate as its left clamp —
              measuring the flex-1 parent's right edge would be wrong
              because flex-1 expands to fill the whole middle gap. */}
        </div>
        )}

        <div className="shrink-0 flex items-center px-2">
          {/* Service-worker update banner. Visible whenever a new SW
              has installed and is waiting (see public/sw.js +
              ServiceWorkerRegistration.tsx). Click → posts SKIP_WAITING
              → SW activates → controllerchange fires → page reloads
              and pulls the new skill bundle into folders on next open.
              Sits before the topbarRightCollapsed gate so an update
              prompt isn't hidden by the user's collapsed-right setting. */}
          {updateAvailable && (
            <button
              onClick={applyUpdate}
              className="topbarbtn"
              title="Refresh to apply the Virgil update"
              data-helper="Virgil update"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2.5 8a5.5 5.5 0 0 1 9.4-3.9L13.5 5.5" />
                <path d="M13.5 2.5v3h-3" />
                <path d="M13.5 8a5.5 5.5 0 0 1-9.4 3.9L2.5 10.5" />
                <path d="M2.5 13.5v-3h3" />
              </svg>
              Virgil update — click to refresh
            </button>
          )}
          {!prefs.topbarRightCollapsed && (<>
          {/* ── Status-indicator group (left of divider) ───────────────
              Passive indicators for system-wide modes that are
              activated elsewhere (Focus from card actions, Helper from
              the "?" menu, Collab from the icon button on the right).
              Each entry doubles as the off-toggle for its mode. Stays
              empty when nothing's active. Suppressed in zen mode. */}
          {!zenModeOn && (
            <div className="flex items-center">
              {focusMode.state.active && (
                <button
                  onClick={focusMode.deactivate}
                  className="topbarbtn"
                  aria-pressed="true"
                  title="Exit focus view"
                  data-helper="Focus view"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="8" cy="8" r="2.25" />
                    <path d="M8 2.5v1.5M8 12v1.5M2.5 8H4M12 8h1.5" />
                  </svg>
                  Focus view
                </button>
              )}
              {helperMode.on && (
                <button
                  onClick={helperMode.toggle}
                  className="topbarbtn"
                  aria-pressed="true"
                  title="Exit helper mode"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="8" cy="8" r="6" />
                    <path d="M5.8 6.2a2.2 2.2 0 0 1 4.08.8c0 1.2-1.68 1.6-1.68 1.6" />
                    <circle cx="8" cy="11.5" r="0.3" fill="currentColor" stroke="none" />
                  </svg>
                  Helper mode
                </button>
              )}
              {collab.enabled && collabBadge}
            </div>
          )}
          {/* Divider — only shown when there's at least one status
              marker on the left, so the line reads as a real
              boundary between markers and standard buttons. With no
              markers, the standard cluster simply starts at the
              edge. Uses the same stronger edge color as the tab
              separators. Suppressed in zen mode regardless. */}
          {!zenModeOn && (focusMode.state.active || helperMode.on || collab.enabled) && (
            <span
              aria-hidden
              className="self-center h-5 w-px mx-2"
              style={{ background: "var(--edge-strong, #a8a29e)" }}
            />
          )}
          {/* Zen mode toggle — render-gates editor chrome (icon
              strips, panel columns, floating MenuBar, marginalia,
              popped-out panels/cards) so the document area stands
              alone. Top bar stays visible so this button is always
              reachable. Sits at the leftmost of the standard-buttons
              group (right of the divider) so Zen sequences with the
              collab icon and other modal toggles. */}
          <button
            onClick={handleToggleZen}
            className="topbarbtn"
            title={zenModeOn ? "Zen mode: on" : "Zen mode: off"}
            aria-pressed={zenModeOn}
            data-helper="Zen mode"
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
          {collabIconBtn}
          <button
            onClick={() => setPreferencesOpen((v) => !v)}
            className="topbarbtn"
            title="Preferences"
            aria-pressed={preferencesOpen}
            data-helper="Preferences"
          >
            {/* Painter's palette icon — solid silhouette with the classic
                thumb-hole cutout on the right and four color wells punched
                through via fill-rule="evenodd". */}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c1.1 0 2-.9 2-2 0-.52-.2-.97-.54-1.32-.34-.36-.54-.82-.54-1.33 0-1.1.9-2 2-2h2.35C19.93 15.35 22 13.24 22 10.65 22 5.88 17.52 2 12 2zM6.5 12a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" />
            </svg>
          </button>
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setHelperMenuOpen((v) => !v); }}
              className="topbarbtn"
              title="Help"
              data-helper="Help"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.5 9a2.75 2.75 0 0 1 5.25 1.1c0 1.6-2.25 2.4-2.75 3.4" />
                <path d="M12 17h.01" />
              </svg>
            </button>
            {helperMenuOpen && (
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
                      className="absolute left-full top-0 ml-1 bg-surface border border-edge-subtle rounded shadow-md text-xs text-ink-body py-1 min-w-[160px]"
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
                <div className="border-t border-edge-subtle" />
                <button
                  onClick={() => { helperMode.toggle(); setHelperMenuOpen(false); }}
                  className="w-full text-left px-3 py-2 hover-on-light flex items-center justify-between gap-3"
                >
                  <span>Helper mode</span>
                  <span className="text-[var(--accent)]">{helperMode.on ? "✓" : ""}</span>
                </button>
              </div>
            )}
          </div>
          {/* Print — opens a dialog with toggles for which document
              elements and panel appendices to include, then hands off
              to the browser's native print sheet. Cmd/Ctrl+P routes to
              the same dialog. Disabled in code view (CodeMirror's
              virtualized rendering doesn't paginate cleanly). Mode
              toggle: aria-pressed while the dialog is open; clicking
              again closes it. */}
          <button
            onClick={() => setPrintOpen((v) => !v)}
            disabled={!currentDocId || codeView || pdfView}
            className="topbarbtn"
            title="Print…"
            aria-pressed={printOpen}
            data-helper="Print"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 6 2 18 2 18 9" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
          </button>
          {/* AI request — sun-star: eight equal-length rays meeting
              at the center. Cardinal lines span 20 units (2→22);
              diagonals span ~20 units using 12 ± 7.07 ≈ 4.93/19.07.
              Mode toggle: clicking again closes the window. */}
          <button
            onClick={() => setAiWindowOpen((v) => !v)}
            className="topbarbtn relative"
            aria-pressed={aiWindowOpen}
            title="AI requests"
            data-helper="AI requests"
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
            {vbar.aiDot && (
              <span
                className="absolute top-0 right-0 w-1.5 h-1.5 rounded-full"
                style={{
                  backgroundColor:
                    vbar.aiDot === "red" ? "#ef4444"
                    : vbar.aiDot === "green" ? "#22c55e"
                    : "#eab308",
                }}
              />
            )}
          </button>
          {/* ── Document style ─────────────────────────────────────────
              Mode toggle: opens ManageStylesModal where the user can
              apply a style to the active doc, edit/rename/delete
              library entries, save the current preamble as a new
              style, and add new entries. aria-pressed mirrors the
              modal's open state. */}
          <button
            onClick={() => setManageStylesOpen((v) => !v)}
            disabled={!currentDocId}
            className="topbarbtn"
            title="Document style"
            aria-pressed={manageStylesOpen}
            data-helper="Document style"
          >
            Style
          </button>
          {/* Code view toggle — reads local `codeView` (not
              `vbar.codeView`) because EditorPane unmounts in code
              view, leaving paneState's mirror stale. `toggleCodeView`
              dispatches to the correct switchTo/switchFrom internally. */}
          <button
            onClick={toggleCodeView}
            className="topbarbtn"
            title={codeView ? "Visual Editor" : "Code Editor"}
            aria-pressed={codeView}
            data-helper={codeView ? "Visual editor" : "Code editor"}
          >
            {codeView ? (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                Visual
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="16 18 22 12 16 6" />
                  <polyline points="8 6 2 12 8 18" />
                  <line x1="14.5" y1="4" x2="9.5" y2="20" />
                </svg>
                Code
              </>
            )}
          </button>
          {/* Compile — runs SwiftLaTeX's pdfTeX over the paper folder and
              saves the resulting PDF to the paper folder. Disabled while a
              compile is in flight; spinner replaces the play-triangle. */}
          <button
            onClick={vbar.compilePdf}
            disabled={!currentDocId || vbar.isCompiling}
            className="topbarbtn"
            title={vbar.isCompiling ? "Compiling…" : "Compile to PDF"}
            data-helper="Compile"
          >
            {vbar.isCompiling ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <polygon points="6 4 20 12 6 20 6 4" />
              </svg>
            )}
            Compile
          </button>
          {/* PDF view toggle — same indirection trap as code view:
              EditorPane unmounts in PDF view so paneState's mirror
              goes stale. Read local `pdfView` directly. */}
          <button
            onClick={togglePdfView}
            disabled={!currentDocId}
            className="topbarbtn"
            title={pdfView ? "Back to editor" : "View PDF"}
            aria-pressed={pdfView}
            data-helper={pdfView ? "Back to editor" : "View PDF"}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            PDF
            {vbar.pdfStale && pdfView && (
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 ml-1" title="PDF is out of date" />
            )}
          </button>
          </>)}
          </>)}
          {/* Collapse toggle — always rendered. Hides everything to its
              left in this cluster (modes section, divider, icon/text
              buttons, Zen) so the document area can breathe. State is
              per-window via useViewPrefs. The chevron flips direction so
              the button reads as "collapse to right" or "expand from
              right" depending on state. */}
          <button
            onClick={() => setTopbarRightCollapsed((v) => !v)}
            className="topbarbtn"
            title={prefs.topbarRightCollapsed ? "Expand toolbar" : "Collapse toolbar"}
            aria-pressed={prefs.topbarRightCollapsed}
            aria-label={prefs.topbarRightCollapsed ? "Expand toolbar" : "Collapse toolbar"}
            data-helper="Collapse toolbar"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {prefs.topbarRightCollapsed ? (
                <>
                  <polyline points="11 17 6 12 11 7" />
                  <polyline points="18 17 13 12 18 7" />
                </>
              ) : (
                <>
                  <polyline points="13 17 18 12 13 7" />
                  <polyline points="6 17 11 12 6 7" />
                </>
              )}
            </svg>
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
      {activePane === "paper" && currentPaperCitekey ? (
        <div className="flex flex-1 overflow-hidden bg-[var(--background)]">
          <PaperOuterView citekey={currentPaperCitekey} />
        </div>
      ) : activePane === "library-outer" &&
        currentLibraryOuterId === OUTER_LIBRARY_ROOT_ID ? (
        <div className="flex flex-1 overflow-hidden bg-[var(--library-bg)]">
          <LibraryTabView
            key={currentDocId ?? "no-doc"}
            openTabs={openTabs}
            currentDocId={currentDocId}
            currentDoc={currentDoc}
            focusDoc={focusDoc}
            docs={docs}
            onOpenRecent={openFile}
            onOpenFolder={onOpenFolderAndAdd}
            onCreateNew={onCreateNewAndAdd}
            devStorage={devStorage}
            myPaperIds={myPaperIds}
            addMyPaper={addMyPaper}
            removeMyPaper={removeMyPaper}
          />
        </div>
      ) : activePane === "library-outer" && currentLibraryOuterId ? (
        <div className="flex flex-1 overflow-hidden bg-[var(--library-bg)]">
          <LibraryOuterView
            libId={currentLibraryOuterId}
            openTabs={openTabs}
            currentDocId={currentDocId}
            currentDoc={currentDoc}
            focusDoc={focusDoc}
          />
        </div>
      ) : currentDoc && docPermState !== "granted" ? null : codeView && currentDocId ? (
        <div
          className="flex flex-1 overflow-hidden"
          style={{
            paddingTop: 4,
            paddingBottom: zenModeOn ? 4 : 'var(--pod-gap)',
            paddingLeft: 4,
            paddingRight: 4,
          }}
        >
        <div
          className="flex flex-1 min-h-0 overflow-hidden"
          style={{
            background: 'var(--pod-editor)',
            borderRadius: 'var(--pod-radius)',
            border: 'var(--pod-border)',
            boxShadow: 'var(--pod-shadow)',
          }}
        >
          <CodeEditor
            docId={currentDocId!}
            initialLine={codeViewLine}
            initialParagraphId={codeViewParagraphId}
            onReady={(handle) => { codeEditorHandleRef.current = handle; }}
            onTextChange={handleCodeEditorTextChange}
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
        </div>
      ) : pdfView && currentDocId ? (
        <div
          className="flex flex-1 overflow-hidden"
          style={{
            paddingTop: 4,
            paddingBottom: zenModeOn ? 4 : 'var(--pod-gap)',
            paddingLeft: 4,
            paddingRight: 4,
          }}
        >
          <div
            className="flex-1 flex flex-col min-h-0 overflow-hidden relative"
            style={{
              background: '#525659',
              borderRadius: 'var(--pod-radius)',
              border: 'var(--pod-border)',
              boxShadow: 'var(--pod-shadow)',
            }}
          >
            {pdfBlobUrl ? (
              <iframe
                src={pdfBlobUrl}
                className="w-full h-full border-none"
                style={{ borderRadius: 'var(--pod-radius)' }}
                title="Compiled PDF"
              />
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <div className="text-center text-white/70 p-8">
                  <p className="text-lg mb-2">No compiled PDF</p>
                  <p className="text-sm">Click Compile to generate a PDF.</p>
                </div>
              </div>
            )}
            {pdfStale && pdfBlobUrl && (
              <div className="absolute top-3 right-3 bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded shadow flex items-center gap-1.5 z-10">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 inline-block" />
                PDF is out of date
              </div>
            )}
          </div>
        </div>
      ) : currentDocId ? (
        <div data-virgil-row-scroll className="flex flex-1 min-h-0 overflow-x-auto overflow-y-auto">
          {/* `<DocPipeline key={currentDocId}>` is the architectural
              wall against the cross-doc autosave bug: every doc switch
              fully unmounts EditorPane, useDocument, and TipTap, so no
              stale closure / editor state can carry the prior doc's
              content into the next doc's save. The boundary also opens
              the per-doc write pipeline used by writeDocBundle's
              assertActive check. */}
          <DocPipeline key={currentDocId} docId={currentDocId}>
            <EditorPane
              ref={editorRef}
              docId={currentDocId}
              editable={collab.canEditMainText}
              chrome={FULL_CHROME}
              onUpdate={handleUpdate}
              onEditorReady={setEditorInstance}
              onActivate={handleEditorPaneActivate}
              onPaneStateChange={setPaneState}
              pdfView={pdfView}
              onTogglePdfView={togglePdfView}
              codeView={codeView}
              onToggleCodeView={toggleCodeView}
              placements={prefs.placements}
              viewPrefs={editorPaneViewPrefs}
              menuBar={editorPaneMenuBar}
              aiWindowOpen={aiWindowOpen}
              onAiWindowClose={() => setAiWindowOpen(false)}
              highlightText={highlightText}
              highlightRange={effectiveHighlightRange}
              onDocumentClassMismatch={promptDocClassMismatch}
            />
          </DocPipeline>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center bg-[var(--background)]">
          <div className="flex flex-col items-center gap-6 px-6 py-8 w-full max-w-md">
            {docs.length > 0 ? (
              <RecentPapersList docs={docs} onOpen={openFile} />
            ) : (
              <div className="text-ink-subtle text-sm">No document open</div>
            )}
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
            <InstallPwaPrompt />
          </div>
        </div>
      )}
      <PrintDialog
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        options={prefs.printOptions}
        onOptionsChange={setPrintOptions}
        marginaliaLive={showMarginalia}
      />
      <FontsDialog
        open={fontsOpen}
        onClose={() => setFontsOpen(false)}
        prefs={editorPrefs}
        onUpdate={updatePref}
      />
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
      {manageStylesOpen && (
        <ManageStylesModal
          onClose={() => setManageStylesOpen(false)}
          docId={currentDocId}
          aiRequests={vbar.aiRequests}
          addStyleMergeRequest={vbar.addStyleMergeRequest}
        />
      )}
      {/* AIWindow now mounts inside EditorPane (which holds the per-doc
          hooks the modal reads). EditorLayout owns only the open-state
          and the trigger button in the Virgil bar. */}
      {confirmDialog}
      {identityDialog}
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
      {activeMath && (
        <MathPopover
          kind={activeMath.kind}
          latex={activeMath.latex}
          anchorRect={activeMath.rect}
          onSave={(newLatex) => handleMathSave(activeMath.pos, newLatex)}
          onClose={() => setActiveMath(null)}
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
            const meta =
              newDocModal.mode === "inFolder"
                ? await createFileInPendingFolder(name, templateId)
                : await createFile(name, templateId);
            if (meta) newDocModal.onCreated?.(meta.id);
            setNewDocModal(null);
          }}
        />
      )}
      {/* Per-card popouts now mount inside EditorPane — see EditorPane.tsx
          for the `viewPrefs && !zenMode` gate and the `popoutsDeps` bag.
          The DockOutline / CardLiftOutline / FloatingPanel surfaces moved
          earlier in 7.8; this entry was the last shell-rooted bit of
          per-doc rendering. */}
    </div>
    </CollabProvider>
    </RecentlyAddedProvider>
    </PristineCardsProvider>
    </SelectionsProvider>
    </CitationDisplayProvider>
    </AiRequestsProvider>
    </EditorRefProvider>
    </EditorLayoutProvider>
  );
}

/**
 * Vertical line marking the insertion point during a paper-tab drag
 * onto the Virgil bar. Mirrors the inner library strip's drop indicator
 * shape (2px accent line) but positioned inside the outer tab strip.
 */
function PaperDropIndicator({
  stripEl,
  tabRefs,
  order,
  index,
}: {
  stripEl: HTMLDivElement | null;
  tabRefs: Map<string, HTMLElement>;
  order: string[];
  index: number;
}) {
  if (!stripEl) return null;
  const stripRect = stripEl.getBoundingClientRect();
  let x: number;
  if (order.length === 0) {
    x = 4;
  } else if (index <= 0) {
    const first = tabRefs.get(order[0]);
    x = first ? first.getBoundingClientRect().left - stripRect.left - 1 : 4;
  } else if (index >= order.length) {
    const last = tabRefs.get(order[order.length - 1]);
    x = last ? last.getBoundingClientRect().right - stripRect.left + 1 : 4;
  } else {
    const left = tabRefs.get(order[index - 1]);
    const right = tabRefs.get(order[index]);
    if (left && right) {
      const lr = left.getBoundingClientRect();
      const rr = right.getBoundingClientRect();
      x = (lr.right + rr.left) / 2 - stripRect.left - 1;
    } else {
      x = 4;
    }
  }
  return (
    <div
      style={{
        position: "absolute",
        top: 4,
        bottom: 0,
        left: x,
        width: 2,
        background: "var(--accent)",
        borderRadius: 1,
        pointerEvents: "none",
        zIndex: 30,
      }}
    />
  );
}
