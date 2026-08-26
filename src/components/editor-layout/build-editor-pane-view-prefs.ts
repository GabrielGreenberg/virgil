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
import type { FocusBand } from "@/lib/focus-view";
import type { BlockAddress, BlockSpanAddress } from "@/lib/tiptap/block-address";
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
  // NOTE (Phase 5b): the orphan ARRAY no longer lives here — it was a per-doc
  // shell `useState` whose churn busted the shared `viewPrefs` bundle on a
  // paper switch. It now flows as EditorPane's dedicated `orphanedFootnotes`
  // prop (gated per active pane). The edit/delete handlers remain.
  onEditOrphan: (id: string, newContent: unknown) => void;
  onDeleteOrphan: (id: string) => void;
  onEditOrphanTitle: (id: string, title: string) => void;

  // Outline navigation. `onScrollToHeading` is navigation, not a doc
  // mutation, but it's EditorLayout-supplied (it needs the live editor +
  // section model), so it lives with the editor handlers — and the Reader
  // ports a REAL implementation here, not a no-op.
  // Task 285: the target is a durable block address (`null` = document start),
  // never a snapshot index.
  onScrollToHeading: (target: BlockAddress | null) => void;

  // Structural edits driven from the Outline panel.
  onReorderBlocks: (
    source: BlockSpanAddress,
    target: BlockSpanAddress,
    side: "above" | "below",
  ) => void;
  onRenameHeading: (uuid: string, newText: string) => void;
  onRenameParTitle: (uuid: string, newTitle: string) => void;
  onUpdateLabel: (uuid: string, newLabel: string | null) => void;
  isLabelTaken: (candidate: string, excludeLabel: string | null) => boolean;

  // Focus-mode (outline band) controls.
  onFocusActivate: () => void;
  onFocusDeactivate: () => void;
  onFocusToggleLock: () => void;
  onFocusMoveTo: (target: BlockAddress) => void;
  onFocusExpandTo: (target: BlockAddress) => void;
  onFocusSnapBoundary: (edge: "top" | "bottom", target: BlockAddress) => void;

  // Float focus management (raise-on-click).
  focusFloating: EditorPaneViewPrefs["focusFloating"];

  // Panel-resize chrome lifecycle.
  setIsResizingPanels: (r: boolean) => void;
  syncPanelPrefsToRendered: () => void;

  // Zen-mode margins (EditorLayout owns the zen reducer).
  setZenLeftMargin: (px: number) => void;
  setZenRightMargin: (px: number) => void;

  // Per-card archive view. A real `vp` setter exists, but it is
  // editor-mutation-shaped (it changes how cards are surfaced / written), so
  // the Reader scopes it to a no-op.
  setCardArchiveView: EditorPaneViewPrefs["setCardArchiveView"];
}

/**
 * The four section-path fields, split OUT of `EditorPaneViewDerivations`
 * (Phase 5a). These churn on every scroll/switch (the breadcrumb + Outline
 * active-line follow the cursor), so bundling them with the otherwise-stable
 * zen/omni derivations would give `editorPaneViewDerivations` — and therefore
 * the whole `viewPrefs` prop — a fresh identity on every scroll, silently
 * defeating `React.memo(EditorPane)`. They are merged back into the bundle by
 * `buildEditorPaneViewPrefs` as a 4th argument so the EditorPane consumers
 * (OutlineHost reading `viewPrefs.activeSectionPath`, SectionLozenge) are
 * UNCHANGED — only the churn is isolated to a tiny separate memo.
 */
export interface EditorPaneSectionPaths {
  activeSectionPath: SectionPathEntry[];
  activeParTitleIndex: number | null;
}

/** Stable empty section-paths — for inactive keep-alive panes (their bundle
 *  must keep a constant identity so the memo bails) and the Reader. A frozen
 *  module constant so its identity never changes across renders. */
export const EMPTY_SECTION_PATHS: EditorPaneSectionPaths = Object.freeze({
  activeSectionPath: Object.freeze([]) as unknown as SectionPathEntry[],
  activeParTitleIndex: null,
});

/** Stable empty orphaned-footnote list — the builder's default (Phase 5b) and
 *  the inactive-pane value EditorLayout passes for the dedicated
 *  `orphanedFootnotes` prop, so hidden panes keep a constant prop identity. */
export const EMPTY_ORPHANED_FOOTNOTES: OrphanedFootnote[] = Object.freeze(
  [],
) as unknown as OrphanedFootnote[];

/**
 * The view-derived values EditorLayout (or the Reader) computes outside the
 * `useViewPrefs` hook — focus state, zen geometry, omni read-helpers,
 * category-side map, and the optional float z-index painter. (Section paths
 * are split out into `EditorPaneSectionPaths` — Phase 5a.) Everything else in
 * `EditorPaneViewPrefs` is read verbatim off `vp`.
 */
export interface EditorPaneViewDerivations {
  isResizingPanels: boolean;
  /** Index projection consumed by the OmniHost fold/focus filter (resolved
   *  live against the doc). */
  focusState: FocusState | null;
  /** UUID-anchored band consumed by the OutlineHost, which resolves it to
   *  indices against its own snapshot (task 307). */
  focusBand: FocusBand | null;
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
 * Assemble the `EditorPaneViewPrefs` bundle from the four sources. Pure:
 * the result is a plain object; the caller memoizes it.
 *
 * - `vp`: the live `useViewPrefs(...)` result — owns prefs + every layout
 *   setter (dock stack, margins, popouts, omni toggles, widths, bib filter).
 * - `editorHandlers`: the named editor-only delta.
 * - `view`: the EditorLayout/Reader-computed view derivations (stable across
 *   a scroll/switch).
 * - `sectionPaths`: the four scroll-churning section-path fields (Phase 5a),
 *   split out so the caller can pass `EMPTY_SECTION_PATHS` for inactive panes
 *   and keep their bundle identity-stable.
 *
 * NOTE: `orphanedFootnotes` is NOT set here (Phase 5b) — it is injected by
 * EditorPane itself from its dedicated `orphanedFootnotes` prop (so the
 * per-doc orphan churn no longer busts the shared bundle). The builder leaves
 * it as the stable empty array; EditorPane's `effectiveViewPrefs` overwrites
 * it (the Reader has none, so the empty default is correct there).
 */
export function buildEditorPaneViewPrefs(
  vp: UseViewPrefsResult,
  editorHandlers: EditorMutationHandlers,
  view: EditorPaneViewDerivations,
  sectionPaths: EditorPaneSectionPaths,
): EditorPaneViewPrefs {
  return {
    // ── Read state ──────────────────────────────────────────────────
    prefs: vp.prefs,
    isResizingPanels: view.isResizingPanels,
    focusState: view.focusState,
    focusBand: view.focusBand,

    // ── Section path (OutlineHost) — Phase 5a: from the split arg ────
    activeSectionPath: sectionPaths.activeSectionPath,
    activeParTitleIndex: sectionPaths.activeParTitleIndex,

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
    // The one registry-driven pref writer this bundle carries (task 274) — the
    // Bibliography filter is written as `setViewPref("bibFilter", v)`.
    setViewPref: vp.setViewPref,

    // ── Orphaned footnotes + editor-only handlers ───────────────────
    // Phase 5b: the orphan ARRAY is no longer sourced from `editorHandlers`
    // (it was a per-doc shell `useState` that busted the shared bundle on a
    // switch). EditorPane injects the real list from its dedicated
    // `orphanedFootnotes` prop via `effectiveViewPrefs`; the builder leaves
    // the stable empty default (correct for the Reader, overwritten in the
    // main app). The edit/delete handlers stay — they're stable per-doc cbs.
    orphanedFootnotes: EMPTY_ORPHANED_FOOTNOTES,
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
