"use client";

/**
 * EditorPane — shared per-doc rendering surface (Phase 2: editor + rail).
 *
 * Today this owns the editor pod plus an optional right-side panel
 * rail driven by `chrome.visiblePanelKinds`. The Reader uses this as
 * the entire post-Library-bar surface; the main app continues to use
 * `EditorLayout` until the next-session extraction moves its per-doc
 * machinery in here.
 *
 * Layout: a horizontal flex container
 *   [ editor pod ] [ optional panel rail ]
 * The rail consists of an icon strip on the right edge plus a column
 * for the active panel to the left of the strip. Only the panels
 * whose kinds appear in `chrome.visiblePanelKinds` render an icon;
 * the rail is omitted entirely when the whitelist is empty/undefined.
 *
 * Currently wired panels (Reader subset): `outline` (derives entirely
 * from the editor's content). The rest of `READER_CHROME`'s
 * whitelisted kinds — footnotes, examples, citations, bibliography,
 * notes — show a placeholder body. Wiring those requires the per-doc
 * sidecar hooks (`useFootnotes`, `useNotes`, …) and the related
 * provider stack, which is the remaining Phase-2 / Phase-3 work.
 *
 * Planned (post-extraction) responsibilities — see
 * `/Users/gabriel/.claude/plans/next-session-extract-editorpane-virtual-raven.md`:
 *   - Owns ALL per-doc hooks (`useDocument`, `useNotes`, `useFootnotes`,
 *     `useCitations`, `useArchive`, `useTodos`,
 *     `useExamples`, `useCutter`, `useRevisions`, `useAiRequests`,
 *     `useSuggestions`, `useAnnotations`, `useCollab`,
 *     `useDocumentStyle`, `useLatexCompile`, `useWordCount`,
 *     `usePristineCardManager`, `useRecentlyAddedTracker`).
 *   - Owns 8 per-doc providers: `EditorRefProvider`, `AiRequestsProvider`,
 *     `CitationDisplayProvider`, `SelectionsProvider`, `RecentlyAddedProvider`,
 *     `CardCreationProvider`, `CollabProvider`, `PoppedCardsContext.Provider`.
 *   - The full panel infrastructure (strips on both sides, dock/float,
 *     marginalia, popouts, FloatingPanels, DockOutline).
 *   - Bubbles per-doc state to the Virgil bar via `onPaneStateChange`.
 *
 * Chrome wiring already in place (carries through the extraction):
 *   - `chrome.showActionToolbar` + `chrome.actionToolbarKinds` filter
 *     `ActionButtonsRow`.
 *   - `chrome.showParagraphFloatTitleEdit` /
 *     `chrome.showHeadingFloatLabelEdit` already gated.
 *   - Read-only `Marginalia` suppresses drag-to-rebind via
 *     `editor.isEditable`.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { Editor, JSONContent } from "@tiptap/react";
import VirgilEditor, { type EditorHandle } from "./Editor";
import AIWindow, { aiRequestDotStatus } from "./AIWindow";
import { EditorChromeProvider } from "./editor-layout/chrome-context";
import {
  FULL_CHROME,
  filterPanelKinds,
  viewToggleClasses,
  type EditorChromeConfig,
} from "./editor-layout/chrome-config";
import OutlinePanel from "@/panels/Outline/OutlinePanel";
import ExamplesPanel from "@/panels/Examples";
import { PANEL_REGISTRY, cardPopKey } from "@/panels/panel-registry";
import { SectionLozenge } from "./editor-layout/section-lozenge";
import { useCodePaneSplit } from "./editor-layout/CodePaneSplitContext";
import { EditorScrollbar } from "./editor-layout/editor-scrollbar";
import { ZenMargin } from "./editor-layout/zen-margin";
import PrintAppendices from "./PrintAppendices";
import { LoadingScreen } from "./LoadingScreen";
import type { PrintPanelKey } from "@/lib/print";
import { EditorRefProvider } from "./editor-layout/contexts/editor-ref";
import { SelectionsProvider, useAnchoredSelectionSlots } from "./editor-layout/contexts/selections";
import { cardStore } from "@/links/_shared/anchored-card-store";
import type { EntityKind } from "@/links/_shared/entity-hover";
import { useAnchorHighlightReconciler } from "@/links/_shared/useAnchorHighlightReconciler";
import { useLinkedAnchorReconciler } from "@/links/_shared/useLinkedAnchorReconciler";
import { useTextHoverBridge } from "@/links/_shared/useTextHoverBridge";
import { usePanelCardHoverBridge } from "@/links/_shared/usePanelCardHoverBridge";
import { usePlacement } from "@/links/_shared/usePlacement";
import { AiRequestsProvider } from "./editor-layout/contexts/ai-requests";
import { RecentlyAddedProvider } from "./editor-layout/contexts/recently-added";
import { CardCreationProvider } from "./editor-layout/contexts/card-creation";
import { useCardCreation } from "./editor-layout/card-actions/card-creation";
import { useCitationActions } from "./editor-layout/card-actions/citations";
import { isAnchorableNode } from "@/lib/marginalia";
import { isTier1CDisabled } from "@/lib/perf-flags";
import { useCitations, type CitationsHook } from "@/hooks/useCitations";
import { useAutoAddLibraryEntriesForCitations } from "@/hooks/useAutoAddLibraryEntriesForCitations";
import { useLibraryMasterBib } from "@/hooks/useLibrary";
import { useAnnotations } from "@/hooks/useAnnotations";
import { useBibReview } from "@/hooks/useBibReview";
import { useBibSettings } from "@/hooks/useBibSettings";
import { useNotes } from "@/hooks/useNotes";
import { useAiRequests } from "@/hooks/useAiRequests";
import { useRecentlyAddedTracker } from "@/hooks/useRecentlyAddedTracker";
import { useDocument } from "@/hooks/useDocument";
import { useEditorUIState } from "@/hooks/useEditorUIState";
import { useLatexCompile, type DocumentClassMismatchHandler } from "@/hooks/useLatexCompile";
import { useWordCount } from "@/hooks/useWordCount";
import { useTodos } from "@/hooks/useTodos";
import { useArchive } from "@/hooks/useArchive";
import { useCutter } from "@/hooks/useCutter";
import { useReports } from "@/hooks/useReports";
import { useRevisions } from "@/hooks/useRevisions";
import { useSuggestions } from "@/hooks/useSuggestions";
import { useCollab, CollabProvider, type CollabHook } from "@/hooks/useCollab";
import { useDocumentStyle } from "@/hooks/useDocumentStyle";
import { useFootnotes } from "@/hooks/useFootnotes";
import { useStructuralRevisions } from "@/hooks/useStructuralRevisions";
import { usePristineCardManager } from "@/hooks/usePristineCardManager";
import { PristineCardsProvider } from "./editor-layout/contexts/pristine-cards";
import { CitationDisplayProvider } from "./editor-layout/contexts/citation-display";
import { DockOutline } from "./editor-layout/DockOutline";
import { CardLiftOutline } from "./CardLiftOutline";
import { type PoppedCardDeps } from "./editor-layout/floating-cards";
import { FloatHost } from "@/floats/FloatHost";
import { parseAnyKey, migrateLegacyKeyToFloat } from "@/floats/float-key";
import { textObjectPopoutKey } from "@/text-objects/text-object-registry";
import { CARD_REGISTRY } from "@/cards/card-registry";
import { isCardKind } from "@/cards/predicates";
import { PoppedCardsContext, type PoppedCardsValue } from "@/hooks/usePoppedCards";
import { DropModeProvider } from "./drop-mode/DropModeProvider";
import { useAnchorRebindBridge } from "./editor-layout/event-bridges/anchor-rebind";
import type { StackPullApi } from "./drop-mode/types";
import { StackIcon } from "./stack/StackIcon";
import { StackStrip } from "./stack/StackStrip";
import { useStack, addStackItem } from "@/hooks/useStack";
import {
  snapshotCard,
  snapshotHeadingSection,
  snapshotParagraph,
} from "@/lib/stack/snapshot";
import type { StackItem as StackItemType } from "@/lib/stack/types";
import { resolveCardData, cardKeyPrefixToStackKind } from "@/lib/stack/resolve-card";
import { useDragHandleActions, type DragHandleRef } from "./editor-layout/card-actions/drag-handle-actions";
import { DragHandleMenuProvider, type DragHandleMenuApi } from "./editor-layout/card-actions/drag-handle-menu-context";
import { DragHandleMenu } from "./DragHandleMenu";
import { HeadingTypeMenu, type HeadingTypePick } from "./HeadingTypeMenu";
import { useConfirmDialog } from "./ConfirmDialog";
import {
  buildMarginItemHandlers,
  deleteMarginItem,
  type MarginItemHandlers,
  type MarginItemKind,
} from "@/cards/delete-margin-item";
import { resolveStyle } from "@/lib/style-library";
import { extractDocumentClass } from "@/lib/document-class";
import { PanelColumn, type PanelSlot } from "./editor-layout/panel-column";
import { PanelChromeProvider } from "./panel-primitives";
import FloatingPanel from "./FloatingPanel";
import { OmniHost } from "./editor-layout/panels/omni-host";
import { OutlineHost } from "./editor-layout/panels/outline-host";
import {
  FLOATING_PANEL_WIDTH,
  FLOATING_PANEL_HEIGHT,
  FLOATING_PANEL_VIEWPORT_MARGIN,
  FLOATING_PANEL_STACK_OFFSET,
  FLOATING_PANEL_Z_BASE,
} from "./editor-layout/constants";
import { computeSpawnPosition } from "./editor-layout/spawn-position";
import { BibliographyHost } from "./editor-layout/panels/bibliography-host";
import { NotesHost } from "./editor-layout/panels/notes-host";
import { FootnotesHost } from "./editor-layout/panels/footnotes-host";
import { CitationsHost } from "./editor-layout/panels/citations-host";
import { TodoHost } from "./editor-layout/panels/todo-host";
import { ArchiveHost } from "./editor-layout/panels/archive-host";
import { CutterHost } from "./editor-layout/panels/cutter-host";
import { ReportsHost } from "./editor-layout/panels/reports-host";
import { RevisionsHost } from "./editor-layout/panels/revisions-host";
import { ErrorsHost } from "./editor-layout/panels/errors-host";
import { SearchHost } from "./editor-layout/panels/search-host";
import WordCountPanel from "@/panels/WordCount";
import { INITIAL_SEARCH_STATE, type SearchPanelState } from "@/panels/Search";
import type { LatexError } from "@/lib/latex-errors";
import Marginalia from "./Marginalia";
import { StripButton, useStripHandlers } from "./editor-layout/drag-drop";
import { useSelectionsContext } from "./editor-layout/contexts/selections";
import { IconBlank, IconSplit } from "./editor-layout/panel-icons";
import { OmniFilterMenu, DEFAULT_OMNI_CATEGORIES } from "@/panels/Omni/OmniViewPanel";
import MenuBar, {
  DetachedActionsToolbar,
  DetachedFormattingToolbar,
  DetachedMenuToolbar,
  type MarginaliaType,
  type ActionToolbarCallbacks,
} from "./MenuBar";
import { resolveDragPosition, type SnapGrid } from "./editor-layout/snap-grid";
import { useDragGap } from "@/hooks/useDragGap";
import {
  getLinkedTextObjectIds,
  getTextAnchor,
  createLinkedAnchor,
  updateLinkedAnchorCard,
} from "@/links/links";
import type { MarginaliaMarker } from "@/lib/marginalia";
import type {
  PanelPlacement,
  PanelId,
  ViewPrefs,
  Side,
  Half,
  DockSlotKey,
} from "@/hooks/useViewPrefs";
import { dockSlotKey } from "@/hooks/useViewPrefs";
import { useMarginEdit, MARGIN_AXIS } from "@/hooks/useMarginEdit";
import type { FocusState } from "@/hooks/useFocusMode";
import type { OmniCategory } from "@/panels/Omni";
import type { SectionPathEntry } from "@/panels/Outline";
import type { PanelKind, CardKind } from "@/panels/_shared/types";
import type { AiRequest } from "@/lib/types";
import {
  useCardLifecycleApi,
  assertLifecycleCoverage,
  type CardLifecycleRegistry,
} from "@/panels/card-lifecycle-registry";

// Stable no-op for `PaneState` fields that aren't yet wired to a real
// hook. Keeping the reference module-scope avoids a fresh closure per
// render, which would otherwise re-fire `onPaneStateChange` even when
// nothing meaningful changed.
const noop = () => {};

// Default popped-out card dimensions. Match EditorLayout's local
// constants so spawn positions stay consistent across the swap.
const POPUP_W = 360;
const POPUP_H = 280;

// Typed stub for `addStyleMergeRequest` — the real signature returns
// an `AiRequest`, so a plain `noop` (returns void) doesn't fit. Step
// 7.2 replaces this with the live `useAiRequests().addStyleMergeRequest`
// inside EditorPane. Until then, the stub only executes if the
// bubble-up flag is on and paneState is null — which shouldn't happen
// in practice, hence the throw.
export const stubAddStyleMergeRequest: PaneState["addStyleMergeRequest"] = () => {
  throw new Error(
    "PaneState.addStyleMergeRequest stub called — wire useAiRequests into EditorPane (Step 7.2) before flipping USE_EDITOR_PANE_BUBBLE_UP",
  );
};

/**
 * Slice of the shell's `useViewPrefs` + focus-mode state that
 * EditorPane needs to render the canonical PanelColumn + FloatingPanel
 * surface (Step 7.5 sub-pass 2).
 *
 * The Reader doesn't pass this — its synthetic readerPlacements + the
 * simple `PaneRail` rendering covers what it needs. Main app post-7.8
 * passes its `useViewPrefs` / `useFocusMode` hook outputs as a single
 * bundle so EditorPane can render the full dock/float system.
 *
 * Kept narrow: only fields PanelColumn / FloatingPanel / OmniHost /
 * OutlineHost actually touch. Window-only prefs (`editorLeftMargin`,
 * `topbarRightCollapsed`, `pageWidth`, etc.) stay in EditorLayout.
 */
export interface EditorPaneViewPrefs {
  // ── Read state ──────────────────────────────────────────────────
  prefs: ViewPrefs;
  focusedHalfLeft: Half;
  focusedHalfRight: Half;
  isResizingPanels: boolean;
  /** From useFocusMode. Drives focus-aware dimming/hiding. */
  focusState: FocusState | null;

  // ── Section path (OutlineHost) ──────────────────────────────────
  activeSectionPath: SectionPathEntry[];
  activeParTitleIndex: number | null;
  mirrorSectionPath: SectionPathEntry[];
  mirrorParTitleIndex: number | null;

  // ── Setters / mutators ──────────────────────────────────────────
  setFocusedHalfLeft: (h: Half) => void;
  setFocusedHalfRight: (h: Half) => void;
  setIsResizingPanels: (r: boolean) => void;
  /** Snap all panel/margin prefs to their currently-rendered widths
   *  before drag start. */
  syncPanelPrefsToRendered: () => void;

  getPanelWidth: (side: Side, panelId: PanelId) => number;
  setPanelWidth: (side: Side, panelId: PanelId, width: number) => void;
  setSplitRatio: (side: Side, ratio: number) => void;

  // ── Persisted page margins (driven by margin-edit mode) ────────
  setEditorLeftMargin: (px: number) => void;
  setEditorRightMargin: (px: number) => void;
  setEditorTopMargin: (px: number) => void;
  setEditorBottomMargin: (px: number) => void;

  // ── Top / bottom gutter (drag-resizable spacers above/below the
  //    editor pod). The user adjusts these to push the page down from
  //    the docked MenuBar or up from the bottom edge of the window.
  topGutter: number;
  bottomGutter: number;
  setEditorTopGutter: (px: number) => void;
  setEditorBottomGutter: (px: number) => void;

  // ── Zen mode (replaces panel rails with adjustable margins) ────
  zenMode: boolean;
  zenLeftMargin: number;
  zenRightMargin: number;
  setZenLeftMargin: (px: number) => void;
  setZenRightMargin: (px: number) => void;

  setActiveLeft: (id: PanelId) => void;
  setActiveRight: (id: PanelId) => void;
  setActiveHalf: (side: Side, half: Half, id: PanelId) => void;
  togglePanel: (id: PanelId) => void;
  movePanel: (id: PanelId, side: Side, index?: number) => void;
  closePopout: (id: PanelId) => void;

  setFloatPosition: (
    id: PanelId,
    pos: { x: number; y: number; width: number; height: number },
  ) => void;
  undockPanel: (
    id: PanelId,
    rect: { x: number; y: number; width: number; height: number },
  ) => void;
  redockPanel: (id: PanelId, slotKey: DockSlotKey) => void;

  // ── Card popout ─────────────────────────────────────────────────
  /** Toggle a card's popped-out state. Key shape: every float uses the
   *  unified AF grammar `float:<domain>:<kind>:<id>` — card popouts via
   *  `cardPopKey(kind,id)` (`float:card:note:…`), block-level TextObject
   *  popouts via `textObjectPopoutKey` (`float:textobject:texBlock:…`).
   *  Selection lifts hydrate into `linkedRange` TextObjects so they take
   *  the same unified path — there is no session-only float category left.
   *  See `FloatHost`'s `resolveFloatable` dispatcher. */
  toggleCardPopout: (key: string) => void;
  /** Pop the card *off* without re-docking. Used by float X buttons
   *  and by the PoppedCardsContext's `close` callback. */
  closeCardPopout: (key: string) => void;
  setCardFloatPosition: (
    key: string,
    rect: { x: number; y: number; width: number; height: number },
  ) => void;
  /** Lockstep-remap a card's popout key across BOTH `poppedOutCards` AND
   *  `cardFloatPositions`, so a card that morphs to another kind while popped
   *  out (revision comment↔suggestion today; the A9 chevron generalizes this)
   *  keeps its float alive at the same rect instead of vanishing — the stored
   *  key bakes the kind, and `FloatHost.resolveFloatable` re-derives kind from
   *  the key. No-op when `oldKey` isn't currently popped. */
  remapCardPopKey: (oldKey: string, newKey: string) => void;

  // ── OmniHost helpers ────────────────────────────────────────────
  getOmniEnabled: (side: Side) => Set<OmniCategory>;
  getOmniHideAll: (side: Side) => boolean;
  toggleOmniHideAllCards: (side: Side) => void;
  /** Footnotes that exist as orphan cards (no in-doc reference). The
   *  Reader has none; main app post-7.8 plumbs `useFootnoteActions`
   *  output through here. */
  orphanedFootnotes: import("@/lib/types").OrphanedFootnote[];
  onEditOrphan: (id: string, newContent: unknown) => void;
  onDeleteOrphan: (id: string) => void;
  onEditOrphanTitle: (id: string, title: string) => void;

  // ── OutlineHost handlers ────────────────────────────────────────
  onScrollToHeading: (blockIndex: number) => void;
  onReorderBlocks: (fromIndex: number, count: number, toIndex: number) => void;
  onRenameHeading: (blockIndex: number, newText: string) => void;
  onRenameParTitle: (blockIndex: number, newTitle: string) => void;
  onUpdateLabel: (blockIndex: number, newLabel: string | null) => void;
  isLabelTaken: (candidate: string, excludeLabel: string | null) => boolean;
  onFocusActivate: () => void;
  onFocusDeactivate: () => void;
  onFocusToggleLock: () => void;
  onFocusMoveTo: (blockIndex: number) => void;
  onFocusExpandTo: (blockIndex: number) => void;
  onFocusSnapBoundary: (edge: "top" | "bottom", blockIndex: number) => void;

  // ── Floating-panel focus management ─────────────────────────────
  /** Brings a floating panel to the top of the z-stack. Also accepts
   *  toolbar refs once the docked MenuBar / detached toolbars mount in
   *  EditorPane (Step 7.6 finish). */
  focusFloating: (
    target:
      | { kind: "panel"; id: PanelId }
      | { kind: "toolbar"; bucket: "actions" | "formatting" | "menus"; id: string }
      | { kind: "card"; key: string },
  ) => void;
  /** Paint z-index for a popped float, derived from the MRU focus stack
   *  (raise-on-click). Optional — the Reader shim omits it. */
  cardFloatZIndex?: (key: string) => number;

  // ── Icon strip (view-controls pod + StripButton + OmniFilterMenu) ──
  /** Sidebar collapse / expand. Used by the view-controls pod's
   *  collapse-toggle button — `activeLeft ? collapseLeft() : expandLeft()`. */
  collapseLeft: () => void;
  collapseRight: () => void;
  expandLeft: () => void;
  expandRight: () => void;
  /** Suppresses the default omni-view on a side ("blank" mode). */
  setBlank: (side: Side) => void;
  /** Clears the blank state on whichever side(s) have it set. Used by
   *  flows that open a new card and need to drop "show nothing" first. */
  clearBlankIfSet: () => void;
  /** Toggles split panel on a side. */
  toggleSplit: (side: Side) => void;
  /** Force-docks a panel into its gutter slot. Required by `useStripHandlers`. */
  openPanelDocked: (id: PanelId, side?: Side) => void;
  /** OmniFilterMenu mutators for per-side category enablement. */
  toggleOmniCategory: (side: Side, cat: OmniCategory) => void;
  setOmniSideToDefault: (side: Side) => void;
  /** Map from each OmniCategory → which side its native panel lives on. */
  categorySides: Record<OmniCategory, Side>;
}

/**
 * Shell state needed to render the docked MenuBar + the three detached
 * toolbars (Actions / Formatting / Menu). The Reader doesn't pass this —
 * its chrome hides MenuBar's edit items + the formatting toolbar
 * entirely, so the affordances driven by these fields are absent.
 *
 * Kept as a separate bundle from `EditorPaneViewPrefs` because these
 * are general view-state toggles (par titles, latex comments, divider
 * levels, paranav, etc.) and shell-owned topbar refs — not
 * dock/float-shaped state.
 *
 * Path A 7.6 finish (additive). Built by EditorLayout but not passed to
 * EditorPane until Path A 7.8 — so the dormant detached-toolbar /
 * MenuBar JSX in EditorPane stays unmounted until then.
 */
export interface EditorPaneMenuBarBundle {
  // ── Toggle state (read) ────────────────────────────────────────
  showParTitles: boolean;
  showLatexComments: boolean;
  showHeadingLabels: boolean;
  showSectionIndicator: boolean;
  showMarginalia: boolean;
  hiddenMarginaliaTypes: Set<import("./MenuBar").MarginaliaType>;
  hiddenHighlightTypes: Set<import("@/hooks/useViewPrefs").HighlightType>;
  availableDividerLevels: Set<import("./MenuBar").DividerLevel>;
  activeDividerLevels: Set<import("./MenuBar").DividerLevel>;
  dividerWidth: import("./MenuBar").DividerWidth;
  editorSplit: boolean;
  activeSplitPane: "top" | "bottom";

  // ── Toggle setters ─────────────────────────────────────────────
  setShowParTitles: (v: boolean) => void;
  setShowLatexComments: (v: boolean) => void;
  toggleHeadingLabels: () => void;
  toggleSectionIndicator: () => void;
  toggleMarginalia: () => void;
  toggleMarginaliaType: (type: import("./MenuBar").MarginaliaType) => void;
  toggleHighlightType: (type: import("@/hooks/useViewPrefs").HighlightType) => void;
  toggleDividerLevel: (level: import("./MenuBar").DividerLevel) => void;
  setDividerWidth: (w: import("./MenuBar").DividerWidth) => void;
  setShowHighlights: (v: boolean) => void;
  toggleEditorSplit: () => void;
  closeAllPanels: () => void;

  // ── Para nav (back/forward through paragraph history) ──────────
  paraNavBack: () => void;
  paraNavForward: () => void;
  paraNavBackDisabled: boolean;
  paraNavForwardDisabled: boolean;

  // ── Dialog openers (drive shell-owned modals) ──────────────────
  onOpenPreferences: () => void;
  onOpenFontsDialog: () => void;
  onOpenMarginsMode: () => void;
}

/**
 * The slice of per-doc state the shell (Virgil bar) needs to read from
 * the active EditorPane. EditorPane fires `onPaneStateChange` whenever
 * any of these change so the shell can render its DocStyleDropdown,
 * Compile / PDF / Code buttons, and AI dot against live values.
 *
 * The Library Reader does not pass `onPaneStateChange` — its state
 * stays internal because the Reader's chrome hides every Virgil-bar
 * item that would consume this state.
 */
export interface PaneState {
  editor: Editor | null;
  editorRef: RefObject<EditorHandle | null>;
  aiRequests: AiRequest[];
  // Mirror of `useAiRequests().addStyleMergeRequest` — DocStyleDropdown
  // calls this when the user picks "Apply customizations to <style>".
  addStyleMergeRequest: (args: {
    targetStyleId: string;
    targetStyleName: string;
    targetPreamble: string;
    currentPreamble: string;
    note?: string;
  }) => AiRequest;
  compilePdf: () => void;
  isCompiling: boolean;
  pdfStale: boolean;
  pdfBlobUrl: string | null;
  pdfView: boolean;
  switchToPdfView: () => void;
  switchFromPdfView: () => void;
  switchToCodeView: () => void;
  switchToVisualView: () => void;
  codeView: boolean;
  aiDot: "red" | "green" | "yellow" | null;
  // EditorPane owns the live collab hook because it mounts inside
  // <DocPipeline> and therefore holds a valid write handle. EditorLayout
  // reads from here so its topbar collab icon/badge can drive real
  // mutations (enable/disable/etc.) without standing up a second
  // useCollab instance outside the pipeline boundary.
  collab: CollabHook;
  // Citations bubble up for the same reason as collab: EditorPane is
  // the canonical per-doc state owner, and previously both EditorPane
  // and EditorLayout independently mounted `useCitations(docId)` for
  // the same doc — duplicate `parseBibFile` runs and duplicate
  // `DOC_BIB_CHANGED_EVENT` listeners. Now EditorLayout reads the live
  // hook from here.
  citationsHook: CitationsHook;
}

export interface EditorPaneProps {
  /**
   * Stable identifier for the doc being rendered. Used by per-doc
   * sidecar hooks (post-extraction) to scope notes/footnotes/etc. The
   * Library Reader passes `library-paper:<citekey>`; main-app callers
   * pass the FsaDocIndex doc id.
   */
  docId: string;

  /**
   * Initial TipTap JSON to seed the editor. When provided, takes
   * precedence over `useDocument().content` — the Library Reader uses
   * this because its parse path differs (it owns UUID assignment +
   * sidecar-aware `parseLatex` ahead of mount). Main-app callers omit
   * it; EditorPane falls back to `useDocument().content`.
   */
  initialContent?: JSONContent;

  /**
   * Optional handler invoked when `useLatexCompile` detects a
   * `\documentclass` / heading-command mismatch. The shell typically
   * passes its `useDocumentClassMismatchDialog().prompt`. Reader
   * omits — it never compiles.
   */
  onDocumentClassMismatch?: DocumentClassMismatchHandler;

  /**
   * Default `true`. When `false`, the editor mounts read-only and
   * drag/paste are gated.
   */
  editable?: boolean;

  /**
   * Default `FULL_CHROME`. Shapes which UI surfaces render. The Library
   * Reader passes `READER_CHROME`.
   */
  chrome?: EditorChromeConfig;

  /** Forwarded to TipTap's `onUpdate` via `VirgilEditor`. Receives the
   *  live editor instance — callers that need a JSON snapshot must call
   *  `editor.getJSON()` themselves, ideally inside their own debounce
   *  timer (see editor-ops.ts handleUpdate). */
  onUpdate?: (editor: Editor) => void;

  /** Search-bar / link-jump highlight forwarded straight through. */
  highlightText?: string | null;
  /** Position-based highlight (search panel). */
  highlightRange?: { from: number; to: number } | null;

  /**
   * Fires once the live TipTap `Editor` instance is ready. The Library
   * Reader's outer `PageScrollStrip` uses this to drive page-mark
   * scrolling; the main app will use `onPaneStateChange.editor` once
   * the bubble-up surface is wired.
   */
  onEditorReady?: (editor: Editor) => void;

  /** Tab integration — main app passes; Library Reader omits. */
  onActivate?: () => void;

  /**
   * Bubbles per-doc state needed by the Virgil bar. EditorPane fires
   * this on every change to any `PaneState` field. The Library Reader
   * omits it (its chrome hides every Virgil-bar item that consumes
   * pane state).
   */
  onPaneStateChange?: (state: PaneState | null) => void;

  /**
   * Tab-state owned by the EditorLayout shell, threaded through
   * EditorPane so the bubble-up `paneState` can echo it back to the
   * Virgil bar. The Reader omits these (Reader's chrome hides the
   * PDF/Code toggles).
   */
  pdfView?: boolean;
  codeView?: boolean;
  onTogglePdfView?: () => void;
  onToggleCodeView?: () => void;

  /**
   * Per-panel placement (which side of the editor each panel sits on).
   * Step 7.4 splits the rail into left + right strips driven by this
   * list. Reader omits — falls back to a synthetic "all panels right"
   * placement that matches the previous single-rail behavior. Main
   * app passes its `prefs.placements` from `useViewPrefs` post-7.8.
   */
  placements?: PanelPlacement[];

  /**
   * Bundle of `useViewPrefs` + `useFocusMode` shell state for the
   * canonical PanelColumn + FloatingPanel + OmniHost + OutlineHost
   * surface (Step 7.5 sub-pass 2). Reader omits — keeps the simple
   * iconStrip + body rail. Main app post-7.8 passes its hook outputs
   * to opt EditorPane into the full dock/float system.
   */
  viewPrefs?: EditorPaneViewPrefs;

  /**
   * Optional adornment rendered just inboard of the left `PaneRail`,
   * directly outboard of the editor column. The Library Reader uses
   * this slot to mount its `PageScrollStrip` (the page-mark navigator)
   * so it sits flush against the editor pod's left side rather than
   * at the far edge of the manila canvas.
   */
  leftGutterPrelude?: React.ReactNode;

  /**
   * Bundle of MenuBar/toolbar shell state. Reader omits — its chrome
   * hides every affordance these fields drive (no menu bar edit items,
   * no formatting toolbar, no detached toolbars). Main app post-7.8
   * passes this to opt EditorPane into rendering the docked MenuBar +
   * the three detached toolbars (Actions / Formatting / Menu). Path A
   * 7.6 finish defines the bundle but doesn't yet pass it.
   */
  menuBar?: EditorPaneMenuBarBundle;

  /**
   * AI Window open-state plumbed in from the shell. The Virgil bar's
   * "AI requests" button toggles this in EditorLayout; EditorPane
   * mounts the actual `<AIWindow>` so it can read directly from this
   * doc's per-doc hooks (bibReview, bibSettings, revisions, citations,
   * aiRequests) instead of EditorLayout having to keep parallel hooks
   * alive just to feed the modal. Reader omits — Reader's chrome has
   * no AI Window affordance.
   */
  aiWindowOpen?: boolean;
  onAiWindowClose?: () => void;

  // Note: paragraph / heading / example popout handlers used to be
  // optional props here (added during the 7.6 partial). Step 7.6
  // collapses them — they're now derived locally from
  // `viewPrefs.toggleCardPopout` + `viewPrefs.setCardFloatPosition`.
  // Reader (no viewPrefs) gets no-op popouts; main app post-7.8
  // wires them automatically once it passes the bundle.
}

const EditorPane = forwardRef<EditorHandle, EditorPaneProps>(function EditorPane(
  {
    docId,
    initialContent,
    editable = true,
    chrome = FULL_CHROME,
    onUpdate,
    highlightText = null,
    highlightRange = null,
    onEditorReady,
    onPaneStateChange,
    onDocumentClassMismatch,
    pdfView = false,
    codeView = false,
    onTogglePdfView,
    onToggleCodeView,
    placements,
    viewPrefs,
    leftGutterPrelude,
    menuBar,
    aiWindowOpen = false,
    onAiWindowClose,
  },
  ref,
) {
  const innerRef = useRef<EditorHandle>(null);
  useImperativeHandle(ref, () => innerRef.current as EditorHandle);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [overrideEditor, setOverrideEditor] = useState<Editor | null>(null);
  // Gates the LoadingScreen curtain over `.editor-pane-pod`.
  const [ready, setReady] = useState(false);

  // Per-category structural revisions drive card-source memos (footnotes,
  // citations, examples, archive order, marginalia). Each counter bumps ONLY
  // when its structural entity changes — never on a plain keystroke — so
  // typing inside a paragraph re-derives nothing and no card re-renders or
  // shifts. This replaces the old per-keystroke `docVersion` counter (a
  // 100ms-debounced bump that fanned every keystroke out to full doc walks +
  // a card re-render). See `docs/perf/keystroke-sanctity-findings.md`.
  const rev = useStructuralRevisions(editor);

  // PDF-stale tracking is the only thing still riding `editor.on('update')`
  // here, and it's O(1): stamp a timestamp ref each edit and flip `pdfStale`
  // false→true at most once per compile cycle (later edits skip the setter).
  // Keystroke-sanctity permitted subscriber — see AGENTS.md.
  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => {
      lastEditTimeRef.current = Date.now();
      if (lastCompileTimeRef.current != null && !pdfStaleRef.current) {
        setPdfStale(true);
      }
    };
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
    };
  }, [editor]);

  const handleEditorReady = useCallback(
    (ed: Editor) => {
      setEditor(ed);
      onEditorReady?.(ed);
    },
    [onEditorReady],
  );

  // ── Per-doc selection state ──────────────────────────────────────
  // Anchored selection slots are derived from the global cardStore via
  // useAnchoredSelectionSlots — same single source of truth as
  // EditorLayout, so the Library reader (which mounts EditorPane
  // standalone) gets identical hover/selection plumbing for free.
  // Bib stays as local useState (it's not an anchored kind).
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
  const [selectedBibKey, setSelectedBibKey] = useState<string | null>(null);

  // ── Pristine card manager (per-pane) ──────────────────────────────
  // Tracks blank-on-create cards across all kinds; a global pointerdown
  // watcher inside the manager fires the registered discard callback
  // when the user clicks outside the card's DOM. Each per-kind hook
  // gets its slice via `pristineManager.forKind(...)`. Each EditorPane
  // owns its own manager — calling `usePristineCardManager` here gives
  // every pane an independent tracker, matching the per-doc nature of
  // pristine state.
  const pristineManager = usePristineCardManager();
  const notePristine = useMemo(() => pristineManager.forKind("note"), [pristineManager]);
  const cutPristine = useMemo(() => pristineManager.forKind("cut"), [pristineManager]);
  const reportPristine = useMemo(() => pristineManager.forKind("report"), [pristineManager]);
  const todoPristine = useMemo(() => pristineManager.forKind("todo"), [pristineManager]);
  const citationPristine = useMemo(() => pristineManager.forKind("citation"), [pristineManager]);
  const footnotePristine = useMemo(() => pristineManager.forKind("footnote"), [pristineManager]);

  // ── Per-doc sidecar hooks ────────────────────────────────────────
  // These resolve to the paper folder via storage-fsa.ts's synthetic
  // FsaDocMeta for `library-paper:` IDs (and storage-dev.ts's URL
  // routing for the dev preview); for main-app docs they resolve
  // through the regular FsaDocIndex.
  const citationsHook = useCitations(docId, citationPristine);
  // Only consult the library's master.bib once the doc actually
  // references at least one citation key. Parsing master.bib (citation-
  // js) was firing for every editor session — including empty/scratch
  // docs that have no use for it — and the parse + window-focus
  // re-parse contributed measurable overhead. The auto-add hook below
  // is purely reactive; bootstrapping the library on first-citation is
  // sufficient because no work is wasted before that moment.
  const hasAnyCitationKey = useMemo(
    () => citationsHook.citations.some((c) => c.keys && c.keys.length > 0),
    [citationsHook.citations],
  );
  const { entries: libraryMasterBibEntries } = useLibraryMasterBib(hasAnyCitationKey);
  useAutoAddLibraryEntriesForCitations({
    citations: citationsHook.citations,
    bibEntries: citationsHook.bibEntries,
    libraryEntries: libraryMasterBibEntries,
    addBibEntry: citationsHook.addBibEntry,
  });
  const annotationsHook = useAnnotations(docId);
  const bibReviewHook = useBibReview(docId);
  const bibSettingsHook = useBibSettings(docId);
  const notesHook = useNotes(docId, notePristine);
  const aiRequestsHook = useAiRequests(docId);
  const cutterHook = useCutter(docId, cutPristine);
  const reportsHook = useReports(docId, reportPristine);
  const revisionsHookRaw = useRevisions(docId);
  // Morph a revision card's kind (comment↔suggestion) AND, in lockstep, remap
  // its popout key if it's currently floated — `convertCard` only flips
  // `card.kind`, but the stored `float:card:<kind>:<id>` key bakes the kind and
  // `FloatHost.resolveFloatable` re-derives kind from the key, so without the
  // remap a popped-then-morphed card silently vanishes. `remapCardPopKey`
  // no-ops when the card isn't floated, so this is safe from every trigger
  // (docked dropdown, omni, or the FloatChrome title control). Generalizes to
  // the A9 morph chevron.
  const convertRevisionCard = useCallback(
    (id: string, toKind: "comment" | "suggestion") => {
      const fromCardKind: CardKind =
        toKind === "suggestion" ? "revision-comment" : "revision-suggestion";
      const toCardKind: CardKind =
        toKind === "suggestion" ? "revision-suggestion" : "revision-comment";
      revisionsHookRaw.convertCard(id, toKind);
      viewPrefs?.remapCardPopKey(cardPopKey(fromCardKind, id), cardPopKey(toCardKind, id));
    },
    [revisionsHookRaw, viewPrefs],
  );
  // The hook threaded to every revision consumer (cardCtx, PaneRail/PaneRailBody,
  // omni-host) with `convertCard` swapped for the popout-key-remapping wrapper —
  // one chokepoint, so the morph survives regardless of which surface triggers it.
  const revisionsHook = useMemo(
    () => ({ ...revisionsHookRaw, convertCard: convertRevisionCard }),
    [revisionsHookRaw, convertRevisionCard],
  );
  const todosHook = useTodos(docId, todoPristine);
  const archiveHook = useArchive(docId);
  const footnotesHook = useFootnotes(docId, footnotePristine);
  const suggestionsHook = useSuggestions(docId);
  void suggestionsHook; // surfaces in the suggestions panel mounting later
  const collab = useCollab(docId);
  const documentStyleHook = useDocumentStyle(docId);
  void documentStyleHook; // surfaces in DocStyleDropdown post-swap
  // Per-EditorPane recently-added tracker. Card-creation flows
  // mark the just-added id; panel sorts pin it at index 0 until
  // the user moves selection elsewhere. Local-to-pane scoping
  // matches the per-doc semantics of selection state.
  const recentlyAdded = useRecentlyAddedTracker();

  // ── Stack (visual clipboard) ────────────────────────────────────
  // Window-global; `useStack` reads/writes a versioned envelope in
  // localStorage. The strip is collapsed by default; click the icon to
  // toggle.
  const stack = useStack();
  const [stackOpen, setStackOpen] = useState(false);
  const stackSourceRef = useRef<{ docId: string | null }>({ docId: docId ?? null });
  stackSourceRef.current = { docId: docId ?? null };
  // Click-away: close the strip when the user mousedowns outside both
  // the icon and the strip. Effect is skipped while the strip is
  // closed to avoid a persistent document listener.
  useEffect(() => {
    if (!stackOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (
        target.closest('[data-stack-icon-hit="true"]') ||
        target.closest('[data-stack-strip="true"]')
      ) {
        return;
      }
      setStackOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [stackOpen]);
  // FloatingPanel fires `virgil-stack-drop` with { cardKey, clientX,
  // clientY } when a popped-out float is released over the StackIcon.
  // Snapshot via the appropriate path (paragraph / heading / card),
  // then close the float. Card kinds outside the v1 set (example,
  // unknown) are silently skipped.
  useEffect(() => {
    const onDrop = (raw: Event) => {
      const detail = (raw as CustomEvent<{
        cardKey: string;
        clientX: number;
        clientY: number;
      }>).detail;
      if (!detail || typeof detail.cardKey !== "string") return;
      const cardKey = detail.cardKey;
      // Dual-read the dropped float's key (AF `float:` grammar + legacy).
      // (Stage 5 retires this prefix path in favor of `Floatable.snapshotForStack`.)
      const parsed = parseAnyKey(cardKey);
      if (!parsed) return;
      const id = parsed.id;
      const source = { docId: stackSourceRef.current.docId };
      let item: StackItemType | null = null;
      const mainEd = innerRef.current?.getEditor() ?? null;
      if (parsed.domain === "textobject" && parsed.kind === "paragraph") {
        if (mainEd) item = snapshotParagraph(mainEd, id, source);
      } else if (parsed.domain === "textobject" && parsed.kind === "heading") {
        if (mainEd) item = snapshotHeadingSection(mainEd, id, source);
      } else if (parsed.domain === "card" && isCardKind(parsed.kind)) {
        // Translate the canonical kind → its legacy keyPrefix → StackCardKind
        // (e.g. `revision-comment` → `revision` → `comment`; `bib` →
        // `bibliography`). `cardKeyPrefixToStackKind` keys on the legacy prefix.
        const stackKind = cardKeyPrefixToStackKind(
          CARD_REGISTRY[parsed.kind].keyPrefix,
        );
        if (stackKind && stackKind !== "example") {
          const cardData = resolveCardData(stackKind, id, {
            notesHook,
            todosHook,
            archiveHook,
            revisionsHook,
            cutterHook,
            footnotesHook,
            citationsHook,
          });
          if (cardData) {
            item = snapshotCard(stackKind, cardData, source, {
              getBibEntry: citationsHook.getBibEntry,
            });
          }
        }
      }
      if (item) addStackItem(item);
      // Close the source float regardless of snapshot success — the
      // user's intent is clear.
      viewPrefs?.closeCardPopout(cardKey);
      // Open the strip so the new item is visible.
      if (item) setStackOpen(true);
    };
    window.addEventListener("virgil-stack-drop", onDrop as EventListener);
    return () => {
      window.removeEventListener("virgil-stack-drop", onDrop as EventListener);
    };
  }, [
    innerRef,
    viewPrefs,
    notesHook,
    todosHook,
    archiveHook,
    revisionsHook,
    cutterHook,
    footnotesHook,
    citationsHook,
  ]);

  // ── Document load + compile state ─────────────────────────────────
  // `useDocument` reads its docId+pipeline from the surrounding
  // `<DocPipeline>` ancestor (mandatory — it throws otherwise). The
  // ancestor's `key={docId}` forces a full remount on doc switch, so
  // every closure here closes over a single doc's worth of state. Its
  // `content` is used as the editor seed only when `initialContent`
  // isn't supplied; the Reader supplies its own (UUID-tagged +
  // sidecar-aware parse) so that path stays unchanged.
  const docHook = useDocument();

  // ── Per-doc editor UI state (last-edited paragraph + section folds) ──
  // Captures cursor paragraph (debounced) and fold state (immediate) to
  // `editor-state.json`. The restore effect below waits for the editor,
  // the doc content, AND the sidecar load — the sidecar is async and
  // can resolve after the editor mounts, so depending on `loaded` is
  // mandatory to avoid restoring the pre-load default.
  const uiStateHook = useEditorUIState(docId, editor);
  const uiRestoredRef = useRef(false);
  useEffect(() => {
    if (uiRestoredRef.current) return;
    if (!editor || !docHook.content || !uiStateHook.loaded) return;
    const ui = uiStateHook.stateRef.current;
    uiRestoredRef.current = true;
    if (ui.foldedSections.length > 0) {
      innerRef.current?.setFolded(ui.foldedSections);
    }
    if (ui.lastParagraphId) {
      innerRef.current?.restoreCursorToParagraph(ui.lastParagraphId);
    }
  }, [editor, docHook.content, uiStateHook.loaded, uiStateHook.stateRef]);

  const docContentReady = docHook.content != null;
  useEffect(() => {
    if (!docContentReady || !editor) return;
    setReady(true);
  }, [docContentReady, editor]);

  // Compile state — `pdfBlobUrl`, `lastCompileTime`, `pdfStale` live
  // here so they bubble up via `paneState` for the shell's Virgil bar
  // (PDF stale-dot, Compile spinner). Reset on docId change so
  // switching docs never carries stale PDF bytes between paper folders.
  //
  // `lastEditTime` is a ref, not state — it's written on every
  // keystroke and was previously a `useState` setter, which forced a
  // full EditorPane re-render per keystroke even though the only
  // consumer of the value is the `pdfStale` boolean (which only
  // transitions false→true once per compile cycle). The ref carries
  // the timestamp; the boolean tracks the only thing React actually
  // needs to know about.
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [lastCompileTime, setLastCompileTime] = useState<number | null>(null);
  const lastEditTimeRef = useRef<number | null>(null);
  const [pdfStale, setPdfStale] = useState(false);
  const pdfStaleRef = useRef(false);
  pdfStaleRef.current = pdfStale;
  const lastCompileTimeRef = useRef<number | null>(null);
  lastCompileTimeRef.current = lastCompileTime;
  const latestPdfBytes = useRef<Uint8Array | null>(null);

  useEffect(() => {
    setLastCompileTime(null);
    setPdfStale(false);
    lastEditTimeRef.current = null;
    latestPdfBytes.current = null;
    return () => {
      // Revoke the previous doc's blob URL on switch / unmount so
      // browser memory doesn't leak across many doc swaps.
      setPdfBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [docId]);

  const handleCompileSuccess = useCallback(
    (pdfBytes: Uint8Array) => {
      latestPdfBytes.current = pdfBytes;
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], {
        type: "application/pdf",
      });
      setPdfBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
      setLastCompileTime(Date.now());
      // Compile lands fresh → PDF is in sync until next edit.
      setPdfStale(false);
    },
    [],
  );

  const compileHook = useLatexCompile(docId, {
    onDocumentClassMismatch,
    onCompileSuccess: handleCompileSuccess,
  });

  // Word counts — surfaces in the WordCount panel below. Cheap to
  // compute even when the panel isn't open.
  const wordCountHook = useWordCount(editor);

  // Citation creation handlers — `handleCitationCreated` lands as
  // `onCitationCreated` in the `CitationDisplayContext` so panel
  // mini-editors (notes, footnotes) can register fresh `\cite{}` drops
  // and get back the display text for their Citation node.
  const { handleCitationCreated } = useCitationActions({
    editorRef: innerRef,
    getCitationDisplayText: citationsHook.getDisplayText,
    addCitation: citationsHook.addCitation,
  });

  // Sync every editor citation node with the panel's CitationRef store:
  //   - displayText follows whatever getDisplayText(command) yields
  //   - command follows the panel's latest CitationRef.command, so that
  //     changing the cite-type in the citation card (e.g. \citet → \citep)
  //     refreshes the inline citation in the editor body
  // Runs whenever bibEntries, citations, or the display-formatter change.
  // Lives here (shared layer) so the Reader — which mounts EditorPane
  // without EditorLayout — inherits it.
  useEffect(() => {
    if (!editor) return;
    const cits = innerRef.current?.getCitations() ?? [];
    if (cits.length === 0) return;
    const panelById = new Map(
      citationsHook.citations.map((c) => [c.id, c]),
    );
    for (const c of cits) {
      const panelRef = panelById.get(c.citationId);
      const nextCommand = panelRef?.command ?? c.command;
      const nextDisplay = citationsHook.getDisplayText(nextCommand);
      const commandChanged = nextCommand !== c.command;
      const displayChanged = nextDisplay !== c.displayText;
      if (commandChanged || displayChanged) {
        innerRef.current?.updateCitationDisplay(
          c.citationId,
          nextDisplay,
          commandChanged ? nextCommand : undefined,
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    citationsHook.bibEntries,
    citationsHook.citations,
    citationsHook.getDisplayText,
    editor,
  ]);

  // Sync citation nodes from the editor into `citationsHook.citations`
  // (the sidecar-backed CitationRef list the Citations / Bibliography
  // panels read). Editor regenerates citation ids on each parse, so
  // prev anchored ids never match — only entries flagged unanchored
  // survive the merge (handled inside `syncFromEditor`). Runs once per
  // editor mount; subsequent add / delete go through the imperative
  // hooks and don't need a re-sync.
  useEffect(() => {
    if (!editor) return;
    const editorCits = innerRef.current?.getCitations() ?? [];
    citationsHook.syncFromEditor(editorCits);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // ── CardCreation auxiliary callbacks ─────────────────────────────
  // Footnotes live in the editor (not a sidecar), so the pristine flow
  // marks them explicitly via this small callback. Discard is wired
  // separately below: when the click-away watcher fires for a pristine
  // footnote, the editor's `deleteFootnote` handle removes it.
  const markFootnotePristine = useCallback(
    (id: string) => { footnotePristine.markNew(id); },
    [footnotePristine],
  );
  const getFootnoteCount = useCallback(
    () => innerRef.current?.getFootnotes().length ?? 0,
    [],
  );
  // setActiveLeft/setActiveRight stubs — Reader has no rail focus, so
  // a no-op suffices. Real ones land if/when Reader gets card-creation.
  const stubSetActive = useCallback(() => {}, []);
  // Pop a card into a floating window at the given anchor rect. Mirrors
  // EditorLayout's previous shell-side implementation (see prior path-A
  // notes). Prefix-string convention matches `useCardCreation`'s kind
  // argument — `"note" | "cutter-comment" | "revision" | …`. Reader
  // (no `viewPrefs`) leaves popouts as a no-op.
  const popCardAtAnchor = useCallback(
    (cardKind: string, cardId: string, anchorRect: DOMRect | null) => {
      if (!viewPrefs) return;
      // Build the unified `float:card:<kind>:<id>` key. `cardKind` is the legacy
      // popout prefix (e.g. `revision` → `revision-comment`); the canonicalizing
      // helper maps it and matches the card's own `cardKey` (via cardPopKey).
      const key = migrateLegacyKeyToFloat(`${cardKind}:${cardId}`);
      const pos = computeSpawnPosition(anchorRect, {
        width: POPUP_W,
        height: POPUP_H,
      });
      viewPrefs.setCardFloatPosition(key, pos);
      if (!viewPrefs.prefs.poppedOutCards.includes(key)) {
        viewPrefs.toggleCardPopout(key);
      }
    },
    [viewPrefs],
  );

  // ── TexBlock popped predicate ─────────────────────────────────────
  // The texBlock NodeView reads this through its extension options to
  // render `.is-popped` chrome when its float is open. Other kinds had
  // analogous predicates here, but only to drive the per-NodeView
  // grips that Phase D4 deleted — those are gone now.
  const texBlockIsPoppedRef = useRef<(uuid: string) => boolean>(
    () => false,
  );
  if (viewPrefs) {
    const popped = viewPrefs.prefs.poppedOutCards;
    // AF unified the key to `float:textobject:texBlock:<uuid>`; the
    // `textobject:` (pre-flip) and bare `texBlock:` (pre-D10) fallbacks cover
    // any keys the migration legs haven't rewritten yet.
    texBlockIsPoppedRef.current = (uuid) =>
      popped.includes(textObjectPopoutKey({ kind: "texBlock", id: uuid })) ||
      popped.includes(`textobject:texBlock:${uuid}`) ||
      popped.includes(`texBlock:${uuid}`);
  }
  // Per-doc PoppedCardsContext value. Built from the `viewPrefs` prop so
  // both the main app (full `useViewPrefs`) and the Library Reader
  // (`useReaderViewPrefs` session shim) supply the same shape. Consumers
  // (panel cards, SelectionDragHandle, paragraph/heading/example floats)
  // read this via `usePoppedCards()` and tolerate a `null` value when
  // `viewPrefs` is absent.
  const poppedCardsValue = useMemo<PoppedCardsValue | null>(() => {
    if (!viewPrefs) return null;
    const isPopped = (key: string) => viewPrefs.prefs.poppedOutCards.includes(key);
    return {
      poppedKeys: viewPrefs.prefs.poppedOutCards,
      isPopped,
      toggle: viewPrefs.toggleCardPopout,
      toggleAtAnchor: (key, anchor) => {
        if (!isPopped(key)) {
          const pos = computeSpawnPosition(anchor, { width: POPUP_W, height: POPUP_H });
          viewPrefs.setCardFloatPosition(key, pos);
        }
        viewPrefs.toggleCardPopout(key);
      },
      popOutAtRect: (key, rect) => {
        if (isPopped(key)) return;
        viewPrefs.setCardFloatPosition(key, rect);
        viewPrefs.toggleCardPopout(key);
      },
      close: viewPrefs.closeCardPopout,
      getFloatPosition: (key) => viewPrefs.prefs.cardFloatPositions[key],
      setFloatPosition: viewPrefs.setCardFloatPosition,
      recordFocus: (key) => viewPrefs.focusFloating({ kind: "card", key }),
      floatZIndex: viewPrefs.cardFloatZIndex,
    };
  }, [viewPrefs]);

  // Drop-mode adapters — one per attachment-card kind. Each wraps the
  // live hook in the generic `ParagraphAnchorApi` shape the spec
  // consumes. Memoized so the spec doesn't close over stale callbacks.
  const dropNotesApi = useMemo(
    () => ({
      exists: (id: string) => notesHook.notes.some((n) => n.id === id),
      getAnchorTextObjectIds: (id: string) => {
        const n = notesHook.notes.find((nn) => nn.id === id);
        return n ? getLinkedTextObjectIds(n) : [];
      },
      addTextObjectLink: notesHook.addNoteTextObjectId,
      removeTextObjectLink: notesHook.removeNoteTextObjectId,
      preserveModeBAnchor: notesHook.preserveModeBAnchor,
    }),
    [notesHook.notes, notesHook.addNoteTextObjectId, notesHook.removeNoteTextObjectId, notesHook.preserveModeBAnchor],
  );
  const dropHighlightsApi = useMemo(
    () => ({
      exists: (id: string) => notesHook.highlights.some((h) => h.id === id),
      getAnchorTextObjectIds: (id: string) => {
        const h = notesHook.highlights.find((hh) => hh.id === id);
        return h ? getLinkedTextObjectIds(h) : [];
      },
      addTextObjectLink: notesHook.addHighlightTextObjectId,
      removeTextObjectLink: notesHook.removeHighlightTextObjectId,
      preserveModeBAnchor: notesHook.preserveModeBAnchor,
    }),
    [notesHook.highlights, notesHook.addHighlightTextObjectId, notesHook.removeHighlightTextObjectId, notesHook.preserveModeBAnchor],
  );
  const dropTodosApi = useMemo(
    () => ({
      exists: (id: string) => todosHook.items.some((t) => t.id === id),
      getAnchorTextObjectIds: (id: string) => {
        const t = todosHook.items.find((tt) => tt.id === id);
        return t ? getLinkedTextObjectIds(t) : [];
      },
      addTextObjectLink: todosHook.addParagraphId,
      removeTextObjectLink: todosHook.removeParagraphId,
    }),
    [todosHook.items, todosHook.addParagraphId, todosHook.removeParagraphId],
  );
  const dropArchiveApi = useMemo(
    () => ({
      exists: (id: string) => archiveHook.snippets.some((s) => s.id === id),
      getAnchorTextObjectIds: (id: string) => {
        const s = archiveHook.snippets.find((ss) => ss.id === id);
        return s ? getLinkedTextObjectIds(s) : [];
      },
      addTextObjectLink: archiveHook.addParagraphId,
      removeTextObjectLink: archiveHook.removeParagraphId,
    }),
    [archiveHook.snippets, archiveHook.addParagraphId, archiveHook.removeParagraphId],
  );
  const dropCutterApi = useMemo(
    () => ({
      exists: (id: string) => cutterHook.cards.some((c) => c.id === id),
      getAnchorTextObjectIds: (id: string) => {
        const c = cutterHook.cards.find((cc) => cc.id === id);
        return c ? getLinkedTextObjectIds(c) : [];
      },
      addTextObjectLink: cutterHook.addCardParagraphId,
      removeTextObjectLink: cutterHook.removeCardParagraphId,
    }),
    [cutterHook.cards, cutterHook.addCardParagraphId, cutterHook.removeCardParagraphId],
  );
  const dropRevisionsApi = useMemo(
    () => ({
      exists: (id: string) => revisionsHook.cards.some((c) => c.id === id),
      getAnchorTextObjectIds: (id: string) => {
        const c = revisionsHook.cards.find((cc) => cc.id === id);
        return c ? getLinkedTextObjectIds(c) : [];
      },
      addTextObjectLink: revisionsHook.addCardParagraphId,
      removeTextObjectLink: revisionsHook.removeCardParagraphId,
    }),
    [revisionsHook.cards, revisionsHook.addCardParagraphId, revisionsHook.removeCardParagraphId],
  );
  const dropReportsApi = useMemo(
    () => ({
      exists: (id: string) => reportsHook.cards.some((c) => c.id === id),
      getAnchorTextObjectIds: (id: string) => {
        const c = reportsHook.cards.find((cc) => cc.id === id);
        return c ? getLinkedTextObjectIds(c) : [];
      },
      addTextObjectLink: reportsHook.addCardParagraphId,
      removeTextObjectLink: reportsHook.removeCardParagraphId,
    }),
    [reportsHook.cards, reportsHook.addCardParagraphId, reportsHook.removeCardParagraphId],
  );

  // Wire the marginalia gutter drag → reanchor bridge to THIS pane's hook
  // instances. EditorLayout owns a duplicate copy of these hooks, but only
  // the EditorPane instances feed the rendered <Marginalia>. Dispatching
  // reanchor events into EditorLayout's mutators would update the wrong
  // state and leave the on-screen marker frozen.
  useAnchorRebindBridge({
    addTodoTextObjectId: todosHook.addParagraphId,
    removeTodoTextObjectId: todosHook.removeParagraphId,
    addNoteTextObjectId: notesHook.addNoteTextObjectId,
    removeNoteTextObjectId: notesHook.removeNoteTextObjectId,
    addArchiveTextObjectId: archiveHook.addParagraphId,
    removeArchiveTextObjectId: archiveHook.removeParagraphId,
    addCardParagraphId: cutterHook.addCardParagraphId,
    removeCardParagraphId: cutterHook.removeCardParagraphId,
  });

  // Stack-pull API — surfaces per-doc card-creation factories so the
  // stack-pull DropSpec can materialize fresh entities on pull. Each
  // method here mirrors the corresponding sidecar hook, ignoring the
  // source snapshot's id and generating a fresh one (paste-as-new).
  const dropStackApi = useMemo<StackPullApi>(() => {
    return {
      addNote: (paragraphId, seed) =>
        notesHook.addNote(paragraphId, (seed.content ?? undefined) as JSONContent | undefined),
      addHighlight: (paragraphId) =>
        notesHook.addHighlight(
          { anchorId: "", anchorText: "" },
          paragraphId,
          null,
        ),
      addTodo: (paragraphId, seed) => {
        const t = todosHook.addItem();
        if (seed.text) todosHook.updateItem(t.id, seed.text);
        if (paragraphId) todosHook.addParagraphId(t.id, paragraphId);
        return t;
      },
      addArchive: (paragraphId, seed) => {
        const s = archiveHook.archiveContent(seed.content ?? "");
        if (seed.title) archiveHook.updateSnippetTitle(s.id, seed.title);
        if (paragraphId) archiveHook.addParagraphId(s.id, paragraphId);
        return s;
      },
      addRevisionComment: (paragraphId, seed) => {
        const c = revisionsHook.addComment(
          paragraphId,
          (seed.content ?? undefined) as JSONContent | undefined,
        );
        return c;
      },
      addRevisionSuggestion: (paragraphId, seed) => {
        const c = revisionsHook.addSuggestion(
          paragraphId,
          seed.original_text || undefined,
        );
        // Best-effort copy of the meaningful fields.
        if (seed.suggested_text) {
          revisionsHook.updateSuggestionField(
            c.id,
            "suggested_text",
            seed.suggested_text,
          );
        }
        if (seed.explanation) {
          revisionsHook.updateSuggestionField(c.id, "explanation", seed.explanation);
        }
        return c;
      },
      addCutterComment: (paragraphId, seed) => {
        const c = cutterHook.addComment(
          paragraphId,
          (seed.content ?? undefined) as JSONContent | undefined,
        );
        return c;
      },
      addCutterSuggestion: (paragraphId, seed) => {
        const c = cutterHook.addSuggestion(
          paragraphId,
          seed.original_text || undefined,
        );
        if (seed.suggested_text) {
          cutterHook.updateSuggestionField(
            c.id,
            "suggested_text",
            seed.suggested_text,
          );
        }
        if (seed.explanation) {
          cutterHook.updateSuggestionField(c.id, "explanation", seed.explanation);
        }
        return c;
      },
      addFootnote: (seed) =>
        footnotesHook.addFootnote(
          (seed.content ?? "") as JSONContent | string,
        ),
      addCitation: (seed) =>
        citationsHook.addCitation(seed.command, undefined, true),
      upsertBibEntry: (entry) => citationsHook.addBibEntry(entry),
    };
  }, [
    notesHook,
    todosHook,
    archiveHook,
    revisionsHook,
    cutterHook,
    footnotesHook,
    citationsHook,
  ]);
  // Reader has no real `useViewPrefs` (that's per-window shell state).
  // Synthesize a minimal snapshot — `useCardCreation` reads only
  // `prefs.placements`, `prefs.activeLeft`, `prefs.activeRight`. With
  // an empty placements array, `ensurePanelActive` defaults to "right"
  // for every panel id and the no-op setters keep things quiet.
  const readerPrefs = useMemo<ViewPrefs>(
    () =>
      ({
        placements: [],
        activeLeft: null,
        activeRight: null,
        activeLeftBottom: null,
        activeRightBottom: null,
        splitLeftRatio: 0.5,
        splitRightRatio: 0.5,
        panelWidths: {},
        editorSplit: false,
        editorSplitRatio: 0.5,
        poppedOutPanels: [],
        poppedOutOrigins: {},
        floatPositions: {},
        panelModes: {},
        dockSlots: {},
        poppedOutCards: [],
        cardFloatPositions: {},
        showHighlights: true,
        hiddenHighlightTypes: [],
      }) as unknown as ViewPrefs,
    [],
  );

  // Prefer the explicit `placements` prop (main app passes
  // `prefs.placements`). Reader passes its placements through
  // `viewPrefs.prefs.placements` from `useReaderViewPrefs()`. The
  // empty-array fallback covers the (theoretical) case where neither
  // is supplied — strips render empty rather than crashing.
  const effectivePlacements: PanelPlacement[] =
    placements ?? viewPrefs?.prefs.placements ?? [];

  // Error state — declared early because `marginaliaMarkers` consumes
  // them. `compileHook` is at line ~734, so `allLatexErrors` resolves.
  const [selectedErrorId, setSelectedErrorId] = useState<string | null>(null);
  const [dismissedErrorIds, setDismissedErrorIds] = useState<Set<string>>(new Set());
  const dismissError = useCallback((id: string) => {
    setDismissedErrorIds((prev) => new Set(prev).add(id));
  }, []);
  const allLatexErrors: LatexError[] = compileHook.compileErrors;
  const errorSnippets = useMemo(() => new Map<string, string>(), []);
  const paragraphByErrorId = useMemo(() => new Map<string, string>(), []);
  const handleJumpToError = useCallback((_err: LatexError) => {
    // Code-editor jump (`scrollToLine`) lives in EditorLayout. When
    // the code-editor work moves into EditorPane, this routes there.
  }, []);

  // ── Confirm-dialog instance backing the shared `deleteMarginItem` ──
  // Surfaces the "This item has text. Delete it?" warning when the user
  // deletes the last anchor on a non-empty card via the gutter marker.
  // Distinct from `confirmHeadingDelete` below so the two dialogs can
  // coexist independently.
  const { confirm: confirmMarginItemDelete, dialog: confirmMarginItemDeleteDialog } =
    useConfirmDialog();

  // Per-kind handler bundles for the shared margin-item delete utility.
  // See `src/lib/cards/delete-margin-item.ts` — collapses the kind→hook
  // wiring that was previously duplicated inline in every onDelete.
  const marginItemHandlers = useMemo<Record<MarginItemKind, MarginItemHandlers>>(
    () =>
      buildMarginItemHandlers({
        notes: notesHook,
        archive: archiveHook,
        cutter: cutterHook,
        todos: todosHook,
        revisions: revisionsHook,
        reports: reportsHook,
      }),
    [
      notesHook.notes, notesHook.removeNoteTextObjectId, notesHook.deleteNote,
      archiveHook.snippets, archiveHook.removeParagraphId, archiveHook.deleteSnippet,
      cutterHook.cards, cutterHook.removeCardParagraphId, cutterHook.deleteCard,
      todosHook.items, todosHook.removeParagraphId, todosHook.deleteItem,
      revisionsHook.cards, revisionsHook.removeCardParagraphId, revisionsHook.deleteCard,
      reportsHook.cards, reportsHook.removeCardParagraphId, reportsHook.deleteCard,
      // The hook objects themselves change identity on every render; using
      // their individual fields above keeps this memo stable across renders
      // that don't actually change card state.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional, see above
    ],
  );

  const handleMarginItemDelete = useCallback(
    (kind: MarginItemKind, cardId: string, paragraphId: string, anchorId?: string) =>
      deleteMarginItem({
        kind,
        cardId,
        paragraphId,
        anchorId,
        handlers: marginItemHandlers[kind],
        confirm: confirmMarginItemDelete,
        editor: innerRef.current?.getEditor() ?? null,
      }),
    [marginItemHandlers, confirmMarginItemDelete],
  );

  // ── Marginalia markers ───────────────────────────────────────────
  // Walks every card hook (notes, reports, archive, todos, cutter,
  // revisions) plus the live latex-error list and emits one
  // `MarginaliaMarker` per linked paragraph. Mirrors EditorLayout's
  // pre-extraction shape but skips the cross-card hover linkage (no
  // hoveredEntityId state in EditorPane yet) and the `openForCard`
  // routing (basic select-then-activate is enough until popouts land).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const marginaliaMarkers = useMemo<MarginaliaMarker[]>(() => {
    // Re-resolve markers when anchors move between paragraphs (`rev.anchors`)
    // or the paragraph-UUID set changes (`rev.blocks`) — the revision branch
    // below does a live anchorId→paragraph walk. Card-store arrays (notes,
    // reports, …) and error state are their own deps; plain typing bumps
    // none of these, so markers don't recompute or shift per keystroke.
    void rev.anchors;
    void rev.blocks;
    const result: MarginaliaMarker[] = [];

    // Notes
    for (const n of notesHook.notes) {
      const pids = getLinkedTextObjectIds(n);
      if (pids.length === 0) continue;
      const anchor = getTextAnchor(n);
      for (const pid of pids) {
        result.push({
          id: `${n.id}:${pid}`,
          entityId: n.id,
          entityKind: "note",
          type: "note",
          textObjectId: pid,
          title: n.title || "Note",
          onClick: () => {
            setSelectedNoteId(n.id);
            setActivePanelKindBySide("notes");
          },
          onDelete: () => {
            void handleMarginItemDelete("note", n.id, pid, anchor?.anchorId);
          },
          anchorId: anchor?.anchorId,
        });
      }
    }

    // Archive snippets
    for (const snippet of archiveHook.snippets) {
      const pids = getLinkedTextObjectIds(snippet);
      if (pids.length === 0) continue;
      for (const pid of pids) {
        result.push({
          id: `${snippet.id}:${pid}`,
          entityId: snippet.id,
          entityKind: "archive",
          type: "archive",
          textObjectId: pid,
          title: "Archived snippet",
          onClick: () => {
            setSelectedArchiveId(snippet.id);
            setActivePanelKindBySide("archive");
          },
          onDelete: () => { void handleMarginItemDelete("archive", snippet.id, pid); },
        });
      }
    }

    // Revision comments / suggestions — live-resolve paragraph from anchor mark
    const ed = innerRef.current?.getEditor();
    if (ed) {
      for (const r of revisionsHook.cards) {
        if (r.kind === "suggestion" && r.status !== "pending") continue;
        const revAnchor = getTextAnchor(r);
        if (!revAnchor) continue;
        const anchorId = revAnchor.anchorId;
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
        const pid: string = paragraphId;
        result.push({
          id: `${r.id}:${pid}`,
          entityId: r.id,
          entityKind: r.kind === "suggestion" ? "revision-suggestion" : "revision-comment",
          type: "revision",
          textObjectId: pid,
          title: r.selectedText || "Revision",
          anchorId,
          onClick: () => {
            setSelectedCommentId(selectedCommentId === r.id ? null : r.id);
            setActivePanelKindBySide("revisions");
          },
          onDelete: () => {
            void handleMarginItemDelete("revision", r.id, pid, anchorId);
          },
        });
      }
    }

    // Cutter cards
    for (const c of cutterHook.cards) {
      const pids = getLinkedTextObjectIds(c);
      if (pids.length === 0) continue;
      const cardAnchor = getTextAnchor(c);
      const title = c.kind === "suggestion"
        ? c.explanation || "Suggestion"
        : c.text || "Comment";
      for (const pid of pids) {
        result.push({
          id: `${c.id}:${pid}`,
          entityId: c.id,
          entityKind: c.kind === "suggestion" ? "cutter-suggestion" : "cutter-comment",
          type: "cut",
          textObjectId: pid,
          title,
          onClick: () => {
            setSelectedCutterCardId(c.id);
            setActivePanelKindBySide("cutter");
          },
          onDelete: () => {
            void handleMarginItemDelete("cut", c.id, pid, cardAnchor?.anchorId);
          },
          anchorId: cardAnchor?.anchorId,
        });
      }
    }

    // Reports (report + report-request) — both kinds share the "report" marker
    for (const c of reportsHook.cards) {
      const pids = getLinkedTextObjectIds(c);
      if (pids.length === 0) continue;
      const cardAnchor = getTextAnchor(c);
      const title = c.kind === "report"
        ? (c.title || c.text || "Report")
        : (c.text || "Report request");
      for (const pid of pids) {
        result.push({
          id: `${c.id}:${pid}`,
          entityId: c.id,
          entityKind: c.kind,
          type: "report",
          textObjectId: pid,
          title,
          onClick: () => {
            setSelectedReportCardId(c.id);
            setActivePanelKindBySide("reports");
          },
          onDelete: () => {
            void handleMarginItemDelete("report", c.id, pid, cardAnchor?.anchorId);
          },
          anchorId: cardAnchor?.anchorId,
        });
      }
    }

    // Todo
    for (const item of todosHook.items) {
      const pids = getLinkedTextObjectIds(item);
      if (pids.length === 0) continue;
      for (const pid of pids) {
        result.push({
          id: `${item.id}:${pid}`,
          entityId: item.id,
          entityKind: "todo",
          type: "todo",
          textObjectId: pid,
          title: item.text || "Todo",
          muted: item.done,
          onClick: () => {
            setSelectedTodoId(item.id);
            setActivePanelKindBySide("todo");
          },
          onDelete: () => { void handleMarginItemDelete("todo", item.id, pid); },
        });
      }
    }

    // Errors — only emitted when not dismissed, paragraph resolved
    for (const err of allLatexErrors) {
      if (dismissedErrorIds.has(err.id)) continue;
      const pid = paragraphByErrorId.get(err.id);
      if (!pid) continue;
      result.push({
        id: `${err.id}:${pid}`,
        entityId: err.id,
        type: "error",
        textObjectId: pid,
        title: err.message.length > 80 ? err.message.slice(0, 80) + "…" : err.message,
        muted: err.severity === "info",
        onClick: () => {
          setSelectedErrorId(selectedErrorId === err.id ? null : err.id);
          setActivePanelKindBySide("errors");
        },
        onDelete: () => dismissError(err.id),
      });
    }

    return result;
  }, [
    notesHook.notes,
    archiveHook.snippets,
    todosHook.items,
    cutterHook.cards,
    revisionsHook.cards,
    reportsHook.cards,
    handleMarginItemDelete,
    allLatexErrors,
    dismissedErrorIds,
    paragraphByErrorId,
    selectedNoteId,
    selectedArchiveId,
    selectedTodoId,
    selectedCutterCardId,
    selectedReportCardId,
    selectedCommentId,
    selectedErrorId,
    rev.anchors,
    rev.blocks,
  ]);

  // Marginalia uses this to decide which gutter to render each marker
  // in — anchors on the left when a panel sits left, right otherwise.
  // Derived from `effectivePlacements` so the prop-supplied placements
  // (main app, post-7.8) and the Reader's synthetic right-only fallback
  // both flow through the same path.
  const marginaliaPanelSides = useMemo<Partial<Record<PanelId, "left" | "right" | null>>>(
    () => {
      const result: Partial<Record<PanelId, "left" | "right" | null>> = {};
      for (const p of effectivePlacements) result[p.id] = p.side;
      return result;
    },
    [effectivePlacements],
  );

  // Snapshot of paragraph UUIDs that host at least one gutter marker.
  // Read by the `MarginaliaAnchorGuard` ProseMirror plugin (see
  // `src/lib/tiptap/linked-anchor.ts`) to preserve a placeholder
  // paragraph with the same UUID when the user deletes the host
  // paragraph — anchored cards stay attached through incidental
  // editor edits. The plugin auto-discovers UUIDs that host
  // `linkedAnchor` marks in addition to this set, so cards without a
  // gutter icon (highlights) are also protected.
  const anchoredUuidsRef = useRef(new Set<string>());
  useMemo(() => {
    const set = new Set<string>();
    for (const m of marginaliaMarkers) set.add(m.textObjectId);
    anchoredUuidsRef.current = set;
  }, [marginaliaMarkers]);

  // View-toggle class tokens (dividers / hide-* / divider-width) for the
  // editor-pane-column className below — the ONE shared source
  // (`viewToggleClasses`) consumed by all three content surfaces: this page
  // column, every released float body (`.par-float-body`), and the drag
  // ghost overlay (`.lifted-text-overlay`). A new view toggle therefore
  // ports to all three by editing `viewToggleClasses` alone (Issue-12).
  // Empty string when no menuBar (Reader).
  const viewToggleCls = viewToggleClasses(menuBar);

  // Filter marginalia markers by the master toggle and per-type hide set
  // from the menu bundle. Reader (no menuBar) defaults to showing all
  // markers — `menuBar?.showMarginalia === false` is false for undefined.
  const visibleMarginaliaMarkers = useMemo(() => {
    if (menuBar?.showMarginalia === false) return [];
    const hidden = menuBar?.hiddenMarginaliaTypes;
    if (!hidden || hidden.size === 0) return marginaliaMarkers;
    return marginaliaMarkers.filter((m) => !hidden.has(m.type as MarginaliaType));
  }, [marginaliaMarkers, menuBar?.showMarginalia, menuBar?.hiddenMarginaliaTypes]);

  const cardCreation = useCardCreation({
    editorRef: innerRef,
    addNote: notesHook.addNote,
    addHighlight: notesHook.addHighlight,
    notesCards: notesHook.cards,
    deleteNote: notesHook.deleteNote,
    addCutterComment: cutterHook.addComment,
    addCutterSuggestion: cutterHook.addSuggestion,
    addRevisionComment: revisionsHook.addComment,
    addRevisionSuggestion: revisionsHook.addSuggestion,
    addReport: reportsHook.addReport,
    addReportRequest: reportsHook.addReportRequest,
    addTodo: todosHook.addItem,
    updateTodo: todosHook.updateItem,
    addTodoTextObjectId: todosHook.addParagraphId,
    addCitation: citationsHook.addCitation,
    archiveContent: archiveHook.archiveContent,
    updateArchiveSnippet: archiveHook.updateSnippet,
    addArchiveTextObjectId: archiveHook.addParagraphId,
    setSelectedArchiveId,
    setSelectedNoteId,
    setSelectedCutterCardId,
    setSelectedReportCardId,
    setSelectedCommentId,
    setSelectedTodoId,
    setSelectedFootnoteId,
    setSelectedCitationId,
    prefs: readerPrefs,
    setActiveLeft: stubSetActive,
    setActiveRight: stubSetActive,
    popCardAtAnchor: popCardAtAnchor,
    markFootnotePristine,
    getFootnoteCount,
    recentlyAdded,
  });

  // Register per-kind discard callbacks. The pristine manager's
  // pointerdown watcher fires these when the user clicks outside a
  // pristine card's DOM. Each effect re-registers when the
  // corresponding hook's delete callback identity changes.
  useEffect(
    () => notePristine.registerDiscard((id) => notesHook.deleteNote(id)),
    [notePristine, notesHook.deleteNote],
  );
  useEffect(
    () => cutPristine.registerDiscard((id) => cutterHook.deleteCard(id)),
    [cutPristine, cutterHook.deleteCard],
  );
  useEffect(
    () => reportPristine.registerDiscard((id) => reportsHook.deleteCard(id)),
    [reportPristine, reportsHook.deleteCard],
  );
  useEffect(
    () => todoPristine.registerDiscard((id) => todosHook.deleteItem(id)),
    [todoPristine, todosHook.deleteItem],
  );
  useEffect(
    () => citationPristine.registerDiscard((id) => citationsHook.deleteCitation(id)),
    [citationPristine, citationsHook.deleteCitation],
  );
  useEffect(
    () =>
      footnotePristine.registerDiscard((id) => {
        innerRef.current?.deleteFootnote(id);
      }),
    [footnotePristine],
  );

  // ─── Drag-handle action menu ────────────────────────────────────
  // Click on a paragraph / selection / heading drag handle opens a
  // popover menu of all the things you can do to that passage
  // (footnote, citation, note, todo, review, suggest edit,
  // cutter, duplicate, archive, delete). The dispatch hook resolves
  // the passage to a doc range, plants the selection over it, runs
  // the matching create path with `mode: "omni"`, and ensures the
  // omni-view is showing on the new card's panel side. Reader mode
  // (no viewPrefs) still computes a dispatch — the omni activation
  // steps no-op.
  //
  // Per-CardKind clone/delete is plugged in here from each per-doc
  // sidecar hook and exposed to the dispatcher via a stable API; the
  // dispatcher's duplicate/delete walkers iterate the doc range and
  // call `cardLifecycle.get(kind)?.clone/.delete` without per-kind
  // branches. See `src/panels/card-lifecycle-registry.tsx`.
  const cardLifecycleRegistry = useMemo<CardLifecycleRegistry>(
    () => ({
      footnote: {
        clone: footnotesHook.cloneFootnote,
        delete: footnotesHook.deleteFootnote,
      },
      citation: {
        clone: citationsHook.cloneCitation,
        delete: citationsHook.deleteCitation,
      },
      note: {
        clone: notesHook.cloneNote,
        delete: notesHook.deleteNote,
        bindAnchor: notesHook.bindAnchor,
      },
      highlight: {
        clone: notesHook.cloneHighlight,
        delete: notesHook.deleteNote,
        bindAnchor: notesHook.bindAnchor,
      },
      "revision-comment": {
        clone: revisionsHook.cloneComment,
        delete: revisionsHook.deleteCard,
        bindAnchor: revisionsHook.bindAnchor,
      },
      "revision-suggestion": {
        clone: revisionsHook.cloneSuggestion,
        delete: revisionsHook.deleteCard,
        bindAnchor: revisionsHook.bindAnchor,
      },
      "cutter-comment": {
        clone: cutterHook.cloneComment,
        delete: cutterHook.deleteCard,
        bindAnchor: cutterHook.bindAnchor,
      },
      "cutter-suggestion": {
        clone: cutterHook.cloneSuggestion,
        delete: cutterHook.deleteCard,
        bindAnchor: cutterHook.bindAnchor,
      },
    }),
    [footnotesHook, citationsHook, notesHook, revisionsHook, cutterHook],
  );
  const cardLifecycle = useCardLifecycleApi(cardLifecycleRegistry);
  // Dev-only: assert the provider satisfies exactly CARD_REGISTRY's declared
  // lifecycle (the 5 intentional gaps stay unwired; capability drift is loud).
  assertLifecycleCoverage(cardLifecycleRegistry);
  // Wide-scope warning dialog for destructive lifecycle actions
  // (Archive / Delete on any kind; Duplicate on headings). Distinct
  // instance from the heading-lozenge × confirm so each owns its own
  // pending state. See ACTION-MENU-DIAGNOSIS.md cluster C5 +
  // post-refactor followup B3.
  const {
    confirm: confirmDragHandleAction,
    dialog: confirmDragHandleActionDialog,
  } = useConfirmDialog();
  // Single-button info-modal surface for Duplicate failure paths
  // (stale ref, schema rejection, empty slice). Same SystemDialog
  // primitive as `confirmDragHandleAction`, but `notify` always sends
  // `hideCancel: true` so only "OK" appears — no decision for the user
  // to make. See post-refactor followup B1.
  const {
    confirm: notifyDragHandleAction,
    dialog: notifyDragHandleActionDialog,
  } = useConfirmDialog();
  const dragHandleNotify = useCallback(
    (opts: { title?: string; message: string; tone?: "default" | "danger" }) => {
      // Fire-and-forget. The promise resolves true on OK; we don't
      // care about cancel since `hideCancel: true` removes it.
      void notifyDragHandleAction({
        title: opts.title,
        message: opts.message,
        tone: opts.tone,
        confirmLabel: "OK",
        hideCancel: true,
      });
    },
    [notifyDragHandleAction],
  );
  const dragHandleActions = useDragHandleActions({
    editorRef: innerRef,
    cardCreation,
    cardLifecycle,
    confirm: confirmDragHandleAction,
    notify: dragHandleNotify,
    prefs: viewPrefs?.prefs ?? readerPrefs,
    expandLeft: viewPrefs?.expandLeft ?? stubSetActive,
    expandRight: viewPrefs?.expandRight ?? stubSetActive,
    clearBlankIfSet: viewPrefs?.clearBlankIfSet ?? stubSetActive,
  });
  const [dragHandleMenuState, setDragHandleMenuState] = useState<{
    ref: DragHandleRef;
    anchorRect: DOMRect;
  } | null>(null);
  const openDragHandleMenu = useCallback(
    (ref: DragHandleRef, anchorRect: DOMRect) => {
      setDragHandleMenuState({ ref, anchorRect });
    },
    [],
  );
  const closeDragHandleMenu = useCallback(() => setDragHandleMenuState(null), []);
  const dragHandleMenuApi = useMemo<DragHandleMenuApi>(
    () => ({ open: openDragHandleMenu, dispatch: dragHandleActions.dispatch }),
    [openDragHandleMenu, dragHandleActions.dispatch],
  );

  // Heading-lozenge type-menu state. The vanilla DOM node view inside
  // VirgilEditor calls `openHeadingTypeMenu` with the chip's rect plus a
  // `onPick` callback; we render the React `<HeadingTypeMenu>` here and
  // route the user's pick back through the callback into the node view.
  const [headingTypeMenuState, setHeadingTypeMenuState] = useState<{
    anchorRect: DOMRect;
    currentLevel: number;
    onPick: (pick: HeadingTypePick) => void;
  } | null>(null);
  const openHeadingTypeMenu = useCallback(
    (params: { anchorRect: DOMRect; currentLevel: number; onPick: (pick: HeadingTypePick) => void }) => {
      setHeadingTypeMenuState(params);
    },
    [],
  );
  const closeHeadingTypeMenu = useCallback(() => setHeadingTypeMenuState(null), []);

  // Shared confirm-dialog instance for the heading lozenge's × button
  // and any other prompt-from-node-view flows that land here later.
  const { confirm: confirmHeadingDelete, dialog: confirmHeadingDeleteDialog } = useConfirmDialog();
  const handleConfirmHeadingDelete = useCallback(
    (typeName: string) =>
      confirmHeadingDelete({
        title: "Delete heading?",
        message: `Remove this ${typeName} heading. The body underneath stays in place.`,
        confirmLabel: "Delete heading",
        tone: "danger",
      }),
    [confirmHeadingDelete],
  );

  // Same shape for the figure annotation lozenge's × button.
  const { confirm: confirmFigureDelete, dialog: confirmFigureDeleteDialog } =
    useConfirmDialog();
  const handleConfirmFigureDelete = useCallback(
    () =>
      confirmFigureDelete({
        title: "Delete figure?",
        message: "Remove this figure and its caption.",
        confirmLabel: "Delete figure",
        tone: "danger",
      }),
    [confirmFigureDelete],
  );

  // Documentclass extracted from the resolved style preamble. Drives the
  // heading-type dropdown's per-entry enable/disable. Users who heavily
  // customise their in-doc preamble may diverge from this — the worst
  // case is the dropdown shows an entry as enabled when the class can't
  // render it; the existing `DocumentClassMismatchDialog` catches the
  // mismatch on next compile.
  const documentClassName = useMemo(() => {
    if (!documentStyleHook.styleId) return null;
    try {
      const preset = resolveStyle(documentStyleHook.styleId);
      return extractDocumentClass(preset.preamble)?.className ?? null;
    } catch {
      return null;
    }
  }, [documentStyleHook.styleId]);

  // ─── Detached-toolbar machinery (Path A 7.6 finish) ────────────────
  // Per-pane state for the three torn-off floating toolbars (Actions,
  // Formatting, Menu). The corresponding render blocks below gate on
  // `viewPrefs && menuBar && menuPortalReady`, so the Reader (no
  // menuBar) leaves all of this dormant.
  type DetachedToolbarEntry = { id: string; pos: { left: number; top: number } };
  const [detachedActions, setDetachedActions] = useState<DetachedToolbarEntry[]>([]);
  const [detachedFormatting, setDetachedFormatting] = useState<DetachedToolbarEntry[]>([]);
  const [detachedMenus, setDetachedMenus] = useState<DetachedToolbarEntry[]>([]);
  const [toolbarDragging, setToolbarDragging] = useState(false);
  const nextActionsIdRef = useRef(0);
  const nextFormattingIdRef = useRef(0);
  const nextMenuIdRef = useRef(0);
  // Ref to the docked MenuBar's wrapper so the grab-to-tear gesture
  // can compute its viewport position when spawning a detached copy.
  const dockedMenuBarRef = useRef<HTMLDivElement | null>(null);
  // Refs for the custom EditorScrollbar overlay. `editorColRef` points
  // at the editor-pane-column wrapper; `rowScrollRef` resolves to the
  // nearest scrolling ancestor of editor-pane-root after mount.
  const editorColRef = useRef<HTMLDivElement | null>(null);
  const rowScrollRef = useRef<HTMLElement | null>(null);
  const editorPaneRootRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const root = editorPaneRootRef.current;
    if (!root) {
      rowScrollRef.current = null;
      return;
    }
    // Walk up to the nearest ancestor whose computed `overflow-y` allows
    // scrolling. EditorLayout wraps the EditorPane mount in a
    // `flex-1 min-h-0 overflow-x-auto overflow-y-auto` div; the Reader
    // does the same on its outer wrapper. Either way the scroll
    // container is one ancestor up; iterate to be safe.
    let el: HTMLElement | null = root.parentElement;
    while (el) {
      const cs = getComputedStyle(el);
      if (cs.overflowY === "auto" || cs.overflowY === "scroll") {
        rowScrollRef.current = el;
        return;
      }
      el = el.parentElement;
    }
    rowScrollRef.current = null;
  }, []);
  // Body-portal targets aren't ready on first render in some test/SSR
  // setups; flip ready after first effect tick so the createPortal
  // calls below find a live document.body. Cheap and effectively
  // synchronous in normal browser runs.
  const [menuPortalReady, setMenuPortalReady] = useState(false);
  useEffect(() => {
    setMenuPortalReady(true);
  }, []);

  // Track the docked MenuBar's rendered width so the section lozenge can
  // compute a max-width that keeps it from crossing into the centered
  // MenuBar's column. Exposed as `--menubar-width` on editor-pane-column.
  // Read width synchronously on mount so it's set even before the
  // ResizeObserver's initial async callback (which Strict Mode cleanup
  // would otherwise cancel).
  const [menubarWidth, setMenubarWidth] = useState(0);
  useEffect(() => {
    const el = dockedMenuBarRef.current;
    if (!el) {
      setMenubarWidth(0);
      return;
    }
    setMenubarWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setMenubarWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [menuBar]);

  // ── In-text margin-edit mode ────────────────────────────────────
  // Entered from ViewMenu → "Margins…". While active, four guides
  // render over the editor column (L/R vertical, T/B horizontal);
  // dragging them updates `liveMargins`, which the editor reads via
  // `--editor-pl/pr/pt/pb` CSS vars on the column wrapper. Save
  // commits to viewPrefs; Cancel/Escape restores the captured
  // snapshot. Reader doesn't pass `viewPrefs` so this whole block
  // stays dormant. State machine lives in `useMarginEdit`.
  const {
    marginEditMode,
    effective: effectiveMargins,
    symmetricX: marginSymmetricX,
    symmetricY: marginSymmetricY,
    enter: enterMarginEditMode,
    save: saveMarginEdit,
    cancel: cancelMarginEdit,
    beginDrag: beginMarginDrag,
  } = useMarginEdit({ viewPrefs });
  // When the Code pane is open and SplitWithCode signals `compressed`,
  // tighten the horizontal gutters down to a small floor so the
  // editor's column hits a smaller hard minimum. Vertical margins are
  // unaffected — compression only happens because of horizontal
  // squeeze, and stomping vertical prefs would be gratuitous.
  // `COMPRESSED_GUTTER_PX` is intentionally a literal: this is a
  // mechanical layout floor, not a preference, so it doesn't belong
  // in viewPrefs.
  const COMPRESSED_GUTTER_PX = 16;
  const codeSplit = useCodePaneSplit();
  const compressX = codeSplit.compressed;
  const effectiveLeftMargin = compressX
    ? Math.min(effectiveMargins.left, COMPRESSED_GUTTER_PX)
    : effectiveMargins.left;
  const effectiveRightMargin = compressX
    ? Math.min(effectiveMargins.right, COMPRESSED_GUTTER_PX)
    : effectiveMargins.right;
  const effectiveTopMargin = effectiveMargins.top;
  const effectiveBottomMargin = effectiveMargins.bottom;

  // ── Top / bottom gutter drag ────────────────────────────────────
  // Restored from pre-extraction. The gutter spacers below sit above
  // and below the editor pod inside `editor-pane-column`; their
  // basis is `viewPrefs.{topGutter,bottomGutter}`. The drag handles
  // are 4px-tall horizontal bars (`drag-gap-h`) immediately adjacent
  // to the pod; dragging them updates the gutter pref live.
  const gutterStartY = useRef(0);
  const gutterStartVal = useRef(0);
  const onTopGutterMove = useCallback((e: MouseEvent) => {
    const delta = e.clientY - gutterStartY.current;
    const next = Math.max(0, gutterStartVal.current + delta);
    viewPrefs?.setEditorTopGutter(next);
  }, [viewPrefs]);
  const onBottomGutterMove = useCallback((e: MouseEvent) => {
    const delta = gutterStartY.current - e.clientY;
    const next = Math.max(0, gutterStartVal.current + delta);
    viewPrefs?.setEditorBottomGutter(next);
  }, [viewPrefs]);
  const topGutterDrag = useDragGap({ cursor: 'row-resize', onMove: onTopGutterMove, deadzone: 3 });
  const bottomGutterDrag = useDragGap({ cursor: 'row-resize', onMove: onBottomGutterMove, deadzone: 3 });
  const onTopGutterDown = useCallback((e: React.MouseEvent) => {
    if (!viewPrefs) return;
    gutterStartY.current = e.clientY;
    gutterStartVal.current = viewPrefs.topGutter;
    topGutterDrag.onMouseDown(e);
  }, [topGutterDrag, viewPrefs]);
  const onBottomGutterDown = useCallback((e: React.MouseEvent) => {
    if (!viewPrefs) return;
    gutterStartY.current = e.clientY;
    gutterStartVal.current = viewPrefs.bottomGutter;
    bottomGutterDrag.onMouseDown(e);
  }, [bottomGutterDrag, viewPrefs]);

  // Snap lines disabled — floating toolbars follow the cursor freely
  // (viewport clamp still applies in resolveDragPosition). Re-enable by
  // restoring the computeSnapGrid call and its colRect/splitPaneRects deps.
  const snapGrid = useMemo<SnapGrid>(() => ({ h: [], v: [] }), []);
  const snapGridRef = useRef(snapGrid);
  snapGridRef.current = snapGrid;

  // Shared drag routine for every floating toolbar — single-instance
  // (MenuBar) and multi-instance (Actions, Formatting). Runs the snap
  // grid math per frame against the wrapper resolved by `getWrapper()`.
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

  const handleMenuGrabStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const menuEl = dockedMenuBarRef.current;
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
  }, [beginToolbarDrag, menuBar]);

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

  // ─── Toolbar action handlers (Path A 7.6 finish) ──────────────────
  // Each creates a card in its corresponding panel — selection-anchored
  // when text is selected, blank otherwise. `cardCreation` here uses
  // the local stub `popCardAtAnchor` (no floating popup spawn) until
  // Path A 7.8 wires the real one. EditorLayout still owns the active
  // copies until then; these stay dormant.

  const readSelection = useCallback(() => {
    const ed = innerRef.current?.getEditor();
    if (!ed || !innerRef.current) return null;
    const { from, to } = ed.state.selection;
    if (from === to) return null;
    const text = ed.state.doc.textBetween(from, to, " ").trim();
    if (!text) return null;
    return { ed, from, to, text, editorHandle: innerRef.current };
  }, []);

  const handleToolbarAddComment = useCallback((anchorRect: DOMRect | null) => {
    const sel = readSelection();
    let anchorId: string | null = null;
    if (sel) {
      const record = createLinkedAnchor(sel.ed, "revision");
      anchorId = record?.anchorId ?? null;
      try { window.getSelection()?.removeAllRanges(); } catch { /* ignore */ }
    }
    const anchor = anchorId && sel?.text
      ? { anchorId, anchorText: sel.text }
      : undefined;
    const created = revisionsHook.addComment(null, undefined, anchor);
    if (anchorId) {
      const ed = innerRef.current?.getEditor();
      if (ed) updateLinkedAnchorCard(ed, anchorId, "revision-comment", created.id);
    }
    popCardAtAnchor("revision", created.id, anchorRect);
  }, [readSelection, revisionsHook, popCardAtAnchor]);

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

  // Highlight needs a live text-range selection (Adobe-style); a click
  // with no selection is a no-op.
  const handleToolbarAddHighlight = useCallback((anchorRect: DOMRect | null) => {
    const sel = readSelection();
    if (!sel) return;
    const paragraphId = sel.editorHandle.ensureParagraphUuid(sel.from);
    const record = createLinkedAnchor(
      sel.ed,
      "highlight",
      undefined,
      undefined,
      { tintColor: "#fbbf24" },
    );
    if (!record) return;
    const card = cardCreation.createHighlight({
      anchor: { anchorId: record.anchorId, anchorText: record.text },
      paragraphId,
      anchorRect,
    });
    updateLinkedAnchorCard(sel.ed, record.anchorId, "highlight", card.id);
    try { window.getSelection()?.removeAllRanges(); } catch { /* ignore */ }
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
    const card = cardCreation.createCutterComment({ paragraphId, anchor, anchorRect });
    if (sel && anchor) {
      updateLinkedAnchorCard(sel.ed, anchor.anchorId, "cutter-comment", card.id);
      try { window.getSelection()?.removeAllRanges(); } catch { /* ignore */ }
    }
  }, [readSelection, cardCreation]);

  const handleToolbarArchive = useCallback((anchorRect: DOMRect | null) => {
    // Call `archiveSelection` first — its slice-based emptiness check
    // (`slice.size === 0`) is authoritative. Atom-only ranges have
    // empty plain text (so `readSelection` returns null) but still
    // produce a non-empty slice. Bypass `readSelection` for archive:
    // the slice IS the answer, and we no longer create orphan empty
    // snippets when the selection has no text.
    if (!innerRef.current) return;
    const result = innerRef.current.archiveSelection("");
    if (!result) return;
    const sel = readSelection();
    const snippet = archiveHook.archiveContent(result.content ?? sel?.text ?? "");
    if (result.paragraphId)
      archiveHook.addParagraphId(snippet.id, result.paragraphId);
    popCardAtAnchor("archive", snippet.id, anchorRect);
  }, [readSelection, archiveHook, popCardAtAnchor]);

  const handleToolbarCreateFootnote = useCallback((anchorRect: DOMRect | null) => {
    cardCreation.createFootnote({ fromSelection: !!readSelection(), anchorRect });
  }, [readSelection, cardCreation]);

  const handleToolbarInsertCitation = useCallback((anchorRect: DOMRect | null) => {
    cardCreation.createCitation({ anchorRect });
  }, [cardCreation]);

  const actionsBundle = useMemo<ActionToolbarCallbacks>(() => ({
    onAddComment: handleToolbarAddComment,
    onAddNote: handleToolbarAddNote,
    onAddHighlight: handleToolbarAddHighlight,
    onAddTodo: handleToolbarAddTodo,
    onCutSelection: handleToolbarAddCut,
    onArchive: handleToolbarArchive,
    onCreateFootnote: handleToolbarCreateFootnote,
    onInsertCitation: handleToolbarInsertCitation,
  }), [
    handleToolbarAddComment,
    handleToolbarAddNote,
    handleToolbarAddHighlight,
    handleToolbarAddTodo,
    handleToolbarAddCut,
    handleToolbarArchive,
    handleToolbarCreateFootnote,
    handleToolbarInsertCitation,
  ]);

  // Editor-derived citations: BibliographyHost wants `keys` (parsed
  // from the LaTeX `\cite{a,b}` / `\cites{a}{b}` command) plus the
  // citation's position. Mirror the same regex EditorLayout uses
  // (`{(...)}` repeated, then split on `,`).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const allEditorCitations = useMemo<Array<{
    citationId: string;
    command: string;
    keys: string[];
    pos: number;
  }>>(() => {
    if (!editor) return [];
    const cits = innerRef.current?.getCitations() ?? [];
    return cits.map((c) => {
      const allMatches = [...c.command.matchAll(/\{([^}]+)\}/g)];
      const keys = allMatches.flatMap((m) =>
        m[1].split(",").map((k: string) => k.trim()),
      );
      return { citationId: c.citationId, command: c.command, keys, pos: c.pos };
    });
  }, [editor, rev.citations]);
  const citationPositionMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of allEditorCitations) {
      if (!map.has(c.citationId)) map.set(c.citationId, c.pos);
    }
    return map;
  }, [allEditorCitations]);

  // BibliographyHost wants a `setBibActiveCitationId` setter; the
  // host's wiring uses it for cross-panel highlight sync. In Reader
  // mode there's no companion Citations panel today, so we keep a
  // local slot to satisfy the prop.
  const [, setBibActiveCitationId] = useState<string | null>(null);

  // CitationsHost pending-create state — the panel "+ Add citation"
  // path queues a draft until the user finishes it. Reader mode never
  // surfaces the affordance (read-only), but the hosts read these
  // unconditionally so we keep local slots. Step 7.8 hands real shell
  // state down via props if needed.
  const [pendingCitationCreate, setPendingCitationCreate] = useState<string | null>(null);
  const [pendingCitationMode, setPendingCitationMode] = useState<"anchored" | "unanchored">("anchored");

  // Errors panel state. The full lint+compile pipeline lives in
  // EditorLayout (lint needs `codeEditorText` from CodeMirror, which
  // hasn't moved here yet). For now compile errors flow through;
  // lint stays empty until that piece lands.
  // (Error state moved earlier — see the block before the
  // marginaliaMarkers useMemo. `errorSnippets` / `paragraphByErrorId`
  // remain empty maps; codeEditorText-based mapping lands when code
  // view moves into EditorPane.)

  // SearchHost state — `searchState` survives panel close/reopen.
  // `openItemInPanel` swaps to the target panel and reuses the
  // side-aware setter so cross-panel jumps land where the user has
  // placed the destination.
  const [searchState, setSearchState] = useState<SearchPanelState>(INITIAL_SEARCH_STATE);
  const [searchHighlightRange, setSearchHighlightRange] = useState<{ from: number; to: number } | null>(null);
  void searchHighlightRange; // surfaces in the editor's highlight overlay post-7.8

  // Archive helpers — anchored-id set + paragraph-order sort matching
  // EditorLayout. The ArchivePanel uses these to surface anchored
  // snippets at the top of the list.
  const anchoredArchiveIds = useMemo<Set<string>>(() => {
    const ids = new Set<string>();
    for (const s of archiveHook.snippets) {
      if (getLinkedTextObjectIds(s).length > 0) ids.add(s.id);
    }
    return ids;
  }, [archiveHook.snippets]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sortedArchiveSnippets = useMemo(() => {
    const paragraphOrder = new Map<string, number>();
    const ed = innerRef.current?.getEditor();
    if (ed) {
      let idx = 0;
      ed.state.doc.descendants((node) => {
        if (isAnchorableNode(node.type) && node.attrs?.uuid) {
          paragraphOrder.set(node.attrs.uuid as string, idx++);
        }
        return true;
      });
    }
    return [...archiveHook.snippets].sort((a, b) => {
      const aPids = getLinkedTextObjectIds(a);
      const bPids = getLinkedTextObjectIds(b);
      const aPos = aPids.length > 0 ? paragraphOrder.get(aPids[0]) : undefined;
      const bPos = bPids.length > 0 ? paragraphOrder.get(bPids[0]) : undefined;
      if (aPos != null && bPos != null) return aPos - bPos;
      if (aPos != null) return -1;
      if (bPos != null) return 1;
      return 0;
    });
  }, [archiveHook.snippets, rev.blocks, editor]);
  // ArchiveHost callbacks — Reader chrome hides this panel, so insert
  // / restore / delete / capture all go through the hook directly with
  // no shell-side coordination. The full "archive selection from
  // editor" flow (which spawns a floating card) lands when the
  // toolbar/popout system moves into EditorPane.
  const handleArchiveInsert = useCallback((id: string) => {
    const found = archiveHook.snippets.find((s) => s.id === id);
    if (found && innerRef.current) {
      innerRef.current.restoreArchive(found.content);
      archiveHook.deleteSnippet(id);
      setSelectedArchiveId(null);
    }
  }, [archiveHook]);
  const handleArchiveRestore = useCallback((id: string) => {
    const snippet = archiveHook.restoreSnippet(id);
    if (snippet) innerRef.current?.restoreArchive(snippet.content);
    setSelectedArchiveId(null);
  }, [archiveHook]);
  const handleArchiveDelete = useCallback((id: string) => {
    archiveHook.deleteSnippet(id);
    setSelectedArchiveId(null);
  }, [archiveHook]);

  // Footnote add/edit/delete bridges — wrap the editor handle's
  // imperative API. The Reader (`editable: false`) won't invoke
  // these (TipTap blocks mutations), but the hosts wire them anyway.
  const handleAddFootnote = useCallback((): string => {
    // Inserts an empty footnote atom at the cursor (or doc start)
    // via the editor's imperative API. Reader chrome's
    // `editableCardKinds` filter still hides the panel "+" button —
    // this is the path FootnotesHost takes when the affordance is
    // visible (main app post-7.8).
    return innerRef.current?.createEmptyFootnote()?.footnoteId ?? "";
  }, []);
  const handleEditFootnote = useCallback(
    (id: string, newContent: JSONContent) => {
      innerRef.current?.updateFootnoteContent(id, newContent);
    },
    [],
  );
  const handleEditFootnoteTitle = useCallback((_id: string, _title: string) => {
    // Footnote titles aren't part of the EditorHandle imperative API
    // today; the panel calls this on rename but the Reader is
    // read-only. Wired as a no-op until the main app needs it.
  }, []);
  const handleDeleteFootnote = useCallback((id: string) => {
    innerRef.current?.deleteFootnote(id);
  }, []);

  // Citation order — left-to-right ids of `\cite{}` commands in the
  // doc. Recomputes only when citations actually change (`rev.citations`),
  // not on every keystroke.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const citationOrder = useMemo<string[]>(
    () => innerRef.current?.getCitationOrder() ?? [],
    [editor, rev.citations],
  );

  // Live FootnoteInfo list, recomputed when the doc version bumps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const footnoteInfos = useMemo(
    () => innerRef.current?.getFootnotes() ?? [],
    [editor, rev.footnotes],
  );

  // Live ExampleInfo list — same trigger cadence as footnoteInfos.
  // Powers the popped-out example card renderer below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const examples = useMemo(
    () => innerRef.current?.getExamples() ?? [],
    [editor, rev.examples],
  );

  // Whitelist of panel kinds, then split between left + right rails by
  // placement. Each kind that lacks an explicit placement defaults to
  // the right rail (matches the Reader's behavior + EditorLayout's
  // historical `right` fallback for unconfigured kinds).
  // Default to all kinds when chrome whitelist is undefined; the
  // chrome filter then narrows back to the subset (Reader passes the
  // 6-kind whitelist; FULL_CHROME passes undefined → show all).
  const visiblePanels = useMemo<PanelKind[]>(
    () =>
      filterPanelKinds(
        chrome,
        chrome.visiblePanelKinds ?? (Object.keys(PANEL_REGISTRY) as PanelKind[]),
      ),
    [chrome],
  );
  const placementSideByKind = useMemo<Map<PanelKind, "left" | "right">>(() => {
    const m = new Map<PanelKind, "left" | "right">();
    for (const p of effectivePlacements) m.set(p.id as PanelKind, p.side);
    return m;
  }, [effectivePlacements]);
  // Side-resolution fallback: when a panel kind has no explicit
  // placement (fresh localStorage, partial reset, synthetic Reader
  // placements), fall back to its registry default. Returns `null` for
  // presentation-pod panels (registry `defaultStripSide: null`, e.g.
  // "omni") — those belong in the view-controls pod, not the icon
  // strip, so the strip-render path filters them out. The registry's
  // null is authoritative: a stale stored placement (e.g. omni dragged
  // onto a strip in an old build) must NOT pin it back onto the rail.
  const sideForKind = useCallback(
    (k: PanelKind): "left" | "right" | null => {
      const registrySide = PANEL_REGISTRY[k]?.defaultStripSide ?? null;
      if (registrySide === null) return null;
      return placementSideByKind.get(k) ?? registrySide;
    },
    [placementSideByKind],
  );
  // Order each side's strip by `effectivePlacements` so drag-reorders
  // mutating `prefs.placements` show up in the rendered icon order.
  // Visible-but-unplaced kinds (no entry in placements) keep their
  // registry-default position as a tail.
  const orderedSidePanels = useCallback(
    (target: "left" | "right"): PanelKind[] => {
      const visible = new Set(
        visiblePanels.filter((k) => sideForKind(k) === target),
      );
      const ordered: PanelKind[] = [];
      for (const p of effectivePlacements) {
        if (p.side === target && visible.has(p.id as PanelKind)) {
          ordered.push(p.id as PanelKind);
          visible.delete(p.id as PanelKind);
        }
      }
      for (const k of visiblePanels) if (visible.has(k)) ordered.push(k);
      return ordered;
    },
    [visiblePanels, sideForKind, effectivePlacements],
  );
  const visiblePanelsLeft = useMemo<PanelKind[]>(
    () => orderedSidePanels("left"),
    [orderedSidePanels],
  );
  const visiblePanelsRight = useMemo<PanelKind[]>(
    () => orderedSidePanels("right"),
    [orderedSidePanels],
  );
  // Initial active kind: Reader auto-shows the first panel (no
  // viewPrefs → user has no other way to open them); main app starts
  // collapsed (viewPrefs.prefs.activeLeft / activeRight drive the
  // dock-slot rendering, so PaneRail only needs to expose the icon
  // strip until the user clicks).
  const [activeLeftPanelKind, setActiveLeftPanelKind] = useState<PanelKind | null>(
    () => (viewPrefs ? null : visiblePanelsLeft[0] ?? null),
  );
  const [activeRightPanelKind, setActiveRightPanelKind] = useState<PanelKind | null>(
    () => (viewPrefs ? null : visiblePanelsRight[0] ?? null),
  );

  // If the chrome's whitelist changes (or shrinks past the active
  // panel), reset the active selection per side.
  useEffect(() => {
    if (activeLeftPanelKind && !visiblePanelsLeft.includes(activeLeftPanelKind)) {
      setActiveLeftPanelKind(visiblePanelsLeft[0] ?? null);
    }
  }, [visiblePanelsLeft, activeLeftPanelKind]);
  useEffect(() => {
    if (activeRightPanelKind && !visiblePanelsRight.includes(activeRightPanelKind)) {
      setActiveRightPanelKind(visiblePanelsRight[0] ?? null);
    }
  }, [visiblePanelsRight, activeRightPanelKind]);

  // Marker click → activate the panel on the side it's been placed on.
  const setActivePanelKindBySide = useCallback(
    (kind: PanelKind) => {
      if (placementSideByKind.get(kind) === "left") setActiveLeftPanelKind(kind);
      else setActiveRightPanelKind(kind);
    },
    [placementSideByKind],
  );

  // SearchHost cross-panel jump — switch the destination panel and
  // select the target item. Caller supplies a PanelId (broader than
  // PanelKind: includes shell-only ids like `omni`/`search`); we fan
  // out to the matching per-kind selection setter when the panel id
  // is one we recognize.
  const openItemInPanel = useCallback(
    (panel: PanelId, itemId: string) => {
      // Step 7.8 will replace this with the shell's cross-panel jump
      // (which also handles dock-slot expansion + scroll-into-view).
      // For now, side-activate the panel + best-effort select the
      // matching id on its native selection slot.
      if (panel === "notes") { setSelectedNoteId(itemId); setActivePanelKindBySide("notes"); }
      else if (panel === "footnotes") { setSelectedFootnoteId(itemId); setActivePanelKindBySide("footnotes"); }
      else if (panel === "citations") { setSelectedCitationId(itemId); setActivePanelKindBySide("citations"); }
      else if (panel === "todo") { setSelectedTodoId(itemId); setActivePanelKindBySide("todo"); }
      else if (panel === "archive") { setSelectedArchiveId(itemId); setActivePanelKindBySide("archive"); }
      else if (panel === "cutter") { setSelectedCutterCardId(itemId); setActivePanelKindBySide("cutter"); }
      else if (panel === "revisions") { setSelectedCommentId(itemId); setActivePanelKindBySide("revisions"); }
      else if (panel === "bibliography") { setSelectedBibKey(itemId); setActivePanelKindBySide("bibliography"); }
      else if (panel === "examples") { setSelectedExampleId(itemId); setActivePanelKindBySide("examples"); }
    },
    [setActivePanelKindBySide],
  );

  // Side derivations — which side each panel is currently mounted on.
  // Hosts use these to align cross-panel highlight sync (e.g. citations
  // panel ↔ bibliography panel).
  const notesPanelSide: "left" | "right" | null =
    activeLeftPanelKind === "notes" ? "left" : activeRightPanelKind === "notes" ? "right" : null;
  const bibliographyPanelSide: "left" | "right" | null =
    activeLeftPanelKind === "bibliography" ? "left" : activeRightPanelKind === "bibliography" ? "right" : null;
  const todoPanelSide: "left" | "right" | null =
    activeLeftPanelKind === "todo" ? "left" : activeRightPanelKind === "todo" ? "right" : null;
  const cutterPanelSide: "left" | "right" | null =
    activeLeftPanelKind === "cutter" ? "left" : activeRightPanelKind === "cutter" ? "right" : null;
  const reportsPanelSide: "left" | "right" | null =
    activeLeftPanelKind === "reports" ? "left" : activeRightPanelKind === "reports" ? "right" : null;
  const revisionsPanelSide: "left" | "right" | null =
    activeLeftPanelKind === "revisions" ? "left" : activeRightPanelKind === "revisions" ? "right" : null;

  // ── Per-doc popped-card render bag ───────────────────────────────
  // Constructed once over the underlying hook slices so a fresh
  // `renderPoppedCard` mount doesn't see new prop identities each
  // frame. The Reader doesn't pass `viewPrefs` so the mount below
  // stays dormant — but we still build the bag unconditionally for
  // simpler memoization and to keep `useMemo` deps stable.
  const popoutsDeps = useMemo<PoppedCardDeps>(
    () => ({
      // Entity collections
      notes: notesHook.notes,
      highlights: notesHook.highlights,
      footnotes: footnoteInfos,
      archiveSnippets: archiveHook.snippets,
      cutterCards: cutterHook.cards,
      todoItems: todosHook.items,
      bibEntries: citationsHook.bibEntries,
      citations: citationsHook.citations,
      citationPositionMap,
      allEditorCitations,
      comments: revisionsHook.cards,
      reportCards: reportsHook.cards,
      aiRequests: aiRequestsHook.requests,
      examples,
      anchoredIds: anchoredArchiveIds,

      // Selection slots + setters (per-pane)
      selectedNoteId,
      selectedFootnoteId,
      selectedArchiveId,
      selectedCutterCardId,
      selectedReportCardId,
      selectedTodoId,
      selectedBibKey,
      selectedCitationId,
      selectedCommentId,
      selectedExampleId,
      setSelectedNoteId,
      setSelectedFootnoteId,
      setSelectedArchiveId,
      setSelectedCutterCardId,
      setSelectedReportCardId,
      setSelectedTodoId,
      setSelectedBibKey,
      setSelectedCitationId,
      setSelectedCommentId,
      setSelectedExampleId,

      // Editor + shared actions
      editorRef: innerRef,
      setOverrideEditor,
      getCitationDisplayText: citationsHook.getDisplayText,
      handleCitationCreated,
      bibPackage: citationsHook.bibPackage,

      // Notes
      updateNote: notesHook.updateNote,
      updateNoteTitle: notesHook.updateNoteTitle,
      setNoteAiRequest: notesHook.setNoteAiRequest,
      setHighlightAiRequest: notesHook.setHighlightAiRequest,
      // Route through cardCreation: spawning a sibling note shares the
      // highlight's anchorId; deleting a highlight strips the in-doc tint.
      addNoteForHighlight: cardCreation.addNoteForHighlight,
      deleteNote: cardCreation.deleteHighlightOrNote,

      // Footnotes
      handleEditFootnote,
      handleDeleteFootnote,
      handleEditFootnoteTitle,

      // Archive
      updateArchiveSnippet: archiveHook.updateSnippet,
      updateArchiveSnippetTitle: archiveHook.updateSnippetTitle,
      handleDeleteArchive: handleArchiveDelete,

      // Cutter
      updateCutterCommentContent: cutterHook.updateCommentContent,
      updateCutterCommentText: cutterHook.updateCommentText,
      setCutterCommentAiRequest: cutterHook.setCommentAiRequest,
      updateCutterSuggestionField: cutterHook.updateSuggestionField,
      setCutterSuggestionStatus: cutterHook.setSuggestionStatus,
      deleteCutterCard: cutterHook.deleteCard,

      // Reports
      updateReportContent: reportsHook.updateReportContent,
      updateReportTitle: reportsHook.updateReportTitle,
      updateRequestContent: reportsHook.updateRequestContent,
      setRequestAiRequest: reportsHook.setRequestAiRequest,
      deleteReportCard: reportsHook.deleteCard,

      // Todos
      toggleTodo: todosHook.toggleItem,
      updateTodo: todosHook.updateItem,
      updateTodoNotes: todosHook.updateNotes,
      setTodoAiRequest: todosHook.setAiRequest,
      deleteTodo: todosHook.deleteItem,

      // Bibliography
      getFormattedBib: citationsHook.getFormattedBib,
      getAnnotation: annotationsHook.getAnnotation,
      setAnnotation: annotationsHook.setAnnotation,
      requestBibReview: bibReviewHook.requestReview,
      cancelBibReview: bibReviewHook.cancelRequest,
      getBibReviewStatus: bibReviewHook.getRequestStatus,
      updateBibEntry: citationsHook.updateBibEntry,
      updateBibKeyAndType: citationsHook.updateBibKeyAndType,
      addBibEntry: citationsHook.addBibEntry,

      // Citations
      updateCitation: citationsHook.updateCitation,
      deleteCitation: citationsHook.deleteCitation,

      // Revisions
      updateRevisionCommentContent: revisionsHook.updateCommentContent,
      updateRevisionCommentText: revisionsHook.updateCommentText,
      setRevisionCommentAiRequest: revisionsHook.setCommentAiRequest,
      updateRevisionSuggestionField: revisionsHook.updateSuggestionField,
      setRevisionSuggestionStatus: revisionsHook.setSuggestionStatus,
      convertRevisionCard: revisionsHook.convertCard,
      deleteRevisionCard: revisionsHook.deleteCard,

      // AI Requests
      updateAiRequestText: aiRequestsHook.updateRequestText,
      deleteAiRequest: aiRequestsHook.deleteRequest,
    }),
    [
      notesHook, footnoteInfos, archiveHook, cutterHook, todosHook,
      citationsHook, annotationsHook, bibReviewHook, revisionsHook,
      reportsHook,
      aiRequestsHook,
      citationPositionMap, allEditorCitations, examples, anchoredArchiveIds,
      selectedNoteId, selectedFootnoteId, selectedArchiveId,
      selectedCutterCardId, selectedReportCardId, selectedTodoId, selectedBibKey,
      selectedCitationId, selectedCommentId,
      selectedExampleId,
      handleCitationCreated, handleEditFootnote, handleDeleteFootnote,
      handleEditFootnoteTitle, handleArchiveDelete,
    ],
  );

  // ── Bubble per-doc state up to the shell ────────────────────────
  // Step 7.1 (Path A): emit a synthesized `PaneState` so EditorLayout's
  // Virgil bar can read the active doc's editor + AI state. Most
  // fields are real (editor / aiRequests / aiDot / pdfView / codeView).
  // The compile/PDF/style-merge fields are stubs for now — Step 7.2
  // moves `useDocumentStyle` (for `addStyleMergeRequest`) and the
  // revisions hook into EditorPane and replaces the remaining stubs.
  // The Reader doesn't pass `onPaneStateChange`; the call short-circuits.
  useEffect(() => {
    if (!onPaneStateChange) return;
    onPaneStateChange({
      editor,
      editorRef: innerRef,
      aiRequests: aiRequestsHook.requests,
      addStyleMergeRequest: aiRequestsHook.addStyleMergeRequest,
      compilePdf: compileHook.compile,
      isCompiling: compileHook.isCompiling,
      pdfStale,
      pdfBlobUrl,
      pdfView,
      switchToPdfView: onTogglePdfView ?? noop,
      switchFromPdfView: onTogglePdfView ?? noop,
      switchToCodeView: onToggleCodeView ?? noop,
      switchToVisualView: onToggleCodeView ?? noop,
      codeView,
      aiDot: aiRequestDotStatus({
        bibReviewRequests: bibReviewHook.requests,
        bibEntryRequests: bibSettingsHook.entryRequests,
        comments: revisionsHook.cards,
        panelAiRequests: aiRequestsHook.requests,
      }),
      collab,
      citationsHook,
    });
  }, [
    onPaneStateChange,
    editor,
    aiRequestsHook.requests,
    bibReviewHook.requests,
    bibSettingsHook.entryRequests,
    revisionsHook.cards,
    compileHook.compile,
    compileHook.isCompiling,
    pdfStale,
    pdfBlobUrl,
    pdfView,
    codeView,
    onTogglePdfView,
    onToggleCodeView,
    collab,
    citationsHook,
  ]);

  // ── Anchored-card hover/selection bridges + highlight painters ────
  // The whole all-for-one model lives here so reader and editor share
  // identical plumbing (the Library reader mounts EditorPane standalone).
  const _setHoveredEntity = useCallback(
    (id: string | null, kind: EntityKind | null) =>
      cardStore.setHover(id && kind ? { id, kind } : null),
    [],
  );

  // ExampleInfo carries `exampleId`, not `id`; the entity-collections
  // shape uses `id`. Adapt at the boundary so the entity vocabulary
  // stays uniform.
  const _examplesAsEntities = useMemo(
    () => examples.map((e) => ({ id: e.exampleId })),
    [examples],
  );

  useAnchorHighlightReconciler({
    editor,
    collections: {
      notes: notesHook.notes,
      cutterCards: cutterHook.cards,
      archiveSnippets: archiveHook.snippets,
      todos: todosHook.items,
      comments: revisionsHook.cards,
      reports: reportsHook.cards,
      examples: _examplesAsEntities,
    },
  });

  useLinkedAnchorReconciler({
    editor,
    notes:       notesHook.notes,
    highlights:  notesHook.highlights,
    cutterCards: cutterHook.cards,
    comments:    revisionsHook.cards,
    reportCards: reportsHook.cards,
  });

  useTextHoverBridge({
    editor,
    notes: notesHook.notes,
    cutterCards: cutterHook.cards,
    comments: revisionsHook.cards,
    reportCards: reportsHook.cards,
    setHoveredEntity: _setHoveredEntity,
  });
  usePanelCardHoverBridge(_setHoveredEntity);

  // Placement: when a card is selected (via click on the card itself),
  // scroll the editor so the closest in-doc anchor aligns with the
  // card's vertical position. Hover never moves anything; the inverse
  // direction (text → card alignment) is handled by openForCard.
  usePlacement({
    editor,
    collections: {
      notes: notesHook.notes,
      cutterCards: cutterHook.cards,
      comments: revisionsHook.cards,
      reports: reportsHook.cards,
      todos: todosHook.items,
      archiveSnippets: archiveHook.snippets,
      examples: _examplesAsEntities,
    },
  });

  return (
    <EditorChromeProvider value={{ ...chrome, menuBar }}>
      <EditorRefProvider
        value={{ editorInstance: editor, editorRef: innerRef, setOverrideEditor }}
      >
        <AiRequestsProvider
          value={{
            aiRequests: aiRequestsHook.requests,
            addAiRequest: aiRequestsHook.addRequest,
            updateAiRequestText: aiRequestsHook.updateRequestText,
            deleteAiRequest: aiRequestsHook.deleteRequest,
          }}
        >
        <CitationDisplayProvider
          value={{
            getCitationDisplayText: citationsHook.getDisplayText,
            onCitationCreated: handleCitationCreated,
          }}
        >
        <PristineCardsProvider value={pristineManager}>
        <RecentlyAddedProvider value={recentlyAdded}>
        <CardCreationProvider value={cardCreation}>
        <DragHandleMenuProvider value={dragHandleMenuApi}>
        {/* SelectionsProvider derives the 9 anchored slots from cardStore;
            only `selectedBibKey` flows through value. */}
        <SelectionsProvider value={{ selectedBibKey, setSelectedBibKey }}>

        <CollabProvider value={collab}>
        <PoppedCardsContext.Provider value={poppedCardsValue}>
          {/* Body-portaled outlines for dock-target / card-lift drag
              affordances. Both read state from module-level singletons
              (useDockDragTarget / useCardLiftTarget) — Reader has no
              drag sources so they sit inert. Step 7.8 removes the
              EditorLayout copies. */}
          <DockOutline />
          <CardLiftOutline />
          {/* Drop-mode controller — mounts the blue placement indicator
              (body-portaled) and the confirmation modal used when an
              already-anchored card is re-anchored. Registers a per-doc
              `DropCtx` with the controller; the controller no-ops if a
              card kind has no spec, so this is harmless before specs
              land. */}
          {viewPrefs && (
            <DropModeProvider
              mainEditor={editor}
              closePopout={viewPrefs.closeCardPopout}
              notes={dropNotesApi}
              highlights={dropHighlightsApi}
              todos={dropTodosApi}
              archive={dropArchiveApi}
              cutterCards={dropCutterApi}
              revisions={dropRevisionsApi}
              reports={dropReportsApi}
              stack={dropStackApi}
            />
          )}
          {/* Stack icon + popout strip (bottom-left of the editor pane).
              Anchored to editorPaneRootRef via ResizeObserver inside
              each component. Hidden in zen mode to keep the canvas
              calm. */}
          {viewPrefs && !viewPrefs.zenMode && (
            <>
              <StackIcon
                open={stackOpen}
                onToggle={() => setStackOpen((v) => !v)}
                mainEditor={editor}
                source={{ docId: docId ?? null }}
              />
              <StackStrip
                open={stackOpen}
                items={stack.items}
                onRemove={stack.remove}
              />
            </>
          )}
          {/* Per-doc popouts — card floats (notes, footnotes, citations, …)
              AND text-object floats (paragraph / heading / example blocks),
              dispatched through AF's unified `FloatHost`. Each entry in
              `prefs.poppedOutCards` keys a `Floatable` mounted in a
              `FloatWindow`. Reader passes no `viewPrefs` → dormant; main app
              gates on `!zenMode` so Zen retains popout state but hides floats. */}
          {viewPrefs && !viewPrefs.zenMode && (
            <FloatHost
              keys={viewPrefs.prefs.poppedOutCards}
              cardCtx={popoutsDeps}
            />
          )}
          {/* AI Window — modal opened from the shell's Virgil bar; mounted
              here so it reads this doc's per-doc hooks directly. Reader
              passes no `onAiWindowClose` so even if `aiWindowOpen` is
              flipped the close handler is missing — but Reader's chrome
              never surfaces the trigger anyway. */}
          {onAiWindowClose && (
            <AIWindow
              open={aiWindowOpen}
              onClose={onAiWindowClose}
              bibReviewRequests={bibReviewHook.requests}
              bibEntryRequests={bibSettingsHook.entryRequests}
              comments={revisionsHook.cards}
              bibEntries={citationsHook.bibEntries}
              panelAiRequests={aiRequestsHook.requests}
              addPanelAiRequest={aiRequestsHook.addRequest}
              deletePanelAiRequest={aiRequestsHook.deleteRequest}
              requestBibReview={bibReviewHook.requestReview}
              cancelBibReview={bibReviewHook.cancelRequest}
              addEntryRequest={bibSettingsHook.addEntryRequest}
              removeEntryRequest={bibSettingsHook.removeEntryRequest}
              addComment={(opts) =>
                revisionsHook.addComment(null, opts.text ? undefined : undefined)
              }
              refreshAll={() => {
                bibReviewHook.refresh();
                bibSettingsHook.refresh();
              }}
            />
          )}
          {/* Detached floating toolbars — portaled to body so they
              outlive any popover that spawned them and float over
              everything. All three blocks gate on `viewPrefs && menuBar
              && menuPortalReady`: Reader (no menuBar) leaves
              them dormant; main app post-7.8 wakes them by passing the
              bundle. Path A 7.6 finish (additive) — EditorLayout still
              owns its own copy of these portals until 7.8 deletes them. */}
          {viewPrefs && menuBar && menuPortalReady && detachedActions.map(tb => createPortal(
            <div
              key={tb.id}
              data-actions-id={tb.id}
              className="fixed z-[9999] pointer-events-auto"
              style={{ left: tb.pos.left, top: tb.pos.top }}
              onMouseDownCapture={() => viewPrefs.focusFloating({ kind: "toolbar", bucket: "actions", id: tb.id })}
            >
              <DetachedActionsToolbar
                actions={{
                  onAddComment: handleToolbarAddComment,
                  onAddNote: handleToolbarAddNote,
                  onAddHighlight: handleToolbarAddHighlight,
                  onAddTodo: handleToolbarAddTodo,
                  onCutSelection: handleToolbarAddCut,
                  onArchive: handleToolbarArchive,
                  onCreateFootnote: handleToolbarCreateFootnote,
                  onInsertCitation: handleToolbarInsertCitation,
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
          {viewPrefs && menuBar && menuPortalReady && (chrome.showFormattingToolbar ?? true) && (overrideEditor ?? editor) && detachedFormatting.map(tb => createPortal(
            <div
              key={tb.id}
              data-formatting-id={tb.id}
              className="fixed z-[9999] pointer-events-auto"
              style={{ left: tb.pos.left, top: tb.pos.top }}
              onMouseDownCapture={() => viewPrefs.focusFloating({ kind: "toolbar", bucket: "formatting", id: tb.id })}
            >
              <DetachedFormattingToolbar
                editor={(overrideEditor ?? editor)!}
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
          {viewPrefs && menuBar && menuPortalReady && (overrideEditor ?? editor) && detachedMenus.map(tb => createPortal(
            <div
              key={tb.id}
              data-menu-id={tb.id}
              className="fixed z-[9999] pointer-events-auto"
              style={{ left: tb.pos.left, top: tb.pos.top }}
              onMouseDownCapture={() => viewPrefs.focusFloating({ kind: "toolbar", bucket: "menus", id: tb.id })}
            >
              <DetachedMenuToolbar
                menuProps={{
                  editor: (overrideEditor ?? editor)!,
                  onAddComment: handleToolbarAddComment,
                  onArchive: handleToolbarArchive,
                  onCreateFootnote: handleToolbarCreateFootnote,
                  onAddNote: handleToolbarAddNote,
                  onAddTodo: handleToolbarAddTodo,
                  onCutSelection: handleToolbarAddCut,
                  onInsertCitation: handleToolbarInsertCitation,
                  showParTitles: menuBar.showParTitles,
                  onToggleParTitles: () => menuBar.setShowParTitles(!menuBar.showParTitles),
                  showLatexComments: menuBar.showLatexComments,
                  onToggleLatexComments: () => menuBar.setShowLatexComments(!menuBar.showLatexComments),
                  showHeadingLabels: menuBar.showHeadingLabels,
                  onToggleHeadingLabels: menuBar.toggleHeadingLabels,
                  showSectionIndicator: menuBar.showSectionIndicator,
                  onToggleSectionIndicator: menuBar.toggleSectionIndicator,
                  onOpenPreferences: menuBar.onOpenPreferences,
                  editorSplit: menuBar.editorSplit,
                  onToggleEditorSplit: menuBar.toggleEditorSplit,
                  activeSplitPane: menuBar.editorSplit ? menuBar.activeSplitPane : undefined,
                  showMarginalia: menuBar.showMarginalia,
                  onToggleMarginalia: menuBar.toggleMarginalia,
                  hiddenMarginaliaTypes: menuBar.hiddenMarginaliaTypes,
                  onToggleMarginaliaType: menuBar.toggleMarginaliaType,
                  showHighlights: viewPrefs.prefs.showHighlights,
                  onToggleHighlights: () => menuBar.setShowHighlights(!viewPrefs.prefs.showHighlights),
                  hiddenHighlightTypes: menuBar.hiddenHighlightTypes,
                  onToggleHighlightType: menuBar.toggleHighlightType,
                  availableDividerLevels: menuBar.availableDividerLevels,
                  dividerLevels: menuBar.activeDividerLevels,
                  onToggleDividerLevel: menuBar.toggleDividerLevel,
                  dividerWidth: menuBar.dividerWidth,
                  onSetDividerWidth: menuBar.setDividerWidth,
                  onParaNavBack: menuBar.paraNavBack,
                  onParaNavForward: menuBar.paraNavForward,
                  paraNavBackDisabled: menuBar.paraNavBackDisabled,
                  paraNavForwardDisabled: menuBar.paraNavForwardDisabled,
                  onCloseAllPanels: menuBar.closeAllPanels,
                  onOpenFontsDialog: menuBar.onOpenFontsDialog,
                  onOpenMarginsMode: enterMarginEditMode,
                  onActionsDetach: handleActionsDetach,
                  onFormatDetach: (chrome.showFormattingToolbar ?? true) ? handleFormatDetach : undefined,
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
          {/* Open panels (docked + floating) — both modes flow through
              the same FloatingPanel shell. Docked panels portal into
              the PanelColumn's dock-slot anchor; floating panels portal
              to body. The shell preserves its component instance across
              mode flips so drag-to-undock stays one continuous gesture.
              Reader doesn't pass viewPrefs → no panels open → block
              doesn't render. */}
          {viewPrefs && (() => {
            const open: Array<{ pid: PanelId; mode: "docked" | "floating"; slotKey: DockSlotKey | null }> = [];
            const seen = new Set<PanelId>();
            for (const sk of Object.keys(viewPrefs.prefs.dockSlots) as DockSlotKey[]) {
              const pid = viewPrefs.prefs.dockSlots[sk];
              if (!pid || seen.has(pid)) continue;
              seen.add(pid);
              open.push({ pid, mode: "docked", slotKey: sk });
            }
            for (const pid of viewPrefs.prefs.poppedOutPanels) {
              if (seen.has(pid)) continue;
              seen.add(pid);
              open.push({ pid, mode: "floating", slotKey: null });
            }
            return open.map(({ pid, mode, slotKey }, i) => {
              const placement = viewPrefs.prefs.placements.find((pl) => pl.id === pid);
              const panelSide: Side = placement?.side ?? "right";
              const saved = viewPrefs.prefs.floatPositions[pid];
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
              // PaneRailBody dispatches to the correct host. The
              // chrome-provider above gives the host's PanelHeader a
              // close button bound to this panel id (in the always-
              // float model, "close" means "drop the float").
              const panelInner =
                pid === "blank" || pid === "omni" ? (
                  <PaneRailBody
                    side={panelSide}
                    panelKind={pid as PanelKind}
                    editor={editor}
                    editorRef={innerRef}
                    content={editor && !isTier1CDisabled() ? (editor.getJSON() as JSONContent) : null}
                    examples={examples}
                    docId={docId}
                    citationsHook={citationsHook}
                    annotationsHook={annotationsHook}
                    bibReviewHook={bibReviewHook}
                    bibSettingsHook={bibSettingsHook}
                    notesHook={notesHook}
                    cardCreation={cardCreation}
                    allEditorCitations={allEditorCitations}
                    citationPositionMap={citationPositionMap}
                    citationOrder={citationOrder}
                    footnoteInfos={footnoteInfos}
                    setBibActiveCitationId={setBibActiveCitationId}
                    pendingCitationCreate={pendingCitationCreate}
                    setPendingCitationCreate={setPendingCitationCreate}
                    pendingCitationMode={pendingCitationMode}
                    setPendingCitationMode={setPendingCitationMode}
                    notesPanelSide={notesPanelSide}
                    bibliographyPanelSide={bibliographyPanelSide}
                    todoPanelSide={todoPanelSide}
                    cutterPanelSide={cutterPanelSide}
                    reportsPanelSide={reportsPanelSide}
                    revisionsPanelSide={revisionsPanelSide}
                    discardPristineNotes={notesHook.discardPristineNotes}
                    todosHook={todosHook}
                    archiveHook={archiveHook}
                    cutterHook={cutterHook}
                    reportsHook={reportsHook}
                    revisionsHook={revisionsHook}
                    sortedArchiveSnippets={sortedArchiveSnippets}
                    anchoredArchiveIds={anchoredArchiveIds}
                    onArchiveInsert={handleArchiveInsert}
                    onArchiveRestore={handleArchiveRestore}
                    onArchiveDelete={handleArchiveDelete}
                    onAddFootnote={handleAddFootnote}
                    onEditFootnote={handleEditFootnote}
                    onEditFootnoteTitle={handleEditFootnoteTitle}
                    onDeleteFootnote={handleDeleteFootnote}
                    selectedNoteId={selectedNoteId}
                    setSelectedNoteId={setSelectedNoteId}
                    latexErrors={allLatexErrors}
                    selectedErrorId={selectedErrorId}
                    setSelectedErrorId={setSelectedErrorId}
                    dismissedErrorIds={dismissedErrorIds}
                    onDismissError={dismissError}
                    onJumpToError={handleJumpToError}
                    errorSnippets={errorSnippets}
                    paragraphByErrorId={paragraphByErrorId}
                    searchState={searchState}
                    setSearchState={setSearchState}
                    setSearchHighlightRange={setSearchHighlightRange}
                    openItemInPanel={openItemInPanel}
                    wordCountHook={wordCountHook}
                    viewPrefs={viewPrefs}
                  />
                ) : (
                  <PanelChromeProvider
                    value={{
                      isPoppedOut: true,
                      side: panelSide,
                      onClose: () => viewPrefs.closePopout(pid),
                    }}
                  >
                    <PaneRailBody
                      side={panelSide}
                      panelKind={pid as PanelKind}
                      editor={editor}
                      editorRef={innerRef}
                      content={editor && !isTier1CDisabled() ? (editor.getJSON() as JSONContent) : null}
                      examples={examples}
                      docId={docId}
                      citationsHook={citationsHook}
                      annotationsHook={annotationsHook}
                      bibReviewHook={bibReviewHook}
                      bibSettingsHook={bibSettingsHook}
                      notesHook={notesHook}
                      cardCreation={cardCreation}
                      allEditorCitations={allEditorCitations}
                      citationPositionMap={citationPositionMap}
                      citationOrder={citationOrder}
                      footnoteInfos={footnoteInfos}
                      setBibActiveCitationId={setBibActiveCitationId}
                      pendingCitationCreate={pendingCitationCreate}
                      setPendingCitationCreate={setPendingCitationCreate}
                      pendingCitationMode={pendingCitationMode}
                      setPendingCitationMode={setPendingCitationMode}
                      notesPanelSide={notesPanelSide}
                      bibliographyPanelSide={bibliographyPanelSide}
                      todoPanelSide={todoPanelSide}
                      cutterPanelSide={cutterPanelSide}
                      reportsPanelSide={reportsPanelSide}
                      revisionsPanelSide={revisionsPanelSide}
                      discardPristineNotes={notesHook.discardPristineNotes}
                      todosHook={todosHook}
                      archiveHook={archiveHook}
                      cutterHook={cutterHook}
                      reportsHook={reportsHook}
                      revisionsHook={revisionsHook}
                      sortedArchiveSnippets={sortedArchiveSnippets}
                      anchoredArchiveIds={anchoredArchiveIds}
                      onArchiveInsert={handleArchiveInsert}
                      onArchiveRestore={handleArchiveRestore}
                      onArchiveDelete={handleArchiveDelete}
                        onAddFootnote={handleAddFootnote}
                      onEditFootnote={handleEditFootnote}
                      onEditFootnoteTitle={handleEditFootnoteTitle}
                      onDeleteFootnote={handleDeleteFootnote}
                      selectedNoteId={selectedNoteId}
                      setSelectedNoteId={setSelectedNoteId}
                      latexErrors={allLatexErrors}
                      selectedErrorId={selectedErrorId}
                      setSelectedErrorId={setSelectedErrorId}
                      dismissedErrorIds={dismissedErrorIds}
                      onDismissError={dismissError}
                      onJumpToError={handleJumpToError}
                      errorSnippets={errorSnippets}
                      paragraphByErrorId={paragraphByErrorId}
                      searchState={searchState}
                      setSearchState={setSearchState}
                      setSearchHighlightRange={setSearchHighlightRange}
                      openItemInPanel={openItemInPanel}
                      wordCountHook={wordCountHook}
                      viewPrefs={viewPrefs}
                    />
                  </PanelChromeProvider>
                );
              return (
                <FloatingPanel
                  key={pid}
                  panelId={pid}
                  mode={mode}
                  slotKey={slotKey}
                  initialX={initialX}
                  initialY={initialY}
                  initialWidth={initialWidth}
                  initialHeight={initialHeight}
                  zIndex={FLOATING_PANEL_Z_BASE + i}
                  onChange={(pos) => viewPrefs.setFloatPosition(pid, pos)}
                  onUndock={(rect) => viewPrefs.undockPanel(pid, rect)}
                  getSplitState={() => ({
                    left: viewPrefs.prefs.activeLeftBottom != null,
                    right: viewPrefs.prefs.activeRightBottom != null,
                  })}
                  onMaybeRedock={(sk) => viewPrefs.redockPanel(pid, sk)}
                  onFocus={() => viewPrefs.focusFloating({ kind: "panel", id: pid })}
                >
                  {panelInner}
                </FloatingPanel>
              );
            });
          })()}
          <div
            ref={editorPaneRootRef}
            className="editor-pane-root"
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "stretch",
              flex: 1,
              minHeight: 0,
              minWidth: 0,
              gap: 2,
            }}
          >
            {/* Hide editor panel rails when code view is active: with
                the editor wrapper narrowed by the split, the rails
                overflow past the wrapper's clip boundary and would
                appear as "ghost" card-strip slices beside the pod.
                Matches the pre-refactor UX where code view replaced
                the whole pane (no rails at all). */}
            {!codeSplit.active && (viewPrefs?.zenMode ? (
              <ZenMargin
                side="left"
                marginPref={viewPrefs.zenLeftMargin}
                onMarginPrefChange={viewPrefs.setZenLeftMargin}
                isResizing={viewPrefs.isResizingPanels}
                onResizingChange={viewPrefs.setIsResizingPanels}
                onSyncBeforeDrag={viewPrefs.syncPanelPrefsToRendered}
              />
            ) : visiblePanelsLeft.length > 0 && (
              <PaneRail
                side="left"
                visiblePanels={visiblePanelsLeft}
                activePanelKind={activeLeftPanelKind}
                onSelectPanel={setActiveLeftPanelKind}
                editor={editor}
                editorRef={innerRef}
                examples={examples}
                docId={docId}
                citationsHook={citationsHook}
                annotationsHook={annotationsHook}
                bibReviewHook={bibReviewHook}
                bibSettingsHook={bibSettingsHook}
                notesHook={notesHook}
                cardCreation={cardCreation}
                allEditorCitations={allEditorCitations}
                citationPositionMap={citationPositionMap}
                citationOrder={citationOrder}
                footnoteInfos={footnoteInfos}
                setBibActiveCitationId={setBibActiveCitationId}
                pendingCitationCreate={pendingCitationCreate}
                setPendingCitationCreate={setPendingCitationCreate}
                pendingCitationMode={pendingCitationMode}
                setPendingCitationMode={setPendingCitationMode}
                notesPanelSide={notesPanelSide}
                bibliographyPanelSide={bibliographyPanelSide}
                todoPanelSide={todoPanelSide}
                cutterPanelSide={cutterPanelSide}
                reportsPanelSide={reportsPanelSide}
                revisionsPanelSide={revisionsPanelSide}
                discardPristineNotes={notesHook.discardPristineNotes}
                todosHook={todosHook}
                archiveHook={archiveHook}
                cutterHook={cutterHook}
                reportsHook={reportsHook}
                revisionsHook={revisionsHook}
                sortedArchiveSnippets={sortedArchiveSnippets}
                anchoredArchiveIds={anchoredArchiveIds}
                onArchiveInsert={handleArchiveInsert}
                onArchiveRestore={handleArchiveRestore}
                onArchiveDelete={handleArchiveDelete}
                onAddFootnote={handleAddFootnote}
                onEditFootnote={handleEditFootnote}
                onEditFootnoteTitle={handleEditFootnoteTitle}
                onDeleteFootnote={handleDeleteFootnote}
                selectedNoteId={selectedNoteId}
                setSelectedNoteId={setSelectedNoteId}
                viewPrefs={viewPrefs}
                latexErrors={allLatexErrors}
                selectedErrorId={selectedErrorId}
                setSelectedErrorId={setSelectedErrorId}
                dismissedErrorIds={dismissedErrorIds}
                onDismissError={dismissError}
                onJumpToError={handleJumpToError}
                errorSnippets={errorSnippets}
                paragraphByErrorId={paragraphByErrorId}
                searchState={searchState}
                setSearchState={setSearchState}
                setSearchHighlightRange={setSearchHighlightRange}
                openItemInPanel={openItemInPanel}
                wordCountHook={wordCountHook}
                tail={leftGutterPrelude}
              />
            ))}
            {/* Column wrapper — sits between the two PaneRails. Holds the
                docked MenuBar (when `menuBar` is provided) plus the
                editor pod. Path A 7.6 finish (additive) introduced this
                wrapper so the docked MenuBar can mount sticky-above the
                pod; Reader (no menuBar) renders only the pod inside. */}
            <div
              ref={editorColRef}
              className={`editor-pane-column${viewToggleCls ? ` ${viewToggleCls}` : ""}`}
              data-editor-col="true"
              style={{
                // Vastly higher flex-grow than the PaneRails (each
                // 1) so the editor column absorbs leftover width
                // first; rails honor their basis (320px each), the
                // column gets the rest. Mirrors the old EditorLayout's
                // `flex: 1000 1 ${editorBasis}px` editor-column rule.
                flex: "1000 1 0",
                // Text-width floor: ensure the prose column never collapses
                // below 300px on narrow windows. Subtract `--editor-pl` /
                // `--editor-pr` (set just below; consumed by Editor.tsx's
                // prose padding), the pod's 2px horizontal border (1px each
                // side from `--pod-border`), and any wrapper inset
                // (`--editor-wrapper-inset`, set by Reader's `.paper-render`
                // padding via library.css; 0 in Editor mode).
                minWidth: 'calc(300px + var(--editor-pl, 88px) + var(--editor-pr, 72px) + 2px + var(--editor-wrapper-inset, 0px))',
                display: "flex",
                flexDirection: "column",
                // Containing block for the grab-handle portal wrapper
                // (added below as a sibling of the pod). The column
                // doesn't get a z-index — it intentionally does NOT
                // become a stacking context, so its sticky chrome
                // (pod caps at z:30/31, breadcrumb, etc.) and the
                // portaled handles (z:20) keep resolving in the root
                // stacking context and the caps win on overlap.
                position: "relative",
                // Span the full editor scroll height so the sticky
                // descendants below (docked MenuBar, top/bottom pod
                // caps, Section Lozenge, expand-all controls,
                // margin-edit guides) keep their stickiness across the
                // whole document. Without this, sticky's containing
                // block is the row's ~688px viewport height and
                // descendants drift after a few hundred px of scroll.
                // `--row-bound-h` is set in pixels on the row scroll
                // container by EditorScrollbar (= max of editor's
                // scrollHeight and row's clientHeight); falls back to
                // 100vh before first measurement so the floor always
                // resolves. A pixel-or-viewport min-height guarantees
                // the pod (flex:1000 inside this column) extends to
                // the scroll port bottom even when the doc is shorter
                // than the viewport, so a short document doesn't end
                // before the sticky bottom cap and create a "double
                // bottom edge" (pod's own border + cap). The earlier
                // `max(var(--row-bound-h, 100%), 100%)` form failed
                // here because percentage min-heights don't resolve
                // against an indefinite-height containing block, and
                // an unresolvable operand inside `max()` poisons the
                // whole declaration.
                minHeight: 'var(--row-bound-h, 100vh)',
                // ── ReadingViewport CSS-var contract ────────────
                // Six vars constitute the rendering interface for
                // the reading viewport. Set declaratively here as
                // the SINGLE writer; the margin-edit drag handler
                // updates them per-rAF via setProperty without ever
                // re-rendering this subtree.
                // Read by the prose class in Editor.tsx via
                // pl/pr/pt/pb-[var(--editor-pl/r/t/b)], by the
                // margin-edit overlay's guide lines, by the tex-
                // block row sensor in globals.css, and by Reader.
                ['--editor-pl' as string]: `${effectiveLeftMargin}px`,
                ['--editor-pr' as string]: `${effectiveRightMargin}px`,
                ['--editor-pt' as string]: `${effectiveTopMargin}px`,
                ['--editor-pb' as string]: `${effectiveBottomMargin}px`,
                // Symmetry flags. 1 when the axis is symmetric
                // (sides equal), 0 when asymmetric. The margin-edit
                // overlay's symmetry markers are always rendered;
                // their opacity reads these vars so they react at
                // DOM speed during drag without any React re-render.
                ['--editor-sym-x' as string]: marginSymmetricX ? "1" : "0",
                ['--editor-sym-y' as string]: marginSymmetricY ? "1" : "0",
                // Live width of the docked MenuBar, measured by a
                // ResizeObserver. Consumed by the sticky section-path
                // lozenge to compute a max-width that keeps it from
                // crossing into the centered MenuBar's band.
                ['--menubar-width' as string]: `${menubarWidth}px`,
              }}
            >
            {/* Top reading-frame mask — always-present letterbox band
                at the top of the visible reading area. Its height is
                the top margin (`--editor-pt`), so the top `pt` of the
                viewport is masked to the pod surface at ALL scroll
                positions: this is what makes the top margin a true
                viewport reading inset rather than a one-off document
                padding. The same `--editor-pt` is read by the prose's
                padding-top (scroll slack so the title clears the mask)
                and by the margin-edit top guide bar — so dragging the
                bar (which sets `--editor-pt` via setProperty) resizes
                this mask live, at DOM speed, with no React render: the
                visible text edge follows the bar.
                A ~10px soft fade at the inner (bottom) edge hands the
                content off gently; the rest is solid var(--surface).
                Placed at the *column* level so its natural flow
                position is above the sticky anchor regardless of doc
                length — sticky-top engages reliably for short and long
                docs. The negative margin removes it from flow. z-15
                sits above prose but below the guide bars (z-25) and the
                chrome stack (menu band z-40, pod cap z-30).
                Gated on `ready` so its band doesn't leak through the
                LoadingScreen curtain during the loading window. */}
            {ready && (
              <div
                aria-hidden
                className="pointer-events-none shrink-0"
                style={{
                  position: "sticky",
                  top: menuBar ? 32 : 8,
                  height: "var(--editor-pt, 40px)",
                  marginBottom: "calc(-1 * var(--editor-pt, 40px))",
                  zIndex: 15,
                  background:
                    "linear-gradient(to bottom, var(--surface) 0, var(--surface) calc(100% - 10px), transparent 100%)",
                }}
              />
            )}
            {/* Section-path indicator — plain text in the chrome strip
                above the pod, anchored to the pod's left edge. Renders
                in the same 32px band as the docked MenuBar (z-41 lifts
                it above the band's background) with a calc'd max-width
                that prevents it from crossing into the centered
                MenuBar's column. */}
            {ready && menuBar?.showSectionIndicator && viewPrefs && (overrideEditor ?? editor) && (
              <div
                className="sticky shrink-0 pointer-events-none"
                style={{ top: 0, height: 0, zIndex: 41 }}
              >
                <div
                  style={{
                    paddingTop: 6,
                    maxWidth:
                      'calc((100% - var(--menubar-width, 0px)) / 2 - 12px)',
                  }}
                >
                  <SectionLozenge sectionPath={viewPrefs.activeSectionPath} />
                </div>
              </div>
            )}
            {ready && menuBar && (overrideEditor ?? editor) && (
              <div
                data-tool-strip="text"
                className="flex justify-end items-start shrink-0 sticky z-40"
                style={{
                  background: "var(--background)",
                  top: 0,
                  height: 24,
                  paddingRight: 4,
                  marginLeft: -4,
                  marginRight: -4,
                  pointerEvents: "none",
                }}
              >
                {/* Margin-edit Save/Cancel renders in-page next to the
                    drag guides (see the paper-render block below), so
                    nothing lives in the menu band during margin edit. */}
                <div ref={dockedMenuBarRef} className="pointer-events-auto">
                  <MenuBar
                    editor={overrideEditor ?? editor}
                    onAddComment={handleToolbarAddComment}
                    onArchive={handleToolbarArchive}
                    onCreateFootnote={handleToolbarCreateFootnote}
                    onAddNote={handleToolbarAddNote}
                    onAddHighlight={handleToolbarAddHighlight}
                    onAddTodo={handleToolbarAddTodo}
                    onCutSelection={handleToolbarAddCut}
                    onInsertCitation={handleToolbarInsertCitation}
                    showParTitles={menuBar.showParTitles}
                    onToggleParTitles={() => menuBar.setShowParTitles(!menuBar.showParTitles)}
                    showLatexComments={menuBar.showLatexComments}
                    onToggleLatexComments={() => menuBar.setShowLatexComments(!menuBar.showLatexComments)}
                    showSectionIndicator={menuBar.showSectionIndicator}
                    onToggleSectionIndicator={menuBar.toggleSectionIndicator}
                    showHeadingLabels={menuBar.showHeadingLabels}
                    onToggleHeadingLabels={menuBar.toggleHeadingLabels}
                    onOpenPreferences={menuBar.onOpenPreferences}
                    editorSplit={menuBar.editorSplit}
                    onToggleEditorSplit={menuBar.toggleEditorSplit}
                    activeSplitPane={menuBar.editorSplit ? menuBar.activeSplitPane : undefined}
                    showMarginalia={menuBar.showMarginalia}
                    onToggleMarginalia={menuBar.toggleMarginalia}
                    hiddenMarginaliaTypes={menuBar.hiddenMarginaliaTypes}
                    onToggleMarginaliaType={menuBar.toggleMarginaliaType}
                    showHighlights={viewPrefs ? viewPrefs.prefs.showHighlights : true}
                    onToggleHighlights={() => menuBar.setShowHighlights(viewPrefs ? !viewPrefs.prefs.showHighlights : false)}
                    hiddenHighlightTypes={menuBar.hiddenHighlightTypes}
                    onToggleHighlightType={menuBar.toggleHighlightType}
                    availableDividerLevels={menuBar.availableDividerLevels}
                    dividerLevels={menuBar.activeDividerLevels}
                    onToggleDividerLevel={menuBar.toggleDividerLevel}
                    dividerWidth={menuBar.dividerWidth}
                    onSetDividerWidth={menuBar.setDividerWidth}
                    onParaNavBack={menuBar.paraNavBack}
                    onParaNavForward={menuBar.paraNavForward}
                    paraNavBackDisabled={menuBar.paraNavBackDisabled}
                    paraNavForwardDisabled={menuBar.paraNavForwardDisabled}
                    onCloseAllPanels={menuBar.closeAllPanels}
                    onOpenFontsDialog={menuBar.onOpenFontsDialog}
                    onOpenMarginsMode={enterMarginEditMode}
                    orientation="horizontal"
                    onSetOrientation={() => {}}
                    onActionsDetach={handleActionsDetach}
                    onFormatDetach={handleFormatDetach}
                    onGrabStart={handleMenuGrabStart}
                    showEditItems={chrome.showMenuBarEditItems ?? true}
                    showFormattingToolbar={chrome.showFormattingToolbar ?? true}
                    atHome
                  />
                </div>
              </div>
            )}
            {/* Sticky pod-top cap. Container is 8px tall (just the
                white cap-inner with rounded top corners) with
                marginBottom: -8 negating its flow contribution. The
                cap-inner provides the visible top edge of the pod and
                masks scrolling content beneath it.
                ── Continuous corner arc ─────────────────────────────
                The container bleeds 14px past the pod on each side
                (-4 - var(--pod-gap)) to extend the manilla into the
                column gutter — load-bearing because it masks the pod's
                lateral box-shadow (clipPath inset(0 -20px) on the pod)
                at the corner. For the manila OUTER corner to be a
                single smooth arc CONCENTRIC with the white inner's 8px
                corner, its radius must be `pod-radius + bleed` (= 8 +
                14 = 22px) AND the container must be that tall, so the
                quarter-arc actually fits (an 8px-tall box clamps a
                22px radius down to ~8px → two arcs 14px apart, the old
                fuzzy/doubled corner). So the container is 22px tall
                with the 8px white inner pinned to the bottom
                (justify-end): the two corners then share a center and
                read as one arc. The surplus 14px of manila sits ABOVE
                the white edge — to keep the white edge (the pod's
                visible top) where it was, the sticky `top` shifts up
                by the 14px bleed (24 → 10). That surplus manila lands
                behind the MenuBar band (cap z-30 < band z-40, both
                manila) so it blends seamlessly. Reader (no band) keeps
                top:0; its surplus tail clips above the scroll top. */}
            {ready && (overrideEditor ?? editor) && (
              <div
                data-editor-pod-cap
                className="sticky z-30 shrink-0 pointer-events-none flex flex-col"
                style={{
                  top: menuBar ? 10 : 0,
                  height: 'calc(var(--pod-radius) + 4px + var(--pod-gap))',
                  // The surplus 14px (= bleed) goes ABOVE the white
                  // inner. marginTop pulls the whole cap up by that
                  // 14px so the white edge stays at its original flow
                  // position; marginBottom stays -8 (negating just the
                  // white inner's 8px) so flow is neutral and the pod
                  // isn't pushed. Net flow: -14 + 22 - 8 = 0.
                  marginTop: 'calc(-4px - var(--pod-gap))',
                  marginBottom: -8,
                  marginLeft: 'calc(-4px - var(--pod-gap))',
                  marginRight: 'calc(-4px - var(--pod-gap))',
                  background: 'var(--background)',
                  borderTopLeftRadius: 'calc(var(--pod-radius) + 4px + var(--pod-gap))',
                  borderTopRightRadius: 'calc(var(--pod-radius) + 4px + var(--pod-gap))',
                  justifyContent: 'flex-end',
                }}
              >
                <div
                  style={{
                    height: 8,
                    marginLeft: 'calc(4px + var(--pod-gap))',
                    marginRight: 'calc(4px + var(--pod-gap))',
                    background: 'var(--pod-editor)',
                    // Mask-only: NO border/shadow here. The single
                    // `[data-pod-frame]` ring draws the edge. This white
                    // inner just masks content scrolling past and, with
                    // the manila container's rounded corner, fills the
                    // corner notch so the borderless content's white
                    // doesn't show past the frame's rounded corner.
                    borderTopLeftRadius: 'var(--pod-radius)',
                    borderTopRightRadius: 'var(--pod-radius)',
                  }}
                />
              </div>
            )}
            {/* Top gutter spacer — pushes the editor pod down from the
                docked MenuBar / topbar. Sized by `viewPrefs.topGutter`
                (default 0). Flex grow: 1 (vs. pod's 1000) so the pod
                dominates window-resize growth; flex shrink 100 so the
                gutter shrinks first when window-downsize squeezes the
                column. During drag we freeze flex to `0 0 ${pref}px`
                so the live drag value persists exactly. */}
            {viewPrefs && (
              <div
                data-flex-row="top"
                style={{
                  // grow 0 so the spacer doesn't claim leftover space
                  // — only the pod (grow 1000) absorbs growth. shrink
                  // 100 means the spacer collapses first when window-
                  // downsize squeezes the column.
                  flex: `0 100 ${viewPrefs.topGutter}px`,
                  minHeight: 0,
                }}
              />
            )}
            {/* Top drag gap — 4px grab handle pinned just below the
                sticky chrome above (docked MenuBar 32 + pod cap 8 = 40
                in main editor; 8 in Reader). z-31 puts it above the
                pod (z-auto) so it remains hit-testable. marginBottom:
                -4 negates flow space so the pod stays at its natural
                position. */}
            {viewPrefs && (
              <div
                data-gutter-gap="top"
                ref={topGutterDrag.gapRef}
                className="drag-gap drag-gap-h shrink-0"
                style={{
                  position: 'sticky',
                  height: 4,
                  top: menuBar ? 40 : 8,
                  zIndex: 31,
                  marginBottom: -4,
                }}
                onMouseDown={onTopGutterDown}
              />
            )}
            {/* ── Single-border pod frame ring ──────────────────────
                The SOLE element that draws the pod's visible card edge:
                border + rounded corners + drop shadow. Sticky over the
                visible reading rectangle (viewport minus chrome), full
                pod width, transparent interior, pointer-events none.
                Because exactly one element draws the border — and it is
                sticky — there is no second border in a different paint
                layer to mis-composite against, so the edge is a single
                crisp line at any scroll position and device-pixel ratio
                (the old pod-border + sticky-cap-border doubling, which
                showed as a 1–2px displaced edge on retina, is gone).
                The pod content is borderless; the caps mask scrolling
                content and fill the manila corner notches behind this
                ring's rounded corners. chromeTop = 32 (menu band 24 +
                cap 8) / 8 (Reader); chromeBottom = 8. z-31 sits above
                the caps (z-30), below the MenuBar band (z-40). */}
            {ready && (overrideEditor ?? editor) && (
              <div
                data-pod-frame
                aria-hidden
                className="pointer-events-none shrink-0"
                style={{
                  position: "sticky",
                  top: menuBar ? 32 : 8,
                  height: menuBar
                    ? "calc(var(--scroll-viewport-h, 100vh) - 40px)"
                    : "calc(var(--scroll-viewport-h, 100vh) - 16px)",
                  marginBottom: menuBar
                    ? "calc(-1 * (var(--scroll-viewport-h, 100vh) - 40px))"
                    : "calc(-1 * (var(--scroll-viewport-h, 100vh) - 16px))",
                  zIndex: 31,
                  border: "var(--pod-border)",
                  borderRadius: "var(--pod-radius)",
                  // Two stacked box-shadows: (1) a manila "matte" that
                  // fills OUTSIDE the ring's rounded shape — this covers
                  // the corner notches (the borderless content's white
                  // that would otherwise show past the rounded corner)
                  // and the gutter, following the border-radius so the
                  // corner reads as a clean white-on-manila arc; (2) the
                  // card's drop shadow, listed FIRST so it paints in
                  // front of the matte and darkens the manila near the
                  // edge (the shadow shows on the manila, not hidden
                  // under it). The matte spread (pod-gap) covers the
                  // notch + gutter without reaching the panel rails.
                  boxShadow:
                    "var(--pod-shadow), 0 0 0 var(--pod-gap) var(--background)",
                }}
              />
            )}
            <div
              className="editor-pane-pod"
              data-marginalia-host
              style={{
                flex: viewPrefs ? "1000 1 0" : "1 1 0",
                minWidth: 0,
                // ── Borderless content (single-border frame model) ──
                // The pod is now a PLAIN white rectangle that scrolls.
                // It draws NO edge of its own — no border, radius,
                // shadow, or clip. The entire visible card edge (border
                // + rounded corners + shadow) is drawn ONCE by the
                // sticky `[data-pod-frame]` ring below, so the edge is a
                // single source of truth and can't double against a
                // separate sticky layer (the retina mis-composite that
                // produced the displaced edge). The caps degrade to
                // mask-only (manila corner-fill + content masking).
                // While !ready the whole thing reads as the manilla
                // LoadingScreen field.
                background: ready ? "var(--surface)" : "var(--background)",
                // Marginalia portals markers as `position: absolute`
                // children of the closest `[data-marginalia-host]`. The
                // pod must therefore be a positioning context.
                position: "relative",
              }}
            >
              <Marginalia
                editor={editor}
                markers={visibleMarginaliaMarkers}
                panelSides={marginaliaPanelSides}
              />
              {/* Sticky expand-all / collapse-all controls — fade in on
                  hover anywhere in the 24px band. Wrapper takes no flow
                  space (marginBottom: -24) so editor content stays at
                  its natural top. */}
              {viewPrefs && (overrideEditor ?? editor) && (
                <div
                  className="sticky z-20 shrink-0 group"
                  style={{ top: 0, height: 24, marginBottom: -24 }}
                >
                  <div className="absolute top-2 left-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150 pointer-events-auto">
                    <button
                      onClick={() => innerRef.current?.expandAllSections()}
                      className="text-[var(--muted)] hover:text-ink-body transition-colors"
                      data-hint="Expand all sections" aria-label="Expand all sections"
                    >
                      <svg width="11" height="8" viewBox="0 0 14 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 1 L7 4.5 L12 1" />
                        <path d="M2 5.5 L7 9 L12 5.5" />
                      </svg>
                    </button>
                    <button
                      onClick={() => innerRef.current?.collapseAllSections()}
                      className="text-[var(--muted)] hover:text-ink-body transition-colors"
                      data-hint="Collapse all sections" aria-label="Collapse all sections"
                    >
                      <svg width="11" height="8" viewBox="0 0 14 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 4.5 L7 1 L12 4.5" />
                        <path d="M2 9 L7 5.5 L12 9" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
              <div className="paper-render" data-editor-page="true" style={{ position: "relative" }}>
                {/* Margin-edit overlay — only renders in margin-edit
                    mode. A SINGLE sticky element that spans the
                    *visible pod* (viewport minus the menu band and
                    pod caps), positioned over `data-editor-page` so
                    page-relative `left:0`/`right:0` resolve to the
                    pod's left/right edges. Four absolutely-positioned
                    guide lines + per-axis symmetry markers + the
                    floating Save/Cancel chip live inside.
                    Each guide line goes edge-to-edge:
                      - T/B: pod-left → pod-right (full pod width)
                      - L/R: visible-pod-top → visible-pod-bottom
                    13px hit areas are centered on each line. Symmetry
                    markers are always rendered; opacity is driven by
                    `--editor-sym-x` / `--editor-sym-y` so they react
                    at DOM speed during drag — the rAF flush in
                    `useMarginEdit` toggles those vars without going
                    through React. */}
                {marginEditMode && viewPrefs && (() => {
                  // Chrome above (menu band 24 + cap 8 = 32 in main
                  // editor; just 8 of cap in Reader) and below (8 of
                  // bottom cap, sticky at viewport bottom).
                  const chromeTop = menuBar ? 32 : 8;
                  const chromeBottom = 8;
                  const overlayHeight =
                    `calc(var(--scroll-viewport-h, 100vh) - ${chromeTop}px - ${chromeBottom}px)`;
                  return (
                    <div
                      data-margin-frame
                      className="pointer-events-none"
                      style={{
                        position: "sticky",
                        top: chromeTop,
                        height: overlayHeight,
                        // Pull the overlay out of flow so it doesn't
                        // push prose down by its sticky height.
                        marginBottom: `calc(-1 * (${overlayHeight}))`,
                        zIndex: 25,
                      }}
                    >
                      {/* ── Four edge-to-edge guide lines ──────── */}
                      {/* Each line is a 1px stripe rendered as the
                          background of a 13px-wide hit-area strip.
                          T/B span the full pod width; L/R span the
                          full visible-pod height. */}
                      {(["left", "right", "top", "bottom"] as const).map((side) => {
                        const axis = MARGIN_AXIS[side];
                        // Inset of the line from the overlay edge it's
                        // anchored to — read live from the CSS var so
                        // the line moves in lockstep with the rAF flush.
                        const sideVar =
                          side === "left"
                            ? "--editor-pl"
                            : side === "right"
                            ? "--editor-pr"
                            : side === "top"
                            ? "--editor-pt"
                            : "--editor-pb";
                        // 13px hit area centered on the 1px line.
                        // For X axes the hit area is a vertical strip
                        // 13px wide, line at its horizontal center;
                        // for Y axes a horizontal strip 13px tall,
                        // line at its vertical center.
                        const hitStyle: React.CSSProperties = axis === "x"
                          ? {
                              position: "absolute",
                              top: 0,
                              bottom: 0,
                              width: 13,
                              cursor: "ew-resize",
                              [side]: `calc(var(${sideVar}) - 6px)`,
                            }
                          : {
                              position: "absolute",
                              left: 0,
                              right: 0,
                              height: 13,
                              cursor: "ns-resize",
                              [side]: `calc(var(${sideVar}) - 6px)`,
                            };
                        const lineStyle: React.CSSProperties = axis === "x"
                          ? {
                              position: "absolute",
                              top: 0,
                              bottom: 0,
                              left: 6,
                              width: 1,
                              background: "var(--drag-highlight)",
                              boxShadow: "0 0 4px rgba(59, 130, 246, 0.35)",
                              pointerEvents: "none",
                            }
                          : {
                              position: "absolute",
                              left: 0,
                              right: 0,
                              top: 6,
                              height: 1,
                              background: "var(--drag-highlight)",
                              boxShadow: "0 0 4px rgba(59, 130, 246, 0.35)",
                              pointerEvents: "none",
                            };
                        return (
                          <div
                            key={side}
                            data-margin-guide={side}
                            className="pointer-events-auto"
                            style={hitStyle}
                            onMouseDown={(e) => beginMarginDrag(e, side)}
                            data-hint={`Drag to set ${side} margin`} aria-label={`Drag to set ${side} margin`}
                          >
                            <div style={lineStyle} />
                          </div>
                        );
                      })}

                      {/* ── Symmetry markers ──────────────────────
                          One dot centered on the MIDPOINT of each
                          guide line (not at the corner intersections).
                          The two vertical lines (L/R) carry an X-axis
                          dot at the viewport vertical center; the two
                          horizontal lines (T/B) carry a Y-axis dot at
                          the pod horizontal center. Opacity follows the
                          axis's symmetry CSS var, so when an axis is
                          symmetric a dot appears in the middle of each
                          of its two lines and fades the instant the
                          snap breaks — driven by the rAF flush, no
                          React render. `transform` centers the 10px dot
                          exactly on the 1px line. */}
                      {([
                        { key: "left", axisVar: "--editor-pl", symVar: "--editor-sym-x", side: "left", along: "y" },
                        { key: "right", axisVar: "--editor-pr", symVar: "--editor-sym-x", side: "right", along: "y" },
                        { key: "top", axisVar: "--editor-pt", symVar: "--editor-sym-y", side: "top", along: "x" },
                        { key: "bottom", axisVar: "--editor-pb", symVar: "--editor-sym-y", side: "bottom", along: "x" },
                      ] as const).map((mk) => {
                        // `along` is the axis the line runs along, so
                        // the dot is centered at 50% along it and sits
                        // on the line (at `var(axisVar)`) across it.
                        const positionStyle: React.CSSProperties = mk.along === "y"
                          // Vertical line (L/R): pin across at the line
                          // inset, center along at 50% of the height.
                          ? {
                              [mk.side]: `var(${mk.axisVar})`,
                              top: "50%",
                              transform:
                                mk.side === "left"
                                  ? "translate(-50%, -50%)"
                                  : "translate(50%, -50%)",
                            }
                          // Horizontal line (T/B): pin across at the
                          // line inset, center along at 50% of the width.
                          : {
                              [mk.side]: `var(${mk.axisVar})`,
                              left: "50%",
                              transform:
                                mk.side === "top"
                                  ? "translate(-50%, -50%)"
                                  : "translate(-50%, 50%)",
                            };
                        return (
                          <div
                            key={mk.key}
                            aria-hidden
                            className="pointer-events-none"
                            style={{
                              position: "absolute",
                              ...positionStyle,
                              width: 10,
                              height: 10,
                              borderRadius: "50%",
                              background: "var(--drag-highlight)",
                              border: "1.5px solid #fff",
                              boxShadow: "0 0 8px rgba(59, 130, 246, 0.7), 0 0 2px rgba(59, 130, 246, 0.9)",
                              opacity: `var(${mk.symVar}, 0)`,
                              transition: "opacity 80ms ease-out",
                            }}
                          />
                        );
                      })}

                      {/* ── Floating Save/Cancel chip ──────────────
                          Anchored to the top-right of the READING AREA
                          — i.e., just below the top reading-frame mask
                          (`top: pt + 8`), NOT at the raw viewport top.
                          Sitting it inside the masked top-margin band
                          (the old `top: 8`) floated it white-on-white
                          in the dead margin zone, where it read as
                          "lost". Pinned 8px below the top guide line
                          keeps it on the visible page, clear of the
                          mask, in the corner the user asked for. Out of
                          the prose flow so it never crosses text; z:1
                          above the lines within the z:25 overlay. */}
                      <div
                        className="flex items-center gap-2 pointer-events-auto"
                        style={{
                          position: "absolute",
                          top: "calc(var(--editor-pt, 40px) + 8px)",
                          right: 8,
                          zIndex: 1,
                          padding: "4px 8px",
                          borderRadius: 999,
                          background: "var(--surface)",
                          border: "1px solid var(--drag-highlight)",
                          boxShadow: "0 2px 10px rgba(0,0,0,0.16), 0 0 0 2px rgba(59, 130, 246, 0.18)",
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            lineHeight: 1,
                            color: "var(--ink-body, #222)",
                            letterSpacing: "0.02em",
                            paddingLeft: 2,
                            paddingRight: 4,
                            opacity: 0.75,
                            userSelect: "none",
                          }}
                        >
                          Margins
                        </span>
                        <button
                          type="button"
                          onClick={cancelMarginEdit}
                          data-hint="Discard margin changes (Esc)"
                          aria-label="Cancel margin edit"
                          className="flex items-center justify-center"
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: "50%",
                            background: "transparent",
                            border: "1px solid var(--drag-highlight)",
                            color: "var(--drag-highlight)",
                            cursor: "pointer",
                          }}
                        >
                          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M3 3 L11 11" />
                            <path d="M11 3 L3 11" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={saveMarginEdit}
                          data-hint="Save margins"
                          aria-label="Save margins"
                          className="flex items-center justify-center"
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: "50%",
                            background: "var(--drag-highlight)",
                            border: "1px solid var(--drag-highlight)",
                            color: "#fff",
                            cursor: "pointer",
                          }}
                        >
                          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M3 7.5 L6 10.5 L11 4.5" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  );
                })()}
                {(initialContent ?? docHook.content) != null && (
                  <VirgilEditor
                    ref={innerRef}
                    initialContent={(initialContent ?? docHook.content) as JSONContent}
                    onUpdate={(editor) => {
                      // Forward to caller-supplied handler first (Reader
                      // omits — read-only), then drive the canonical
                      // debounced writeback through `useDocument` so
                      // EditorPane is the sole save path once mounted
                      // in the main app.
                      //
                      // Both consumers receive the editor by reference;
                      // each invokes `editor.getJSON()` from inside its
                      // own debounce timer. Pre-fix the doc was
                      // serialized here per keystroke and shipped through
                      // both branches — the dominant typing-lag cost on
                      // long docs.
                      onUpdate?.(editor);
                      docHook.onUpdate(editor);
                    }}
                    highlightText={highlightText}
                    highlightRange={highlightRange}
                    editable={editable}
                    onEditorReady={handleEditorReady}
                    anchoredUuidsRef={anchoredUuidsRef}
                    texBlockIsPoppedRef={texBlockIsPoppedRef}
                    onOpenHeadingTypeMenu={openHeadingTypeMenu}
                    onConfirmHeadingDelete={handleConfirmHeadingDelete}
                    onConfirmFigureDelete={handleConfirmFigureDelete}
                    documentClass={documentClassName}
                    docId={docId}
                  />
                )}
                {/* Print appendices — hidden in live UI (`.print-only`),
                 *  revealed by the @media print rules. Each enabled
                 *  panel renders via `<PaneRailBody>` so the print
                 *  output reuses the same panel components (and their
                 *  data hooks) as the live rail. Reader doesn't pass
                 *  `viewPrefs` so this stays dormant. */}
                {viewPrefs && (overrideEditor ?? editor) && (
                  <PrintAppendices
                    options={viewPrefs.prefs.printOptions}
                    renderPanel={(kind: PrintPanelKey) => (
                      <PaneRailBody
                        side="left"
                        panelKind={kind as PanelKind}
                        editor={editor}
                        editorRef={innerRef}
                        content={(initialContent ?? docHook.content) as JSONContent | null}
                        examples={examples}
                        docId={docId}
                        citationsHook={citationsHook}
                        annotationsHook={annotationsHook}
                        bibReviewHook={bibReviewHook}
                        bibSettingsHook={bibSettingsHook}
                        notesHook={notesHook}
                        cardCreation={cardCreation}
                        allEditorCitations={allEditorCitations}
                        citationPositionMap={citationPositionMap}
                        citationOrder={citationOrder}
                        footnoteInfos={footnoteInfos}
                        setBibActiveCitationId={setBibActiveCitationId}
                        pendingCitationCreate={pendingCitationCreate}
                        setPendingCitationCreate={setPendingCitationCreate}
                        pendingCitationMode={pendingCitationMode}
                        setPendingCitationMode={setPendingCitationMode}
                        notesPanelSide={notesPanelSide}
                        bibliographyPanelSide={bibliographyPanelSide}
                        todoPanelSide={todoPanelSide}
                        cutterPanelSide={cutterPanelSide}
                        reportsPanelSide={reportsPanelSide}
                        revisionsPanelSide={revisionsPanelSide}
                        discardPristineNotes={notesHook.discardPristineNotes}
                        todosHook={todosHook}
                        archiveHook={archiveHook}
                        cutterHook={cutterHook}
                        reportsHook={reportsHook}
                        revisionsHook={revisionsHook}
                        sortedArchiveSnippets={sortedArchiveSnippets}
                        anchoredArchiveIds={anchoredArchiveIds}
                        onArchiveInsert={handleArchiveInsert}
                        onArchiveRestore={handleArchiveRestore}
                        onArchiveDelete={handleArchiveDelete}
                            onAddFootnote={handleAddFootnote}
                        onEditFootnote={handleEditFootnote}
                        onEditFootnoteTitle={handleEditFootnoteTitle}
                        onDeleteFootnote={handleDeleteFootnote}
                        selectedNoteId={selectedNoteId}
                        setSelectedNoteId={setSelectedNoteId}
                        latexErrors={allLatexErrors}
                        selectedErrorId={selectedErrorId}
                        setSelectedErrorId={setSelectedErrorId}
                        dismissedErrorIds={dismissedErrorIds}
                        onDismissError={dismissError}
                        onJumpToError={handleJumpToError}
                        errorSnippets={errorSnippets}
                        paragraphByErrorId={paragraphByErrorId}
                        searchState={searchState}
                        setSearchState={setSearchState}
                        setSearchHighlightRange={setSearchHighlightRange}
                        openItemInPanel={openItemInPanel}
                        wordCountHook={wordCountHook}
                        viewPrefs={viewPrefs}
                      />
                    )}
                  />
                )}
              </div>
              {!ready && <LoadingScreen className="absolute inset-0 z-50" />}
            </div>
            {/* Grab-handle portal root — TextObjectGrabHandle portals
                its absolute-positioned handles into this div. Lives at
                the column level (sibling of the pod), so it ESCAPES the
                pod's clipPath (`inset(0 -20px 0 -20px)`) that clips
                lateral descendants of the pod past ±20px — handles
                render ~22px left of the content edge (in the gutter)
                and would otherwise be clipped. The column-level
                placement still: (a) scrolls with content (column is
                inside [data-virgil-row-scroll]); (b) clips behind the
                sticky pod caps (top z:30, bottom z:31) which sit
                alongside us in the column and win in the root stacking
                context against the handle's z:20; (c) clips against
                the row scroll container's overflow.
                pointerEvents: none on the wrapper lets clicks pass
                through; each handle re-enables pointerEvents on
                itself. */}
            <div
              data-grab-handle-portal
              style={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
              }}
            />
            {/* (The lifted-overlay ghost is no longer portaled here — it
                portals to document.body with position:fixed so it escapes
                the editor scroll container's overflow clip and can stack
                above the Virgil bar like a released float; see
                LiftedTextOverlay.tsx and Issue-11. The grab-handle portal
                above stays column-level.) */}
            {/* Bottom drag gap — 4px grab handle pinned just above the
                sticky bottom chrome (pod-cap-bottom in main editor;
                viewport bottom in Reader). z-31 above pod. marginTop:
                -4 negates flow space. */}
            {viewPrefs && (
              <div
                data-gutter-gap="bottom"
                ref={bottomGutterDrag.gapRef}
                className="drag-gap drag-gap-h shrink-0"
                style={{
                  position: 'sticky',
                  height: 4,
                  bottom: menuBar ? 16 : 0,
                  zIndex: 31,
                  marginTop: -4,
                }}
                onMouseDown={onBottomGutterDown}
              />
            )}
            {/* Bottom gutter spacer — symmetric counterpart of the top
                spacer. Sized by `viewPrefs.bottomGutter` (default 0). */}
            {viewPrefs && (
              <div
                data-flex-row="bottom"
                style={{
                  flex: `0 100 ${viewPrefs.bottomGutter}px`,
                  minHeight: 0,
                }}
              />
            )}
            {/* 8px breathing spacer between the gutter and the cap.
                Grows the column's flow by 8 so the cap container's
                natural-position bottom lands 8 below the pod, which
                puts the cap-inner (sitting at the top of the 16px
                cap container) flush with the pod's natural bottom
                edge — no doubling. Combined with the cap's full-width
                manilla bg, gives a consistent 8px manilla band
                between the pod and the window bottom. Caps-mode
                only. */}
            {(overrideEditor ?? editor) && (
              <div className="shrink-0" style={{ height: 8 }} />
            )}
            {/* Sticky pod-bottom cap — mirror of the top cap's
                continuous-arc treatment. Container is 22px tall (8px
                white cap-inner at top + 14px manilla band below) so the
                manila's 22px bottom corner is CONCENTRIC with the white
                inner's 8px corner (shared center) and reads as one arc,
                not the doubled/fuzzy corner an 8px-tall box gave when
                its 22px radius clamped. The 14px band also still masks
                content scrolling past the bottom and bleeds manila into
                the gutters. marginTop -22 keeps flow neutral (−22+22=0);
                sticky bottom:-6 lets the container's extra 6px hang
                below the viewport so the white edge stays exactly where
                it was (vb−8). */}
            {ready && (overrideEditor ?? editor) && (
              <div
                data-editor-pod-cap-bottom
                className="sticky z-30 shrink-0 pointer-events-none flex flex-col"
                style={{
                  bottom: -6,
                  height: 'calc(var(--pod-radius) + 4px + var(--pod-gap))',
                  marginTop: 'calc(-1 * (var(--pod-radius) + 4px + var(--pod-gap)))',
                  marginLeft: 'calc(-4px - var(--pod-gap))',
                  marginRight: 'calc(-4px - var(--pod-gap))',
                  background: 'var(--background)',
                  borderBottomLeftRadius: 'calc(var(--pod-radius) + 4px + var(--pod-gap))',
                  borderBottomRightRadius: 'calc(var(--pod-radius) + 4px + var(--pod-gap))',
                  // Hidden when the doc fits within the row's viewport
                  // (set by EditorScrollbar via `--cap-bottom-display`).
                  // Suppresses the doubled-bottom-edge visual for short
                  // docs where the pod's own rounded bottom is already
                  // at the visible bottom edge.
                  display: 'var(--cap-bottom-display, flex)',
                }}
              >
                <div
                  style={{
                    height: 8,
                    marginLeft: 'calc(4px + var(--pod-gap))',
                    marginRight: 'calc(4px + var(--pod-gap))',
                    background: 'var(--pod-editor)',
                    // Mask-only (see top cap): no border/shadow; the
                    // single `[data-pod-frame]` ring draws the edge.
                    borderBottomLeftRadius: 'var(--pod-radius)',
                    borderBottomRightRadius: 'var(--pod-radius)',
                  }}
                />
              </div>
            )}
            {/* Bottom reading-frame mask — mirror of the top mask.
                Its height is the bottom margin (`--editor-pb`), so the
                bottom `pb` of the viewport is masked at ALL scroll
                positions, making the bottom margin a true viewport
                reading inset. The same `--editor-pb` drives the prose's
                padding-bottom (scroll slack so the last line can clear
                the mask) and the margin-edit bottom guide bar — so
                dragging the bar resizes this mask live (no React
                render) and the visible text edge follows it.
                Pinned so its outer edge sits 8px (bottom cap height)
                above the scroll-viewport bottom; the inner (top) edge
                then lands at `viewport - 8 - pb`, exactly the bottom
                guide bar's position. A ~10px soft fade at the inner
                edge; the rest is solid var(--surface).
                Placed at the end of the column so its natural flow
                position is at the scroll-port bottom (sticky engages
                reliably for short and long docs).
                `display: var(--cap-bottom-display, block)` reuses the
                EditorScrollbar gate that hides the bottom cap when the
                doc fits the viewport — so a short doc doesn't show a
                floating masked band over empty manila.
                Gated on `ready` so the band doesn't leak through the
                LoadingScreen curtain during the loading window. */}
            {ready && (
              <div
                aria-hidden
                className="pointer-events-none shrink-0"
                style={{
                  position: "sticky",
                  // sticky-`bottom` (NOT `top`) pins to the viewport
                  // bottom at ALL scrolls — mirroring the always-on
                  // pod-cap-bottom. A sticky-`top` here only engaged
                  // near the doc bottom, leaving the band off-screen
                  // mid-doc. Outer edge 8px above the viewport bottom
                  // (above the cap); inner edge at `viewport - 8 - pb`,
                  // exactly the bottom guide bar's position.
                  bottom: 8,
                  height: "var(--editor-pb, 40px)",
                  marginTop: "calc(-1 * var(--editor-pb, 40px))",
                  zIndex: 15,
                  display: "var(--cap-bottom-display, block)",
                  background:
                    "linear-gradient(to top, var(--surface) 0, var(--surface) calc(100% - 10px), transparent 100%)",
                }}
              />
            )}
            </div>
            {/* Hide right rail when code view is active — see comment
                above the left rail. Both rails go away together. */}
            {!codeSplit.active && (viewPrefs?.zenMode ? (
              <ZenMargin
                side="right"
                marginPref={viewPrefs.zenRightMargin}
                onMarginPrefChange={viewPrefs.setZenRightMargin}
                isResizing={viewPrefs.isResizingPanels}
                onResizingChange={viewPrefs.setIsResizingPanels}
                onSyncBeforeDrag={viewPrefs.syncPanelPrefsToRendered}
              />
            ) : visiblePanelsRight.length > 0 && (
              <PaneRail
                side="right"
                visiblePanels={visiblePanelsRight}
                activePanelKind={activeRightPanelKind}
                onSelectPanel={setActiveRightPanelKind}
                editor={editor}
                editorRef={innerRef}
                examples={examples}
                docId={docId}
                citationsHook={citationsHook}
                annotationsHook={annotationsHook}
                bibReviewHook={bibReviewHook}
                bibSettingsHook={bibSettingsHook}
                notesHook={notesHook}
                cardCreation={cardCreation}
                allEditorCitations={allEditorCitations}
                citationPositionMap={citationPositionMap}
                citationOrder={citationOrder}
                footnoteInfos={footnoteInfos}
                setBibActiveCitationId={setBibActiveCitationId}
                pendingCitationCreate={pendingCitationCreate}
                setPendingCitationCreate={setPendingCitationCreate}
                pendingCitationMode={pendingCitationMode}
                setPendingCitationMode={setPendingCitationMode}
                notesPanelSide={notesPanelSide}
                bibliographyPanelSide={bibliographyPanelSide}
                todoPanelSide={todoPanelSide}
                cutterPanelSide={cutterPanelSide}
                reportsPanelSide={reportsPanelSide}
                revisionsPanelSide={revisionsPanelSide}
                discardPristineNotes={notesHook.discardPristineNotes}
                todosHook={todosHook}
                archiveHook={archiveHook}
                cutterHook={cutterHook}
                reportsHook={reportsHook}
                revisionsHook={revisionsHook}
                sortedArchiveSnippets={sortedArchiveSnippets}
                anchoredArchiveIds={anchoredArchiveIds}
                onArchiveInsert={handleArchiveInsert}
                onArchiveRestore={handleArchiveRestore}
                onArchiveDelete={handleArchiveDelete}
                onAddFootnote={handleAddFootnote}
                onEditFootnote={handleEditFootnote}
                onEditFootnoteTitle={handleEditFootnoteTitle}
                onDeleteFootnote={handleDeleteFootnote}
                selectedNoteId={selectedNoteId}
                setSelectedNoteId={setSelectedNoteId}
                viewPrefs={viewPrefs}
                latexErrors={allLatexErrors}
                selectedErrorId={selectedErrorId}
                setSelectedErrorId={setSelectedErrorId}
                dismissedErrorIds={dismissedErrorIds}
                onDismissError={dismissError}
                onJumpToError={handleJumpToError}
                errorSnippets={errorSnippets}
                paragraphByErrorId={paragraphByErrorId}
                searchState={searchState}
                setSearchState={setSearchState}
                setSearchHighlightRange={setSearchHighlightRange}
                openItemInPanel={openItemInPanel}
                wordCountHook={wordCountHook}
              />
            ))}
          </div>
          {/* Custom thin scrollbar pinned to the editor column's
              right edge. Shown only when the row scrolls — the
              fallback is the browser-native scrollbar (hidden via
              CSS in globals.css when this overlay is active). The
              Reader's outer wrapper and EditorLayout's doc-branch
              wrapper both designate the scroll container; the
              `rowScrollRef` resolves to whichever is closest. */}
          {viewPrefs && (
            <EditorScrollbar
              rowRef={rowScrollRef}
              editorColRef={editorColRef}
              rightInset={3}
            />
          )}
          {dragHandleMenuState && (
            <DragHandleMenu
              anchorRect={dragHandleMenuState.anchorRect}
              kind={dragHandleMenuState.ref.kind}
              onSelect={(action) => {
                const ref = dragHandleMenuState.ref;
                closeDragHandleMenu();
                dragHandleActions.dispatch(action, ref);
              }}
              onClose={closeDragHandleMenu}
            />
          )}
          {headingTypeMenuState && (
            <HeadingTypeMenu
              anchorRect={headingTypeMenuState.anchorRect}
              currentLevel={headingTypeMenuState.currentLevel}
              documentClass={documentClassName}
              onPick={(pick) => {
                headingTypeMenuState.onPick(pick);
                closeHeadingTypeMenu();
              }}
              onClose={closeHeadingTypeMenu}
            />
          )}
          {confirmHeadingDeleteDialog}
          {confirmFigureDeleteDialog}
          {confirmMarginItemDeleteDialog}
          {confirmDragHandleActionDialog}
          {notifyDragHandleActionDialog}
        </PoppedCardsContext.Provider>
        </CollabProvider>
        </SelectionsProvider>
        </DragHandleMenuProvider>
        </CardCreationProvider>
        </RecentlyAddedProvider>
        </PristineCardsProvider>
        </CitationDisplayProvider>
        </AiRequestsProvider>
      </EditorRefProvider>
    </EditorChromeProvider>
  );
});


export default EditorPane;

/* ── Side panel rail ────────────────────────────────────────────────
 *
 * The minimal rail used by EditorPane on either edge of the editor
 * pod. Mirrors `EditorLayout`'s strip + column rendering without the
 * dock/float/split/popout machinery — that lands later (Step 7.5).
 *
 * Layout: an icon strip on the rail's outer edge plus an active panel
 * column on the inner edge (closer to the editor pod). The order of
 * the two children flips on the `side` prop so the icons always sit
 * on the outermost edge of the editor pane root.
 */

interface PaneRailProps {
  side: "left" | "right";
  visiblePanels: PanelKind[];
  activePanelKind: PanelKind | null;
  onSelectPanel: (kind: PanelKind | null) => void;
  editor: Editor | null;
  editorRef: RefObject<EditorHandle | null>;
  examples: ReturnType<NonNullable<RefObject<EditorHandle | null>["current"]>["getExamples"]>;
  docId: string;
  citationsHook: ReturnType<typeof useCitations>;
  annotationsHook: ReturnType<typeof useAnnotations>;
  bibReviewHook: ReturnType<typeof useBibReview>;
  bibSettingsHook: ReturnType<typeof useBibSettings>;
  notesHook: ReturnType<typeof useNotes>;
  cardCreation: ReturnType<typeof useCardCreation>;
  allEditorCitations: Array<{
    citationId: string;
    command: string;
    keys: string[];
    pos: number;
  }>;
  citationPositionMap: Map<string, number>;
  citationOrder: string[];
  footnoteInfos: ReturnType<NonNullable<RefObject<EditorHandle | null>["current"]>["getFootnotes"]>;
  setBibActiveCitationId: React.Dispatch<React.SetStateAction<string | null>>;
  pendingCitationCreate: string | null;
  setPendingCitationCreate: React.Dispatch<React.SetStateAction<string | null>>;
  pendingCitationMode: "anchored" | "unanchored";
  setPendingCitationMode: React.Dispatch<React.SetStateAction<"anchored" | "unanchored">>;
  notesPanelSide: "left" | "right" | null;
  bibliographyPanelSide: "left" | "right" | null;
  todoPanelSide: "left" | "right" | null;
  cutterPanelSide: "left" | "right" | null;
  reportsPanelSide: "left" | "right" | null;
  revisionsPanelSide: "left" | "right" | null;
  discardPristineNotes: () => void;
  todosHook: ReturnType<typeof useTodos>;
  archiveHook: ReturnType<typeof useArchive>;
  cutterHook: ReturnType<typeof useCutter>;
  reportsHook: ReturnType<typeof useReports>;
  revisionsHook: ReturnType<typeof useRevisions>;
  sortedArchiveSnippets: ReturnType<typeof useArchive>["snippets"];
  anchoredArchiveIds: Set<string>;
  onArchiveInsert: (id: string) => void;
  onArchiveRestore: (id: string) => void;
  onArchiveDelete: (id: string) => void;
  onAddFootnote: () => string;
  onEditFootnote: (id: string, newContent: JSONContent) => void;
  onEditFootnoteTitle: (id: string, title: string) => void;
  onDeleteFootnote: (id: string) => void;
  selectedNoteId: string | null;
  setSelectedNoteId: React.Dispatch<React.SetStateAction<string | null>>;
  // Errors panel
  latexErrors: LatexError[];
  selectedErrorId: string | null;
  setSelectedErrorId: React.Dispatch<React.SetStateAction<string | null>>;
  dismissedErrorIds: Set<string>;
  onDismissError: (id: string) => void;
  onJumpToError: (err: LatexError) => void;
  errorSnippets: Map<string, string>;
  paragraphByErrorId: Map<string, string>;
  // Search panel
  searchState: SearchPanelState;
  setSearchState: React.Dispatch<React.SetStateAction<SearchPanelState>>;
  setSearchHighlightRange: React.Dispatch<React.SetStateAction<{ from: number; to: number } | null>>;
  openItemInPanel: (panel: PanelId, itemId: string) => void;
  // WordCount panel
  wordCountHook: ReturnType<typeof useWordCount>;
  // Step 7.5 sub-pass 2 — opt-in canonical PanelColumn / FloatingPanel
  // / OmniHost / OutlineHost surface. Reader omits.
  viewPrefs?: EditorPaneViewPrefs;
  /** Optional adornment rendered inside the panel column's inner row,
   *  adjacent to the drag-gap on the editor-facing side. Reader passes
   *  its `PageScrollStrip` here so the drag-gap line lands just inboard
   *  of the page-mark navigator. */
  tail?: React.ReactNode;
}

/**
 * Canonical icon strip — view-controls pod (collapse/blank/split) + the
 * StripButton column + the OmniFilterMenu. Rendered alongside the
 * PanelColumn in PaneRail's canonical branch. Hooks are encapsulated
 * here so PaneRail's hook order doesn't have to handle the optional
 * viewPrefs.
 */
function IconStrip({
  side,
  stripItems,
  viewPrefs,
}: {
  side: "left" | "right";
  stripItems: PanelKind[];
  viewPrefs: EditorPaneViewPrefs;
}) {
  const selections = useSelectionsContext();
  const { handleStripClick, handleMove } = useStripHandlers({
    prefs: viewPrefs.prefs,
    openPanelDocked: viewPrefs.openPanelDocked,
    closePopout: viewPrefs.closePopout,
    movePanel: viewPrefs.movePanel,
    selections,
  });

  const activeOnSide = side === "left"
    ? viewPrefs.prefs.activeLeft
    : viewPrefs.prefs.activeRight;
  const activeBottomOnSide = side === "left"
    ? viewPrefs.prefs.activeLeftBottom
    : viewPrefs.prefs.activeRightBottom;
  const isLeft = side === "left";

  return (
    <div
      data-strip-side={side}
      data-prefs="backgroundColor"
      className="flex flex-col items-center pt-2 pb-3 px-1.5 bg-[var(--background)] shrink-0 gap-2.5 sticky top-0 z-20 self-start"
    >
      {/* View-controls pod: collapse/expand, blank, split */}
      <div className="flex flex-col items-center gap-0.5 p-1 rounded-md bg-surface/70 border border-edge-hover">
        <button
          onClick={() => {
            if (activeOnSide) {
              isLeft ? viewPrefs.collapseLeft() : viewPrefs.collapseRight();
            } else {
              isLeft ? viewPrefs.expandLeft() : viewPrefs.expandRight();
            }
          }}
          className="iconbtn-md iconbtn-toggle"
          aria-pressed={!!activeOnSide}
          data-hint="Toggle sidebar"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="4" width="16" height="16" rx="1.5" />
            {activeOnSide && (
              isLeft
                ? <rect x="4" y="4" width="5" height="16" fill="currentColor" opacity="0.25" stroke="none" />
                : <rect x="15" y="4" width="5" height="16" fill="currentColor" opacity="0.25" stroke="none" />
            )}
            <line x1={isLeft ? 9 : 15} y1="4" x2={isLeft ? 9 : 15} y2="20" />
          </svg>
        </button>
        <button
          onClick={() => viewPrefs.toggleOmniHideAllCards(side)}
          className="iconbtn-md iconbtn-toggle"
          aria-pressed={viewPrefs.getOmniHideAll(side)}
          data-hint="Omni view"
        >
          <IconBlank active={viewPrefs.getOmniHideAll(side)} />
        </button>
        <button
          onClick={() => viewPrefs.toggleSplit(side)}
          className="iconbtn-md iconbtn-toggle"
          aria-pressed={activeBottomOnSide != null}
          data-hint="Split panel"
        >
          <IconSplit
            active={activeBottomOnSide != null}
            focusedHalf={activeBottomOnSide != null
              ? (isLeft ? viewPrefs.focusedHalfLeft : viewPrefs.focusedHalfRight)
              : undefined}
          />
        </button>
      </div>
      {stripItems.map((p) => (
        <StripButton
          key={p}
          panelId={p}
          active={activeOnSide === p || activeBottomOnSide === p}
          onClick={() => handleStripClick(p, side)}
          onMove={handleMove}
          side={side}
          stripRef={null as unknown as React.RefObject<HTMLDivElement | null>}
        />
      ))}
      <div className="mt-auto">
        <OmniFilterMenu
          side={side}
          enabled={viewPrefs.getOmniEnabled(side)}
          onToggle={(cat) => viewPrefs.toggleOmniCategory(side, cat)}
          onSelectDefault={() => viewPrefs.setOmniSideToDefault(side)}
          categorySides={viewPrefs.categorySides}
          defaultCategories={DEFAULT_OMNI_CATEGORIES[side]}
        />
      </div>
    </div>
  );
}

function PaneRail({
  side,
  visiblePanels,
  activePanelKind,
  onSelectPanel,
  editor,
  editorRef,
  examples,
  docId,
  citationsHook,
  annotationsHook,
  bibReviewHook,
  bibSettingsHook,
  notesHook,
  cardCreation,
  allEditorCitations,
  citationPositionMap,
  citationOrder,
  footnoteInfos,
  setBibActiveCitationId,
  pendingCitationCreate,
  setPendingCitationCreate,
  pendingCitationMode,
  setPendingCitationMode,
  notesPanelSide,
  bibliographyPanelSide,
  todoPanelSide,
  cutterPanelSide,
  reportsPanelSide,
  revisionsPanelSide,
  discardPristineNotes,
  todosHook,
  archiveHook,
  cutterHook,
  reportsHook,
  revisionsHook,
  sortedArchiveSnippets,
  anchoredArchiveIds,
  onArchiveInsert,
  onArchiveRestore,
  onArchiveDelete,
  onAddFootnote,
  onEditFootnote,
  onEditFootnoteTitle,
  onDeleteFootnote,
  selectedNoteId,
  setSelectedNoteId,
  latexErrors,
  selectedErrorId,
  setSelectedErrorId,
  dismissedErrorIds,
  onDismissError,
  onJumpToError,
  errorSnippets,
  paragraphByErrorId,
  searchState,
  setSearchState,
  setSearchHighlightRange,
  openItemInPanel,
  wordCountHook,
  viewPrefs,
  tail,
}: PaneRailProps) {
  const isLeft = side === "left";

  // `examples` arrives as a prop — derived reactively in the EditorPane body
  // (keyed on the `editor` state, not a ref) and threaded down like
  // `footnoteInfos`. Deriving it here from `editorRef` gated on a structural
  // counter failed to populate on load (the counter doesn't bump on mount).

  // Canonical PanelColumn rendering — both main app and Library Reader
  // pass `viewPrefs` (the latter via `useReaderViewPrefs()`), so this
  // is the only render path. The `viewPrefs?` prop type is kept
  // permissive so callers in flux can omit it; the early exit covers
  // that hypothetical.
  if (!viewPrefs) return null;

  // Strip items: filter visiblePanels to this side. Driven by
  // `placementSideByKind` (caller-supplied placements) but the
  // canonical strip mirrors registry default if unplaced.
  const stripItems: PanelKind[] = visiblePanels.filter((k) => {
      const placed = viewPrefs.prefs.placements.find((p) => p.id === k);
      const s = placed?.side ?? PANEL_REGISTRY[k]?.defaultStripSide ?? "right";
      return s === side;
    });
    const isSplit = side === "left"
      ? viewPrefs.prefs.activeLeftBottom != null
      : viewPrefs.prefs.activeRightBottom != null;
    const dockOccupancy = isSplit
      ? {
          top: viewPrefs.prefs.dockSlots[dockSlotKey(side, "top")],
          bottom: viewPrefs.prefs.dockSlots[dockSlotKey(side, "bottom")],
        }
      : { full: viewPrefs.prefs.dockSlots[dockSlotKey(side, "full")] };
    const focusedHalf = side === "left"
      ? viewPrefs.focusedHalfLeft
      : viewPrefs.focusedHalfRight;
    const onFocusHalf = side === "left"
      ? viewPrefs.setFocusedHalfLeft
      : viewPrefs.setFocusedHalfRight;
    const splitRatio = side === "left"
      ? viewPrefs.prefs.splitLeftRatio
      : viewPrefs.prefs.splitRightRatio;

    const omniSlot: PanelSlot = {
      omni: (
        <OmniHost
          side={side}
          footnotes={footnoteInfos}
          orphanedFootnotes={viewPrefs.orphanedFootnotes}
          handleEditFootnote={onEditFootnote}
          handleDeleteFootnote={onDeleteFootnote}
          handleEditFootnoteTitle={onEditFootnoteTitle}
          handleEditOrphan={viewPrefs.onEditOrphan}
          handleDeleteOrphan={viewPrefs.onDeleteOrphan}
          handleEditOrphanTitle={viewPrefs.onEditOrphanTitle}
          citations={citationsHook.citations}
          citationPositionMap={citationPositionMap}
          bibEntries={citationsHook.bibEntries}
          bibPackage={citationsHook.bibPackage}
          updateCitation={citationsHook.updateCitation}
          deleteCitation={citationsHook.deleteCitation}
          getFormattedBib={citationsHook.getFormattedBib}
          updateBibEntry={citationsHook.updateBibEntry}
          updateBibKeyAndType={citationsHook.updateBibKeyAndType}
          getAnnotation={annotationsHook.getAnnotation}
          setAnnotation={annotationsHook.setAnnotation}
          requestBibReview={bibReviewHook.requestReview}
          cancelBibReview={bibReviewHook.cancelRequest}
          getBibReviewStatus={bibReviewHook.getRequestStatus}
          notesCards={notesHook.cards}
          updateNote={notesHook.updateNote}
          updateNoteTitle={notesHook.updateNoteTitle}
          setNoteAiRequest={notesHook.setNoteAiRequest}
          setHighlightAiRequest={notesHook.setHighlightAiRequest}
          addNoteForHighlight={cardCreation.addNoteForHighlight}
          deleteNote={cardCreation.deleteHighlightOrNote}
          sortedArchiveSnippets={sortedArchiveSnippets}
          anchoredIds={anchoredArchiveIds}
          updateArchiveSnippet={archiveHook.updateSnippet}
          updateArchiveSnippetTitle={archiveHook.updateSnippetTitle}
          handleDeleteArchive={onArchiveDelete}
          todoItems={todosHook.items}
          toggleTodo={todosHook.toggleItem}
          updateTodo={todosHook.updateItem}
          updateTodoNotes={todosHook.updateNotes}
          setTodoAiRequest={todosHook.setAiRequest}
          deleteTodo={todosHook.deleteItem}
          examples={examples}
          revisionCards={revisionsHook.cards}
          updateRevisionCommentContent={revisionsHook.updateCommentContent}
          setRevisionCommentAiRequest={revisionsHook.setCommentAiRequest}
          updateRevisionSuggestionField={revisionsHook.updateSuggestionField}
          setRevisionSuggestionStatus={revisionsHook.setSuggestionStatus}
          convertRevisionCard={revisionsHook.convertCard}
          deleteRevisionCard={revisionsHook.deleteCard}
          latexErrors={latexErrors}
          paragraphByErrorId={paragraphByErrorId}
          errorSnippets={errorSnippets}
          dismissedErrorIds={dismissedErrorIds}
          dismissError={onDismissError}
          jumpToError={onJumpToError}
          selectedErrorId={selectedErrorId}
          setSelectedErrorId={setSelectedErrorId}
          cutterCards={cutterHook.cards}
          updateCutterCommentText={cutterHook.updateCommentText}
          setCutterCommentAiRequest={cutterHook.setCommentAiRequest}
          updateCutterSuggestionField={cutterHook.updateSuggestionField}
          setCutterSuggestionStatus={cutterHook.setSuggestionStatus}
          deleteCutterCard={cutterHook.deleteCard}
          reportCards={reportsHook.cards}
          updateReportContent={reportsHook.updateReportContent}
          updateReportTitle={reportsHook.updateReportTitle}
          updateRequestContent={reportsHook.updateRequestContent}
          setRequestAiRequest={reportsHook.setRequestAiRequest}
          deleteReportCard={reportsHook.deleteCard}
          getOmniEnabled={viewPrefs.getOmniEnabled}
          getOmniHideAll={viewPrefs.getOmniHideAll}
          focusState={viewPrefs.focusState}
        />
      ),
      // FloatingPanel portals its children into the dock-slot anchor
      // for docked panels, or to body for floating panels. Either way
      // the panel content arrives via portal, not via this overlay,
      // so overlay stays null. (Overlay is reserved for the rare
      // case of pre-rendering opaque content over omni without going
      // through the FloatingPanel shell.)
      overlay: null,
    };

    const stripJsx = !viewPrefs.zenMode && (
      <IconStrip side={side} stripItems={stripItems} viewPrefs={viewPrefs} />
    );

    const isCollapsed = side === "left"
      ? viewPrefs.prefs.activeLeft == null
      : viewPrefs.prefs.activeRight == null;

    const panelColumnJsx = isSplit ? (
      <PanelColumn
        side={side}
        panelPref={viewPrefs.getPanelWidth(side, "omni")}
        onPanelPrefChange={(w) => viewPrefs.setPanelWidth(side, "omni", w)}
        isResizing={viewPrefs.isResizingPanels}
        onResizingChange={viewPrefs.setIsResizingPanels}
        onSyncBeforeDrag={viewPrefs.syncPanelPrefsToRendered}
        topPanelId="omni"
        bottomPanelId="omni"
        dockOccupancy={dockOccupancy}
        split
        collapsed={isCollapsed}
        focusedHalf={focusedHalf}
        onFocusHalf={onFocusHalf}
        tail={tail}
      >
        {{
          top: omniSlot,
          bottom: { omni: null, overlay: null },
          ratio: splitRatio,
          onRatioChange: (r: number) => viewPrefs.setSplitRatio(side, r),
        }}
      </PanelColumn>
    ) : (
      <PanelColumn
        side={side}
        panelPref={viewPrefs.getPanelWidth(side, "omni")}
        onPanelPrefChange={(w) => viewPrefs.setPanelWidth(side, "omni", w)}
        isResizing={viewPrefs.isResizingPanels}
        onResizingChange={viewPrefs.setIsResizingPanels}
        onSyncBeforeDrag={viewPrefs.syncPanelPrefsToRendered}
        topPanelId="omni"
        dockOccupancy={dockOccupancy}
        collapsed={isCollapsed}
        tail={tail}
      >
        {omniSlot}
      </PanelColumn>
    );

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignSelf: "flex-start",
          flex: "0 0 auto",
          // Span the editor's full scroll height so the sticky icon
          // strip inside has room to slide across the entire scroll
          // range (otherwise sticky's containing block is the row's
          // 688px-ish viewport height and strips drift after a few
          // hundred pixels of scroll). `--row-bound-h` is set on the
          // row scroll container by EditorScrollbar; falls back to
          // 100% so the wrapper still fills the row when no editor
          // content has been measured yet.
          minHeight: 'var(--row-bound-h, 100%)',
          // Mirror panel-column.tsx — `clip` clips overflow without
          // establishing a scroll context, so descendants' sticky
          // positioning still latches to the row.
          overflow: 'clip',
        }}
      >
        {isLeft ? (
          <>
            {stripJsx}
            {panelColumnJsx}
          </>
        ) : (
          <>
            {panelColumnJsx}
            {stripJsx}
          </>
        )}
      </div>
    );
}

interface PaneRailBodyProps {
  side: "left" | "right";
  panelKind: PanelKind;
  editor: Editor | null;
  editorRef: RefObject<EditorHandle | null>;
  content: JSONContent | null;
  examples: ReturnType<NonNullable<RefObject<EditorHandle | null>["current"]>["getExamples"]>;
  docId: string;
  citationsHook: ReturnType<typeof useCitations>;
  annotationsHook: ReturnType<typeof useAnnotations>;
  bibReviewHook: ReturnType<typeof useBibReview>;
  bibSettingsHook: ReturnType<typeof useBibSettings>;
  notesHook: ReturnType<typeof useNotes>;
  cardCreation: ReturnType<typeof useCardCreation>;
  allEditorCitations: Array<{
    citationId: string;
    command: string;
    keys: string[];
    pos: number;
  }>;
  citationPositionMap: Map<string, number>;
  citationOrder: string[];
  footnoteInfos: ReturnType<NonNullable<RefObject<EditorHandle | null>["current"]>["getFootnotes"]>;
  setBibActiveCitationId: React.Dispatch<React.SetStateAction<string | null>>;
  pendingCitationCreate: string | null;
  setPendingCitationCreate: React.Dispatch<React.SetStateAction<string | null>>;
  pendingCitationMode: "anchored" | "unanchored";
  setPendingCitationMode: React.Dispatch<React.SetStateAction<"anchored" | "unanchored">>;
  notesPanelSide: "left" | "right" | null;
  bibliographyPanelSide: "left" | "right" | null;
  todoPanelSide: "left" | "right" | null;
  cutterPanelSide: "left" | "right" | null;
  reportsPanelSide: "left" | "right" | null;
  revisionsPanelSide: "left" | "right" | null;
  discardPristineNotes: () => void;
  todosHook: ReturnType<typeof useTodos>;
  archiveHook: ReturnType<typeof useArchive>;
  cutterHook: ReturnType<typeof useCutter>;
  reportsHook: ReturnType<typeof useReports>;
  revisionsHook: ReturnType<typeof useRevisions>;
  sortedArchiveSnippets: ReturnType<typeof useArchive>["snippets"];
  anchoredArchiveIds: Set<string>;
  onArchiveInsert: (id: string) => void;
  onArchiveRestore: (id: string) => void;
  onArchiveDelete: (id: string) => void;
  onAddFootnote: () => string;
  onEditFootnote: (id: string, newContent: JSONContent) => void;
  onEditFootnoteTitle: (id: string, title: string) => void;
  onDeleteFootnote: (id: string) => void;
  selectedNoteId: string | null;
  setSelectedNoteId: React.Dispatch<React.SetStateAction<string | null>>;
  latexErrors: LatexError[];
  selectedErrorId: string | null;
  setSelectedErrorId: React.Dispatch<React.SetStateAction<string | null>>;
  dismissedErrorIds: Set<string>;
  onDismissError: (id: string) => void;
  onJumpToError: (err: LatexError) => void;
  errorSnippets: Map<string, string>;
  paragraphByErrorId: Map<string, string>;
  searchState: SearchPanelState;
  setSearchState: React.Dispatch<React.SetStateAction<SearchPanelState>>;
  setSearchHighlightRange: React.Dispatch<React.SetStateAction<{ from: number; to: number } | null>>;
  openItemInPanel: (panel: PanelId, itemId: string) => void;
  wordCountHook: ReturnType<typeof useWordCount>;
  /** Optional bundle. When provided, the body's outline branch routes
   *  to `<OutlineHost>` (focus-mode + section-path aware); otherwise
   *  to the simpler direct `<OutlinePanel>` (Reader path). */
  viewPrefs?: EditorPaneViewPrefs;
}

function PaneRailBody({
  side,
  panelKind,
  editor,
  editorRef,
  content,
  examples,
  docId,
  citationsHook,
  annotationsHook,
  bibReviewHook,
  bibSettingsHook,
  notesHook,
  cardCreation,
  allEditorCitations,
  citationPositionMap,
  citationOrder,
  footnoteInfos,
  setBibActiveCitationId,
  pendingCitationCreate,
  setPendingCitationCreate,
  pendingCitationMode,
  setPendingCitationMode,
  notesPanelSide,
  bibliographyPanelSide,
  todoPanelSide,
  cutterPanelSide,
  reportsPanelSide,
  revisionsPanelSide,
  discardPristineNotes,
  todosHook,
  archiveHook,
  cutterHook,
  reportsHook,
  revisionsHook,
  sortedArchiveSnippets,
  anchoredArchiveIds,
  onArchiveInsert,
  onArchiveRestore,
  onArchiveDelete,
  onAddFootnote,
  onEditFootnote,
  onEditFootnoteTitle,
  onDeleteFootnote,
  selectedNoteId,
  setSelectedNoteId,
  latexErrors,
  selectedErrorId,
  setSelectedErrorId,
  dismissedErrorIds,
  onDismissError,
  onJumpToError,
  errorSnippets,
  paragraphByErrorId,
  searchState,
  setSearchState,
  setSearchHighlightRange,
  openItemInPanel,
  wordCountHook,
  viewPrefs,
}: PaneRailBodyProps) {
  if (panelKind === "outline") {
    // Main app path — full OutlineHost with section-path + focus mode.
    if (viewPrefs) {
      return (
        <OutlineHost
          content={content}
          onScrollTo={viewPrefs.onScrollToHeading}
          onReorderBlocks={viewPrefs.onReorderBlocks}
          onRenameHeading={viewPrefs.onRenameHeading}
          onRenameParTitle={viewPrefs.onRenameParTitle}
          onUpdateLabel={viewPrefs.onUpdateLabel}
          isLabelTaken={viewPrefs.isLabelTaken}
          activeSectionPath={viewPrefs.activeSectionPath}
          activeParTitleIndex={viewPrefs.activeParTitleIndex}
          editorSplit={viewPrefs.prefs.editorSplit}
          mirrorSectionPath={viewPrefs.mirrorSectionPath}
          mirrorParTitleIndex={viewPrefs.mirrorParTitleIndex}
          focusState={viewPrefs.focusState ?? { active: false } as FocusState}
          onFocusActivate={viewPrefs.onFocusActivate}
          onFocusDeactivate={viewPrefs.onFocusDeactivate}
          onFocusToggleLock={viewPrefs.onFocusToggleLock}
          onFocusMoveTo={viewPrefs.onFocusMoveTo}
          onFocusExpandTo={viewPrefs.onFocusExpandTo}
          onFocusSnapBoundary={viewPrefs.onFocusSnapBoundary}
        />
      );
    }
    // Reader path — direct OutlinePanel, no focus / section-path
    // chrome (Reader chrome doesn't surface those affordances).
    return (
      <OutlinePanel
        content={content}
        onScrollTo={(headingIndex: number) => {
          if (!editor) return;
          // Find the heading by its top-level block index in the doc.
          let idx = 0;
          let foundPos: number | null = null;
          editor.state.doc.forEach((_node, pos) => {
            if (idx === headingIndex) foundPos = pos;
            idx++;
          });
          if (foundPos == null) return;
          editor.commands.focus();
          editor.commands.setTextSelection(foundPos);
          const { view } = editor;
          const dom = view.nodeDOM(foundPos) as HTMLElement | null;
          dom?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
      />
    );
  }
  if (panelKind === "examples") {
    return (
      <ExamplesPanelHost editorRef={editorRef} examples={examples} />
    );
  }
  if (panelKind === "footnotes") {
    return (
      <FootnotesHost
        side={side}
        footnotes={footnoteInfos}
        // Reader has no orphans (no edit). Empty list.
        orphanedFootnotes={[]}
        onEdit={onEditFootnote}
        onEditTitle={onEditFootnoteTitle}
        onDelete={onDeleteFootnote}
        onAdd={onAddFootnote}
        onDeleteOrphan={() => {}}
        onEditOrphan={() => {}}
        onEditOrphanTitle={() => {}}
      />
    );
  }
  if (panelKind === "citations") {
    return (
      <CitationsHost
        side={side}
        citations={citationsHook.citations}
        bibEntries={citationsHook.bibEntries}
        citationStyle={citationsHook.citationStyle}
        bibPackage={citationsHook.bibPackage}
        bibPath={citationsHook.bibPath}
        citationOrder={citationOrder}
        addCitation={citationsHook.addCitation}
        updateCitation={citationsHook.updateCitation}
        deleteCitation={citationsHook.deleteCitation}
        setCitationStyle={citationsHook.setStyle}
        setBibPackage={citationsHook.setBibPackage}
        updateBibEntry={citationsHook.updateBibEntry}
        updateBibKeyAndType={citationsHook.updateBibKeyAndType}
        addBibEntry={citationsHook.addBibEntry}
        getFormattedBib={citationsHook.getFormattedBib}
        getAnnotation={annotationsHook.getAnnotation}
        setAnnotation={annotationsHook.setAnnotation}
        requestBibReview={bibReviewHook.requestReview}
        cancelBibReview={bibReviewHook.cancelRequest}
        getBibReviewStatus={bibReviewHook.getRequestStatus}
        citationPositionMap={citationPositionMap}
        pendingCitationCreate={pendingCitationCreate}
        setPendingCitationCreate={setPendingCitationCreate}
        pendingCitationMode={pendingCitationMode}
        setPendingCitationMode={setPendingCitationMode}
      />
    );
  }
  if (panelKind === "notes") {
    return (
      <NotesHost
        side={side}
        panelSide={notesPanelSide}
        cards={notesHook.cards}
        addNote={notesHook.addNote}
        addHighlight={notesHook.addHighlight}
        updateNote={notesHook.updateNote}
        updateNoteTitle={notesHook.updateNoteTitle}
        setNoteAiRequest={notesHook.setNoteAiRequest}
        setHighlightAiRequest={notesHook.setHighlightAiRequest}
        deleteNote={notesHook.deleteNote}
        discardPristine={discardPristineNotes}
      />
    );
  }
  if (panelKind === "todo") {
    return (
      <TodoHost
        side={side}
        panelSide={todoPanelSide}
        todoItems={todosHook.items}
        addTodo={todosHook.addItem}
        toggleTodo={todosHook.toggleItem}
        updateTodo={todosHook.updateItem}
        updateTodoNotes={todosHook.updateNotes}
        setTodoAiRequest={todosHook.setAiRequest}
        deleteTodo={todosHook.deleteItem}
        archiveTodos={todosHook.archiveDone}
        discardPristine={todosHook.discardPristineTodos}
      />
    );
  }
  if (panelKind === "archive") {
    return (
      <ArchiveHost
        side={side}
        sortedArchiveSnippets={sortedArchiveSnippets}
        archiveSnippets={archiveHook.snippets}
        updateArchiveSnippet={archiveHook.updateSnippet}
        updateArchiveSnippetTitle={archiveHook.updateSnippetTitle}
        onInsert={onArchiveInsert}
        onRestore={onArchiveRestore}
        onDelete={onArchiveDelete}
        anchoredIds={anchoredArchiveIds}
      />
    );
  }
  if (panelKind === "cutter") {
    return (
      <CutterHost
        side={side}
        panelSide={cutterPanelSide}
        cards={cutterHook.cards}
        goal={cutterHook.goal}
        setGoal={cutterHook.setGoal}
        clearGoal={cutterHook.clearGoal}
        updateCommentText={cutterHook.updateCommentText}
        setCommentAiRequest={cutterHook.setCommentAiRequest}
        updateSuggestionField={cutterHook.updateSuggestionField}
        setSuggestionStatus={cutterHook.setSuggestionStatus}
        deleteCard={cutterHook.deleteCard}
        discardPristine={cutterHook.discardPristineCards}
      />
    );
  }
  if (panelKind === "reports") {
    return (
      <ReportsHost
        side={side}
        panelSide={reportsPanelSide}
        cards={reportsHook.cards}
        updateReportContent={reportsHook.updateReportContent}
        updateReportTitle={reportsHook.updateReportTitle}
        updateRequestContent={reportsHook.updateRequestContent}
        setRequestAiRequest={reportsHook.setRequestAiRequest}
        deleteCard={reportsHook.deleteCard}
        discardPristine={reportsHook.discardPristineCards}
      />
    );
  }
  if (panelKind === "revisions") {
    return (
      <RevisionsHost
        side={side}
        panelSide={revisionsPanelSide}
        cards={revisionsHook.cards}
        tracker={revisionsHook.tracker}
        setTrackerTarget={revisionsHook.setTrackerTarget}
        updateCommentContent={revisionsHook.updateCommentContent}
        setCommentAiRequest={revisionsHook.setCommentAiRequest}
        updateSuggestionField={revisionsHook.updateSuggestionField}
        setSuggestionStatus={revisionsHook.setSuggestionStatus}
        convertCard={revisionsHook.convertCard}
        deleteCard={revisionsHook.deleteCard}
        discardPristine={revisionsHook.discardPristineCards}
      />
    );
  }
  if (panelKind === "errors") {
    return (
      <ErrorsHost
        errors={latexErrors}
        selectedId={selectedErrorId}
        onSelect={setSelectedErrorId}
        dismissedIds={dismissedErrorIds}
        onDismiss={onDismissError}
        onJump={onJumpToError}
        snippets={errorSnippets}
        paragraphByErrorId={paragraphByErrorId}
      />
    );
  }
  if (panelKind === "search") {
    return (
      <SearchHost
        footnotes={footnoteInfos}
        orphanedFootnotes={[]}
        notes={notesHook.notes}
        citations={citationsHook.citations}
        allEditorCitations={allEditorCitations}
        todoItems={todosHook.items}
        archiveSnippets={archiveHook.snippets}
        cutterCards={cutterHook.cards}
        comments={revisionsHook.cards}
        bibEntries={citationsHook.bibEntries}
        openItemInPanel={openItemInPanel}
        searchState={searchState}
        setSearchState={setSearchState}
        setSearchHighlightRange={setSearchHighlightRange}
      />
    );
  }
  if (panelKind === "wordcount") {
    return (
      <WordCountPanel
        counts={wordCountHook.counts}
        selection={wordCountHook.selection}
      />
    );
  }
  if (panelKind === "bibliography") {
    return (
      <BibliographyHost
        side={side}
        panelSide={bibliographyPanelSide}
        citations={citationsHook.citations}
        bibEntries={citationsHook.bibEntries}
        bibPackage={citationsHook.bibPackage}
        addBibEntry={citationsHook.addBibEntry}
        updateBibEntry={citationsHook.updateBibEntry}
        updateBibKeyAndType={citationsHook.updateBibKeyAndType}
        getFormattedBib={citationsHook.getFormattedBib}
        getAnnotation={annotationsHook.getAnnotation}
        setAnnotation={annotationsHook.setAnnotation}
        requestBibReview={bibReviewHook.requestReview}
        cancelBibReview={bibReviewHook.cancelRequest}
        getBibReviewStatus={bibReviewHook.getRequestStatus}
        allEditorCitations={allEditorCitations}
        citationPositionMap={citationPositionMap}
        setBibActiveCitationId={setBibActiveCitationId}
        currentDocId={docId}
        entryRequests={bibSettingsHook.entryRequests}
        addEntryRequest={bibSettingsHook.addEntryRequest}
        removeEntryRequest={bibSettingsHook.removeEntryRequest}
      />
    );
  }
  // Fallback for any panel kind in the chrome whitelist that EditorPane
  // doesn't yet have explicit wiring for. With the current Reader
  // chrome (`outline`, `examples`, `footnotes`, `citations`,
  // `bibliography`, `notes`) every kind has a real renderer above —
  // this branch only fires if a future chrome adds an unwired kind.
  return (
    <div
      style={{
        padding: 12,
        fontSize: 12,
        color: "var(--ink-muted)",
        fontStyle: "italic",
      }}
    >
      The <strong>{panelKind}</strong> panel isn&apos;t wired into
      EditorPane yet.
    </div>
  );
}

/* ── Doc-derived panel hosts ─────────────────────────────────────────
 *
 * Examples and Footnote markers are derived from the editor's live
 * doc (no sidecar storage), so we can wire them in the Reader without
 * any hook context. The `examples` list is derived reactively in the
 * EditorPane body (keyed on the `editor` state + `rev.examples`) and
 * passed in as a prop, so it populates on mount and refreshes only when
 * examples change. Edit callbacks no-op in Reader mode (`editable: false`
 * prevents any user mutation reaching this surface anyway).
 */

interface PanelHostProps {
  editorRef: RefObject<EditorHandle | null>;
  examples: ReturnType<NonNullable<RefObject<EditorHandle | null>["current"]>["getExamples"]>;
}

function ExamplesPanelHost({ editorRef, examples }: PanelHostProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return (
    <ExamplesPanel
      examples={examples}
      selectedId={selectedId}
      onSelect={setSelectedId}
      onJump={(id, sourceEl) => {
        editorRef.current?.scrollToExample(id, sourceEl ?? null);
      }}
    />
  );
}

// Note: CitationsPanelHost / FootnotePanelHost local definitions
// were removed in Step 7.5 — the canonical `CitationsHost` /
// `FootnotesHost` (under `editor-layout/panels/`) now drive the
// Reader's panel rendering, matching the main app's path.
