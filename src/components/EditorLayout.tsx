"use client";

import { useState, useCallback, useEffect, useLayoutEffect, useRef, useMemo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { JSONContent } from "@tiptap/react";
import VirgilEditor, { EditorHandle } from "./Editor";
import { LoadingScreen } from "./LoadingScreen";
import { VIRGIL_COMMAND_NAMES } from "@/lib/tiptap-extensions";
import { setFocusBandMeta } from "@/lib/focus-view";
import { isLabelTaken as isLabelTakenIn } from "@/lib/labels";
import { isDevStorage } from "@/lib/storage-mode";
import { isTier1BDisabled } from "@/lib/perf-flags";
import { readPdf } from "@/lib/storage";
import { migrateDocAwarePopoutKey } from "@/text-objects/post-load-migrations";
import { useTransientAnchorCleanup } from "@/text-objects/useTransientAnchorCleanup";
import { type DividerLevel, type DividerWidth } from "@/hooks/useViewPrefs";
import { Editor } from "@tiptap/react";
import { type SectionPathEntry, buildPerBlockCounts, sumIncludedWords, extractHeadings } from "@/panels/Outline";
import { useFiles } from "@/hooks/useFiles";
import { getBus } from "@/lib/tiptap/doc-structure";
import { useStructuralRevisions } from "@/hooks/useStructuralRevisions";
import { useMyPapers } from "@/hooks/useMyPapers";
import { useFloatingMenuPosition } from "@/hooks/useFloatingMenuPosition";
import { useUpdateAvailable, applyUpdate } from "@/hooks/useUpdateAvailable";
import SkillSyncControls from "./SkillSyncControls";
import { DocPipeline } from "./editor-layout/DocPipeline";
import { useSelectedAnchorSync } from "@/hooks/useSelectedAnchorSync";
import { CollabProvider, COLLAB_INERT, type CollabHook } from "@/hooks/useCollab";
import { collabClaimScope } from "@/cards/predicates";
import CollabStatusPill from "./CollabStatusPill";
import ExternalChangeBadge from "./ExternalChangeBadge";
import { useExternalChangesOrNull } from "@/hooks/useExternalChanges";
import { useCollaboratorIdentity } from "./CollaboratorIdentityDialog";
import { useLatexLint } from "@/hooks/useLatexLint";
import { mergeLatexErrors, type LatexError } from "@/lib/latex-errors";
import { findParagraphUuids, paragraphForLine } from "@/lib/latex-paragraph-map";
import { ErrorsHost } from "./editor-layout/panels/errors-host";
import { pruneExpanded } from "@/panels/Errors/expansion";
import { IconErrors } from "./editor-layout/panel-icons";
import PrintDialog from "./PrintDialog";
import FontsDialog from "./FontsDialog";
import { useSuggestions } from "@/hooks/useSuggestions";
import { useRevisions } from "@/hooks/useRevisions";
import { useTodos } from "@/hooks/useTodos";
import { useAiRequests } from "@/hooks/useAiRequests";
import type { AiRequest } from "@/lib/types";
import { useArchive } from "@/hooks/useArchive";
import { CITATIONS_INERT } from "@/hooks/useCitations";
import ManageStylesModal from "./ManageStylesModal";
import { useNotes } from "@/hooks/useNotes";
import { useCutter } from "@/hooks/useCutter";
import {
  isAnchorableNode,
  MIME_ARCHIVE,
} from "@/lib/marginalia";
import { useSyncExternalStore } from "react";
import {
  getPanelColor,
  getPanelColorVersion,
  loadPanelColors,
  subscribePanelColors,
  type PanelThemeKey,
} from "@/lib/panel-theme";
import { IN_TEXT_ANCHOR_ACCENTS } from "@/cards/predicates";
import { loadPanelTypography, setTierBaseFontSizes } from "@/lib/panel-typography";
import { loadPrefLinks } from "@/lib/pref-links";
import { useDevPrefsMirror } from "@/lib/dev-prefs-mirror";
import { useScrollActivityTracker } from "@/hooks/useScrollActivityTracker";

/**
 * Idempotent boot loader for the per-user theming prefs: forces
 * `loadPanelColors` / `loadPanelTypography` / `loadPrefLinks` to run once
 * on first client render (each is internally guarded against re-runs), and
 * subscribes the EditorLayout tree to panel-color changes so any consumer
 * reading panel colors re-renders when an override lands. The returned
 * version number is intentionally unused — the subscription side effect is
 * the point.
 */
function usePanelColorSubscription(): number {
  // Load overrides on first use (idempotent).
  if (typeof window !== "undefined") {
    loadPanelColors();
    loadPanelTypography();
    loadPrefLinks();
  }
  return useSyncExternalStore(subscribePanelColors, getPanelColorVersion, () => 0);
}
import {
  getLinkedTextObjectIds,
} from "@/links/links";
import type { LinkedAnchorKind } from "@/links/links";
import dynamic from "next/dynamic";
import type { CodeEditorHandle } from "./CodeEditor";
const CodeEditor = dynamic(() => import("./CodeEditor"), { ssr: false });
import {
  type OmniCategory,
  deriveCategorySides,
  OmniFilterMenu,
} from "@/panels/Omni";
import { useViewPrefs, PanelId, Side, ALL_HIGHLIGHT_TYPES, HighlightType, dockedSideOf, isPanelDocked } from "@/hooks/useViewPrefs";
import { useLinkHighlight } from "@/links/_shared/useLinkHighlight";
import { entityToAnchorId } from "@/links/_shared/entity-hover";
import { PanelChromeProvider } from "./panel-primitives";
import FloatingPanel from "./FloatingPanel";
import { DockOutline } from "./editor-layout/DockOutline";
import { CardLiftOutline } from "./CardLiftOutline";
import {
  FLOATING_PANEL_WIDTH,
  FLOATING_PANEL_HEIGHT,
  FLOATING_PANEL_VIEWPORT_MARGIN,
  FLOATING_PANEL_STACK_OFFSET,
  FLOATING_PANEL_Z_BASE,
} from "./editor-layout/constants";
import { FLOAT_Z_BASE, OPEN_CHROME_MENU_Z } from "@/floats/float-policy";
import {
  alignEntryToY,
  scrollEntryIntoView,
  findEditorScrollFor,
  SECTION_ACTIVE_LINE_FRACTION,
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
import { useOrphanActions } from "./editor-layout/card-actions/orphans";
import { useCitationActions } from "./editor-layout/card-actions/citations";
import { useRefActions } from "./editor-layout/card-actions/ref";
import { useLibraryBridge } from "./editor-layout/event-bridges/library";
import { findOmniEntry } from "./editor-layout/event-bridges/open-for-card";
import { useMarkerClickBridges } from "./editor-layout/event-bridges/marker-clicks";
import { useFootnoteSyncBridges } from "./editor-layout/event-bridges/footnote-sync";
import { EditorLayoutProvider } from "./editor-layout/context";
import { EditorRefProvider } from "./editor-layout/contexts/editor-ref";
import { DiskWatcherProviderGate } from "./editor-layout/contexts/disk-watcher";
import { AiRequestsProvider } from "./editor-layout/contexts/ai-requests";
import { CitationDisplayProvider } from "./editor-layout/contexts/citation-display";
import { SelectionsProvider, useAnchoredSelectionSlots } from "./editor-layout/contexts/selections";
import { cardStore } from "@/links/_shared/anchored-card-store";
import { RecentlyAddedProvider } from "./editor-layout/contexts/recently-added";
import { RecentlyAddedAutoClear } from "./editor-layout/recently-added-auto-clear";
import { useRecentlyAddedTracker } from "@/hooks/useRecentlyAddedTracker";
import { OutlineHost } from "./editor-layout/panels/outline-host";
import { CutterHost } from "./editor-layout/panels/cutter-host";
import { TodoHost } from "./editor-layout/panels/todo-host";
import { ArchiveHost } from "./editor-layout/panels/archive-host";
import { BibliographyHost } from "./editor-layout/panels/bibliography-host";
import { NotesHost } from "./editor-layout/panels/notes-host";
import { FootnotesHost } from "./editor-layout/panels/footnotes-host";
import { RevisionsHost } from "./editor-layout/panels/revisions-host";
import { CitationsHost } from "./editor-layout/panels/citations-host";
import { OmniHost } from "./editor-layout/panels/omni-host";
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
import {
  buildEditorPaneViewPrefs,
  type EditorMutationHandlers,
  type EditorPaneViewDerivations,
} from "./editor-layout/build-editor-pane-view-prefs";
import { SplitWithCode } from "./editor-layout/split-with-code";
import { FULL_CHROME } from "./editor-layout/chrome-config";
import { EditorChromeProvider } from "./editor-layout/chrome-context";
import { useConfirmDialog } from "./ConfirmDialog";
import { useDocumentClassMismatchDialog } from "./DocumentClassMismatchDialog";
import LabelRefPopover from "./LabelRefPopover";
import { CitationCreatePopover } from "@/panels/Citations/CitationCreatePopover";
import type { AtomCreateRequest } from "@/lib/actions/atom-create";
import { getEditorActionsHandle } from "@/lib/actions/editor-actions-bridge";
import { insertInlineAtom } from "@/lib/tiptap/insert-inline-atom";
import { serializeCiteCommand } from "@/lib/bib-parser";
import { generateShortId } from "@/lib/uuid";
import MathPopover from "./MathPopover";
import FigurePopover from "./FigurePopover";
import { extractFigureAttrs, extractGraphicsAttrs } from "@/lib/figures/parse-attrs";
import { parseInlineContent as parseInlineLatexForCaption } from "@/lib/latex-parser";
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
      data-hint={title}
      className={`group relative flex items-center gap-1.5 ${padding} h-[24px] cursor-default shrink-0`} aria-label={title}
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
          data-hint="Close tab"
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
    skillSyncError,
    skillSyncNotice,
    resyncSkills,
    dismissSkillSyncError,
    dismissSkillSyncNotice,
  } = useFiles();
  const libraryRegistry = useLibraryRegistry();
  const { myPaperIds, addMyPaper, removeMyPaper } = useMyPapers();

  useLibraryBridge({ activateLibraryOuterPane, openPaperTab });

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

  // "Is the external-change badge currently showing something?" — lifted from a
  // provider-descendant reporter (ExternalChangeActiveReporter, rendered in the
  // status cluster) so the topbar DIVIDER gate can OR it in. EditorLayout's own
  // body sits ABOVE the DiskWatcherProvider in the tree, so it can't read
  // useExternalChanges() directly; the reporter pushes the boolean up instead.
  // KEYSTROKE SANCTITY: the reporter reads useSyncExternalStore over the
  // watcher's stable snapshot — NOT any editor subscription — so this adds zero
  // per-keystroke work.
  const [externalChangeActive, setExternalChangeActive] = useState(false);
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

  // `promptDocClassMismatch` feeds EditorPane's live `useLatexCompile`
  // (via the `onDocumentClassMismatch` prop below) — EditorLayout no longer
  // mounts its own compile hook. Compile errors / log / status are read from
  // the live pane via `paneState` (the single authoritative compile source).
  const { prompt: promptDocClassMismatch, dialog: docClassDialog } =
    useDocumentClassMismatchDialog();
  const {
    state: suggestionsState,
    currentSuggestion,
    isComplete,
    updateSuggestionField,
    jumpToSuggestion,
    clearSuggestions,
  } = useSuggestions(docIdForHooks);
  const {
    cards: revisionCards,
  } = useRevisions(docIdForHooks);
  const comments = revisionCards;
  // R21: the pristine-card manager lives ONLY in EditorPane (its single live
  // manager owns blank-on-create click-away discard for every kind). The
  // duplicate manager that used to mount here was render-dead — the panels
  // moved to EditorPane post-7.8, so this shell's parity mounts of useNotes/
  // useCutter/useTodos never surfaced a pristine card. Those parity hooks now
  // fall back to their own usePristineTracker (the `?? localPristine` net,
  // kept per the WS2 defer ruling). The margin-marker pipeline (markers +
  // delete handlers) lives entirely in EditorPane; this shell keeps only the
  // card arrays it still reads (anchor re-apply, hover→anchor derivation,
  // selected-anchor sync) plus the add/drop-bridge mutators.
  const recentlyAdded = useRecentlyAddedTracker();
  const {
    notes,
    highlights,
    addNote,
    addHighlight,
    setNoteAnchor,
  } = useNotes(docIdForHooks);
  const {
    cards: cutterCards,
    goal: cutterGoal,
    setGoal: setCutterGoal,
    clearGoal: clearCutterGoal,
  } = useCutter(docIdForHooks);
  // Anchored selection slots (note, footnote, citation, example,
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
    selectedReportCardId, setSelectedReportCardId,
    selectedCommentId, setSelectedCommentId,
    selectedExampleId, setSelectedExampleId,
  } = useAnchoredSelectionSlots();
  const {
    items: todoItems,
    addItem: addTodo,
    updateItem: updateTodo,
    archiveDone: archiveTodos,
  } = useTodos(docIdForHooks);

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
    restoreSnippet,
    deleteSnippet,
  } = useArchive(docIdForHooks);

  // Citations bubble up from EditorPane — see PaneState in EditorPane.tsx.
  // Previously both EditorLayout and EditorPane independently called
  // `useCitations(docId)` for the same doc, causing duplicate
  // `parseBibFile` runs and duplicate `DOC_BIB_CHANGED_EVENT` listeners.
  // Falls back to the inert no-op hook until paneState arrives — same
  // pattern as `collab` below.
  const citationsHook = paneState?.citationsHook ?? CITATIONS_INERT;
  const {
    bibEntries,
    addCitation,
    // NB: the bare `citationsHook.deleteCitation` (sidecar-only filter) is
    // intentionally NOT destructured here — citation deletes must go through
    // EditorPane's compound `handleDeleteCitation`, which strips the `\cite`
    // atom too (the #37 hard-delete contract). This shell has no editor
    // handle, so the unsafe path stays out of reach from EditorLayout.
    getDisplayText: getCitationDisplayText,
  } = citationsHook;

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

  // Main-app view-state engine (global persistence — the default). Captured
  // whole so the shared `buildEditorPaneViewPrefs` builder can read every
  // layout setter off it; the destructure below keeps the ~100 existing
  // call sites in EditorLayout working unchanged.
  const viewPrefsResult = useViewPrefs();
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
    setPanelHeight,
    clearPanelHeight,
    tradePanelHeights,
    notePanelUse,
    setEditorSplit,
    setEditorSplitRatio,
    setCodePaneRatio,
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
    migratePoppedOutCards,
    setPrintOptions,
    setEditorLeftMargin,
    setEditorRightMargin,
    setEditorTopMargin,
    setEditorBottomMargin,
    setTopbarRightCollapsed,
    toggleMarginalia,
    toggleMarginaliaType,
    toggleSectionIndicator,
    toggleHeadingLabels,
    toggleDividerLevel,
    setDividerWidth,
    toggleParTitles,
    toggleLatexComments,
    toggleOmniCategory,
    resetOmniSide,
    toggleOmniHideAllCards,
    setCardArchiveView,
    setSuppressArchiveAtomWarning,
    setBibFilter,
  } = viewPrefsResult;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const editorSplit = prefs.editorSplit;
  const editorSplitRatio = prefs.editorSplitRatio;

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
    | { kind: "card"; key: string };
  const refKey = (r: FloatingRef): string =>
    r.kind === "panel" ? `panel:${r.id}` : `card:${r.key}`;
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

  // Raise-on-click: paint z-index for a card/text-object float, derived from the
  // MRU focus stack so clicking a buried float brings it forward (was insertion
  // order). Cards focused most recently sit at the end of the stack → highest z.
  // A just-opened float not yet in the stack falls to the top of the band.
  const cardFloatZIndex = useCallback(
    (key: string): number => {
      const cards = focusStack.filter(
        (r): r is { kind: "card"; key: string } => r.kind === "card",
      );
      const idx = cards.findIndex((r) => r.key === key);
      return FLOAT_Z_BASE + (idx >= 0 ? idx : cards.length);
    },
    [focusStack],
  );

  // Lockstep popout-key remap (one card morphs kind while popped → its stored
  // `float:card:<kind>:<id>` key must follow, or `FloatHost` re-derives the old
  // kind and the float vanishes). Routes through `migratePoppedOutCards` so the
  // saved rect in `cardFloatPositions` moves with the key (never orphans).
  const remapCardPopKey = useCallback(
    (oldKey: string, newKey: string) => {
      if (oldKey === newKey) return;
      migratePoppedOutCards((k) => (k === oldKey ? newKey : k));
    },
    [migratePoppedOutCards],
  );

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
  // than the margin button (e.g. float's own X, restored from prefs),
  // ping the editor so every paragraph node view rebuilds its glyph.
  // (The ref EditorPane passes to its VirgilEditor handles the per-render
  // glyph predicate; this just nudges the editor on prefs change.)
  // The paragraph / heading / example refreshers used to be needed by
  // the per-NodeView margin popout buttons to flip their glyphs when
  // popout state changed externally. After Phase D4 (grab-handle
  // unification), those buttons are gone and the editor-mounted
  // TextObjectGrabHandle subscribes to viewPrefs directly via
  // `usePoppedCards()` — no manual refresh ping needed.
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null);
  // A plain selection grab pops out a cardless `linkedRange` whose invisible
  // transient anchor must be stripped from the doc when the popout closes
  // (it's a gesture handle, not an annotation). Watches poppedOutCards so it
  // catches every close path.
  useTransientAnchorCleanup(editorInstance, prefs.poppedOutCards);
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
  const focusMode = useFocusMode(docIdForHooks, editorInstance);
  const { config: focusWcConfig } = useWordCountConfig();
  // Paragraph-titles + %-comments visibility — persisted via ViewPrefs
  // (global, like their View-menu siblings). Previously a plain
  // `useState(true)` here, which reset on every reload (the reported bug);
  // now derived read-side from `prefs`, toggled via `toggleParTitles` /
  // `toggleLatexComments`.
  const showParTitles = prefs.showParTitles;
  const showLatexComments = prefs.showLatexComments;

  // Marginalia / divider / heading-label visibility — persisted via
  // ViewPrefs (global, mirrors across windows, rides the personal-prefs
  // promotion pipeline). The toggles arrive as setters from useViewPrefs
  // above; we derive the read-side state here so existing usage sites
  // (props plumbing into MenuBar, EditorPane decoration classes) keep
  // their current shape.
  const showMarginalia = prefs.showMarginalia;
  const hiddenMarginaliaTypes = useMemo(
    () => new Set(prefs.hiddenMarginaliaTypes),
    [prefs.hiddenMarginaliaTypes],
  );
  const showSectionIndicator = prefs.showSectionIndicator;
  const showHeadingLabels = prefs.showHeadingLabels;
  const dividerLevels = useMemo(
    () => new Set(prefs.dividerLevels),
    [prefs.dividerLevels],
  );
  const dividerWidth = prefs.dividerWidth;

  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [aiWindowOpen, setAiWindowOpen] = useState(false);
  const [commandsPopoutOpen, setCommandsPopoutOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [fontsOpen, setFontsOpen] = useState(false);
  const [helperMenuOpen, setHelperMenuOpen] = useState(false);
  // Anchor rect for the body-portaled Help dropdown. The dropdown is
  // portaled to document.body (not rendered inline) so it escapes the
  // virgil-bar's `sticky z-30` stacking context — otherwise floating
  // panels / popped cards (z-1200+) paint over it (backlog #9). Captured
  // from the Help button on open; refreshed on resize/scroll while open.
  const helperBtnRef = useRef<HTMLButtonElement>(null);
  const [helperAnchorRect, setHelperAnchorRect] = useState<DOMRect | null>(null);
  const {
    ref: helperPositionRef,
    style: helperPositionStyle,
  } = useFloatingMenuPosition({
    anchorRect: helperAnchorRect,
    placements: [
      { side: "below", align: "end" },
      { side: "above", align: "end" },
    ],
    gap: 4,
  });
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
    if (!helperMenuOpen) {
      setHelperAnchorRect(null);
      return;
    }
    setHelperAnchorRect(helperBtnRef.current?.getBoundingClientRect() ?? null);
    const close = () => { setHelperMenuOpen(false); setCommandsPopoutOpen(false); };
    const refreshAnchor = () => {
      setHelperAnchorRect(helperBtnRef.current?.getBoundingClientRect() ?? null);
    };
    const id = window.setTimeout(() => window.addEventListener("click", close), 0);
    window.addEventListener("resize", refreshAnchor);
    window.addEventListener("scroll", refreshAnchor, true);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("click", close);
      window.removeEventListener("resize", refreshAnchor);
      window.removeEventListener("scroll", refreshAnchor, true);
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
        // Column width is keyed by side now (panelWidths[`${side}`]), not by
        // the docked panel — so persist whenever the side isn't collapsed.
        // The omni desktop always backs a non-collapsed side, so an empty
        // stack still has a meaningful rendered width to capture. The id arg
        // to get/setPanelWidth is ignored (side-keyed); pass a stable token.
        const collapsed = side === 'left' ? prefs.collapsedLeft : prefs.collapsedRight;
        if (collapsed) return;
        const currentPref = getPanelWidth(side, "omni");
        if (Math.abs(rendered - currentPref) > 0.5) {
          setPanelWidth(side, "omni", rendered);
        }
      }
    });
  }, [zenModeOn, zenLeftMargin, zenRightMargin, setZenLeftMargin, setZenRightMargin, prefs.collapsedLeft, prefs.collapsedRight, setPanelWidth, getPanelWidth]);

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
  // Per-category structural revisions — the keystroke-safe replacement for
  // the old per-keystroke `editorDocVersion` counter and the `latestDoc`-keyed
  // card derivations. Each counter bumps ONLY when its structural entity
  // changes, so card-source memos don't re-derive on plain typing.
  // `latestDoc` survives for genuine full-snapshot consumers (outline,
  // word count, LaTeX serialization). See useStructuralRevisions.
  const rev = useStructuralRevisions(editorInstance);
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
        // Prefix-or-exact (T5 Pillar E-2): a multi-anchor card's wrapper id is
        // `…@<anchorIndex>`, so an `@N`-suffixed `cardId` lands on its own row
        // (exact), and a bare key still resolves a multi-anchor card's first
        // row (prefix). Pin the wrapper's ACTUAL id — not the passed key — so
        // omniPinStore's `pinRequest.cardId === item.id` match holds for the
        // resolved `@N` row (REP-F3-01).
        const wrapper = findOmniEntry(cardId, "data-omni-entry-wrapper");
        const wrapperId = wrapper?.dataset.omniEntryWrapper ?? cardId;
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
        omniPinStore.requestPin(side, wrapperId, pinTop);
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
      // Prefix-or-exact match + pin the wrapper's ACTUAL id (T5 Pillar E-2) so
      // a multi-anchor card's `@N` jump lands on its own row.
      const wrapper = findOmniEntry(omniKey, "data-omni-entry-wrapper");
      const wrapperId = wrapper?.dataset.omniEntryWrapper ?? omniKey;
      const sideEl = wrapper?.closest("[data-panel-column-side]") as HTMLElement | null;
      const side = sideEl?.dataset.panelColumnSide;
      if (side !== "left" && side !== "right") return;
      omniPinStore.requestPin(side, wrapperId, pinTop);
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
  // Typed off the SSOT `LinkedAnchorKind` union (not a hand-maintained
  // duplicate) so adding a new anchor-bearing kind (e.g. "todo") stays in
  // sync with `useSelectedAnchorSync`'s setter signature.
  const [activeAnchorKind, setActiveAnchorKind] = useState<LinkedAnchorKind | null>(null);
  // Hover state read from the canonical cardStore.hover via a
  // useSyncExternalStore subscription. The only EditorLayout-side consumer
  // is the `hoveredAnchorId` derivation below (hover → Mode B anchor id for
  // the linked-anchor highlight). New code should read cardStore directly
  // via useHover().
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
    const out = new Set<"note" | "todo" | "comment" | "cut" | "archive" | "report">();
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
      { notes, cutterCards, comments, todoItems, archiveSnippets, examples: [] },
    );
  }, [hoveredEntityId, hoveredEntityKind, notes, cutterCards, comments, todoItems, archiveSnippets]);

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
  // ── Shared inline-atom CREATE popover state (citation + `\ref`) ──
  // The deferred-commit front door: a trigger surface opens this at the caret;
  // the popover materializes the atom only on commit. `\ref` create folds onto
  // this in a later chip — for now only `kind: "citation"` is dispatched.
  const [atomCreateRequest, setAtomCreateRequest] =
    useState<AtomCreateRequest | null>(null);
  // ── Math popover state ──
  const [activeMath, setActiveMath] = useState<{
    kind: "inline" | "display";
    latex: string;
    pos: number;
    rect: DOMRect;
    // The editor instance that owns the clicked math node — the save targets
    // THIS editor (main OR an embedded card/float surface), so a math edit
    // always lands in the editor whose pos-space `pos` belongs to. See
    // `handleMathSave` and math.ts's click bridge (EX-F4-02).
    editor: Editor;
  } | null>(null);
  // ── Figure tex-mode popover state ──
  const [activeFigure, setActiveFigure] = useState<{
    kind: string;
    raw: string;
    pos: number;
    rect: DOMRect;
    // The editor instance that owns the clicked figure/graphics node — the save
    // targets THIS editor (main OR the figure's own float surface), so a figure
    // edit always lands in the editor whose pos-space `pos` belongs to. Mirrors
    // `activeMath.editor`; see `handleFigureSave` + FigureBlockNodeView's click
    // bridge (EX-F4-02 figure twin).
    editor: Editor;
  } | null>(null);
  const [bibActiveCitationId, setBibActiveCitationId] = useState<string | null>(null);
  // NOTE (CHIP 4a-ii): EditorLayout's own `pendingCitationCreate` /
  // `pendingCitationMode` state was consumed ONLY by the now-removed
  // `useCommandInputBridges` `virgil-citation-create` handler (the citation
  // slash/typed path migrated to the action-registry bridge). The panel
  // "+ Add citation" draft uses a SEPARATE copy owned by EditorPane
  // (EditorPane.tsx → CitationsHost), so this duplicate is dead and removed.
  //
  // The search-highlight + search-panel state used to live here too, as a DEAD
  // duplicate: SearchHost mounts inside EditorPane, so EditorLayout's local
  // `searchHighlightRange`/`searchState` were never written (the producer is on
  // the other side of the boundary). EditorPane now OWNS them; the live
  // highlight range bubbles up via `paneState.searchHighlightRange`
  // (SR-F3-01/F8-01). EditorLayout reads it back below for `effectiveHighlightRange`.
  const searchHighlightRange = paneState?.searchHighlightRange ?? null;

  // The SearchHost cross-panel jump (`openItemInPanel`) used to live here as a
  // SECOND copy, but SearchHost mounts inside EditorPane and uses EditorPane's
  // own `openItemInPanel` — this copy was never wired to the pane, so it was
  // dead. The single live implementation now lives in EditorPane (it docks the
  // target via `viewPrefs.openPanelDocked`, shared by the main app + Reader).

  // Omni-view category prefs + per-side hide-all toggle — sourced from
  // ViewPrefs (global, cross-window, promotable). The toggles arrive as
  // setters from useViewPrefs; here we just derive the read shape.
  const omniCategories = prefs.omniCategories;
  const omniHideAllCards = prefs.omniHideAllCards;
  // Per-side Sets memoized separately so `getOmniEnabled(side)` returns
  // a reference-stable Set across renders. Previously the getter built
  // `new Set(omniCategories[side])` on every call — the fresh reference
  // broke OmniViewPanel's `memo()` and cascaded through useInTextPositions
  // into a per-keystroke `coordsAtPos` storm. See plan
  // `ok-lets-do-a-dreamy-thacker.md` (flicker fix).
  const leftEnabled = useMemo(
    () => new Set(omniCategories.left),
    [omniCategories.left],
  );
  const rightEnabled = useMemo(
    () => new Set(omniCategories.right),
    [omniCategories.right],
  );
  const getOmniEnabled = useCallback(
    (side: "left" | "right") => (side === "left" ? leftEnabled : rightEnabled),
    [leftEnabled, rightEnabled],
  );
  // Kept as a stable alias for the new useViewPrefs setter so MenuBar's
  // "reset side" wiring doesn't need touching.
  const setOmniSideToDefault = resetOmniSide;
  const getOmniHideAll = useCallback(
    (side: "left" | "right") => omniHideAllCards[side],
    [omniHideAllCards],
  );

  // Derive which strip side each category's native panel lives on
  const categorySides = useMemo(
    () => deriveCategorySides(prefs.placements),
    [prefs.placements],
  );

  // #27: Inject the in-text anchor accent map onto `:root` from the LIVE theme
  // accents (default or user override). The `.linked-anchor[data-link-card^=…]`
  // (Mode B) and `[data-paragraph-kind=…]` (Mode A) selectors in globals.css now
  // read `var(--link-anchor-accent-<token>)` instead of hand-mirrored hex, so an
  // in-text anchor's color derives from the SAME accent source as its card
  // outline (chip E's `PanelCard` inline stamp) — a panel-color override can no
  // longer desync the two. Derived from `CARD_REGISTRY` + the legacy-token
  // crosswalk (`IN_TEXT_ANCHOR_ACCENTS`); subscribed to color changes via the
  // panel-color version (`getPanelColorVersion`). O(1) per change — runs only on
  // a color override, never per keystroke; the loop is over a fixed ~10-token
  // map. Mirrors the existing PREF_TO_CSS injection just below.
  const panelColorVersion = useSyncExternalStore(
    subscribePanelColors,
    getPanelColorVersion,
    () => 0,
  );
  useEffect(() => {
    const s = document.documentElement.style;
    for (const row of IN_TEXT_ANCHOR_ACCENTS) {
      s.setProperty(row.cssVar, getPanelColor(row.themeKey));
    }
    // panelColorVersion is the reactive trigger: a `setPanelColor` bumps it,
    // re-running this effect with the fresh `getPanelColor` reads.
  }, [panelColorVersion]);

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
    // BUG #30: feed the live doc-relative DEFAULT body sizes into the
    // panel-typography store so an un-overridden card body tracks the main
    // text instead of a frozen literal. Borrowed bodies (footnote/archive/
    // example) sit one size below body text (round(rem*16) − 2px); sans
    // bodies track the `panelFontSize` pref. The store setter no-ops when
    // neither value moved, so this is O(1) and only churns on a real font-pref
    // change (this effect is already gated on `editorPrefs`, never per
    // keystroke). The store is NOT a CSS var, so it sidesteps the
    // `--editor-font-size` self-reference cycle (RichTextField / BorrowedMainText
    // re-assign that var onto the card's own PM dom).
    const docPx = Math.round(Number(editorPrefs.editorFontSize) * 16);
    setTierBaseFontSizes(docPx - 2, Number(editorPrefs.panelFontSize));
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
    () => mergeLatexErrors(lintErrors, paneState?.compileErrors ?? []),
    [lintErrors, paneState?.compileErrors],
  );
  const jumpToLineInCode = useCallback(
    (line: number, column?: number) => {
      codeEditorHandleRef.current?.scrollToLine?.(line, column);
    },
    [],
  );
  const [errorsSidebarOpen, setErrorsSidebarOpen] = useState(false);

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
  // Error-card expansion (R5). Since the diagnostics unification, this is
  // the SINGLE expansion set for every error surface: the code-view sidebar
  // here AND EditorPane's docked panel + omni mirror (threaded down via the
  // `expandedErrorIds`/`expandError`/`toggleErrorExpanded` props). One owner,
  // one list — expanding a card on any surface expands it everywhere.
  const [expandedErrorIds, setExpandedErrorIds] = useState<Set<string>>(
    () => new Set(),
  );
  const expandError = useCallback((id: string) => {
    setExpandedErrorIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);
  const toggleErrorExpanded = useCallback((id: string) => {
    setExpandedErrorIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const dismissError = useCallback((id: string) => {
    setDismissedErrorIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setSelectedErrorId((cur) => (cur === id ? null : cur));
    // Prune the dismissed card's expansion alongside (A4 deferred #4).
    setExpandedErrorIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);
  // Prune dead expansion ids when the error list changes. `pruneExpanded`
  // is identity-stable and no-ops on an empty list (the transient
  // mid-compile empty list must not wipe expansion).
  useEffect(() => {
    setExpandedErrorIds((prev) =>
      pruneExpanded(prev, allLatexErrors.map((e) => e.id)),
    );
  }, [allLatexErrors]);

  // Click-away: clear the card SELECTION (the halo) when the user clicks
  // outside any anchored surface. Per N1 (A4), expansion is a separate axis —
  // `clearSelection` drops the halo but leaves every expanded card OPEN. Bib
  // and error are non-anchored — they get their own local clear so unrelated
  // selection is cleared too.
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (
        t.closest("[data-card-key]") ||
        t.closest("[data-marginalia-marker]") ||
        t.closest("[data-marginalia-overflow]") ||
        t.closest(".linked-anchor") ||
        t.closest(".footnote-marker") ||
        t.closest('[data-type="citation"]')
      ) {
        return;
      }
      cardStore.clearSelection();
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

  // Jump to the error's location — MODE-AWARE (Chip C). In code view we
  // STAY in code and scroll the CodeMirror pane to the error line; in PDF
  // view we leave for the visual editor and let the pending-scroll
  // mechanism scroll there once it mounts; in the visual editor we
  // highlight the offending range + scroll the mapped paragraph into view.
  const jumpToError = useCallback(
    (err: LatexError) => {
      setSelectedErrorId(err.id);
      if (codeView) {
        // STAY in code view — scroll the CodeMirror pane to the error line.
        codeEditorHandleRef.current?.scrollToLine?.(err.line, err.column);
        return;
      }
      if (pdfView) {
        // Leave PDF for the visual editor, then scroll there once it mounts
        // (the post-switch pending-scroll effect handles it).
        pendingParagraphId.current = paragraphByErrorId.get(err.id) ?? null;
        pendingScrollText.current = errorSnippets.get(err.id) ?? null;
        setPdfView(false);
        return;
      }
      // Visual editor: highlight the offending range + scroll the paragraph.
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
    [codeView, pdfView, paragraphByErrorId, errorSnippets, computeErrorHighlightRange],
  );

  // Keep the error-highlight range in sync with the current selection.
  // Runs when the selection, the error list, or the editor mount state
  // (`editorInstance`) changes.
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

  // Derive citation order + editor citations from editor state. Recomputes
  // only when citations actually change (`rev.citations`) — add/remove/edit/
  // reorder, including citations born inside footnote bodies — never on a
  // plain keystroke. No debounce needed: structural changes are rare.
  const [citationOrder, setCitationOrder] = useState<string[]>([]);
  const [allEditorCitations, setAllEditorCitations] = useState<Array<{ citationId: string; command: string; keys: string[]; pos: number }>>([]);

  useEffect(() => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev.citations, editorInstance]);

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
  // Focus view confines the visible band of the editor ONLY when LOCKED:
  // a locked band hides top-level children outside [startBlockIndex,
  // endBlockIndex]. A mere focus SELECTION (active && !locked) is a
  // preference that hides nothing in the editor — it only draws the band
  // overlay in the Outline panel (CHIP A). The hide path keys off
  // `bandConfines` (active && locked); see src/lib/focus-view.ts.
  //
  // Mechanism: a ProseMirror node decoration. The `focusViewPlugin`
  // stamps `.focus-hidden` on each out-of-band top-level block — the
  // twin of section-folding's `.section-folded` — owned by a
  // `DecorationSet` in editor state, not an injected <style> tag. The
  // band is fed to the plugin by the effect just below; see that
  // effect's comment and src/lib/focus-view.ts for the full account.
  //
  // The two refs below serve later consumers, not the hide itself:
  // `focusStateRef` mirrors the live focus state for the breadcrumb
  // recompute (which skips hidden blocks whose DOM reports bogus
  // positions), and `prevLockedRef` arms the one-shot cursor coercion on
  // the false→true lock transition.
  const focusStateRef = useRef(focusMode.state);
  focusStateRef.current = focusMode.state;
  const prevLockedRef = useRef(false);

  // Feed the UUID focus band to the main editor's `focusViewPlugin`, which hides
  // out-of-band top-level blocks via a ProseMirror node decoration — replacing
  // the old injected <style> nth-child stylesheet + child-count tracker. The
  // decoration reaches React-NodeView blocks (figure/tex) and the mirror pane
  // (shared editor.state) for free, and is structurally unable to touch a card
  // editor. The band is the persisted UUID truth from useFocusMode; the plugin
  // re-resolves UUID→index on every structural change, so the hide never drifts.
  // Gated on the band's primitive values so the meta dispatches only on a real
  // band change, not on every memo recompute.
  const focusBand = focusMode.band;
  useEffect(() => {
    if (!editorInstance) return;
    try {
      editorInstance.view.dispatch(
        setFocusBandMeta(editorInstance.view.state.tr, focusBand),
      );
    } catch {
      /* meta-only dispatch; ignore if the view is tearing down */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorInstance, focusBand.active, focusBand.locked, focusBand.startUuid, focusBand.endUuid]);

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
      // Reference line: the SHARED section-active line (top 25% of the editor
      // viewport — see SECTION_ACTIVE_LINE_FRACTION). A heading/parTitle
      // becomes "active" once its top scrolls above this line. Conservative on
      // purpose — when a doc first opens the user is looking at the title and
      // we don't announce the first section until they scroll toward it. The
      // Outline's click-to-jump lands a heading exactly on this same line, so
      // the clicked section registers as current (OUT-#6).
      //
      // Bottom clamp: a final section near the end of the doc can't be scrolled
      // up to the 25% line (not enough content below it), so it could never
      // become "current". When we're parked at the bottom of a scrollable
      // viewport, extend the reference line to the viewport bottom so the
      // last visible section wins. Guarded on real scrollability so a short,
      // unscrollable doc keeps the conservative top-line behavior.
      const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
      const atBottom = maxScroll > 4 && maxScroll - scrollEl.scrollTop <= 2;
      const referenceY = atBottom
        ? scrollRect.bottom
        : scrollRect.top + scrollRect.height * SECTION_ACTIVE_LINE_FRACTION;

      const stack: { level: number; text: string; index: number; sectionNumber: string | null }[] = [];
      let lastCrossedStack: { level: number; text: string; index: number; sectionNumber: string | null }[] = [];
      // Track the last parTitle paragraph whose top has scrolled past
      // the reference line, within the current section scope. Reset
      // whenever a heading is crossed.
      let activeParTitleIdx: number | null = null;

      // Skip out-of-band blocks ONLY when focus is LOCKED — the focusViewPlugin
      // display:none's them only in that mode, so their DOM nodes report bogus
      // (collapsed) viewport positions and would drive the breadcrumb to a
      // hidden heading. A mere focus SELECTION (active && !locked) hides nothing
      // now (CHIP A), so out-of-band blocks report real coords and must NOT be
      // skipped — skipping them would drop them from the breadcrumb even though
      // they're fully visible. (CHIP 4b skipped on `active`; the hide is now
      // lock-gated, so this matches it again.)
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
    // Editor-update path is wrapped so the perf-flag gate (Tier 1 B)
    // can disable per-keystroke recompute without taking the scroll-
    // driven recomputes down with it. `off()` only removes a listener
    // when given the SAME reference we registered with `on()`, so the
    // wrapper is hoisted into a const used in both places.
    const onEditorUpdate = () => {
      if (isTier1BDisabled()) return;
      schedule();
    };
    compute();
    scrollEl.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    editorInstance.on("update", onEditorUpdate);
    return () => {
      cancelAnimationFrame(raf);
      scrollEl.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      editorInstance.off("update", onEditorUpdate);
    };
    // Focus band values are deps so the breadcrumb recomputes when focus
    // toggles/moves/locks — a meta-only tx (not docChanged) doesn't fire
    // `update`, so without these the breadcrumb would stay stale until the next
    // scroll. `locked` is a dep because skipHidden is now lock-gated (CHIP A),
    // so toggling the lock changes which blocks the breadcrumb considers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorInstance, focusMode.state.active, focusMode.state.locked, focusMode.state.startBlockIndex, focusMode.state.endBlockIndex]);

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
      // Same shared section-active line + bottom clamp as the canonical pane —
      // see note above.
      const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
      const atBottom = maxScroll > 4 && maxScroll - scrollEl.scrollTop <= 2;
      const referenceY = atBottom
        ? scrollRect.bottom
        : scrollRect.top + scrollRect.height * SECTION_ACTIVE_LINE_FRACTION;

      const stack: { level: number; text: string; index: number; sectionNumber: string | null }[] = [];
      let lastCrossedStack: { level: number; text: string; index: number; sectionNumber: string | null }[] = [];
      let activeParTitleIdx: number | null = null;

      // Mirror shares the main editor's state, so the focus band + decorations
      // apply here too — skip out-of-band (hidden) blocks ONLY when LOCKED, for
      // the same reason as the main pane: a mere focus selection hides nothing
      // now (CHIP A), so out-of-band blocks report real coords and must not be
      // skipped.
      const fs = focusStateRef.current;
      const skipHidden = fs.active && fs.locked;

      doc.forEach((node, offset, index) => {
        if (skipHidden && (index < fs.startBlockIndex || index > fs.endBlockIndex)) return;

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
    // Editor-update path wrapped so the perf-flag gate (Tier 1 B) can
    // suppress per-keystroke recompute on the mirror pane while leaving
    // scroll/resize-driven recomputes live. Same `off()`-needs-same-ref
    // reason as the main pane above.
    const onEditorUpdate = () => {
      if (isTier1BDisabled()) return;
      schedule();
    };
    compute();
    scrollEl.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // Re-compute when the doc changes (shared state with main editor).
    editorInstance?.on("update", onEditorUpdate);
    return () => {
      cancelAnimationFrame(raf);
      scrollEl.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      editorInstance?.off("update", onEditorUpdate);
    };
    // Focus band values are deps so the mirror breadcrumb recomputes on a
    // focus toggle/move/lock (meta-only tx — see the main pane's note). `locked`
    // is a dep because skipHidden is now lock-gated (CHIP A).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorSplit, mirrorViewGen, editorInstance, focusMode.state.active, focusMode.state.locked, focusMode.state.startBlockIndex, focusMode.state.endBlockIndex]);

  // Derive footnotes list from editor state (sorted by document position).
  // Recomputes on `editorInstance` change (initial mount + doc-switch remount)
  // and when footnotes change (`rev.footnotes` — add/remove/reorder, and
  // footnote-body edits which surface as a footnote-order change). Plain
  // typing bumps neither, so this no longer re-walks per keystroke.
  const footnotes = useMemo(() => {
    return editorRef.current?.getFootnotes() ?? [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev.footnotes, editorInstance]);

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
      const aPids = getLinkedTextObjectIds(a);
      const bPids = getLinkedTextObjectIds(b);
      const aPos = aPids.length > 0 ? paragraphOrder.get(aPids[0]) : undefined;
      const bPos = bPids.length > 0 ? paragraphOrder.get(bPids[0]) : undefined;
      if (aPos != null && bPos != null) return aPos - bPos;
      if (aPos != null) return -1;
      if (bPos != null) return 1;
      return 0;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archiveSnippets, rev.blocks, editorInstance]);
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
    // T3 (W3a): the label commit shares the live warning's predicate.
    isLabelTaken: checkLabelTaken,
  });

  // ── Focus mode helpers ─────────────────────────────────────────────
  const docForOutline = latestDoc;
  const outlineHeadings = useMemo(() => extractHeadings(docForOutline).headings, [docForOutline]);

  // T5 Pillar C-2 (OUT-F2-01 / OUT-F8-02): the focus engine's heading-index +
  // total-block inputs come from the LIVE DocStructureBus snapshot — re-mapped
  // every transaction by the observer — NOT the 300 ms-debounced `latestDoc`.
  // On a fresh doc `latestDoc` is null (Focus would focus the whole doc) and
  // within the debounce window of a structural edit it's a stale block range.
  // The bus `headings[]` carry live positions; map each `pos → top-level block
  // index` against the live doc and read `doc.childCount` for the total — the
  // exact `{ index, level }` shape `useFocusActions` consumes (which is all the
  // focus engine needs; the rich outline rows still come from `latestDoc`).
  //
  // Keystroke sanctity: gated on the structural counters (`rev.headings` /
  // `rev.blocks`) AND the reactive `editorInstance` (counters are silent on
  // load — AGENTS "Initial population"). A plain keystroke shifts positions but
  // adds/removes no heading or block, so neither counter bumps and this memo
  // doesn't recompute; the snapshot it reads is already per-tx-mapped, so the
  // *next* structural change reads correct indices.
  const focusStructure = useMemo(() => {
    void rev.headings;
    void rev.blocks;
    const doc = editorInstance?.state.doc ?? null;
    const structure = editorInstance ? getBus(editorInstance)?.structure : null;
    if (!doc || !structure) {
      // Editor not mounted yet — fall back to the latest snapshot so Focus has
      // *some* outline pre-mount (re-derives once `editorInstance` is set).
      return {
        headings: outlineHeadings.map((h) => ({ index: h.index, level: h.level })),
        totalBlocks: docForOutline?.content?.length ?? 0,
      };
    }
    const headings = structure.headings.map((h) => {
      let index = 0;
      try { index = doc.resolve(h.pos).index(0); } catch { /* stale */ }
      return { index, level: h.level };
    });
    return { headings, totalBlocks: doc.childCount };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorInstance, rev.headings, rev.blocks, outlineHeadings, docForOutline]);
  const outlineFocusHeadings = focusStructure.headings;
  const outlineTotalBlocks = focusStructure.totalBlocks;

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
  } = useFocusActions({ focusMode, outlineHeadings: outlineFocusHeadings, outlineTotalBlocks });

  // Focus word count: sum per-block counts within the focused range
  const focusWordCount = useMemo(() => {
    if (!focusMode.state.active) return null;
    const perBlock = buildPerBlockCounts(docForOutline);
    const words = sumIncludedWords(perBlock, focusMode.state.startBlockIndex, focusMode.state.endBlockIndex + 1, focusWcConfig.include);
    return { words };
  }, [focusMode.state, docForOutline, focusWcConfig.include]);

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
  // happens for both — for selection-driven sync, both kinds resolve to
  // "cutter-comment" since the only currently auto-anchored kind is the
  // comment.
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
      // Prefix-or-exact (the shared omni matcher): a fully-qualified `@N` key
      // lands on its own row; a bare key still finds a multi-anchor card's
      // first row (e.g. "float:card:note:id" → "float:card:note:id@0").
      const entry = findOmniEntry(key, "data-omni-entry");
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


  // R21: useFootnoteActions was mounted here ONLY to feed the footnote
  // pristine-discard effect (handleDeleteFootnote). That effect drove the
  // render-dead shell pristine manager and is gone; the footnote discard now
  // lives entirely in EditorPane's single manager. The other footnote-action
  // handlers (edit/title/add) were never consumed from this shell mount.

  const { handleCitationCreated } = useCitationActions({
    editorRef,
    getCitationDisplayText,
    addCitation,
  });


  const { handleDeleteOrphan, handleEditOrphan, handleEditOrphanTitle } = useOrphanActions({
    setOrphanedFootnotes,
  });

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
    onToggleParTitles: toggleParTitles,
    onToggleLatexComments: toggleLatexComments,
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
    toggleParTitles,
    toggleLatexComments,
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

  // Listen for marker clicks from the editor (in-text anchors, margin
  // markers, inline atoms, error markers — see marker-clicks.ts).
  useMarkerClickBridges({
    prefsRef,
    setActiveLeft,
    setActiveRight,
    tryScrollOmniEntry,
    getOmniEnabled,
    setSelectedFootnoteId,
    setSelectedCitationId,
    setSelectedErrorId,
    setActiveRefLabel,
    setActiveRefRect,
    setActiveRefCommand,
    setAtomCreateRequest,
    setActiveMath,
    setActiveFigure,
    alignOmniCardWithClick,
  });

  useFootnoteSyncBridges({ suppressOrphanRef, setOrphanedFootnotes, deleteSnippet });

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

  // ── Citation create-popover commit ──
  // Materialize a citation from the staged citekeys (≥1), at the position the
  // popover captured at trigger time. Insert the real `\cite{…}` atom no-scroll
  // (insertInlineAtom's `at` lands it at the captured pos even if the live
  // selection drifted while the popover was open), then register the gutter card
  // + soft-route via the proven citation cursor path (`runAction` carrying the
  // payload — the COMMIT half of `citationRun`). One atom + one card, no blank
  // pristine flash, all subsequent edits in the gutter at the standard position.
  const commitCitationCreate = useCallback(
    (pos: number, keys: string[]) => {
      const handle = editorRef.current;
      const ed = handle?.getEditor();
      if (!handle || !ed || keys.length === 0) return;
      const command = serializeCiteCommand(
        {
          type: "cite",
          starred: false,
          capitalized: false,
          entries: keys.map((key) => ({ key })),
        },
        "natbib",
      );
      const citationId = generateShortId(handle.getCitationIds());
      insertInlineAtom({
        editor: ed,
        type: "citation",
        attrs: { citationId, command, displayText: "" },
        at: pos,
      });
      getEditorActionsHandle()?.runAction("citation", {
        surface: "slash",
        payload: { citationId, command },
      });
    },
    [editorRef],
  );

  // ── Math popover save handler ──
  // EX-F4-02: route the math edit back to the editor that OWNS the clicked node
  // (carried through `virgil-math-click` → `activeMath.editor`), NOT blindly to
  // MAIN. On the main surface `editor` IS the main editor (behaviour
  // unchanged). On an embedded card/float surface (example-card body, example/
  // paragraph/linked-range floats) `editor` is the embed: `pos` is its
  // pos-space, the `setNodeMarkup` lands in the embed, and the embed's own
  // write-back (`onUpdate` → `writeBackToMain` / `useFloatMainSync`) propagates
  // the change to the main doc. Targeting MAIN with a float-space `pos` would
  // mis-target / corrupt the wrong node — the very corruption the old
  // `surface === "main"` gate prevented (by making embedded math inert).
  const handleMathSave = useCallback((editor: Editor, pos: number, newLatex: string) => {
    if (!editor || editor.isDestroyed) return;
    // The popover outlives the click, so by save time the owning editor may have
    // re-seeded (an embedded card/float re-syncs from MAIN) and shifted `pos`
    // past the doc end — `nodeAt` THROWS on an out-of-range pos. Guard the
    // bounds so a stale pos is a safe no-op, never a crash.
    if (pos < 0 || pos >= editor.state.doc.content.size) return;
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

  // ── Figure tex-mode popover save handler ──
  // For figureBlock: newText is the new `\begin{figure}…\end{figure}` body.
  // For graphicsBlock: newText is the new `\includegraphics[...]{path}`.
  // We re-extract structured attrs from the new text and dispatch a
  // setNodeMarkup transaction; the NodeView's update hook picks up
  // the change and re-rasterizes if `source` changed.
  //
  // EX-F4-02 (figure twin of the math fix): route the edit back to the editor
  // that OWNS the clicked node (carried through `virgil-figure-click` →
  // `activeFigure.editor`), NOT blindly to MAIN. On the main surface `editor`
  // IS the main editor (behaviour unchanged). On the figure's own float
  // surface `editor` is the embed: `pos` is its pos-space, the `setNodeMarkup`
  // (and the figureCaption re-tokenize) land in the embed, and the embed's own
  // write-back (figure-body's `onUpdate` → `writeBackToMain`) round-trips the
  // change to the main doc. Targeting MAIN with a float-space `pos` would
  // mis-target / corrupt the wrong node — the very corruption the dropped
  // `figureFloat` click-suppression prevented (by making float figures inert).
  const handleFigureSave = useCallback((editor: Editor, pos: number, newText: string) => {
    if (!editor || editor.isDestroyed) return;
    // The popover outlives the click, so by save time the owning editor may
    // have re-seeded (the figure float re-syncs from MAIN) and shifted `pos`
    // past the doc end — `nodeAt` THROWS on an out-of-range pos. Guard the
    // bounds so a stale pos is a safe no-op, never a crash. Mirrors
    // handleMathSave.
    if (pos < 0 || pos >= editor.state.doc.content.size) return;
    const node = editor.state.doc.nodeAt(pos);
    if (!node) return;
    if (node.type.name === "figureBlock") {
      const attrs = extractFigureAttrs(newText);
      // Rebuild the figureCaption child node from the new caption text.
      // The popover is one of two surfaces that can edit captions; re-
      // tokenize the body so inline marks/citations end up as structured
      // nodes (\cite{}, $math$, \textbf{}, etc.).
      const captionInline = parseInlineLatexForCaption(attrs.caption);
      let captionNode;
      try {
        captionNode = editor.state.schema.nodeFromJSON({
          type: "figureCaption",
          content: captionInline,
        });
      } catch {
        // Fall back to plain text so the user's caption isn't lost on a
        // malformed inline parse.
        captionNode = editor.state.schema.nodeFromJSON({
          type: "figureCaption",
          content: attrs.caption ? [{ type: "text", text: attrs.caption }] : [],
        });
      }
      const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        extras: attrs.extras,
        source: attrs.source,
        widthPercent: attrs.widthPercent,
        sources: attrs.sources,
        label: attrs.label,
      });
      const refreshed = tr.doc.nodeAt(pos);
      if (refreshed) {
        const inside = pos + 1;
        if (refreshed.firstChild?.type.name === "figureCaption") {
          const captionEnd = inside + refreshed.firstChild.nodeSize;
          tr.replaceWith(inside, captionEnd, captionNode);
        } else {
          tr.insert(inside, captionNode);
        }
      }
      editor.view.dispatch(tr);
    } else if (node.type.name === "graphicsBlock") {
      const attrs = extractGraphicsAttrs(newText.trim());
      if (attrs) {
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            command: attrs.command,
            source: attrs.source,
            widthPercent: attrs.widthPercent,
          }),
        );
      } else {
        // Couldn't parse — keep verbatim text on `command` so the user
        // can fix the typo without losing their edit.
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            command: newText.trim(),
            source: "",
            widthPercent: null,
          }),
        );
      }
    }
  }, []);

  // The `\ref` CREATE popover folds onto the SHARED inline-atom create
  // controller — slash `\ref` → `refRun` → `ctx.openAtomCreate("ref")`
  // (EditorPane) and the lightning 'Cross-ref' cell both dispatch
  // `virgil-atom-create-popover` (kind "ref"), consumed in `marker-clicks.ts`
  // into `atomCreateRequest`. The EDIT-existing-`\ref` path stays separate
  // (`virgil-label-ref-click` → `activeRef*`). The `virgil-ref-create` /
  // `virgil-ref-create-popover` events + `useCommandInputBridges` are retired.

  // Handle drag-and-drop of an archive snippet CARD into the editor to
  // RESTORE its text: ProseMirror inserts the text from text/plain (an
  // inline-insertion drag, NOT a paragraph anchor), and we then delete the
  // snippet from archive. (Re-anchoring an orphaned snippet by dragging its
  // margin pin now flows through the unified drop-mode controller — the old
  // native MIME_ARCHIVE_ANCHOR drag is gone.)
  useEffect(() => {
    const editor = editorRef.current?.getEditor();
    if (!editor) return;
    const editorDom = editor.view.dom;

    const handleDrop = (e: DragEvent) => {
      const archiveId = e.dataTransfer?.getData(MIME_ARCHIVE);
      if (archiveId) {
        // Let ProseMirror handle the text insertion; just clean up archive
        setTimeout(() => {
          deleteSnippet(archiveId);
        }, 0);
      }
    };

    editorDom.addEventListener("drop", handleDrop);
    return () => {
      editorDom.removeEventListener("drop", handleDrop);
    };
  }, [editorInstance, deleteSnippet]);

  // Todo drop actions — create a new todo, link its paragraph, seed its
  // text from the dropped selection where applicable. Used both by the
  // open TodoPanel (via onDropSelection/onDropParagraph props) and by
  const pendingRevisionAnchorIdRef = useRef<string | null>(null);

  const { handleAddComment } = useCommentActions({
    editorRef,
    pendingRevisionAnchorIdRef,
    prefs,
    setActiveLeft,
    setActiveRight,
    setPendingCommentText,
  });

  // R21: the per-kind pristine discard callbacks are registered ONLY against
  // EditorPane's single live manager (see EditorPane.tsx). The duplicate set
  // that used to live here drove the render-dead shell manager and is gone.

  // The editor-only mutation handlers — the single named delta between the
  // main app and the Reader. Memoized so the builder's `useMemo` below stays
  // referentially stable across renders.
  const editorMutationHandlers = useMemo<EditorMutationHandlers>(() => ({
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
    setIsResizingPanels,
    syncPanelPrefsToRendered,
    setZenLeftMargin,
    setZenRightMargin,
    setCardArchiveView,
    setSuppressArchiveAtomWarning,
  }), [
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
    focusMode.deactivate,
    focusMode.toggleLock,
    handleFocusMoveTo,
    handleFocusExpandTo,
    handleFocusSnapBoundary,
    focusFloating,
    setIsResizingPanels,
    syncPanelPrefsToRendered,
    setZenLeftMargin,
    setZenRightMargin,
    setCardArchiveView,
    setSuppressArchiveAtomWarning,
  ]);

  // The EditorLayout-computed view derivations (section paths, focus state,
  // zen geometry, omni read-helpers, category sides, float z-index painter).
  const editorPaneViewDerivations = useMemo<EditorPaneViewDerivations>(() => ({
    isResizingPanels,
    focusState: focusMode.state,
    activeSectionPath: currentSectionPath,
    activeParTitleIndex: currentParTitleIndex,
    mirrorSectionPath,
    mirrorParTitleIndex,
    zenMode: zenModeOn,
    zenLeftMargin,
    zenRightMargin,
    getOmniEnabled,
    getOmniHideAll,
    setOmniSideToDefault,
    categorySides,
    remapCardPopKey,
    cardFloatZIndex,
  }), [
    isResizingPanels,
    focusMode.state,
    currentSectionPath,
    currentParTitleIndex,
    mirrorSectionPath,
    mirrorParTitleIndex,
    zenModeOn,
    zenLeftMargin,
    zenRightMargin,
    getOmniEnabled,
    getOmniHideAll,
    setOmniSideToDefault,
    categorySides,
    remapCardPopKey,
    cardFloatZIndex,
  ]);

  // Assemble the bundle through the SAME builder the Reader uses, so the two
  // surfaces share one view-state engine and the Editor/Reader delta is the
  // single named `editorMutationHandlers` set above.
  const editorPaneViewPrefs: EditorPaneViewPrefs = useMemo(
    () =>
      buildEditorPaneViewPrefs(
        viewPrefsResult,
        editorMutationHandlers,
        editorPaneViewDerivations,
      ),
    [viewPrefsResult, editorMutationHandlers, editorPaneViewDerivations],
  );

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
    // NOTE: do NOT setEditorInstance(null). In the new split-pane
    // layout, EditorPane (and the live TipTap instance) stay mounted
    // while CodeEditor opens in the right pane. The code-pane bridge
    // requires `editorInstance` to be a live TipTap editor so it can
    // sync edits both directions.
    setPdfView(false);
    setCodeView(true);
  }, [latestDoc]);

  const switchToVisualView = useCallback(() => {
    // In the split-pane layout there's no longer a separate "code
    // editor handle to scrape text from" — TipTap is canonical and
    // already reflects the latest content via the bridge. We just
    // close the code pane.
    codeEditorHandleRef.current = null;
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
      selectedReportCardId, setSelectedReportCardId,
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
      selectedReportCardId, setSelectedReportCardId,
      selectedCommentId, setSelectedCommentId,
      selectedBibKey, setSelectedBibKey,
      selectedExampleId, setSelectedExampleId,
    ],
  );

  // ── Soft presence: broadcast our card selections to the partner.
  // Scope tokens are REGISTRY-DERIVED via `collabClaimScope` (R28/D-2) so the
  // broadcast always matches what the card chrome reads back through
  // `getCardSelections(scope, id)`. This fixed two bugs the hand-kept literal
  // table shipped: the revision row broadcast "comment" (a token no reader
  // ever used — the cards read "revision"), and the report selection was
  // never broadcast at all.
  useEffect(() => {
    if (!collab.enabled) return;
    const cards: { panelKind: PanelThemeKey; cardId: string }[] = [];
    if (selectedNoteId) cards.push({ panelKind: collabClaimScope("note"), cardId: selectedNoteId });
    if (selectedFootnoteId) cards.push({ panelKind: collabClaimScope("footnote"), cardId: selectedFootnoteId });
    if (selectedCitationId) cards.push({ panelKind: collabClaimScope("citation"), cardId: selectedCitationId });
    if (selectedTodoId) cards.push({ panelKind: collabClaimScope("todo"), cardId: selectedTodoId });
    if (selectedArchiveId) cards.push({ panelKind: collabClaimScope("archive"), cardId: selectedArchiveId });
    if (selectedCutterCardId) cards.push({ panelKind: collabClaimScope("cutter-comment"), cardId: selectedCutterCardId });
    if (selectedReportCardId) cards.push({ panelKind: collabClaimScope("report"), cardId: selectedReportCardId });
    if (selectedCommentId) cards.push({ panelKind: collabClaimScope("revision-comment"), cardId: selectedCommentId });
    if (selectedBibKey) cards.push({ panelKind: collabClaimScope("bib"), cardId: selectedBibKey });
    if (selectedExampleId) cards.push({ panelKind: collabClaimScope("example"), cardId: selectedExampleId });
    collab.updateSelection(cards);
  }, [
    collab.enabled,
    collab.updateSelection,
    selectedNoteId, selectedFootnoteId, selectedCitationId, selectedTodoId,
    selectedArchiveId, selectedCutterCardId, selectedReportCardId,
    selectedCommentId, selectedBibKey, selectedExampleId,
  ]);

  const { handleStripClick, handleMove } = useStripHandlers({
    prefs,
    openPanelDocked,
    closePopout,
    movePanel,
    selections: selectionsForStrip,
  });

  // (Search-highlight clear-on-close moved to EditorPane — it OWNS the search
  // highlight now; clearing it from here operated on a dead duplicate.)

  // --- Marginalia: build the marker list and side map ---
  // (Hooks must run on every render — placed before any early returns.)
  // OmniView aggregates several panels on one side. Omni is now ALWAYS the
  // backdrop behind each side's band stack, so its aggregated children
  // (notes/archive/revisions/cutter/todo) are visible on a side whenever
  // that side isn't collapsed. As before, the omni backdrop counts as a
  // RIGHT-side host only (left omni is deliberately not a marginalia
  // fallback — `void omniLeft`); a kind docked as its own band overrides.
  const marginaliaPanelSides = useMemo(() => {
    const omniLeft = !prefs.collapsedLeft;
    const omniRight = !prefs.collapsedRight;
    void omniLeft;
    // A kind docked as its own band wins its side; otherwise it falls to the
    // right omni backdrop. Notes, archive, revisions, cutter, todo are
    // right-side children of OmniView.
    const notesSide: "left" | "right" | null =
      dockedSideOf(prefs, "notes") === "left"
        ? "left"
        : dockedSideOf(prefs, "notes") === "right" || omniRight
          ? "right"
          : null;
    const archiveSide: "left" | "right" | null =
      dockedSideOf(prefs, "archive") === "left"
        ? "left"
        : dockedSideOf(prefs, "archive") === "right" || omniRight
          ? "right"
          : null;
    const revisionsSide: "left" | "right" | null =
      dockedSideOf(prefs, "revisions") === "left"
        ? "left"
        : dockedSideOf(prefs, "revisions") === "right" || omniRight
          ? "right"
          : null;
    const cutterSide: "left" | "right" | null =
      dockedSideOf(prefs, "cutter") === "left"
        ? "left"
        : dockedSideOf(prefs, "cutter") === "right" || omniRight
          ? "right"
          : null;
    const todoSide: "left" | "right" | null =
      dockedSideOf(prefs, "todo") === "left"
        ? "left"
        : dockedSideOf(prefs, "todo") === "right" || omniRight
          ? "right"
          : null;
    return {
      notes: notesSide,
      archive: archiveSide,
      revisions: revisionsSide,
      cutter: cutterSide,
      todo: todoSide,
    };
  }, [prefs]);

  // Card-source derivations (marginalia markers, footnotes, citations, archive
  // order) now key off `rev.*` from `useStructuralRevisions` above — they
  // recompute only on structural change, not per keystroke. The only thing
  // still riding `editor.on('update')` here is O(1) pdfStale tracking: stamp a
  // timestamp ref each edit and flip `pdfStale` false→true at most once per
  // compile cycle. Keystroke-sanctity permitted subscriber — see AGENTS.md.
  useEffect(() => {
    if (!editorInstance) return;
    const onUpdate = () => {
      lastEditTimeRef.current = Date.now();
      if (lastCompileTimeRef.current != null && !pdfStaleRef.current) {
        setPdfStale(true);
      }
    };
    editorInstance.on("update", onUpdate);
    return () => {
      editorInstance.off("update", onUpdate);
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

  // Boot-load the per-user theming prefs (panel colors / typography /
  // pref links) and keep this tree subscribed to panel-color changes.
  // See the hook's docstring at the top of this file.
  usePanelColorSubscription();

  // RC-B: the once-per-load Mode-B `linkedAnchor` re-apply that used to live
  // here (`applyLinkedAnchors` over notes/todos/revisions/cutter/highlights)
  // was a SECOND load-time recovery writer racing the EditorPane reconcile
  // pass (RC-A). It has moved into that pass (`reapplyModeBAnchors` in
  // EditorPane.tsx), so there is now exactly ONE load-time owner. The
  // underlying `EditorHandle.applyLinkedAnchors` / `reanchorByText` command is
  // unchanged — the moved pass calls it. Retiring EditorLayout's parity HOOK
  // mounts (the remaining non-recovery reads of `notes` / `todoItems` / etc.)
  // is a separate later chip (E5); RC-B retires only the recovery WRITER.

  // Phase F: doc-aware legacy popout-key sweep. The boot-time
  // `useViewPrefs.loadPrefs` migrator handles the kinds that don't
  // need a doc walk (paragraph, heading, texBlock); `list:<uuid>` and
  // the in-editor `example:<uuid>` need to know the actual node kind
  // to disambiguate, so they're swept here once per doc-load.
  const popoutKeysSweptDocRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editorInstance || !docIdForHooks) return;
    if (popoutKeysSweptDocRef.current === docIdForHooks) return;
    popoutKeysSweptDocRef.current = docIdForHooks;
    migratePoppedOutCards((key) => migrateDocAwarePopoutKey(editorInstance, key));
  }, [editorInstance, docIdForHooks, migratePoppedOutCards]);


  // Loading
  if (filesLoading) {
    return <LoadingScreen className="h-screen" />;
  }

  // Search range highlight takes priority — skip text-based highlight when active
  const highlightText = searchHighlightRange || errorHighlightRange
    ? null
    : !visibleHighlightKinds.has("comment")
      ? null
      : pendingCommentText
        ? pendingCommentText
        : commentHighlight
          ? commentHighlight
          : isPanelDocked(prefs, "revisions") &&
              currentSuggestion &&
              currentSuggestion.status === "pending"
            ? currentSuggestion.original_text
            : null;
  // Range-based highlights — search wins over error (search is an explicit
  // user action, error highlight is derived from selection). `searchHighlightRange`
  // is now the live value bubbled up from EditorPane (the owner); `errorHighlightRange`
  // is still EditorLayout's own (compile-derived) and bubbles DOWN via this prop.
  // EditorPane re-applies the same `search ?? error` preference on its side, so
  // passing the combined range here is idempotent — EditorPane's local search
  // range and this bubbled copy are the same value.
  const effectiveHighlightRange = searchHighlightRange ?? errorHighlightRange;
  // OmniView aggregates several child panels on one side. Omni is now the
  // perpetual backdrop behind each side's band stack, so the side-of-panel
  // lookups must include its children. A kind docked as its own band wins
  // its side; otherwise the right omni backdrop hosts it (left omni is not a
  // marginalia fallback, matching the prior behavior).
  //   Left omni children:  footnotes, citations
  //   Right omni children: notes, revisions, cutter, archive
  const omniRightActive = !prefs.collapsedRight;
  const notesPanelSide: "left" | "right" | null =
    dockedSideOf(prefs, "notes") === "left" ? "left" : dockedSideOf(prefs, "notes") === "right" || omniRightActive ? "right" : null;
  const todoPanelSide: "left" | "right" | null =
    dockedSideOf(prefs, "todo") === "left" ? "left" : dockedSideOf(prefs, "todo") === "right" || omniRightActive ? "right" : null;
  const cutterPanelSide: "left" | "right" | null =
    dockedSideOf(prefs, "cutter") === "left" ? "left" : dockedSideOf(prefs, "cutter") === "right" || omniRightActive ? "right" : null;
  const revisionsPanelSide: "left" | "right" | null =
    dockedSideOf(prefs, "revisions") === "left" ? "left" : dockedSideOf(prefs, "revisions") === "right" || omniRightActive ? "right" : null;
  const bibliographyPanelSide: "left" | "right" | null =
    dockedSideOf(prefs, "bibliography");

  // Render helpers (renderPanelWithChrome / renderPanelInner / renderPanelColumn)
  // moved into EditorPane along with the panel mount itself. The icon
  // strip (and its `leftStripItems` / `rightStripItems` derivation) also
  // moved into EditorPane's `IconStrip` — it now derives its items
  // directly from `visiblePanels` via `placementSideByKind`.

  if (!fsaSupported) {
    return <UnsupportedBrowserNotice />;
  }

  // Paragraph / heading / example popout handlers and their is-popped
  // predicates now live inside EditorPane (which owns the margin buttons
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
      state={{ prefs }}
      actions={{ togglePanel, movePanel }}
    >
    <EditorRefProvider value={{ editorInstance, editorRef, setOverrideEditor }}>
    <AiRequestsProvider value={{ aiRequests, addAiRequest, updateAiRequestText, deleteAiRequest }}>
    <CitationDisplayProvider value={{ getCitationDisplayText, onCitationCreated: handleCitationCreated }}>
    {/* SelectionsProvider derives the 9 anchored slots from the cardStore;
        we only thread the bib slot in through `value` because bib isn't
        an anchored kind. The other 9 props on the legacy value shape are
        ignored by the provider. */}
    <SelectionsProvider value={{ selectedBibKey, setSelectedBibKey }}>
    <RecentlyAddedProvider value={recentlyAdded}>
    <RecentlyAddedAutoClear />
    <CollabProvider value={collab}>
    {/* DiskWatcherProviderGate wraps the WHOLE layout (topbar + panes) so both
        the topbar status-cluster badge slot and EditorPane's useDocument call
        site are descendants of the per-doc external-change watcher. It self-
        gates on currentDocId (no provider when no doc is open). */}
    <DiskWatcherProviderGate docId={currentDocId}>
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
                          data-hint="Close tab"
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
                          data-hint="Close tab"
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
                        data-hint="Close tab"
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
              data-hint="Virgil update"
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
          {/* Skill-bundle sync surface — a failed/stale skill sync must
              never again silently strand a paper on old skills. Sits
              before the topbarRightCollapsed gate (like the Virgil-update
              banner) so a sync failure can't be hidden by a collapsed
              right toolbar. Pure UI: no per-keystroke work. */}
          <SkillSyncControls
            hasDoc={!!currentDoc}
            error={skillSyncError}
            notice={skillSyncNotice}
            onResync={() => void resyncSkills()}
            onDismissError={dismissSkillSyncError}
            onDismissNotice={dismissSkillSyncNotice}
          />
          {!prefs.topbarRightCollapsed && (<>
          {/* ── Status-indicator group (left of divider) ───────────────
              Passive indicators for system-wide modes that are
              activated elsewhere (Focus from card actions, Helper from
              the "?" menu, Collab from the icon button on the right).
              Each entry doubles as the off-toggle for its mode. Stays
              empty when nothing's active. Suppressed in zen mode. */}
          {!zenModeOn && (
            <div className="flex items-center">
              {/* Reporter: a provider-descendant that lifts the badge-active
                  boolean up into EditorLayout so the divider gate can OR it in.
                  Renders nothing itself. */}
              <ExternalChangeActiveReporter onActiveChange={setExternalChangeActive} />
              {focusMode.state.active && (
                <button
                  onClick={focusMode.deactivate}
                  className="topbarbtn"
                  aria-pressed="true"
                  data-hint="Focus view"
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
                  data-hint="Exit helper mode"
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
              {/* External-change badge — self-gates (renders null when
                  severity == null), so it's mounted unconditionally inside the
                  cluster. Sits left of the divider, beside the collab pill. */}
              <ExternalChangeBadge />
            </div>
          )}
          {/* Divider — only shown when there's at least one status
              marker on the left, so the line reads as a real
              boundary between markers and standard buttons. With no
              markers, the standard cluster simply starts at the
              edge. Uses the same stronger edge color as the tab
              separators. Suppressed in zen mode regardless. */}
          {!zenModeOn && (focusMode.state.active || helperMode.on || collab.enabled || externalChangeActive) && (
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
            aria-pressed={zenModeOn}
            data-hint="Zen mode"
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
            aria-pressed={preferencesOpen}
            data-hint="Preferences"
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
              ref={helperBtnRef}
              onClick={(e) => { e.stopPropagation(); setHelperMenuOpen((v) => !v); }}
              className="topbarbtn"
              data-hint="Help"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.5 9a2.75 2.75 0 0 1 5.25 1.1c0 1.6-2.25 2.4-2.75 3.4" />
                <path d="M12 17h.01" />
              </svg>
            </button>
            {helperMenuOpen && typeof document !== "undefined" && createPortal(
              <div
                ref={helperPositionRef}
                className="bg-surface border border-edge-subtle rounded shadow-md text-xs text-ink-body whitespace-nowrap text-left min-w-[160px]"
                style={{ ...helperPositionStyle, zIndex: OPEN_CHROME_MENU_Z }}
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
              </div>,
              document.body,
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
            aria-pressed={printOpen}
            data-hint="Print"
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
            data-hint="AI requests"
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
            aria-pressed={manageStylesOpen}
            data-hint="Document style"
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
            aria-pressed={codeView}
            data-hint="Code"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
              <line x1="14.5" y1="4" x2="9.5" y2="20" />
            </svg>
            Code
          </button>
          {/* Compile — runs SwiftLaTeX's pdfTeX over the paper folder and
              saves the resulting PDF to the paper folder. Disabled while a
              compile is in flight; spinner replaces the play-triangle. */}
          <button
            onClick={vbar.compilePdf}
            disabled={!currentDocId || vbar.isCompiling}
            className="topbarbtn"
            data-hint="Compile"
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
            aria-pressed={pdfView}
            data-hint={pdfView ? "Back to editor" : "View PDF"}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            PDF
            {vbar.pdfStale && pdfView && (
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 ml-1" data-hint="PDF is out of date" aria-label="PDF is out of date" />
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
            aria-pressed={prefs.topbarRightCollapsed}
            aria-label={prefs.topbarRightCollapsed ? "Expand toolbar" : "Collapse toolbar"}
            data-hint="Collapse toolbar"
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
      ) : currentDoc && docPermState !== "granted" ? null : pdfView && currentDocId ? (
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
              assertActive check. Toggling code-view does NOT remount
              this boundary — SplitWithCode handles open/close inline
              so TipTap stays alive across the toggle (and the code
              bridge keeps the two views in sync). */}
          <DocPipeline key={currentDocId} docId={currentDocId}>
            <SplitWithCode
              open={codeView}
              ratio={prefs.codePaneRatio}
              onRatioChange={setCodePaneRatio}
              onMoveCodeToText={() =>
                codeEditorHandleRef.current?.moveCodeToTextCursor()
              }
              onMoveTextToCode={() =>
                codeEditorHandleRef.current?.moveTextToCodeCursor()
              }
              left={
                // EditorChromeProvider here (above EditorPane) so EditorPane's
                // OWN body hooks (useNotes/useTodos/... and the persistent-state
                // write-guard) resolve FULL_CHROME instead of the createContext
                // default. The default also happens to be FULL_CHROME, so the
                // main app's behavior is unchanged either way — but making the
                // provider an ancestor keeps it parallel to the Reader mount and
                // guarantees body hooks and EditorPane's `chrome` prop read ONE
                // source. EditorPane's inner provider (adding `menuBar`) still
                // wraps its children. Value MUST match the `chrome` prop below.
                <EditorChromeProvider value={FULL_CHROME}>
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
                  latexErrors={allLatexErrors}
                  paragraphByErrorId={paragraphByErrorId}
                  errorSnippets={errorSnippets}
                  selectedErrorId={selectedErrorId}
                  setSelectedErrorId={setSelectedErrorId}
                  dismissedErrorIds={dismissedErrorIds}
                  dismissError={dismissError}
                  expandedErrorIds={expandedErrorIds}
                  expandError={expandError}
                  toggleErrorExpanded={toggleErrorExpanded}
                  onJumpToError={jumpToError}
                />
                </EditorChromeProvider>
              }
              right={
                codeView && editorInstance ? (
                  <div
                    className="flex flex-1 min-h-0 overflow-hidden"
                    style={{
                      background: "var(--pod-editor)",
                      borderRadius: "var(--pod-radius)",
                      border: "var(--pod-border)",
                      boxShadow: "var(--pod-shadow)",
                      marginTop: 4,
                      marginBottom: zenModeOn ? 4 : "var(--pod-gap)",
                      marginRight: 4,
                    }}
                  >
                    <CodeEditor
                      docId={currentDocId!}
                      editor={editorInstance}
                      initialLine={codeViewLine}
                      initialParagraphId={codeViewParagraphId}
                      onReady={(handle) => {
                        codeEditorHandleRef.current = handle;
                      }}
                      onTextChange={handleCodeEditorTextChange}
                      compileLog={paneState?.compileLog ?? null}
                      compileStatus={paneState?.compileStatus ?? null}
                      isCompiling={paneState?.isCompiling ?? false}
                    />
                    {errorsSidebarOpen ? (
                      <div className="w-[260px] shrink-0 border-l border-edge-subtle bg-surface flex flex-col h-full relative">
                        <button
                          type="button"
                          onClick={() => setErrorsSidebarOpen(false)}
                          className="absolute top-2 right-2 z-10 w-5 h-5 flex items-center justify-center rounded text-ink-muted hover:text-ink-body hover-on-light text-sm leading-none"
                          data-hint="Hide errors panel"
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
                          expandedIds={expandedErrorIds}
                          onExpand={expandError}
                          onToggleExpanded={toggleErrorExpanded}
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setErrorsSidebarOpen(true)}
                        className="w-7 shrink-0 border-l border-edge-subtle bg-surface flex items-start justify-center pt-3 hover-on-light relative text-ink-muted hover:text-ink-body"
                        data-hint={`Show errors (${allLatexErrors.length})`}
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
                ) : null
              }
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
      {atomCreateRequest?.kind === "citation" && (
        <CitationCreatePopover
          anchorRect={atomCreateRequest.rect}
          paperBibEntries={bibEntries}
          onAddBibEntry={citationsHook.addBibEntry}
          onCommit={(keys) => commitCitationCreate(atomCreateRequest.pos, keys)}
          onClose={() => setAtomCreateRequest(null)}
        />
      )}
      {atomCreateRequest?.kind === "ref" && (
        // `\ref` CREATE mode (the shared controller's ref body). The label-edit
        // popover, in create mode (`label=""`), lists every `\label{…}` site and
        // inserts the chosen `labelRef` atom — no-scroll, at the captured pos —
        // on pick. (The EDIT-existing-`\ref` render below stays on its own
        // `activeRef*` path, triggered by clicking a live `\ref`.)
        <LabelRefPopover
          label=""
          anchorRect={atomCreateRequest.rect}
          labels={gatherLabels()}
          refCommand={atomCreateRequest.refCommand ?? "ref"}
          onChangeLabel={handleRefChangeLabel}
          onChangeRefCommand={handleRefChangeCommand}
          onJumpToLabel={handleRefJump}
          onInsertRef={(label, cmd) =>
            handleInsertRef(label, cmd, atomCreateRequest.pos)
          }
          onClose={() => setAtomCreateRequest(null)}
        />
      )}
      {activeMath && (
        <MathPopover
          kind={activeMath.kind}
          latex={activeMath.latex}
          anchorRect={activeMath.rect}
          onSave={(newLatex) => handleMathSave(activeMath.editor, activeMath.pos, newLatex)}
          onClose={() => setActiveMath(null)}
        />
      )}
      {activeFigure && (
        <FigurePopover
          kind={activeFigure.kind}
          raw={activeFigure.raw}
          anchorRect={activeFigure.rect}
          onSave={(newText) => handleFigureSave(activeFigure.editor, activeFigure.pos, newText)}
          onClose={() => setActiveFigure(null)}
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
    </DiskWatcherProviderGate>
    </CollabProvider>
    </RecentlyAddedProvider>
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

/**
 * ExternalChangeActiveReporter — a headless reporter that lifts the
 * external-change badge's "is anything showing?" boolean up into EditorLayout.
 *
 * EditorLayout's own body sits ABOVE the DiskWatcherProvider in the React tree,
 * so it can't call `useExternalChanges()` to gate the topbar divider. This tiny
 * component IS a provider descendant (it renders inside the status cluster), so
 * it can read the live state via `useExternalChangesOrNull` (nullable — works
 * with no doc/provider) and push `state.severity != null` up through
 * `onActiveChange`. Renders nothing.
 *
 * KEYSTROKE SANCTITY: it reads `useSyncExternalStore` over the watcher's stable
 * snapshot — NOT any editor subscription — and fires `onActiveChange` only when
 * the boolean flips. Zero per-keystroke work.
 */
function ExternalChangeActiveReporter({
  onActiveChange,
}: {
  onActiveChange: (active: boolean) => void;
}): null {
  const { state } = useExternalChangesOrNull();
  const active = state.severity != null;
  useEffect(() => {
    onActiveChange(active);
  }, [active, onActiveChange]);
  // Reset the lifted boolean when this reporter unmounts (e.g. the topbar-right
  // cluster collapses), so a stale `true` can't outlive the live state.
  useEffect(() => () => onActiveChange(false), [onActiveChange]);
  return null;
}
