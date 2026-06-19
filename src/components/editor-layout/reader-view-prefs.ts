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
  type PanelId,
  type Side,
  type ViewPrefs,
} from "@/hooks/useViewPrefs";
import { PANEL_REGISTRY } from "@/panels/panel-registry";
import { DEFAULT_PRINT_OPTIONS } from "@/lib/print";
import {
  DEFAULT_OMNI_CATEGORIES,
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
// icon (the click drives the reader's active-panel state → `dockStack`).
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
  // Lockstep popout-key remap (a card morphing kind while popped). Mirrors the
  // editor's `migratePoppedOutCards` over the shim's local state so the saved
  // rect follows the key. Inert in practice (the Reader is read-only), but kept
  // honest so `EditorPaneViewPrefs` is satisfiable without a cast.
  const remapCardPopKey = useCallback((oldKey: string, newKey: string) => {
    if (oldKey === newKey) return;
    setPoppedOutCards((prev) =>
      prev.includes(oldKey) ? prev.map((k) => (k === oldKey ? newKey : k)) : prev,
    );
    setCardFloatPositions((prev) => {
      if (!(oldKey in prev)) return prev;
      const { [oldKey]: rect, ...rest } = prev;
      return { ...rest, [newKey]: rect };
    });
  }, []);

  // Build a `ViewPrefs` snapshot. The band-stack `dockStack` reflects the
  // reader's single active panel per side so OmniHost / PanelColumn render
  // their content. `omni`/`blank` are NOT bands — omni is the always-mounted
  // background; `blank` is an empty-state marker tracked on `blankLeft/Right`.
  const prefs = useMemo<ViewPrefs>(() => {
    const leftBand =
      activeLeft && activeLeft !== "omni" && activeLeft !== "blank"
        ? activeLeft
        : null;
    const rightBand =
      activeRight && activeRight !== "omni" && activeRight !== "blank"
        ? activeRight
        : null;
    const dockStack: ViewPrefs["dockStack"] = {
      left: leftBand ? [leftBand] : [],
      right: rightBand ? [rightBand] : [],
    };
    return {
      placements: persistentPlacements,
      dockStack,
      panelHeights: {},
      panelMRU: { left: [], right: [] },
      collapsedLeft: false,
      collapsedRight: false,
      blankLeft: activeLeft === "blank",
      blankRight: activeRight === "blank",
      panelWidths,
      editorSplit: false,
      editorSplitRatio: 0.5,
      codePaneRatio: 0.55,
      poppedOutPanels: [],
      poppedOutOrigins: {},
      floatPositions: {},
      panelModes: {},
      poppedOutCards,
      cardFloatPositions,
      showHighlights: true,
      hiddenHighlightTypes: [],
      pageWidth: 880,
      editorLeftMargin: 88,
      editorRightMargin: 72,
      editorTopMargin: 40,
      editorBottomMargin: 40,
      printOptions: DEFAULT_PRINT_OPTIONS,
      topbarRightCollapsed: false,
      // Reader exposes the same decoration schema as the editor, but
      // hard-coded to the reader-appropriate defaults (no persistence).
      showMarginalia: true,
      hiddenMarginaliaTypes: [],
      showSectionIndicator: true,
      showHeadingLabels: true,
      dividerLevels: [],
      dividerWidth: "full",
      omniCategories: DEFAULT_OMNI_CATEGORIES,
      omniHideAllCards: { left: false, right: false },
      // Reader is read-only: no per-card archive view state, never suppressed.
      cardArchiveView: {},
      suppressArchiveAtomWarning: false,
    };
  }, [
    persistentPlacements,
    activeLeft,
    activeRight,
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
      isResizingPanels: false,
      focusState: null,
      activeSectionPath: [],
      activeParTitleIndex: null,
      mirrorSectionPath: [],
      mirrorParTitleIndex: null,
      setIsResizingPanels: () => {},
      syncPanelPrefsToRendered: () => {},
      getPanelWidth,
      setPanelWidth,
      setEditorLeftMargin: () => {},
      setEditorRightMargin: () => {},
      setEditorTopMargin: () => {},
      setEditorBottomMargin: () => {},
      zenMode: false,
      zenLeftMargin: 0,
      zenRightMargin: 0,
      setZenLeftMargin: () => {},
      setZenRightMargin: () => {},
      setActiveLeft,
      setActiveRight,
      togglePanel,
      movePanel: persistentMovePanel,
      closePopout,
      setFloatPosition: () => {},
      undockPanel: () => {},
      redockPanel: (_id: PanelId, _side: Side, _index?: number) => {},
      notePanelUse: () => {},
      setPanelHeight: () => {},
      clearPanelHeight: () => {},
      tradePanelHeights: () => {},
      toggleCardPopout,
      closeCardPopout,
      setCardFloatPosition,
      remapCardPopKey,
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
      getPanelWidth,
      setPanelWidth,
      toggleCardPopout,
      closeCardPopout,
      setCardFloatPosition,
      remapCardPopKey,
    ],
  );
}
