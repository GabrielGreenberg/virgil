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
 *   - `chrome.showParagraphFloatTitleEdit` /
 *     `chrome.showHeadingFloatLabelEdit` already gated.
 *   - Read-only `Marginalia` suppresses drag-to-rebind via
 *     `editor.isEditable`.
 */

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
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
import { planJumpDocks } from "./editor-layout/jump-docks";
// The Reader's direct `<OutlinePanel>` branch was collapsed into the single
// `<OutlineHost>` path (both surfaces now pass `viewPrefs`), so OutlinePanel
// is no longer mounted here — OutlineHost owns the outline render.
import ExamplesPanel from "@/panels/Examples";
import { PANEL_REGISTRY, cardPopKey } from "@/panels/panel-registry";
import { focusNewCard } from "@/lib/focus-new-card";
import { SectionLozenge } from "./editor-layout/section-lozenge";
import { useCodePaneSplit } from "./editor-layout/CodePaneSplitContext";
import { EditorScrollbar } from "./editor-layout/editor-scrollbar";
import { ZenMargin } from "./editor-layout/zen-margin";
import PrintAppendices from "./PrintAppendices";
import { LoadingScreen } from "./LoadingScreen";
import type { PrintPanelKey } from "@/lib/print";
import { EditorRefProvider } from "./editor-layout/contexts/editor-ref";
import { SelectionsProvider, useAnchoredSelectionSlots } from "./editor-layout/contexts/selections";
import {
  getCardStore,
  CardStoreProvider,
  type AnchoredCardRef,
} from "@/links/_shared/anchored-card-store";
import type { EntityKind } from "@/links/_shared/entity-hover";
import { useAnchorHighlightReconciler } from "@/links/_shared/useAnchorHighlightReconciler";
import {
  useLinkedAnchorReconciler,
  reapOrphanLinkedAnchors,
} from "@/links/_shared/useLinkedAnchorReconciler";
import { useTextHoverBridge } from "@/links/_shared/useTextHoverBridge";
import { usePanelCardHoverBridge } from "@/links/_shared/usePanelCardHoverBridge";
import { usePlacement, suppressNextPlacement } from "@/links/_shared/usePlacement";
import { AiRequestsProvider } from "./editor-layout/contexts/ai-requests";
import { RecentlyAddedProvider } from "./editor-layout/contexts/recently-added";
import { CardCreationProvider } from "./editor-layout/contexts/card-creation";
import {
  CardArchiveViewProvider,
  type CardArchiveViewApi,
} from "@/panels/_shared/card-archive-view";
import { useCardCreation } from "./editor-layout/card-actions/card-creation";
import { useCitationActions } from "./editor-layout/card-actions/citations";
import { resolveLabelDisplay } from "./editor-layout/card-actions/ref";
import {
  isAnchorableNode,
  MARGINALIA_MIN_MARGIN_LEFT,
  MARGINALIA_MIN_MARGIN_RIGHT,
  resolveHorizontalMargin,
} from "@/lib/marginalia";
import { isTier1CDisabled } from "@/lib/perf-flags";
import { useCitations, type CitationsHook } from "@/hooks/useCitations";
import { useAutoAddLibraryEntriesForCitations } from "@/hooks/useAutoAddLibraryEntriesForCitations";
import { useLibraryMasterBib } from "@/hooks/useLibrary";
import { useAnnotations } from "@/hooks/useAnnotations";
import { useBibReview } from "@/hooks/useBibReview";
import { useBibSettings } from "@/hooks/useBibSettings";
import { useNotes } from "@/hooks/useNotes";
import { useAiRequests } from "@/hooks/useAiRequests";
import { useAiRequestCardMigration } from "@/hooks/useAiRequestCardMigration";
import { useRecentlyAddedTracker } from "@/hooks/useRecentlyAddedTracker";
import { useDocument } from "@/hooks/useDocument";
import { useIsVisible } from "@/lib/keep-alive/visibility-context";
import { readPdf } from "@/lib/storage";
import { useEditorUIState } from "@/hooks/useEditorUIState";
import { useLatexCompile, type DocumentClassMismatchHandler } from "@/hooks/useLatexCompile";
import { useLatexSource } from "@/hooks/useLatexSource";
import { useDiagnostics, DiagnosticsProvider, useDiagnosticsContext } from "@/hooks/useDiagnostics";
import { asBibFamily } from "@/lib/bib-family";
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
import { useAutoApplyPendingChanges } from "@/hooks/useAutoApplyPendingChanges";
import { usePristineCardManager } from "@/hooks/usePristineCardManager";
import { PristineCardsProvider } from "./editor-layout/contexts/pristine-cards";
import { CitationDisplayProvider } from "./editor-layout/contexts/citation-display";
import { DockOutline } from "./editor-layout/DockOutline";
import { CardLiftOutline } from "./CardLiftOutline";
import { type PoppedCardDeps } from "./editor-layout/floating-cards";
import { FloatHost } from "@/floats/FloatHost";
import { parseAnyKey } from "@/floats/float-key";
import { FLOAT_DEFAULT_SIZE } from "@/floats/float-policy";
import { textObjectPopoutKey } from "@/text-objects/text-object-registry";
import { LiftHost } from "@/text-objects/LiftHost";
import { CARD_REGISTRY } from "@/cards/card-registry";
import { cardHasContent } from "@/cards/has-content";
import { runCardLifecycleEvent } from "@/cards/lifecycle/run-event";
import { bridgeCardAiRequestFlag } from "@/lib/ai-request-bridge";
import { isCardKind, panelForCardKind, isArchivable, archiveRemovesAtom } from "@/cards/predicates";
import {
  CardArchiveActionsProvider,
  type CardArchiveActionsApi,
} from "@/panels/_shared/card-archive-actions";
import { PoppedCardsContext, type PoppedCardsValue } from "@/hooks/usePoppedCards";
import { DropModeProvider } from "./drop-mode/DropModeProvider";
import type { StackPullApi } from "./drop-mode/types";
import { StackIcon } from "./stack/StackIcon";
import { StackStrip } from "./stack/StackStrip";
import { useStack, addStackItem } from "@/hooks/useStack";
import type { StackItem as StackItemType } from "@/lib/stack/types";
import { textObjectFloatable } from "@/text-objects/text-object-floatable";
import { isTextObjectKind } from "@/text-objects/text-object-registry";
import { useDragHandleActions, type DragHandleRef } from "./editor-layout/card-actions/drag-handle-actions";
import { DragHandleMenuProvider, type DragHandleMenuApi } from "./editor-layout/card-actions/drag-handle-menu-context";
// CHIP 4a-i — the PM→React bridge. EditorPane publishes an
// `EditorActionsHandle` into the module-singleton so plugin-land code (slash /
// typed, wired in 4a-ii) can reach the registry's React-land `run()`s. The
// handle is the typed replacement for the scattered `virgil-*` CustomEvents.
import {
  VIRGIL_ACTION_REGISTRY,
  type ActionContext,
  type ActionId,
  type CursorRef,
  type EditorActionsHandle,
} from "@/lib/actions/action-registry";
import {
  registerEditorActionsHandle,
  unregisterEditorActionsHandle,
} from "@/lib/actions/editor-actions-bridge";
import { ATOM_CREATE_POPOVER_EVENT } from "@/lib/actions/atom-create";
import { isRenameCitekey } from "@/lib/identity/identity-cascade";
import { rewriteCiteKeyInDoc } from "@/lib/identity/bib-cite-rewrite";
import { useIdentityBusConsumer } from "@/lib/identity/useIdentityBusConsumer";
import { useInlineAtomLifecycle } from "@/links/_shared/useInlineAtomLifecycle";
import { useCardLifecycleReconciler } from "@/cards/lifecycle/useCardLifecycleReconciler";
import { useCitationResync } from "@/links/_shared/useCitationResync";
import { useOrphanedFootnotes } from "@/hooks/useOrphanedFootnotes";
import { useFootnoteOrphanBridges } from "./editor-layout/event-bridges/footnote-sync";
import { isInlineAtomLifecycleOn } from "@/lib/identity/inline-atom-lifecycle-flag";
import { DragHandleMenu } from "./DragHandleMenu";
import { HeadingTypeMenu, type HeadingTypePick } from "./HeadingTypeMenu";
import ConfirmDialog, { useConfirmDialog } from "./ConfirmDialog";
import {
  buildMarginItemHandlers,
  deleteMarginItem,
  type MarginItemHandlers,
  type MarginItemKind,
} from "@/cards/delete-margin-item";
import { resolveStyle } from "@/lib/style-library";
import { extractDocumentClass } from "@/lib/document-class";
import { PanelColumn } from "./editor-layout/panel-column";
import { PanelChromeProvider, useCycle } from "./panel-primitives";
import { findEditorScrollFor } from "./editor-layout/layout-scroll";
import { findLinkedAnchorRange } from "@/lib/linked-anchor-range";
import FloatingPanel from "./FloatingPanel";
import { OmniHost } from "./editor-layout/panels/omni-host";
import { OutlineHost } from "./editor-layout/panels/outline-host";
import {
  FLOATING_PANEL_WIDTH,
  FLOATING_PANEL_HEIGHT,
  FLOATING_PANEL_VIEWPORT_MARGIN,
  FLOATING_PANEL_STACK_OFFSET,
  FLOATING_PANEL_Z_BASE,
  SCROLLBAR_RIGHT_INSET,
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
import {
  PendingChangePill,
  type PendingChangeIndex,
} from "./PendingChangePill";
import { sortAppliedKeysByDocPos } from "@/links/pending-change-nav";
import { StripButton, useStripHandlers } from "./editor-layout/drag-drop";
import { useSelectionsContext } from "./editor-layout/contexts/selections";
import { IconBlank } from "./editor-layout/panel-icons";
import {
  OmniFilterMenu,
  DEFAULT_OMNI_CATEGORIES,
  type OmniBulkPendingChanges,
} from "@/panels/Omni/OmniViewPanel";
import MenuBar, {
  type MarginaliaType,
} from "./MenuBar";
import {
  getLinkedTextObjectIds,
  getTextAnchor,
  createLinkedAnchor,
  updateLinkedAnchorCard,
  paragraphUuidAt,
  captureParagraphSnapshot,
  type CardWithLinks,
} from "@/links/links";
import {
  buildResolveIndex,
  resolveCardAnchor,
} from "@/links/resolve-card-anchor";
import { reapplyModeBAnchors } from "@/links/_shared/reapply-mode-b-anchors";
import {
  reapplyPendingMarks,
  pendingMarkAnchorIds,
  type PendingMarkCardLike,
} from "@/links/_shared/reapply-pending-marks";
import {
  reconcileRequestMarks,
  isModeARequestCard,
  type RequestMarkCardLike,
} from "@/links/_shared/request-marks";
import { defaultTintForLinkedAnchorKind } from "@/cards/legacy-token-crosswalk";
import { isPendingChangesOn } from "@/lib/pending-changes-flag";
import {
  keepSuggestion,
  dismissSuggestion,
  previewOriginal as previewOriginalSuggestion,
  previewSuggested as previewSuggestedSuggestion,
  insertSuggestionBelow,
  type PendingChangeCardDeps,
  type InsertBelowCardDeps,
} from "@/links/pending-change-actions";
import {
  isAppliedPending,
  collectAppliedPendingIds,
} from "@/links/pending-change-collect";
import {
  PendingChangeControllerProvider,
  type PendingChangeController,
} from "@/links/pending-change-controller";
import type { MarginaliaMarker } from "@/lib/marginalia";
import type {
  PanelPlacement,
  PanelId,
  ViewPrefs,
  Side,
  DockSlotKey,
} from "@/hooks/useViewPrefs";
import { bandSlotKey, dockedSideOf } from "@/hooks/useViewPrefs";
import { useMarginEdit, MARGIN_AXIS } from "@/hooks/useMarginEdit";
import type { FocusState } from "@/hooks/useFocusMode";
import type { OmniCategory } from "@/panels/Omni";
import type { SectionPathEntry } from "@/panels/Outline";
import type { PanelKind, CardKind } from "@/panels/_shared/types";
import type {
  AiRequest,
  Suggestion,
  FootnoteRef,
  RevisionSuggestionCard,
  CutterSuggestionCard,
} from "@/lib/types";
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

// Default popped-out card dimensions — the subsystem-wide
// `FLOAT_DEFAULT_SIZE` (float-policy), so spawn positions stay
// consistent with the float stack's own default.
const POPUP_W = FLOAT_DEFAULT_SIZE.w;
const POPUP_H = FLOAT_DEFAULT_SIZE.h;

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
  isResizingPanels: boolean;
  /** From useFocusMode. Drives focus-aware dimming/hiding. */
  focusState: FocusState | null;

  // ── Section path (OutlineHost) ──────────────────────────────────
  activeSectionPath: SectionPathEntry[];
  activeParTitleIndex: number | null;
  mirrorSectionPath: SectionPathEntry[];
  mirrorParTitleIndex: number | null;

  // ── Setters / mutators ──────────────────────────────────────────
  setIsResizingPanels: (r: boolean) => void;
  /** Snap all panel/margin prefs to their currently-rendered widths
   *  before drag start. */
  syncPanelPrefsToRendered: () => void;

  getPanelWidth: (side: Side, panelId: PanelId) => number;
  setPanelWidth: (side: Side, panelId: PanelId, width: number) => void;

  // ── Band heights (the stack model — replaces split ratios) ──────
  /** Persist a per-panel band height in px (a bottom-edge resize). */
  setPanelHeight: (id: PanelId, px: number) => void;
  /** Drop a panel's height override → back to content-sized. */
  clearPanelHeight: (id: PanelId) => void;
  /** Slide the boundary between two adjacent bands (a divider trade);
   *  the caller conserves their summed height. */
  tradePanelHeights: (
    aboveId: PanelId,
    aboveH: number,
    belowId: PanelId,
    belowH: number,
  ) => void;
  /** MRU bump on interaction with a docked panel, for LRU eviction. */
  notePanelUse: (side: Side, id: PanelId) => void;

  // ── Persisted page margins (driven by margin-edit mode) ────────
  setEditorLeftMargin: (px: number) => void;
  setEditorRightMargin: (px: number) => void;
  setEditorTopMargin: (px: number) => void;
  setEditorBottomMargin: (px: number) => void;

  // ── Top / bottom gutter (drag-resizable spacers above/below the
  //    editor pod). The user adjusts these to push the page down from
  //    the docked MenuBar or up from the bottom edge of the window.

  // ── Zen mode (replaces panel rails with adjustable margins) ────
  zenMode: boolean;
  zenLeftMargin: number;
  zenRightMargin: number;
  setZenLeftMargin: (px: number) => void;
  setZenRightMargin: (px: number) => void;

  setActiveLeft: (id: PanelId) => void;
  setActiveRight: (id: PanelId) => void;
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
  redockPanel: (id: PanelId, side: Side, index?: number) => void;

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

  // ── Card archive view (per-panel View Active/Archives/All) ──────
  setCardArchiveView: (
    panel: PanelId,
    mode: import("@/hooks/useViewPrefs").CardArchiveView,
  ) => void;
  setSuppressArchiveAtomWarning: (v: boolean) => void;
  /** Bug 3: persist the Bibliography "Cited only / Full" filter (per-window).
   *  Read side is `prefs.bibFilter`; mirror of the `cardArchiveView`
   *  per-window precedent above. */
  setBibFilter: (v: import("@/hooks/useViewPrefs").ViewPrefs["bibFilter"]) => void;
  /** Footnotes that exist as orphan cards (no in-doc reference). The
   *  Reader has none; the main app feeds these via EditorPane's own
   *  footnote-add handler (`handleAddFootnote`). */
  orphanedFootnotes: import("@/lib/types").OrphanedFootnote[];
  onEditOrphan: (id: string, newContent: unknown) => void;
  onDeleteOrphan: (id: string) => void;
  onEditOrphanTitle: (id: string, title: string) => void;

  // ── OutlineHost handlers ────────────────────────────────────────
  onScrollToHeading: (blockIndex: number) => void;
  onReorderBlocks: (fromIndex: number, count: number, toIndex: number) => void;
  // T3 (W3a): rename/label address by durable block uuid, not integer index.
  onRenameHeading: (uuid: string, newText: string) => void;
  onRenameParTitle: (uuid: string, newTitle: string) => void;
  onUpdateLabel: (uuid: string, newLabel: string | null) => void;
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
      | { kind: "card"; key: string },
  ) => void;
  /** Paint z-index for a popped float, derived from the MRU focus stack
   *  (raise-on-click). Optional — the Reader shim omits it. */
  cardFloatZIndex?: (key: string) => number;

  // ── Icon strip (view-controls pod + StripButton + OmniFilterMenu) ──
  /** Sidebar collapse / expand. Used by the view-controls pod's
   *  collapse-toggle button — `collapsedLeft ? expandLeft() : collapseLeft()`. */
  collapseLeft: () => void;
  collapseRight: () => void;
  expandLeft: () => void;
  expandRight: () => void;
  /** Suppresses the default omni-view on a side ("blank" mode). */
  setBlank: (side: Side) => void;
  /** Clears the blank state on whichever side(s) have it set. Used by
   *  flows that open a new card and need to drop "show nothing" first. */
  clearBlankIfSet: () => void;
  /** Force-docks a panel into its gutter band (appends at the bottom of
   *  the side's stack; evicts the LRU band if there's no room). The
   *  optional `freeSpacePx` lets the caller pass the omni gap from
   *  `measureOmniGap(side)` for the open-time fit check. Required by
   *  `useStripHandlers`. */
  openPanelDocked: (id: PanelId, side?: Side, freeSpacePx?: number) => void;
  /** OmniFilterMenu mutators for per-side category enablement. */
  toggleOmniCategory: (side: Side, cat: OmniCategory) => void;
  setOmniSideToDefault: (side: Side) => void;
  /** Map from each OmniCategory → which side its native panel lives on. */
  categorySides: Record<OmniCategory, Side>;
}

/**
 * Shell state needed to render the docked MenuBar. The Reader doesn't pass
 * this — its chrome hides MenuBar's edit items + the formatting affordances
 * entirely, so the controls driven by these fields are absent.
 *
 * Kept as a separate bundle from `EditorPaneViewPrefs` because these
 * are general view-state toggles (par titles, latex comments, divider
 * levels, paranav, etc.) and shell-owned topbar refs — not
 * dock/float-shaped state.
 */
export interface EditorPaneMenuBarBundle {
  // ── Toggle state (read) ────────────────────────────────────────
  showParTitles: boolean;
  showCardTitles: boolean;
  showLatexComments: boolean;
  showHeadingLabels: boolean;
  omniDimResting: boolean;
  cardOutlineChrome: boolean;
  showMarginalia: boolean;
  hiddenMarginaliaTypes: Set<import("./MenuBar").MarginaliaType>;
  hiddenHighlightTypes: Set<import("@/hooks/useViewPrefs").HighlightType>;
  availableDividerLevels: Set<import("./MenuBar").DividerLevel>;
  activeDividerLevels: Set<import("./MenuBar").DividerLevel>;
  dividerWidth: import("./MenuBar").DividerWidth;
  editorSplit: boolean;
  activeSplitPane: "top" | "bottom";

  // ── Toggle setters ─────────────────────────────────────────────
  onToggleParTitles: () => void;
  onToggleCardTitles: () => void;
  onToggleLatexComments: () => void;
  toggleHeadingLabels: () => void;
  onToggleOmniDimResting: () => void;
  onToggleCardOutline: () => void;
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
  // Live compile diagnostics from EditorPane's single `useLatexCompile`
  // instance. EditorLayout's code-view error sidebar + log drawer read
  // these from here — EditorLayout no longer mounts a (dead) second
  // compile hook, so this is the one authoritative compile source.
  compileErrors: LatexError[];
  compileLog: string | null;
  compileStatus: number | null;
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
  // Pane-owns-all (Phase C): the formerly double-mounted sidecar hooks bubble up
  // so EditorLayout reads the active pane's live data (`paneState?.X ?? INERT`)
  // instead of re-mounting its own singleton copy on docIdForHooks. We bubble
  // the SLICE EditorLayout actually consumes (not the whole hook) for the hooks
  // whose return object isn't memoized, to keep the bubble effect's deps stable.
  // useSuggestions: EditorLayout reads only the current pending suggestion.
  currentSuggestion: Suggestion | null;
  // The remaining Phase-C slices (typed via indexed access so no extra type
  // imports). EditorLayout reads these off `paneState?.X ?? INERT` and no longer
  // mounts its own singleton copy of these hooks on docIdForHooks.
  revisions: ReturnType<typeof useRevisions>["cards"];
  notes: ReturnType<typeof useNotes>["notes"];
  cutterCards: ReturnType<typeof useCutter>["cards"];
  todoItems: ReturnType<typeof useTodos>["items"];
  archiveSnippets: ReturnType<typeof useArchive>["snippets"];
  deleteArchiveSnippet: ReturnType<typeof useArchive>["deleteSnippet"];
  addRequest: ReturnType<typeof useAiRequests>["addRequest"];
  updateRequestText: ReturnType<typeof useAiRequests>["updateRequestText"];
  deleteRequest: ReturnType<typeof useAiRequests>["deleteRequest"];
  // The search-panel highlight range. EditorPane is the canonical owner —
  // SearchHost mounts INSIDE EditorPane and writes this local, and EditorPane's
  // own <Editor> renders the highlight overlay. It bubbles up so EditorLayout
  // (and any future cross-pane consumer) can read the live range from the one
  // owner instead of a dead duplicate. The producer→editor path no longer
  // crosses the component boundary in the wrong direction (SR-F3-01/F8-01).
  searchHighlightRange: { from: number; to: number } | null;
  // Diagnostics (P5 item 4): EditorPane is now the single per-doc owner of the
  // lint+compile error surface. The shell reads these for its code-view Errors
  // sidebar + error badge, routes marker/click-away selection through
  // `setSelectedErrorId`, and feeds `setSourceText` from the CodeEditor mirror
  // while the code view is open.
  latexErrors: LatexError[];
  selectedErrorId: string | null;
  setSelectedErrorId: (id: string | null) => void;
  dismissedErrorIds: Set<string>;
  dismissError: (id: string) => void;
  expandedErrorIds: Set<string>;
  expandError: (id: string) => void;
  toggleErrorExpanded: (id: string) => void;
  errorSnippets: Map<string, string>;
  paragraphByErrorId: Map<string, string>;
  jumpToErrorVisual: (err: LatexError) => void;
  setSourceText: (text: string) => void;
  // Code-pane preamble commit (`useDocument.saveWithDelimiters`): persists
  // the live doc with caller-supplied .tex delimiters through the SAME
  // handle + "bundle" write queue the autosaver uses. Bubbled because
  // EditorLayout renders CodeEditor (a sibling of EditorPane inside the
  // DocPipeline) and must hand the pane's save machinery to the bridge's
  // `persistDelimiters` callback.
  saveWithDelimiters: (d: { preamble: string; postamble: string }) => void;
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
   *  timer (see editor-ops.ts handleUpdate). The optional second arg is
   *  TipTap's update-event transaction (used by the autosave to flush on an
   *  anchor-mint tx — see @/lib/anchor-mint-signal). */
  onUpdate?: (editor: Editor, tx?: import("@tiptap/pm/state").Transaction) => void;

  /** Search-bar / link-jump highlight forwarded straight through. */
  highlightText?: string | null;

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
  leftMarginPrelude?: React.ReactNode;

  /**
   * Optional adornment rendered in the in-card chrome header band, at the
   * trailing (right) edge just before the docked MenuBar controls (so it lands
   * immediately to the left of the paragraph back/forward nav). The Library
   * Reader threads its printed-page `PagePicker` here so the page selector sits
   * inline with the nav rather than up in the `PaperHeader` pod. Generic
   * `ReactNode` slot (mirrors `leftMarginPrelude`) — no host-specific code
   * enters the shared layer. `undefined` in the main app → the band renders
   * exactly as before.
   */
  chromeHeaderTrailing?: React.ReactNode;

  /**
   * Bundle of docked-MenuBar shell state. Reader omits — its chrome hides
   * every control these fields drive (no menu bar edit items, no formatting
   * affordances). The main app passes this to render the docked MenuBar.
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
  // Both surfaces now pass the bundle (the Reader via the ephemeral
  // `useReaderViewPrefs()`), so popouts wire automatically in each.
}

// Phase 5d: `memo`-wrapped so that, in the multi-doc keep-alive cascade, a
// warm paper↔paper switch re-renders ONLY the newly-active pane — the inactive
// (hidden) panes bail with the DEFAULT shallow comparison (NOT a custom
// comparator: `() => true` would freeze the active pane). This is sound ONLY
// because Phases 5a–5c made every prop passed to an inactive pane
// identity-stable across a switch (gated `isActive ? real : undefined`, stable
// module constants, ref-cached per-slot callbacks, and the split-out
// `editorPaneViewPrefsInactive` bundle).
const EditorPane = memo(forwardRef<EditorHandle, EditorPaneProps>(function EditorPane(
  {
    docId,
    initialContent,
    editable = true,
    chrome = FULL_CHROME,
    onUpdate,
    highlightText = null,
    onEditorReady,
    onPaneStateChange,
    onDocumentClassMismatch,
    pdfView = false,
    codeView = false,
    onTogglePdfView,
    onToggleCodeView,
    placements,
    viewPrefs,
    leftMarginPrelude,
    chromeHeaderTrailing,
    menuBar,
    aiWindowOpen = false,
    onAiWindowClose,
  },
  ref,
) {
  const innerRef = useRef<EditorHandle>(null);
  useImperativeHandle(ref, () => innerRef.current as EditorHandle);
  const [editor, setEditor] = useState<Editor | null>(null);
  // A plain `RefObject<Editor | null>` kept in sync with the `editor` state,
  // for consumers that take a raw editor ref (not the `EditorHandle`). The
  // shared `LiftHost` reads `.current` to drive the lifted-overlay gesture +
  // its viewport cache. Synced during render (no effect lag) — the assignment
  // is idempotent and `editor` is React state, so every change re-renders.
  const editorInstanceRef = useRef<Editor | null>(null);
  editorInstanceRef.current = editor;
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

  // Debounced doc-change tick for the outline. Structural counters (`rev.*`)
  // miss in-heading TEXT edits (renaming a heading, word-count drift) — those
  // fire no structural bus event. This single `editor.on('update')` subscriber
  // is O(1) per transaction (clear+reset a 300ms timer, then one counter bump),
  // explicitly permitted by the keystroke-sanctity doctrine ("debounced timer
  // reset, counter bump"). It does NO doc-walk on the keystroke path; the walk
  // only happens later, inside the `outlineContent` memo, when this tick (or a
  // structural counter) actually changes.
  const [outlineDocTick, setOutlineDocTick] = useState(0);
  useEffect(() => {
    if (!editor) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => setOutlineDocTick((n) => n + 1), 300);
    };
    editor.on("update", bump);
    return () => {
      if (t) clearTimeout(t);
      editor.off("update", bump);
    };
  }, [editor]);

  // Stable, memoized doc snapshot for the OUTLINE panel only (the single
  // consumer of PaneRailBody's `content` prop — see OutlineHost/OutlinePanel
  // below). Pre-fix this was an inline `editor.getJSON()` evaluated on EVERY
  // EditorPane render: a full O(doc) ProseMirror→JSON serialization returning a
  // fresh object identity each time. EditorPane re-renders on every focus/
  // selection change, so a fresh `content` identity busted `memo(OutlinePanel)`
  // and all three of its O(doc) `useMemo`s (extractHeadings / getDocTitle /
  // buildPerBlockCounts) on every mouse-down — the dominant "walks the whole
  // doc on every interaction" cost.
  //
  // Now the snapshot is recomputed ONLY when the doc actually changes:
  //   - `editor`         → first getJSON immediately on mount (non-blank load;
  //                        the `rev.*` counters start at 0 and never fire on
  //                        load, so the editor dep is what populates initially).
  //   - `rev.headings/blocks/labels` → structural edits the outline depends on.
  //   - `outlineDocTick` → debounced text edits (heading renames, word counts).
  // A focus/selection-only re-render touches none of these deps, so the memo's
  // identity is stable → `memo(OutlinePanel)` short-circuits and re-walks nothing.
  // `editor.getJSON()` references no `rev.*`/tick value, so exhaustive-deps
  // reports these as "unnecessary" — but they ARE the intentional doc-change
  // signals (editor never reassigns in place, so it alone would never refresh).
  // This accepted "unnecessary dependencies" warning matches the `rev.*`-gated
  // sibling memos in this file (citationOrder / footnoteInfos / examples).
  const outlineContent = useMemo<JSONContent | null>(
    () => (editor && !isTier1CDisabled() ? (editor.getJSON() as JSONContent) : null),
    [editor, rev.headings, rev.blocks, rev.labels, outlineDocTick],
  );

  const handleEditorReady = useCallback(
    (ed: Editor) => {
      setEditor(ed);
      onEditorReady?.(ed);
    },
    [onEditorReady],
  );

  // ── Per-doc selection state ──────────────────────────────────────
  // Anchored selection slots are derived from the global cardStore via
  // This pane's per-doc interaction store. Resolved from the registry by docId
  // (idempotent, so it's a stable reference per render in steady state, and a
  // dispose+recreate — dev StrictMode / HMR — re-resolves to the live instance
  // here AND in the shell, so they never diverge). EditorPane's BODY hooks run
  // ABOVE the <CardStoreProvider> this component renders, so they CANNOT read it
  // from context — they get this instance threaded explicitly. The descendants
  // (panels / marginalia / popouts) read the SAME instance via that provider.
  const cardStoreInst = getCardStore(docId);

  // useAnchoredSelectionSlots — same single source of truth as
  // EditorLayout, so the Library reader (which mounts EditorPane
  // standalone) gets identical hover/selection plumbing for free.
  // Threaded `cardStoreInst` because this body call is ABOVE the pane's
  // CardStoreProvider — without it the slot setters would write the context
  // DEFAULT store (cross-doc bleed) while every reader uses the per-doc store.
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
  } = useAnchoredSelectionSlots(cardStoreInst);
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
  // The discard bucket is the owning PANEL id, derived from the card registry
  // (panelForCardKind) — not a hand-kept token. Each polymorphic pair collapses
  // to its shared panel (cutter-* → "cutter", report* → "reports"). Every kind
  // here owns a panel, so the non-null assertion is safe.
  const notePristine = useMemo(() => pristineManager.forKind(panelForCardKind("note")!), [pristineManager]);
  const cutPristine = useMemo(() => pristineManager.forKind(panelForCardKind("cutter-comment")!), [pristineManager]);
  // BUG #54: Revisions was the one card panel never wired into the click-away
  // discard watcher — `useRevisions(docId)` fell back to its in-hook
  // `localPristine` (panel-close only), so a blank revision comment/suggestion
  // created at the cursor lingered on click-away. Give it a manager bucket like
  // every other kind so the unified empty-body contract actually fires.
  const revisionPristine = useMemo(() => pristineManager.forKind(panelForCardKind("revision-comment")!), [pristineManager]);
  const reportPristine = useMemo(() => pristineManager.forKind(panelForCardKind("report")!), [pristineManager]);
  const todoPristine = useMemo(() => pristineManager.forKind(panelForCardKind("todo")!), [pristineManager]);
  const citationPristine = useMemo(() => pristineManager.forKind(panelForCardKind("citation")!), [pristineManager]);
  const footnotePristine = useMemo(() => pristineManager.forKind(panelForCardKind("footnote")!), [pristineManager]);

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
  // Thread the citekey → uid resolver + the live entry list into the bib
  // sidecars so they can re-key on the durable uid under the identity-cascade
  // flag (T1 Stage 1). Flag OFF: the resolver is ignored and they keep the
  // legacy citekey-keyed shape (no behavior change).
  const annotationsHook = useAnnotations(
    docId,
    citationsHook.getBibEntry,
    citationsHook.bibEntries,
  );
  const bibReviewHook = useBibReview(
    docId,
    citationsHook.getBibEntry,
    citationsHook.bibEntries,
  );
  const bibSettingsHook = useBibSettings(docId);

  // Register the editor `\cite{}` doc-rewrite as a migrator on the
  // IdentityCascade (T1 Stage 2, checklist step 9). When a citekey rename fans
  // out, this rewrites every `\cite{oldKey}` atom in the live doc — top-level
  // AND footnote-nested — in one transaction, so the panel patch survives the
  // next `syncFromEditor` re-derive (the deep half of the fix, BIB-F5-03). The
  // editor is re-read via `innerRef` at call time so the migrator stays stable
  // and an HMR remount is sound. Idempotent registration (Set semantics).
  const identityCascade = citationsHook.identityCascade;
  useEffect(() => {
    const unregister = identityCascade.registerMigrator("bibEntry", (change) => {
      if (!isRenameCitekey(change)) return;
      const { oldKey, newKey } = change.renameCitekey;
      if (oldKey === newKey) return;
      const ed = innerRef.current?.getEditor();
      if (!ed) return;
      rewriteCiteKeyInDoc(ed, oldKey, newKey);
    });
    return unregister;
  }, [identityCascade]);

  // Second `bibEntry` migrator (BIB-A2-04): a citekey rename must NOT strand a
  // popped-out bib float or the panel selection. The bib float key is
  // `float:card:bib:<citekey>` and the floatable resolves the entry by citekey,
  // so without a lockstep remap the popped window blanks/dies on rename (and
  // its saved rect orphans in `cardFloatPositions`); likewise `selectedBibKey`
  // (citekey-keyed) loses its target. The cascade is the single writer that
  // owns this re-point: it (1) lockstep-migrates the float key + its rect via
  // `remapCardPopKey` (no-op when the entry isn't floated), and (2) re-points
  // the panel selection if it pointed at the old key. Keyed on the durable uid
  // upstream, so this fires exactly once per real rename. Idempotent (Set).
  useEffect(() => {
    const unregister = identityCascade.registerMigrator("bibEntry", (change) => {
      if (!isRenameCitekey(change)) return;
      const { oldKey, newKey } = change.renameCitekey;
      if (oldKey === newKey) return;
      // Lockstep float-key remap (keys + saved rect move together).
      viewPrefs?.remapCardPopKey(cardPopKey("bib", oldKey), cardPopKey("bib", newKey));
      // Re-point the panel selection so the renamed entry stays selected.
      setSelectedBibKey((prev) => (prev === oldKey ? newKey : prev));
    });
    return unregister;
  }, [identityCascade, viewPrefs]);

  // W1b — the single inline-atom DocStructureBus consumer (D1.2/D1.4). Mounts
  // ONCE per pane behind `virgil:identity-cascade`. Opens exactly one
  // `onAnyChange` subscription and registers T1's `regenIds` policy FIRST: on a
  // markerless re-parse (the diff carries same-tx add+remove of citations/
  // footnotes whose ids regenerated), it routes the `oldId -> newId` remap
  // through the cascade so panel selection / float / pin survive the re-parse
  // (OMNI-F3-02, CI-A3-01, the CI-F1-02 id-survival class). The returned
  // dispatcher is where Wave-2 T2 (inline-atom lifecycle) and T5 (citation
  // add-resync) register their reconcilers — they do NOT open new subscriptions.
  // O(1) bail on any non-atom transaction; never runs on a plain keystroke.
  const identityBusConsumer = useIdentityBusConsumer(editor, identityCascade);

  // W2b — the inline-atom lifecycle reconciler, registered as a POLICY on the
  // single consumer above (NOT a new subscription; the +1-not-+3 invariant). On
  // the bus diff it (a) upserts/clears the durable orphan record so an undone
  // delete can never leave the atom both anchored AND orphan (FN-A1-03), (b)
  // prunes the `cardStore` selection/hover/expand ref of a genuinely-deleted
  // inline atom (the prune-exemption ghost class, FN-A1-01 etc.), and (c) closes
  // (or re-points, for a recoverable orphan) the popped float. It also registers
  // the `inlineAtom`/`regenIds` selection+float re-point migrator on the cascade
  // (OMNI-F3-02, CI-A3-01, CI-F1-02). Behind `virgil:inline-atom-lifecycle`
  // (default OFF); flag-off the hook is inert and the legacy paths are untouched.
  const orphanedFootnotesStore = useOrphanedFootnotes(docId);
  // Bug sweep #3: one-shot set of footnote ids being spliced out by an ARCHIVE
  // action (flag-ON path). The archive handler (spliceAndArchiveAtom) adds an id
  // BEFORE removing the marker; the inline-atom lifecycle policy CONSUMES it on
  // the resulting removal tx and skips the orphan upsert (the archived ref
  // already preserves the body, so an orphan would double-create). A ref so its
  // Set identity is stable across renders.
  const archivedSuppressRef = useRef<Set<string>>(new Set());
  useInlineAtomLifecycle({
    editor,
    store: cardStoreInst,
    consumer: identityBusConsumer,
    cascade: identityCascade,
    orphans: orphanedFootnotesStore,
    // Inline structural counter — the liveness reconcile that closes the
    // orphan-clear undo edge (FN-A1-03) fires when this bumps, never per keystroke.
    atomRevision: rev.footnotes + rev.citations,
    archivedSuppress: archivedSuppressRef.current,
    floats: viewPrefs
      ? {
          poppedOutCards: viewPrefs.prefs.poppedOutCards,
          closeCardPopout: viewPrefs.closeCardPopout,
          remapCardPopKey: viewPrefs.remapCardPopKey,
        }
      : undefined,
  });

  // ── The per-doc orphan store is the SINGLE store on BOTH flag paths ──────
  // The store (`useOrphanedFootnotes(docId)`) lives UNDER the `<DocPipeline>`
  // boundary, keyed on docId, so it can never co-mingle two docs' orphans. The
  // only thing the `virgil:inline-atom-lifecycle` flag governs is WHO writes it:
  //
  //   - flag ON  → the bus reconciler (`useInlineAtomLifecycle`, above);
  //   - flag OFF → the legacy event web, now mounted HERE per-pane and routed
  //     by the event's originating docId (so a teardown in doc A never lands in
  //     doc B's store). This un-bundles the low-risk per-doc store re-home (T2
  //     §9 step 2) from the still-gated reconciler cutover (step 3).
  //
  // Pre-cutover the orphan list was a volatile shell `useState` ABOVE the
  // DocPipeline boundary, threaded down as the `orphanedFootnotes` prop — that
  // is exactly what bled across warm keep-alive panes (FN-A2-03). The prop is
  // gone; the store is internal and per-doc.
  useFootnoteOrphanBridges({ docId, store: orphanedFootnotesStore });
  const effectiveViewPrefs = useMemo(() => {
    if (!viewPrefs) return viewPrefs;
    // The SIDECAR store is the single source for both the list and the
    // edit/delete handlers, regardless of flag. The builder leaves the orphan
    // fields at their stable empty/noop defaults; we override all four here so
    // every downstream `viewPrefs.orphanedFootnotes` / `onEditOrphan` read is
    // the per-doc store. The Reader's store no-ops its writes (no handle).
    return {
      ...viewPrefs,
      orphanedFootnotes: orphanedFootnotesStore.orphans,
      onEditOrphan: orphanedFootnotesStore.editOrphanContent,
      onDeleteOrphan: orphanedFootnotesStore.clearOrphan,
      onEditOrphanTitle: orphanedFootnotesStore.editOrphanTitle,
    };
  }, [viewPrefs, orphanedFootnotesStore]);

  // W2d (T4 D6 seam) — the card-lifecycle reconciler. Consumes the
  // `card-deleted` / `card-morphed` signal `runCardLifecycleEvent` publishes and
  // prunes / re-keys the global `cardStore` for the SIDECAR-backed kinds
  // (report/note/cutter/revision), whose lifecycle the DocStructureBus never
  // sees. Unflagged (correct-by-construction; no bus subscription) — keeps a
  // morphed report's selection halo (REP-F6-02 / OMNI-F6-02) and clears a
  // deleted card's stale halo regardless of the inline-atom-lifecycle flag.
  useCardLifecycleReconciler(cardStoreInst);

  // W2c — the citation add/resync reconciler, registered as a POLICY on the
  // same single consumer (NOT a new subscription; the +1-not-+3 invariant). The
  // mount-only `syncFromEditor` effect below (gated on `[editor]`) misses every
  // out-of-band citation add/remove — a code-view `\cite`, a Backspace over a
  // marker — leaving the sidecar card list stale until reload (C17). This policy
  // re-runs that idempotent reconcile off the bus diff whenever a citation
  // entered/left the doc, so a code-view-added `\cite` shows a card live
  // (CI-F8-03) and a deleted `\cite` prunes its dead card live (CI-A1-01, the
  // sidecar half — W2b owns the cardStore/float half on the same consumer, never
  // double-owning the reconcile). A pure markerless re-parse (survivors T1
  // already re-pointed) is skipped so it doesn't thrash the sidecar write.
  // Behind `virgil:inline-atom-lifecycle` (default OFF); flag-off the hook is
  // inert and the legacy mount-only path is the only reconcile (byte-identical).
  useCitationResync({
    editorReady: !!editor,
    consumer: identityBusConsumer,
    getCitations: () => innerRef.current?.getCitations() ?? [],
    syncFromEditor: citationsHook.syncFromEditor,
  });

  const notesHookRaw = useNotes(docId, notePristine);
  const aiRequestsHook = useAiRequests(docId);
  const cutterHookRaw = useCutter(docId, cutPristine);
  const reportsHookRaw = useReports(docId, reportPristine);
  const revisionsHookRaw = useRevisions(docId, revisionPristine);
  // Lossy-morph confirm (note→highlight, report↔report-request). Distinct
  // dialog instance so it coexists with the other confirm dialogs.
  const { confirm: confirmMorph, dialog: confirmMorphDialog } = useConfirmDialog();
  // ── The A9 morph chokepoint (generalized) ──────────────────────────────
  // EVERY kind-chevron morph — note↔highlight, revision/cutter comment↔
  // suggestion, report↔report-request — fires through `convertCardWithRemap`.
  // It (1) optionally confirms when the morph is `lossy` (drops fields the
  // target shape can't hold), (2) calls the owning panel hook's `convertCard`
  // (which flips the on-disk data kind via the registered morph transform),
  // and (3) in lockstep remaps the card's popout key IF it's currently floated.
  // The stored `float:card:<kind>:<id>` key bakes the kind, and
  // `FloatHost.resolveFloatable` re-derives kind from the key, so without the
  // remap a popped-then-morphed card silently vanishes. `remapCardPopKey`
  // no-ops when the card isn't floated, so this is safe from every trigger
  // (docked dropdown, omni, or the FloatChrome title control). Kind-agnostic:
  // the TO spine kind + lossy flag are read from `CARD_REGISTRY[fromCardKind]
  // .morph` (SSOT), and the per-pair data `toKind` each hook expects is
  // derived from it.
  const convertCardWithRemap = useCallback(
    async (fromCardKind: CardKind, id: string) => {
      const morph = CARD_REGISTRY[fromCardKind].morph;
      if (!morph) return; // non-morphing kind — defensive no-op
      const toCardKind = morph.to;
      // The morph chokepoint now routes through `runCardLifecycleEvent` (T4
      // §3.3): the confirm copy is GENERATED from `morph.drops` (never
      // direction-blind — REP-F6-03), the aiRequest inbox is UNBRIDGED when the
      // morph drops the flag (report-request→report — REP-F5-01), the per-doc
      // hook mutation is the `mutate` step, and a `card-morphed` signal is
      // published (the D6 seam W2b consumes to re-key cardStore — REP-F6-02).
      const committed = await runCardLifecycleEvent(
        { type: "morph", fromKind: fromCardKind, id },
        {
          confirm: confirmMorph,
          unbridgeAiRequest: (kind, cardId) =>
            bridgeCardAiRequestFlag(docId, kind, cardId, false, {
              // value=false drops the existing entry by {panel, cardId}; the
              // ctx fields are only read on the add path, so a placeholder is fine.
              text: "",
            }),
          mutate: () => {
            // Dispatch to the owning panel hook with its expected data toKind.
            switch (fromCardKind) {
              case "revision-comment":
                revisionsHookRaw.convertCard(id, "suggestion");
                break;
              case "revision-suggestion":
                revisionsHookRaw.convertCard(id, "comment");
                break;
              case "cutter-comment":
                cutterHookRaw.convertCard(id, "suggestion");
                break;
              case "cutter-suggestion":
                cutterHookRaw.convertCard(id, "comment");
                break;
              case "report":
                reportsHookRaw.convertCard(id, "report-request");
                break;
              case "report-request":
                reportsHookRaw.convertCard(id, "report");
                break;
              case "note":
                notesHookRaw.convertCard(id, "highlight");
                break;
              case "highlight":
                notesHookRaw.convertCard(id, "note");
                break;
            }
          },
        },
      );
      if (!committed) return;
      viewPrefs?.remapCardPopKey(cardPopKey(fromCardKind, id), cardPopKey(toCardKind, id));
    },
    [revisionsHookRaw, cutterHookRaw, reportsHookRaw, notesHookRaw, viewPrefs, confirmMorph, docId],
  );
  // Per-pair adapters that take each card's legacy `(id, dataToKind)` signature,
  // resolve the FROM spine kind, and delegate to the generalized chokepoint —
  // so all 4 pairs morph identically (float survival + lossy confirm + remap).
  const convertRevisionCard = useCallback(
    (id: string, toKind: "comment" | "suggestion") => {
      void convertCardWithRemap(
        toKind === "suggestion" ? "revision-comment" : "revision-suggestion",
        id,
      );
    },
    [convertCardWithRemap],
  );
  const convertCutterCard = useCallback(
    (id: string, toKind: "comment" | "suggestion") => {
      void convertCardWithRemap(
        toKind === "suggestion" ? "cutter-comment" : "cutter-suggestion",
        id,
      );
    },
    [convertCardWithRemap],
  );
  const convertReportCard = useCallback(
    (id: string, toKind: "report" | "report-request") => {
      void convertCardWithRemap(
        toKind === "report-request" ? "report" : "report-request",
        id,
      );
    },
    [convertCardWithRemap],
  );
  const convertNotesCard = useCallback(
    (id: string, toKind: "note" | "highlight") => {
      void convertCardWithRemap(toKind === "highlight" ? "note" : "highlight", id);
    },
    [convertCardWithRemap],
  );
  // Each panel hook threaded to its consumers (cardCtx, PaneRail/PaneRailBody,
  // omni-host) with `convertCard` swapped for the popout-key-remapping adapter —
  // one chokepoint per pair, so the morph survives regardless of which surface
  // triggers it (docked dropdown, omni, or FloatChrome title control).
  const revisionsHook = useMemo(
    () => ({ ...revisionsHookRaw, convertCard: convertRevisionCard }),
    [revisionsHookRaw, convertRevisionCard],
  );
  const cutterHook = useMemo(
    () => ({ ...cutterHookRaw, convertCard: convertCutterCard }),
    [cutterHookRaw, convertCutterCard],
  );

  // ── Phase 2 — auto-apply driver for AI-pending changes (flag-ON) ──────────
  // Auto-applies an AI-authored, still-pending suggestion the moment it is safe
  // (caret not in the target paragraph; no other applied change there yet) via
  // the SAME shared `applySuggestion` the manual Apply button uses. Keystroke-
  // safe: the batch effect gates only on `[editor, structural counters, card
  // arrays]` (silent on plain typing), and the selection-leave path piggybacks
  // on `useEditorUIState`'s existing `selectionUpdate` subscriber via the
  // returned `onCaretParagraphChange` notifier (no new always-on subscriber).
  // Flag-OFF: inert (no card ever reaches the statuses it reads). `rev` is the
  // `useStructuralRevisions` snapshot; `editor` the reactive instance.
  const { onCaretParagraphChange: onAutoApplyCaretLeave } =
    useAutoApplyPendingChanges({
      editor,
      structural: rev,
      revisions: {
        cards: revisionsHook.cards,
        setSuggestionStatus: revisionsHook.setSuggestionStatus,
        setAppliedChange: revisionsHook.setAppliedChange,
      },
      cutter: {
        cards: cutterHook.cards,
        setSuggestionStatus: cutterHook.setSuggestionStatus,
        setAppliedChange: cutterHook.setAppliedChange,
      },
    });
  // Wrap the reports `deleteCard` so a DELETE of an aiRequest-bearing
  // report-request discharges the same cross-store obligation a morph does:
  // UNBRIDGE the pending ai-requests.json entry (REP-F7-02, the symmetric
  // delete leak) + publish the D6 card-deleted signal — through the SAME
  // executor contract, so the delete and the morph can't diverge. The
  // content-confirm already happened upstream (EditableCard / deleteMarginItem),
  // so the executor runs with `hasContent: false` (no double-confirm). A plain
  // `report` (no routing) deletes straight through.
  const deleteReportCard = useCallback(
    (id: string) => {
      const card = reportsHookRaw.cards.find((c) => c.id === id);
      const kind: CardKind = card?.kind === "report-request" ? "report-request" : "report";
      void runCardLifecycleEvent(
        { type: "delete", kind, id, hasContent: false },
        {
          confirm: async () => true, // upstream already confirmed
          unbridgeAiRequest: (k, cid) =>
            bridgeCardAiRequestFlag(docId, k, cid, false, { text: "" }),
          mutate: () => reportsHookRaw.deleteCard(id),
        },
      );
    },
    [reportsHookRaw, docId],
  );
  const reportsHook = useMemo(
    () => ({
      ...reportsHookRaw,
      convertCard: convertReportCard,
      deleteCard: deleteReportCard,
    }),
    [reportsHookRaw, convertReportCard, deleteReportCard],
  );
  const notesHook = useMemo(
    () => ({ ...notesHookRaw, convertCard: convertNotesCard }),
    [notesHookRaw, convertNotesCard],
  );
  const todosHook = useTodos(docId, todoPristine);
  // BUG #55b (part b): subsume any pre-existing UNLINKED note/todo AI request
  // into a real card with the per-card `aiRequest` flag (re-bridged via
  // `linkedTo`), so retiring the legacy `"ai"` CardKind / `AiRequestCard`
  // doesn't strand them. One-time + idempotent (see the hook). Runs here in
  // EditorPane — the authoritative mount whose hooks feed the panels + AIWindow.
  useAiRequestCardMigration({
    docId,
    ready: notesHookRaw.loaded && todosHook.loaded && aiRequestsHook.loaded,
    aiRequests: aiRequestsHook.requests,
    appendNotes: notesHookRaw.appendCards,
    appendTodos: todosHook.appendItems,
    relinkRequests: aiRequestsHook.relinkRequests,
  });
  const archiveHook = useArchive(docId);
  // #55b: resolve a footnote's anchoring paragraph(s) from the LIVE doc, so the
  // bridged AI-request carries `paragraphIds` and is actually drainable (the
  // skill halts on empty paragraphIds). A footnote's anchor isn't in the
  // sidecar — it's the position of its `\footnote` atom — so we read it from
  // the editor here (where the ref is in scope) and hand it to useFootnotes,
  // the analogue of note/highlight threading `getLinkedTextObjectIds(card)`.
  // Stable (reads `innerRef.current` at call time), runs only on a toggle, never
  // per keystroke.
  const resolveFootnoteAnchor = useCallback(
    (footnoteId: string): { paragraphIds?: string[]; selectedText?: string } => {
      const ed = innerRef.current?.getEditor();
      const fn = innerRef.current
        ?.getFootnotes()
        .find((f) => f.footnoteId === footnoteId);
      if (!ed || !fn || typeof fn.pos !== "number") return {};
      const pid = paragraphUuidAt(ed.state.doc, fn.pos);
      if (!pid) return {};
      return {
        paragraphIds: [pid],
        selectedText: captureParagraphSnapshot(ed, pid) || undefined,
      };
    },
    [],
  );
  const footnotesHook = useFootnotes(docId, footnotePristine, resolveFootnoteAnchor);
  const suggestionsHook = useSuggestions(docId);
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
  // The `virgil-stack-drop` handler lives below, right after `popoutsDeps`
  // is declared — its CARD branch resolves the dropped float's
  // `Floatable.snapshotForStack` via `CARD_REGISTRY[kind].toFloatable(id,
  // popoutsDeps)`, so it must be declared after that memo (no TDZ on the dep).

  // ── Document load + compile state ─────────────────────────────────
  // `useDocument` reads its docId+pipeline from the surrounding
  // `<DocPipeline>` ancestor (mandatory — it throws otherwise). The
  // ancestor's `key={docId}` forces a full remount on doc switch, so
  // every closure here closes over a single doc's worth of state. Its
  // `content` is used as the editor seed only when `initialContent`
  // isn't supplied; the Reader supplies its own (UUID-tagged +
  // sidecar-aware parse) so that path stays unchanged.
  const docHook = useDocument();

  // Keep-alive inertness (multi-doc): a warm/hidden pane must not arm its
  // background autosave. The pane stays mounted while hidden (display:none), so
  // we gate the canonical `docHook.onUpdate` writeback on visibility — read via
  // a REF because VirgilEditor captures its `onUpdate` closure at editor
  // creation and a warm pane is NOT remounted on a switch, so a render-value
  // capture would freeze the gate at its mount-time value. Defense-in-depth:
  // hidden editors receive no transactions today, but this makes a cross-doc
  // background-write structurally impossible even if that invariant is ever
  // broken (the active-doc props — onUpdate, editable — are already inert for
  // warm panes; this closes the one unconditional path, docHook.onUpdate).
  const isVisible = useIsVisible();
  const isVisibleRef = useRef(isVisible);
  isVisibleRef.current = isVisible;

  // ── Per-doc editor UI state (last-edited paragraph + section folds) ──
  // Captures cursor paragraph (debounced) and fold state (immediate) to
  // `editor-state.json`. The restore effect below waits for the editor,
  // the doc content, AND the sidecar load — the sidecar is async and
  // can resolve after the editor mounts, so depending on `loaded` is
  // mandatory to avoid restoring the pre-load default.
  // The 3rd arg is the auto-apply driver's selection-leave notifier (Phase 2):
  // it rides this hook's existing `selectionUpdate` subscriber, so no new
  // always-on editor subscriber is added (keystroke sanctity). Stable identity
  // (a `useCallback` in the driver), so it never re-subscribes.
  const uiStateHook = useEditorUIState(docId, editor, onAutoApplyCaretLeave);
  const uiRestoredRef = useRef(false);
  const scrollRestoredRef = useRef(false); // Phase D: once-per-mount scroll restore
  const cancelScrollRestoreRef = useRef<(() => void) | null>(null);
  // Last scroll offset captured WHILE VISIBLE. A hidden (display:none) container
  // reports scrollTop 0, so we must never read it while hidden — this ref is the
  // trustworthy value to re-assert on a warm re-show (and to persist).
  const liveScrollRef = useRef<number | null>(null);
  const wasVisibleRef = useRef(true);
  // NOTE: the former `editorMountArmed` one-tick mount-deferral that used to live
  // here is GONE. It existed only to isolate the editor's create+`init()` into a
  // clean commit so TipTap's `ReactRenderer` wouldn't take its illegal
  // `flushSync(...)`-in-commit branch while building figure/graphics/tex-block/
  // figureCaption React NodeViews. That whole flushSync-in-commit class is now
  // killed at the source — `patches/@tiptap+react+3.20.5.patch` routes the
  // ReactRenderer's initialized case through the same `queueMicrotask` path every
  // NodeView already uses on initial load — so the gate is dead weight (it also
  // never covered the warm StrictMode-reappear re-show). Mount the editor
  // immediately; no extra frame.
  useEffect(() => {
    if (uiRestoredRef.current) return;
    if (!editor || !docHook.content || !uiStateHook.loaded) return;
    const ui = uiStateHook.stateRef.current;
    uiRestoredRef.current = true;
    if (ui.foldedSections.length > 0) {
      innerRef.current?.setFolded(ui.foldedSections);
    }
    if (ui.lastParagraphId) {
      // Scroll-restoration ownership: when a saved scroll offset will be
      // restored (cold mount, below), the cursor restore must NOT scroll the
      // paragraph into view — its deferred focus-scroll would beat the offset
      // restore and land the doc on the cursor paragraph instead of where the
      // user was last looking. Restore the selection only; the scroll-restore
      // effect owns the viewport. With no saved scroll, fall back to the
      // classic scroll-cursor-into-view behavior.
      const hasSavedScroll = (ui.scrollTop ?? 0) > 0;
      innerRef.current?.restoreCursorToParagraph(ui.lastParagraphId, {
        scrollIntoView: !hasSavedScroll,
      });
    }
  }, [editor, docHook.content, uiStateHook.loaded, uiStateHook.stateRef]);

  const docContentReady = docHook.content != null;
  useEffect(() => {
    if (!docContentReady || !editor) return;
    setReady(true);
  }, [docContentReady, editor]);

  // Mode-A self-healing anchor reconcile (load-only, once per doc-open).
  //
  // A Mode-A margin card anchors via a bare paragraph UUID that survives a
  // reload only if that paragraph's `%!v:` UUID round-tripped through the
  // `.tex`. When the 1500 ms autosave loses the race to a reload, the
  // paragraph is re-minted a fresh UUID and the card silently orphans
  // (gone from the margin, yet `isUnanchored` still reports anchored).
  //
  // This pass repairs that, symmetric with Mode B's `reanchorByText`:
  // UUID-first (if the stored UUID still resolves, backfill the snapshot so
  // legacy links become durable going forward), snapshot-fallback (if the
  // UUID is dead but the captured paragraph text matches a live block,
  // rebind `textObjectIds[0]` to the live UUID and persist). Run here in
  // EditorPane — these hook instances own the rendered margin markers, so
  // a rebind takes effect this session AND lands on disk. Idempotent; the
  // per-doc guard fires once `editor` + the doc content are ready AND every
  // card sidecar has finished its initial read. NOT on the keystroke path
  // — the doc walk runs exactly once per open.
  //
  // The `*.loaded` gate is load-correctness, not cosmetics: the sidecar
  // reads are async and can resolve AFTER the editor mounts. Firing the
  // reconcile before they land would run it over the empty pre-load card
  // arrays — a no-op — and then the per-doc `docId` guard would latch and
  // NEVER re-run, silently skipping the heal on exactly the FSA doc-opens
  // this fix targets. We require all six `loaded` flags so the pass sees
  // real on-disk cards, and we latch the guard ONLY once it actually fires
  // on loaded data. The guard is keyed on `docId`, so a doc switch resets
  // it (a new docId ≠ the latched value) and the new doc reconciles.
  const modeAReconciledDocRef = useRef<string | null>(null);
  const allCardSidecarsLoaded =
    notesHookRaw.loaded &&
    todosHook.loaded &&
    cutterHookRaw.loaded &&
    revisionsHookRaw.loaded &&
    reportsHookRaw.loaded &&
    archiveHook.loaded;
  // True if ANY card sidecar's initial read THREW (corrupt/truncated JSON or a
  // transient FSA error). Such a kind loaded as the EMPTY default, so its
  // collection is NOT authoritative — an empty array does not mean "no cards of
  // this kind own an anchor", it means "we don't know". The destructive orphan
  // reaper infers anchor ownership from these collections, so it MUST stand
  // down when any of them failed to load; otherwise a single bad sidecar read
  // would strip every live `\vlid` mark of that kind and autosave the loss.
  const anyCardSidecarLoadError =
    notesHookRaw.loadError ||
    todosHook.loadError ||
    cutterHookRaw.loadError ||
    revisionsHookRaw.loadError ||
    reportsHookRaw.loadError ||
    archiveHook.loadError;
  useEffect(() => {
    if (!editor || !docContentReady || !allCardSidecarsLoaded) return;
    if (modeAReconciledDocRef.current === docId) return;
    modeAReconciledDocRef.current = docId;
    // RC-B: re-stamp every surviving Mode-B card's `linkedAnchor` mark from
    // its persisted snapshot FIRST (this is the single load-time recovery
    // writer that retired `EditorLayout.applyLinkedAnchors`). Re-applying
    // before the per-panel reconcile makes the marks live in the doc, so the
    // resolver's live-mark rung keeps healthy un-re-anchored Mode-B cards as
    // Mode-B (the reconcile won't strip their textRange). See
    // `reapplyModeBAnchors`'s block comment for the ordering rationale and the
    // re-anchored-hybrid exclusion.
    const handle = innerRef.current;
    if (handle) {
      reapplyModeBAnchors((records) => handle.applyLinkedAnchors(records), {
        notes: notesHookRaw.notes,
        todoItems: todosHook.items,
        comments: revisionsHookRaw.cards,
        cutterCards: cutterHookRaw.cards,
        reports: reportsHookRaw.cards,
        highlights: notesHookRaw.highlights,
      });
    }
    // Pending-AI-changes: re-stamp the light-blue `pending-ai-change` mark for
    // every applied-but-not-yet-kept revision/cutter suggestion from its
    // `appliedChange` descriptor — the serializer strips it on `.tex` export, so
    // it must be reconstructed on load (the blue stays until the user Keeps /
    // Reverts). Same SAME load phase as the Mode-B reapply, runs BEFORE the
    // orphan reaper (whose alive-set is extended with these anchorIds below).
    // Self-gated on `isPendingChangesOn()` — flag-OFF stamps nothing.
    // Family-tagged groups so the re-stamp carries the right `linkCard` token
    // (`revision-suggestion:` vs `cutter-suggestion:`) — the family is NOT
    // recoverable from the shared `pending-ai-change` kind (Phase 4, Part A).
    reapplyPendingMarks(editor, [
      {
        family: "revision-suggestion",
        cards: revisionsHookRaw.cards as ReadonlyArray<PendingMarkCardLike>,
      },
      {
        family: "cutter-suggestion",
        cards: cutterHookRaw.cards as ReadonlyArray<PendingMarkCardLike>,
      },
    ]);
    notesHookRaw.reconcileAnchors(editor);
    todosHook.reconcileAnchors(editor);
    cutterHookRaw.reconcileAnchors(editor);
    revisionsHookRaw.reconcileAnchors(editor);
    reportsHookRaw.reconcileAnchors(editor);
    archiveHook.reconcileAnchors(editor);
    // LAST, once: reap any in-doc `linkedAnchor` mark with no live owning card
    // (e.g. a parser-resurrected orphan `\vlid` whose card was deleted before
    // this reload). Build the alive-set from the now-reconciled collections —
    // the SAME six the `useLinkedAnchorReconciler` hook tracks — so a mark we
    // just re-applied/reconciled above is alive and is NOT reaped.
    const aliveIds = new Set<string>();
    for (const cards of [
      notesHookRaw.notes,
      notesHookRaw.highlights,
      cutterHookRaw.cards,
      revisionsHookRaw.cards,
      reportsHookRaw.cards,
      todosHook.items,
    ]) {
      for (const c of cards) {
        const ta = getTextAnchor(c);
        if (ta) aliveIds.add(ta.anchorId);
      }
    }
    // Pending-AI-change marks live at `appliedChange.anchorId`, which is NOT a
    // card text-anchor (`getTextAnchor`) — so add them to the alive-set or the
    // reaper would strip the mark we just re-stamped above. Flag-OFF → empty set.
    for (const id of pendingMarkAnchorIds([
      ...(revisionsHookRaw.cards as ReadonlyArray<PendingMarkCardLike>),
      ...(cutterHookRaw.cards as ReadonlyArray<PendingMarkCardLike>),
    ])) {
      aliveIds.add(id);
    }
    // DESTRUCTIVE: only reap when every sidecar loaded SUCCESSFULLY. If any
    // read threw, that kind's collection is the empty default (non-authoritative
    // — see `anyCardSidecarLoadError`), so `aliveIds` is missing its live
    // anchors and reaping now would strip them and persist the loss. Stand down
    // on a load error; the constructive re-apply/reconcile above already ran
    // (they only ADD/correct marks, so partial data is safe). A future clean
    // reload re-runs this whole pass once the read succeeds.
    if (!anyCardSidecarLoadError) {
      reapOrphanLinkedAnchors(editor, aliveIds);
    }
  }, [
    editor,
    docContentReady,
    allCardSidecarsLoaded,
    anyCardSidecarLoadError,
    docId,
    notesHookRaw.reconcileAnchors,
    todosHook.reconcileAnchors,
    cutterHookRaw.reconcileAnchors,
    revisionsHookRaw.reconcileAnchors,
    reportsHookRaw.reconcileAnchors,
    archiveHook.reconcileAnchors,
    // The Mode-B re-apply reads these live arrays once, at the single
    // latched firing. The `modeAReconciledDocRef` guard makes any re-fire a
    // no-op, so listing them is for exhaustive-deps correctness only — it
    // never causes the pass to run more than once per doc-open.
    notesHookRaw.notes,
    notesHookRaw.highlights,
    todosHook.items,
    revisionsHookRaw.cards,
    cutterHookRaw.cards,
    reportsHookRaw.cards,
  ]);

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

  // ── Diagnostics (P5 item 4) — EditorPane is the single per-doc owner. ──────
  // `sourceText` serializes the LIVE TipTap doc (independent of the code view),
  // so lint / snippets / jump-anchors populate even when the code pane is never
  // opened — the fix for "diagnostics empty until code view is opened once".
  const { sourceText, setSourceText } = useLatexSource({
    editor,
    docId,
    codeViewActive: codeView,
    // Thread the authoritative bib family so `sourceText`'s preamble matches the
    // compiler's / code-pane's bibFamily-aware serialization (line-number parity
    // when the family injects a \usepackage). A getter, read at serialize time.
    getBibFamily: () => asBibFamily(citationsHook.bibPackage),
  });
  const knownBibKeys = useMemo(
    () => citationsHook.bibEntries.map((e) => e.key),
    [citationsHook.bibEntries],
  );
  // The whole bundle is retained (`diagnostics`) so it can be provided ONCE via
  // `DiagnosticsProvider` to the rail sub-components (see `useDiagnosticsContext`),
  // instead of hand-threading its ~11 members through every rail call site. The
  // destructured members below feed EditorPane's own local consumers — the error
  // marker/marginalia memos, the `errorHighlightRange` overlay, and the upward
  // `paneState` bubble to the shell's code-view Errors sidebar.
  const diagnostics = useDiagnostics({
    editor,
    editorHandleRef: innerRef,
    sourceText,
    compileErrors: compileHook.compileErrors,
    knownBibKeys,
  });
  const {
    allLatexErrors,
    selectedErrorId,
    setSelectedErrorId,
    dismissedErrorIds,
    dismissError,
    expandedErrorIds,
    expandError,
    toggleErrorExpanded,
    errorSnippets,
    paragraphByErrorId,
    errorHighlightRange,
    jumpToErrorVisual,
  } = diagnostics;

  // Cold-start PDF seed (P6). EditorPane is the SOLE PDF-state owner + viewer
  // feeder: the viewer renders the bubbled `pdfBlobUrl`. When PDF view is
  // entered for a doc that hasn't compiled THIS session (no in-memory bytes),
  // lazily read the last-persisted PDF from disk ONCE and promote it into the
  // same `latestPdfBytes`/`pdfBlobUrl` state — so there's still exactly one
  // authoritative state, just seeded from disk instead of compile. Guarded on
  // docId so a doc switch mid-await can't flash a stale doc's PDF into the new
  // viewer. (KeepAliveSlot hides the pane via display:none, never unmounting,
  // so in-memory bytes survive the view toggle — no re-read after a compile.)
  useEffect(() => {
    if (!pdfView || !docId) return;
    if (latestPdfBytes.current) return; // already seeded (compile or prior read)
    let cancelled = false;
    const seededDocId = docId;
    void (async () => {
      try {
        const bytes = await readPdf(seededDocId);
        // Bail if the doc changed or a compile landed bytes while we awaited.
        if (cancelled || seededDocId !== docId || latestPdfBytes.current) return;
        if (!bytes) return;
        latestPdfBytes.current = bytes;
        const blob = new Blob([bytes.buffer as ArrayBuffer], {
          type: "application/pdf",
        });
        setPdfBlobUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });
      } catch {
        // Cold-start disk read is best-effort — a missing/unreadable PDF just
        // leaves the "No compiled PDF" empty state.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfView, docId]);

  // Word counts — surfaces in the WordCount panel below. Cheap to
  // compute even when the panel isn't open.
  const wordCountHook = useWordCount(editor);

  // Citation creation handlers — `handleCitationCreated` lands as
  // `onCitationCreated` in the `CitationDisplayContext` so panel
  // mini-editors (notes, footnotes) can register fresh `\cite{}` drops
  // and get back the display text for their Citation node.
  // `handleCitationCreated` lands in the CitationDisplayContext (panel
  // mini-editors); `handleCitationDrop` is the main editor's counterpart —
  // wired into the live `<Editor onCitationDrop>` below so dragging an
  // unanchored citation card into the body anchors it (CI-A2-01). Before
  // this the gate at Editor.tsx existed but no host ever threaded the prop,
  // so the drop was a silent no-op.
  const { handleCitationCreated, handleCitationDrop } = useCitationActions({
    editorRef: innerRef,
    getCitationDisplayText: citationsHook.getDisplayText,
    addCitation: citationsHook.addCitation,
  });

  // labelRef sibling of `getCitationDisplayText`: resolve a footnote/note-nested
  // `\ref`'s display number against the MAIN doc (where the referenced
  // heading/example/figure lives — a card body owns none). Lands in the
  // CitationDisplayContext so RichTextField's load-time `refreshRefDisplay` can
  // turn a reloaded ref's empty displayText into its number instead of "??".
  // Reuses `resolveLabelDisplay` — the SAME resolver the create flow
  // (`handleInsertRef`) uses — so create-time and load-time agree. Returns null
  // when the main editor isn't mounted yet (caller keeps the existing display).
  const getRefDisplayText = useCallback(
    (label: string, refCommand: string): string | null => {
      const mainDoc = innerRef.current?.getEditor()?.state.doc;
      if (!mainDoc) return null;
      const cmd = (refCommand === "getref" || refCommand === "getfullref"
        ? refCommand
        : "ref") as "ref" | "getref" | "getfullref";
      return resolveLabelDisplay(mainDoc, label, cmd).display;
    },
    [],
  );

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
  // notes). Takes the canonical `CardKind` (`"note" | "cutter-comment" |
  // "revision-comment" | …`) and builds the float key directly via
  // `cardPopKey` — the same chokepoint the card itself stamps. Reader
  // (no `viewPrefs`) leaves popouts as a no-op.
  const popCardAtAnchor = useCallback(
    (kind: CardKind, cardId: string, anchorRect: DOMRect | null) => {
      if (!viewPrefs) return;
      // `float:card:<kind>:<id>` — matches the card's own `cardKey`.
      const key = cardPopKey(kind, cardId);
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
  // both the main app (persisted `useViewPrefs`) and the Library Reader
  // (`useReaderViewPrefs`, the same engine in ephemeral mode) supply the
  // same shape. Consumers (panel cards, SelectionDragHandle,
  // paragraph/heading/example floats) read this via `usePoppedCards()` and
  // tolerate a `null` value if no `viewPrefs` is supplied.
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
      // Notes convert a surviving Mode-B link → clean Mode-A on re-anchor
      // (RC1). Highlights deliberately omit this (intrinsically Mode-B).
      clearModeB: notesHook.clearTextAnchorById,
    }),
    [notesHook.notes, notesHook.addNoteTextObjectId, notesHook.removeNoteTextObjectId, notesHook.preserveModeBAnchor, notesHook.clearTextAnchorById],
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
  // Read accessor for the citation drop spec's "anchor the unanchored" create
  // branch (the F downstream gap, now wired). `commandFor` returns the card's
  // serialized `\cite{…}` (or null for an empty/keyless draft); the spec reads
  // it to build the fresh inline atom. `commandFor` is already a stable
  // callback (it reads `stateRef`), so this memo never churns.
  const dropCitationsApi = useMemo(
    () => ({ commandFor: citationsHook.commandFor }),
    [citationsHook.commandFor],
  );

  // The margin-pin re-anchor gesture no longer dispatches a
  // `virgil-marginalia-reanchor` CustomEvent into a per-pane mutator bridge —
  // grabbing a pin now starts a unified drop-mode session (Marginalia's
  // MarkerButton → `beginCardDropGesture`), and the controller commit calls
  // each kind's registered `dropSpec.applyDrop` via the `ParagraphAnchorApi`
  // sub-bags wired into `DropModeProvider` below (the same `links.ts`
  // add/removeTextObjectLink the panel mutates). So the old `anchor-rebind`
  // bridge is gone.

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
        if (paragraphId) {
          // FOLD A: capture the live paragraph snapshot at CREATION so the
          // fresh Mode-A link is self-healing immediately (symmetric with
          // the drop/pin re-anchor), not only after a later clean load.
          const ed = innerRef.current?.getEditor();
          const snapshot = captureParagraphSnapshot(ed, paragraphId);
          todosHook.addParagraphId(t.id, paragraphId, "paragraph", snapshot);
        }
        return t;
      },
      addArchive: (paragraphId, seed) => {
        const s = archiveHook.archiveContent(seed.content ?? "");
        if (seed.title) archiveHook.updateSnippetTitle(s.id, seed.title);
        if (paragraphId) {
          const ed = innerRef.current?.getEditor();
          const snapshot = captureParagraphSnapshot(ed, paragraphId);
          archiveHook.addParagraphId(s.id, paragraphId, "paragraph", snapshot);
        }
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
  // Fallback `ViewPrefs` snapshot for the (now theoretical) case where
  // NO `viewPrefs` bundle is supplied at all. Both real surfaces pass one
  // — the main app's persisted `useViewPrefs()` and the Reader's ephemeral
  // `useReaderViewPrefs()` — so this is just a crash-guard default.
  // `useCardCreation` reads only `prefs.placements` + the
  // docked-stack/collapsed sentinels; with an empty placements array,
  // `ensurePanelActive` defaults to "right" for every panel id and the
  // no-op setters keep things quiet.
  const readerPrefs = useMemo<ViewPrefs>(
    () =>
      ({
        placements: [],
        dockStack: { left: [], right: [] },
        panelHeights: {},
        panelMRU: { left: [], right: [] },
        collapsedLeft: false,
        collapsedRight: false,
        blankLeft: false,
        blankRight: false,
        panelWidths: {},
        editorSplit: false,
        editorSplitRatio: 0.5,
        poppedOutPanels: [],
        poppedOutOrigins: {},
        floatPositions: {},
        panelModes: {},
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

  // Error state (selection / dismissals / expansion / snippets /
  // paragraph mapping / jump) is OWNED locally by `useDiagnostics` (P5 item 4)
  // — the single owner across all four error surfaces — and reaches the rail
  // sub-components through `DiagnosticsProvider` (destructured above as
  // `diagnostics`). `useDiagnostics` owns expansion + dismissal pruning too, so
  // the local `pruneExpanded` effect that used to live here is gone.
  // `compileHook` still drives the PDF and its `compileErrors` merge into the
  // owned surface inside `useDiagnostics`; the shell reads the result via the
  // upward `paneState` bubble (B1).

  // ── Confirm-dialog instance backing the shared `deleteMarginItem` ──
  // Surfaces the "This item has text. Delete it?" warning when the user
  // deletes the last anchor on a non-empty card via the margin marker.
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

  // ── Margin marker click (R15) ────────────────────────────────────
  // One handler for every card-backed marker kind. Uniform toggle: a click
  // on the already-selected marker DESELECTS (and skips the open/pin
  // dispatch); otherwise select (selection axis only — N1: never expands)
  // and dispatch into the SAME live `virgil-linked-anchor-click` bridge the
  // in-text anchor clicks ride (EditorLayout routes it through `openForCard`
  // omni-first + pins the card at the click Y — no document jump). The
  // select happens locally FIRST so the halo is synchronous with the click;
  // the dispatch is then handled by the window-level bridge, which
  // EditorLayout mounts unconditionally (the Library Reader renders inside
  // EditorLayout too, so reader clicks ride the same bridge). Stable callback:
  // reads the cardStore at click time, so the marker memo below doesn't
  // depend on selection state (a selection change re-renders no markers).
  const handleMarginMarkerClick = useCallback(
    (ref: AnchoredCardRef, clickY?: number, anchorIndex?: number) => {
      if (cardStoreInst.isSelected(ref)) {
        // Toggle-off: second click deselects across ALL marker kinds.
        cardStoreInst.clearSelection();
        return;
      }
      // Suppress the selection-driven placement scroll — alignment happens
      // by pulling the card to the click (alignOmniCardWithClick), never by
      // scrolling the document row.
      suppressNextPlacement();
      cardStoreInst.select(ref);
      // T5 Pillar E-2 (REP-F3-01 / OMNI-F3-01 / OMNI-F8-02): a multi-anchor
      // card draws ONE margin marker per anchored paragraph, and the omni
      // surface draws one row per anchor keyed `…@<anchorIndex>`. Stamp the
      // clicked marker's anchor index so the bridge can pin/jump to the RIGHT
      // `@N` row instead of always the first. `undefined` for single-anchor
      // cards (their omni row has no `@N` suffix — see each panel's omni
      // builder, which only suffixes when `pids.length > 1`).
      window.dispatchEvent(
        new CustomEvent("virgil-linked-anchor-click", {
          detail: { entityId: ref.id, kind: ref.kind, clickY, anchorIndex },
        }),
      );
    },
    [cardStoreInst],
  );

  // Ref mirror so the error marker's toggle reads the live selection without
  // putting `selectedErrorId` back into the marker memo's deps (errors aren't
  // cardStore-backed, so they can't use `cardStore.isSelected`). Selection now
  // lives HERE (`useDiagnostics`); the ref tracks its latest value each render.
  const selectedErrorIdRef = useRef(selectedErrorId);
  selectedErrorIdRef.current = selectedErrorId;
  const handleErrorMarkerClick = useCallback(
    (errorId: string, clickY?: number) => {
      const next = selectedErrorIdRef.current === errorId ? null : errorId;
      // Selection is owned locally (`useDiagnostics`) and bubbled up via
      // paneState. We still dispatch the window-level event: the shell's bridge
      // (event-bridges/marker-clicks.ts) does the panel-open side-effect and
      // routes the new selection back to the bubbled `paneState.setSelectedErrorId`
      // (which is this pane's own setter). EditorLayout also syncs the vbar
      // popover and opens the errors panel on its docked side. The bridge is
      // window-level and mounted unconditionally by EditorLayout (the Reader
      // renders inside it too); in the Reader this event is currently
      // unreachable — compileErrors is never populated there.
      window.dispatchEvent(
        new CustomEvent("virgil-error-marker-click", {
          detail: { errorId, selected: next != null, clickY },
        }),
      );
    },
    [],
  );

  // ── Marginalia markers — THE live margin-marker builder ───────────
  // Walks every card hook (notes, reports, archive, todos, cutter,
  // revisions) plus the live latex-error list and emits one
  // `MarginaliaMarker` per linked paragraph. Marker clicks route through
  // `handleMarginMarkerClick` above (the shared live bridge — R15);
  // selection state is NOT a dep (markers self-subscribe to the cardStore
  // for their halo, and the click handlers read it at click time), so a
  // selection change recomputes nothing here.
  //
  // SEAM B-3 (invariant): live positions come from two complementary
  // derivation paths, split by anchor style.
  //  - PARAGRAPH-anchored kinds (note / archive / revision / cut / todo /
  //    report / error) emit margin markers HERE, keyed by textObjectId;
  //    the grid (`computeMarkerPositions`) resolves pixels from the
  //    marginalia registry's per-UUID metrics.
  //  - ENTITY-anchored kinds (footnote / citation / example — in-text
  //    atoms/blocks, `markerType: null` in CARD_REGISTRY) have NO row
  //    here; their live in-text positions come from the omni `resolvePos`
  //    snapshot (`useInTextPositions`, fed by the DocStructureObserver's
  //    per-transaction-mapped `getBus(editor).structure`).
  // BOTH paths are gated on `useStructuralRevisions` counters
  // (`rev.anchors` / `rev.blocks` here) — never on a raw update counter —
  // so a structurally-null keystroke re-derives neither (keystroke
  // sanctity). Don't add a footnote/citation/example branch here, and
  // don't move a paragraph-anchored kind onto the omni path without
  // moving its marker too.
  //
  // CHIP-B — RESOLVER-DRIVEN textObjectId. Each card's marker paragraph is
  // resolved through the anchor-recovery SSOT (`resolveCardAnchor`) against
  // ONE `buildResolveIndex(editor)` built at the TOP of this memo (O(doc),
  // card-count-independent — never per card). The resolver's
  // `anchorIdToParagraph` rung subsumes the old inline revision
  // anchorId→paragraph doc walk (deleted). `source==='orphan'` (uuid + mark
  // + snapshot all dead) emits an `unanchored` marker the margin surfaces as
  // a visible "click to re-pin" affordance instead of silently vanishing.
  // `buildResolveIndex` reads the live doc, so this memo ALSO depends on the
  // reactive `editor` instance (the `useStructuralRevisions` counters start
  // at 0 and stay flat on load — see AGENTS "Initial population"); a plain
  // keystroke mints no uuid / adds no block, so `rev.anchors`/`rev.blocks`
  // stay flat → the memo doesn't recompute and `buildResolveIndex` doesn't
  // run (keystroke sanctity is structural, not vigilance-based).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // Set of archived card ids across every panel. Drives the in-document
  // exclusion (margin markers, highlights) + OmniView, and is read by the
  // per-card archive actions context through `archivedIdsRef` (stable identity,
  // so a card-body keystroke never broadly re-renders all cards). Recomputes
  // only when a sidecar collection changes (an archive toggle / add / delete),
  // never on a plain keystroke.
  const archivedIds = useMemo(() => {
    const s = new Set<string>();
    const add = (arr: ReadonlyArray<{ id: string; archived?: boolean }>) => {
      for (const c of arr) if (c.archived) s.add(c.id);
    };
    add(notesHook.cards);
    add(todosHook.items);
    add(reportsHook.cards);
    add(revisionsHook.cards);
    add(cutterHook.cards);
    add(footnotesHook.footnoteRefs);
    add(citationsHook.citations);
    add(archiveHook.snippets);
    return s;
  }, [
    notesHook.cards,
    todosHook.items,
    reportsHook.cards,
    revisionsHook.cards,
    cutterHook.cards,
    footnotesHook.footnoteRefs,
    citationsHook.citations,
    archiveHook.snippets,
  ]);
  const archivedIdsRef = useRef(archivedIds);
  archivedIdsRef.current = archivedIds;

  // BUG #55: per-footnote AI-request flags, sourced from the footnotes.json
  // sidecar (FootnoteInfo is .tex-derived and carries no flag). Pure derivation
  // off `footnoteRefs` — recomputes only when the sidecar collection changes (a
  // flag toggle / add / delete / content edit), never on a plain keystroke.
  const footnoteAiRequests = useMemo(() => {
    const m: Record<string, boolean> = {};
    for (const f of footnotesHook.footnoteRefs) if (f.aiRequest) m[f.id] = true;
    return m;
  }, [footnotesHook.footnoteRefs]);

  // Bug sweep #3: the ATOMLESS footnote refs (archived or unanchored) the
  // Footnotes panel lists alongside live anchored footnotes + orphans. Anchored
  // footnotes come from the live editor (footnoteInfos); an archived/unanchored
  // ref has no `\footnote` atom, so it lives only in the footnotes.json sidecar.
  // Pure derivation off footnoteRefs — recomputes only when the sidecar changes
  // (archive toggle / add / delete), never on a plain keystroke.
  const unanchoredFootnoteRefs = useMemo(
    () => footnotesHook.footnoteRefs.filter((f) => f.archived || f.unanchored),
    [footnotesHook.footnoteRefs],
  );

  // ── Phase 1c — gutter-driven Keep / Revert for an applied pending change ──
  // The persistent margin-gutter Keep/Revert affordance (attached below to the
  // ordinary revision/cut marker of a `status:"applied"` suggestion) calls
  // these. They route through the SAME `pending-change-actions` sequence the
  // card-surface host closures use, so the gutter and the card stay
  // byte-identical. The flag + editor-mounted guard lives here (flag-OFF: no
  // applied handler is ever
  // emitted, so these are unreachable — byte-identical OFF). `editor` is the
  // reactive instance the rest of EditorPane threads.
  // Per-family deps bag for the shared `pending-change-actions` sequence. Built
  // fresh at ACTION time (a click) so it reads the live cards; its `useCallback`
  // identity is keystroke-stable (deps: the keystroke-stable hook object), which
  // is what keeps the controller/index/bulk memos below stable across typing.
  const revisionPendingDeps = useCallback(
    (): PendingChangeCardDeps<RevisionSuggestionCard["status"]> => ({
      getAppliedChange: (cid) =>
        revisionsHook.cards.find(
          (c): c is RevisionSuggestionCard => c.id === cid && c.kind === "suggestion",
        )?.appliedChange,
      setSuggestionStatus: revisionsHook.setSuggestionStatus,
      setArchived: revisionsHook.setArchived,
      setAppliedChange: revisionsHook.setAppliedChange,
      family: "revision-suggestion",
      acceptedStatus: "accepted",
      rejectedStatus: "rejected",
    }),
    [revisionsHook],
  );
  const cutterPendingDeps = useCallback(
    (): PendingChangeCardDeps<CutterSuggestionCard["status"]> => ({
      getAppliedChange: (cid) =>
        cutterHook.cards.find(
          (c): c is CutterSuggestionCard => c.id === cid && c.kind === "suggestion",
        )?.appliedChange,
      setSuggestionStatus: cutterHook.setSuggestionStatus,
      setArchived: cutterHook.setArchived,
      setAppliedChange: cutterHook.setAppliedChange,
      family: "cutter-suggestion",
      acceptedStatus: "accepted",
      rejectedStatus: "rejected",
    }),
    [cutterHook],
  );

  // Per-card COMMIT closures (Check = keep, Cross = dismiss-preserves), threaded
  // to the gutter marker / pill / omni bulk index. The flag + editor-mounted
  // guard lives here (flag-OFF: no applied card ever exists, so these are
  // unreachable — byte-identical OFF).
  const onKeepRevisionPending = useCallback(
    (id: string) => {
      if (!isPendingChangesOn() || !editor) return;
      keepSuggestion(editor, id, docId, revisionPendingDeps());
    },
    [editor, docId, revisionPendingDeps],
  );
  const onDismissRevisionPending = useCallback(
    (id: string) => {
      if (!isPendingChangesOn() || !editor) return;
      dismissSuggestion(editor, id, docId, revisionPendingDeps());
    },
    [editor, docId, revisionPendingDeps],
  );
  const onKeepCutterPending = useCallback(
    (id: string) => {
      if (!isPendingChangesOn() || !editor) return;
      keepSuggestion(editor, id, docId, cutterPendingDeps());
    },
    [editor, docId, cutterPendingDeps],
  );
  const onDismissCutterPending = useCallback(
    (id: string) => {
      if (!isPendingChangesOn() || !editor) return;
      dismissSuggestion(editor, id, docId, cutterPendingDeps());
    },
    [editor, docId, cutterPendingDeps],
  );

  // ── Insert-below deps + closures (the retired-4-field AI fallback verb) ──
  // The minimal AI-pending card body's "Insert below" routes here through the
  // controller. Each deps bag resolves the live suggestion by id at ACTION time
  // (a click) — suggested text + Mode-A anchor + any applied descriptor — so the
  // insert reads current cards. `useCallback([hook])` keeps its identity
  // keystroke-stable (the hook object is), which keeps the controller memo stable
  // across typing.
  const revisionInsertDeps = useCallback(
    (): InsertBelowCardDeps<RevisionSuggestionCard["status"]> => ({
      getSuggestion: (cid) => {
        const s = revisionsHook.cards.find(
          (c): c is RevisionSuggestionCard => c.id === cid && c.kind === "suggestion",
        );
        if (!s) return undefined;
        return {
          suggestedText: s.suggested_text,
          anchorUuid: getLinkedTextObjectIds(s)[0],
          appliedChange: s.appliedChange,
        };
      },
      setSuggestionStatus: revisionsHook.setSuggestionStatus,
      setArchived: revisionsHook.setArchived,
      setAppliedChange: revisionsHook.setAppliedChange,
      acceptedStatus: "accepted",
    }),
    [revisionsHook],
  );
  const cutterInsertDeps = useCallback(
    (): InsertBelowCardDeps<CutterSuggestionCard["status"]> => ({
      getSuggestion: (cid) => {
        const s = cutterHook.cards.find(
          (c): c is CutterSuggestionCard => c.id === cid && c.kind === "suggestion",
        );
        if (!s) return undefined;
        return {
          suggestedText: s.suggested_text,
          anchorUuid: getLinkedTextObjectIds(s)[0],
          appliedChange: s.appliedChange,
        };
      },
      setSuggestionStatus: cutterHook.setSuggestionStatus,
      setArchived: cutterHook.setArchived,
      setAppliedChange: cutterHook.setAppliedChange,
      acceptedStatus: "accepted",
    }),
    [cutterHook],
  );
  const onInsertBelowRevisionPending = useCallback(
    (id: string) => {
      if (!isPendingChangesOn() || !editor) return;
      insertSuggestionBelow(editor, id, docId, revisionInsertDeps());
    },
    [editor, docId, revisionInsertDeps],
  );
  const onInsertBelowCutterPending = useCallback(
    (id: string) => {
      if (!isPendingChangesOn() || !editor) return;
      insertSuggestionBelow(editor, id, docId, cutterInsertDeps());
    },
    [editor, docId, cutterInsertDeps],
  );

  // The SSOT controller any suggestion-card body reads for its applied-change
  // controls (docked panel, omni, float, margin) — see
  // `pending-change-controller`. Commit (keep/dismiss) reuses the stable
  // per-card closures; the NON-committing preview verbs route by family to the
  // shared action fns (card-body-only — the pill/bulk stay commit-only). Its
  // identity is constant across keystrokes (deps are all keystroke-stable
  // `useCallback` refs + the reactive `editor`/`docId`). Do NOT add
  // `revisionsHook.cards`/`cutterHook.cards` here — that would break keystroke
  // sanctity for every consuming card body.
  const pendingController = useMemo<PendingChangeController>(
    () => ({
      isOn: isPendingChangesOn() && !!editor,
      keep: (family, id) => {
        if (family === "revision-suggestion") onKeepRevisionPending(id);
        else onKeepCutterPending(id);
      },
      dismiss: (family, id) => {
        if (family === "revision-suggestion") onDismissRevisionPending(id);
        else onDismissCutterPending(id);
      },
      previewOriginal: (family, id) => {
        if (!isPendingChangesOn() || !editor) return;
        previewOriginalSuggestion(
          editor,
          id,
          docId,
          family === "revision-suggestion" ? revisionPendingDeps() : cutterPendingDeps(),
        );
      },
      previewSuggested: (family, id) => {
        if (!isPendingChangesOn() || !editor) return;
        previewSuggestedSuggestion(
          editor,
          id,
          docId,
          family === "revision-suggestion" ? revisionPendingDeps() : cutterPendingDeps(),
        );
      },
      insertBelow: (family, id) => {
        if (family === "revision-suggestion") onInsertBelowRevisionPending(id);
        else onInsertBelowCutterPending(id);
      },
    }),
    [
      editor,
      docId,
      revisionPendingDeps,
      cutterPendingDeps,
      onKeepRevisionPending,
      onDismissRevisionPending,
      onKeepCutterPending,
      onDismissCutterPending,
      onInsertBelowRevisionPending,
      onInsertBelowCutterPending,
    ],
  );

  // ── Phase 3 — the floating pill's target index + the omni bulk handlers ──
  // The pill (rendered below, inside the CardStoreProvider) and the omni
  // Keep-all / Dismiss-all both need the applied-pending suggestion set. Derive
  // ONE index — `kind:id` → { anchorId, onKeep, onDismiss } — from the applied
  // revision + cutter cards, each routed through the SAME per-card callbacks the
  // gutter uses (so the pill, gutter, and bulk index are byte-identical). The
  // memo is gated on the card arrays + the flag; a plain keystroke bumps neither,
  // so it never recomputes per keystroke. Flag-OFF: no card reaches `applied`,
  // the map is empty, and the pill isn't mounted (`size === 0`).
  const pendingChangeIndex = useMemo<PendingChangeIndex>(() => {
    const map: PendingChangeIndex = new Map();
    if (!isPendingChangesOn()) return map;
    for (const r of revisionsHook.cards) {
      if (r.kind !== "suggestion" || !isAppliedPending(r) || !r.appliedChange)
        continue;
      map.set(`revision-suggestion:${r.id}`, {
        anchorId: r.appliedChange.anchorId,
        onKeep: () => onKeepRevisionPending(r.id),
        onDismiss: () => onDismissRevisionPending(r.id),
      });
    }
    for (const c of cutterHook.cards) {
      if (c.kind !== "suggestion" || !isAppliedPending(c) || !c.appliedChange)
        continue;
      map.set(`cutter-suggestion:${c.id}`, {
        anchorId: c.appliedChange.anchorId,
        onKeep: () => onKeepCutterPending(c.id),
        onDismiss: () => onDismissCutterPending(c.id),
      });
    }
    return map;
  }, [
    revisionsHook.cards,
    cutterHook.cards,
    onKeepRevisionPending,
    onDismissRevisionPending,
    onKeepCutterPending,
    onDismissCutterPending,
  ]);

  // Bulk Keep-all / Dismiss-all — iterate the applied AI cards of one family
  // through the shared per-card sequence. `keepSuggestion`/`dismissSuggestion`
  // re-read the live card by id, so applying them in source order is safe even
  // as each splice shifts later positions (the next id re-resolves its own
  // appliedChange). Dismiss-all PRESERVES (archives) every card — never deletes.
  // Click handlers only — no ticks, no per-keystroke work.
  const keepAllRevisionPending = useCallback(() => {
    if (!isPendingChangesOn()) return;
    for (const id of collectAppliedPendingIds(revisionsHook.cards)) {
      onKeepRevisionPending(id);
    }
  }, [revisionsHook.cards, onKeepRevisionPending]);
  const dismissAllRevisionPending = useCallback(() => {
    if (!isPendingChangesOn()) return;
    for (const id of collectAppliedPendingIds(revisionsHook.cards)) {
      onDismissRevisionPending(id);
    }
  }, [revisionsHook.cards, onDismissRevisionPending]);
  const keepAllCutterPending = useCallback(() => {
    if (!isPendingChangesOn()) return;
    for (const id of collectAppliedPendingIds(cutterHook.cards)) {
      onKeepCutterPending(id);
    }
  }, [cutterHook.cards, onKeepCutterPending]);
  const dismissAllCutterPending = useCallback(() => {
    if (!isPendingChangesOn()) return;
    for (const id of collectAppliedPendingIds(cutterHook.cards)) {
      onDismissCutterPending(id);
    }
  }, [cutterHook.cards, onDismissCutterPending]);

  // ── Task 023 — the applied-change NAVIGATOR cursor ──────────────────────────
  // The prev/next cursor over the applied-pending set in DOC ORDER that powers
  // the omni bulk bar's ▲/▼ + counter. The doc-order key list is derived off the
  // card-source `pendingChangeIndex` (which changes only on apply/keep/dismiss —
  // NEVER on a plain keystroke, and NOT gated on any `docVersion` counter), so
  // the `sortAppliedKeysByDocPos` doc-walk never runs on the keystroke path.
  // `useCycle` owns the clamped index (no hand-rolled cursor); each step resolves
  // the change's LIVE range at click time and scrolls + lights it.
  const orderedPendingKeys = useMemo(
    () =>
      editor ? sortAppliedKeysByDocPos(pendingChangeIndex, editor.state.doc) : [],
    [pendingChangeIndex, editor],
  );
  const navigateToAppliedChange = useCallback(
    (key: string) => {
      const ed = editorInstanceRef.current;
      if (!ed || ed.isDestroyed) return;
      const target = pendingChangeIndex.get(key);
      if (!target) return;
      const range = findLinkedAnchorRange(ed.state.doc, target.anchorId);
      if (!range) return;
      // Scroll the change into view + caret-select its start. Inlined from
      // EditorHandle.scrollToPos (Editor.tsx) — this scope holds the raw editor
      // (editorInstanceRef), not the EditorHandle, so we reuse its coordsAtPos
      // scroll math directly rather than thread a second ref.
      try {
        ed.commands.setTextSelection(range.from);
        const coords = ed.view.coordsAtPos(range.from);
        const scrollEl = findEditorScrollFor(ed.view.dom);
        if (scrollEl && coords) {
          const scrollRect = scrollEl.getBoundingClientRect();
          const targetY = coords.top - scrollRect.top + scrollEl.scrollTop - 100;
          scrollEl.scrollTop = Math.max(0, targetY);
        }
      } catch {
        /* pos out of range — ignore */
      }
      // Light the blue range via the shared card-selection halo
      // (useAnchorHighlightReconciler owns it — no new decoration). Parse the
      // kind/id from the KEY, not the in-text mark: the blue mark flattens both
      // families to "revision-suggestion", but the key preserves the true kind.
      const sep = key.indexOf(":");
      const kind = key.slice(0, sep) as EntityKind;
      const id = key.slice(sep + 1);
      cardStoreInst.select({ kind, id });
    },
    [pendingChangeIndex, cardStoreInst],
  );
  const {
    idx: appliedNavIdx,
    next: appliedNavNext,
    prev: appliedNavPrev,
  } = useCycle(orderedPendingKeys, navigateToAppliedChange);

  // The unified bulk affordance threaded to OmniHost → OmniViewPanel: the doc-
  // order prev/next cursor (▲/▼ + counter) plus one Keep-all / Dismiss-all that
  // drains BOTH families (revision + cutter), plus the count so the header only
  // renders when something is applied. Stable unless a family's applied set, the
  // nav cursor, or a per-family bulk callback changes — none per keystroke.
  const omniBulkPendingChanges = useMemo<OmniBulkPendingChanges>(() => {
    const count =
      collectAppliedPendingIds(revisionsHook.cards).length +
      collectAppliedPendingIds(cutterHook.cards).length;
    return {
      count,
      current: appliedNavIdx,
      onPrev: appliedNavPrev,
      onNext: appliedNavNext,
      onKeepAll: () => {
        keepAllRevisionPending();
        keepAllCutterPending();
      },
      onDismissAll: () => {
        dismissAllRevisionPending();
        dismissAllCutterPending();
      },
    };
  }, [
    revisionsHook.cards,
    cutterHook.cards,
    appliedNavIdx,
    appliedNavPrev,
    appliedNavNext,
    keepAllRevisionPending,
    keepAllCutterPending,
    dismissAllRevisionPending,
    dismissAllCutterPending,
  ]);

  const marginaliaMarkers = useMemo<MarginaliaMarker[]>(() => {
    // Re-resolve markers when anchors move between paragraphs (`rev.anchors`)
    // or the paragraph-UUID set changes (`rev.blocks`). Card-store arrays
    // (notes, reports, …) and error state are their own deps; plain typing
    // bumps none of these, so markers don't recompute or shift per keystroke.
    void rev.anchors;
    void rev.blocks;
    // Phase 1c flag read (call-time, not memoized): gates whether an applied
    // suggestion's ordinary revision/cut marker also carries the Keep/Revert
    // handlers. Flag-OFF → no card ever reaches `status:"applied"`, so this is
    // dead and the marker set is byte-identical to pre-1c.
    const pendingChangesOn = isPendingChangesOn();
    const result: MarginaliaMarker[] = [];

    // ONE O(doc) resolve index for the whole pass, built at the TOP before
    // any per-card loop (never per card). `null` until the editor mounts —
    // the card branches fall back to the bare-link pids in that gap, then
    // re-derive once `editor` (a memo dep) becomes non-null. A `linkedRange`
    // card whose mark + uuid + snapshot are all dead resolves `orphan` →
    // `unanchored` marker (surfaced, not culled).
    const resolveIndex = editor ? buildResolveIndex(editor) : null;
    // Not-on-load guard (orphan-affordance risk, MEMO §"Risks"): during the
    // editor-mount gap the doc can be momentarily empty — `buildResolveIndex`
    // then returns an EMPTY `uuidToParagraph`, against which EVERY card would
    // resolve `orphan` and flash the re-pin dock spuriously. Treat a
    // zero-uuid index as "not ready" and fall back to raw pids (no orphan
    // flag) until the doc's blocks are present.
    const indexReady = !!resolveIndex && resolveIndex.uuidToParagraph.size > 0;
    /**
     * Resolve a card to its live marker paragraph(s) + orphan flag through the
     * SSOT. On a resolved (non-orphan) card, emits ONE marker per LIVE stored
     * pid — seeded with the resolver's `res.paragraphId` (so a mark-/snapshot-
     * resolved paragraph that isn't itself a raw stored pid is still rendered)
     * then every still-live raw stored pid, DEDUPED + order-stable. This keeps
     * a healthy MULTI-anchor Mode-A card (several live `textObjectIds`, e.g. a
     * multi-paragraph selection-note whose mark was later deleted → N separate
     * Mode-A paragraph links) rendering ONE marker PER live paragraph — the
     * resolver itself binds to the FIRST live uuid only, so the resolved
     * `res.paragraphId` alone would drop P2..Pn (silent vanish + breaks the
     * per-pid detach affordance). On `orphan`, returns the card's first stored
     * pid (so the marker still carries a textObjectId for keying / re-pin)
     * flagged `unanchored`.
     */
    const resolveMarkerPids = (
      c: CardWithLinks,
      pids: string[],
    ): Array<{ pid: string; unanchored: boolean }> => {
      if (!resolveIndex || !editor || !indexReady) {
        // Editor not mounted / doc not painted yet — fall back to the raw
        // stored pids so the margin isn't blank AND no card false-flags as
        // orphan during the mount gap. Re-derives once `editor` is set (memo
        // dep) and the index has live uuids.
        return pids.map((pid) => ({ pid, unanchored: false }));
      }
      const res = resolveCardAnchor(c, editor, resolveIndex);
      if (res.source === "orphan") {
        // uuid + mark + snapshot all dead → surface, don't vanish. Key on the
        // first stored pid (stable id for the marker + the re-pin gesture).
        return pids.length > 0
          ? [{ pid: pids[0], unanchored: true }]
          : [];
      }
      if (res.paragraphId) {
        // Emit a marker for EVERY live stored pid (multi-anchor Mode-A), not
        // just the resolver's first-live binding. Seed with `res.paragraphId`
        // (covers a mark-/snapshot-resolved pid that isn't a raw stored pid),
        // then append every still-live raw stored pid; dedupe order-stable.
        const live = pids.filter((p) => resolveIndex.uuidToParagraph.has(p));
        const seen = new Set<string>();
        const out: Array<{ pid: string; unanchored: boolean }> = [];
        for (const pid of [res.paragraphId, ...live]) {
          if (seen.has(pid)) continue;
          seen.add(pid);
          out.push({ pid, unanchored: false });
        }
        return out;
      }
      return pids.map((pid) => ({ pid, unanchored: false }));
    };

    // T5 Pillar E-2: the `@N` anchor index of a marker's paragraph within the
    // card's stored anchor order — the SAME index each panel's omni builder
    // uses to key its per-anchor row (`…@<pi>`, suffixed ONLY when the card
    // has >1 anchor). Returns `undefined` for a single-anchor card (its omni
    // row carries no `@N` suffix) so the bridge keys the bare card popKey.
    const anchorIndexFor = (pids: string[], pid: string): number | undefined => {
      if (pids.length <= 1) return undefined;
      const i = pids.indexOf(pid);
      return i >= 0 ? i : undefined;
    };

    // Notes
    for (const n of notesHook.notes) {
      const pids = getLinkedTextObjectIds(n);
      if (pids.length === 0) continue;
      const anchor = getTextAnchor(n);
      for (const { pid, unanchored } of resolveMarkerPids(n, pids)) {
        result.push({
          id: `${n.id}:${pid}`,
          entityId: n.id,
          entityKind: "note",
          type: "note",
          textObjectId: pid,
          title: n.title || "Note",
          unanchored,
          onClick: (clickY?: number) =>
            handleMarginMarkerClick({ kind: "note", id: n.id }, clickY, anchorIndexFor(pids, pid)),
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
      for (const { pid, unanchored } of resolveMarkerPids(snippet, pids)) {
        result.push({
          id: `${snippet.id}:${pid}`,
          entityId: snippet.id,
          entityKind: "archive",
          type: "archive",
          textObjectId: pid,
          title: "Archived snippet",
          unanchored,
          onClick: (clickY?: number) =>
            handleMarginMarkerClick({ kind: "archive", id: snippet.id }, clickY, anchorIndexFor(pids, pid)),
          onDelete: () => { void handleMarginItemDelete("archive", snippet.id, pid); },
        });
      }
    }

    // Revision comments / suggestions — paragraph resolved through the SSOT
    // (the resolver's `anchorIdToParagraph` rung replaces the old inline
    // anchorId→paragraph doc walk). `orphan` (mark + uuid + snapshot all
    // dead) still surfaces an `unanchored` marker rather than vanishing.
    for (const r of revisionsHook.cards) {
      // Skip only *resolved* suggestions (accepted/rejected). A `pending` card
      // is awaiting review and an `applied` card is spliced into the doc but
      // still awaiting an explicit "Keep" — both are live and keep their margin
      // marker; `stale` (the paragraph drifted) likewise stays visible so the
      // user can resolve it. Flag-OFF this is identical to the old
      // `status !== "pending"` skip, since no card ever reaches applied/stale
      // without the Phase-1b apply path (pending-changes-flag).
      if (
        r.kind === "suggestion" &&
        (r.status === "accepted" || r.status === "rejected")
      )
        continue;
      const revAnchor = getTextAnchor(r);
      const pids = getLinkedTextObjectIds(r);
      // A revision with neither a text anchor nor a stored pid has nothing
      // to resolve from — skip (matches the old "no mark → no marker").
      if (!revAnchor && pids.length === 0) continue;
      const anchorId = revAnchor?.anchorId;
      const revKind: EntityKind =
        r.kind === "suggestion" ? "revision-suggestion" : "revision-comment";
      // An APPLIED suggestion (flag-ON, spliced-but-not-yet-kept) keeps its
      // ordinary `revision` marker — no re-skin, and (as of the margin-declutter
      // pass) no hover Keep/Revert chips either: the gutter marker is just a
      // plain revision marker. Keep/Revert reach the change through the card and
      // the in-context left-margin pill instead.
      for (const { pid, unanchored } of resolveMarkerPids(r, pids)) {
        result.push({
          id: `${r.id}:${pid}`,
          entityId: r.id,
          entityKind: revKind,
          type: "revision",
          textObjectId: pid,
          title: r.selectedText || "Revision",
          unanchored,
          anchorId,
          onClick: (clickY?: number) =>
            handleMarginMarkerClick({ kind: revKind, id: r.id }, clickY, anchorIndexFor(pids, pid)),
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
      const cutKind: EntityKind =
        c.kind === "suggestion" ? "cutter-suggestion" : "cutter-comment";
      // An APPLIED cutter suggestion (flag-ON) keeps its ordinary `cut` marker —
      // no re-skin and no hover Keep/Revert chips (margin-declutter pass); the
      // gutter marker is plain. Keep/Revert reach the change through the card and
      // the in-context left-margin pill instead.
      for (const { pid, unanchored } of resolveMarkerPids(c, pids)) {
        result.push({
          id: `${c.id}:${pid}`,
          entityId: c.id,
          entityKind: cutKind,
          type: "cut",
          textObjectId: pid,
          title,
          unanchored,
          onClick: (clickY?: number) =>
            handleMarginMarkerClick({ kind: cutKind, id: c.id }, clickY, anchorIndexFor(pids, pid)),
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
      for (const { pid, unanchored } of resolveMarkerPids(c, pids)) {
        result.push({
          id: `${c.id}:${pid}`,
          entityId: c.id,
          entityKind: c.kind,
          type: "report",
          textObjectId: pid,
          title,
          unanchored,
          onClick: (clickY?: number) =>
            handleMarginMarkerClick({ kind: c.kind, id: c.id }, clickY, anchorIndexFor(pids, pid)),
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
      for (const { pid, unanchored } of resolveMarkerPids(item, pids)) {
        result.push({
          id: `${item.id}:${pid}`,
          entityId: item.id,
          entityKind: "todo",
          type: "todo",
          textObjectId: pid,
          title: item.text || "Todo",
          muted: item.done,
          unanchored,
          onClick: (clickY?: number) =>
            handleMarginMarkerClick({ kind: "todo", id: item.id }, clickY, anchorIndexFor(pids, pid)),
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
        onClick: (clickY?: number) => handleErrorMarkerClick(err.id, clickY),
        onDelete: () => dismissError(err.id),
      });
    }

    return result;
  }, [
    // Card arrays + structural revision counters + error state ONLY — no
    // selection deps (markers self-subscribe for their halo; click handlers
    // read the store/ref at click time), so selecting a card never
    // recomputes the marker layer.
    notesHook.notes,
    archiveHook.snippets,
    todosHook.items,
    cutterHook.cards,
    revisionsHook.cards,
    reportsHook.cards,
    handleMarginItemDelete,
    handleMarginMarkerClick,
    handleErrorMarkerClick,
    allLatexErrors,
    dismissedErrorIds,
    paragraphByErrorId,
    rev.anchors,
    rev.blocks,
    // The reactive editor instance — `buildResolveIndex(editor)` reads the
    // live doc, and the `useStructuralRevisions` counters are silent on load
    // (`buildInitial` emits nothing), so the memo must re-derive once the
    // editor mounts (AGENTS "Initial population"). A plain keystroke doesn't
    // change `editor`'s identity, so this adds no per-keystroke recompute.
    editor,
  ]);

  // Marginalia uses this to decide which margin to render each marker
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

  // Snapshot of paragraph UUIDs that host at least one margin marker.
  // Read by the `MarginaliaAnchorGuard` ProseMirror plugin (see
  // `src/lib/tiptap/linked-anchor.ts`) to preserve a placeholder
  // paragraph with the same UUID when the user deletes the host
  // paragraph — anchored cards stay attached through incidental
  // editor edits. The plugin auto-discovers UUIDs that host
  // `linkedAnchor` marks in addition to this set, so cards without a
  // margin icon (highlights) are also protected.
  const anchoredUuidsRef = useRef(new Set<string>());
  useMemo(() => {
    const set = new Set<string>();
    // Exclude orphan markers (CHIP-B): their `textObjectId` is a stale,
    // already-dead pid (the card resolved `source:'orphan'`), so guarding a
    // placeholder for it is meaningless — the live anchor is gone, and the
    // card is awaiting a re-pin via the orphan dock.
    for (const m of marginaliaMarkers) {
      if (m.unanchored) continue;
      set.add(m.textObjectId);
    }
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
    // Archived cards drop out of the margin entirely (they live only under
    // their panel's View Archives/All), on top of the per-type hide set.
    return marginaliaMarkers.filter(
      (m) =>
        !archivedIds.has(m.entityId) &&
        (!hidden || hidden.size === 0 || !hidden.has(m.type as MarginaliaType)),
    );
  }, [
    marginaliaMarkers,
    archivedIds,
    menuBar?.showMarginalia,
    menuBar?.hiddenMarginaliaTypes,
  ]);

  const cardCreation = useCardCreation({
    editorRef: innerRef,
    addNote: notesHook.addNote,
    addHighlight: notesHook.addHighlight,
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
    setTodoAnchor: todosHook.setTodoAnchor,
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
    store: cardStoreInst,
  });

  // Compound citation delete (the hard-delete contract). The bare sidecar
  // `citationsHook.deleteCitation` only filtered the citations.json entry
  // and left the `\cite` atom in the doc — so the once-per-mount
  // `syncFromEditor` (above) rebuilt the entry from the surviving atom and
  // the card resurrected on reload. This removes BOTH: first the in-doc
  // atom via the editor handle (a no-op for a draft / unanchored citation,
  // which has no node — `findInlineAtomPos` returns null), then the
  // sidecar entry. A footnote-NESTED `\cite` lives inside a footnote's
  // attrs.content rather than as a top-level doc atom; the handle's
  // `deleteCitation` now ALSO strips it from the host footnote's content
  // (backlog #38 — was previously left behind, so `getCitations()` re-derived
  // the deleted card on reload). That footnote-content rewrite is a real doc
  // tx, so the readOnlyEnforcer leaves it inert in collaborator read-only
  // mode. EVERY UI delete path routes here; the bare sidecar filter survives
  // only as this handler's internal second step. Defined above the
  // discard/registry/popouts memos that consume it so it's out of the TDZ
  // when those factories evaluate.
  const handleDeleteCitation = useCallback(
    (id: string) => {
      innerRef.current?.deleteCitation(id);
      citationsHook.deleteCitation(id);
    },
    [citationsHook.deleteCitation],
  );

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
    () => revisionPristine.registerDiscard((id) => revisionsHook.deleteCard(id)),
    [revisionPristine, revisionsHook.deleteCard],
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
    () => citationPristine.registerDiscard((id) => handleDeleteCitation(id)),
    [citationPristine, handleDeleteCitation],
  );
  useEffect(
    () =>
      footnotePristine.registerDiscard((id) => {
        // Click-away discard of a blank footnote. The body editor's onChange is
        // debounced (250ms) and only flushed on blur — which fires AFTER this
        // pointerdown — so the just-typed content may not have reached the node
        // yet. Defer past the blur-flush, then delete ONLY if the footnote is
        // still genuinely empty. Resolved by id against the LIVE editor, so a
        // doc-switch before the timer fires can't misfire (the stale id won't
        // resolve). Footnotes never call `discardAll`, so this handler is only
        // ever the pointerdown path — the defer is safe.
        setTimeout(() => {
          const fn = innerRef.current
            ?.getFootnotes()
            .find((f) => f.footnoteId === id);
          if (!fn) return; // already gone, or the doc switched out from under us
          if (cardHasContent("footnote", { content: fn.content, title: fn.title })) {
            return; // the user typed something — keep it
          }
          innerRef.current?.deleteFootnote(id);
        }, 0);
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
  // omni-view is showing on the new card's panel side. The Reader's
  // ephemeral `viewPrefs` makes the omni activation real, but its
  // read-only chrome never surfaces the create handles, so the
  // dispatch is effectively unreachable there.
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
        delete: handleDeleteCitation,
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
    [footnotesHook, citationsHook, notesHook, revisionsHook, cutterHook, handleDeleteCitation],
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

  // ─── PM→React action bridge (CHIP 4a-i — INERT) ─────────────────────
  // Publish ONE `EditorActionsHandle` into the module-singleton bridge so
  // plugin-land code (slash commands / typed-LaTeX input rules — wired in
  // 4a-ii) can reach the registry's React-land `run()`s. This REPLACES the
  // scattered `virgil-*` CustomEvents with one typed entrypoint.
  //
  // ── INERT this chip ── nothing calls `getEditorActionsHandle().runAction`
  // yet (the PM plugins are untouched), so publishing the handle changes NO
  // user-facing behavior.
  //
  // Ref-stashing (mirrors how EditorPane stashes live values for stable
  // callbacks elsewhere): the published handle reads `bridgeDepsRef.current`
  // — refreshed EVERY render below — so it always sees the CURRENT
  // editor/cardCreation/cardLifecycle/dispatch WITHOUT re-publishing on each
  // render. The handle object identity is stable (built once in the effect,
  // gated on the reactive `editor` mount), so the publish effect runs only on
  // mount/unmount, not per render.
  // The live prefs + active-side setters the citation soft-route inspects
  // (CHIP 4a-ii). Both surfaces pass `viewPrefs` (the Reader via the
  // ephemeral `useReaderViewPrefs()`), so `bridgeRoutingPrefs` resolves to
  // real prefs in each; the `readerPrefs` / `stubSetActive` fallbacks only
  // apply if no `viewPrefs` bundle is supplied at all. (The Reader is
  // read-only, so a `\cite` never actually originates there.)
  const bridgeRoutingPrefs = viewPrefs?.prefs ?? readerPrefs;
  const bridgeSetActiveLeft = viewPrefs?.setActiveLeft ?? stubSetActive;
  const bridgeSetActiveRight = viewPrefs?.setActiveRight ?? stubSetActive;
  // Backlog #2 soft-route reveal: un-collapse / un-blank the panel's docked
  // side so a freshly-created card shows in omni. The Reader pane has no rail,
  // so these fall back to the no-op `stubSetActive` (a `\cite`/`\footnote` in
  // the Reader has nothing to reveal).
  const bridgeExpandLeft = viewPrefs?.expandLeft ?? stubSetActive;
  const bridgeExpandRight = viewPrefs?.expandRight ?? stubSetActive;
  const bridgeClearBlankIfSet = viewPrefs?.clearBlankIfSet ?? stubSetActive;
  const bridgeDepsRef = useRef<{
    cardCreation: typeof cardCreation;
    cardLifecycle: typeof cardLifecycle;
    dispatch: typeof dragHandleActions.dispatch;
    routingPrefs: typeof bridgeRoutingPrefs;
    setActiveLeft: (id: PanelId) => void;
    setActiveRight: (id: PanelId) => void;
    expandLeft: () => void;
    expandRight: () => void;
    clearBlankIfSet: () => void;
    setSelectedExampleId: typeof setSelectedExampleId;
  }>({
    cardCreation,
    cardLifecycle,
    dispatch: dragHandleActions.dispatch,
    routingPrefs: bridgeRoutingPrefs,
    setActiveLeft: bridgeSetActiveLeft,
    setActiveRight: bridgeSetActiveRight,
    expandLeft: bridgeExpandLeft,
    expandRight: bridgeExpandRight,
    clearBlankIfSet: bridgeClearBlankIfSet,
    setSelectedExampleId,
  });
  bridgeDepsRef.current = {
    cardCreation,
    cardLifecycle,
    dispatch: dragHandleActions.dispatch,
    routingPrefs: bridgeRoutingPrefs,
    setActiveLeft: bridgeSetActiveLeft,
    setActiveRight: bridgeSetActiveRight,
    expandLeft: bridgeExpandLeft,
    expandRight: bridgeExpandRight,
    clearBlankIfSet: bridgeClearBlankIfSet,
    setSelectedExampleId,
  };
  // Publish on editor-mount; clear on unmount (or when the editor instance
  // swaps). Gated on the reactive `editor` so the handle's `runAction` reads a
  // live, non-null editor. The live editor is read through `innerRef.current?.
  // getEditor()` at call time (not closed over) so an HMR remount stays sound.
  useEffect(() => {
    if (!editor) return;
    const handle: EditorActionsHandle = {
      runAction(id: ActionId, seed) {
        const spec = VIRGIL_ACTION_REGISTRY[id];
        if (!spec) {
          // Unknown / not-yet-migrated id — no-op (dev-warn so a 4a-ii
          // call-site typo is loud). The registry is partial until later
          // chips populate the slash/typed/block/format rows.
          if (process.env.NODE_ENV !== "production") {
            console.warn(
              `[editor-actions-bridge] runAction("${id}") — no registry row; ignoring`,
            );
          }
          return;
        }
        // The live editor at call time (not the closed-over reactive value)
        // — robust to an HMR remount between publish and call.
        const ed = innerRef.current?.getEditor();
        if (!ed) return;
        // CHIP 7b: the UNIFORM collab read-only gate for the PM-land surfaces
        // (slash / typed). `ed.isEditable` is the in-editor mirror of
        // `collab.canEditMainText` (EditorLayout flips it via `setEditable` when
        // the partner holds the pen — [EditorLayout.tsx:946]). When read-only the
        // bridge no-ops entirely: no card registration, no soft-route, no popover
        // open. (The synchronous `\cite`/`\footnote` ATOM the PM caller inserts
        // before this call is ALSO suppressed at its own editability check — see
        // commands.ts / citation.ts / footnote.ts — and would be rejected by the
        // `readOnlyEnforcer` regardless.) No over-gating: a non-collab editor is
        // always editable, so this is inert outside collaborator read-only.
        if (!ed.isEditable) return;
        const deps = bridgeDepsRef.current;
        // Synthesize a `CursorRef` from the editor's current selection head
        // for the collapsed-caret surfaces (slash / typed). `paragraphUuidAt`
        // walks ancestors up from the caret for the containing block's uuid
        // (Mode-A anchor); "" when the caret isn't inside an anchorable block.
        const pos = ed.state.selection.head;
        const ref: CursorRef = {
          kind: "cursor",
          pos,
          paragraphId: paragraphUuidAt(ed.state.doc, pos) ?? "",
        };
        const ctx: ActionContext = {
          editor: ed,
          view: ed.view,
          ref,
          surface: seed.surface,
          position: seed.position,
          // CHIP 7b: thread the collab gate into the ctx too (the early-return
          // above already short-circuits, so this is `true` whenever we reach
          // here — but it keeps the `run()` guards' invariant honest).
          canEdit: ed.isEditable,
          cardCreation: deps.cardCreation,
          cardLifecycle: deps.cardLifecycle,
          dispatch: deps.dispatch,
          payload: seed.payload,
          // The SHARED inline-atom create-popover seam (citation + `\ref`). Both
          // `citationRun` and `refRun` call this to open the deferred create
          // popover. We compute the caret rect AND capture the insertion `pos`
          // (`opts.pos` for grab/lightning passage-end; else the live caret) at
          // TRIGGER time, then hop the `virgil-atom-create-popover` event
          // EditorLayout consumes into `atomCreateRequest`. The captured `pos` is
          // the `insertInlineAtom` `at` the commit lands the atom at — robust to
          // selection drift while the modal-ish popover is open.
          openAtomCreate: (kind, opts) => {
            if (typeof window === "undefined") return;
            const pos = opts?.pos ?? ed.state.selection.from;
            const coords = ed.view.coordsAtPos(pos);
            const rect = new DOMRect(
              coords.left,
              coords.top,
              0,
              coords.bottom - coords.top,
            );
            // Carry the OWNING editor (`ed` — the one whose pos-space `pos`/`rect`
            // we just captured) into the event detail, so the commit inserts the
            // atom back into THIS editor and never mis-targets MAIN. Mirrors the
            // math/figure click bridges threading `activeMath.editor` /
            // `activeFigure.editor` (CHIP 5). Here `ed` is the registry bridge's
            // MAIN editor; the lightning/footnote surface threads its own editor
            // from ActionsMenuPanel below.
            window.dispatchEvent(
              new CustomEvent(ATOM_CREATE_POPOVER_EVENT, {
                detail: { kind, rect, pos, refCommand: opts?.refCommand, editor: ed },
              }),
            );
          },
          // Panel-routing wiring the citation soft-route (CHIP 4a-ii) reads to
          // surface OMNI only when the citations side is collapsed/blank, and
          // to drop focus into the new card's library-picker. `focusCard` just
          // forwards the registry-built float key to `focusNewCard`.
          panelRouting: {
            prefs: deps.routingPrefs,
            setActiveLeft: deps.setActiveLeft,
            setActiveRight: deps.setActiveRight,
            focusCard: focusNewCard,
            // Backlog #2 soft-route reveal: un-collapse / un-blank the panel's
            // docked side so the new card is visible in the always-on omni
            // background (`setActiveX("omni")` is a no-op in the band-stack
            // model — omni is never an "active panel").
            expandLeft: deps.expandLeft,
            expandRight: deps.expandRight,
            clearBlankIfSet: deps.clearBlankIfSet,
            // CHIP 5c: the example soft-select. `exampleRun` calls this with the
            // new block's uuid so an ALREADY-open Examples panel scrolls to it
            // (backlog #2 — never force-opens). Maps to the Examples panel's
            // `selectedExampleId` state.
            selectExample: deps.setSelectedExampleId,
          },
        };
        // Task 061: the PM-land surfaces (slash / typed) must honor the SAME
        // per-kind applicability the menus consult — the bridge is where the
        // gesture ref (the `CursorRef` synthesized above) meets the registry. A
        // `"disabled"` verdict (e.g. `/cite` with the caret in a `titleField`,
        // or `/footnote` in a non-prose block) no-ops the whole action: no card
        // registration, no popover open, no soft-route — matching the grab-bar
        // grey-out. `applies()` resolves the caret's containing block kind for
        // cursor refs (`cardActionAllowedForCtx`), the cross-surface enforcement
        // point. Non-card actions (ref / example / wrappers) return "ok" for a
        // caret, so they're unaffected.
        if (spec.applies(ctx) === "disabled") return;
        void spec.run(ctx);
      },
    };
    // Register THIS pane's handle keyed by its live `EditorView` (multi-doc
    // keep-alive renders N panes at once). Cleanup removes ONLY this editor's
    // own key, so an evicted/unmounting pane can never clobber a live one.
    registerEditorActionsHandle(editor, handle);
    return () => unregisterEditorActionsHandle(editor);
    // Intentionally depends ONLY on `editor` — the live cardCreation /
    // cardLifecycle / dispatch are read through `bridgeDepsRef` (not closed
    // over), and the editor itself is re-read via `innerRef` at call time, so
    // the handle stays stable across renders and re-publishes solely on a
    // mount / editor-swap / unmount. (No exhaustive-deps suppression needed —
    // every other reference is module-scoped or a stable ref.)
  }, [editor]);

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

  // Phase D — durable per-doc scroll memory. The warm mount preserves scroll for
  // the last N docs; this makes a COLD mount (LRU-evicted or post-reload) restore
  // to the same offset, so the cold path matches the warm one. Owned entirely by
  // the per-doc layer (useEditorUIState → editor-state.json); view-mode stays
  // app-wide per the v1 choice. Runs after the cursor-restore effect above (which
  // scrolls to the last paragraph), so the exact saved offset wins; the capture
  // listener persists scroll changes (debounced). A hidden/warm pane emits no
  // scroll events (display:none), so this is inert while warm.
  useEffect(() => {
    const el = rowScrollRef.current;
    if (!el || !uiStateHook.loaded) return;
    if (!scrollRestoredRef.current) {
      scrollRestoredRef.current = true;
      const saved = uiStateHook.stateRef.current.scrollTop;
      if (saved != null && saved > 0) {
        // The cursor-restore effect above scrolls the last-edit paragraph into
        // view (incl. a deferred focus-scroll). To make the COLD mount match the
        // WARM mount (exact scroll), re-assert the saved offset across the next
        // couple of frames + a short timeout so it wins past the focus-scroll.
        const apply = () => {
          if (rowScrollRef.current) rowScrollRef.current.scrollTop = saved;
        };
        requestAnimationFrame(() => {
          apply();
          requestAnimationFrame(apply);
        });
        const t = setTimeout(apply, 90);
        // best-effort; cleared if the pane unmounts before it fires
        cancelScrollRestoreRef.current = () => clearTimeout(t);
      }
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      // NEVER read scrollTop while hidden: a display:none container reports 0,
      // which would corrupt both liveScrollRef and the persisted value to 0
      // (sending the doc to the top on the next show / cold mount).
      if (!isVisibleRef.current || el.offsetHeight === 0) return;
      liveScrollRef.current = el.scrollTop;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (rowScrollRef.current && isVisibleRef.current) {
          uiStateHook.writeScroll(rowScrollRef.current.scrollTop);
        }
      }, 400);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (timer) clearTimeout(timer);
      cancelScrollRestoreRef.current?.();
      el.removeEventListener("scroll", onScroll);
    };
  }, [uiStateHook.loaded, uiStateHook.stateRef, uiStateHook.writeScroll]);

  // Phase D (the warm-switch fix) — restore scroll on a WARM re-show. Switching
  // papers is a display:none→flex flip on a kept-alive pane. Most browsers keep
  // a scroll container's offset across that toggle, but some (PWA/embedded
  // engines) clamp it to 0 — and any re-show measurement/focus can nudge it too.
  // So when this pane becomes visible again, authoritatively re-assert the last
  // offset captured while it was visible (liveScrollRef), across a couple of
  // frames + a short timeout to win past a focus-scroll. No-op the first time
  // (liveScrollRef null → the cold-mount disk restore above owns it).
  useEffect(() => {
    const becameVisible = isVisible && !wasVisibleRef.current;
    wasVisibleRef.current = isVisible;
    if (!becameVisible) return;
    const saved = liveScrollRef.current;
    if (saved == null || saved <= 0) return;
    const apply = () => {
      const el = rowScrollRef.current;
      if (el && el.offsetHeight > 0) el.scrollTop = saved;
    };
    requestAnimationFrame(() => {
      apply();
      requestAnimationFrame(apply);
    });
    const t = setTimeout(apply, 90);
    return () => clearTimeout(t);
  }, [isVisible]);

  // ── In-text margin-edit mode ────────────────────────────────────
  // Entered from ViewMenu → "Margins…". While active, four guides
  // render over the editor column (L/R vertical, T/B horizontal);
  // dragging them updates `liveMargins`, which the editor reads via
  // `--editor-pl/pr/pt/pb` CSS vars on the column wrapper. Save
  // commits to viewPrefs; Cancel/Escape restores the captured
  // snapshot. Both surfaces pass `viewPrefs` now (the Reader via the
  // ephemeral `useReaderViewPrefs()`), so margin edit is live in the
  // Reader too (session-only). State machine lives in `useMarginEdit`.
  //
  // When the Code pane is open and SplitWithCode signals `compressed`
  // (the editor is narrower than its natural width — the common case at
  // typical split ratios), cap the horizontal gutters at a COMFORTABLE
  // code-view value (CODE_VIEW_GUTTER_PX = 48) instead of letting the prose
  // jam against the pane edge. This is the "appropriate left padding in code
  // view" that the old bare 16px floor denied — the editor reads as a clean
  // document column, not a squeezed strip. `compressed` is only ever set while
  // the code pane is open (SplitWithCode: `compressed: open && …`), so this
  // cap exclusively governs code view. Vertical margins are unaffected —
  // compression is a horizontal squeeze; stomping vertical prefs would be
  // gratuitous.
  //
  // Read the split signal FIRST: `marginaliaLaneReserved` (below) needs
  // `compressX` to opt the marker lane OUT in compressed code-split.
  // `useCodePaneSplit()` is a `useContext` read — keystroke-free, and it
  // changes only when the code pane opens/closes or crosses its
  // compressed threshold, never per keystroke.
  const codeSplit = useCodePaneSplit();
  const compressX = codeSplit.compressed;
  // Marginalia lane reservation (backlog #8): the right/left margin min-floor
  // that keeps the marker grid from colliding with the scrollbar / bolt /
  // text applies ONLY when the marginalia margins are actually rendered. That
  // is true in the editor when the Marginalia toggle is on AND not in zen
  // reading; it is FALSE in the read-only Library Reader (no `menuBar`) and in
  // zen, both of which hide the markers and must keep full margin freedom
  // (memo §4.1). Gating here, not unconditionally, avoids forcing wasted
  // margins in those reading modes.
  //
  // COMPRESSED CODE-SPLIT exclusion: when the code pane is open and the editor
  // is compressed, the 48px comfort cap WINS — the lane is NOT reserved, so the
  // marker floor never fights the user's deliberate compression-for-code. This
  // mirrors the `!zenMode` term exactly: an intentionally-narrow reading mode
  // where markers gracefully degrade (non-reserved, same as zen / the Library
  // reader) rather than eating ~150px+ of prose width. The normal (non-code-
  // split) editor keeps the floor untouched.
  const marginaliaLaneReserved =
    !!menuBar &&
    menuBar.showMarginalia !== false &&
    !viewPrefs?.zenMode &&
    !compressX;
  const {
    marginEditMode,
    effective: effectiveMargins,
    symmetricX: marginSymmetricX,
    symmetricY: marginSymmetricY,
    enter: enterMarginEditMode,
    save: saveMarginEdit,
    cancel: cancelMarginEdit,
    beginDrag: beginMarginDrag,
  } = useMarginEdit({ viewPrefs, marginaliaLaneReserved });
  // Right-margin geometry min-floor (backlog #8) vs. the compressed code-view
  // comfort cap, resolved by the shared pure `resolveHorizontalMargin`:
  //   - compressed code-split caps the margin at CODE_VIEW_GUTTER_PX (48);
  //   - when the marker lane is reserved the margin is floored at the lane
  //     minimum so the grid never collides with the scrollbar / bolt / text.
  // In compressed code-split the lane is NOT reserved (see
  // `marginaliaLaneReserved` above — `!compressX`), so the comfort cap WINS and
  // the floor is a pass-through; reading modes that hide markers (zen / Reader)
  // likewise keep the lower cap. The floor `Math.max` only bites in the normal
  // markers-on editor (where `compressX` is false).
  const effectiveLeftMargin = resolveHorizontalMargin(effectiveMargins.left, {
    compress: compressX,
    laneReserved: marginaliaLaneReserved,
    floor: MARGINALIA_MIN_MARGIN_LEFT,
  });
  const effectiveRightMargin = resolveHorizontalMargin(effectiveMargins.right, {
    compress: compressX,
    laneReserved: marginaliaLaneReserved,
    floor: MARGINALIA_MIN_MARGIN_RIGHT,
  });
  const effectiveTopMargin = effectiveMargins.top;
  const effectiveBottomMargin = effectiveMargins.bottom;

  // ── In-card chrome header geometry ────────────────────────────────
  // The chrome strip (section breadcrumb + docked MenuBar) renders as a
  // header band INSIDE the white card. `showChromeHeader` gates both the
  // strip render and the `--pod-header-h` budget so the pod reserves the
  // band's height iff the band is actually drawn. `POD_TOP_PX` mirrors
  // the 8px `--pod-cap-inner` (the bottom outer gap) numerically so
  // `--chrome-top` can be emitted as plain px (chrome-scroll-margin.ts
  // parses it directly, unlike the old non-reducing calc()).
  const POD_HEADER_H = 26; // in-card chrome header band height (px)
  const POD_TOP_PX = 8; // card top-edge gap; mirrors --pod-cap-inner
  const showChromeHeader = ready && !!viewPrefs && !!(overrideEditor ?? editor);
  const podHeaderH = showChromeHeader ? POD_HEADER_H : 0;
  const chromeTopPx = POD_TOP_PX + podHeaderH;

  // ─── Toolbar action handlers ──────────────────────────────────────
  // Each creates a card in its corresponding panel — selection-anchored
  // when text is selected, blank otherwise. These are the LIVE toolbar
  // handlers (R20): selection-create routes through `useCardCreation`
  // here, and `popCardAtAnchor` spawns the real floating popup. The old
  // EditorLayout `useSelectionToCardActions` copies were dead and are gone.

  const readSelection = useCallback(() => {
    const ed = innerRef.current?.getEditor();
    if (!ed || !innerRef.current) return null;
    const { from, to } = ed.state.selection;
    if (from === to) return null;
    const text = ed.state.doc.textBetween(from, to, " ").trim();
    if (!text) return null;
    return { ed, from, to, text, editorHandle: innerRef.current };
  }, []);

  // Mode-A paragraph fallback for an ATOM-ONLY selection (a citation pill /
  // `$\lambda$` / `\ref` selected alone). `readSelection()` rejects those (no
  // textContent), so a Note / Cut / Comment built from them would land
  // UNANCHORED. Resolve the containing paragraph's uuid so the card anchors
  // Mode-A rather than orphaning. Returns null for a genuinely-empty / no
  // selection (atoms count as content — mirrors the archive fix).
  const atomOnlySelectionParagraphId = useCallback((): string | null => {
    const ed = innerRef.current?.getEditor();
    if (!ed || !innerRef.current) return null;
    const { from, to } = ed.state.selection;
    if (from < to && ed.state.doc.slice(from, to).content.size > 0) {
      return innerRef.current.ensureParagraphUuid(from);
    }
    return null;
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
    // Atom-only selection (sel === null but a real atom is selected): anchor the
    // comment Mode-A to its paragraph so it isn't orphaned. Text comments keep
    // their existing Mode-B anchor (paragraphId null) unchanged.
    const paragraphId = sel ? null : atomOnlySelectionParagraphId();
    const created = revisionsHook.addComment(paragraphId, undefined, anchor);
    if (anchorId) {
      const ed = innerRef.current?.getEditor();
      if (ed) updateLinkedAnchorCard(ed, anchorId, "revision-comment", created.id);
    }
    popCardAtAnchor("revision-comment", created.id, anchorRect);
  }, [readSelection, revisionsHook, popCardAtAnchor]);

  const handleToolbarAddNote = useCallback((anchorRect: DOMRect | null) => {
    const sel = readSelection();
    let anchor: { anchorId: string; anchorText: string } | undefined;
    let paragraphId: string | null = null;
    if (sel) {
      paragraphId = sel.editorHandle.ensureParagraphUuid(sel.from);
      const record = createLinkedAnchor(sel.ed, "note");
      if (record) anchor = { anchorId: record.anchorId, anchorText: record.text };
    } else {
      // Atom-only selection: no text for a Mode-B mark, but anchor Mode-A.
      paragraphId = atomOnlySelectionParagraphId();
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
      { tintColor: defaultTintForLinkedAnchorKind("highlight") },
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
    } else {
      // Atom-only selection: anchor the cut Mode-A so it isn't orphaned.
      paragraphId = atomOnlySelectionParagraphId();
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
    if (result.paragraphId) {
      // FOLD A: snapshot the live paragraph at creation so the Mode-A link
      // is self-healing immediately.
      const snapshot = captureParagraphSnapshot(
        innerRef.current.getEditor(),
        result.paragraphId,
      );
      archiveHook.addParagraphId(
        snippet.id,
        result.paragraphId,
        "paragraph",
        snapshot,
      );
    }
    popCardAtAnchor("archive", snippet.id, anchorRect);
  }, [readSelection, archiveHook, popCardAtAnchor]);

  const handleToolbarCreateFootnote = useCallback((anchorRect: DOMRect | null) => {
    cardCreation.createFootnote({ fromSelection: !!readSelection(), anchorRect });
  }, [readSelection, cardCreation]);

  const handleToolbarInsertCitation = useCallback((anchorRect: DOMRect | null) => {
    cardCreation.createCitation({ anchorRect });
  }, [cardCreation]);

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

  // SearchHost state — `searchState` survives panel close/reopen.
  // `openItemInPanel` swaps to the target panel and reuses the
  // side-aware setter so cross-panel jumps land where the user has
  // placed the destination.
  const [searchState, setSearchState] = useState<SearchPanelState>(INITIAL_SEARCH_STATE);
  // EditorPane OWNS the search highlight: SearchHost (mounted below) writes it,
  // and EditorPane's own <Editor> renders it (see `effectiveHighlightRange`).
  // Previously this was `void`-ed and the highlight pipe was wired to a DEAD
  // duplicate in EditorLayout that nothing wrote — so a result click never
  // highlighted (SR-F3-01/F8-01). The state now lives where the producer and
  // the renderer both are.
  const [searchHighlightRange, setSearchHighlightRange] = useState<{ from: number; to: number } | null>(null);

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
      // Mirror the edit into the footnotes.json sidecar. The body's source of
      // truth is the editor node (updated above) — but the sidecar `content` is
      // a mirror read by the AI-request inbox summary (and any archived/
      // unanchored ref that outlives its atom), and the editor handle never
      // touches the hook, so without this the sidecar keeps stale creation-time
      // (often empty) text. Same debounced cadence as the node update, so it
      // adds no per-keystroke work. (task_9768c44e)
      footnotesHook.updateFootnoteContent(id, newContent);
      // A blank footnote is registered "pristine" (click-away-discardable).
      // Every OTHER card kind clears that flag through its hook setter when
      // edited; footnotes never did — their edit routes through the editor
      // handle, not the hook — so a typed-into footnote stayed pristine and the
      // click-away watcher reaped it. Mark dirty here once it carries real
      // content (a still-empty footnote stays discardable, as intended).
      if (cardHasContent("footnote", { content: newContent })) {
        footnotePristine.markDirty(id);
      }
    },
    [footnotesHook.updateFootnoteContent, footnotePristine],
  );
  const handleEditFootnoteTitle = useCallback((_id: string, _title: string) => {
    // Footnote titles aren't part of the EditorHandle imperative API
    // today; the panel calls this on rename but the Reader is
    // read-only. Wired as a no-op until the main app needs it.
  }, []);
  const handleDeleteFootnote = useCallback((id: string) => {
    // Arm the orphan-suppression latch BEFORE the atom is removed: the
    // footnote orphan-detector (src/lib/tiptap/footnote.ts) dispatches a
    // deferred `virgil-footnote-orphaned` on any non-empty footnote node
    // that vanishes, and `useFootnoteSyncBridges` would otherwise
    // resurrect this deliberate trash-delete as an orphan card. The
    // suppress event is consumed by the same bridge hook (in EditorLayout)
    // where `suppressOrphanRef` lives. See footnote-sync.ts.
    //
    // W2 cutover: flag-ON the legacy orphan event web is RETIRED — the bus
    // reconciler (`useInlineAtomLifecycle`) owns orphan upsert/clear off the
    // structural diff, gated on the body-content test, so a deliberate delete
    // needs no latch (the detector emission is itself short-circuited in
    // footnote.ts on the flag path). Only dispatch the latch on the legacy
    // (flag-OFF) path so the suppress producer/consumer stay in lockstep.
    if (!isInlineAtomLifecycleOn()) {
      window.dispatchEvent(
        new CustomEvent("virgil-footnote-suppress-orphan", {
          // `docId` scopes the suppress latch to THIS doc's per-pane bridge so
          // a deliberate delete in doc A can't swallow a coincidental same-id
          // orphan event in doc B under multi-doc keep-alive (FN-A2-03).
          detail: { footnoteId: id, docId },
        }),
      );
    }
    innerRef.current?.deleteFootnote(id);
  }, [docId]);

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
  // Panel docking is driven entirely by `viewPrefs.prefs.dockStack` — the
  // canonical SSOT both the main app and the Reader render from (PaneRail lays
  // out the docked bands straight off it, and strip clicks toggle it through
  // `viewPrefs`). The legacy per-side `activeLeftPanelKind`/`activeRightPanelKind`
  // useState model was retired here: nothing wrote it on the canonical
  // strip-click path, so it only ever read stale. Cross-panel jumps dock via
  // `openPanelDocked` (see `openItemInPanel` below).

  // SR-F8-02: clear the search highlight when the search panel is no longer
  // visible, owned WHERE the producer is (EditorPane). "Visible" = the search
  // panel is actually OPEN — docked in either side's stack or popped out as a
  // float — read from the live `dockStack`/`poppedOutPanels` SSOT. (The old
  // check keyed off the strip whitelist + the retired `activeLeftPanelKind`
  // model: the whitelist only says the icon is available, not that the panel
  // is open, so the highlight never cleared when search actually closed.)
  const searchPanelOpen = viewPrefs
    ? dockedSideOf(viewPrefs.prefs, "search") !== null ||
      viewPrefs.prefs.poppedOutPanels.includes("search")
    : false;
  useEffect(() => {
    if (!searchPanelOpen) setSearchHighlightRange(null);
  }, [searchPanelOpen]);

  // The range fed to the editor's highlight overlay. EditorPane now owns BOTH
  // the search range and the error range locally (`useDiagnostics` supplies
  // `errorHighlightRange`; search still originates in `SearchHost` here). Search
  // wins — a search highlight is an explicit user action; the error range is
  // derived from selection.
  const effectiveHighlightRange = searchHighlightRange ?? errorHighlightRange;

  // SearchHost cross-panel jump — select the target item AND dock its panel
  // into the live `dockStack` so the jump actually surfaces it. Caller supplies
  // a PanelId (broader than PanelKind: includes shell-only ids like
  // `omni`/`search`); we fan out to the matching per-kind selection setter for
  // the ids we recognize, then open the panel via `viewPrefs.openPanelDocked`.
  //
  // This is the ONE shared jump for both the main app and the Reader (the
  // duplicate that used to live in EditorLayout is gone). It previously only
  // set the retired `activeLeftPanelKind` model — which PaneRail never renders
  // from — so the panel never actually opened.
  const openItemInPanel = useCallback(
    (panel: PanelId, itemId: string) => {
      // Select the target on the panel's native selection slot.
      if (panel === "notes") setSelectedNoteId(itemId);
      else if (panel === "footnotes") setSelectedFootnoteId(itemId);
      else if (panel === "citations") setSelectedCitationId(itemId);
      else if (panel === "todo") setSelectedTodoId(itemId);
      else if (panel === "archive") setSelectedArchiveId(itemId);
      else if (panel === "cutter") setSelectedCutterCardId(itemId);
      else if (panel === "revisions") setSelectedCommentId(itemId);
      else if (panel === "bibliography") setSelectedBibKey(itemId);
      else if (panel === "examples") setSelectedExampleId(itemId);

      // Dock the destination via the live `dockStack`. `viewPrefs` is always
      // present on the canonical render path (PaneRail early-returns without
      // it); the guard covers the permissive prop type. `planJumpDocks` resolves
      // the target's side and re-docks search alongside it only when they share
      // a side (Reader-safe: search is never docked there). See jump-docks.ts.
      if (!viewPrefs) return;
      for (const op of planJumpDocks(viewPrefs.prefs, panel)) {
        viewPrefs.openPanelDocked(op.id, op.side);
      }
    },
    [viewPrefs],
  );

  // Side derivations — which side each panel is currently DOCKED on. Hosts
  // use these to align cross-panel highlight sync (e.g. citations panel ↔
  // bibliography panel). Read from the live `dockStack` (the canonical
  // strip-click target) via `dockedSideOf` — the single SSOT now that the
  // legacy per-side active-kind model is gone. Null-safe when a caller omits
  // `viewPrefs` (no panel is docked → null).
  const dockedSide = useCallback(
    (kind: PanelKind): "left" | "right" | null =>
      viewPrefs ? dockedSideOf(viewPrefs.prefs, kind as PanelId) : null,
    [viewPrefs],
  );
  const notesPanelSide = dockedSide("notes");
  const bibliographyPanelSide = dockedSide("bibliography");
  const todoPanelSide = dockedSide("todo");
  const cutterPanelSide = dockedSide("cutter");
  const reportsPanelSide = dockedSide("reports");
  const revisionsPanelSide = dockedSide("revisions");

  // ── Per-doc popped-card render bag ───────────────────────────────
  // Constructed once over the underlying hook slices so a fresh
  // `renderPoppedCard` mount doesn't see new prop identities each
  // frame. Both surfaces pass `viewPrefs` now (the Reader via the
  // ephemeral `useReaderViewPrefs()`), so the popout mount below is
  // live in each; the bag is built unconditionally for simpler
  // memoization and to keep `useMemo` deps stable.
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
      // note ⇄ highlight kind-chevron (R14, bidirectional via the morph
      // chokepoint — replaces the one-way addNoteForHighlight "+ note" path).
      convertNotesCard,
      // Route through cardCreation: deleting a highlight strips the in-doc tint.
      deleteNote: cardCreation.deleteHighlightOrNote,

      // Footnotes
      handleEditFootnote,
      handleDeleteFootnote,
      handleEditFootnoteTitle,
      footnoteAiRequests,
      setFootnoteAiRequest: footnotesHook.setFootnoteAiRequest,

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
      convertCutterCard,
      deleteCutterCard: cutterHook.deleteCard,

      // Reports
      updateReportContent: reportsHook.updateReportContent,
      updateReportTitle: reportsHook.updateReportTitle,
      updateRequestContent: reportsHook.updateRequestContent,
      setRequestAiRequest: reportsHook.setRequestAiRequest,
      convertReportCard,
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
      replaceBibEntry: citationsHook.replaceBibEntry,
      updateBibKeyAndType: citationsHook.updateBibKeyAndType,
      addBibEntry: citationsHook.addBibEntry,

      // Citations
      updateCitation: citationsHook.updateCitation,
      deleteCitation: handleDeleteCitation,

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
      notesHook, footnoteInfos, footnoteAiRequests, archiveHook, cutterHook, todosHook,
      citationsHook, annotationsHook, bibReviewHook, revisionsHook,
      reportsHook,
      aiRequestsHook,
      citationPositionMap, allEditorCitations, examples, anchoredArchiveIds,
      selectedNoteId, selectedFootnoteId, selectedArchiveId,
      selectedCutterCardId, selectedReportCardId, selectedTodoId, selectedBibKey,
      selectedCitationId, selectedCommentId,
      selectedExampleId,
      handleCitationCreated, handleEditFootnote, handleDeleteFootnote,
      handleDeleteCitation,
      handleEditFootnoteTitle, handleArchiveDelete,
      convertCutterCard, convertReportCard, convertNotesCard,
    ],
  );

  // FloatingPanel fires `virgil-stack-drop` with { cardKey, clientX,
  // clientY } when a popped-out float is released over the StackIcon.
  // Snapshot via the appropriate path (paragraph / heading via the
  // text-object helpers; card via the Floatable's own snapshotForStack),
  // then close the float. Non-stackable kinds return null and are skipped.
  // Declared here (after `popoutsDeps`) so the CARD branch can hand that bag
  // to `toFloatable` without a TDZ on the dep array.
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
      const parsed = parseAnyKey(cardKey);
      if (!parsed) return;
      const id = parsed.id;
      const source = { docId: stackSourceRef.current.docId };
      let item: StackItemType | null = null;
      if (parsed.domain === "textobject" && isTextObjectKind(parsed.kind)) {
        // Mirror the CARD branch (parity, BUG #48): build the SAME `Floatable`
        // the text-object popout renders from and ask it to serialize itself.
        // `snapshotForStack` is the single capture entry point now —
        // `snapshotTextObject` dispatches by kind (paragraph / heading /
        // block / list-item / range) inside the snapshot SSOT, so EditorPane
        // no longer carries a per-kind branch. A one-shot doc read on the drop
        // gesture, never keystroke-proportional. Returns null when the source
        // can't be resolved (deleted) or the kind isn't poppable.
        const f = textObjectFloatable({ kind: parsed.kind, id }, innerRef);
        item = f?.snapshotForStack(source) ?? null;
      } else if (parsed.domain === "card" && isCardKind(parsed.kind)) {
        // Mirror `FloatHost.resolveFloatable`: build the same `Floatable` the
        // popout renders from and ask it to serialize itself. Some builders
        // (footnote) do a one-shot doc read here on the drop gesture, but
        // `snapshotForStack` itself is a pure closure over the resolved record
        // — never keystroke-proportional. Returns null for non-stackable kinds
        // (report / ai / example).
        const f = CARD_REGISTRY[parsed.kind].toFloatable(id, popoutsDeps);
        item = f?.snapshotForStack(source) ?? null;
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
  }, [innerRef, viewPrefs, popoutsDeps]);

  // ── Bubble per-doc state up to the shell ────────────────────────
  // Step 7.1 (Path A): emit a synthesized `PaneState` so EditorLayout's
  // Virgil bar can read the active doc's editor + AI state. Most
  // fields are real (editor / aiRequests / aiDot / pdfView / codeView).
  // The compile/PDF/style-merge fields are stubs for now — Step 7.2
  // moves `useDocumentStyle` (for `addStyleMergeRequest`) and the
  // revisions hook into EditorPane and replaces the remaining stubs.
  // The Reader doesn't pass `onPaneStateChange`; the call short-circuits.
  //
  // Phase 5e: gate the bubble on readiness + visibility. On a warm switch the
  // newly-active doc's per-doc slices (compile/AI/sidecar hooks) settle over
  // several renders; an ungated bubble fires once per settle, each firing a
  // `setPaneStateByDocId` → an EditorLayout render → the render multiplier.
  // Suppressing the pre-ready settling burst (NOT with a timer — `isVisible`,
  // `editor`, and the existing `allCardSidecarsLoaded` readiness predicate)
  // collapses it to the settled emissions. This adds NO per-keystroke work:
  // the effect's deps are structural slices (not keystroke-driven), and an
  // inactive/hidden pane (`!isVisible`) simply doesn't emit. Once ready the
  // effect still fires on every genuine post-ready change.
  useEffect(() => {
    // Hold the bubble on a sidecar LOAD ERROR (corrupt JSON / FSA glitch):
    // `allCardSidecarsLoaded` flips true even on error (the read terminated),
    // but the collections are non-authoritative. Mirror the load-reconcile and
    // linked-anchor reaper, which both gate on `!anyCardSidecarLoadError` to
    // avoid acting on a failed load. Without this the bubble would push
    // empty/stale collections to EditorLayout until a manual reload.
    if (
      !onPaneStateChange ||
      !isVisible ||
      !editor ||
      !allCardSidecarsLoaded ||
      anyCardSidecarLoadError
    )
      return;
    onPaneStateChange({
      editor,
      editorRef: innerRef,
      aiRequests: aiRequestsHook.requests,
      addStyleMergeRequest: aiRequestsHook.addStyleMergeRequest,
      compilePdf: compileHook.compile,
      isCompiling: compileHook.isCompiling,
      compileErrors: compileHook.compileErrors,
      compileLog: compileHook.lastLog,
      compileStatus: compileHook.lastStatus,
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
      searchHighlightRange,
      currentSuggestion: suggestionsHook.currentSuggestion,
      revisions: revisionsHook.cards,
      notes: notesHook.notes,
      cutterCards: cutterHook.cards,
      todoItems: todosHook.items,
      archiveSnippets: archiveHook.snippets,
      deleteArchiveSnippet: archiveHook.deleteSnippet,
      addRequest: aiRequestsHook.addRequest,
      updateRequestText: aiRequestsHook.updateRequestText,
      deleteRequest: aiRequestsHook.deleteRequest,
      saveWithDelimiters: docHook.saveWithDelimiters,
      latexErrors: allLatexErrors,
      selectedErrorId,
      setSelectedErrorId,
      dismissedErrorIds,
      dismissError,
      expandedErrorIds,
      expandError,
      toggleErrorExpanded,
      errorSnippets,
      paragraphByErrorId,
      jumpToErrorVisual,
      setSourceText,
    });
  }, [
    onPaneStateChange,
    isVisible,
    allCardSidecarsLoaded,
    anyCardSidecarLoadError,
    editor,
    searchHighlightRange,
    aiRequestsHook.requests,
    bibReviewHook.requests,
    bibSettingsHook.entryRequests,
    revisionsHook.cards,
    compileHook.compile,
    compileHook.isCompiling,
    compileHook.compileErrors,
    compileHook.lastLog,
    compileHook.lastStatus,
    pdfStale,
    pdfBlobUrl,
    pdfView,
    codeView,
    onTogglePdfView,
    onToggleCodeView,
    collab,
    citationsHook,
    suggestionsHook.currentSuggestion,
    notesHook.notes,
    cutterHook.cards,
    todosHook.items,
    archiveHook.snippets,
    archiveHook.deleteSnippet,
    aiRequestsHook.addRequest,
    aiRequestsHook.updateRequestText,
    aiRequestsHook.deleteRequest,
    docHook.saveWithDelimiters,
    allLatexErrors,
    selectedErrorId,
    setSelectedErrorId,
    dismissedErrorIds,
    dismissError,
    expandedErrorIds,
    expandError,
    toggleErrorExpanded,
    errorSnippets,
    paragraphByErrorId,
    jumpToErrorVisual,
    setSourceText,
  ]);

  // ── Anchored-card hover/selection bridges + highlight painters ────
  // The whole all-for-one model lives here so reader and editor share
  // identical plumbing (the Library reader mounts EditorPane standalone).
  const _setHoveredEntity = useCallback(
    (id: string | null, kind: EntityKind | null) =>
      cardStoreInst.setHover(id && kind ? { id, kind } : null),
    [cardStoreInst],
  );

  useAnchorHighlightReconciler({
    editor,
    store: cardStoreInst,
    // The inline-atom structural counter (footnotes + citations) so the
    // dangling-ref prune re-runs when an inline atom is added/removed — the
    // inline kinds never change `collections` (they aren't in it). T2 §3b.2.
    atomRevision: rev.footnotes + rev.citations,
    collections: {
      notes: notesHook.notes,
      cutterCards: cutterHook.cards,
      archiveSnippets: archiveHook.snippets,
      todoItems: todosHook.items,
      comments: revisionsHook.cards,
      reportCards: reportsHook.cards,
      // EntityCollectionSlots reads `exampleId ?? id`, so ExampleInfo[] (which
      // keys on `exampleId`) resolves directly — no boundary adapter.
      examples,
    },
  });

  useLinkedAnchorReconciler({
    editor,
    // DATA-LOSS gate (see the hook's `ready` JSDoc): the synchronous orphan
    // sweep must not run until every sidecar has loaded AND the doc content is
    // in the editor — otherwise the alive-set is incomplete and the sweep reaps
    // live annotations on doc-open. SAME gate as the load-reconcile pass above.
    // `!anyCardSidecarLoadError` extends the gate: if any sidecar read THREW it
    // loaded as the empty default, so its anchors are missing from the alive-set
    // — forcing `ready:false` keeps the reaper holding until a clean reload, the
    // EditorPane-level mirror of the reaper stand-down in that reconcile pass.
    ready:       allCardSidecarsLoaded && docContentReady && !anyCardSidecarLoadError,
    notes:       notesHook.notes,
    highlights:  notesHook.highlights,
    cutterCards: cutterHook.cards,
    comments:    revisionsHook.cards,
    reportCards: reportsHook.cards,
    todos:       todosHook.items,
  });

  // ── Open-AI-request text highlight (task 021) ──────────────────────────────
  // Persist the light-blue `pending-ai-request` wash over the anchored text of
  // every open request (a Mode-A card whose `aiRequest` flag is set), and light
  // it on hover/select through the reconciler above (`requestHighlightLink`).
  // ONE idempotent reconcile (`reconcileRequestMarks`) is the mark's sole
  // lifecycle owner — it serves flag-on, flag-off, delete, AND reload
  // (the serializer strips the mark, so the reactive reconcile re-stamps it once
  // the sidecars load). The reconcile is DESTRUCTIVE (strips stale marks), so it
  // rides the SAME load-order DATA-LOSS gate as the orphan reaper.
  const requestMarkCards = useMemo<RequestMarkCardLike[]>(() => {
    // Only the paragraph-anchored margin kinds carry an `aiRequest` flag; the
    // reconcile filters to the Mode-A subset. Highlights are Mode-B (their own
    // span mark) — excluded to avoid clobbering it.
    const all = [
      ...notesHook.notes,
      ...todosHook.items,
      ...revisionsHook.cards,
      ...reportsHook.cards,
      ...cutterHook.cards,
    ] as RequestMarkCardLike[];
    return all.filter((c) => c.aiRequest === true);
  }, [
    notesHook.notes,
    todosHook.items,
    revisionsHook.cards,
    reportsHook.cards,
    cutterHook.cards,
  ]);
  // Keystroke-sanctity key: the reconcile must fire only when the DESIRED mark
  // set changes — the Mode-A request cards' ids + their anchor paragraphs — not
  // on every unrelated card edit (or ever on a keystroke: typing changes neither
  // the card set nor its anchors). Read the live cards through a ref so the
  // effect body isn't in the dep list.
  const requestMarkKey = useMemo(
    () =>
      requestMarkCards
        .filter(isModeARequestCard)
        .map((c) => `${c.id}@${getLinkedTextObjectIds(c)[0] ?? ""}`)
        .sort()
        .join("|"),
    [requestMarkCards],
  );
  const requestMarkCardsRef = useRef(requestMarkCards);
  requestMarkCardsRef.current = requestMarkCards;
  useEffect(() => {
    if (!editor) return;
    // SAME gate as the orphan reaper — never strip against transiently-empty or
    // load-errored collections.
    if (!(allCardSidecarsLoaded && docContentReady && !anyCardSidecarLoadError)) {
      return;
    }
    reconcileRequestMarks(editor, requestMarkCardsRef.current);
    // `requestMarkKey` gates re-runs to genuine desired-set changes; the cards
    // themselves are read via the ref. `editor`/gate flips also (re)run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    editor,
    allCardSidecarsLoaded,
    docContentReady,
    anyCardSidecarLoadError,
    requestMarkKey,
  ]);

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
    store: cardStoreInst,
    collections: {
      notes: notesHook.notes,
      cutterCards: cutterHook.cards,
      comments: revisionsHook.cards,
      reportCards: reportsHook.cards,
      todoItems: todosHook.items,
      archiveSnippets: archiveHook.snippets,
      examples,
    },
  });

  // Card archive view API — shared by every CardListPanel filter + the
  // CardViewModeMenuItems in each panel's three-dot menu. Sourced from the
  // single useViewPrefs instance (via the threaded viewPrefs bundle) so the
  // filter and the menu can never drift.
  const cardArchiveViewApi = useMemo<CardArchiveViewApi>(
    () => ({
      getView: (panel) =>
        viewPrefs?.prefs.cardArchiveView[panel as PanelId] ?? "active",
      setView: (panel, mode) =>
        viewPrefs?.setCardArchiveView(panel as PanelId, mode),
      suppressAtomWarning: viewPrefs?.prefs.suppressArchiveAtomWarning ?? false,
      setSuppressAtomWarning: (v) => viewPrefs?.setSuppressArchiveAtomWarning(v),
    }),
    [
      viewPrefs?.prefs.cardArchiveView,
      viewPrefs?.prefs.suppressArchiveAtomWarning,
      viewPrefs?.setCardArchiveView,
      viewPrefs?.setSuppressArchiveAtomWarning,
    ],
  );

  // ── Per-card archive actions ────────────────────────────────────────
  // (`archivedIds` / `archivedIdsRef` are defined earlier, before the
  // marginalia builder, since the marker filter reads them.)
  //
  // Route a flag flip to the owning panel's hook (the registry panel is the
  // SSOT — no hand-kept kind list).
  const setArchivedForKind = useCallback(
    (kind: CardKind, id: string, next: boolean) => {
      switch (panelForCardKind(kind)) {
        case "notes": notesHook.setArchived(id, next); break;
        case "todo": todosHook.setArchived(id, next); break;
        case "reports": reportsHook.setArchived(id, next); break;
        case "revisions": revisionsHook.setArchived(id, next); break;
        case "cutter": cutterHook.setArchived(id, next); break;
        case "archive": archiveHook.setArchived(id, next); break;
        case "footnotes": footnotesHook.setArchived(id, next); break;
        case "citations": citationsHook.setArchived(id, next); break;
      }
    },
    [
      notesHook.setArchived,
      todosHook.setArchived,
      reportsHook.setArchived,
      revisionsHook.setArchived,
      cutterHook.setArchived,
      archiveHook.setArchived,
      footnotesHook.setArchived,
      citationsHook.setArchived,
    ],
  );

  // The resolve twin of `setArchivedForKind`. Archiving a flagged card is a
  // TERMINAL request transition, so it must funnel into the SAME resolve step as
  // answer (task 019) and delete (deleteReportCard / the atom-delete path) — the
  // missing third leg. Each flag-bearing kind's bridge-clearing setter lowers the
  // card's `aiRequest` flag (the `list_unbridged_card_flags` leg) AND drops the
  // open `ai-requests.json` row (the `isRequestOpen` leg) in one call, so an
  // archived request surfaces on NEITHER drain leg. The bridge's `value=false`
  // path early-returns when no open linked row matches, so an unflagged card is a
  // natural no-op (no spurious terminal row). Dispatch is on the CardKind (not the
  // panel) because note vs highlight share the `notes` panel but own distinct
  // setters; kinds with no aiRequest routing (citation, the suggestion family,
  // plain report) fall through to a no-op.
  const clearAiRequestForKind = useCallback(
    (kind: CardKind, id: string) => {
      switch (kind) {
        case "note": notesHook.setNoteAiRequest(id, false); break;
        case "highlight": notesHook.setHighlightAiRequest(id, false); break;
        case "todo": todosHook.setAiRequest(id, false); break;
        case "report-request": reportsHook.setRequestAiRequest(id, false); break;
        case "revision-comment": revisionsHook.setCommentAiRequest(id, false); break;
        case "cutter-comment": cutterHook.setCommentAiRequest(id, false); break;
        case "footnote": footnotesHook.setFootnoteAiRequest(id, false); break;
      }
    },
    [
      notesHook.setNoteAiRequest,
      notesHook.setHighlightAiRequest,
      todosHook.setAiRequest,
      reportsHook.setRequestAiRequest,
      revisionsHook.setCommentAiRequest,
      cutterHook.setCommentAiRequest,
      footnotesHook.setFootnoteAiRequest,
    ],
  );

  // Archiving an atom-bearing card: splice its `\footnote`/`\cite` marker out of
  // the doc (mirrors the delete path's atom removal, incl. the footnote
  // orphan-suppress latch) and flag the sidecar ref archived. Its content is
  // kept (the ref survives `syncFromEditor` as unanchored). Unarchive does NOT
  // re-insert the atom (handled in `archiveCard`).
  const spliceAndArchiveAtom = useCallback(
    (kind: CardKind, id: string) => {
      if (kind === "footnote") {
        // Suppress the orphan that the marker removal would otherwise mint — the
        // archived ref already preserves the body (double-create otherwise). The
        // two flag paths own different orphan writers: flag-ON the bus policy
        // (consumes the archivedSuppress set), flag-OFF the legacy event web
        // (consumes the docId-scoped suppress event — see handleDeleteFootnote,
        // FN-A2-03).
        if (isInlineAtomLifecycleOn()) {
          archivedSuppressRef.current.add(id);
        } else {
          window.dispatchEvent(
            new CustomEvent("virgil-footnote-suppress-orphan", {
              detail: { footnoteId: id, docId },
            }),
          );
        }
        innerRef.current?.deleteFootnote(id);
        footnotesHook.setArchived(id, true);
      } else {
        innerRef.current?.deleteCitation(id);
        citationsHook.setArchived(id, true);
      }
      // Terminal transition: the atom is spliced out, so any pending AI request
      // on it is moot — resolve it (footnote clears its flag + drops the bridged
      // row; citation has no aiRequest routing, so this is a no-op there).
      clearAiRequestForKind(kind, id);
    },
    [
      docId,
      footnotesHook.setArchived,
      citationsHook.setArchived,
      clearAiRequestForKind,
    ],
  );

  // Pending atom-archive confirm ({kind,id} while the dialog is open).
  const [archiveConfirm, setArchiveConfirm] = useState<{
    kind: CardKind;
    id: string;
  } | null>(null);
  const [archiveDontAsk, setArchiveDontAsk] = useState(false);

  const archiveCard = useCallback(
    (kind: CardKind, id: string) => {
      const currentlyArchived = archivedIdsRef.current.has(id);
      if (archiveRemovesAtom(kind)) {
        if (currentlyArchived) {
          // Unarchive: clear the flag only — the atom is NOT re-inserted (the
          // card returns as an unanchored ref the user re-places manually).
          setArchivedForKind(kind, id, false);
          return;
        }
        if (viewPrefs?.prefs.suppressArchiveAtomWarning) {
          spliceAndArchiveAtom(kind, id);
          return;
        }
        setArchiveDontAsk(false);
        setArchiveConfirm({ kind, id });
        return;
      }
      // Non-atom kinds: a pure flag toggle (no doc mutation, no confirm).
      // Archiving (the INTO-archived transition) also resolves any pending AI
      // request on the card; unarchiving does NOT re-open it (restore stays
      // resolved — archiving is a deliberate set-aside).
      if (!currentlyArchived) clearAiRequestForKind(kind, id);
      setArchivedForKind(kind, id, !currentlyArchived);
    },
    [
      setArchivedForKind,
      clearAiRequestForKind,
      spliceAndArchiveAtom,
      viewPrefs?.prefs.suppressArchiveAtomWarning,
    ],
  );

  const cardArchiveActions = useMemo<CardArchiveActionsApi>(
    () => ({
      enabled: true,
      isArchived: (id) => archivedIdsRef.current.has(id),
      archive: archiveCard,
    }),
    [archiveCard],
  );

  return (
    // This pane's per-doc store provider. Dominates the editor text, marginalia,
    // panels, and every floating/popout portal (React context flows through
    // portals by tree position), so all three card surfaces of this doc — and no
    // other — share one interaction store. Mounted INSIDE EditorPane so it covers
    // both the main-app mount and the Library Reader mount.
    <CardStoreProvider store={cardStoreInst}>
    <DiagnosticsProvider value={diagnostics}>
    <PendingChangeControllerProvider value={pendingController}>
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
            getRefDisplayText,
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
        <CardArchiveViewProvider value={cardArchiveViewApi}>
        <CardArchiveActionsProvider value={cardArchiveActions}>
        {archiveConfirm && (
          <ConfirmDialog
            open
            title={
              archiveConfirm.kind === "footnote"
                ? "Archive footnote?"
                : "Archive citation?"
            }
            message={
              <div className="flex flex-col gap-2">
                <span>
                  Archiving this {archiveConfirm.kind} removes its marker from
                  your document. The card moves to this panel&apos;s archive —
                  you can unarchive it later, but the marker won&apos;t be
                  restored automatically.
                </span>
                <label className="flex items-center gap-2 text-ink-muted cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={archiveDontAsk}
                    onChange={(e) => setArchiveDontAsk(e.target.checked)}
                  />
                  Don&apos;t ask again
                </label>
              </div>
            }
            confirmLabel="Archive"
            onConfirm={() => {
              if (archiveDontAsk)
                viewPrefs?.setSuppressArchiveAtomWarning(true);
              spliceAndArchiveAtom(archiveConfirm.kind, archiveConfirm.id);
              setArchiveConfirm(null);
            }}
            onCancel={() => setArchiveConfirm(null)}
          />
        )}
        <PoppedCardsContext.Provider value={poppedCardsValue}>
        {/* LiftHost — shared owner of the lifted-overlay ghost gesture. Mounted
            here, inside PoppedCardsContext.Provider (and under
            EditorChromeProvider), because this is the lowest common ancestor of
            BOTH `VirgilEditor` (→ TextObjectGrabHandle, the grab-handle
            producer) AND `FloatHost` (→ FloatWindow/FloatChrome, the Chip-2
            float-button producer); both consume `host.beginLift` via
            `useLiftHost()`. usePoppedCards()/useEditorChrome() resolve here and
            the synced `editorInstanceRef` is in scope. The host renders the
            single `<LiftedTextOverlay>` (moved out of the grab handle) and
            installs NO per-keystroke subscriber — its overlay state mutates
            only during an active gesture. */}
        <LiftHost editorRef={editorInstanceRef}>
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
              // CHIP-C: a re-anchor commit persists the `.tex` immediately via
              // the SAME `useDocument` flush path the anchor-mint signal uses
              // (`docHook.flushAnchorCommit` → `flushNow` → `save` →
              // `writeDocBundle`), so the target paragraph's `%!v:<uuid>`
              // survives a reload even when no mint fired (RC3). The
              // `flushAnchorCommit` guard coalesces with any hover mint-flush so
              // a commit that also minted writes once.
              requestAnchorFlush={docHook.flushAnchorCommit}
              notes={dropNotesApi}
              highlights={dropHighlightsApi}
              todos={dropTodosApi}
              archive={dropArchiveApi}
              cutterCards={dropCutterApi}
              revisions={dropRevisionsApi}
              reports={dropReportsApi}
              citations={dropCitationsApi}
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
              `FloatWindow`. Both surfaces pass `viewPrefs` (the Reader via
              the ephemeral `useReaderViewPrefs()`), so this is live in each;
              the `!zenMode` gate lets Zen retain popout state while hiding floats. */}
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
          {/* Open panels (docked + floating) — both modes flow through
              the same FloatingPanel shell. Docked panels portal into
              the PanelColumn's dock-slot anchor; floating panels portal
              to body. The shell preserves its component instance across
              mode flips so drag-to-undock stays one continuous gesture.
              Both surfaces pass `viewPrefs` now (the Reader via the
              ephemeral `useReaderViewPrefs()`), so docked/floating panels
              render in each. */}
          {viewPrefs && (() => {
            const open: Array<{ pid: PanelId; mode: "docked" | "floating"; slotKey: DockSlotKey | null }> = [];
            const seen = new Set<PanelId>();
            // Docked bands: walk each side's ordered stack (top→bottom)
            // and portal each into its band anchor (`bandSlotKey(side, i)`).
            for (const side of ["left", "right"] as const) {
              viewPrefs.prefs.dockStack[side].forEach((pid, i) => {
                if (seen.has(pid)) return;
                seen.add(pid);
                open.push({ pid, mode: "docked", slotKey: bandSlotKey(side, i) });
              });
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
                    content={outlineContent}
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
                    unanchoredFootnotes={unanchoredFootnoteRefs}
                    onDeleteUnanchoredFootnote={footnotesHook.deleteFootnote}
                    footnoteAiRequests={footnoteAiRequests}
                    setFootnoteAiRequest={footnotesHook.setFootnoteAiRequest}
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
                    onDeleteCitation={handleDeleteCitation}
                    selectedNoteId={selectedNoteId}
                    setSelectedNoteId={setSelectedNoteId}
                    compileLog={compileHook.lastLog}
                    compileStatus={compileHook.lastStatus}
                    isCompiling={compileHook.isCompiling}
                    searchState={searchState}
                    setSearchState={setSearchState}
                    setSearchHighlightRange={setSearchHighlightRange}
                    openItemInPanel={openItemInPanel}
                    wordCountHook={wordCountHook}
                    viewPrefs={effectiveViewPrefs}
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
                      content={outlineContent}
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
                      unanchoredFootnotes={unanchoredFootnoteRefs}
                      onDeleteUnanchoredFootnote={footnotesHook.deleteFootnote}
                      footnoteAiRequests={footnoteAiRequests}
                      setFootnoteAiRequest={footnotesHook.setFootnoteAiRequest}
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
                      onDeleteCitation={handleDeleteCitation}
                      selectedNoteId={selectedNoteId}
                      setSelectedNoteId={setSelectedNoteId}
                      compileLog={compileHook.lastLog}
                      compileStatus={compileHook.lastStatus}
                      isCompiling={compileHook.isCompiling}
                      searchState={searchState}
                      setSearchState={setSearchState}
                      setSearchHighlightRange={setSearchHighlightRange}
                      openItemInPanel={openItemInPanel}
                      wordCountHook={wordCountHook}
                      viewPrefs={effectiveViewPrefs}
                    />
                  </PanelChromeProvider>
                );
              return (
                <FloatingPanel
                  key={pid}
                  panelId={pid}
                  mode={mode}
                  slotKey={slotKey}
                  fillSlot={viewPrefs.prefs.panelHeights[pid] != null}
                  initialX={initialX}
                  initialY={initialY}
                  initialWidth={initialWidth}
                  initialHeight={initialHeight}
                  zIndex={FLOATING_PANEL_Z_BASE + i}
                  onChange={(pos) => viewPrefs.setFloatPosition(pid, pos)}
                  onUndock={(rect) => viewPrefs.undockPanel(pid, rect)}
                  onMaybeRedock={(target) =>
                    viewPrefs.redockPanel(pid, target.side, target.index)
                  }
                  onFocus={() => viewPrefs.focusFloating({ kind: "panel", id: pid })}
                >
                  {mode === "docked" ? (
                    // LRU wiring: a capture-phase mousedown anywhere in a
                    // docked band bumps it to most-recent on its side so the
                    // eviction target is always the genuinely-stalest panel.
                    // Capture-phase + interaction-frequency (one bump per
                    // click) — off the keystroke path. The band side is read
                    // off the slot key (`left-…`/`right-…`).
                    <div
                      style={{ display: "contents" }}
                      onMouseDownCapture={() =>
                        viewPrefs.notePanelUse(
                          slotKey?.startsWith("left") ? "left" : "right",
                          pid,
                        )
                      }
                    >
                      {panelInner}
                    </div>
                  ) : (
                    panelInner
                  )}
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
                footnoteAiRequests={footnoteAiRequests}
                setFootnoteAiRequest={footnotesHook.setFootnoteAiRequest}
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
                onDeleteCitation={handleDeleteCitation}
                selectedNoteId={selectedNoteId}
                setSelectedNoteId={setSelectedNoteId}
                viewPrefs={effectiveViewPrefs}
                searchState={searchState}
                setSearchState={setSearchState}
                setSearchHighlightRange={setSearchHighlightRange}
                openItemInPanel={openItemInPanel}
                wordCountHook={wordCountHook}
                tail={leftMarginPrelude}
                omniBulkPendingChanges={omniBulkPendingChanges}
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
                // below 300px on narrow windows. Adds `--editor-pl` /
                // `--editor-pr` (set just below; consumed by Editor.tsx's
                // prose padding), the pod's 2px horizontal border (1px each
                // side from `--pod-border`), and any wrapper inset
                // (`--editor-wrapper-inset`, set by Reader's `.paper-render`
                // padding via library.css; 0 in Editor mode).
                // The marker-lane min-floor (backlog #8) is reserved
                // transitively: when the marginalia lane is reserved,
                // `--editor-pl/pr` are floored to MARGINALIA_MIN_MARGIN_*
                // (above), so this min-width already includes the full marker
                // lanes — no separate term needed. In compressed code-split
                // the lane is NOT reserved, so `--editor-pl/pr` collapse to the
                // 48px comfort cap and this floor follows them down — the
                // editor keeps its width instead of reserving an unused lane.
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
                // ── Pod top-chrome contract ──────────────────────
                // The chrome strip (section breadcrumb + docked
                // MenuBar) lives INSIDE the white card as a header
                // band, NOT in the manilla band above it. The old
                // `--chrome-top` conflated two concepts the in-card
                // move forces apart:
                //   --pod-top      = the card's TOP EDGE gap below the
                //                    column top. Locked to --pod-cap-
                //                    inner (8px) so the top outer gap
                //                    equals the bottom one (symmetric).
                //   --pod-header-h = the in-card chrome header height
                //                    (0 when no header renders).
                //   --chrome-top   = the CONTENT-area top (= --pod-top
                //                    + --pod-header-h, i.e. just below
                //                    the strip): what the reading mask,
                //                    margin-edit overlay, and scroll-
                //                    into-view margin all want.
                // Card-EDGE chrome (top cap, frame ring) reads
                // --pod-top; CONTENT-area chrome reads --chrome-top.
                // --chrome-top is emitted as plain px (not calc) so
                // chrome-scroll-margin.ts parses it directly.
                ['--pod-cap-inner' as string]: '8px',
                ['--pod-cap-bleed' as string]: 'calc(4px + var(--pod-gap))',
                ['--pod-cap-h' as string]:
                  'calc(var(--pod-radius) + 4px + var(--pod-gap))',
                ['--pod-top' as string]: 'var(--pod-cap-inner)',
                // Bottom outer gap. Kept EQUAL to --pod-top so the manilla
                // padding outside the pod is symmetric top/bottom. (Its own
                // var, rather than reusing --pod-top directly, so the bottom
                // gap stays independently tunable.)
                ['--pod-bottom' as string]: 'var(--pod-top)',
                ['--pod-header-h' as string]: `${podHeaderH}px`,
                ['--chrome-top' as string]: `${chromeTopPx}px`,
              }}
            >
            {/* Top outer gap — an 8px manilla band above the card's
                top edge, the exact mirror of the bottom spacer below, so
                the pod sits the same distance from the desk at top and
                bottom. In-flow (pushes the in-card header + pod down to
                the card edge); the top cap's manilla surplus paints this
                band at every scroll position. Height = --pod-top
                (= --pod-cap-inner = the 8px bottom gap). */}
            {(overrideEditor ?? editor) && (
              <div className="shrink-0" style={{ height: 'var(--pod-top)' }} />
            )}
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
                  top: 'var(--chrome-top)',
                  height: "var(--editor-pt, 40px)",
                  marginBottom: "calc(-1 * var(--editor-pt, 40px))",
                  zIndex: 15,
                  background:
                    "linear-gradient(to bottom, var(--surface) 0, var(--surface) calc(100% - 18px), transparent 100%)",
                }}
              />
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
                lateral edge (`.editor-pane-pod` is `overflow: clip`,
                clipping descendants right at the box edge — 0px lateral)
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
                visible top) at the card edge, the sticky `top` shifts
                up from the card edge by the 14px bleed
                (`--pod-top` − `--pod-cap-bleed`). That surplus manila
                lands ABOVE the card edge, in the top outer gap, so it
                blends into the manilla desk. The cap's white inner is
                now overlaid by the in-card chrome header (z-30, white,
                placed later in DOM), which extends the white edge down
                into the header band; both are `--pod-editor`, so the
                8px seam is white-on-white. The cap `top` is always
                `--pod-top − --pod-cap-bleed`, so the bottom-aligned
                white inner lands EXACTLY at `--pod-top` (= the card
                edge, symmetric with the 8px bottom gap) in BOTH the
                main editor and the Reader. With `--pod-top` = 8 and the
                bleed = 14, the cap `top` is the (correct) negative −6px;
                the surplus tail clips above the scroll top. */}
            {ready && (overrideEditor ?? editor) && (
              <div
                data-editor-pod-cap
                className="sticky z-30 shrink-0 pointer-events-none flex flex-col"
                style={{
                  top: 'calc(var(--pod-top) - var(--pod-cap-bleed))',
                  height: 'var(--pod-cap-h)',
                  // The surplus 14px (= bleed) goes ABOVE the white
                  // inner. marginTop pulls the whole cap up by that
                  // 14px so the white edge stays at its original flow
                  // position; marginBottom negates just the white inner
                  // (--pod-cap-inner) so flow is neutral and the pod
                  // isn't pushed. Net flow: -14 + 22 - 8 = 0.
                  marginTop: 'calc(-1 * var(--pod-cap-bleed))',
                  marginBottom: 'calc(-1 * var(--pod-cap-inner))',
                  marginLeft: 'calc(-1 * var(--pod-cap-bleed))',
                  marginRight: 'calc(-1 * var(--pod-cap-bleed))',
                  background: 'var(--background)',
                  borderTopLeftRadius: 'var(--pod-cap-h)',
                  borderTopRightRadius: 'var(--pod-cap-h)',
                  justifyContent: 'flex-end',
                }}
              >
                <div
                  style={{
                    height: 'var(--pod-cap-inner)',
                    marginLeft: 'var(--pod-cap-bleed)',
                    marginRight: 'var(--pod-cap-bleed)',
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
                ring's rounded corners. Top edge sits at `--pod-top`
                (= --pod-cap-inner = 8, symmetric with the bottom);
                bottom = `--pod-cap-inner` (8). The in-card chrome header
                sits just inside this top edge (at --pod-top, z-30), so
                this ring's border wraps it. z-31 sits above the caps and
                the header (z-30). */}
            {ready && (overrideEditor ?? editor) && (
              <div
                data-pod-frame
                aria-hidden
                className="pointer-events-none shrink-0"
                style={{
                  position: "sticky",
                  top: 'var(--pod-top)',
                  // Visible rectangle = viewport minus the SYMMETRIC top
                  // and bottom outer gaps (both --pod-cap-inner; --pod-top
                  // is locked to it). The card edge sits at --pod-top, NOT
                  // --chrome-top — the in-card chrome header lives BELOW
                  // this edge, inside the rectangle, so the frame wraps it.
                  height:
                    "calc(var(--scroll-viewport-h, 100vh) - var(--pod-top) - var(--pod-bottom))",
                  marginBottom:
                    "calc(-1 * (var(--scroll-viewport-h, 100vh) - var(--pod-top) - var(--pod-bottom)))",
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
            {/* ── In-card chrome header ─────────────────────────────
                The section-path breadcrumb (left) + the docked MenuBar
                (right) as ONE header row INSIDE the white card, replacing
                the old manilla tool-strip + separate lozenge layer above
                the pod. A white (var(--pod-editor)) sticky band at the
                card's top edge (top: --pod-top), z-30 — the SAME layer as
                the caps, so the frame ring's border (z-31) paints cleanly
                over its edge (the proven cap pattern). Rounded TOP corners
                (--pod-radius) so its white doesn't square off the corner
                notch; the top cap behind fills the concentric manila arc.
                In-flow with height --pod-header-h, so it naturally pushes
                the prose pod down by the header (no zero-flow margin), and
                placed AFTER the frame ring so it paints over the top cap's
                white inner. justify-between lets the breadcrumb truncate
                (min-width:0) without the old --menubar-width measurement.
                Renders only when there's a header to show (showChromeHeader
                gates --pod-header-h in lockstep); the MenuBar half renders
                only when `menuBar` is present (the Reader shows the
                breadcrumb alone). */}
            {ready && viewPrefs && (overrideEditor ?? editor) && (
              <div
                data-tool-strip="text"
                className="flex items-center justify-between shrink-0 sticky z-30 pointer-events-none"
                style={{
                  top: 'var(--pod-top)',
                  height: 'var(--pod-header-h)',
                  background: 'var(--pod-editor)',
                  borderTopLeftRadius: 'var(--pod-radius)',
                  borderTopRightRadius: 'var(--pod-radius)',
                  paddingLeft: 14,
                  paddingRight: 6,
                }}
              >
                {/* Breadcrumb (left). flex:0 1 auto + min-width:0 so it
                    truncates instead of pushing the controls off-edge. */}
                <div style={{ flex: '0 1 auto', minWidth: 0, overflow: 'hidden' }}>
                  <SectionLozenge sectionPath={viewPrefs.activeSectionPath} />
                </div>
                {/* Controls (right) — the optional `chromeHeaderTrailing`
                    adornment (Library page picker) sits just left of the docked
                    MenuBar (present only in the editor). Grouped in one
                    pointer-events-auto flex row so the picker lands immediately
                    to the left of the paragraph back/forward nav. Margin-edit
                    Save/Cancel renders in-page next to the drag guides, so
                    nothing lives here during margin edit. */}
                {(chromeHeaderTrailing || menuBar) && (
                  <div className="pointer-events-auto shrink-0 flex items-center gap-2">
                    {chromeHeaderTrailing}
                    {menuBar && (
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
                      onToggleParTitles={menuBar.onToggleParTitles}
                      showCardTitles={menuBar.showCardTitles}
                      onToggleCardTitles={menuBar.onToggleCardTitles}
                      showLatexComments={menuBar.showLatexComments}
                      onToggleLatexComments={menuBar.onToggleLatexComments}
                      showHeadingLabels={menuBar.showHeadingLabels}
                      onToggleHeadingLabels={menuBar.toggleHeadingLabels}
                      omniDimResting={menuBar.omniDimResting}
                      onToggleOmniDimResting={menuBar.onToggleOmniDimResting}
                      cardOutlineChrome={menuBar.cardOutlineChrome}
                      onToggleCardOutline={menuBar.onToggleCardOutline}
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
                      showEditItems={chrome.showMenuBarEditItems ?? true}
                      showFormattingToolbar={chrome.showFormattingToolbar ?? true}
                    />
                    )}
                  </div>
                )}
              </div>
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
                // Pod-top fill: round the pod's OWN top corners to match the
                // sticky frame ring so the white surface reaches the rounded
                // top of the pod frame (otherwise the white rectangle's square
                // top corner peeks past the frame's rounded one). TOP corners
                // only — the bottom is owned by the sticky bottom cap, which
                // must keep latching, so we leave the bottom square here. Use
                // `clip` (NOT `hidden`): `clip` doesn't establish a scroll
                // container or new containing block, so the pod's sticky
                // descendants (frame ring, caps, lozenge) still latch to the
                // scroll root unchanged.
                borderTopLeftRadius: "var(--pod-radius)",
                borderTopRightRadius: "var(--pod-radius)",
                overflow: "clip",
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
              {/* Phase 3 — the floating in-context Keep / Revert pill. Mounted
                  ONLY while an applied pending change exists (flag-ON +
                  `index.size > 0`), like SlashCommandPopup — so flag-OFF / no
                  applied card costs nothing and adds no editor subscriber. It
                  portals to document.body; mounting here keeps it inside the
                  pane's CardStoreProvider so the hover read is this doc's. */}
              {pendingChangeIndex.size > 0 && (
                <PendingChangePill
                  editorRef={editorInstanceRef}
                  store={cardStoreInst}
                  index={pendingChangeIndex}
                />
              )}
              {/* Sticky expand-all / collapse-all controls — fade in on
                  hover near the pod top. GENUINE zero-flow: a height:0
                  sticky container (same pattern as the SectionLozenge
                  breadcrumb above) so it contributes ZERO height in both
                  block and flex layouts, regardless of any parent `gap`
                  — no phantom band at the pod top. The button row
                  overflows below top:0 (container does NOT clip). Stays
                  position:sticky so it remains pinned + hover-reachable
                  while scrolling. */}
              {viewPrefs && (overrideEditor ?? editor) && (
                <div
                  className="sticky z-20 shrink-0 group"
                  style={{ top: 0, height: 0 }}
                >
                  {/* Full-width zero-flow hover band. The container is
                      height:0 (the gap fix), so an `absolute` band adds ZERO
                      flow height while restoring a full-width × 24px hover
                      target that makes `group-hover` fire across the whole
                      pod top — exactly the old 24px band. Without it the
                      hover target collapses to just the tiny button
                      footprint, and these buttons are the SOLE entry point
                      for expand/collapse-all (no menu/keyboard fallback), so
                      discoverability would be badly hurt. */}
                  <div className="absolute top-0 left-0 right-0 h-6 pointer-events-auto" aria-hidden="true" />
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
                  // Align the guide frame to the visible pod rectangle:
                  // top = the card edge (--chrome-top, folds the old
                  // menu-band+cap 32 / Reader 8), bottom = the bottom
                  // cap inner (--pod-cap-inner). Same tokens the pod
                  // frame ring uses, so the guides can't drift from it.
                  const overlayHeight =
                    "calc(var(--scroll-viewport-h, 100vh) - var(--chrome-top) - var(--pod-cap-inner))";
                  return (
                    <div
                      data-margin-frame
                      className="pointer-events-none"
                      style={{
                        position: "sticky",
                        top: "var(--chrome-top)",
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
                          borderRadius: "var(--radius-pill)",
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
                    onUpdate={(editor, tx) => {
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
                      //
                      // `tx` is threaded to `docHook.onUpdate` so the autosave
                      // can flush immediately on an anchor-mint transaction
                      // (closing the anchor-persistence race; @/lib/anchor-mint-signal).
                      onUpdate?.(editor, tx);
                      // Keep-alive: a hidden/warm pane never arms autosave (see
                      // isVisibleRef above). Terminal flushes (drainDoc / unmount
                      // / pagehide) are unaffected — they don't route through here.
                      if (isVisibleRef.current) docHook.onUpdate(editor, tx);
                    }}
                    highlightText={errorHighlightRange ? null : highlightText}
                    highlightRange={effectiveHighlightRange}
                    editable={editable}
                    onEditorReady={handleEditorReady}
                    onCitationDrop={handleCitationDrop}
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
                        unanchoredFootnotes={unanchoredFootnoteRefs}
                        onDeleteUnanchoredFootnote={footnotesHook.deleteFootnote}
                        footnoteAiRequests={footnoteAiRequests}
                        setFootnoteAiRequest={footnotesHook.setFootnoteAiRequest}
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
                        onDeleteCitation={handleDeleteCitation}
                        selectedNoteId={selectedNoteId}
                        setSelectedNoteId={setSelectedNoteId}
                        compileLog={compileHook.lastLog}
                        compileStatus={compileHook.lastStatus}
                        isCompiling={compileHook.isCompiling}
                        searchState={searchState}
                        setSearchState={setSearchState}
                        setSearchHighlightRange={setSearchHighlightRange}
                        openItemInPanel={openItemInPanel}
                        wordCountHook={wordCountHook}
                        viewPrefs={effectiveViewPrefs}
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
                pod's clip (`overflow: clip` on `.editor-pane-pod`, which
                clips at the box edge — 0px lateral, so ANY descendant in
                the margin is cut) — handles render ~22px left of the
                content edge (in the margin) and would otherwise be
                clipped. The column-level
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
            {/* 8px breathing spacer between the gutter and the cap.
                Grows the column's flow by 8 so the cap container's
                natural-position bottom lands 8 below the pod, which
                puts the cap-inner (sitting at the top of the 16px
                cap container) flush with the pod's natural bottom
                edge — no doubling. Combined with the cap's full-width
                manilla bg, gives a consistent --pod-bottom manilla band
                between the pod and the window bottom. Caps-mode
                only. */}
            {(overrideEditor ?? editor) && (
              <div className="shrink-0" style={{ height: 'var(--pod-bottom)' }} />
            )}
            {/* Sticky pod-bottom cap — mirror of the top cap's
                continuous-arc treatment. Container is 22px tall (8px
                white cap-inner at top + 14px manilla band below) so the
                manila's 22px bottom corner is CONCENTRIC with the white
                inner's 8px corner (shared center) and reads as one arc,
                not the doubled/fuzzy corner an 8px-tall box gave when
                its 22px radius clamped. The 14px band also still masks
                content scrolling past the bottom and bleeds manila into
                the gutters. marginTop -22 keeps flow neutral; the sticky
                `bottom` (= --pod-bottom - 14) lands the white edge at
                vb - --pod-bottom (the frame ring's bottom), so the
                container's surplus hangs below the viewport. */}
            {ready && (overrideEditor ?? editor) && (
              <div
                data-editor-pod-cap-bottom
                className="sticky z-30 shrink-0 pointer-events-none flex flex-col"
                style={{
                  bottom:
                    'calc(var(--pod-bottom) - var(--pod-cap-h) + var(--pod-cap-inner))',
                  height: 'var(--pod-cap-h)',
                  marginTop: 'calc(-1 * var(--pod-cap-h))',
                  marginLeft: 'calc(-1 * var(--pod-cap-bleed))',
                  marginRight: 'calc(-1 * var(--pod-cap-bleed))',
                  background: 'var(--background)',
                  borderBottomLeftRadius: 'var(--pod-cap-h)',
                  borderBottomRightRadius: 'var(--pod-cap-h)',
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
                    height: 'var(--pod-cap-inner)',
                    marginLeft: 'var(--pod-cap-bleed)',
                    marginRight: 'var(--pod-cap-bleed)',
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
                  // mid-doc. Outer edge --pod-bottom above the viewport
                  // bottom (at the card's bottom edge); inner edge at
                  // `viewport - pod-bottom - pb`, the bottom guide bar.
                  bottom: 'var(--pod-bottom)',
                  height: "var(--editor-pb, 40px)",
                  marginTop: "calc(-1 * var(--editor-pb, 40px))",
                  zIndex: 15,
                  display: "var(--cap-bottom-display, block)",
                  background:
                    "linear-gradient(to top, var(--surface) 0, var(--surface) calc(100% - 18px), transparent 100%)",
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
                footnoteAiRequests={footnoteAiRequests}
                setFootnoteAiRequest={footnotesHook.setFootnoteAiRequest}
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
                onDeleteCitation={handleDeleteCitation}
                selectedNoteId={selectedNoteId}
                setSelectedNoteId={setSelectedNoteId}
                viewPrefs={effectiveViewPrefs}
                searchState={searchState}
                setSearchState={setSearchState}
                setSearchHighlightRange={setSearchHighlightRange}
                openItemInPanel={openItemInPanel}
                wordCountHook={wordCountHook}
                omniBulkPendingChanges={omniBulkPendingChanges}
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
              rightInset={SCROLLBAR_RIGHT_INSET}
            />
          )}
          {dragHandleMenuState && (
            <DragHandleMenu
              anchorRect={dragHandleMenuState.anchorRect}
              kind={dragHandleMenuState.ref.kind}
              // CHIP 7b: the UNIFORM collab read-only gate. `collab.canEditMainText`
              // (`!sidecar.enabled || iHavePen`) is the SSOT — false only when
              // collab is on AND the partner holds the pen, so every card row greys
              // out declaratively via `applies()`. Non-collab docs leave it true →
              // no over-gating.
              canEdit={collab.canEditMainText}
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
          {confirmMorphDialog}
        </LiftHost>
        </PoppedCardsContext.Provider>
        </CardArchiveActionsProvider>
        </CardArchiveViewProvider>
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
    </PendingChangeControllerProvider>
    </DiagnosticsProvider>
    </CardStoreProvider>
  );
}));


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
  /** BUG #55: per-footnote AI-request flags + toggle (from the footnotes.json
   *  sidecar). Threaded down alongside `footnoteInfos`. */
  footnoteAiRequests: Record<string, boolean>;
  setFootnoteAiRequest: (id: string, value: boolean) => void;
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
  /** Compound citation delete — strips the `\cite` atom AND the sidecar
   *  entry (the hard-delete contract). Threaded like `onDeleteFootnote`
   *  so the rail's panel slots don't reach for the bare sidecar filter. */
  onDeleteCitation: (id: string) => void;
  selectedNoteId: string | null;
  setSelectedNoteId: React.Dispatch<React.SetStateAction<string | null>>;
  // Errors surface (`ErrorsHost` / `OmniHost`) reads the diagnostics bundle from
  // `DiagnosticsProvider` via `useDiagnosticsContext()`, not from props.
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
  /** Phase 3 / task 023 — the applied-pending NAVIGATOR affordance (prev/next
   *  cursor + Keep-all / Dismiss-all kebab). Built once in EditorPane from the
   *  applied revision + cutter cards (routed through the shared
   *  `pending-change-actions` sequence) and threaded to OmniHost, which renders
   *  it on the side hosting the applied cards. Dismiss-all PRESERVES (archives)
   *  each card. Absent / count 0 → no header. */
  omniBulkPendingChanges?: OmniBulkPendingChanges;
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

  // In the stack model the column is "open" whenever it isn't collapsed.
  // The view-controls collapse toggle reflects that; the per-strip-button
  // "active" highlight reflects whether the panel is docked or floating.
  const isCollapsed = side === "left"
    ? viewPrefs.prefs.collapsedLeft
    : viewPrefs.prefs.collapsedRight;
  const isOpen = !isCollapsed;
  const isLeft = side === "left";
  const isPanelOpen = (pid: PanelKind) =>
    viewPrefs.prefs.dockStack[side].includes(pid as PanelId) ||
    viewPrefs.prefs.poppedOutPanels.includes(pid as PanelId);

  return (
    <div
      data-strip-side={side}
      data-prefs="backgroundColor"
      className="flex flex-col items-center pt-2 pb-3 px-1.5 bg-[var(--background)] shrink-0 gap-2.5 sticky top-0 z-20 self-start"
    >
      {/* View-controls pod: collapse/expand, blank. The split toggle is
          retired — panels now stack as bands over omni. */}
      <div className="flex flex-col items-center gap-0.5 p-1 rounded-md bg-surface/70 border border-edge-hover">
        <button
          onClick={() => {
            if (isOpen) {
              isLeft ? viewPrefs.collapseLeft() : viewPrefs.collapseRight();
            } else {
              isLeft ? viewPrefs.expandLeft() : viewPrefs.expandRight();
            }
          }}
          className="iconbtn-md iconbtn-toggle"
          aria-pressed={isOpen}
          data-hint="Toggle sidebar"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="4" width="16" height="16" rx="1.5" />
            {isOpen && (
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
      </div>
      {stripItems.map((p) => (
        <StripButton
          key={p}
          panelId={p}
          active={isPanelOpen(p)}
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
  footnoteAiRequests,
  setFootnoteAiRequest,
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
  onDeleteCitation,
  selectedNoteId,
  setSelectedNoteId,
  searchState,
  setSearchState,
  setSearchHighlightRange,
  openItemInPanel,
  wordCountHook,
  viewPrefs,
  tail,
  omniBulkPendingChanges,
}: PaneRailProps) {
  const isLeft = side === "left";

  // Whether this side's omni-view is currently showing ≥1 card. Reported up
  // from OmniViewPanel (post enabled-category + hideAll filter) and threaded
  // into PanelColumn so a column with omni cards — but no docked band — keeps
  // itself open in the narrow Reader pane (the `data-has-content` signal).
  // Updated only when the visible count flips (structurally memoized upstream),
  // so it's off the keystroke path.
  const [omniCardCount, setOmniCardCount] = useState(0);

  // The diagnostics bundle (single per-doc owner in `EditorPane`) reaches the
  // omni error mirror via context, not an 11-prop fan-out. Called before the
  // `!viewPrefs` early-out to honour the rules of hooks.
  const diagnostics = useDiagnosticsContext();

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
    // The docked stack for this side, top→bottom. Each band carries its
    // persisted height (px) or undefined ⇒ content-sized. This is the only
    // input PanelColumn needs to lay out the bands over omni.
    const stack = viewPrefs.prefs.dockStack[side].map((id) => ({
      id,
      height: viewPrefs.prefs.panelHeights[id],
    }));

    const omniNode: React.ReactNode = (
        <OmniHost
          side={side}
          omniDimResting={viewPrefs.prefs.omniDimResting}
          footnotes={footnoteInfos}
          orphanedFootnotes={viewPrefs.orphanedFootnotes}
          handleEditFootnote={onEditFootnote}
          handleDeleteFootnote={onDeleteFootnote}
          handleEditFootnoteTitle={onEditFootnoteTitle}
          handleEditOrphan={viewPrefs.onEditOrphan}
          handleDeleteOrphan={viewPrefs.onDeleteOrphan}
          handleEditOrphanTitle={viewPrefs.onEditOrphanTitle}
          footnoteAiRequests={footnoteAiRequests}
          setFootnoteAiRequest={setFootnoteAiRequest}
          citations={citationsHook.citations}
          citationPositionMap={citationPositionMap}
          bibEntries={citationsHook.bibEntries}
          bibPackage={citationsHook.bibPackage}
          updateCitation={citationsHook.updateCitation}
          deleteCitation={onDeleteCitation}
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
          convertNotesCard={notesHook.convertCard}
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
          latexErrors={diagnostics.allLatexErrors}
          paragraphByErrorId={diagnostics.paragraphByErrorId}
          errorSnippets={diagnostics.errorSnippets}
          dismissedErrorIds={diagnostics.dismissedErrorIds}
          dismissError={diagnostics.dismissError}
          jumpToError={diagnostics.jumpToErrorVisual}
          selectedErrorId={diagnostics.selectedErrorId}
          setSelectedErrorId={diagnostics.setSelectedErrorId}
          expandedErrorIds={diagnostics.expandedErrorIds}
          expandError={diagnostics.expandError}
          toggleErrorExpanded={diagnostics.toggleErrorExpanded}
          cutterCards={cutterHook.cards}
          updateCutterCommentContent={cutterHook.updateCommentContent}
          setCutterCommentAiRequest={cutterHook.setCommentAiRequest}
          updateCutterSuggestionField={cutterHook.updateSuggestionField}
          setCutterSuggestionStatus={cutterHook.setSuggestionStatus}
          convertCutterCard={cutterHook.convertCard}
          deleteCutterCard={cutterHook.deleteCard}
          reportCards={reportsHook.cards}
          updateReportContent={reportsHook.updateReportContent}
          updateReportTitle={reportsHook.updateReportTitle}
          updateRequestContent={reportsHook.updateRequestContent}
          setRequestAiRequest={reportsHook.setRequestAiRequest}
          convertReportCard={reportsHook.convertCard}
          deleteReportCard={reportsHook.deleteCard}
          getOmniEnabled={viewPrefs.getOmniEnabled}
          getOmniHideAll={viewPrefs.getOmniHideAll}
          focusState={viewPrefs.focusState}
          onVisibleCardsChange={setOmniCardCount}
          bulkPendingChanges={omniBulkPendingChanges}
        />
    );

    const stripJsx = !viewPrefs.zenMode && (
      <IconStrip side={side} stripItems={stripItems} viewPrefs={viewPrefs} />
    );

    const isCollapsed = side === "left"
      ? viewPrefs.prefs.collapsedLeft
      : viewPrefs.prefs.collapsedRight;

    // One always-mounted omni desktop with up to MAX_STACK opaque bands
    // stacked over it. PanelColumn owns the band frames + the bottom-edge
    // resize / divider-trade gestures; EditorPane only supplies the
    // ordered stack and the mutators.
    const panelColumnJsx = (
      <PanelColumn
        side={side}
        omni={omniNode}
        stack={stack}
        omniHasCards={omniCardCount > 0}
        onTradeHeight={viewPrefs.tradePanelHeights}
        onResizeBottomEdge={viewPrefs.setPanelHeight}
        onFocusBand={(id) => viewPrefs.notePanelUse(side, id)}
        panelPref={viewPrefs.getPanelWidth(side, "omni")}
        onPanelPrefChange={(w) => viewPrefs.setPanelWidth(side, "omni", w)}
        isResizing={viewPrefs.isResizingPanels}
        onResizingChange={viewPrefs.setIsResizingPanels}
        onSyncBeforeDrag={viewPrefs.syncPanelPrefsToRendered}
        collapsed={isCollapsed}
        tail={tail}
      />
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
  /** BUG #55: per-footnote AI-request flags + toggle (from the footnotes.json
   *  sidecar). Threaded down alongside `footnoteInfos`. */
  footnoteAiRequests: Record<string, boolean>;
  setFootnoteAiRequest: (id: string, value: boolean) => void;
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
  /** Compound citation delete — strips the `\cite` atom AND the sidecar
   *  entry (the hard-delete contract). Threaded like `onDeleteFootnote`
   *  so the rail's panel slots don't reach for the bare sidecar filter. */
  onDeleteCitation: (id: string) => void;
  selectedNoteId: string | null;
  setSelectedNoteId: React.Dispatch<React.SetStateAction<string | null>>;
  // Errors surface (`ErrorsHost`) reads the diagnostics bundle from
  // `DiagnosticsProvider` via `useDiagnosticsContext()`, not from props. The
  // compile log/status below stay explicit props (NOT part of the diagnostics
  // bundle) — this is what keeps the omni mirror excluded from the compile feed
  // by omission (`OmniHost` never receives them).
  /** Raw compile log/status surfaced as the docked Errors panel's footer
   *  disclosure (P5) — the raw log is reachable from the docked panel, not just
   *  code view. Sourced from EditorPane's own `useLatexCompile`. */
  compileLog: string | null;
  compileStatus: number | null;
  isCompiling: boolean;
  searchState: SearchPanelState;
  setSearchState: React.Dispatch<React.SetStateAction<SearchPanelState>>;
  setSearchHighlightRange: React.Dispatch<React.SetStateAction<{ from: number; to: number } | null>>;
  openItemInPanel: (panel: PanelId, itemId: string) => void;
  wordCountHook: ReturnType<typeof useWordCount>;
  /** View-state bundle. Both the main app and the Library Reader now supply
   *  it (the Reader via `useReaderViewPrefs()`), so the body's outline branch
   *  always routes to `<OutlineHost>`. Kept optional for any future caller. */
  viewPrefs?: EditorPaneViewPrefs;
  /** Bug sweep #3: atomless footnote refs (archived or unanchored) the Footnotes
   *  panel lists alongside live anchored footnotes + orphans, plus the ref-delete
   *  handler (removes only the sidecar ref — no atom to splice). */
  unanchoredFootnotes: FootnoteRef[];
  onDeleteUnanchoredFootnote: (id: string) => void;
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
  footnoteAiRequests,
  setFootnoteAiRequest,
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
  onDeleteCitation,
  selectedNoteId,
  setSelectedNoteId,
  compileLog,
  compileStatus,
  isCompiling,
  searchState,
  setSearchState,
  setSearchHighlightRange,
  openItemInPanel,
  wordCountHook,
  viewPrefs,
  unanchoredFootnotes,
  onDeleteUnanchoredFootnote,
}: PaneRailBodyProps) {
  // The diagnostics bundle (single per-doc owner in `EditorPane`) reaches the
  // docked Errors panel via context, not an 11-prop fan-out. Called before the
  // per-`panelKind` branch returns to honour the rules of hooks; only the
  // `errors` branch reads it. The compile log/status stay explicit props.
  const diagnostics = useDiagnosticsContext();
  if (panelKind === "outline") {
    // Single OutlineHost path. Both the main app AND the Library Reader now
    // pass `viewPrefs` (the Reader via `useReaderViewPrefs()` in ephemeral
    // mode), so the formerly-separate Reader branch — a direct `<OutlinePanel>`
    // with its own inline `onScrollTo` body — is gone. The Reader's real
    // click-to-scroll now lives in `READER_EDITOR_HANDLERS.onScrollToHeading`
    // (ported verbatim) and arrives here via `viewPrefs.onScrollToHeading`.
    // The `!viewPrefs` early-out below keeps the prop type permissive for any
    // future non-viewPrefs caller, but no live caller hits it.
    if (!viewPrefs) return null;
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
        // Orphans (in-text callout deleted, body preserved) live on the
        // optional `viewPrefs` bundle — the main editable app always supplies
        // it (same source the OmniHost mount reads). Only the Reader path
        // (no `viewPrefs`, non-editable) falls back to the empty list + no-op
        // orphan handlers. Must match the OmniHost wiring above, else orphan
        // footnote cards never render in the Footnotes panel.
        orphanedFootnotes={viewPrefs?.orphanedFootnotes ?? []}
        unanchoredFootnotes={unanchoredFootnotes}
        onEdit={onEditFootnote}
        onEditTitle={onEditFootnoteTitle}
        onDelete={onDeleteFootnote}
        // An atomless archived/unanchored ref has no `\footnote` atom — deleting
        // it removes only the sidecar ref (the anchored onDelete would no-op on
        // the missing atom and leave the ref behind).
        onDeleteUnanchored={onDeleteUnanchoredFootnote}
        onAdd={onAddFootnote}
        onDeleteOrphan={viewPrefs?.onDeleteOrphan ?? (() => {})}
        onEditOrphan={viewPrefs?.onEditOrphan ?? (() => {})}
        onEditOrphanTitle={viewPrefs?.onEditOrphanTitle ?? (() => {})}
        footnoteAiRequests={footnoteAiRequests}
        onSetFootnoteAiRequest={setFootnoteAiRequest}
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
        deleteCitation={onDeleteCitation}
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
        convertCard={notesHook.convertCard}
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
        updateCommentContent={cutterHook.updateCommentContent}
        setCommentAiRequest={cutterHook.setCommentAiRequest}
        updateSuggestionField={cutterHook.updateSuggestionField}
        setSuggestionStatus={cutterHook.setSuggestionStatus}
        setAppliedChange={cutterHook.setAppliedChange}
        setArchived={cutterHook.setArchived}
        convertCard={cutterHook.convertCard}
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
        convertCard={reportsHook.convertCard}
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
        setAppliedChange={revisionsHook.setAppliedChange}
        setArchived={revisionsHook.setArchived}
        convertCard={revisionsHook.convertCard}
        deleteCard={revisionsHook.deleteCard}
        discardPristine={revisionsHook.discardPristineCards}
      />
    );
  }
  if (panelKind === "errors") {
    return (
      <ErrorsHost
        errors={diagnostics.allLatexErrors}
        selectedId={diagnostics.selectedErrorId}
        onSelect={diagnostics.setSelectedErrorId}
        dismissedIds={diagnostics.dismissedErrorIds}
        onDismiss={diagnostics.dismissError}
        onJump={diagnostics.jumpToErrorVisual}
        snippets={diagnostics.errorSnippets}
        paragraphByErrorId={diagnostics.paragraphByErrorId}
        expandedIds={diagnostics.expandedErrorIds}
        onExpand={diagnostics.expandError}
        onToggleExpanded={diagnostics.toggleErrorExpanded}
        compileLog={compileLog}
        compileStatus={compileStatus}
        isCompiling={isCompiling}
      />
    );
  }
  if (panelKind === "search") {
    return (
      <SearchHost
        footnotes={footnoteInfos}
        // Same orphan source as the Footnotes/Omni mounts — without this the
        // Search panel can't index orphan-footnote body text (Reader, which
        // has no `viewPrefs`, correctly searches an empty orphan set).
        orphanedFootnotes={viewPrefs?.orphanedFootnotes ?? []}
        notes={notesHook.notes}
        citations={citationsHook.citations}
        allEditorCitations={allEditorCitations}
        todoItems={todosHook.items}
        archiveSnippets={archiveHook.snippets}
        cutterCards={cutterHook.cards}
        reportCards={reportsHook.cards}
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
        replaceBibEntry={citationsHook.replaceBibEntry}
        updateBibKeyAndType={citationsHook.updateBibKeyAndType}
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
        bibFilter={viewPrefs?.prefs.bibFilter}
        setBibFilter={viewPrefs?.setBibFilter}
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
