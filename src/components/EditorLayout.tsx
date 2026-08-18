"use client";

import { useState, useCallback, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import { JSONContent } from "@tiptap/react";
import VirgilEditor, { EditorHandle } from "./Editor";
import { LoadingScreen } from "./LoadingScreen";
import FramedViewerSurface from "./FramedViewerSurface";
import { setFocusBandMeta } from "@/lib/focus-view";
import {
  computeSectionPathAt,
  geomBreadcrumbEnabled,
} from "@/lib/editor-geometry/section-path";
import { isLabelTaken as isLabelTakenIn } from "@/lib/labels";
import { linkIdSelector, linkKindSelector } from "@/links/link-dom-contract";
import { isDevStorage } from "@/lib/storage-mode";
import { opfsAvailable } from "@/lib/example-doc/opfs-doc-location";
import { isTier1BDisabled } from "@/lib/perf-flags";
import { applyPerfBodyFlags } from "@/lib/perf-feature-flags";
import {
  isLayoutGestureActive,
  parkDuringLayoutGesture,
} from "@/lib/pane-resize";
import {
  LAYOUT_SITE_HELPER_ANCHOR,
  LAYOUT_SITE_SECTION_PATH,
} from "@/lib/layout-gesture-probe";
import { migrateDocAwarePopoutKey } from "@/text-objects/post-load-migrations";
import { useTransientAnchorCleanup } from "@/text-objects/useTransientAnchorCleanup";
import { type DividerLevel, type DividerWidth } from "@/hooks/useViewPrefs";
import { Editor } from "@tiptap/react";
import { type SectionPathEntry, extractHeadings } from "@/panels/Outline";
import { useFiles } from "@/hooks/useFiles";
import { getBus } from "@/lib/tiptap/doc-structure";
import { DOC_START_BLOCK_INDEX } from "@/lib/tiptap/block-address";
import { useStructuralRevisions } from "@/hooks/useStructuralRevisions";
import {
  useDocJson,
  docProductsEnabled,
} from "@/lib/doc-products/use-doc-products";
import { useMyPapers } from "@/hooks/useMyPapers";
import { useFloatingMenuPosition } from "@/hooks/useFloatingMenuPosition";
import { useUpdateAvailable } from "@/hooks/useUpdateAvailable";
import { DocPipeline } from "./editor-layout/DocPipeline";
import {
  DocKeepAliveSlot,
  useDocKeepAliveLRU,
  DOC_KEEP_ALIVE_CAPACITY,
} from "./editor-layout/DocKeepAliveLRU";
import { isMultiDocKeepAliveOn } from "@/lib/multi-doc-keepalive-flag";
import { useSelectedAnchorSync } from "@/hooks/useSelectedAnchorSync";
import { CollabProvider, COLLAB_INERT, type CollabHook } from "@/hooks/useCollab";
import { collabClaimsFor } from "@/cards/collab-broadcast";
import { useCollaboratorIdentity } from "./CollaboratorIdentityDialog";
import type { LatexError } from "@/lib/latex-errors";
import { ErrorsHost } from "./editor-layout/panels/errors-host";
import type { ErrorJump } from "@/panels/Errors";
import { IconErrors } from "./editor-layout/panel-icons";
import PrintDialog from "./PrintDialog";
import FontsDialog from "./FontsDialog";
import type { AiRequest } from "@/lib/types";
import { CITATIONS_INERT } from "@/hooks/useCitations";
import ManageStylesModal from "./ManageStylesModal";
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
import { Button } from "./panel-primitives";
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
import { cardFloatZ } from "@/floats/float-policy";
import {
  alignEntryToYIfNeeded,
  scrollEntryIntoView,
  findEditorScrollFor,
  SECTION_ACTIVE_LINE_FRACTION,
} from "./editor-layout/layout-scroll";
import { requestOmniCardPlacement } from "./editor-layout/omni-card-placement";
import { TopBar } from "./editor-layout/TopBar";
import type { TabStripProps } from "./editor-layout/TabStrip";
import type { StatusClusterProps } from "./editor-layout/StatusCluster";
import { useStripHandlers } from "./editor-layout/drag-drop";
import { useEditorOps } from "./editor-layout/card-actions/editor-ops";
import { useFocusActions } from "./editor-layout/card-actions/focus";
import { useCommentActions } from "./editor-layout/card-actions/comments";
import { useFileActions } from "./editor-layout/card-actions/files";
import { useCitationActions } from "./editor-layout/card-actions/citations";
import { useRefActions, resolveLabelDisplay } from "./editor-layout/card-actions/ref";
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
import {
  getCardStore,
  disposeCardStore,
  defaultCardStore,
} from "@/links/_shared/anchored-card-store";
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
import { useWindowChrome } from "@/hooks/useWindowChrome";
import PreferenceModePicker from "./PreferenceModePicker";
import { applyTransforms } from "@/lib/color-transforms";
import { PREF_TO_CSS, DERIVED_CSS } from "@/lib/preferences-tree";
import PreferencesModal from "./PreferencesModal";
import EditorPane, { stubAddStyleMergeRequest } from "./EditorPane";
import type { PaneState, EditorPaneViewPrefs, EditorPaneMenuBarBundle } from "./EditorPane";
import {
  buildEditorPaneViewPrefs,
  EMPTY_SECTION_PATHS,
  type EditorMutationHandlers,
  type EditorPaneViewDerivations,
  type EditorPaneSectionPaths,
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
import { ATOM_REGISTRY, CARD_ATOM_DOM_SELECTOR } from "@/lib/tiptap/atom-registry";
import { serializeCiteCommand } from "@/lib/bib-parser";
import { generateShortId } from "@/lib/uuid";
import NodeEditPopover from "./NodeEditPopover";
import {
  applyFigureEnvBodyEdit,
  applyGraphicsCommandEdit,
} from "@/lib/figures/apply-env-body";
import TexFilePickerModal from "./TexFilePickerModal";
import NewDocumentModal from "./NewDocumentModal";
import { useFocusMode } from "@/hooks/useFocusMode";
import { serializeToLatex } from "@/lib/latex-serializer";
import pkg from "../../package.json";

const APP_VERSION = pkg.version;

// Stable no-op fallback for the `paneState?.X ?? noop` reads in the
// vbar source. Module-scope so JSX references stay referentially
// stable across renders.
const noop = () => {};
// Phase-C INERT fallbacks for the pane-owned sidecar slices (read only in the
// brief pre-bubble window — same as citationsHook/collab). Stable module-level
// identities so they don't churn the anchor-sync/hover consumers. Typed via
// PaneState indexed access so no element-type imports are needed.
const EMPTY_REVISIONS: PaneState["revisions"] = [];
const EMPTY_NOTES: PaneState["notes"] = [];
const EMPTY_CUTTER: PaneState["cutterCards"] = [];
const EMPTY_TODOS: PaneState["todoItems"] = [];
const EMPTY_ARCHIVE: PaneState["archiveSnippets"] = [];
const EMPTY_AI_REQUESTS: PaneState["aiRequests"] = [];
// Stable empties for the shell's diagnostics fallbacks (read from paneState in
// the code-view Errors sidebar + badge; the pane owns the real state now).
const EMPTY_ERR_SET: Set<string> = new Set();
const EMPTY_ERR_MAP: Map<string, string> = new Map();
const EMPTY_LATEX_ERRORS_L: LatexError[] = [];
import { hasFsaSupport } from "@/lib/fsa-support";
import { queryRW } from "@/lib/fsa-permissions";
import { getDocHandle } from "@/lib/doc-index";
import { useSystemDialog } from "@/components/system-dialog-host";
import { asBibFamily, type BibFamilyConflict } from "@/lib/bib-family";
import { UnsupportedBrowserNotice } from "./UnsupportedBrowserNotice";
import { DocPermissionGate } from "./DocPermissionGate";
import { RecentPapersList } from "./RecentPapersList";
import { InstallPwaPrompt } from "./InstallPwaPrompt";
import { LibraryTabView } from "./library/LibraryTabView";
import PaperOuterView from "./library/PaperOuterView";
import LibraryOuterView from "./library/LibraryOuterView";
import {
  OUTER_LIBRARY_ROOT_ID,
} from "@/lib/doc-index";
import { useLibraryRegistry } from "@library/hooks/useLibraryRegistry";
import { iconHint } from "@/components/Hint";


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
    openExample,
    resetExampleDoc,
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

  // EditorPane bubbles its per-doc state here via `onPaneStateChange` so the
  // Virgil bar can read editor / compile / view-switch / AI-dot status against
  // the live values without owning the hooks itself.
  //
  // Multi-doc keep-alive: N doc editors can be mounted at once (1 visible + a
  // warm LRU). Each pane writes its OWN slot in a docId-keyed map; the layout
  // reads the ACTIVE doc's slot. Keeping the derived `paneState` name identical
  // means every downstream consumer is unchanged — they still see "the active
  // pane's state". (A warm pane writing its slot leaves the derived active
  // `paneState` reference untouched, so no active-doc memo/effect re-runs.)
  const [paneStateByDocId, setPaneStateByDocId] = useState<
    Record<string, PaneState | null>
  >({});
  const paneState: PaneState | null = currentDocId
    ? paneStateByDocId[currentDocId] ?? null
    : null;
  const paneStateRef = useRef(paneState);
  paneStateRef.current = paneState;

  // SSR-safe mirror of `isDevStorage`. The runtime check requires `window`
  // (iframe + FSA detection), so we start false on the server and update
  // after hydration. Used in render to hide FSA-only chrome inside the
  // Claude Preview iframe; in a normal tab it stays false.
  const [devStorage, setDevStorage] = useState(false);
  // SSR-safe mirror of OPFS availability (the runtime check needs `navigator`).
  // The bundled example doc is offered only where OPFS works AND we're not on
  // the dev backend (the example is a production-only FSA/OPFS feature).
  const [opfsOk, setOpfsOk] = useState(false);

  // "Is the external-change badge currently showing something?" — lifted from a
  // provider-descendant reporter (ExternalChangeActiveReporter, rendered in the
  // status cluster) so the topbar DIVIDER gate can OR it in. EditorLayout's own
  // body sits ABOVE the DiskWatcherProvider in the tree, so it can't read
  // useExternalChanges() directly; the reporter pushes the boolean up instead.
  // KEYSTROKE SANCTITY: the reporter reads useSyncExternalStore over the
  // watcher's stable snapshot — NOT any editor subscription — so this adds zero
  // per-keystroke work.
  const [externalChangeActive, setExternalChangeActive] = useState(false);

  // Save-time bib-family conflict warning (P4). When the family the body needs
  // (an `\autocite` under a natbib baseline, or the symmetric case) conflicts
  // with the family the preamble hard-loads, the serializer surfaces a
  // BibFamilyConflict. Per the locked decision we WARN, never rewrite — reuse
  // the low-tone systemDialog (same soft surface as the PDF-persistence and
  // skill-sync notices), NOT a danger modal. Debounced by a signature ref so a
  // burst of code-view serializes doesn't re-alert on the same conflict.
  const systemDialog = useSystemDialog();
  const lastBibConflictKeyRef = useRef<string | null>(null);
  const handleBibFamilyConflict = useCallback(
    (conflict: BibFamilyConflict) => {
      const key = `${conflict.declared}->${conflict.preambleHas}`;
      if (lastBibConflictKeyRef.current === key) return;
      lastBibConflictKeyRef.current = key;
      const needs = conflict.declared === "biblatex" ? "biblatex" : "natbib";
      const has = conflict.preambleHas;
      void systemDialog.alert({
        title: "Bibliography package mismatch",
        message:
          `This document uses ${needs}-family citation commands, but the preamble loads ${has}. ` +
          `Your commands and preamble are left unchanged — switch the preamble to \\usepackage{${needs}} ` +
          `(or adjust the commands) so the bibliography compiles.`,
        tone: "default",
      });
    },
    [systemDialog],
  );

  useEffect(() => { setDevStorage(isDevStorage); }, []);
  useEffect(() => { setOpfsOk(opfsAvailable()); }, []);
  // Wave-4 Stage A: stamp the CSS-scoped perf flags (body.perf-contain) once
  // at shell boot — the stylesheet is the consumer; a flip applies on reload.
  useEffect(() => { applyPerfBodyFlags(); }, []);
  const exampleAvailable = opfsOk && !devStorage;

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
  // P6: EditorLayout owns only the PDF-VIEW toggle. The PDF STATE
  // (bytes / blob URL / stale / last-compile-time) is owned SOLELY by the
  // per-doc EditorPane and bubbled up via `paneState` — the viewer below reads
  // `paneState?.pdfBlobUrl` / `paneState?.pdfStale`. The former dead parallel
  // copies here (pdfBlobUrl / lastCompileTime / pdfStale / latestPdfBytes) were
  // never populated by any compile and have been removed.
  const [pdfView, setPdfView] = useState(false);

  useEffect(() => {
    setPdfView(false);
  }, [currentDocId]);

  // `promptDocClassMismatch` feeds EditorPane's live `useLatexCompile`
  // (via the `onDocumentClassMismatch` prop below) — EditorLayout no longer
  // mounts its own compile hook. Compile errors / log / status are read from
  // the live pane via `paneState` (the single authoritative compile source).
  const { prompt: promptDocClassMismatch, dialog: docClassDialog } =
    useDocumentClassMismatchDialog();
  // Pane-owns-all (Phase C): useSuggestions is mounted ONLY in EditorPane now;
  // the layout reads the current pending suggestion off the active pane's bubble
  // (the other fields were dead in the layout). Mirrors citationsHook/collab.
  const currentSuggestion = paneState?.currentSuggestion ?? null;
  const comments = paneState?.revisions ?? EMPTY_REVISIONS;
  // Pane-owns-all (Phase C, completing the R21 consolidation): the sidecar hooks
  // (suggestions/revisions/notes/cutter/todos/aiRequests/archive) are mounted
  // ONLY in EditorPane now. This shell no longer mounts its own parity copies on
  // docIdForHooks; it reads the card arrays it still consumes (anchor re-apply,
  // hover→anchor derivation, selected-anchor sync, the archive/footnote drop
  // bridges) off the active pane's bubbled PaneState slices, with stable INERT
  // fallbacks for the brief pre-bubble window — exactly like citationsHook/collab.
  const recentlyAdded = useRecentlyAddedTracker();
  const notes = paneState?.notes ?? EMPTY_NOTES;
  const cutterCards = paneState?.cutterCards ?? EMPTY_CUTTER;
  // The ACTIVE doc's interaction store. EditorLayout is the SHELL, above the
  // per-doc <CardStoreProvider> each EditorPane mounts, so it resolves the
  // active store by id from the registry (the same instance the active pane
  // uses). A `currentDocIdRef` lets `[]`-deps listeners (the click-away
  // clearSelection, the marker-click bridge) resolve the active store at FIRE
  // time without a stale capture. `defaultCardStore` is the no-doc-open
  // fallback (its mutations are inert no-ops).
  const activeCardStore = currentDocId ? getCardStore(currentDocId) : defaultCardStore;
  const currentDocIdRef = useRef(currentDocId);
  currentDocIdRef.current = currentDocId;
  // Stable getter (reads the ref, not currentDocId) so it can sit in a []-deps
  // listener effect without re-attaching the window listener every render.
  const getActiveCardStore = useCallback(
    () => (currentDocIdRef.current ? getCardStore(currentDocIdRef.current) : defaultCardStore),
    [],
  );

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
  } = useAnchoredSelectionSlots(activeCardStore);
  const todoItems = paneState?.todoItems ?? EMPTY_TODOS;

  // AI requests: EditorPane owns the live hook; the layout reads the slice it
  // feeds into AiRequestsProvider (the user-facing create/edit path is shadowed
  // by EditorPane's OWN inner AiRequestsProvider, so this is correctness-only).
  const aiRequests = paneState?.aiRequests ?? EMPTY_AI_REQUESTS;
  const addAiRequest = paneState?.addRequest ?? noop;
  const updateAiRequestText = paneState?.updateRequestText ?? noop;
  const deleteAiRequest = paneState?.deleteRequest ?? noop;

  // Archive: only `snippets` (panel/hover/anchor-sync) + `deleteSnippet` (the two
  // data-desync bridges: footnote-consumes-archive + drop-restore) are live.
  const archiveSnippets = paneState?.archiveSnippets ?? EMPTY_ARCHIVE;
  const deleteSnippet = paneState?.deleteArchiveSnippet ?? noop;

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
  // useMemo so the bar's StatusCluster memo holds: the ternary would otherwise
  // be evaluated fresh each render, but the resolved reference (the bubbled
  // pane collab hook or the COLLAB_INERT singleton) is stable across renders
  // where the active pane's collab object is unchanged.
  const collab: CollabHook = useMemo(
    () => paneState?.collab ?? COLLAB_INERT,
    [paneState?.collab],
  );
  // Latest-ref so the collab action handlers (threaded into the memoized status
  // cluster) stay referentially stable across collab pen/presence/sidecar ticks
  // — only the context-consuming CollabStatusPill re-renders on those, not the
  // whole cluster.
  const collabRef = useRef(collab);
  collabRef.current = collab;
  const { ensureIdentity, dialog: identityDialog } = useCollaboratorIdentity();

  const handleEnableCollab = useCallback(async () => {
    const id = await ensureIdentity();
    if (!id) return;
    collabRef.current.setIdentity(id);
    await collabRef.current.enableCollab();
  }, [ensureIdentity]);

  const handleEditIdentity = useCallback(async () => {
    const id = await ensureIdentity({ force: true });
    if (id) collabRef.current.setIdentity(id);
  }, [ensureIdentity]);

  const handleDisableCollab = useCallback(() => {
    void collabRef.current.disableCollab();
  }, []);

  // Stable () => void wrappers for the async collab handlers, threaded into
  // StatusCluster (which builds the CollabStatusPill from these).
  const onEnableCollab = useCallback(() => {
    void handleEnableCollab();
  }, [handleEnableCollab]);
  const onEditIdentity = useCallback(() => {
    void handleEditIdentity();
  }, [handleEditIdentity]);

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
    setCodePaneRatio,
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
    // The three registry-driven view-pref writers (task 274). Every view pref
    // — par titles, % comments, marginalia + its hidden types, heading labels,
    // highlights + their hidden types, divider levels/width, the bib filter —
    // is written by key through these; there are no per-pref setters.
    setViewPref,
    toggleViewPref,
    toggleViewPrefMember,
    toggleOmniCategory,
    resetOmniSide,
    toggleOmniHideAllCards,
    setCardArchiveView,
    setSuppressArchiveAtomWarning,
  } = viewPrefsResult;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;


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
      // Bounded card-float band: `cardFloatZ` saturates the MRU offset at
      // FLOAT_Z_MAX so a frontmost card can never climb over the draggable
      // dialog tier, however many cards are popped (task 137).
      return cardFloatZ(idx >= 0 ? idx : cards.length);
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
  // Multi-doc keep-alive: see `paneStateByDocId` above. The active editor is
  // derived from a docId-keyed map; `editorInstance` keeps its name so the ~70
  // downstream consumers (collab gate, focus mode, code-pane bridge, popout
  // migration, …) are unchanged — they all operate on the active doc's editor.
  const [editorInstanceByDocId, setEditorInstanceByDocId] = useState<
    Record<string, Editor>
  >({});
  const editorInstance: Editor | null = currentDocId
    ? editorInstanceByDocId[currentDocId] ?? null
    : null;

  // Stable per-slot writers. Each mounted pane gets ONE cached callback keyed by
  // its docId so its identity never changes across renders — an unstable
  // `onEditorReady` would re-fire VirgilEditor's `setEditor` effect and loop.
  // A pane writes only its own slot; the layout reads `[currentDocId]`.
  const onEditorReadyCacheRef = useRef(
    new Map<string, (ed: Editor) => void>(),
  );
  const onPaneStateCacheRef = useRef(
    new Map<string, (st: PaneState | null) => void>(),
  );
  const getOnEditorReady = useCallback((slotDocId: string) => {
    const cache = onEditorReadyCacheRef.current;
    let cb = cache.get(slotDocId);
    if (!cb) {
      cb = (ed: Editor) =>
        setEditorInstanceByDocId((m) =>
          m[slotDocId] === ed ? m : { ...m, [slotDocId]: ed },
        );
      cache.set(slotDocId, cb);
    }
    return cb;
  }, []);
  const getOnPaneStateChange = useCallback((slotDocId: string) => {
    const cache = onPaneStateCacheRef.current;
    let cb = cache.get(slotDocId);
    if (!cb) {
      cb = (st: PaneState | null) =>
        setPaneStateByDocId((m) => ({ ...m, [slotDocId]: st }));
      cache.set(slotDocId, cb);
    }
    return cb;
  }, []);
  // Fired by DocKeepAliveSlot on a TRUE unmount (LRU eviction / tab close),
  // never a visibility flip. Drop the doc's map slots + cached callbacks.
  // Idempotent (functional-update bail) so StrictMode's double-invoke is safe.
  const pruneDocMaps = useCallback((slotDocId: string) => {
    setEditorInstanceByDocId((m) => {
      if (!(slotDocId in m)) return m;
      const { [slotDocId]: _drop, ...rest } = m;
      return rest;
    });
    setPaneStateByDocId((m) => {
      if (!(slotDocId in m)) return m;
      const { [slotDocId]: _drop, ...rest } = m;
      return rest;
    });
    onEditorReadyCacheRef.current.delete(slotDocId);
    onPaneStateCacheRef.current.delete(slotDocId);
    // Drop this doc's interaction store on a TRUE unmount (LRU evict / tab
    // close — NOT a keep-alive hide), mirroring the per-doc map prune above. A
    // warm hidden doc keeps its store, so its selection/expansion survives the
    // tab-switch; a cold re-open gets a fresh store.
    disposeCardStore(slotDocId);
  }, []);

  // Keep-alive LRU of authored docs. Only a GRANTED, active doc may lead the
  // warm set; an ungranted active doc → activeId=null → the LRU order is left
  // intact (previously-granted warm docs stay hidden) while the standalone
  // DocPermissionGate below handles the one-time cold first-grant. Folding the
  // permission test in here is what lets `docPermState` stay a single
  // active-doc state — no per-doc permission effects needed.
  const grantedActiveDocId =
    activePane === "doc" && docPermState === "granted" ? currentDocId : null;
  // Flag-gated capacity. Default ON → keep the last N papers warm so a
  // paper↔paper switch is an instant visibility flip. The localStorage opt-out
  // (`virgil:multi-doc-keepalive` = "0") clamps to 1 = the legacy behavior: one
  // mounted doc, cold-remounted on a switch (the same-docId paper↔Library bounce
  // from L2 still stays warm at capacity 1). Read once on mount; the flag needs a
  // reload to take effect (same as the other virgil: flags).
  const docKeepAliveCapacity = useMemo(
    () => (isMultiDocKeepAliveOn() ? DOC_KEEP_ALIVE_CAPACITY : 1),
    [],
  );
  const docKeepAliveEntries = useDocKeepAliveLRU(
    grantedActiveDocId,
    docKeepAliveCapacity,
  );
  // The actually-rendered keep-alive slots = LRU order ∩ open tabs (a just-closed
  // id can linger in the LRU order; filter it out). Derived once so the render
  // block and the DiskWatcher's live-set reconciliation agree on the set.
  const renderedKeepAliveEntries = docKeepAliveEntries.filter((e) =>
    openTabs.some((t) => t.id === e.id),
  );
  const keepAliveDocIds = renderedKeepAliveEntries.map((e) => e.id);

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
  // The View-menu visibility prefs (paragraph titles, % comments, marginalia,
  // heading labels, dividers, …) are persisted via ViewPrefs — global, mirrored
  // across windows, riding the personal-prefs promotion pipeline. They are READ
  // off `prefs` wherever needed and WRITTEN by key through the three registry
  // writers above (task 274); the two below are pulled out only because a local
  // effect reflects each onto a <body> class.
  const showCardTitles = prefs.showCardTitles;

  // Card +T add-title affordance visibility — the card analog of
  // `showParTitles`. Unlike paragraph titles (gated by a class on
  // `.editor-pane-column` via `viewToggleClasses`), cards render in the panel
  // strips, the omni host, AND body-portaled float popouts — none under that
  // column — so the gate lives on a body-level `.hide-card-titles` class that
  // every card surface descends from.
  // Reflect the pref onto <body> so the CSS gate reaches every card surface,
  // including popouts portaled outside the React tree. Depends only on the
  // boolean pref — zero per-keystroke work (keystroke sanctity).
  useEffect(() => {
    const cls = "hide-card-titles";
    document.body.classList.toggle(cls, !showCardTitles);
    return () => document.body.classList.remove(cls);
  }, [showCardTitles]);

  // Card outline chrome — the colored hover/select outline is OPT-IN
  // (default off: retint/brighten stays, colored edge is gone), reflected to a
  // body class so the CSS gate reaches every card surface (docked + omni +
  // portaled floats), exactly like `showCardTitles`.
  const cardOutlineChrome = prefs.cardOutlineChrome;
  // Reflect the opt-in pref onto <body>: the outline rules require
  // `.card-outline-chrome`, so the default (class absent) is the no-outline
  // look. Depends only on the boolean — zero per-keystroke work.
  useEffect(() => {
    const cls = "card-outline-chrome";
    document.body.classList.toggle(cls, cardOutlineChrome);
    return () => document.body.classList.remove(cls);
  }, [cardOutlineChrome]);
  // Divider levels the user has ENABLED, as a Set for the ∩ below (the pref
  // itself is an array; only this derivation wants set semantics).
  const dividerLevels = useMemo(
    () => new Set(prefs.dividerLevels),
    [prefs.dividerLevels],
  );

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
      const next = helperBtnRef.current?.getBoundingClientRect() ?? null;
      // Equality bail (task 317). `getBoundingClientRect` returns a FRESH
      // DOMRect every call, so setting it unconditionally re-rendered this
      // component — the app ROOT — on every scroll and resize event for as
      // long as the Help menu stayed open, whether or not the button moved.
      setHelperAnchorRect((prev) =>
        prev === next ||
        (prev !== null &&
          next !== null &&
          prev.top === next.top &&
          prev.left === next.left &&
          prev.width === next.width &&
          prev.height === next.height)
          ? prev
          : next,
      );
    };
    // Parked, not suppressed: the Help button lives in the Virgil bar — LEFT-
    // anchored top chrome, which a window drag displaces by ~0.001·delta (the
    // editor column carries `flex: 1000 1 0` between the rails) — so a stale
    // anchor for the length of a gesture cannot visibly detach the popover,
    // and the settle re-seats it exactly once.
    const anchorPark = parkDuringLayoutGesture(
      refreshAnchor,
      LAYOUT_SITE_HELPER_ANCHOR,
    );
    const onAnchorEvent = () => anchorPark.fire();
    const id = window.setTimeout(() => window.addEventListener("click", close), 0);
    window.addEventListener("resize", onAnchorEvent);
    window.addEventListener("scroll", onAnchorEvent, true);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("click", close);
      window.removeEventListener("resize", onAnchorEvent);
      window.removeEventListener("scroll", onAnchorEvent, true);
      anchorPark.dispose();
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
  // Window chrome geometry (WCO title-bar / display mode). Consumed once here
  // so the <html data-display-mode> mirror + geometry listeners stay live for
  // the whole session; the visual bar behaviour itself is pure CSS driven by
  // the --window-inset-* SSOT plus the :root[data-display-mode="…"] gate (this
  // hook is a window-level, not editor-level, reactor — exempt from keystroke
  // sanctity like DiskWatcher).
  useWindowChrome();
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
  // Flag-on (perf Wave 1): the DocProducts pipeline's shared docJson replaces
  // the legacy setLatestDoc feed (editor-ops handleUpdate no-ops). Reads fall
  // through to `latestDoc` while the pipeline hasn't produced yet.
  const pipelineDocJson = useDocJson(docProductsEnabled ? editorInstance : null);
  const latestDocEffective = docProductsEnabled
    ? (pipelineDocJson ?? latestDoc)
    : latestDoc;
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
  //
  // Orphaned footnotes are NO LONGER shell state. They live in the per-doc
  // sidecar store (`useOrphanedFootnotes(docId)`) UNDER the `<DocPipeline>`
  // boundary, owned inside each `EditorPane`. The legacy shell `useState` here
  // bled across warm keep-alive panes (FN-A2-03) because it sat above that
  // boundary; the per-pane store + docId-routed event web (EditorPane) replaces
  // it on both flag paths.
  const [selectedBibKey, setSelectedBibKey] = useState<string | null>(null);
  // Marker-click → omni card alignment. The user clicked at viewport Y
  // `clickY` and the corresponding omni card would lock there — IF the move
  // is necessary. `requestOmniCardPlacement` owns the whole resolution now
  // (prefix-or-exact wrapper match, the `@N` row's own id, the screen → pod
  // → anchor-relative conversion, the one-frame retry for a column activated
  // this render) and, crucially, the necessity rule: a card that is already
  // fully visible and near enough to the click has NOTHING written for it —
  // not even a pin at its current top, which would release whichever card
  // another gesture had pinned — so neither it nor its neighbours move at
  // all (task 328, example 2).
  const alignOmniCardWithClick = useCallback(
    (cardId: string, clickY: number, _sourceEl: HTMLElement | null) => {
      requestOmniCardPlacement(cardId, { viewportY: clickY });
    },
    [],
  );

  // Card-body click → editor scroll alignment. `jumpToLink`/`jumpToCard`
  // (links.ts) scroll the row so the in-text anchor lands at the card's
  // pre-jump viewport Y — and fire this event ONLY when that scroll actually
  // happened, since the pin exists to compensate for the document moving
  // under the card. The publisher computes `pinTop` from the pre-scroll pod
  // rect (pod-relative is scroll-invariant under unified scroll, so the
  // pre-scroll value is already correct post-scroll) and hands it over as
  // `detail.pinTop`; we route it through the same placement door, which asks
  // the necessity rule against the card's POST-scroll rect — exactly the
  // right question, since a card the scroll pushed off screen should come
  // back to its marker while one still comfortably in view should not move.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { omniKey?: string; pinTop?: number }
        | undefined;
      if (!detail?.omniKey || typeof detail.pinTop !== "number") return;
      requestOmniCardPlacement(detail.omniKey, { podTop: detail.pinTop });
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
  // Hover state read from the ACTIVE doc's store via a useSyncExternalStore
  // subscription. The only EditorLayout-side consumer is the `hoveredAnchorId`
  // derivation below (hover → Mode B anchor id for the linked-anchor highlight).
  // When `currentDocId` flips, `activeCardStore` changes → this re-subscribes to
  // the new doc's store (a once-per-switch event, never per-keystroke). New code
  // inside the pane should read its store via useHover().
  const _paneHoverState = useSyncExternalStore(
    activeCardStore.subscribe,
    activeCardStore.getHoverSnapshot,
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
  // (SR-F3-01/F8-01). EditorLayout reads it back below to gate `highlightText`
  // (the search vs. comment-highlight preference); the error-highlight range now
  // lives entirely in EditorPane (`useDiagnostics`).
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

  const [errorsSidebarOpen, setErrorsSidebarOpen] = useState(false);

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
        // Card-bearing atoms (footnote + citation) — derived from ATOM_REGISTRY
        // (`idAttr !== null`) so this stays consistent with the render DOM and a
        // future Card-bearing kind is covered for free (task 256). Replaces the
        // old footnote-by-class / citation-by-data-type split.
        t.closest(CARD_ATOM_DOM_SELECTOR)
      ) {
        return;
      }
      // Resolve the active doc's store at fire time (this listener has []-deps
      // and must not capture a stale doc). No-op via defaultCardStore when no
      // doc is open.
      (currentDocIdRef.current
        ? getCardStore(currentDocIdRef.current)
        : defaultCardStore
      ).clearSelection();
      setSelectedBibKey(null);
      paneStateRef.current?.setSelectedErrorId?.(null);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  // Code-view sidebar jump: stay in code, scroll the CodeMirror pane to the
  // error line, and select the card (selection lives in EditorPane now).
  const codeJump = useCallback((err: LatexError) => {
    paneStateRef.current?.setSelectedErrorId?.(err.id);
    codeEditorHandleRef.current?.scrollToLine?.(err.line, err.column);
  }, []);
  // The code sidebar's jump capability (task 125): handler + the semantics it
  // implements, bound here at the handler's own definition so the mount below
  // states no mode of its own. `"line"` because `scrollToLine` reaches the
  // error by LINE — which makes a preamble / `\usepackage` error genuinely
  // reachable here (unlike the visual mounts) and a line-LESS one genuinely
  // unreachable: `scrollToLine(0)` clamps to line 1, so handing it such an
  // error would scroll the code pane to the top, move the caret there and
  // steal focus. The `ErrorsPanel` gate declines it instead; selection (which
  // is what the click is really for) still happens.
  const codeErrorJump = useMemo<ErrorJump>(
    () => ({ mode: "line", jump: codeJump }),
    [codeJump],
  );
  // Stable feed for CodeEditor's onTextChange while the code view is open — routes
  // the raw CodeMirror text into the active pane's sourceText (no longer the sole
  // source; the pane serializes TipTap otherwise).
  const handleCodeEditorTextChange = useCallback((text: string) => {
    paneStateRef.current?.setSourceText?.(text);
  }, []);
  // Marker-click selection now routes to the bubbled per-doc setter.
  const setSelectedErrorIdBridge = useCallback((id: string | null) => {
    paneStateRef.current?.setSelectedErrorId?.(id);
  }, []);

  // Paragraph navigation history (back/forward) — ref-based to avoid stale closures
  const paraHistoryRef = useRef<{ stack: string[]; idx: number }>({ stack: [], idx: -1 });
  const currentParaRef = useRef<string | null>(null);
  const navigatingRef = useRef(false);
  const [paraNavVersion, setParaNavVersion] = useState(0); // bump to re-render toolbar

  // Track active paragraph and build navigation history
  // Model: stack always includes current position, idx points to where we are now.
  // Back: idx--, Forward: idx++, New position: truncate forward + push.
  useEffect(() => {
    if (!editorInstance && !codeView) return;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const checkParagraph = () => {
      if (navigatingRef.current) return;
      // Wave-2b C6: this runs on a bare 2s wall clock — gate it on
      // page visibility (a backgrounded tab must not poll layout) and on
      // layout gestures (mid-drag geometry is in flux; the post-gesture
      // tick reads the settled truth). Hidden keep-alive PANES are handled
      // inside getActiveParagraphId itself (offsetHeight bail → null).
      if (typeof document !== "undefined" && document.hidden) return;
      if (isLayoutGestureActive()) return;
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
      editorRef.current?.scrollToHeading(DOC_START_BLOCK_INDEX);
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
        `${linkKindSelector("citation")}${linkIdSelector(c.citationId)}`,
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
      // Keep-alive: skip the breadcrumb recompute when the doc editor is hidden
      // (display:none ⇒ scrollEl.offsetHeight 0 ⇒ every coordsAtPos/rect is 0).
      // Bailing leaves the last-good section path in place (the cursor/scroll
      // can't change while hidden) and avoids caching a 0-coord breadcrumb.
      if ((scrollEl as HTMLElement).offsetHeight === 0) return;
      // Wave-2 C2: ONE posAtCoords at the reference line + binary search over
      // the structure snapshot, instead of the O(headings + titles)
      // coordsAtPos walk below. Null (no bus / hit-test miss) falls through
      // to the legacy walk; kill-switch `virgil:geom-breadcrumb = "off"`.
      if (geomBreadcrumbEnabled()) {
        const fsFast = focusStateRef.current;
        const fast = computeSectionPathAt(
          editorInstance,
          view,
          scrollEl,
          fsFast.active && fsFast.locked
            ? { start: fsFast.startBlockIndex, end: fsFast.endBlockIndex }
            : null,
        );
        if (fast) {
          setCurrentSectionPath((prev) => {
            const next = fast.path;
            if (prev.length === next.length && prev.every((v, i) => v.text === next[i].text && v.index === next[i].index && v.sectionNumber === next[i].sectionNumber)) {
              return prev;
            }
            return next;
          });
          setCurrentParTitleIndex((prev) =>
            prev === fast.parTitleIndex ? prev : fast.parTitleIndex,
          );
          return;
        }
      }
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
    // Only the RESIZE path parks (task 317). `compute` walks every heading
    // calling `coordsAtPos` — ProseMirror's most expensive forced-layout call —
    // so re-solving it per frame of a window drag is the single heaviest
    // per-frame cost in the app at ×1 pane (×2 with the Reader). The SCROLL
    // path stays live: the breadcrumb must follow the scroll it describes.
    const resizePark = parkDuringLayoutGesture(schedule, LAYOUT_SITE_SECTION_PATH);
    const onWindowResize = () => resizePark.fire();
    compute();
    scrollEl.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", onWindowResize);
    editorInstance.on("update", onEditorUpdate);
    return () => {
      cancelAnimationFrame(raf);
      scrollEl.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", onWindowResize);
      resizePark.dispose();
      editorInstance.off("update", onEditorUpdate);
    };
    // Focus band values are deps so the breadcrumb recomputes when focus
    // toggles/moves/locks — a meta-only tx (not docChanged) doesn't fire
    // `update`, so without these the breadcrumb would stay stale until the next
    // scroll. `locked` is a dep because skipHidden is now lock-gated (CHIP A),
    // so toggling the lock changes which blocks the breadcrumb considers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorInstance, focusMode.state.active, focusMode.state.locked, focusMode.state.startBlockIndex, focusMode.state.endBlockIndex]);

  // The MIRROR (second pane) position tracker lived here — a second copy of
  // the breadcrumb recompute above, scoped to the mirror ProseMirror view's
  // scroll container, plus its `mirrorSectionPath` / `mirrorParTitleIndex` /
  // `mirrorViewGen` state and its own `editor.on('update')` subscription
  // (which is why the keystroke-sanctity allowlist named two subscribers for
  // this file). It was maintained for a pane nothing mounted: the split's
  // render site was dropped in a refactor, so `mirrorViewRef.current` was
  // permanently null and the effect took its clear-and-return branch on every
  // run. Retired with the split in task 115.

  // Derive footnotes list from editor state (sorted by document position).
  // Recomputes on `editorInstance` change (initial mount + doc-switch remount)
  // and when footnotes change (`rev.footnotes` — add/remove/reorder, and
  // footnote-body edits which surface as a footnote-order change). Plain
  // typing bumps neither, so this no longer re-walks per keystroke.
  const footnotes = useMemo(() => {
    return editorRef.current?.getFootnotes() ?? [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev.footnotes, editorInstance]);

  // (Phase C) the dead `sortedArchiveSnippets` memo was removed — it was never
  // read or passed; the Archive panel sorts inside EditorPane now.
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
    setLatestDoc,
    // T3 (W3a): the label commit shares the live warning's predicate.
    isLabelTaken: checkLabelTaken,
  });

  // ── Focus mode helpers ─────────────────────────────────────────────
  const docForOutline = latestDocEffective;
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
  } = useFocusActions({
    focusMode,
    outlineHeadings: outlineFocusHeadings,
    outlineTotalBlocks,
    // Seed focus-mode from the CURRENT section: the innermost active heading
    // (last section-path entry), else the doc-start par-title region, else null
    // (nothing measured yet → activate() falls back to the first section). All
    // three are top-level block indices in the same space as outlineFocusHeadings.
    currentSeedBlockIndex: currentSectionPath.at(-1)?.index ?? currentParTitleIndex,
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
          // Necessity-gated (task 328): this scrolls the shared ROW, so an
          // unconditional align drags the document to re-place a card the
          // user can already see. `scrollEntryIntoView`'s `block:"nearest"`
          // default is self-gating in the same way.
          alignEntryToYIfNeeded(entry, targetY);
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

  // labelRef sibling of `getCitationDisplayText` — resolves a card-nested
  // `\ref`'s number against MAIN for RichTextField's load-time refresh. Mirrors
  // the EditorPane mount; reuses the create flow's `resolveLabelDisplay`.
  const getRefDisplayText = useCallback(
    (label: string, refCommand: string): string | null => {
      const mainDoc = editorRef.current?.getEditor()?.state.doc;
      if (!mainDoc) return null;
      const cmd = (refCommand === "getref" || refCommand === "getfullref"
        ? refCommand
        : "ref") as "ref" | "getref" | "getfullref";
      return resolveLabelDisplay(mainDoc, label, cmd).display;
    },
    [],
  );


  // The MenuBar bundle: the registry slice + the two doc-derived divider sets
  // + the three registry-driven writers (task 274). It carries no per-pref
  // field and no per-pref callback, so a new view pref is a registry row and
  // nothing here.
  const editorPaneMenuBar: EditorPaneMenuBarBundle = useMemo(() => ({
    prefs,
    availableDividerLevels,
    activeDividerLevels,
    toggleViewPref,
    setViewPref,
    toggleViewPrefMember,
    closeAllPanels,
    paraNavBack,
    paraNavForward,
    paraNavBackDisabled,
    paraNavForwardDisabled,
    onOpenFontsDialog: () => setFontsOpen(true),
    onOpenMarginsMode: enterMarginEditMode,
  }), [
    prefs,
    availableDividerLevels,
    activeDividerLevels,
    toggleViewPref,
    setViewPref,
    toggleViewPrefMember,
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
    setSelectedErrorId: setSelectedErrorIdBridge,
    setActiveRefLabel,
    setActiveRefRect,
    setActiveRefCommand,
    setAtomCreateRequest,
    setActiveMath,
    setActiveFigure,
    alignOmniCardWithClick,
    // Resolve the active doc's store at click time (the bridge's listener
    // effects don't re-subscribe on doc switch). Shares `currentDocIdRef` with
    // the click-away clearSelection so marker-select + click-away target the
    // same active instance. Stable identity (useCallback) so the listener
    // effect isn't re-attached every render.
    getActiveCardStore,
  });

  // Shell-level archive bridge only. The orphan/suppress/panel-dropped web moved
  // into EditorPane (per-doc, docId-routed) — see useFootnoteOrphanBridges.
  useFootnoteSyncBridges({ deleteSnippet });

  // Highlight the active \ref node with yellow while the popover is open
  useEffect(() => {
    if (!activeRefLabel) return;
    const els = document.querySelectorAll(
      `.${ATOM_REGISTRY.ref.domClass}[data-label="${activeRefLabel}"]`,
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
    (pos: number, keys: string[], owner?: Editor | null) => {
      const handle = editorRef.current;
      const mainEd = handle?.getEditor();
      // Insert into the editor that OWNS the create — the footnote/card editor
      // whose pos-space the popover captured `pos` in, falling back to MAIN
      // (CHIP 5; mirrors `handleMathSave(activeMath.editor, …)`). The citation
      // id stays globally unique because `getCitationIds()` already walks the
      // MAIN doc INCLUDING footnote-nested cites (Editor.tsx), so a cite created
      // inside a footnote can't collide with one in the body.
      // An explicitly-threaded owner that has since been DESTROYED (the footnote
      // card closed / scrolled away while the deferred-commit popover stayed
      // open) leaves `pos` stranded in that editor's pos-space — silently
      // retargeting to MAIN would insert the atom at a bogus main position.
      // Abort instead. A null/undefined owner is a MAIN-editor create (pos is
      // main-space), so it falls through to mainEd.
      if (owner && owner.isDestroyed) return;
      const targetEd = owner ?? mainEd;
      if (!handle || !targetEd || keys.length === 0) return;
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
        editor: targetEd,
        type: "citation",
        attrs: { citationId, command, displayText: "" },
        at: pos,
      });
      // Card registration is editor-independent — it lands a panel card keyed by
      // `citationId` (no second atom, no cursor read), so it works the same for
      // a footnote-nested cite (the `nestedInFootnoteId` machinery resolves its
      // in-text position from the host footnote marker).
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
    // Tasks 318/319: this is the SOLE env-body save path for both kinds (the
    // figure NodeView's chrome mutators patch `extras` / `command` directly and
    // never rebuild a whole env). The attr re-thread lives in the shared
    // writeback module, which this and the NodeView's own copy used to
    // re-implement side by side — and had already drifted, `shortCaption`
    // reaching only one of them.
    //
    // Both doors carry the bounds + kind guard internally: the popover outlives
    // the click, so by save time the owning editor may have re-seeded (the
    // figure float re-syncs from MAIN) and shifted `pos` past the doc end,
    // where `nodeAt` THROWS. A stale pos is a safe no-op. (Mirrors
    // handleMathSave.)
    if (!applyFigureEnvBodyEdit(editor, pos, newText)) {
      applyGraphicsCommandEdit(editor, pos, newText);
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
    // Orphan edit/delete/title handlers are owned by EditorPane's per-doc store
    // (`useOrphanedFootnotes`) and injected via `effectiveViewPrefs`; these noop
    // placeholders satisfy the bundle shape and are always overridden there.
    onEditOrphan: noop,
    onDeleteOrphan: noop,
    onEditOrphanTitle: noop,
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
    focusBand: focusMode.band,
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
    focusMode.band,
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

  // Phase 5a: the four scroll-churning section-path fields, isolated into a
  // tiny memo. The active pane's bundle (`editorPaneViewPrefs`) folds these in
  // and so re-identifies on every scroll — which is fine, only the active
  // (visible) pane consumes them. Inactive keep-alive panes get the separate
  // `editorPaneViewPrefsInactive` bundle (EMPTY_SECTION_PATHS) whose identity
  // is constant across a scroll/switch, so `React.memo(EditorPane)` bails for
  // them. Consumers still read `viewPrefs.activeSectionPath` etc. unchanged.
  const editorPaneSectionPaths = useMemo<EditorPaneSectionPaths>(
    () => ({
      activeSectionPath: currentSectionPath,
      activeParTitleIndex: currentParTitleIndex,
    }),
    [
      currentSectionPath,
      currentParTitleIndex,
    ],
  );

  // Assemble the bundle through the SAME builder the Reader uses, so the two
  // surfaces share one view-state engine and the Editor/Reader delta is the
  // single named `editorMutationHandlers` set above.
  // The ACTIVE pane's bundle — folds in live section paths (Phase 5a), so it
  // re-identifies on every scroll. Only the visible pane reads it, so that
  // churn is intentional and harmless.
  const editorPaneViewPrefs: EditorPaneViewPrefs = useMemo(
    () =>
      buildEditorPaneViewPrefs(
        viewPrefsResult,
        editorMutationHandlers,
        editorPaneViewDerivations,
        editorPaneSectionPaths,
      ),
    [
      viewPrefsResult,
      editorMutationHandlers,
      editorPaneViewDerivations,
      editorPaneSectionPaths,
    ],
  );

  // The INACTIVE (hidden keep-alive) panes' bundle — identical EXCEPT it pins
  // section paths to EMPTY_SECTION_PATHS, so its identity is constant across a
  // scroll/switch (it depends only on the stable engine + derivations, NOT on
  // the churning section paths). Passing this to inactive panes keeps their
  // `viewPrefs` prop identity-stable so `React.memo(EditorPane)` bails for them
  // (Phase 5d). Hidden panes don't surface a breadcrumb/Outline highlight, so
  // empty section paths are correct for them.
  const editorPaneViewPrefsInactive: EditorPaneViewPrefs = useMemo(
    () =>
      buildEditorPaneViewPrefs(
        viewPrefsResult,
        editorMutationHandlers,
        editorPaneViewDerivations,
        EMPTY_SECTION_PATHS,
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
    if (!paraId && latestDocEffective) {
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
            const latex = serializeToLatex(latestDocEffective);
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
    // NOTE: nothing clears the active editor here. EditorPane (and the live
    // TipTap instance) stay mounted while CodeEditor opens in the right pane;
    // the derived `editorInstance` (= editorInstanceByDocId[currentDocId]) stays
    // live so the code-pane bridge can sync edits both directions.
    setPdfView(false);
    setCodeView(true);
  }, [latestDocEffective]);

  const switchToVisualView = useCallback(() => {
    // In the split-pane layout there's no longer a separate "code
    // editor handle to scrape text from" — TipTap is canonical and
    // already reflects the latest content via the bridge. We just
    // close the code pane.
    codeEditorHandleRef.current = null;
    setCodeView(false);
    setPdfView(false);
  }, []);

  // P6: a PURE view toggle — no disk read, no blob creation. The viewer renders
  // the active pane's bubbled `paneState.pdfBlobUrl`; the pane's own cold-start
  // effect seeds that from disk once when it has no in-memory bytes.
  const switchToPdfView = useCallback(() => {
    if (currentDocId) activateDocPane(currentDocId);
    setCodeView(false);
    setPdfView(true);
  }, [currentDocId, activateDocPane]);

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
    else switchToPdfView();
  }, [pdfView, switchFromPdfView, switchToPdfView]);
  const toggleCodeView = useCallback(() => {
    if (codeView) switchToVisualView();
    else switchToCodeView();
  }, [codeView, switchToVisualView, switchToCodeView]);
  const handleEditorPaneActivate = useCallback(() => {
    if (currentDocId) activateDocPane(currentDocId);
  }, [currentDocId, activateDocPane]);

  // Phase 5c: stable handler so the inline `() => setAiWindowOpen(false)` lambda
  // doesn't give every pane a fresh `onAiWindowClose` prop each render (which
  // would defeat `React.memo(EditorPane)`). Passed only to the active pane.
  const handleAiWindowClose = useCallback(() => setAiWindowOpen(false), []);

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
  // The broadcast set is FACET-DERIVED (task 239): `collabClaimsFor` emits a
  // claim for a selected card IFF `hasCollabClaims(kind)` — the exact same
  // facet the reader (`CollabCardTrailing`) gates on — so the writer set can
  // never drift from the reader gate. This deleted four dead pushes
  // (citation/todo/bib/example are `collabClaims:false`; no reader ever
  // consumed their claims) and closes the symmetric "forgot to broadcast a new
  // claim-bearing kind" hole. Scope tokens stay registry-derived via
  // `collabClaimScope` (R28/D-2), matching `getCardSelections(scope, id)`. The
  // per-slot map keys are compile-tied to `COLLAB_SELECTION_SLOT_KINDS`, so a
  // forgotten/extra slot is a type error, not a silent drift.
  useEffect(() => {
    if (!collab.enabled) return;
    collab.updateSelection(
      collabClaimsFor({
        note: selectedNoteId,
        footnote: selectedFootnoteId,
        citation: selectedCitationId,
        todo: selectedTodoId,
        archive: selectedArchiveId,
        "cutter-comment": selectedCutterCardId,
        report: selectedReportCardId,
        "revision-comment": selectedCommentId,
        bib: selectedBibKey,
        example: selectedExampleId,
      }),
    );
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

  // P6: the PDF-stale tracker that used to ride `editor.on('update')` here was
  // a DUPLICATE of EditorPane's (EditorPane.tsx:~939), which is the single
  // owner of pdfStale. It has been removed — a code-view edit round-trips
  // through the bridge into TipTap and fires EditorPane's tracker, so stale
  // detection is fully covered by the per-doc pane. (Removed from the
  // keystroke-sanctity allowlist accordingly — see AGENTS.md.)

  // The `activeSplitPane` trackers lived here (a focusin/mousedown pair that
  // marked the canonical editor as the active pane, and a reset when the split
  // closed). With one pane there is nothing to disambiguate — retired with the
  // editor split in task 115.

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


  // Virgil-bar right-cluster source: post-7.8 the bar reads per-doc
  // state from `paneState`, populated by EditorPane via
  // `onPaneStateChange`. EditorLayout's own per-doc hooks (compile,
  // ai-requests) feed dialogs and other shell-only consumers; the
  // bar's view of them comes through here.
  // useMemo so the memoized TopBar/StatusCluster can bail on a background
  // paneState tick that doesn't touch any field the bar reads. Deps are the
  // individual paneState fields (NOT the whole `paneState` object), so a warm
  // pane bumping an UNRELATED slice leaves `vbar`'s identity stable.
  //
  // The bubbled paneState slices recreate their FUNCTION refs (compilePdf,
  // switch*, addStyleMergeRequest) on each pane render — during a paper switch
  // the incoming pane re-renders ~dozens of times as its slices settle, so
  // depending on those function identities directly would rebuild `vbar` (and
  // thus re-render the whole status cluster) on every one of those ticks. Route
  // the functions through a latest-ref + stable wrappers so `vbar` changes ONLY
  // when a DISPLAY value the bar actually paints (aiDot/isCompiling/pdfStale/
  // pdfView/codeView/pdfBlobUrl/aiRequests) changes. The wrappers always invoke
  // the current pane function, so behavior is unchanged. (`paneStateRef` is
  // declared once near the `paneState` derivation above and reused here.)
  const stableCompilePdf = useCallback(() => paneStateRef.current?.compilePdf?.(), []);
  const stableSwitchToPdfView = useCallback(() => paneStateRef.current?.switchToPdfView?.(), []);
  const stableSwitchFromPdfView = useCallback(() => paneStateRef.current?.switchFromPdfView?.(), []);
  const stableSwitchToCodeView = useCallback(() => paneStateRef.current?.switchToCodeView?.(), []);
  const stableSwitchToVisualView = useCallback(() => paneStateRef.current?.switchToVisualView?.(), []);
  // Code-pane preamble commit → the ACTIVE pane's `useDocument.saveWithDelimiters`
  // (CodeEditor only renders for the active doc, so paneState is its pane's).
  const stablePersistDelimiters = useCallback(
    (d: { preamble: string; postamble: string }) =>
      paneStateRef.current?.saveWithDelimiters?.(d),
    [],
  );
  const stableAddStyleMergeRequest: NonNullable<PaneState["addStyleMergeRequest"]> =
    useCallback(
      (...args: Parameters<NonNullable<PaneState["addStyleMergeRequest"]>>) =>
        (paneStateRef.current?.addStyleMergeRequest ?? stubAddStyleMergeRequest)(
          ...args,
        ),
      [],
    );
  const vbar = useMemo(
    () => ({
      aiDot: paneState?.aiDot ?? null,
      aiRequests: paneState?.aiRequests ?? EMPTY_AI_REQUESTS,
      addStyleMergeRequest: stableAddStyleMergeRequest,
      compilePdf: stableCompilePdf,
      isCompiling: paneState?.isCompiling ?? false,
      pdfStale: paneState?.pdfStale ?? false,
      pdfBlobUrl: paneState?.pdfBlobUrl ?? null,
      pdfView: paneState?.pdfView ?? false,
      codeView: paneState?.codeView ?? false,
      switchToPdfView: stableSwitchToPdfView,
      switchFromPdfView: stableSwitchFromPdfView,
      switchToCodeView: stableSwitchToCodeView,
      switchToVisualView: stableSwitchToVisualView,
    }),
    [
      paneState?.aiDot,
      paneState?.aiRequests,
      paneState?.isCompiling,
      paneState?.pdfStale,
      paneState?.pdfBlobUrl,
      paneState?.pdfView,
      paneState?.codeView,
      stableAddStyleMergeRequest,
      stableCompilePdf,
      stableSwitchToPdfView,
      stableSwitchFromPdfView,
      stableSwitchToCodeView,
      stableSwitchToVisualView,
    ],
  );

  // The status cluster paints only these four vbar fields. Isolating them keeps
  // the cluster from re-rendering on aiRequests / pdfBlobUrl / pdfView / codeView
  // churn (those are consumed by the PDF view / AI window, not the cluster).
  const statusVbar = useMemo(
    () => ({
      aiDot: vbar.aiDot,
      compilePdf: vbar.compilePdf,
      isCompiling: vbar.isCompiling,
      pdfStale: vbar.pdfStale,
    }),
    [vbar.aiDot, vbar.compilePdf, vbar.isCompiling, vbar.pdfStale],
  );

  // ── Stable callbacks for the extracted, memoized TopBar ──────────────────
  // The per-tab call-site arrows (onClick={() => activateDocPane(doc.id)})
  // have been pushed INTO the leaf components, which now receive the live id +
  // the already-useCallback-stable handler. These wrappers cover the few
  // remaining inline arrows so the memoized children can bail on a paneState
  // tick.
  const onCreateNewTab = useCallback(() => {
    setNewDocModal({ mode: "fresh" });
  }, []);
  const onResyncSkills = useCallback(() => {
    void resyncSkills();
  }, [resyncSkills]);

  // useMemo so the array isn't a fresh identity each render (TabPlusMenu deps).
  const openTabIds = useMemo(() => openTabs.map((t) => t.id), [openTabs]);

  // Grouped, referentially-stable props for the two memoized bar regions. Each
  // group's identity changes only when one of its constituent inputs does, so a
  // background paneState tick (which leaves all of these stable) no longer
  // re-renders the tab strip or the status cluster.
  const tabStripProps: TabStripProps = useMemo(
    () => ({
      docs,
      openTabIds,
      outerOrder,
      activePane,
      currentDocId,
      currentLibraryOuterId,
      currentPaperCitekey,
      libraryRegistry,
      devStorage,
      editingTabId,
      setEditingTabId,
      nameInput,
      setNameInput,
      nameInputRef,
      tabStripRef,
      outerTabRefs,
      paperDropIndex,
      setPaperDropIndex,
      entryDropOuterLibId,
      setEntryDropOuterLibId,
      onActivateDoc: activateDocPane,
      onCloseDoc: closeTab,
      onActivatePaper: activatePaperPane,
      onClosePaper: closePaperTab,
      onActivateLibraryOuter: activateLibraryOuterPane,
      onCloseLibraryOuter: closeLibraryOuterTab,
      onRenameDoc: renameFile,
      openPaperTab,
      openLibraryOuterTab,
      onOpenRecent: openFile,
      onOpenFolder: handleNativeOpen,
      onCreateNew: onCreateNewTab,
      onOpenExample: openExample,
      onResetExample: resetExampleDoc,
      onOpenNewWindow: openNewVirgilWindow,
      exampleAvailable,
    }),
    [
      docs,
      openTabIds,
      outerOrder,
      activePane,
      currentDocId,
      currentLibraryOuterId,
      currentPaperCitekey,
      libraryRegistry,
      devStorage,
      editingTabId,
      setEditingTabId,
      nameInput,
      setNameInput,
      paperDropIndex,
      setPaperDropIndex,
      entryDropOuterLibId,
      setEntryDropOuterLibId,
      activateDocPane,
      closeTab,
      activatePaperPane,
      closePaperTab,
      activateLibraryOuterPane,
      closeLibraryOuterTab,
      renameFile,
      openPaperTab,
      openLibraryOuterTab,
      openFile,
      handleNativeOpen,
      onCreateNewTab,
      openExample,
      resetExampleDoc,
      openNewVirgilWindow,
      exampleAvailable,
    ],
  );

  const statusClusterProps: StatusClusterProps = useMemo(
    () => ({
      vbar: statusVbar,
      collabEnabled: collab.enabled,
      zenModeOn,
      topbarRightCollapsed: prefs.topbarRightCollapsed,
      setTopbarRightCollapsed,
      updateAvailable,
      hasDoc: !!currentDoc,
      skillSyncError,
      skillSyncNotice,
      onResyncSkills,
      onDismissSkillSyncError: dismissSkillSyncError,
      onDismissSkillSyncNotice: dismissSkillSyncNotice,
      externalChangeActive,
      setExternalChangeActive,
      focusActive: focusMode.state.active,
      onFocusDeactivate: focusMode.deactivate,
      helperOn: helperMode.on,
      onHelperToggle: helperMode.toggle,
      onEnableCollab,
      onEditIdentity,
      onDisableCollab: handleDisableCollab,
      onToggleZen: handleToggleZen,
      preferencesOpen,
      setPreferencesOpen,
      appVersion: APP_VERSION,
      helperBtnRef,
      helperMenuOpen,
      setHelperMenuOpen,
      helperPositionRef,
      helperPositionStyle,
      commandsPopoutOpen,
      setCommandsPopoutOpen,
      onInsertVirgilCommand: insertVirgilCommand,
      currentDocId,
      codeView,
      pdfView,
      printOpen,
      setPrintOpen,
      aiWindowOpen,
      setAiWindowOpen,
      manageStylesOpen,
      setManageStylesOpen,
      onToggleCodeView: toggleCodeView,
      onTogglePdfView: togglePdfView,
    }),
    [
      statusVbar,
      collab.enabled,
      zenModeOn,
      prefs.topbarRightCollapsed,
      setTopbarRightCollapsed,
      updateAvailable,
      currentDoc,
      skillSyncError,
      skillSyncNotice,
      onResyncSkills,
      dismissSkillSyncError,
      dismissSkillSyncNotice,
      externalChangeActive,
      setExternalChangeActive,
      focusMode.state.active,
      focusMode.deactivate,
      helperMode.on,
      helperMode.toggle,
      onEnableCollab,
      onEditIdentity,
      handleDisableCollab,
      handleToggleZen,
      preferencesOpen,
      helperBtnRef,
      helperMenuOpen,
      helperPositionRef,
      helperPositionStyle,
      commandsPopoutOpen,
      insertVirgilCommand,
      currentDocId,
      codeView,
      pdfView,
      printOpen,
      aiWindowOpen,
      manageStylesOpen,
      toggleCodeView,
      togglePdfView,
    ],
  );

  // Loading
  if (filesLoading) {
    return <LoadingScreen className="h-screen" />;
  }

  // Search range highlight takes priority — skip text-based highlight when active
  const highlightText = searchHighlightRange
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
  // Error badge count — read from the per-doc owner (EditorPane) via paneState.
  const errorCount = paneState?.latexErrors.length ?? 0;
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


  return (
    <EditorLayoutProvider
      state={{ prefs }}
      actions={{ togglePanel, movePanel }}
    >
    <EditorRefProvider value={{ editorInstance, editorRef, setOverrideEditor }}>
    <AiRequestsProvider value={{ aiRequests, addAiRequest, updateAiRequestText, deleteAiRequest }}>
    <CitationDisplayProvider value={{ getCitationDisplayText, onCitationCreated: handleCitationCreated, getRefDisplayText }}>
    {/* SelectionsProvider derives the 9 anchored slots from the cardStore;
        we only thread the bib slot in through `value` because bib isn't
        an anchored kind. The other 9 props on the legacy value shape are
        ignored by the provider. This SHELL mount sits above the per-doc
        CardStoreProvider, so it's handed the ACTIVE doc's store explicitly
        (`store={activeCardStore}`) — its only consumer is the shell
        RecentlyAddedAutoClear; the per-pane mount in EditorPane omits the prop
        and uses context. */}
    <SelectionsProvider value={{ selectedBibKey, setSelectedBibKey }} store={activeCardStore}>
    <RecentlyAddedProvider value={recentlyAdded}>
    <RecentlyAddedAutoClear />
    <CollabProvider value={collab}>
    {/* DiskWatcherProviderGate wraps the WHOLE layout (topbar + panes) so both
        the topbar status-cluster badge slot and EditorPane's useDocument call
        site are descendants of the per-doc external-change watcher. It self-
        gates on currentDocId (no provider when no doc is open). */}
    <DiskWatcherProviderGate docId={currentDocId} liveDocIds={keepAliveDocIds}>
    <div className="flex flex-col h-screen bg-[var(--background)]">
      {/* Top bar: logo + tabs + right-side status/action cluster.
          Extracted into the memoized <TopBar> (with its memoized <TabStrip>
          and <StatusCluster> children) so background paneState ticks no
          longer re-execute the whole bar JSX tree. All invariants
          (data-prefs/data-bar-h attrs, zen gating, the tab strip ref +
          drag/drop, the MenuBar docking sentinel) live inside those
          components verbatim. */}
      <TopBar
        zenModeOn={zenModeOn}
        tabStrip={tabStripProps}
        statusCluster={statusClusterProps}
      />

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

      {/* ── Multi-doc keep-alive ─────────────────────────────────────────────
          The last N authored docs (DOC_KEEP_ALIVE_CAPACITY) stay mounted, one
          visible and the rest display:none, so switching among already-opened
          papers is an instant visibility flip — no cold remount, no "Loading…",
          cursor/scroll/content preserved by the warm mount. Each slot is its own
          `<DocPipeline key={slotDocId}>`: the autosave wall holds PER SLOT because
          every mounted pane's docId is its fixed React key, so no instance's
          docId ever mutates underneath it (the cross-doc save bug can't recur).
          KeepAliveSlot publishes the visibility context the §2 measurement
          followers read to go INERT while hidden (keystroke sanctity).

          MEMBERSHIP = the LRU order ∩ openTabs. `grantedActiveDocId` keeps an
          ungranted active doc OUT of the set, so the editor never mounts before
          its folder is granted (its hooks read disk on mount → NotAllowedError);
          the standalone DocPermissionGate above shows alone until the user grants,
          then the doc joins the set and mounts fresh. Filtering on `openTabs`
          unmounts a closed tab promptly (→ DocPipeline cleanup flush +
          pruneDocMaps). A just-closed id can briefly linger in the LRU order
          (render-filtered out, harmless); we intentionally don't extend the shared
          primitive to prune it in v1. */}
      {renderedKeepAliveEntries.map((entry) => {
          const slotDocId = entry.id;
          const isActive = slotDocId === currentDocId;
          return (
            <DocKeepAliveSlot
              key={slotDocId}
              slotDocId={slotDocId}
              isVisible={isActive && activePane === "doc" && !pdfView}
              onUnmount={pruneDocMaps}
            >
              <div data-virgil-row-scroll className="flex flex-1 min-h-0 overflow-x-auto overflow-y-auto">
                <DocPipeline key={slotDocId} docId={slotDocId}>
                  <SplitWithCode
                    open={isActive && codeView}
                    ratio={prefs.codePaneRatio}
                    onRatioChange={setCodePaneRatio}
                    onMoveCodeToText={() =>
                      codeEditorHandleRef.current?.moveCodeToTextCursor()
                    }
                    onMoveTextToCode={() =>
                      codeEditorHandleRef.current?.moveTextToCodeCursor()
                    }
                    left={
                      <EditorChromeProvider value={FULL_CHROME}>
                        <EditorPane
                          ref={isActive ? editorRef : undefined}
                          docId={slotDocId}
                          editable={isActive ? collab.canEditMainText : false}
                          chrome={FULL_CHROME}
                          onUpdate={isActive ? handleUpdate : undefined}
                          onEditorReady={getOnEditorReady(slotDocId)}
                          onActivate={
                            isActive ? handleEditorPaneActivate : undefined
                          }
                          onPaneStateChange={getOnPaneStateChange(slotDocId)}
                          pdfView={isActive && pdfView}
                          onTogglePdfView={isActive ? togglePdfView : undefined}
                          codeView={isActive && codeView}
                          onToggleCodeView={isActive ? toggleCodeView : undefined}
                          placements={prefs.placements}
                          viewPrefs={
                            isActive
                              ? editorPaneViewPrefs
                              : editorPaneViewPrefsInactive
                          }
                          menuBar={isActive ? editorPaneMenuBar : undefined}
                          aiWindowOpen={isActive && aiWindowOpen}
                          onAiWindowClose={
                            isActive ? handleAiWindowClose : undefined
                          }
                          highlightText={isActive ? highlightText : undefined}
                          onDocumentClassMismatch={promptDocClassMismatch}
                        />
                      </EditorChromeProvider>
                    }
                    right={
                      isActive && codeView && editorInstance ? (
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
                            docId={slotDocId}
                            editor={editorInstance}
                            initialLine={codeViewLine}
                            initialParagraphId={codeViewParagraphId}
                            onReady={(handle) => {
                              codeEditorHandleRef.current = handle;
                            }}
                            onTextChange={handleCodeEditorTextChange}
                            persistDelimiters={stablePersistDelimiters}
                            compileLog={paneState?.compileLog ?? null}
                            compileStatus={paneState?.compileStatus ?? null}
                            isCompiling={paneState?.isCompiling ?? false}
                            bibFamily={asBibFamily(citationsHook.bibPackage)}
                            onBibFamilyConflict={handleBibFamilyConflict}
                          />
                          {errorsSidebarOpen ? (
                            <div className="w-[260px] shrink-0 border-l border-edge-subtle bg-surface flex flex-col h-full relative">
                              <button
                                type="button"
                                onClick={() => setErrorsSidebarOpen(false)}
                                className="absolute top-2 right-2 z-10 w-5 h-5 flex items-center justify-center rounded text-ink-muted hover:text-ink-body hover-on-light text-sm leading-none focus-ring"
                                {...iconHint({ label: "Hide errors panel" })}
                              >
                                ×
                              </button>
                              <ErrorsHost
                                errors={paneState?.latexErrors ?? EMPTY_LATEX_ERRORS_L}
                                selectedId={paneState?.selectedErrorId ?? null}
                                onSelect={setSelectedErrorIdBridge}
                                dismissedIds={paneState?.dismissedErrorIds ?? EMPTY_ERR_SET}
                                onDismiss={paneState?.dismissError ?? noop}
                                jump={codeErrorJump}
                                snippets={paneState?.errorSnippets ?? EMPTY_ERR_MAP}
                                paragraphByErrorId={paneState?.paragraphByErrorId ?? EMPTY_ERR_MAP}
                                expandedIds={paneState?.expandedErrorIds ?? EMPTY_ERR_SET}
                                onExpand={paneState?.expandError ?? noop}
                                onToggleExpanded={paneState?.toggleErrorExpanded ?? noop}
                              />
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setErrorsSidebarOpen(true)}
                              className="w-7 shrink-0 border-l border-edge-subtle bg-surface flex items-start justify-center pt-3 hover-on-light relative text-ink-muted hover:text-ink-body"
                              data-hint={`Show errors (${errorCount})`}
                              aria-label="Show errors panel"
                            >
                              <IconErrors active={false} />
                              {errorCount > 0 && (
                                <span
                                  className="absolute top-1 right-1 min-w-[14px] h-[14px] px-1 rounded-full text-[9px] leading-[14px] tabular-nums text-white text-center"
                                  style={{ backgroundColor: "var(--danger)" }}
                                >
                                  {errorCount > 99 ? "99+" : errorCount}
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
            </DocKeepAliveSlot>
          );
        })}

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
        <FramedViewerSurface
          backdrop="dark"
          paddingBottom={zenModeOn ? 4 : 'var(--pod-gap)'}
        >
          {/* P6: the viewer reads the active pane's bubbled PDF state — the
              single source of truth. `pdfBlobUrl` is the fresh-compile blob OR
              the pane's cold-start disk seed; `pdfStale` is owned solely by the
              pane's edit-vs-compile tracker (now a live value, not dead code). */}
          {paneState?.pdfBlobUrl ? (
            <iframe
              src={paneState.pdfBlobUrl}
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
          {paneState?.pdfStale && paneState?.pdfBlobUrl && (
            <div className="absolute top-3 right-3 bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded shadow flex items-center gap-1.5 z-10">
              {/* Deliberately still a hand-rolled dot (task 315), and the
                  reasoning is recorded in status-dot-ssot.test.ts's allowlist:
                  this is the SAME signal StatusCluster's pdf-stale dot paints,
                  but from a different family — that dot reads
                  `var(--status-warn)` (#eab308) while this one is Tailwind v4's
                  `yellow-500` (oklch 79.5% 0.184 86.047 ≈ #f0b100), which its
                  own chip's `bg-yellow-100`/`text-yellow-800` are on the ramp
                  of. The two already differ. Converting the dot alone would
                  repaint it AND strand it off its chip's ramp, so which family
                  wins is a colour decision, not a cleanup. */}
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 inline-block" />
              PDF is out of date
            </div>
          )}
        </FramedViewerSurface>
      ) : currentDocId ? null : (
        <div className="flex flex-1 items-center justify-center bg-[var(--background)]">
          <div className="flex flex-col items-center gap-6 px-6 py-8 w-full max-w-xl">
            {docs.length > 0 ? (
              <RecentPapersList docs={docs} onOpen={openFile} />
            ) : (
              <div className="text-ink-subtle text-sm">No document open</div>
            )}
            {/* Action lozenges spanning the recents-column width: three
                equal-width (flex-1) buttons, each EXACTLY two lines tall via an
                explicit label break, all the same `secondary` variant so none
                reads as a mismatched primary. Order: open existing → create new
                → example. */}
            <div className="flex w-full items-stretch gap-2.5">
              {!devStorage && (
                <Button
                  variant="secondary"
                  onClick={openExistingFile}
                  className="flex-1 basis-0 min-w-0 !h-auto min-h-[3.25rem] py-2.5 gap-2.5"
                >
                  <svg width="18" height="18" className="shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
                  </svg>
                  <span className="flex flex-col text-left leading-snug whitespace-nowrap">
                    <span>Open existing</span>
                    <span>folder</span>
                  </span>
                </Button>
              )}
              <Button
                variant="secondary"
                onClick={() => setNewDocModal({ mode: "fresh" })}
                className="flex-1 basis-0 min-w-0 !h-auto min-h-[3.25rem] py-2.5 gap-2.5"
              >
                <svg width="18" height="18" className="shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span className="flex flex-col text-left leading-snug whitespace-nowrap">
                  <span>Create new</span>
                  <span>document</span>
                </span>
              </Button>
              {exampleAvailable && (
                <Button
                  variant="secondary"
                  onClick={() => void openExample()}
                  className="flex-1 basis-0 min-w-0 !h-auto min-h-[3.25rem] py-2.5 gap-2.5"
                >
                  <svg width="18" height="18" className="shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 3h8l4 4v12.5A1.5 1.5 0 0 1 16.5 21h-9A1.5 1.5 0 0 1 6 19.5z" />
                    <path d="M14 3v4h4" />
                  </svg>
                  <span className="flex flex-col text-left leading-snug whitespace-nowrap">
                    <span>Open example</span>
                    <span>document</span>
                  </span>
                </Button>
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
        marginaliaLive={prefs.showMarginalia}
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
          onCommit={(keys) =>
            commitCitationCreate(
              atomCreateRequest.pos,
              keys,
              atomCreateRequest.editor,
            )
          }
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
            handleInsertRef(label, cmd, atomCreateRequest.pos, atomCreateRequest.editor)
          }
          onClose={() => setAtomCreateRequest(null)}
        />
      )}
      {activeMath && (
        <NodeEditPopover
          family="math"
          kind={activeMath.kind}
          value={activeMath.latex}
          anchorRect={activeMath.rect}
          onSave={(newLatex) => handleMathSave(activeMath.editor, activeMath.pos, newLatex)}
          onClose={() => setActiveMath(null)}
        />
      )}
      {activeFigure && (
        <NodeEditPopover
          family="figure"
          kind={activeFigure.kind}
          value={activeFigure.raw}
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
