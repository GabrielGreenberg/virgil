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
 *     `useCitations`, `useArchive`, `useTodos`, `useQuotations`,
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
 *     `MarginActionToolbar` and `ActionButtonsRow`.
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
  type EditorChromeConfig,
} from "./editor-layout/chrome-config";
import OutlinePanel from "@/panels/Outline/OutlinePanel";
import ExamplesPanel from "@/panels/Examples";
import { PANEL_REGISTRY } from "@/panels/panel-registry";
import { SectionLozenge } from "./editor-layout/section-lozenge";
import { EditorScrollbar } from "./editor-layout/editor-scrollbar";
import { ZenMargin } from "./editor-layout/zen-margin";
import PrintAppendices from "./PrintAppendices";
import type { PrintPanelKey } from "@/lib/print";
import { EditorRefProvider } from "./editor-layout/contexts/editor-ref";
import { SelectionsProvider, useAnchoredSelectionSlots } from "./editor-layout/contexts/selections";
import { cardStore, useHover } from "@/links/_shared/anchored-card-store";
import type { EntityKind } from "@/links/_shared/entity-hover";
import { useCardSelectionHighlight } from "@/links/_shared/useCardSelectionHighlight";
import { useCardHoverHighlight } from "@/links/_shared/useCardHoverHighlight";
import { useTextHoverBridge } from "@/links/_shared/useTextHoverBridge";
import { usePanelCardHoverBridge } from "@/links/_shared/usePanelCardHoverBridge";
import { usePlacement } from "@/links/_shared/usePlacement";
import { AiRequestsProvider } from "./editor-layout/contexts/ai-requests";
import { RecentlyAddedProvider } from "./editor-layout/contexts/recently-added";
import { CardCreationProvider } from "./editor-layout/contexts/card-creation";
import { useCardCreation } from "./editor-layout/card-actions/card-creation";
import { useCitationActions } from "./editor-layout/card-actions/citations";
import { useDropActions } from "./editor-layout/card-actions/drops";
import { isAnchorableNode } from "@/lib/marginalia";
import { useCitations } from "@/hooks/useCitations";
import { useAnnotations } from "@/hooks/useAnnotations";
import { useBibReview } from "@/hooks/useBibReview";
import { useBibSettings } from "@/hooks/useBibSettings";
import { useNotes } from "@/hooks/useNotes";
import { useAiRequests } from "@/hooks/useAiRequests";
import { useRecentlyAddedTracker } from "@/hooks/useRecentlyAddedTracker";
import { useDocument } from "@/hooks/useDocument";
import { useLatexCompile, type DocumentClassMismatchHandler } from "@/hooks/useLatexCompile";
import { useWordCount } from "@/hooks/useWordCount";
import { useTodos } from "@/hooks/useTodos";
import { useQuotations } from "@/hooks/useQuotations";
import { useArchive } from "@/hooks/useArchive";
import { useCutter } from "@/hooks/useCutter";
import { useRevisions } from "@/hooks/useRevisions";
import { useSuggestions } from "@/hooks/useSuggestions";
import { useCollab, CollabProvider, type CollabHook } from "@/hooks/useCollab";
import { useDocumentStyle } from "@/hooks/useDocumentStyle";
import { useFootnotes } from "@/hooks/useFootnotes";
import { usePristineCardManager } from "@/hooks/usePristineCardManager";
import { PristineCardsProvider } from "./editor-layout/contexts/pristine-cards";
import { CitationDisplayProvider } from "./editor-layout/contexts/citation-display";
import { DockOutline } from "./editor-layout/DockOutline";
import { CardLiftOutline } from "./CardLiftOutline";
import { renderPoppedCard, type PoppedCardDeps } from "./editor-layout/floating-cards";
import { useDragHandleActions, type DragHandlePassage } from "./editor-layout/card-actions/drag-handle-actions";
import { DragHandleMenuProvider, type DragHandleMenuApi } from "./editor-layout/card-actions/drag-handle-menu-context";
import { DragHandleMenu } from "./DragHandleMenu";
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
import { RevisionsHost } from "./editor-layout/panels/revisions-host";
import { QuotationsHost } from "./editor-layout/panels/quotations-host";
import { ErrorsHost } from "./editor-layout/panels/errors-host";
import { SearchHost } from "./editor-layout/panels/search-host";
import WordCountPanel from "@/panels/WordCount";
import { INITIAL_SEARCH_STATE, type SearchPanelState } from "@/panels/Search";
import type { LatexError } from "@/lib/latex-errors";
import { MarginActionToolbar } from "./MarginActionToolbar";
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
  getLinkedParagraphIds,
  getTextAnchor,
  removeLinkedAnchor,
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
import type { FocusState } from "@/hooks/useFocusMode";
import type { OmniCategory } from "@/panels/Omni";
import type { SectionPathEntry } from "@/panels/Outline";
import type { PanelKind } from "@/panels/_shared/types";
import type { AiRequest } from "@/lib/types";

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
  /** Cards animation offset for the omni view per side. Transient. */
  cardsOffset?: { left?: number; right?: number };
  /** When true, the next cardsOffset change is applied without the
   *  150ms transition. Used by jump-to. */
  cardsSilent?: { left?: boolean; right?: boolean };
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

  // ── Card popout (paragraph / heading / example) ─────────────────
  /** Toggle a card's popped-out state. Key shape: `paragraph:${uuid}`,
   *  `heading:${uuid}`, `example:${uuid}` — matches `prefs.poppedOutCards`
   *  entries and the kind dispatch in `floating-cards.tsx`. */
  toggleCardPopout: (key: string) => void;
  setCardFloatPosition: (
    key: string,
    rect: { x: number; y: number; width: number; height: number },
  ) => void;

  // ── OmniHost helpers ────────────────────────────────────────────
  getOmniEnabled: (side: Side) => Set<OmniCategory>;
  getOmniHideAll: (side: Side) => boolean;
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
      | { kind: "toolbar"; bucket: "actions" | "formatting" | "menus"; id: string },
  ) => void;

  // ── Icon strip (view-controls pod + StripButton + OmniFilterMenu) ──
  /** Sidebar collapse / expand. Used by the view-controls pod's
   *  collapse-toggle button — `activeLeft ? collapseLeft() : expandLeft()`. */
  collapseLeft: () => void;
  collapseRight: () => void;
  expandLeft: () => void;
  expandRight: () => void;
  /** Suppresses the default omni-view on a side ("blank" mode). */
  setBlank: (side: Side) => void;
  /** Toggles split panel on a side. */
  toggleSplit: (side: Side) => void;
  /** Force-docks a panel into its gutter slot. Required by `useStripHandlers`. */
  openPanelDocked: (id: PanelId, side?: Side) => void;
  /** Per-panel MIME-type table for icon drops (Notes, Cutter, Todo,
   *  Revisions, Archive). */
  iconDropMimesByPanel: Partial<Record<PanelId, readonly string[]>>;
  /** Routes a DataTransfer dropped on a panel icon to the appropriate
   *  card-creation flow. Returns true if the drop was handled. */
  handleIconDrop: (panelId: PanelId, dt: DataTransfer) => boolean;
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

  /** Forwarded to TipTap's `onUpdate` via `VirgilEditor`. */
  onUpdate?: (doc: JSONContent) => void;

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
  // `docVersion` bumps on every editor `create` / `update` so memoized
  // panel data (`getExamples`, `getFootnotes`, `getCitations`) refreshes
  // when the live doc changes. In Reader mode `update` rarely fires —
  // `create` runs once at mount which is enough to populate panels.
  const [docVersion, setDocVersion] = useState(0);

  useEffect(() => {
    if (!editor) return;
    const bump = () => setDocVersion((v) => v + 1);
    const onUpdate = () => {
      bump();
      // Track wall-clock time of the last visual-editor edit so
      // `pdfStale` can surface "PDF is out of date" once a compile
      // has landed and the user keeps typing. Code-editor edits land
      // separately when the code-editor work moves into EditorPane.
      setLastEditTime(Date.now());
    };
    editor.on("create", bump);
    editor.on("update", onUpdate);
    // Force a bump immediately in case 'create' already fired before
    // we subscribed (TipTap's lifecycle order varies across React
    // strict-mode mount/unmount/remount cycles).
    bump();
    return () => {
      editor.off("create", bump);
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
    selectedQuotationGroupId, setSelectedQuotationGroupId,
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
  const todoPristine = useMemo(() => pristineManager.forKind("todo"), [pristineManager]);
  const quotationPristine = useMemo(() => pristineManager.forKind("quotation"), [pristineManager]);
  const citationPristine = useMemo(() => pristineManager.forKind("citation"), [pristineManager]);
  void citationPristine; // wired into citation creation by Step 7.5+
  const footnotePristine = useMemo(() => pristineManager.forKind("footnote"), [pristineManager]);

  // ── Per-doc sidecar hooks ────────────────────────────────────────
  // These resolve to the paper folder via storage-fsa.ts's synthetic
  // FsaDocMeta for `library-paper:` IDs (and storage-dev.ts's URL
  // routing for the dev preview); for main-app docs they resolve
  // through the regular FsaDocIndex.
  const citationsHook = useCitations(docId);
  const annotationsHook = useAnnotations(docId);
  const bibReviewHook = useBibReview(docId);
  const bibSettingsHook = useBibSettings(docId);
  const notesHook = useNotes(docId, notePristine);
  const aiRequestsHook = useAiRequests(docId);
  const cutterHook = useCutter(docId, cutPristine);
  const revisionsHook = useRevisions(docId);
  const todosHook = useTodos(docId, todoPristine);
  const quotationsHook = useQuotations(docId, quotationPristine);
  const archiveHook = useArchive(docId);
  const footnotesHook = useFootnotes(docId, footnotePristine);
  void footnotesHook; // wired into the panel host once FootnotesHost moves here
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

  // ── Document load + compile state ─────────────────────────────────
  // `useDocument` reads its docId+pipeline from the surrounding
  // `<DocPipeline>` ancestor (mandatory — it throws otherwise). The
  // ancestor's `key={docId}` forces a full remount on doc switch, so
  // every closure here closes over a single doc's worth of state. Its
  // `content` is used as the editor seed only when `initialContent`
  // isn't supplied; the Reader supplies its own (UUID-tagged +
  // sidecar-aware parse) so that path stays unchanged.
  const docHook = useDocument();

  // Compile state — `pdfBlobUrl`, `lastCompileTime`, `lastEditTime`
  // live here so they bubble up via `paneState` for the shell's Virgil
  // bar (PDF stale-dot, Compile spinner). Reset on docId change so
  // switching docs never carries stale PDF bytes between paper folders.
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [lastCompileTime, setLastCompileTime] = useState<number | null>(null);
  const [lastEditTime, setLastEditTime] = useState<number | null>(null);
  const latestPdfBytes = useRef<Uint8Array | null>(null);
  const pdfStale =
    lastEditTime != null && lastCompileTime != null && lastEditTime > lastCompileTime;

  useEffect(() => {
    setLastCompileTime(null);
    setLastEditTime(null);
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

  // Fill `displayText` on every citation node once `bibEntries` load,
  // so chips render as "Author Year" instead of falling back to the
  // raw `\cite{...}` command. Lives here (shared layer) so the Reader
  // — which mounts EditorPane without EditorLayout — inherits it.
  useEffect(() => {
    if (!editor || citationsHook.bibEntries.length === 0) return;
    const cits = innerRef.current?.getCitations() ?? [];
    for (const c of cits) {
      const display = citationsHook.getDisplayText(c.command);
      if (display !== c.displayText) {
        innerRef.current?.updateCitationDisplay(c.citationId, display);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citationsHook.bibEntries, editor, citationsHook.getDisplayText]);

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
      const key = `${cardKind}:${cardId}`;
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

  // ── Paragraph / heading / example popouts ────────────────────────
  // Match EditorLayout's existing handlers (lines ~5705–5760). When
  // viewPrefs is provided (main app post-7.8), the user's gutter
  // popout button toggles a floating card via `toggleCardPopout`,
  // optionally seeding a quadrant-aware spawn position from the
  // anchor rect. Reader has no popout chrome → handlers no-op.
  const paragraphIsPoppedRef = useRef<(uuid: string) => boolean>(
    () => false,
  );
  const headingIsPoppedRef = useRef<(uuid: string) => boolean>(
    () => false,
  );
  const exampleIsPoppedRef = useRef<(uuid: string) => boolean>(
    () => false,
  );
  if (viewPrefs) {
    const popped = viewPrefs.prefs.poppedOutCards;
    paragraphIsPoppedRef.current = (uuid) => popped.includes(`paragraph:${uuid}`);
    headingIsPoppedRef.current = (uuid) => popped.includes(`heading:${uuid}`);
    exampleIsPoppedRef.current = (uuid) => popped.includes(`example:${uuid}`);
  }
  const handleToggleParagraphPopout = useCallback(
    (uuid: string, anchor?: DOMRect | null) => {
      if (!viewPrefs) return;
      const key = `paragraph:${uuid}`;
      if (!viewPrefs.prefs.poppedOutCards.includes(key) && anchor) {
        const pos = computeSpawnPosition(anchor, { width: POPUP_W, height: POPUP_H });
        viewPrefs.setCardFloatPosition(key, pos);
      }
      viewPrefs.toggleCardPopout(key);
    },
    [viewPrefs],
  );
  const handleLiftParagraph = useCallback(
    (uuid: string, rect: { x: number; y: number; width: number; height: number }) => {
      if (!viewPrefs) return;
      const key = `paragraph:${uuid}`;
      if (viewPrefs.prefs.poppedOutCards.includes(key)) return;
      viewPrefs.setCardFloatPosition(key, rect);
      viewPrefs.toggleCardPopout(key);
    },
    [viewPrefs],
  );
  const handleToggleHeadingPopout = useCallback(
    (uuid: string) => {
      if (!viewPrefs) return;
      viewPrefs.toggleCardPopout(`heading:${uuid}`);
    },
    [viewPrefs],
  );
  const handleLiftHeading = useCallback(
    (uuid: string, rect: { x: number; y: number; width: number; height: number }) => {
      if (!viewPrefs) return;
      const key = `heading:${uuid}`;
      if (viewPrefs.prefs.poppedOutCards.includes(key)) return;
      viewPrefs.setCardFloatPosition(key, rect);
      viewPrefs.toggleCardPopout(key);
    },
    [viewPrefs],
  );
  const handleToggleExamplePopout = useCallback(
    (uuid: string, anchor?: DOMRect | null) => {
      if (!viewPrefs) return;
      const key = `example:${uuid}`;
      if (!viewPrefs.prefs.poppedOutCards.includes(key) && anchor) {
        const pos = computeSpawnPosition(anchor, { width: POPUP_W, height: POPUP_H });
        viewPrefs.setCardFloatPosition(key, pos);
      }
      viewPrefs.toggleCardPopout(key);
    },
    [viewPrefs],
  );
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

  // ── Marginalia markers ───────────────────────────────────────────
  // Walks every card hook (notes, quotations, archive, todos, cutter,
  // revisions) plus the live latex-error list and emits one
  // `MarginaliaMarker` per linked paragraph. Mirrors EditorLayout's
  // pre-extraction shape but skips the cross-card hover linkage (no
  // hoveredEntityId state in EditorPane yet) and the `openForCard`
  // routing (basic select-then-activate is enough until popouts land).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const marginaliaMarkers = useMemo<MarginaliaMarker[]>(() => {
    void docVersion;
    const result: MarginaliaMarker[] = [];

    // Quotations
    for (const g of quotationsHook.groups) {
      const pids = getLinkedParagraphIds(g);
      if (pids.length === 0) continue;
      for (const pid of pids) {
        result.push({
          id: `${g.id}:${pid}`,
          entityId: g.id,
          entityKind: "quotation",
          type: "quote",
          paragraphId: pid,
          title: g.title || g.references[0]?.citeKey || "Quotation",
          onClick: () => {
            setSelectedQuotationGroupId(g.id);
            setActivePanelKindBySide("quotations");
          },
          onDelete: () => quotationsHook.removeParagraphId(g.id, pid),
        });
      }
    }

    // Notes
    for (const n of notesHook.notes) {
      const pids = getLinkedParagraphIds(n);
      if (pids.length === 0) continue;
      const anchor = getTextAnchor(n);
      for (const pid of pids) {
        result.push({
          id: `${n.id}:${pid}`,
          entityId: n.id,
          entityKind: "note",
          type: "note",
          paragraphId: pid,
          title: n.title || "Note",
          onClick: () => {
            setSelectedNoteId(n.id);
            setActivePanelKindBySide("notes");
          },
          onDelete: () => {
            const ed = innerRef.current?.getEditor();
            if (ed && anchor) removeLinkedAnchor(ed, anchor.anchorId);
            notesHook.removeNoteParagraphId(n.id, pid);
          },
          anchorId: anchor?.anchorId,
        });
      }
    }

    // Archive snippets
    for (const snippet of archiveHook.snippets) {
      const pids = getLinkedParagraphIds(snippet);
      if (pids.length === 0) continue;
      for (const pid of pids) {
        result.push({
          id: `${snippet.id}:${pid}`,
          entityId: snippet.id,
          entityKind: "archive",
          type: "archive",
          paragraphId: pid,
          title: "Archived snippet",
          onClick: () => {
            setSelectedArchiveId(snippet.id);
            setActivePanelKindBySide("archive");
          },
          onDelete: () => archiveHook.removeParagraphId(snippet.id, pid),
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
        result.push({
          id: `${r.id}:${paragraphId}`,
          entityId: r.id,
          entityKind: r.kind === "suggestion" ? "revision-suggestion" : "comment",
          type: "revision",
          paragraphId,
          title: r.selectedText || "Revision",
          anchorId,
          onClick: () => {
            setSelectedCommentId(selectedCommentId === r.id ? null : r.id);
            setActivePanelKindBySide("revisions");
          },
        });
      }
    }

    // Cutter cards
    for (const c of cutterHook.cards) {
      const pids = getLinkedParagraphIds(c);
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
          paragraphId: pid,
          title,
          onClick: () => {
            setSelectedCutterCardId(c.id);
            setActivePanelKindBySide("cutter");
          },
          onDelete: () => {
            const ed2 = innerRef.current?.getEditor();
            if (ed2 && cardAnchor) removeLinkedAnchor(ed2, cardAnchor.anchorId);
            cutterHook.removeCardParagraphId(c.id, pid);
          },
          anchorId: cardAnchor?.anchorId,
        });
      }
    }

    // Todo
    for (const item of todosHook.items) {
      const pids = getLinkedParagraphIds(item);
      if (pids.length === 0) continue;
      for (const pid of pids) {
        result.push({
          id: `${item.id}:${pid}`,
          entityId: item.id,
          entityKind: "todo",
          type: "todo",
          paragraphId: pid,
          title: item.text || "Todo",
          muted: item.done,
          onClick: () => {
            setSelectedTodoId(item.id);
            setActivePanelKindBySide("todo");
          },
          onDelete: () => todosHook.removeParagraphId(item.id, pid),
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
        paragraphId: pid,
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
    notesHook.removeNoteParagraphId,
    quotationsHook.groups,
    quotationsHook.removeParagraphId,
    archiveHook.snippets,
    archiveHook.removeParagraphId,
    todosHook.items,
    todosHook.removeParagraphId,
    cutterHook.cards,
    cutterHook.removeCardParagraphId,
    revisionsHook.cards,
    allLatexErrors,
    dismissedErrorIds,
    paragraphByErrorId,
    selectedNoteId,
    selectedQuotationGroupId,
    selectedArchiveId,
    selectedTodoId,
    selectedCutterCardId,
    selectedCommentId,
    selectedErrorId,
    docVersion,
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

  // Divider class derived from active divider levels — composes with the
  // editor-pane-column className below. Empty when no menuBar (Reader).
  const dividerClassName = useMemo(() => {
    const levels = menuBar?.activeDividerLevels;
    if (!levels) return "";
    return [...levels].map((lvl) => `show-dividers-${lvl}`).join(" ");
  }, [menuBar?.activeDividerLevels]);

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
    addCutterComment: cutterHook.addComment,
    addCutterSuggestion: cutterHook.addSuggestion,
    addRevisionComment: revisionsHook.addComment,
    addRevisionSuggestion: revisionsHook.addSuggestion,
    addTodo: todosHook.addItem,
    updateTodo: todosHook.updateItem,
    addTodoParagraphId: todosHook.addParagraphId,
    addQuotationGroup: quotationsHook.addGroup,
    addCitation: citationsHook.addCitation,
    setSelectedNoteId,
    setSelectedCutterCardId,
    setSelectedCommentId,
    setSelectedTodoId,
    setSelectedFootnoteId,
    setSelectedQuotationGroupId,
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
    () => todoPristine.registerDiscard((id) => todosHook.deleteItem(id)),
    [todoPristine, todosHook.deleteItem],
  );
  useEffect(
    () => quotationPristine.registerDiscard((id) => quotationsHook.deleteGroup(id)),
    [quotationPristine, quotationsHook.deleteGroup],
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
  // (footnote, citation, quotation, note, todo, review, suggest edit,
  // cutter, archive). The dispatch hook resolves the passage to a doc
  // range, plants the selection over it, runs the matching create
  // path with `mode: "omni"`, and ensures the omni-view is showing
  // on the new card's panel side. Reader mode (no viewPrefs) still
  // computes a dispatch — the omni activation steps no-op.
  const dragHandleActions = useDragHandleActions({
    editorRef: innerRef,
    cardCreation,
    archiveContent: archiveHook.archiveContent,
    updateArchiveSnippet: archiveHook.updateSnippet,
    addArchiveParagraphId: archiveHook.addParagraphId,
    setSelectedArchiveId,
    prefs: viewPrefs?.prefs ?? readerPrefs,
    expandLeft: viewPrefs?.expandLeft ?? stubSetActive,
    expandRight: viewPrefs?.expandRight ?? stubSetActive,
    clearBlankIfSet: viewPrefs?.clearBlankIfSet ?? stubSetActive,
  });
  const [dragHandleMenuState, setDragHandleMenuState] = useState<{
    passage: DragHandlePassage;
    anchorRect: DOMRect;
  } | null>(null);
  const openDragHandleMenu = useCallback(
    (passage: DragHandlePassage, anchorRect: DOMRect) => {
      setDragHandleMenuState({ passage, anchorRect });
    },
    [],
  );
  const closeDragHandleMenu = useCallback(() => setDragHandleMenuState(null), []);
  const dragHandleMenuApi = useMemo<DragHandleMenuApi>(
    () => ({ open: openDragHandleMenu }),
    [openDragHandleMenu],
  );

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

  // ── In-text margin-edit mode ────────────────────────────────────
  // Entered from ViewMenu → "Margins…". While active, two vertical
  // guides render over the editor column at the live margin
  // positions; dragging them updates `liveLeftMargin` /
  // `liveRightMargin` (which the editor reads via `--editor-pl/pr`
  // CSS vars on the column wrapper). Save commits to viewPrefs;
  // Cancel/Escape restores the captured snapshot. Reader doesn't
  // pass `viewPrefs` so this whole block stays dormant.
  const [marginEditMode, setMarginEditMode] = useState(false);
  const [liveLeftMargin, setLiveLeftMargin] = useState<number | null>(null);
  const [liveRightMargin, setLiveRightMargin] = useState<number | null>(null);
  // Refs mirror the live margin state so the drag handler (created
  // once via useCallback) always reads the latest snap target without
  // a stale closure.
  const liveLeftMarginRef = useRef<number | null>(null);
  const liveRightMarginRef = useRef<number | null>(null);
  liveLeftMarginRef.current = liveLeftMargin;
  liveRightMarginRef.current = liveRightMargin;
  const marginSnapshotRef = useRef<{ left: number; right: number } | null>(null);
  const persistedLeftMargin = viewPrefs?.prefs.editorLeftMargin ?? 88;
  const persistedRightMargin = viewPrefs?.prefs.editorRightMargin ?? 72;
  const effectiveLeftMargin =
    marginEditMode && liveLeftMargin != null ? liveLeftMargin : persistedLeftMargin;
  const effectiveRightMargin =
    marginEditMode && liveRightMargin != null ? liveRightMargin : persistedRightMargin;
  const enterMarginEditMode = useCallback(() => {
    if (!viewPrefs) return;
    const left = viewPrefs.prefs.editorLeftMargin;
    const right = viewPrefs.prefs.editorRightMargin;
    marginSnapshotRef.current = { left, right };
    setLiveLeftMargin(left);
    setLiveRightMargin(right);
    setMarginEditMode(true);
  }, [viewPrefs]);
  const cancelMarginEdit = useCallback(() => {
    marginSnapshotRef.current = null;
    setLiveLeftMargin(null);
    setLiveRightMargin(null);
    setMarginEditMode(false);
  }, []);
  const saveMarginEdit = useCallback(() => {
    if (viewPrefs) {
      if (liveLeftMargin != null) viewPrefs.setEditorLeftMargin(liveLeftMargin);
      if (liveRightMargin != null) viewPrefs.setEditorRightMargin(liveRightMargin);
    }
    marginSnapshotRef.current = null;
    setLiveLeftMargin(null);
    setLiveRightMargin(null);
    setMarginEditMode(false);
  }, [liveLeftMargin, liveRightMargin, viewPrefs]);
  // Escape cancels margin-edit (mirror of the Cancel button).
  useEffect(() => {
    if (!marginEditMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelMarginEdit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [marginEditMode, cancelMarginEdit]);
  // Mouse-drag handler for the margin guides. Captures the page rect
  // at drag-start and clamps live values: left ≥ 72 (preserve
  // marginalia gutter), right ≥ 24 (breathing room). Upper bound 240
  // so the user can't accidentally collapse the text column. Two
  // parallel writes per move: direct DOM via setProperty, plus React
  // state via setLive*. rAF coalesces multiple mousemoves per frame.
  const beginMarginDrag = useCallback((e: React.MouseEvent<HTMLElement>, side: "left" | "right") => {
    e.preventDefault();
    e.stopPropagation();
    const page = (e.currentTarget.closest('[data-editor-page]')) as HTMLElement | null;
    if (!page) return;
    const col = page.closest('[data-editor-col]') as HTMLElement | null;
    const rect = page.getBoundingClientRect();
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = "ew-resize";
    const cssVar = side === "left" ? "--editor-pl" : "--editor-pr";
    const SNAP_PX = 10;
    const otherSide = side === "left"
      ? (liveRightMarginRef.current ?? persistedRightMargin)
      : (liveLeftMarginRef.current ?? persistedLeftMargin);
    const dragSideMin = side === "left" ? 72 : 24;
    let pendingNext: number | null = null;
    let rafId: number | null = null;
    const flush = () => {
      rafId = null;
      if (pendingNext == null) return;
      const next = pendingNext;
      col?.style.setProperty(cssVar, `${next}px`);
      if (side === "left") setLiveLeftMargin(next);
      else setLiveRightMargin(next);
    };
    const onMove = (mv: MouseEvent) => {
      let next = side === "left"
        ? Math.max(72, Math.min(240, mv.clientX - rect.left - 1))
        : Math.max(24, Math.min(240, rect.right - mv.clientX - 1));
      if (otherSide >= dragSideMin && Math.abs(next - otherSide) <= SNAP_PX) {
        next = otherSide;
      }
      pendingNext = next;
      if (rafId == null) rafId = requestAnimationFrame(flush);
    };
    const onUp = () => {
      document.body.style.cursor = prevCursor;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        flush();
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [persistedLeftMargin, persistedRightMargin]);

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
      if (ed) updateLinkedAnchorCard(ed, anchorId, "comment", created.id);
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
    const sel = readSelection();
    if (sel && innerRef.current) {
      const snippet = archiveHook.archiveContent(sel.text);
      const result = innerRef.current.archiveSelection(snippet.id);
      if (result) {
        if (result.content) archiveHook.updateSnippet(snippet.id, result.content);
        if (result.paragraphId) archiveHook.addParagraphId(snippet.id, result.paragraphId);
      }
      popCardAtAnchor("archive", snippet.id, anchorRect);
    } else {
      const snippet = archiveHook.archiveContent("");
      popCardAtAnchor("archive", snippet.id, anchorRect);
    }
  }, [readSelection, archiveHook, popCardAtAnchor]);

  const handleToolbarCreateFootnote = useCallback((anchorRect: DOMRect | null) => {
    cardCreation.createFootnote({ fromSelection: !!readSelection(), anchorRect });
  }, [readSelection, cardCreation]);

  const handleToolbarInsertCitation = useCallback((anchorRect: DOMRect | null) => {
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

  const actionsBundle = useMemo<ActionToolbarCallbacks>(() => ({
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
  }, [editor, docVersion]);
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

  // Drop handlers for the per-panel hosts. The Reader doesn't expose
  // panel drop targets (chrome filters most kinds), so these mostly
  // sit dormant — but they exist so post-7.8 the main app's panels
  // pick them up without re-wiring.
  const {
    handleDropSelectionOnNotes,
    handleDropParagraphOnNotes,
    handleDropSelectionOnCutter,
    handleDropParagraphOnCutter,
  } = useDropActions({
    editorRef: innerRef,
    addNote: notesHook.addNote,
    addCutterComment: cutterHook.addComment,
    setSelectedNoteId,
    setSelectedCutterCardId,
  });

  // Todo drops — create a fresh todo, link its paragraph, seed text
  // from the dropped selection where applicable. Mirrors EditorLayout.
  const handleDropSelectionOnTodo = useCallback(
    (payload: { from: number; to: number; selectedText: string }) => {
      if (!innerRef.current) return;
      const paragraphId = innerRef.current.ensureParagraphUuid(payload.from);
      const todo = todosHook.addItem();
      if (payload.selectedText) todosHook.updateItem(todo.id, payload.selectedText);
      if (paragraphId) todosHook.addParagraphId(todo.id, paragraphId);
      setSelectedTodoId(todo.id);
    },
    [todosHook],
  );
  const handleDropParagraphOnTodo = useCallback(
    (paragraphId: string) => {
      if (!paragraphId) return;
      const todo = todosHook.addItem();
      todosHook.addParagraphId(todo.id, paragraphId);
      setSelectedTodoId(todo.id);
    },
    [todosHook],
  );

  // Revisions drops — anchor-aware comment seeding; matches
  // EditorLayout's `handleDropSelectionOnRevisions` shape.
  const handleDropSelectionOnRevisions = useCallback(
    (payload: { from: number; to: number; selectedText: string }) => {
      const ed = innerRef.current?.getEditor();
      if (!ed) return;
      const record = createLinkedAnchor(ed, "revision", { from: payload.from, to: payload.to });
      if (!record) return;
      const created = revisionsHook.addComment(null, undefined, {
        anchorId: record.anchorId,
        anchorText: payload.selectedText || record.text,
      });
      updateLinkedAnchorCard(ed, record.anchorId, "comment", created.id);
      setSelectedCommentId(created.id);
    },
    [revisionsHook],
  );
  const handleDropParagraphOnRevisions = useCallback(
    (paragraphId: string) => {
      const created = revisionsHook.addComment(paragraphId);
      setSelectedCommentId(created.id);
    },
    [revisionsHook],
  );

  // Archive helpers — anchored-id set + paragraph-order sort matching
  // EditorLayout. The ArchivePanel uses these to surface anchored
  // snippets at the top of the list.
  const anchoredArchiveIds = useMemo<Set<string>>(() => {
    const ids = new Set<string>();
    for (const s of archiveHook.snippets) {
      if (getLinkedParagraphIds(s).length > 0) ids.add(s.id);
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
      const aPids = getLinkedParagraphIds(a);
      const bPids = getLinkedParagraphIds(b);
      const aPos = aPids.length > 0 ? paragraphOrder.get(aPids[0]) : undefined;
      const bPos = bPids.length > 0 ? paragraphOrder.get(bPids[0]) : undefined;
      if (aPos != null && bPos != null) return aPos - bPos;
      if (aPos != null) return -1;
      if (bPos != null) return 1;
      return 0;
    });
  }, [archiveHook.snippets, docVersion, editor]);
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
  const handleArchiveCapture = useCallback(
    (payload: { content: unknown; paragraphId: string | null }) => {
      // archiveContent seeds the snippet from a selection text; the
      // ArchivePanel here hands us pre-built JSONContent which the
      // hook stores directly. EditorLayout's full archive-from-editor
      // flow lands when toolbar/popout state moves over.
      const snippet = archiveHook.archiveContent(
        typeof payload.content === "string" ? payload.content : "",
      );
      if (payload.paragraphId) archiveHook.addParagraphId(snippet.id, payload.paragraphId);
      setSelectedArchiveId(snippet.id);
    },
    [archiveHook],
  );

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
  // doc, debounced via `docVersion` (mirrors EditorLayout's pattern).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const citationOrder = useMemo<string[]>(
    () => innerRef.current?.getCitationOrder() ?? [],
    [editor, docVersion],
  );

  // Live FootnoteInfo list, recomputed when the doc version bumps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const footnoteInfos = useMemo(
    () => innerRef.current?.getFootnotes() ?? [],
    [editor, docVersion],
  );

  // Live ExampleInfo list — same trigger cadence as footnoteInfos.
  // Powers the popped-out example card renderer below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const examples = useMemo(
    () => innerRef.current?.getExamples() ?? [],
    [editor, docVersion],
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
  // strip, so the strip-render path filters them out.
  const sideForKind = useCallback(
    (k: PanelKind): "left" | "right" | null =>
      placementSideByKind.get(k) ?? PANEL_REGISTRY[k]?.defaultStripSide ?? null,
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
      else if (panel === "quotations") { setSelectedQuotationGroupId(itemId); setActivePanelKindBySide("quotations"); }
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
      footnotes: footnoteInfos,
      archiveSnippets: archiveHook.snippets,
      cutterCards: cutterHook.cards,
      todoItems: todosHook.items,
      bibEntries: citationsHook.bibEntries,
      citations: citationsHook.citations,
      citationPositionMap,
      allEditorCitations,
      comments: revisionsHook.cards,
      quotationGroups: quotationsHook.groups,
      aiRequests: aiRequestsHook.requests,
      examples,
      anchoredIds: anchoredArchiveIds,

      // Selection slots + setters (per-pane)
      selectedNoteId,
      selectedFootnoteId,
      selectedArchiveId,
      selectedCutterCardId,
      selectedTodoId,
      selectedBibKey,
      selectedCitationId,
      selectedCommentId,
      selectedQuotationGroupId,
      selectedExampleId,
      setSelectedNoteId,
      setSelectedFootnoteId,
      setSelectedArchiveId,
      setSelectedCutterCardId,
      setSelectedTodoId,
      setSelectedBibKey,
      setSelectedCitationId,
      setSelectedCommentId,
      setSelectedQuotationGroupId,
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
      deleteNote: notesHook.deleteNote,

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

      // Citations
      updateCitation: citationsHook.updateCitation,
      deleteCitation: citationsHook.deleteCitation,

      // Revisions
      updateRevisionCommentContent: revisionsHook.updateCommentContent,
      updateRevisionCommentText: revisionsHook.updateCommentText,
      setRevisionCommentAiRequest: revisionsHook.setCommentAiRequest,
      updateRevisionSuggestionField: revisionsHook.updateSuggestionField,
      setRevisionSuggestionStatus: revisionsHook.setSuggestionStatus,
      deleteRevisionCard: revisionsHook.deleteCard,

      // Quotations
      deleteQuotationGroup: quotationsHook.deleteGroup,
      updateQuotationGroupTitle: quotationsHook.updateGroupTitle,
      addQuotationReference: quotationsHook.addReference,
      deleteQuotationReference: quotationsHook.deleteReference,
      updateQuotationReferenceCiteKey: quotationsHook.updateReferenceCiteKey,
      addQuotationQuote: quotationsHook.addQuote,
      updateQuotationQuote: quotationsHook.updateQuote,
      deleteQuotationQuote: quotationsHook.deleteQuote,
      updateQuotationNotes: quotationsHook.updateNotes,

      // AI Requests
      updateAiRequestText: aiRequestsHook.updateRequestText,
      deleteAiRequest: aiRequestsHook.deleteRequest,
    }),
    [
      notesHook, footnoteInfos, archiveHook, cutterHook, todosHook,
      citationsHook, annotationsHook, bibReviewHook, revisionsHook,
      quotationsHook, aiRequestsHook,
      citationPositionMap, allEditorCitations, examples, anchoredArchiveIds,
      selectedNoteId, selectedFootnoteId, selectedArchiveId,
      selectedCutterCardId, selectedTodoId, selectedBibKey,
      selectedCitationId, selectedCommentId, selectedQuotationGroupId,
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
  ]);

  // ── Anchored-card hover/selection bridges + highlight painters ────
  // The whole all-for-one model lives here so reader and editor share
  // identical plumbing (the Library reader mounts EditorPane standalone).
  // hoveredEntityId/Kind is a thin adapter over cardStore.hover so the
  // existing per-pair hook signatures keep working through the migration.
  const _paneHover = useHover();
  const _hoveredEntityId = _paneHover?.id ?? null;
  const _hoveredEntityKind = _paneHover?.kind ?? null;
  const _setHoveredEntity = useCallback(
    (id: string | null, kind: EntityKind | null) =>
      cardStore.setHover(id && kind ? { id, kind } : null),
    [],
  );

  useCardSelectionHighlight({
    editor,
    selectedNoteId,
    selectedFootnoteId,
    selectedCitationId,
    selectedCutterCardId,
    selectedCommentId,
    selectedTodoId,
    selectedArchiveId,
    selectedQuotationGroupId,
    notes: notesHook.notes,
    cutterCards: cutterHook.cards,
    archiveSnippets: archiveHook.snippets,
    quotationGroups: quotationsHook.groups,
    todos: todosHook.items,
    comments: revisionsHook.cards,
  });

  // ExampleInfo carries `exampleId`, not `id`; the entity-collections
  // shape uses `id`. Adapt at the boundary so the entity vocabulary
  // stays uniform.
  const _examplesAsEntities = useMemo(
    () => examples.map((e) => ({ id: e.exampleId })),
    [examples],
  );
  useCardHoverHighlight({
    editor,
    hoveredEntityId: _hoveredEntityId,
    hoveredEntityKind: _hoveredEntityKind,
    notes: notesHook.notes,
    cutterCards: cutterHook.cards,
    archiveSnippets: archiveHook.snippets,
    quotationGroups: quotationsHook.groups,
    todos: todosHook.items,
    comments: revisionsHook.cards,
    examples: _examplesAsEntities,
  });

  useTextHoverBridge({
    editor,
    notes: notesHook.notes,
    cutterCards: cutterHook.cards,
    comments: revisionsHook.cards,
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
      todos: todosHook.items,
      archiveSnippets: archiveHook.snippets,
      quotationGroups: quotationsHook.groups,
      examples: _examplesAsEntities,
    },
  });

  return (
    <EditorChromeProvider value={chrome}>
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
          {/* Body-portaled outlines for dock-target / card-lift drag
              affordances. Both read state from module-level singletons
              (useDockDragTarget / useCardLiftTarget) — Reader has no
              drag sources so they sit inert. Step 7.8 removes the
              EditorLayout copies. */}
          <DockOutline />
          <CardLiftOutline />
          {/* Per-doc card popouts — paragraph / heading / example floats
              and individual card popouts (notes, footnotes, citations,
              etc.). Each entry in `prefs.poppedOutCards` keys a
              `${kind}:${id}` to a card kind handled by `renderPoppedCard`,
              which wraps the card in a `<FloatCard>` (portal to body).
              Reader passes no `viewPrefs` → block stays dormant; main
              app gates on `!zenMode` so Zen retains popout state but
              hides the floats. */}
          {viewPrefs && !viewPrefs.zenMode &&
            viewPrefs.prefs.poppedOutCards.map((key) =>
              renderPoppedCard(key, popoutsDeps),
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
                  onQuoteSelection: handleToolbarQuoteSelection,
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
                    content={editor ? (editor.getJSON() as JSONContent) : null}
                    docVersion={docVersion}
                    docId={docId}
                    citationsHook={citationsHook}
                    annotationsHook={annotationsHook}
                    bibReviewHook={bibReviewHook}
                    bibSettingsHook={bibSettingsHook}
                    notesHook={notesHook}
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
                    revisionsPanelSide={revisionsPanelSide}
                    onDropSelectionOnNotes={handleDropSelectionOnNotes}
                    onDropParagraphOnNotes={handleDropParagraphOnNotes}
                    onDropSelectionOnTodo={handleDropSelectionOnTodo}
                    onDropParagraphOnTodo={handleDropParagraphOnTodo}
                    onDropSelectionOnCutter={handleDropSelectionOnCutter}
                    onDropParagraphOnCutter={handleDropParagraphOnCutter}
                    onDropSelectionOnRevisions={handleDropSelectionOnRevisions}
                    onDropParagraphOnRevisions={handleDropParagraphOnRevisions}
                    discardPristineNotes={notesHook.discardPristineNotes}
                    todosHook={todosHook}
                    archiveHook={archiveHook}
                    cutterHook={cutterHook}
                    revisionsHook={revisionsHook}
                    quotationsHook={quotationsHook}
                    sortedArchiveSnippets={sortedArchiveSnippets}
                    anchoredArchiveIds={anchoredArchiveIds}
                    onArchiveInsert={handleArchiveInsert}
                    onArchiveRestore={handleArchiveRestore}
                    onArchiveDelete={handleArchiveDelete}
                    onArchiveCapture={handleArchiveCapture}
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
                      content={editor ? (editor.getJSON() as JSONContent) : null}
                      docVersion={docVersion}
                      docId={docId}
                      citationsHook={citationsHook}
                      annotationsHook={annotationsHook}
                      bibReviewHook={bibReviewHook}
                      bibSettingsHook={bibSettingsHook}
                      notesHook={notesHook}
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
                      revisionsPanelSide={revisionsPanelSide}
                      onDropSelectionOnNotes={handleDropSelectionOnNotes}
                      onDropParagraphOnNotes={handleDropParagraphOnNotes}
                      onDropSelectionOnTodo={handleDropSelectionOnTodo}
                      onDropParagraphOnTodo={handleDropParagraphOnTodo}
                      onDropSelectionOnCutter={handleDropSelectionOnCutter}
                      onDropParagraphOnCutter={handleDropParagraphOnCutter}
                      onDropSelectionOnRevisions={handleDropSelectionOnRevisions}
                      onDropParagraphOnRevisions={handleDropParagraphOnRevisions}
                      discardPristineNotes={notesHook.discardPristineNotes}
                      todosHook={todosHook}
                      archiveHook={archiveHook}
                      cutterHook={cutterHook}
                      revisionsHook={revisionsHook}
                      quotationsHook={quotationsHook}
                      sortedArchiveSnippets={sortedArchiveSnippets}
                      anchoredArchiveIds={anchoredArchiveIds}
                      onArchiveInsert={handleArchiveInsert}
                      onArchiveRestore={handleArchiveRestore}
                      onArchiveDelete={handleArchiveDelete}
                      onArchiveCapture={handleArchiveCapture}
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
            {viewPrefs?.zenMode ? (
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
                docVersion={docVersion}
                docId={docId}
                citationsHook={citationsHook}
                annotationsHook={annotationsHook}
                bibReviewHook={bibReviewHook}
                bibSettingsHook={bibSettingsHook}
                notesHook={notesHook}
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
                revisionsPanelSide={revisionsPanelSide}
                onDropSelectionOnNotes={handleDropSelectionOnNotes}
                onDropParagraphOnNotes={handleDropParagraphOnNotes}
                onDropSelectionOnTodo={handleDropSelectionOnTodo}
                onDropParagraphOnTodo={handleDropParagraphOnTodo}
                onDropSelectionOnCutter={handleDropSelectionOnCutter}
                onDropParagraphOnCutter={handleDropParagraphOnCutter}
                onDropSelectionOnRevisions={handleDropSelectionOnRevisions}
                onDropParagraphOnRevisions={handleDropParagraphOnRevisions}
                discardPristineNotes={notesHook.discardPristineNotes}
                todosHook={todosHook}
                archiveHook={archiveHook}
                cutterHook={cutterHook}
                revisionsHook={revisionsHook}
                quotationsHook={quotationsHook}
                sortedArchiveSnippets={sortedArchiveSnippets}
                anchoredArchiveIds={anchoredArchiveIds}
                onArchiveInsert={handleArchiveInsert}
                onArchiveRestore={handleArchiveRestore}
                onArchiveDelete={handleArchiveDelete}
                onArchiveCapture={handleArchiveCapture}
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
                topOverlay={
                  <MarginActionToolbar
                    side="left"
                    actions={actionsBundle}
                    placements={effectivePlacements}
                  />
                }
              />
            )}
            {/* Column wrapper — sits between the two PaneRails. Holds the
                docked MenuBar (when `menuBar` is provided) plus the
                editor pod. Path A 7.6 finish (additive) introduced this
                wrapper so the docked MenuBar can mount sticky-above the
                pod; Reader (no menuBar) renders only the pod inside. */}
            <div
              ref={editorColRef}
              className={`editor-pane-column${menuBar?.showParTitles === false ? " hide-par-titles" : ""}${menuBar?.showLatexComments === false ? " hide-latex-comments" : ""}${menuBar?.showHeadingLabels === false ? " hide-heading-labels" : ""}${dividerClassName ? ` ${dividerClassName}` : ""}${menuBar ? ` dividers-width-${menuBar.dividerWidth}` : ""}`}
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
                // Span the full editor scroll height so the sticky
                // descendants below (docked MenuBar, top/bottom pod
                // caps, Section Lozenge, expand-all controls,
                // margin-edit guides) keep their stickiness across the
                // whole document. Without this, sticky's containing
                // block is the row's ~688px viewport height and
                // descendants drift after a few hundred px of scroll.
                // `--row-bound-h` is set on the row scroll container
                // by EditorScrollbar (= editor's scrollHeight); falls
                // back to 100% before first measurement. The
                // `max(…, 100%)` floor guarantees the pod (flex:1000
                // inside this column) extends at least to the scroll
                // port bottom even when the doc is shorter than the
                // viewport, so a short document doesn't end before
                // the sticky bottom cap and create a "double bottom
                // edge" (pod's own border + cap).
                minHeight: 'max(var(--row-bound-h, 100%), 100%)',
                // In-editor text margins. Read by the prose class in
                // Editor.tsx via pl-[var(--editor-pl,88px)] /
                // pr-[var(--editor-pr,72px)]. Driven by persisted
                // prefs, overridden by the live values during
                // margin-edit mode.
                ['--editor-pl' as string]: `${effectiveLeftMargin}px`,
                ['--editor-pr' as string]: `${effectiveRightMargin}px`,
              }}
            >
            {menuBar && (overrideEditor ?? editor) && (
              <div
                data-tool-strip="text"
                className="flex justify-center items-start shrink-0 sticky z-40"
                style={{
                  background: "var(--background)",
                  top: 0,
                  height: 32,
                  paddingTop: 4,
                  marginLeft: -4,
                  marginRight: -4,
                  pointerEvents: "none",
                }}
              >
                {/* Margin-edit Save/Cancel — only renders during the
                    transient margin-edit mode. Anchored absolutely to
                    the left of the band so it doesn't displace the
                    centered MenuBar pod. */}
                {marginEditMode && (
                  <div
                    className="absolute left-2 top-0 h-full flex items-center gap-1 pointer-events-auto"
                    style={{ paddingTop: 4 }}
                  >
                    <button
                      type="button"
                      onClick={cancelMarginEdit}
                      className="text-[11px] px-2 py-0.5 rounded border border-[var(--border)] bg-surface text-ink-body hover-on-light"
                      title="Discard margin changes (Esc)"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={saveMarginEdit}
                      className="text-[11px] px-2 py-0.5 rounded border border-[var(--accent)] bg-[var(--accent)] text-white hover:opacity-90"
                      title="Save margins"
                    >
                      Save
                    </button>
                  </div>
                )}
                <div ref={dockedMenuBarRef} className="pointer-events-auto">
                  <MenuBar
                    editor={overrideEditor ?? editor}
                    onAddComment={handleToolbarAddComment}
                    onArchive={handleToolbarArchive}
                    onCreateFootnote={handleToolbarCreateFootnote}
                    onQuoteSelection={handleToolbarQuoteSelection}
                    onAddNote={handleToolbarAddNote}
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
            {/* Sticky pod-top cap. Container is 16px tall (8 of
                manilla band at top + 8 for the white cap-inner at
                bottom) with marginBottom: -16 negating its flow
                contribution. Mirror image of the bottom cap. The
                manilla band above the inner cap is essential: it's
                the canvas the inner cap's upward ambient shadow
                renders into, and it masks the editor content
                scrolling past in the top 8px of the viewport, so
                only manilla is visible there. The cap container's
                lateral bleed (calc(-4px - var(--pod-gap))) extends
                the manilla into the column gutters too. Sticks at
                top:32 below the docked MenuBar's 32px band when
                present (main editor); top:0 otherwise (Reader, which
                keeps the dock dormant). */}
            {(overrideEditor ?? editor) && (
              <div
                data-editor-pod-cap
                className="sticky z-30 shrink-0 pointer-events-none flex flex-col"
                style={{
                  top: menuBar ? 32 : 0,
                  height: 16,
                  marginBottom: -16,
                  marginLeft: 'calc(-4px - var(--pod-gap))',
                  marginRight: 'calc(-4px - var(--pod-gap))',
                  background: 'var(--background)',
                  justifyContent: 'flex-end',
                }}
              >
                <div
                  style={{
                    height: 8,
                    marginLeft: 'calc(4px + var(--pod-gap))',
                    marginRight: 'calc(4px + var(--pod-gap))',
                    background: 'var(--pod-editor)',
                    borderTop: 'var(--pod-border)',
                    borderLeft: 'var(--pod-border)',
                    borderRight: 'var(--pod-border)',
                    borderTopLeftRadius: 'var(--pod-radius)',
                    borderTopRightRadius: 'var(--pod-radius)',
                    boxShadow: '0 -1px 6px rgba(0,0,0,0.12), 0 0 2px rgba(0,0,0,0.06)',
                    clipPath: 'inset(-20px 0 0 0)',
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
                sticky chrome above (docked MenuBar 32 + pod cap 16 = 48
                in main editor; 16 in Reader). z-31 puts it above the
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
                  top: menuBar ? 48 : 16,
                  zIndex: 31,
                  marginBottom: -4,
                }}
                onMouseDown={onTopGutterDown}
              />
            )}
            <div
              className="editor-pane-pod"
              data-marginalia-host
              style={{
                flex: viewPrefs ? "1000 1 0" : "1 1 0",
                minWidth: 0,
                background: "var(--surface)",
                border: "var(--pod-border)",
                borderRadius: "var(--pod-radius)",
                boxShadow: "var(--pod-shadow)",
                // Clip the box-shadow at top and bottom so it doesn't
                // bleed into the manilla band (top) or past the bottom
                // cap into the column padding region. The caps carry
                // their own ambient shadows; the pod's shadow extends
                // laterally only.
                clipPath: menuBar ? 'inset(0 -20px 0 -20px)' : undefined,
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
              {/* Sticky section-path lozenge — pinned at the top of the
                  pod so the current section header reads through the
                  first line of editor content. Wrapper height is 0 so
                  it takes no flow space; the pill renders downward
                  with a translucent backdrop-blur. */}
              {menuBar?.showSectionIndicator && viewPrefs && (overrideEditor ?? editor) && (
                <div
                  className="sticky z-20 shrink-0 flex justify-center pointer-events-none"
                  style={{ top: 0, height: 0 }}
                >
                  <SectionLozenge sectionPath={viewPrefs.activeSectionPath} />
                </div>
              )}
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
                      title="Expand all sections"
                    >
                      <svg width="11" height="8" viewBox="0 0 14 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 1 L7 4.5 L12 1" />
                        <path d="M2 5.5 L7 9 L12 5.5" />
                      </svg>
                    </button>
                    <button
                      onClick={() => innerRef.current?.collapseAllSections()}
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
              <div className="paper-render" data-editor-page="true" style={{ position: "relative" }}>
                {/* In-text margin guides — only render in the dedicated
                    margin-edit mode. Each guide is a draggable hit
                    area centered on a 1.5px line in drag-highlight
                    blue. Positioned relative to the page wrapper
                    (this div). The +1px offset accounts for the pod's
                    left/right border so the line lands exactly at the
                    prose text edge. */}
                {marginEditMode && viewPrefs && (() => {
                  const symmetric = effectiveLeftMargin === effectiveRightMargin;
                  const Marker = (
                    <div
                      className="sticky pointer-events-none"
                      style={{
                        top: 44,
                        left: 1.5,
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: "var(--drag-highlight)",
                        border: "1.5px solid #fff",
                        boxShadow: "0 0 8px rgba(59, 130, 246, 0.7), 0 0 2px rgba(59, 130, 246, 0.9)",
                      }}
                    />
                  );
                  return (
                    <>
                      <div
                        data-margin-guide="left"
                        data-margin-snap={symmetric ? "true" : undefined}
                        className="absolute top-0 bottom-0 z-10 pointer-events-auto"
                        style={{
                          left: "calc(var(--editor-pl) + 1px - 6px)",
                          width: 13,
                          cursor: "ew-resize",
                        }}
                        onMouseDown={(e) => beginMarginDrag(e, "left")}
                        title="Drag to set left margin"
                      >
                        <div
                          className="absolute top-0 bottom-0 pointer-events-none"
                          style={{
                            left: 6.5,
                            width: 1,
                            background: "var(--drag-highlight)",
                            boxShadow: "0 0 4px rgba(59, 130, 246, 0.35)",
                          }}
                        />
                        {symmetric && Marker}
                      </div>
                      <div
                        data-margin-guide="right"
                        data-margin-snap={symmetric ? "true" : undefined}
                        className="absolute top-0 bottom-0 z-10 pointer-events-auto"
                        style={{
                          right: "calc(var(--editor-pr) + 1px - 6px)",
                          width: 13,
                          cursor: "ew-resize",
                        }}
                        onMouseDown={(e) => beginMarginDrag(e, "right")}
                        title="Drag to set right margin"
                      >
                        <div
                          className="absolute top-0 bottom-0 pointer-events-none"
                          style={{
                            left: 6.5,
                            width: 1,
                            background: "var(--drag-highlight)",
                            boxShadow: "0 0 4px rgba(59, 130, 246, 0.35)",
                          }}
                        />
                        {symmetric && Marker}
                      </div>
                    </>
                  );
                })()}
                {(initialContent ?? docHook.content) != null && (
                  <VirgilEditor
                    ref={innerRef}
                    initialContent={(initialContent ?? docHook.content) as JSONContent}
                    onUpdate={(doc) => {
                      // Forward to caller-supplied handler first (Reader
                      // omits — read-only), then drive the canonical
                      // debounced writeback through `useDocument` so
                      // EditorPane is the sole save path once mounted
                      // in the main app.
                      onUpdate?.(doc);
                      docHook.onUpdate(doc);
                    }}
                    highlightText={highlightText}
                    highlightRange={highlightRange}
                    editable={editable}
                    onEditorReady={handleEditorReady}
                    paragraphIsPoppedRef={paragraphIsPoppedRef}
                    onToggleParagraphPopout={handleToggleParagraphPopout}
                    onLiftParagraph={handleLiftParagraph}
                    headingIsPoppedRef={headingIsPoppedRef}
                    onToggleHeadingPopout={handleToggleHeadingPopout}
                    onLiftHeading={handleLiftHeading}
                    exampleIsPoppedRef={exampleIsPoppedRef}
                    onToggleExamplePopout={handleToggleExamplePopout}
                    onDragHandleClick={openDragHandleMenu}
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
                        docVersion={docVersion}
                        docId={docId}
                        citationsHook={citationsHook}
                        annotationsHook={annotationsHook}
                        bibReviewHook={bibReviewHook}
                        bibSettingsHook={bibSettingsHook}
                        notesHook={notesHook}
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
                        revisionsPanelSide={revisionsPanelSide}
                        onDropSelectionOnNotes={handleDropSelectionOnNotes}
                        onDropParagraphOnNotes={handleDropParagraphOnNotes}
                        onDropSelectionOnTodo={handleDropSelectionOnTodo}
                        onDropParagraphOnTodo={handleDropParagraphOnTodo}
                        onDropSelectionOnCutter={handleDropSelectionOnCutter}
                        onDropParagraphOnCutter={handleDropParagraphOnCutter}
                        onDropSelectionOnRevisions={handleDropSelectionOnRevisions}
                        onDropParagraphOnRevisions={handleDropParagraphOnRevisions}
                        discardPristineNotes={notesHook.discardPristineNotes}
                        todosHook={todosHook}
                        archiveHook={archiveHook}
                        cutterHook={cutterHook}
                        revisionsHook={revisionsHook}
                        quotationsHook={quotationsHook}
                        sortedArchiveSnippets={sortedArchiveSnippets}
                        anchoredArchiveIds={anchoredArchiveIds}
                        onArchiveInsert={handleArchiveInsert}
                        onArchiveRestore={handleArchiveRestore}
                        onArchiveDelete={handleArchiveDelete}
                        onArchiveCapture={handleArchiveCapture}
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
            </div>
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
            {/* Sticky pod-bottom cap. Container is 16px tall (8 for
                the white cap-inner at top + 8 of manilla band below)
                with marginTop: -16 negating its flow contribution.
                The manilla band is essential: it masks the editor
                content scrolling past in the bottom 8px of the
                viewport, so only manilla is visible there. The cap
                container's lateral bleed (calc(-4px - var(--pod-gap)))
                extends the manilla into the column gutters too. */}
            {(overrideEditor ?? editor) && (
              <div
                data-editor-pod-cap-bottom
                className="sticky z-30 shrink-0 pointer-events-none flex flex-col"
                style={{
                  bottom: 0,
                  height: 16,
                  marginTop: -16,
                  marginLeft: 'calc(-4px - var(--pod-gap))',
                  marginRight: 'calc(-4px - var(--pod-gap))',
                  background: 'var(--background)',
                }}
              >
                <div
                  style={{
                    height: 8,
                    marginLeft: 'calc(4px + var(--pod-gap))',
                    marginRight: 'calc(4px + var(--pod-gap))',
                    background: 'var(--pod-editor)',
                    borderBottom: 'var(--pod-border)',
                    borderLeft: 'var(--pod-border)',
                    borderRight: 'var(--pod-border)',
                    borderBottomLeftRadius: 'var(--pod-radius)',
                    borderBottomRightRadius: 'var(--pod-radius)',
                    boxShadow: 'var(--pod-shadow)',
                    clipPath: 'inset(0 0 -20px 0)',
                  }}
                />
              </div>
            )}
            </div>
            {viewPrefs?.zenMode ? (
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
                docVersion={docVersion}
                docId={docId}
                citationsHook={citationsHook}
                annotationsHook={annotationsHook}
                bibReviewHook={bibReviewHook}
                bibSettingsHook={bibSettingsHook}
                notesHook={notesHook}
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
                revisionsPanelSide={revisionsPanelSide}
                onDropSelectionOnNotes={handleDropSelectionOnNotes}
                onDropParagraphOnNotes={handleDropParagraphOnNotes}
                onDropSelectionOnTodo={handleDropSelectionOnTodo}
                onDropParagraphOnTodo={handleDropParagraphOnTodo}
                onDropSelectionOnCutter={handleDropSelectionOnCutter}
                onDropParagraphOnCutter={handleDropParagraphOnCutter}
                onDropSelectionOnRevisions={handleDropSelectionOnRevisions}
                onDropParagraphOnRevisions={handleDropParagraphOnRevisions}
                discardPristineNotes={notesHook.discardPristineNotes}
                todosHook={todosHook}
                archiveHook={archiveHook}
                cutterHook={cutterHook}
                revisionsHook={revisionsHook}
                quotationsHook={quotationsHook}
                sortedArchiveSnippets={sortedArchiveSnippets}
                anchoredArchiveIds={anchoredArchiveIds}
                onArchiveInsert={handleArchiveInsert}
                onArchiveRestore={handleArchiveRestore}
                onArchiveDelete={handleArchiveDelete}
                onArchiveCapture={handleArchiveCapture}
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
                topOverlay={
                  <MarginActionToolbar
                    side="right"
                    actions={actionsBundle}
                    placements={effectivePlacements}
                  />
                }
              />
            )}
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
              outset={3}
            />
          )}
          {dragHandleMenuState && (
            <DragHandleMenu
              anchorRect={dragHandleMenuState.anchorRect}
              onSelect={(action) => {
                const passage = dragHandleMenuState.passage;
                closeDragHandleMenu();
                dragHandleActions.dispatch(action, passage);
              }}
              onClose={closeDragHandleMenu}
            />
          )}
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
  docVersion: number;
  docId: string;
  citationsHook: ReturnType<typeof useCitations>;
  annotationsHook: ReturnType<typeof useAnnotations>;
  bibReviewHook: ReturnType<typeof useBibReview>;
  bibSettingsHook: ReturnType<typeof useBibSettings>;
  notesHook: ReturnType<typeof useNotes>;
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
  revisionsPanelSide: "left" | "right" | null;
  onDropSelectionOnNotes: (payload: { from: number; to: number; selectedText: string }) => void;
  onDropParagraphOnNotes: (paragraphId: string) => void;
  onDropSelectionOnTodo: (payload: { from: number; to: number; selectedText: string }) => void;
  onDropParagraphOnTodo: (paragraphId: string) => void;
  onDropSelectionOnCutter: (payload: { from: number; to: number; selectedText: string }) => void;
  onDropParagraphOnCutter: (paragraphId: string) => void;
  onDropSelectionOnRevisions: (payload: { from: number; to: number; selectedText: string }) => void;
  onDropParagraphOnRevisions: (paragraphId: string) => void;
  discardPristineNotes: () => void;
  todosHook: ReturnType<typeof useTodos>;
  archiveHook: ReturnType<typeof useArchive>;
  cutterHook: ReturnType<typeof useCutter>;
  revisionsHook: ReturnType<typeof useRevisions>;
  quotationsHook: ReturnType<typeof useQuotations>;
  sortedArchiveSnippets: ReturnType<typeof useArchive>["snippets"];
  anchoredArchiveIds: Set<string>;
  onArchiveInsert: (id: string) => void;
  onArchiveRestore: (id: string) => void;
  onArchiveDelete: (id: string) => void;
  onArchiveCapture: (payload: { content: unknown; paragraphId: string | null }) => void;
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
  /** Sticky overlay rendered at the top of the panel column — the
   *  per-side `MarginActionToolbar`. Forwarded as `topOverlay` to
   *  `PanelColumn`. */
  topOverlay?: React.ReactNode;
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
          title={activeOnSide ? "Collapse panel" : "Expand panel"}
          data-helper="Toggle sidebar"
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
          onClick={() => {
            if (activeOnSide === "blank") {
              isLeft ? viewPrefs.setActiveLeft("omni") : viewPrefs.setActiveRight("omni");
            } else {
              viewPrefs.setBlank(side);
            }
          }}
          className="iconbtn-md iconbtn-toggle"
          aria-pressed={activeOnSide === "blank"}
          title={activeOnSide === "blank" ? "Show omni-view" : "Hide omni-view"}
          data-helper="Omni view"
        >
          <IconBlank active={activeOnSide === "blank"} />
        </button>
        <button
          onClick={() => viewPrefs.toggleSplit(side)}
          className="iconbtn-md iconbtn-toggle"
          aria-pressed={activeBottomOnSide != null}
          title={activeBottomOnSide != null ? "Unsplit panel" : "Split panel horizontally"}
          data-helper="Split panel"
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
          iconDropMimes={viewPrefs.iconDropMimesByPanel[p]}
          onIconDrop={(dt) => viewPrefs.handleIconDrop(p, dt)}
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
  docVersion,
  docId,
  citationsHook,
  annotationsHook,
  bibReviewHook,
  bibSettingsHook,
  notesHook,
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
  revisionsPanelSide,
  onDropSelectionOnNotes,
  onDropParagraphOnNotes,
  onDropSelectionOnTodo,
  onDropParagraphOnTodo,
  onDropSelectionOnCutter,
  onDropParagraphOnCutter,
  onDropSelectionOnRevisions,
  onDropParagraphOnRevisions,
  discardPristineNotes,
  todosHook,
  archiveHook,
  cutterHook,
  revisionsHook,
  quotationsHook,
  sortedArchiveSnippets,
  anchoredArchiveIds,
  onArchiveInsert,
  onArchiveRestore,
  onArchiveDelete,
  onArchiveCapture,
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
  topOverlay,
}: PaneRailProps) {
  const isLeft = side === "left";

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
    const cardsOffset = (side === "left"
      ? viewPrefs.cardsOffset?.left
      : viewPrefs.cardsOffset?.right);
    const cardsSilent = (side === "left"
      ? viewPrefs.cardsSilent?.left
      : viewPrefs.cardsSilent?.right);

    // Live examples list — matches OmniHost's `examples` prop. Cheap
    // re-derivation; OmniHost's outer useMemo on its `items` array
    // shields downstream from identity churn.
    const examples = editorRef.current?.getExamples() ?? [];

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
          quotationGroups={quotationsHook.groups}
          deleteQuotationGroup={quotationsHook.deleteGroup}
          updateQuotationGroupTitle={quotationsHook.updateGroupTitle}
          addQuotationReference={quotationsHook.addReference}
          deleteQuotationReference={quotationsHook.deleteReference}
          updateQuotationReferenceCiteKey={quotationsHook.updateReferenceCiteKey}
          addQuotationQuote={quotationsHook.addQuote}
          updateQuotationQuote={quotationsHook.updateQuote}
          deleteQuotationQuote={quotationsHook.deleteQuote}
          updateQuotationNotes={quotationsHook.updateNotes}
          notes={notesHook.notes}
          updateNote={notesHook.updateNote}
          updateNoteTitle={notesHook.updateNoteTitle}
          setNoteAiRequest={notesHook.setNoteAiRequest}
          deleteNote={notesHook.deleteNote}
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
          updateRevisionCommentText={revisionsHook.updateCommentText}
          setRevisionCommentAiRequest={revisionsHook.setCommentAiRequest}
          updateRevisionSuggestionField={revisionsHook.updateSuggestionField}
          setRevisionSuggestionStatus={revisionsHook.setSuggestionStatus}
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
          getOmniEnabled={viewPrefs.getOmniEnabled}
          getOmniHideAll={viewPrefs.getOmniHideAll}
          cardsOffset={cardsOffset}
          cardsSilent={cardsSilent}
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
        focusedHalf={focusedHalf}
        onFocusHalf={onFocusHalf}
        tail={tail}
        topOverlay={topOverlay}
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
        tail={tail}
        topOverlay={topOverlay}
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
  docVersion: number;
  docId: string;
  citationsHook: ReturnType<typeof useCitations>;
  annotationsHook: ReturnType<typeof useAnnotations>;
  bibReviewHook: ReturnType<typeof useBibReview>;
  bibSettingsHook: ReturnType<typeof useBibSettings>;
  notesHook: ReturnType<typeof useNotes>;
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
  revisionsPanelSide: "left" | "right" | null;
  onDropSelectionOnNotes: (payload: { from: number; to: number; selectedText: string }) => void;
  onDropParagraphOnNotes: (paragraphId: string) => void;
  onDropSelectionOnTodo: (payload: { from: number; to: number; selectedText: string }) => void;
  onDropParagraphOnTodo: (paragraphId: string) => void;
  onDropSelectionOnCutter: (payload: { from: number; to: number; selectedText: string }) => void;
  onDropParagraphOnCutter: (paragraphId: string) => void;
  onDropSelectionOnRevisions: (payload: { from: number; to: number; selectedText: string }) => void;
  onDropParagraphOnRevisions: (paragraphId: string) => void;
  discardPristineNotes: () => void;
  todosHook: ReturnType<typeof useTodos>;
  archiveHook: ReturnType<typeof useArchive>;
  cutterHook: ReturnType<typeof useCutter>;
  revisionsHook: ReturnType<typeof useRevisions>;
  quotationsHook: ReturnType<typeof useQuotations>;
  sortedArchiveSnippets: ReturnType<typeof useArchive>["snippets"];
  anchoredArchiveIds: Set<string>;
  onArchiveInsert: (id: string) => void;
  onArchiveRestore: (id: string) => void;
  onArchiveDelete: (id: string) => void;
  onArchiveCapture: (payload: { content: unknown; paragraphId: string | null }) => void;
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
  docVersion,
  docId,
  citationsHook,
  annotationsHook,
  bibReviewHook,
  bibSettingsHook,
  notesHook,
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
  revisionsPanelSide,
  onDropSelectionOnNotes,
  onDropParagraphOnNotes,
  onDropSelectionOnTodo,
  onDropParagraphOnTodo,
  onDropSelectionOnCutter,
  onDropParagraphOnCutter,
  onDropSelectionOnRevisions,
  onDropParagraphOnRevisions,
  discardPristineNotes,
  todosHook,
  archiveHook,
  cutterHook,
  revisionsHook,
  quotationsHook,
  sortedArchiveSnippets,
  anchoredArchiveIds,
  onArchiveInsert,
  onArchiveRestore,
  onArchiveDelete,
  onArchiveCapture,
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
      <ExamplesPanelHost editorRef={editorRef} docVersion={docVersion} />
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
        notes={notesHook.notes}
        addNote={notesHook.addNote}
        updateNote={notesHook.updateNote}
        updateNoteTitle={notesHook.updateNoteTitle}
        setNoteAiRequest={notesHook.setNoteAiRequest}
        deleteNote={notesHook.deleteNote}
        discardPristine={discardPristineNotes}
        onDropSelection={onDropSelectionOnNotes}
        onDropParagraph={onDropParagraphOnNotes}
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
        onDropSelection={onDropSelectionOnTodo}
        onDropParagraph={onDropParagraphOnTodo}
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
        onCapture={onArchiveCapture}
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
        onDropSelection={onDropSelectionOnCutter}
        onDropParagraph={onDropParagraphOnCutter}
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
        updateCommentText={revisionsHook.updateCommentText}
        setCommentAiRequest={revisionsHook.setCommentAiRequest}
        updateSuggestionField={revisionsHook.updateSuggestionField}
        setSuggestionStatus={revisionsHook.setSuggestionStatus}
        deleteCard={revisionsHook.deleteCard}
        discardPristine={revisionsHook.discardPristineCards}
        onDropSelection={onDropSelectionOnRevisions}
        onDropParagraph={onDropParagraphOnRevisions}
      />
    );
  }
  if (panelKind === "quotations") {
    return (
      <QuotationsHost
        side={side}
        quotationGroups={quotationsHook.groups}
        bibEntries={citationsHook.bibEntries}
        bibPackage={citationsHook.bibPackage}
        citationStyle={citationsHook.citationStyle}
        addQuotationGroup={quotationsHook.addGroup}
        deleteQuotationGroup={quotationsHook.deleteGroup}
        updateQuotationGroupTitle={quotationsHook.updateGroupTitle}
        addQuotationReference={quotationsHook.addReference}
        deleteQuotationReference={quotationsHook.deleteReference}
        updateQuotationReferenceCiteKey={quotationsHook.updateReferenceCiteKey}
        addQuotationQuote={quotationsHook.addQuote}
        updateQuotationQuote={quotationsHook.updateQuote}
        deleteQuotationQuote={quotationsHook.deleteQuote}
        updateQuotationNotes={quotationsHook.updateNotes}
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
        quotationGroups={quotationsHook.groups}
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
        generalBibPath={bibSettingsHook.generalBibPath}
        setGeneralBibPath={bibSettingsHook.setGeneralBibPath}
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
 * any hook context. ExampleInfo / FootnoteInfo are sourced via the
 * EditorHandle's imperative methods, re-derived whenever `docVersion`
 * bumps. Edit callbacks no-op in Reader mode (`editable: false`
 * prevents any user mutation reaching this surface anyway).
 */

interface PanelHostProps {
  editorRef: RefObject<EditorHandle | null>;
  docVersion: number;
}

function ExamplesPanelHost({ editorRef, docVersion }: PanelHostProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const examples = useMemo(
    () => editorRef.current?.getExamples() ?? [],
    [editorRef, docVersion],
  );
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
