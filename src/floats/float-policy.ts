/**
 * Float policy — the single home for "how big / how tall / how high" a popped
 * window may be. Part of the AF `src/floats/` subsystem: collapsing the
 * scattered default-size copies, the viewport height cap, and the z-index base
 * into one module so per-kind invariants stop drifting (AF-floatable-audit §6).
 *
 * This module is a runtime LEAF — it imports only the layout constants. Both
 * the card float wrapper and the text-object grab-handle/registry read from
 * here, so any heavier import would risk a cycle.
 */
import { FLOATING_PANEL_Z_BASE } from "@/components/editor-layout/constants";

/**
 * The default size of a freshly-spawned float, used when a `Floatable` carries
 * no `defaultSize` and no saved `cardFloatPositions` rect. Collapses the three
 * historical `360×280` copies: `POPUP_W/H` (EditorPane), `DEFAULT_W/H`
 * (FloatingCards), `LIFT_FLOAT_W/H` (panel-primitives lift gesture).
 */
export const FLOAT_DEFAULT_SIZE = { w: 360, h: 280 } as const;

/**
 * Base paint z-index for card / text-object floats. They sit ABOVE the panel
 * band (`FLOATING_PANEL_Z_BASE` = 1000) — preserving today's behavior where a
 * popped card renders over a docked panel float. Replaces the magic `1200`
 * hardcoded in `FloatingCards`. The per-float offset on top of this base comes
 * from the MRU focus stack (raise-on-click), not insertion order.
 */
export const FLOAT_Z_BASE = 1200;

// Re-exported so panel z-stacking and the float band reference one symbol.
export { FLOATING_PANEL_Z_BASE };

/**
 * Shared "how tall can a popout be" policy — the maximum height of any
 * popped-out card/text-object as a fraction of the viewport, applied as a MAX
 * (never a floor; short content opens at its natural height). One value for
 * BOTH the lifted-overlay capture cap (`TextObjectGrabHandle`) and the
 * instant-popout auto-fit grow cap (`FloatWindow`), so a popped section always
 * fits on screen and scrolls internally for the overflow. User-chosen
 * 2026-06-01 (the 50–60% range); supersedes the old per-site 0.4 cap
 * (Issue-13). Relocated here from `text-object-registry` (it is a *float*
 * policy, not a text-object one); the registry re-exports it for back-compat.
 */
export const POPOUT_MAX_VH = 0.55;

/**
 * Apply the shared {@link POPOUT_MAX_VH} cap to a popout-related height.
 * A MAX, not a floor — short content (`naturalHeight < cap`) is returned
 * unchanged. One function for BOTH cap sites so they can never drift.
 */
export function capPopoutHeight(
  naturalHeight: number,
  viewportHeight: number,
): number {
  return Math.min(naturalHeight, Math.floor(viewportHeight * POPOUT_MAX_VH));
}
