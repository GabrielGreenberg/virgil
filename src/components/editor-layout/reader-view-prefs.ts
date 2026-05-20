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
import {
  useViewPrefs,
  dockSlotKey,
  type PanelId,
  type Side,
  type ViewPrefs,
} from "@/hooks/useViewPrefs";
import { PANEL_REGISTRY } from "@/panels/panel-registry";
import { DEFAULT_PRINT_OPTIONS } from "@/lib/print";
import {
  PANEL_TO_CATEGORY,
  type OmniCategory,
} from "@/panels/Omni/OmniViewPanel";

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

// Default omni categories per side for the Reader. Mirrors the 6
// reader-visible panel kinds in `READER_CHROME.visiblePanelKinds`. The
// OmniHost surfaces the matching cards when the user clicks a strip
// icon (the click drives `dockSlots` here).
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
  // Placements + movePanel come from the persistent global pref store,
  // so dragging a panel-icon in the Reader updates the same value the
  // main editor reads, and vice versa.
  const realPrefs = useViewPrefs();
  const persistentPlacements = realPrefs.prefs.placements;
  const persistentMovePanel = realPrefs.movePanel;

  const sideForPanel = useCallback(
    (id: PanelId): Side => {
      const placed = persistentPlacements.find((p) => p.id === id);
      // PANEL_REGISTRY is keyed by PanelKind; "blank" isn't a registered
      // panel — the lookup returns undefined for it and the optional
      // chain handles the fallback to "right".
      const reg = (PANEL_REGISTRY as Record<string, { defaultStripSide: Side | null } | undefined>)[id];
      return placed?.side ?? reg?.defaultStripSide ?? "right";
    },
    [persistentPlacements],
  );

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
  // Session-only popout state. Reader doesn't persist popouts across
  // reloads, but the lift-gesture from the paragraph/selection drag
  // handles needs real state to drive `EditorPane`'s popouts render
  // block (gated on `viewPrefs.prefs.poppedOutCards`). Mirrors the
  // contract in `useViewPrefs` (toggle on re-dock wipes the saved
  // position) so consumers behave identically.
  const [poppedOutCards, setPoppedOutCards] = useState<string[]>([]);
  const [cardFloatPositions, setCardFloatPositions] = useState<
    Record<string, { x: number; y: number; width: number; height: number }>
  >({});
  const toggleCardPopout = useCallback((key: string) => {
    setPoppedOutCards((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      return [...prev, key];
    });
    setCardFloatPositions((prev) => {
      if (!(key in prev)) return prev;
      const { [key]: _dropped, ...rest } = prev;
      return rest;
    });
  }, []);
  const closeCardPopout = useCallback((key: string) => {
    setPoppedOutCards((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : prev,
    );
    setCardFloatPositions((prev) => {
      if (!(key in prev)) return prev;
      const { [key]: _dropped, ...rest } = prev;
      return rest;
    });
  }, []);
  const setCardFloatPosition = useCallback(
    (key: string, rect: { x: number; y: number; width: number; height: number }) => {
      setCardFloatPositions((prev) => ({ ...prev, [key]: rect }));
    },
    [],
  );

  // Build a `ViewPrefs` snapshot. dockSlots reflect the active panels
  // so OmniHost / PanelColumn render their content.
  const prefs = useMemo<ViewPrefs>(() => {
    const dockSlots: ViewPrefs["dockSlots"] = {};
    // Match the Editor's `useViewPrefs` contract: only specific panels
    // live in `dockSlots`. `omni` is the always-mounted bottom layer of
    // PanelColumn (rendered via `omniSlot.omni`); `blank` is an empty-
    // state marker tracked on `activeLeft`/`activeRight` only. Putting
    // either in `dockSlots` makes EditorPane's floating-panel block
    // (which iterates dockSlots) render them via `PaneRailBody`, which
    // dispatches only specific panel kinds and falls through to the
    // "panel isn't wired into EditorPane yet" placeholder for omni/blank.
    if (activeLeft && activeLeft !== "omni" && activeLeft !== "blank") {
      dockSlots[dockSlotKey("left", "full")] = activeLeft;
    }
    if (activeRight && activeRight !== "omni" && activeRight !== "blank") {
      dockSlots[dockSlotKey("right", "full")] = activeRight;
    }
    return {
      placements: persistentPlacements,
      activeLeft,
      activeRight,
      activeLeftBottom: null,
      activeRightBottom: null,
      splitLeftRatio: 0.5,
      splitRightRatio: 0.5,
      splitLeftOrigin: null,
      splitRightOrigin: null,
      panelWidths,
      editorSplit: false,
      editorSplitRatio: 0.5,
      poppedOutPanels: [],
      poppedOutOrigins: {},
      floatPositions: {},
      panelModes: {},
      dockSlots,
      poppedOutCards,
      cardFloatPositions,
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
  }, [
    persistentPlacements,
    activeLeft,
    activeRight,
    topGutter,
    bottomGutter,
    panelWidths,
    poppedOutCards,
    cardFloatPositions,
  ]);

  const openPanelDocked = useCallback(
    (id: PanelId, side?: Side) => {
      const s = side ?? sideForPanel(id);
      if (s === "left") setActiveLeft(id);
      else setActiveRight(id);
    },
    [sideForPanel],
  );

  const closePopout = useCallback((id: PanelId) => {
    setActiveLeft((cur) => (cur === id ? null : cur));
    setActiveRight((cur) => (cur === id ? null : cur));
  }, []);

  const togglePanel = useCallback(
    (id: PanelId) => {
      const s = sideForPanel(id);
      if (s === "left") {
        setActiveLeft((cur) => (cur === id ? null : id));
      } else {
        setActiveRight((cur) => (cur === id ? null : id));
      }
    },
    [sideForPanel],
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
      movePanel: persistentMovePanel,
      closePopout,
      setFloatPosition: () => {},
      undockPanel: () => {},
      redockPanel: () => {},
      toggleCardPopout,
      closeCardPopout,
      setCardFloatPosition,
      getOmniEnabled,
      getOmniHideAll: () => false,
      toggleOmniHideAllCards: () => {},
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
      clearBlankIfSet: () => {
        setActiveLeft((cur) => (cur === "blank" ? null : cur));
        setActiveRight((cur) => (cur === "blank" ? null : cur));
      },
      toggleSplit: () => {},
      openPanelDocked,
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
      persistentMovePanel,
      toggleOmniCategory,
      setOmniSideToDefault,
      topGutter,
      bottomGutter,
      setEditorTopGutter,
      setEditorBottomGutter,
      getPanelWidth,
      setPanelWidth,
      toggleCardPopout,
      closeCardPopout,
      setCardFloatPosition,
    ],
  );
}
