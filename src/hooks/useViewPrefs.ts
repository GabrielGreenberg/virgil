"use client";

import { useState, useCallback, useEffect, useRef } from "react";

export type PanelId = "notes" | "revisions" | "suggestions" | "archive" | "footnotes" | "citations" | "bibliography" | "outline" | "todo" | "cutter" | "quotations" | "wordcount" | "blank";
export type Side = "left" | "right";

export interface PanelPlacement {
  id: PanelId;
  side: Side;
}

export interface ViewPrefs {
  placements: PanelPlacement[];
  activeLeft: PanelId | null;
  activeRight: PanelId | null;
  panelWidths: Record<string, number>; // keyed by `${side}-${panelId}`
}

const DEFAULT_PREFS: ViewPrefs = {
  placements: [
    { id: "outline", side: "left" },
    { id: "quotations", side: "left" },
    { id: "todo", side: "left" },
    { id: "notes", side: "right" },
    { id: "revisions", side: "right" },
    { id: "archive", side: "right" },
    { id: "footnotes", side: "right" },
    { id: "citations", side: "right" },
    { id: "bibliography", side: "right" },
    { id: "cutter", side: "right" },
    { id: "wordcount", side: "right" },
  ],
  activeLeft: null,
  activeRight: "notes",
  panelWidths: {},
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
    update((p) => ({ ...p, activeLeft: p.activeLeft === id ? null : id }));
  }, [update]);

  const setActiveRight = useCallback((id: PanelId | null) => {
    update((p) => ({ ...p, activeRight: p.activeRight === id ? null : id }));
  }, [update]);

  const collapseLeft = useCallback(() => {
    update((p) => ({ ...p, activeLeft: null }));
  }, [update]);

  const collapseRight = useCallback(() => {
    update((p) => ({ ...p, activeRight: null }));
  }, [update]);

  const expandLeft = useCallback(() => {
    update((p) => {
      const leftItems = p.placements.filter((pl) => pl.side === "left");
      return { ...p, activeLeft: leftItems[0]?.id || null };
    });
  }, [update]);

  const expandRight = useCallback(() => {
    update((p) => {
      const rightItems = p.placements.filter((pl) => pl.side === "right");
      return { ...p, activeRight: rightItems[0]?.id || null };
    });
  }, [update]);

  const togglePanel = useCallback((id: PanelId) => {
    update((p) => {
      const placement = p.placements.find((pl) => pl.id === id);
      if (!placement) return p;
      if (placement.side === "left") {
        return { ...p, activeLeft: p.activeLeft === id ? null : id };
      } else {
        return { ...p, activeRight: p.activeRight === id ? null : id };
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
  };
}
