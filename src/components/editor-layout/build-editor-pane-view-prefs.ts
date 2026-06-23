/**
 * Shared builder for the `EditorPaneViewPrefs` bundle passed to
 * `<EditorPane viewPrefs={…} />`.
 *
 * BOTH the main app (`EditorLayout`) and the Library Reader
 * (`useReaderViewPrefs`) assemble that bundle from the SAME view-state
 * engine — the real `useViewPrefs` hook — so there is exactly one
 * implementation of panel docking, margins, popouts, and omni toggles.
 *
 * The only legitimate Editor/Reader delta is a single NAMED, type-checked
 * set of editor-mutation handlers (`EditorMutationHandlers`): the genuinely
 * editor-only callbacks (orphan edit/delete, block reorder, heading/par
 * rename, label update, focus-mode, the zen-margin setters, and the
 * EditorLayout-supplied `onScrollToHeading`). Routing these through a named
 * type makes "a Reader control is secretly a no-op" a COMPILE error (a
 * missing handler) rather than a silently-dead control.
 *
 * This is a PURE function — no hooks, no side effects — so it is safe to
 * call inside a `useMemo` (main app) or a thin wrapper hook (Reader).
 */
import type { EditorPaneViewPrefs } from "@/components/EditorPane";
import type {
  PanelId,
  Side,
  UseViewPrefsResult,
} from "@/hooks/useViewPrefs";
import type { OmniCategory } from "@/panels/Omni/OmniViewPanel";
import type { FocusState } from "@/hooks/useFocusMode";
import type { SectionPathEntry } from "@/panels/Outline";
import type { OrphanedFootnote } from "@/lib/types";

/**
 * The editor-only mutation handlers — the single legitimate delta between
 * the main app and the Reader. In the main app these are EditorLayout's real
 * handlers; in the Reader most are no-ops (read-only doc) EXCEPT
 * `onScrollToHeading` (Outline click-to-scroll stays live). The Reader's
 * `READER_EDITOR_HANDLERS` must satisfy this type in full, so adding a new
 * editor mutation forces the Reader to make an explicit no-op-vs-real choice.
 */
export interface EditorMutationHandlers {
  // Orphaned-footnote editing (the panel's per-card edit/delete affordances).
  orphanedFootnotes: OrphanedFootnote[];
  onEditOrphan: (id: string, newContent: unknown) => void;
  onDeleteOrphan: (id: string) => void;
  onEditOrphanTitle: (id: string, title: string) => void;

  // Outline navigation. `onScrollToHeading` is navigation, not a doc
  // mutation, but it's EditorLayout-supplied (it needs the live editor +
  // section model), so it lives with the editor handlers — and the Reader
  // ports a REAL implementation here, not a no-op.
  onScrollToHeading: (blockIndex: number) => void;

  // Structural edits driven from the Outline panel.
  onReorderBlocks: (fromIndex: number, count: number, toIndex: number) => void;
  onRenameHeading: (uuid: string, newText: string) => void;
  onRenameParTitle: (uuid: string, newTitle: string) => void;
  onUpdateLabel: (uuid: string, newLabel: string | null) => void;
  isLabelTaken: (candidate: string, excludeLabel: string | null) => boolean;

  // Focus-mode (outline band) controls.
  onFocusActivate: () => void;
  onFocusDeactivate: () => void;
  onFocusToggleLock: () => void;
  onFocusMoveTo: (blockIndex: number) => void;
  onFocusExpandTo: (blockIndex: number) => void;
  onFocusSnapBoundary: (edge: "top" | "bottom", blockIndex: number) => void;

  // Float focus management (raise-on-click).
  focusFloating: EditorPaneViewPrefs["focusFloating"];

  // Panel-resize chrome lifecycle.
  setIsResizingPanels: (r: boolean) => void;
  syncPanelPrefsToRendered: () => void;

  // Zen-mode margins (EditorLayout owns the zen reducer).
  setZenLeftMargin: (px: number) => void;
  setZenRightMargin: (px: number) => void;

  // Per-card archive view + atom-archive-warning suppression. Real `vp`
  // setters exist, but they're editor-mutation-shaped (they change how cards
  // are surfaced / written), so the Reader scopes them to no-ops.
  setCardArchiveView: EditorPaneViewPrefs["setCardArchiveView"];
  setSuppressArchiveAtomWarning: (v: boolean) => void;
}

/**
 * The view-derived values EditorLayout (or the Reader) computes outside the
 * `useViewPrefs` hook — section paths, focus state, zen geometry, omni
 * read-helpers, category-side map, and the optional float z-index painter.
 * Everything else in `EditorPaneViewPrefs` is read verbatim off `vp`.
 */
export interface EditorPaneViewDerivations {
  isResizingPanels: boolean;
  focusState: FocusState | null;
  activeSectionPath: SectionPathEntry[];
  activeParTitleIndex: number | null;
  mirrorSectionPath: SectionPathEntry[];
  mirrorParTitleIndex: number | null;
  zenMode: boolean;
  zenLeftMargin: number;
  zenRightMargin: number;
  getOmniEnabled: (side: Side) => Set<OmniCategory>;
  getOmniHideAll: (side: Side) => boolean;
  setOmniSideToDefault: (side: Side) => void;
  categorySides: Record<OmniCategory, Side>;
  /** Lockstep-remap a card popout key. EditorLayout supplies its own (the
   *  Reader supplies a session-only equivalent), so it rides the view bag
   *  rather than `vp` to keep both producers explicit. */
  remapCardPopKey: (oldKey: string, newKey: string) => void;
  /** Optional — only the main app paints float z-index from its MRU focus
   *  stack; the Reader omits it. */
  cardFloatZIndex?: (key: string) => number;
}

/**
 * Assemble the `EditorPaneViewPrefs` bundle from the three sources. Pure:
 * the result is a plain object; the caller memoizes it.
 *
 * - `vp`: the live `useViewPrefs(...)` result — owns prefs + every layout
 *   setter (dock stack, margins, popouts, omni toggles, widths, bib filter).
 * - `editorHandlers`: the named editor-only delta.
 * - `view`: the EditorLayout/Reader-computed view derivations.
 */
export function buildEditorPaneViewPrefs(
  vp: UseViewPrefsResult,
  editorHandlers: EditorMutationHandlers,
  view: EditorPaneViewDerivations,
): EditorPaneViewPrefs {
  return {
    // ── Read state ──────────────────────────────────────────────────
    prefs: vp.prefs,
    isResizingPanels: view.isResizingPanels,
    focusState: view.focusState,

    // ── Section path (OutlineHost) ──────────────────────────────────
    activeSectionPath: view.activeSectionPath,
    activeParTitleIndex: view.activeParTitleIndex,
    mirrorSectionPath: view.mirrorSectionPath,
    mirrorParTitleIndex: view.mirrorParTitleIndex,

    // ── Layout setters / mutators (verbatim from the engine) ────────
    setIsResizingPanels: editorHandlers.setIsResizingPanels,
    syncPanelPrefsToRendered: editorHandlers.syncPanelPrefsToRendered,
    getPanelWidth: vp.getPanelWidth,
    setPanelWidth: vp.setPanelWidth,
    setPanelHeight: vp.setPanelHeight,
    clearPanelHeight: vp.clearPanelHeight,
    tradePanelHeights: vp.tradePanelHeights,
    notePanelUse: vp.notePanelUse,
    setEditorLeftMargin: vp.setEditorLeftMargin,
    setEditorRightMargin: vp.setEditorRightMargin,
    setEditorTopMargin: vp.setEditorTopMargin,
    setEditorBottomMargin: vp.setEditorBottomMargin,

    // ── Zen mode ────────────────────────────────────────────────────
    zenMode: view.zenMode,
    zenLeftMargin: view.zenLeftMargin,
    zenRightMargin: view.zenRightMargin,
    setZenLeftMargin: editorHandlers.setZenLeftMargin,
    setZenRightMargin: editorHandlers.setZenRightMargin,

    // ── Panel open/close/move (verbatim) ────────────────────────────
    setActiveLeft: vp.setActiveLeft,
    setActiveRight: vp.setActiveRight,
    togglePanel: vp.togglePanel,
    movePanel: vp.movePanel,
    closePopout: vp.closePopout,
    setFloatPosition: vp.setFloatPosition,
    undockPanel: vp.undockPanel,
    redockPanel: vp.redockPanel,

    // ── Card popout (verbatim, plus the view-supplied remap) ────────
    toggleCardPopout: vp.toggleCardPopout,
    closeCardPopout: vp.closeCardPopout,
    setCardFloatPosition: vp.setCardFloatPosition,
    remapCardPopKey: view.remapCardPopKey,

    // ── OmniHost helpers ────────────────────────────────────────────
    getOmniEnabled: view.getOmniEnabled,
    getOmniHideAll: view.getOmniHideAll,
    toggleOmniHideAllCards: vp.toggleOmniHideAllCards,

    // ── Card archive view + bib filter ──────────────────────────────
    setCardArchiveView: editorHandlers.setCardArchiveView,
    setSuppressArchiveAtomWarning: editorHandlers.setSuppressArchiveAtomWarning,
    setBibFilter: vp.setBibFilter,

    // ── Orphaned footnotes + editor-only handlers ───────────────────
    orphanedFootnotes: editorHandlers.orphanedFootnotes,
    onEditOrphan: editorHandlers.onEditOrphan,
    onDeleteOrphan: editorHandlers.onDeleteOrphan,
    onEditOrphanTitle: editorHandlers.onEditOrphanTitle,

    // ── OutlineHost handlers ────────────────────────────────────────
    onScrollToHeading: editorHandlers.onScrollToHeading,
    onReorderBlocks: editorHandlers.onReorderBlocks,
    onRenameHeading: editorHandlers.onRenameHeading,
    onRenameParTitle: editorHandlers.onRenameParTitle,
    onUpdateLabel: editorHandlers.onUpdateLabel,
    isLabelTaken: editorHandlers.isLabelTaken,
    onFocusActivate: editorHandlers.onFocusActivate,
    onFocusDeactivate: editorHandlers.onFocusDeactivate,
    onFocusToggleLock: editorHandlers.onFocusToggleLock,
    onFocusMoveTo: editorHandlers.onFocusMoveTo,
    onFocusExpandTo: editorHandlers.onFocusExpandTo,
    onFocusSnapBoundary: editorHandlers.onFocusSnapBoundary,

    // ── Float focus management ──────────────────────────────────────
    focusFloating: editorHandlers.focusFloating,
    cardFloatZIndex: view.cardFloatZIndex,

    // ── Icon strip ──────────────────────────────────────────────────
    collapseLeft: vp.collapseLeft,
    collapseRight: vp.collapseRight,
    expandLeft: vp.expandLeft,
    expandRight: vp.expandRight,
    setBlank: vp.setBlank,
    clearBlankIfSet: vp.clearBlankIfSet,
    openPanelDocked: vp.openPanelDocked,
    toggleOmniCategory: vp.toggleOmniCategory,
    setOmniSideToDefault: view.setOmniSideToDefault,
    categorySides: view.categorySides,
  };
}

// Re-export PanelId/Side for the Reader's convenience (it builds handlers
// typed in these terms and importing from one place keeps it tidy).
export type { PanelId, Side };
