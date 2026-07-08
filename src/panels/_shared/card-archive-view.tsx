"use client";

/**
 * Card-archive VIEW context — the per-panel "View Active / View Archives / View
 * All" selector state, shared by `CardListPanel` (which filters its list) and
 * `CardViewModeMenuItems` (the three-dot menu items that change the mode). Both
 * must read the SAME source: there is a single `useViewPrefs` instance (in
 * `EditorLayout`), and its per-window `cardArchiveView` does not cross-sync
 * between separate hook instances, so panels must NOT call `useViewPrefs`
 * themselves — they consume this context, which `EditorPane` provides from the
 * one canonical instance.
 *
 * Wholly distinct from the text-object Archive PANEL: this governs whether a
 * card's per-card `archived` flag hides it from a panel's active view.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { CardArchiveView } from "@/hooks/useViewPrefs";
import type { PanelKind } from "./types";

export type { CardArchiveView };

export interface CardArchiveViewApi {
  /** The archive view mode for a panel. Defaults to "active". */
  getView: (panel: PanelKind) => CardArchiveView;
  setView: (panel: PanelKind, mode: CardArchiveView) => void;
  /** Whether the "archiving removes the footnote/citation from your text"
   *  confirm is suppressed (the user ticked "don't ask again"). */
  suppressAtomWarning: boolean;
  setSuppressAtomWarning: (v: boolean) => void;
}

const DEFAULT: CardArchiveViewApi = {
  getView: () => "active",
  setView: () => {},
  suppressAtomWarning: false,
  setSuppressAtomWarning: () => {},
};

const CardArchiveViewContext = createContext<CardArchiveViewApi>(DEFAULT);

export function CardArchiveViewProvider({
  value,
  children,
}: {
  value: CardArchiveViewApi;
  children: ReactNode;
}) {
  return (
    <CardArchiveViewContext.Provider value={value}>
      {children}
    </CardArchiveViewContext.Provider>
  );
}

export function useCardArchiveView(): CardArchiveViewApi {
  return useContext(CardArchiveViewContext);
}

/** Apply a panel's archive view mode to its card list. `getArchived` reads the
 *  per-card `archived` flag. "active" → only un-archived; "archived" → only
 *  archived; "all" → everything. */
export function filterByArchiveView<T>(
  items: T[],
  view: CardArchiveView,
  getArchived: (item: T) => boolean,
): T[] {
  if (view === "all") return items;
  const wantArchived = view === "archived";
  return items.filter((it) => !!getArchived(it) === wantArchived);
}

/**
 * The archive-view-filtered slice of a panel's item list — the EXACT derivation
 * `CardListPanel` renders (`filterByArchiveView` under the panel's current
 * view). A panel that ALSO drives a keyboard cycle over its items must feed the
 * cycle THIS list, not the raw one, so the nav-set cannot desync from the
 * render-set (arrow-stepping onto an archived, off-screen card). Both the panel
 * (for its cycle) and `CardListPanel` (for rendering) call this single hook, so
 * the two sets are one derivation.
 *
 * `getArchived` omitted ⇒ the panel has no archivable cards; the list passes
 * through unchanged. Memoized on `[items, view, getArchived]`, so pass a stable
 * `getArchived` (a module const or `useCallback`) to keep the result
 * identity-stable for the cycle across plain re-renders.
 */
export function useArchiveVisibleItems<T>(
  panel: PanelKind,
  items: T[],
  getArchived?: (item: T) => boolean,
): T[] {
  const { getView } = useCardArchiveView();
  const view = getView(panel);
  return useMemo(
    () => (getArchived ? filterByArchiveView(items, view, getArchived) : items),
    [items, view, getArchived],
  );
}
