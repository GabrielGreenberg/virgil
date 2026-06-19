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

import { createContext, useContext, type ReactNode } from "react";
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
