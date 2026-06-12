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

/* ── Card-float chrome constants ─────────────────────────────────────
 * The chrome boxes that wrap a popped card's body, centralized here per
 * this module's charter (one home for float sizing policy). Each mirrors
 * a concrete style in the float stack — update BOTH if either changes:
 */

/** `FloatChrome`'s header strip: `h-6` (24px), INCLUDING its 1px
 *  `border-b` (Tailwind preflight border-box). src/floats/FloatChrome.tsx. */
export const CARD_FLOAT_HEADER_H = 24;
/** `FloatingPanel`'s floating window border for the `"card"` surface:
 *  `var(--pod-border, 1px solid #e5e2dd)` → 1px per edge.
 *  src/components/FloatingPanel.tsx (floating-mode containerStyle). */
export const CARD_FLOAT_BORDER = 1;
/** A docked `PanelCard`'s own border: `CARD_BASE`'s `border` → 1px per
 *  edge. src/components/panel-primitives.tsx. */
export const DOCKED_CARD_BORDER = 1;
/** The docked unified card header: `h-6` (24px), borderless — its
 *  header/body divider is the SEPARATE `border-t` row below. */
export const DOCKED_CARD_HEADER_H = 24;
/** The docked header/body separator row: a zero-content div carrying a
 *  1px `border-t` (rendered when `showSeparator`, the default). */
export const DOCKED_CARD_SEPARATOR_H = 1;
/** Min distance (px) a spawned float keeps from the viewport top/bottom
 *  when its grown height forces a Y clamp. Mirrors the text-object
 *  lift's `SPAWN_FIT_MARGIN` (TextObjectGrabHandle) and the legacy
 *  auto-fit `adjustedY` convention. */
export const FLOAT_SPAWN_FIT_MARGIN = 20;

/** Chrome stacked above the docked card's body content:
 *  1px card border + 24px header + 1px separator = 26. */
const DOCKED_CHROME_TOP =
  DOCKED_CARD_BORDER + DOCKED_CARD_HEADER_H + DOCKED_CARD_SEPARATOR_H;
/** Chrome stacked above the float's body content:
 *  1px window border + 24px FloatChrome (its border-b rides inside) = 25. */
const FLOAT_CHROME_TOP = CARD_FLOAT_BORDER + CARD_FLOAT_HEADER_H;

/** Viewport rect of the docked card at lift time (a
 *  `getBoundingClientRect()` snapshot — border-box, so the card's own
 *  border is inside `width`/`height`). */
export interface LiftSourceRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The ONE formula deriving a lifted card float's spawn rect from the
 * measured docked-card rect (pop-out continuity, Session-17 #20). The
 * float is chrome-compensated so the card BODY does not visually move:
 *
 *  - Horizontally the docked card's 1px border and the float window's
 *    1px border cancel → `x = left`, `width = width` (body spans
 *    `+1 … −1` inside both boxes).
 *  - Vertically the docked chrome above the body is 26px
 *    (border + header + separator) while the float's is 25px
 *    (border + FloatChrome, whose divider rides inside its 24px), so
 *    the float frame drops 1px and gives that pixel back from its
 *    height: `y = top + 1`, `height = height − 1`. Bottom borders
 *    cancel (1px each).
 *
 * Used for BOTH expanded and collapsed lifts: an expanded card pops at
 * exactly this rect (ratified: preserve the exact source size, no cap);
 * a collapsed card spawns here too — header-only tall — and the float
 * path's one-shot expand-to-content grows it, capped by
 * {@link capPopoutHeight}.
 */
export function liftSpawnRect(source: LiftSourceRect): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return {
    x: Math.round(source.left),
    y: Math.round(source.top + (DOCKED_CHROME_TOP - FLOAT_CHROME_TOP)),
    width: Math.round(source.width),
    height: Math.round(
      source.height - (DOCKED_CHROME_TOP - FLOAT_CHROME_TOP),
    ),
  };
}
