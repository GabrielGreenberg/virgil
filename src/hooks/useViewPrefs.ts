"use client";

import { useState, useCallback, useEffect, useRef } from "react";

export type PanelId = "notes" | "revisions" | "suggestions" | "archive" | "footnotes" | "citations" | "bibliography" | "outline" | "todo" | "cutter" | "quotations" | "search" | "wordcount" | "blank" | "omni";
export type Side = "left" | "right";

export interface PanelPlacement {
  id: PanelId;
  side: Side;
}

export type Half = "top" | "bottom";

export interface ViewPrefs {
  placements: PanelPlacement[];
  /** Top half (or only half when not split). */
  activeLeft: PanelId | null;
  activeRight: PanelId | null;
  /** Bottom half — null when the side is not split. */
  activeLeftBottom: PanelId | null;
  activeRightBottom: PanelId | null;
  /** Stashed panel state for restore on expand after collapse. */
  _stashedLeft?: { top: PanelId; bottom: PanelId | null } | null;
  _stashedRight?: { top: PanelId; bottom: PanelId | null } | null;
  /** 0..1 — top half height ratio when the side is split. */
  splitLeftRatio: number;
  splitRightRatio: number;
  panelWidths: Record<string, number>; // keyed by `${side}-${panelId}`
  /** Whether the main editor is split into two panes. */
  editorSplit: boolean;
  /** 0..1 — top pane ratio when editor is split. */
  editorSplitRatio: number;
  /** Panels currently displayed as floating windows. */
  poppedOutPanels: PanelId[];
  /** Saved position/size of each floating panel, keyed by panel id. */
  floatPositions: Record<string, { x: number; y: number; width: number; height: number }>;
  /** Cards currently displayed as floating windows — keys shaped `${kind}:${id}`. */
  poppedOutCards: string[];
  /** Saved position/size of each floating card, keyed by card key. */
  cardFloatPositions: Record<string, { x: number; y: number; width: number; height: number }>;
}

const DEFAULT_PREFS: ViewPrefs = {
  placements: [
    // Left strip — research / reference tools
    { id: "search", side: "left" },
    { id: "outline", side: "left" },
    { id: "footnotes", side: "left" },
    { id: "citations", side: "left" },
    { id: "bibliography", side: "left" },
    { id: "quotations", side: "left" },
    // Right strip — writing / workflow tools
    { id: "wordcount", side: "right" },
    { id: "notes", side: "right" },
    { id: "todo", side: "right" },
    { id: "revisions", side: "right" },
    { id: "cutter", side: "right" },
    { id: "archive", side: "right" },
    // NOTE: "omni" and "blank" are presentation-tool pod panels — they
    // are not placed in the strip and are not part of `placements`.
  ],
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
  floatPositions: {},
  poppedOutCards: [],
  cardFloatPositions: {},
};

const STORAGE_KEY = "virgil-view-prefs";

function loadPrefs(): ViewPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw);
    // Migrate: replace old "references" panel with "citations" + "bibliography"
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let placements: any[] = parsed.placements || [];
    const hasOldRef = placements.some((p: any) => p.id === "references");
    if (hasOldRef) {
      const refSide = placements.find((p: any) => p.id === "references")!.side;
      placements = placements.filter((p: any) => p.id !== "references");
      placements.push({ id: "citations", side: refSide });
      placements.push({ id: "bibliography", side: refSide });
      if (parsed.activeLeft === "references") parsed.activeLeft = "citations";
      if (parsed.activeRight === "references") parsed.activeRight = "citations";
    }
    // Migrate: replace old "comments" panel with "notes" + "revisions"
    const hasOldComments = placements.some((p: any) => p.id === "comments");
    if (hasOldComments) {
      const commentsSide = placements.find((p: any) => p.id === "comments")!.side;
      placements = placements.filter((p: any) => p.id !== "comments");
      placements.push({ id: "notes", side: commentsSide });
      placements.push({ id: "revisions", side: commentsSide });
      if (parsed.activeLeft === "comments") parsed.activeLeft = "revisions";
      if (parsed.activeRight === "comments") parsed.activeRight = "revisions";
    }
    // Merge with defaults to handle new panels added in updates
    const existingIds = new Set(placements.map((p: PanelPlacement) => p.id));
    const merged = [...placements];
    for (const dp of DEFAULT_PREFS.placements) {
      if (!existingIds.has(dp.id)) merged.push(dp);
    }
    return { ...DEFAULT_PREFS, ...parsed, placements: merged };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function useViewPrefs() {
  const [prefs, setPrefs] = useState<ViewPrefs>(DEFAULT_PREFS);
  const initialized = useRef(false);

  useEffect(() => {
    setPrefs(loadPrefs());
    initialized.current = true;
  }, []);

  const persist = useCallback((newPrefs: ViewPrefs) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newPrefs));
    } catch {}
  }, []);

  const update = useCallback((fn: (prev: ViewPrefs) => ViewPrefs) => {
    setPrefs((prev) => {
      const next = fn(prev);
      persist(next);
      return next;
    });
  }, [persist]);

  const setActiveLeft = useCallback((id: PanelId | null) => {
    update((p) => ({ ...p, activeLeft: p.activeLeft === id ? "blank" : id }));
  }, [update]);

  const setActiveRight = useCallback((id: PanelId | null) => {
    update((p) => ({ ...p, activeRight: p.activeRight === id ? "blank" : id }));
  }, [update]);

  const collapseLeft = useCallback(() => {
    update((p) => ({
      ...p,
      _stashedLeft: p.activeLeft ? { top: p.activeLeft, bottom: p.activeLeftBottom } : null,
      activeLeft: null,
      activeLeftBottom: null,
    }));
  }, [update]);

  const collapseRight = useCallback(() => {
    update((p) => ({
      ...p,
      _stashedRight: p.activeRight ? { top: p.activeRight, bottom: p.activeRightBottom } : null,
      activeRight: null,
      activeRightBottom: null,
    }));
  }, [update]);

  const expandLeft = useCallback(() => {
    update((p) => ({ ...p, activeLeft: "blank", activeLeftBottom: null }));
  }, [update]);

  const expandRight = useCallback(() => {
    update((p) => ({ ...p, activeRight: "blank", activeRightBottom: null }));
  }, [update]);

  const togglePanel = useCallback((id: PanelId) => {
    update((p) => {
      const placement = p.placements.find((pl) => pl.id === id);
      if (!placement) return p;
      if (placement.side === "left") {
        return { ...p, activeLeft: p.activeLeft === id ? "blank" : id };
      } else {
        return { ...p, activeRight: p.activeRight === id ? "blank" : id };
      }
    });
  }, [update]);

  const movePanel = useCallback((id: PanelId, toSide: Side, toIndex?: number) => {
    update((p) => {
      const filtered = p.placements.filter((pl) => pl.id !== id);
      const sameItems = filtered.filter((pl) => pl.side === toSide);
      const otherItems = filtered.filter((pl) => pl.side !== toSide);
      const idx = toIndex !== undefined ? Math.min(toIndex, sameItems.length) : sameItems.length;
      sameItems.splice(idx, 0, { id, side: toSide });

      // If it was the active panel on the old side, clear it; set it active on new side
      const oldPlacement = p.placements.find((pl) => pl.id === id);
      let activeLeft = p.activeLeft;
      let activeRight = p.activeRight;
      if (oldPlacement) {
        if (oldPlacement.side === "left" && activeLeft === id) activeLeft = null;
        if (oldPlacement.side === "right" && activeRight === id) activeRight = null;
      }
      if (toSide === "left") activeLeft = id;
      else activeRight = id;

      return {
        ...p,
        placements: [...otherItems, ...sameItems],
        activeLeft,
        activeRight,
      };
    });
  }, [update]);

  const setPanelWidth = useCallback((side: Side, _id: PanelId, width: number) => {
    update((p) => ({
      ...p,
      panelWidths: { ...p.panelWidths, [side]: width },
    }));
  }, [update]);

  const getPanelWidth = useCallback((side: Side, _id: PanelId): number => {
    return prefs.panelWidths[side] || 320;
  }, [prefs.panelWidths]);

  /** Set the panel id for a specific half of a side. */
  const setActiveHalf = useCallback(
    (side: Side, half: Half, id: PanelId | null) => {
      update((p) => {
        if (side === "left") {
          return half === "top"
            ? { ...p, activeLeft: id }
            : { ...p, activeLeftBottom: id };
        }
        return half === "top"
          ? { ...p, activeRight: id }
          : { ...p, activeRightBottom: id };
      });
    },
    [update],
  );

  /**
   * Toggle split for a side. If not currently split, splits with the
   * existing active panel as top and "blank" as bottom (or vice-versa
   * if there's no active panel). If split, collapses by keeping the
   * top half and clearing the bottom.
   */
  const toggleSplit = useCallback((side: Side) => {
    update((p) => {
      const isSplit =
        side === "left" ? p.activeLeftBottom != null : p.activeRightBottom != null;
      if (side === "left") {
        if (isSplit) {
          return { ...p, activeLeftBottom: null };
        }
        // Splitting: ensure top is something visible; bottom defaults to blank
        const top = p.activeLeft ?? "blank";
        return {
          ...p,
          activeLeft: top,
          activeLeftBottom: "blank",
        };
      } else {
        if (isSplit) {
          return { ...p, activeRightBottom: null };
        }
        const top = p.activeRight ?? "blank";
        return {
          ...p,
          activeRight: top,
          activeRightBottom: "blank",
        };
      }
    });
  }, [update]);

  const setSplitRatio = useCallback((side: Side, ratio: number) => {
    const clamped = Math.max(0.05, Math.min(0.95, ratio));
    update((p) => (side === "left"
      ? { ...p, splitLeftRatio: clamped }
      : { ...p, splitRightRatio: clamped }));
  }, [update]);

  const setEditorSplit = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    update((p) => ({ ...p, editorSplit: typeof v === "function" ? v(p.editorSplit) : v }));
  }, [update]);

  /**
   * Close a floating panel without re-docking it into the sidebar (unlike
   * togglePopout, which re-docks if the side column is open).
   */
  const closePopout = useCallback((id: PanelId) => {
    update((p) => ({
      ...p,
      poppedOutPanels: p.poppedOutPanels.filter((x) => x !== id),
    }));
  }, [update]);

  const togglePopout = useCallback((id: PanelId) => {
    update((p) => {
      const isPopped = p.poppedOutPanels.includes(id);
      if (isPopped) {
        const next = { ...p, poppedOutPanels: p.poppedOutPanels.filter((x) => x !== id) };
        // If the panel's side column is currently open, re-dock the panel
        // there so "collapse" returns it to its place. If the side is
        // collapsed, just close the floating panel.
        const placement = p.placements.find((pl) => pl.id === id);
        if (placement?.side === "left" && p.activeLeft != null) {
          next.activeLeft = id;
        } else if (placement?.side === "right" && p.activeRight != null) {
          next.activeRight = id;
        }
        return next;
      }
      // Popping out: also clear its sidebar slot so it "closes as a panel".
      let activeLeft = p.activeLeft;
      let activeRight = p.activeRight;
      let activeLeftBottom = p.activeLeftBottom;
      let activeRightBottom = p.activeRightBottom;
      if (activeLeft === id) activeLeft = "blank";
      if (activeRight === id) activeRight = "blank";
      if (activeLeftBottom === id) activeLeftBottom = "blank";
      if (activeRightBottom === id) activeRightBottom = "blank";
      return {
        ...p,
        poppedOutPanels: [...p.poppedOutPanels, id],
        activeLeft,
        activeRight,
        activeLeftBottom,
        activeRightBottom,
      };
    });
  }, [update]);

  const setFloatPosition = useCallback(
    (id: PanelId, pos: { x: number; y: number; width: number; height: number }) => {
      update((p) => ({ ...p, floatPositions: { ...p.floatPositions, [id]: pos } }));
    },
    [update],
  );

  const toggleCardPopout = useCallback((key: string) => {
    update((p) => {
      const isPopped = p.poppedOutCards.includes(key);
      return {
        ...p,
        poppedOutCards: isPopped
          ? p.poppedOutCards.filter((x) => x !== key)
          : [...p.poppedOutCards, key],
      };
    });
  }, [update]);

  const closeCardPopout = useCallback((key: string) => {
    update((p) => ({
      ...p,
      poppedOutCards: p.poppedOutCards.filter((x) => x !== key),
    }));
  }, [update]);

  const setCardFloatPosition = useCallback(
    (key: string, pos: { x: number; y: number; width: number; height: number }) => {
      update((p) => ({ ...p, cardFloatPositions: { ...p.cardFloatPositions, [key]: pos } }));
    },
    [update],
  );

  const setEditorSplitRatio = useCallback((ratio: number) => {
    update((p) => ({ ...p, editorSplitRatio: Math.max(0.15, Math.min(0.85, ratio)) }));
  }, [update]);

  const leftItems = prefs.placements.filter((p) => p.side === "left");
  const rightItems = prefs.placements.filter((p) => p.side === "right");

  return {
    prefs,
    leftItems,
    rightItems,
    setActiveLeft,
    setActiveRight,
    collapseLeft,
    collapseRight,
    expandLeft,
    expandRight,
    togglePanel,
    movePanel,
    setPanelWidth,
    getPanelWidth,
    setActiveHalf,
    toggleSplit,
    setSplitRatio,
    setEditorSplit,
    setEditorSplitRatio,
    togglePopout,
    closePopout,
    setFloatPosition,
    toggleCardPopout,
    closeCardPopout,
    setCardFloatPosition,
  };
}
