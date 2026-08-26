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

/* ── The VIEW-aware empty state (task 478) ────────────────────────────────
 *
 * A card panel's empty state used to be a single, view-BLIND string authored by
 * the panel: pick *View Archives* with nothing archived and twelve live cards
 * on the other side of the filter, and the panel said "No tasks yet. Click +
 * to create one." — a sentence that denies the filter exists, over an
 * instruction whose result the current view immediately hides.
 *
 * The class is task 183's, one filter over: A PANEL THAT CONTRADICTS ITSELF.
 * 183 made the header badge derive from the RENDERED set so the header could
 * not disagree with the list; this is the same disagreement between the EMPTY
 * STATE and the list's own filter, and `CardListPanel` is again the one place
 * that knows both (`items`, `visibleItems`, `getArchived`, and the view).
 *
 * So the rule lives HERE, beside the filter it is about, in one place: a panel
 * supplies its genuinely-empty copy and nothing else, and a ninth archivable
 * panel inherits the behaviour by shipping. `ErrorsPanel` is the precedent —
 * the only panel that already names WHY its list is empty — and this is that
 * shape, generalized to the dimension every card panel shares.
 */

/**
 * Why a card panel's list is empty, once the archive view has been applied.
 *
 * - `panel-empty`    — nothing is filtered out; the panel's OWN authored copy
 *                      is the right answer (and the only one that can teach the
 *                      way in, since only the panel knows how its cards are made).
 * - `nothing-archived` — the Archives view, with nothing archived. `hidden` is
 *                      how many ACTIVE cards the view is holding back.
 * - `all-archived`   — the Active view, with every card archived. The user's
 *                      work is present and invisible, which is why it gets its
 *                      own sentence rather than sharing one.
 */
export type ArchiveEmptyReason =
  | { kind: "panel-empty" }
  | { kind: "nothing-archived"; hidden: number }
  | { kind: "all-archived"; hidden: number };

/**
 * The rule, pure and total. `null` means the list is not empty at all.
 *
 * One subtlety worth stating rather than rediscovering: `view === "all"` cannot
 * reach a view-aware reason, because `all` ⇒ `visible === items`, so an empty
 * visible list means an empty raw list — genuinely empty. The two live cases are
 * exactly *Archives with nothing archived* and *Active with everything archived*.
 */
export function resolveArchiveEmptyReason({
  view,
  archivable,
  rawCount,
  visibleCount,
}: {
  view: CardArchiveView;
  /** Whether this panel has archivable cards at all (it supplied `getArchived`). */
  archivable: boolean;
  rawCount: number;
  visibleCount: number;
}): ArchiveEmptyReason | null {
  if (visibleCount > 0) return null;
  if (!archivable) return { kind: "panel-empty" };
  if (view === "archived") return { kind: "nothing-archived", hidden: rawCount };
  if (view === "active" && rawCount > 0)
    return { kind: "all-archived", hidden: rawCount };
  return { kind: "panel-empty" };
}

/**
 * The mode's name for the header badge slot, or `undefined` in the default
 * (Active) view — where there is no mode to announce and the header should stay
 * exactly as it was.
 *
 * The ⋮ carries the checkmark, but only while the menu is OPEN, so without this
 * the panel's PERSISTENT chrome is identical to a genuinely empty panel's. This
 * is the cheapest honest form of "the mode is visible": the header reads
 * `NOTES ARCHIVES 0` instead of `NOTES`.
 */
export function archiveViewBadgeLabel(
  view: CardArchiveView,
): string | undefined {
  if (view === "archived") return "ARCHIVES";
  if (view === "all") return "ALL";
  return undefined;
}
