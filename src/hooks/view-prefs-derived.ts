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
 * `useViewPrefs.ts` RE-EXPORTS these (it imports only types from here, so
 * there is no runtime cycle), so consumers can import from either module —
 * the heavy-chain-sensitive ones import directly from this leaf.
 */
import type { PanelId, Side, ViewPrefs } from "@/hooks/useViewPrefs";

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
