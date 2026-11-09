/**
 * Pure derived read-helpers over `ViewPrefs` — the dock-stack accessors
 * that any consumer can call without subscribing to the hook.
 *
 * This is a LEAF module: it imports ONLY types from `useViewPrefs`, so
 * pulling these helpers into a module does NOT drag the `useViewPrefs`
 * runtime (which transitively imports `OmniViewPanel` →
 * `panel-primitives` → `useCollab` → `@/lib/storage`) into that module's
 * import graph. Route-derivation code paths (`open-for-card`,
 * `marker-clicks`, the card-action helpers) import the helpers from here
 * so the pure derivation stays free of the heavy storage chain — which
 * otherwise breaks under vitest's `require("@/lib/storage-*")` resolver
 * (see `anchor-route-derivation-contract.test.ts`).
 *
 * `useViewPrefs.ts` both VALUE-imports and re-exports these, and the dock
 * engine (`view-prefs-dock.ts`) value-imports them too — so consumers can
 * take them from either module, with the heavy-chain-sensitive ones coming
 * straight to this leaf. What keeps the graph acyclic is the direction stated
 * above: THIS file imports only types from `useViewPrefs`. A value import
 * added here in the other direction closes the cycle immediately.
 */
import type { PanelId, Side, ViewPrefs } from "@/hooks/useViewPrefs";
import { panelSidesFromPlacements, resolvePanelSide } from "@/lib/panel-side";

/** The side `id` is docked on, or null. Null-safe on a partial `dockStack`
 *  (test fixtures may omit it) — an absent stack reads as "not docked". */
export function dockedSideOf(prefs: ViewPrefs, id: PanelId): Side | null {
  if (prefs.dockStack?.left?.includes(id)) return "left";
  if (prefs.dockStack?.right?.includes(id)) return "right";
  return null;
}

/** The top (first) docked panel on `side`, or null — the nearest analog
 *  to the retired `activeLeft`/`activeRight` "active panel" markers. */
export function dockStackTop(prefs: ViewPrefs, side: Side): PanelId | null {
  return (side === "left" ? prefs.dockStack?.left : prefs.dockStack?.right)?.[0] ?? null;
}

/** True when `id` is docked in either side's stack. */
export function isPanelDocked(prefs: ViewPrefs, id: PanelId): boolean {
  return dockedSideOf(prefs, id) !== null;
}

/**
 * The side panel `id`'s cards render on, read from `prefs` — `resolvePanelSide`
 * (`@/lib/panel-side`, the ONE ladder: the cards-right gutter layout, else the
 * live placement, else the registry default) over the prefs' placements. The
 * door for a consumer holding `ViewPrefs` rather than a side map, so none of
 * them re-spells `placements.find(...)?.side ?? fallback` — the bypass that
 * left `omniSideToReveal` and `openForCard` answering the stored placement
 * after task 1440 moved every card to the right (task 1528).
 */
export function panelSideOf(prefs: Pick<ViewPrefs, "placements">, id: PanelId): Side {
  return resolvePanelSide(id, panelSidesFromPlacements(prefs.placements));
}

/**
 * The side whose omni column must be REVEALED for a card of panel `id` to be
 * seen, or null when it already is. Omni is the always-mounted background of
 * every column (a docked band sits OVER it, not instead of it), and since task
 * 807 retired omni-hide (`omniHideAllCards` + the dead `blankLeft/Right`) the
 * ONE state that hides it is a folded gutter. So the answer is the side the
 * panel's cards RENDER on when that side is collapsed, and null otherwise. The
 * single owner of "reveal omni for this panel" — the citation and footnote
 * post-create soft-routes and the drag-handle `ensureOmniActiveForPanel` all
 * ask it, then expand the side it names.
 *
 * "The side its cards render on" is `resolvePanelSide` — the ONE ladder the
 * omni column itself is derived from (task 1528). Spelling the placement ladder
 * here instead answered "left" for a footnote under the cards-right gutter
 * layout (task 1440), where the card actually renders in the RIGHT gutter: the
 * wrong side was named, so a folded right gutter stayed folded and the new card
 * was created unseen (or the left ToolGutter unfolded instead).
 *
 * `panel-side` is an import-light leaf (types-only from `useViewPrefs`), so
 * this module stays a leaf.
 */
export function omniSideToReveal(
  prefs: Pick<ViewPrefs, "placements" | "collapsedLeft" | "collapsedRight">,
  id: PanelId,
): Side | null {
  const side = panelSideOf(prefs, id);
  const collapsed = side === "left" ? prefs.collapsedLeft : prefs.collapsedRight;
  return collapsed ? side : null;
}
