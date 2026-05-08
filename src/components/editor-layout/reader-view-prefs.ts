/**
 * Reader-mode `EditorPaneViewPrefs` — minimal stateful shim.
 *
 * The Reader is read-only and doesn't persist popout / dock state, but
 * the strip-icon click flow needs *some* mutable state to do anything
 * useful (`openPanelDocked` is a no-op without it). This hook keeps a
 * tiny session-only slice of state — the active panel per side, plus
 * default-enabled omni categories — and stubs the rest.
 *
 * The shim's purpose is to satisfy the canonical `if (viewPrefs)`
 * branch in PaneRail (and the OmniHost / FloatingPanel / SectionLozenge
 * / expand-all gates), unlocking the full panel-rail surface for
 * Reader mounts without adding a separate placeholder render path.
 */

"use client";

import { useCallback, useMemo, useState } from "react";
import type { EditorPaneViewPrefs } from "@/components/EditorPane";
import type {
  PanelId,
  PanelPlacement,
  Side,
  ViewPrefs,
} from "@/hooks/useViewPrefs";
import { dockSlotKey } from "@/hooks/useViewPrefs";
import { PANEL_REGISTRY } from "@/panels/panel-registry";
import { DEFAULT_PRINT_OPTIONS } from "@/lib/print";
import {
  PANEL_TO_CATEGORY,
  type OmniCategory,
} from "@/panels/Omni/OmniViewPanel";

const READER_PLACEMENTS: PanelPlacement[] = [
  { id: "outline", side: "left" },
  { id: "footnotes", side: "left" },
  { id: "citations", side: "left" },
  { id: "bibliography", side: "left" },
  { id: "examples", side: "left" },
  { id: "notes", side: "right" },
];

// Each OmniCategory → its native side, sourced from PANEL_REGISTRY.
const READER_CATEGORY_SIDES: Record<OmniCategory, Side> = (() => {
  const out: Partial<Record<OmniCategory, Side>> = {};
  for (const entry of Object.values(PANEL_REGISTRY)) {
    const cat = PANEL_TO_CATEGORY[entry.kind];
    if (cat && entry.defaultStripSide) {
      out[cat] = entry.defaultStripSide;
    }
  }
  return out as Record<OmniCategory, Side>;
})();

// Default omni categories per side: only those whose panel kinds appear
// in READER_PLACEMENTS. The OmniHost surfaces the matching cards when
// the user clicks a strip icon (the click drives `dockSlots` here).
const DEFAULT_READER_OMNI_LEFT = new Set<OmniCategory>([
  "outline",
  "footnotes",
  "citations",
  "bibliography",
  "examples",
]);
const DEFAULT_READER_OMNI_RIGHT = new Set<OmniCategory>(["notes"]);

/**
 * Returns a stable `EditorPaneViewPrefs` for the Reader, with minimal
 * state for active-panel tracking. Most callbacks are no-ops; popouts,
 * float positions, dock slots beyond the current click, and zen mode
 * remain inert.
 */
export function useReaderViewPrefs(): EditorPaneViewPrefs {
  const [activeLeft, setActiveLeft] = useState<PanelId | null>(null);
  const [activeRight, setActiveRight] = useState<PanelId | null>(null);
  const [omniEnabledLeft, setOmniEnabledLeft] = useState(
    DEFAULT_READER_OMNI_LEFT,
  );
  const [omniEnabledRight, setOmniEnabledRight] = useState(
    DEFAULT_READER_OMNI_RIGHT,
  );
  // Session-only gutter state — Reader doesn't persist, but the user
  // can still drag during a tab session.
  const [topGutter, setTopGutterState] = useState(0);
  const [bottomGutter, setBottomGutterState] = useState(0);
  const setEditorTopGutter = useCallback(
    (px: number) => setTopGutterState(Math.max(0, px)),
    [],
  );
  const setEditorBottomGutter = useCallback(
    (px: number) => setBottomGutterState(Math.max(0, px)),
    [],
  );
  // Session-only L/R panel-column widths so the user can drag the
  // boundary between the panel rail and the editor pod.
  const [panelWidths, setPanelWidthsState] = useState<Record<string, number>>({});
  const setPanelWidth = useCallback(
    (side: Side, _id: PanelId, width: number) => {
      setPanelWidthsState((prev) => ({ ...prev, [side]: width }));
    },
    [],
  );
  const getPanelWidth = useCallback(
    (side: Side, _id: PanelId): number => panelWidths[side] || 320,
    [panelWidths],
  );

  // Build a `ViewPrefs` snapshot. dockSlots reflect the active panels
  // so OmniHost / PanelColumn render their content.
  const prefs = useMemo<ViewPrefs>(() => {
    const dockSlots: ViewPrefs["dockSlots"] = {};
    if (activeLeft) dockSlots[dockSlotKey("left", "full")] = activeLeft;
    if (activeRight) dockSlots[dockSlotKey("right", "full")] = activeRight;
    return {
      placements: READER_PLACEMENTS,
      activeLeft,
      activeRight,
      activeLeftBottom: null,
      activeRightBottom: null,
      splitLeftRatio: 0.5,
      splitRightRatio: 0.5,
      panelWidths,
      editorSplit: false,
      editorSplitRatio: 0.5,
      poppedOutPanels: [],
      poppedOutOrigins: {},
      floatPositions: {},
      panelModes: {},
      dockSlots,
      poppedOutCards: [],
      cardFloatPositions: {},
      showHighlights: true,
      hiddenHighlightTypes: [],
      menuLocation: { kind: "home" },
      pageWidth: 880,
      topGutter,
      bottomGutter,
      editorLeftMargin: 88,
      editorRightMargin: 72,
      printOptions: DEFAULT_PRINT_OPTIONS,
      topbarRightCollapsed: false,
    };
  }, [activeLeft, activeRight, topGutter, bottomGutter, panelWidths]);

  const openPanelDocked = useCallback(
    (id: PanelId, side?: Side) => {
      const placement = READER_PLACEMENTS.find((p) => p.id === id);
      const s = side ?? placement?.side ?? "right";
      if (s === "left") setActiveLeft(id);
      else setActiveRight(id);
    },
    [],
  );

  const closePopout = useCallback((id: PanelId) => {
    setActiveLeft((cur) => (cur === id ? null : cur));
    setActiveRight((cur) => (cur === id ? null : cur));
  }, []);

  const togglePanel = useCallback(
    (id: PanelId) => {
      const placement = READER_PLACEMENTS.find((p) => p.id === id);
      const s = placement?.side ?? "right";
      if (s === "left") {
        setActiveLeft((cur) => (cur === id ? null : id));
      } else {
        setActiveRight((cur) => (cur === id ? null : id));
      }
    },
    [],
  );

  const getOmniEnabled = useCallback(
    (side: Side) =>
      side === "left" ? omniEnabledLeft : omniEnabledRight,
    [omniEnabledLeft, omniEnabledRight],
  );

  const toggleOmniCategory = useCallback((side: Side, cat: OmniCategory) => {
    const setter = side === "left" ? setOmniEnabledLeft : setOmniEnabledRight;
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  const setOmniSideToDefault = useCallback((side: Side) => {
    if (side === "left") setOmniEnabledLeft(DEFAULT_READER_OMNI_LEFT);
    else setOmniEnabledRight(DEFAULT_READER_OMNI_RIGHT);
  }, []);

  return useMemo<EditorPaneViewPrefs>(
    () => ({
      prefs,
      focusedHalfLeft: "top",
      focusedHalfRight: "top",
      isResizingPanels: false,
      cardsOffset: undefined,
      cardsSilent: undefined,
      focusState: null,
      activeSectionPath: [],
      activeParTitleIndex: null,
      mirrorSectionPath: [],
      mirrorParTitleIndex: null,
      setFocusedHalfLeft: () => {},
      setFocusedHalfRight: () => {},
      setIsResizingPanels: () => {},
      syncPanelPrefsToRendered: () => {},
      getPanelWidth,
      setPanelWidth,
      setSplitRatio: () => {},
      setEditorLeftMargin: () => {},
      setEditorRightMargin: () => {},
      topGutter,
      bottomGutter,
      setEditorTopGutter,
      setEditorBottomGutter,
      zenMode: false,
      zenLeftMargin: 0,
      zenRightMargin: 0,
      setZenLeftMargin: () => {},
      setZenRightMargin: () => {},
      setActiveLeft,
      setActiveRight,
      setActiveHalf: () => {},
      togglePanel,
      movePanel: () => {},
      closePopout,
      setFloatPosition: () => {},
      undockPanel: () => {},
      redockPanel: () => {},
      toggleCardPopout: () => {},
      setCardFloatPosition: () => {},
      getOmniEnabled,
      getOmniHideAll: () => false,
      orphanedFootnotes: [],
      onEditOrphan: () => {},
      onDeleteOrphan: () => {},
      onEditOrphanTitle: () => {},
      onScrollToHeading: () => {},
      onReorderBlocks: () => {},
      onRenameHeading: () => {},
      onRenameParTitle: () => {},
      onUpdateLabel: () => {},
      isLabelTaken: () => false,
      onFocusActivate: () => {},
      onFocusDeactivate: () => {},
      onFocusToggleLock: () => {},
      onFocusMoveTo: () => {},
      onFocusExpandTo: () => {},
      onFocusSnapBoundary: () => {},
      focusFloating: () => {},
      collapseLeft: () => setActiveLeft(null),
      collapseRight: () => setActiveRight(null),
      expandLeft: () => setActiveLeft("omni"),
      expandRight: () => setActiveRight("omni"),
      setBlank: (side) => {
        if (side === "left") setActiveLeft("blank");
        else setActiveRight("blank");
      },
      toggleSplit: () => {},
      openPanelDocked,
      iconDropMimesByPanel: {},
      handleIconDrop: () => false,
      toggleOmniCategory,
      setOmniSideToDefault,
      categorySides: READER_CATEGORY_SIDES,
    }),
    [
      prefs,
      togglePanel,
      closePopout,
      getOmniEnabled,
      openPanelDocked,
      toggleOmniCategory,
      setOmniSideToDefault,
      topGutter,
      bottomGutter,
      setEditorTopGutter,
      setEditorBottomGutter,
      getPanelWidth,
      setPanelWidth,
    ],
  );
}
