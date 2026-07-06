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
 * no `defaultSize` and no saved `cardFloatPositions` rect. Collapses the
 * historical `360×280` copies: `POPUP_W/H` (EditorPane), `DEFAULT_W/H`
 * (FloatingCards). (`LIFT_FLOAT_W/H` is gone entirely - the lift gesture now
 * preserves the docked card's measured rect via `liftSpawnRect`.)
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

/**
 * Paint z-index for a scrimless **draggable tool window** — a `SystemDialog`
 * rendered with `variant="draggable"` (the Preferences window; conceptually the
 * band FontsDialog's FloatingPanel also lives in). Sits just ABOVE the float
 * card layer so a tool window the user dragged out composes over popped cards,
 * but strictly BELOW {@link OPEN_CHROME_MENU_Z} (so a chrome menu opened from
 * inside the window stacks on top) and far below the modal tier. Replaces the
 * bare `z-[9999]` PreferencesModal used to hardcode — which collided with
 * {@link DROP_INDICATOR_Z} (task 033).
 */
export const DRAGGABLE_DIALOG_Z = FLOAT_Z_BASE + 5;

// Re-exported so panel z-stacking and the float band reference one symbol.
export { FLOATING_PANEL_Z_BASE };

/**
 * Editor stacking tiers, low → high — the SSOT map for "what paints over what"
 * across the editor surface. Every chrome layer that needs to reason about
 * floats should derive its z-index from one of these symbols, never a magic
 * number, so the ordering invariants below can't silently drift:
 *
 *   text / content              ~1–31  (editor prose, sticky pod caps, Virgil
 *                                       bar — local z's inside the editor)
 *   panel band                  1000   (FLOATING_PANEL_Z_BASE — docked panels)
 *   RESTING margin triggers     1199   (RESTING_MARGIN_TRIGGER_Z — the margin
 *                                       bolt / drag handle at rest: ABOVE
 *                                       content + panels so it's clickable, but
 *                                       just BELOW the float layer so a popout
 *                                       dropped over its paragraph OCCLUDES it)
 *   float layer                 1200   (FLOAT_Z_BASE — popped cards, the
 *                                       lifted-text overlay, the inline-atom
 *                                       drag ghost; CSS mirror at z-index:1200
 *                                       in globals.css)
 *   open chrome menus           2000   (OPEN_CHROME_MENU_Z — the <Menu>
 *                                       primitive's CHROME_Z; a transient open
 *                                       menu, e.g. the ActionsMenuPanel that the
 *                                       margin bolt opens, MUST stay on top of
 *                                       everything INCLUDING floats)
 *   drop-mode indicator         9999   (DROP_INDICATOR_Z — the blue insertion
 *                                       bar; above floats and ghosts during a
 *                                       move, Issue-11)
 *   modal scrim + dialogs      10000   (MODAL_SCRIM_Z — the SystemDialog
 *                                       backdrop and every centered dialog;
 *                                       above the drop indicator so an open
 *                                       modal is never pierced by a stale bar)
 *   hint / tooltip bubble      10010   (HINT_Z — data-hint bubbles; one above
 *                                       the modal tier so a hint on a modal
 *                                       control shows over the dialog)
 *
 * The load-bearing split: a RESTING trigger and the OPEN menu it spawns live in
 * DIFFERENT tiers. The bolt-at-rest is demoted below floats (so floats occlude
 * it — BUG #50); the menu it opens rides OPEN_CHROME_MENU_Z and is never
 * demoted. Keep that split principled — derive, don't hardcode.
 */

/**
 * Paint z-index for an editor MARGIN TRIGGER at REST (the lightning-bolt action
 * button beside the current paragraph; conceptually also the left drag handle).
 * One below {@link FLOAT_Z_BASE}: high enough to sit over editor content and the
 * docked-panel band so it stays clickable when nothing overlaps, but strictly
 * below the float layer so a popout / popped card / lifted-text overlay dropped
 * over the trigger's paragraph OCCLUDES it (BUG #50). This is the RESTING tier
 * only — clicking the bolt opens a menu that rides {@link OPEN_CHROME_MENU_Z}.
 */
export const RESTING_MARGIN_TRIGGER_Z = FLOAT_Z_BASE - 1;

/**
 * Paint z-index for a transient OPEN chrome menu (the `<Menu>` primitive's
 * `CHROME_Z`; e.g. the ActionsMenuPanel the margin bolt spawns). Above the
 * float layer so an open menu always composes on top of floats. Declared here
 * so the resting-trigger ↔ open-menu z split reads from one tier map; the
 * `<Menu>` primitive's `CHROME_Z` is wired to THIS symbol, so the resting-bolt
 * (below floats) vs open-menu (above floats) split can never drift.
 */
export const OPEN_CHROME_MENU_Z = 2000;

/**
 * The modal / tooltip z-scale — the top of the ladder, ABOVE every float and
 * open chrome menu. These three tiers were previously bare literals scattered
 * across `system-dialog.tsx` (`z-[10000]`), `drop-mode/Indicator.tsx` (`9999`),
 * and `globals.css` (`.hint-bubble` `10010`); named here so the ordering
 * (drop-indicator < modal < hint) is one SSOT the ordering-invariant test pins,
 * and so they can't silently be re-typed as drifting magic numbers.
 *
 *   DROP_INDICATOR_Z  9999   the blue insertion bar during a move (Issue-11);
 *                            above floats/ghosts but below an open modal.
 *   MODAL_SCRIM_Z    10000   the SystemDialog backdrop + every centered dialog.
 *   HINT_Z           10010   data-hint tooltip bubbles; one above the modal
 *                            tier so a hint on a modal control still shows.
 *
 * `HINT_Z` has no TS consumer (the only site is the `.hint-bubble` CSS rule,
 * which can't import TS) — it lives here purely as the documented SSOT the CSS
 * literal mirrors and the ordering test guards.
 */
export const DROP_INDICATOR_Z = 9999;
export const MODAL_SCRIM_Z = 10000;
export const HINT_Z = 10010;

/**
 * Shared "how tall can a popout be" policy — the maximum height of any
 * popped-out card/text-object as a fraction of the viewport, applied as a MAX
 * (never a floor; short content opens at its natural height). One value for
 * BOTH consumption sites (verified 2026-06-12): the text-object lift's
 * capture cap (`TextObjectGrabHandle`, applied once to the measured source
 * height at lift time) and `FloatWindow`'s collapsed-lift expand-to-content
 * grow (back since pop-out continuity #20/#21 — it caps the
 * `collectClippedHeight` natural height), so a popped section always fits on
 * screen and scrolls internally for the overflow. User-chosen 2026-06-01
 * (the 50–60% range); supersedes the old per-site 0.4 cap (Issue-13).
 * Relocated here from `text-object-registry` (it is a *float* policy, not a
 * text-object one); the registry re-exports it for back-compat.
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

/* ── Text-object float chrome constants ─────────────────────────────
 * The float-WINDOW-layer metrics of a popped text-object, centralized
 * here so the lifted-overlay spawn math (TextObjectGrabHandle /
 * LiftedTextOverlay) and the float body's own padding cannot drift.
 * The text-float header is `FloatChrome` — the SAME `h-6` strip cards
 * use, so its height IS `CARD_FLOAT_HEADER_H` above (the deleted
 * `TextObjectFloat.tsx` used to own a separate copy). */

/** Body padding of every text-object float body (the `par-float-body`
 *  wrappers in src/text-objects/floats/*): 32px horizontal / 16px
 *  vertical. Realized in JSX via {@link TEXT_FLOAT_BODY_PAD_CLASS};
 *  ALSO mirrored by the `.lifted-text-overlay__body` popout-mode
 *  padding rule in globals.css (CSS can't import TS — update both). */
export const TEXT_FLOAT_BODY_PAD_X = 32;
export const TEXT_FLOAT_BODY_PAD_Y = 16;

/** The Tailwind classes realizing {@link TEXT_FLOAT_BODY_PAD_X}/`_Y`
 *  (px-8 = 32px, py-4 = 16px) — the single class-string every text-float
 *  body consumes, so the JSX padding and the spawn-rect math share one
 *  definition. */
export const TEXT_FLOAT_BODY_PAD_CLASS = "px-8 py-4";

/** Text-object float window border, one side, in px. The float
 *  (`FloatingPanel` surface="card") is border-box with
 *  `border: var(--pod-border)` (1px each side); the lifted overlay gains
 *  the same border in popout mode (globals.css
 *  `.lifted-text-overlay[data-lift-mode="popout"]`). Mirrors
 *  `--pod-border`'s width. Same value as {@link CARD_FLOAT_BORDER} but a
 *  separate name: this one compensates lifted-overlay/spawn geometry,
 *  that one the card lift formula — they could diverge if the surfaces
 *  ever did. */
export const TEXT_FLOAT_BORDER = 1;

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
 *
 * Known 1px carve-out: `bareWindow` floats (bib/ai, pre-Stage-6) render no
 * FloatChrome - their real chrome above the body is 1px on both sides, so
 * the +1/-1 compensation is 1px off for them. Accepted until the Stage-6
 * chrome migration makes the formula exact for every kind.
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

/**
 * Height (px) currently clipped away inside `root`'s subtree — the sum of
 * `scrollHeight − clientHeight` over the clip containers (overflow ≠
 * visible). In the float's nested flex column every level either clips
 * (overflow-hidden/auto) or sits at natural height inside a clipping
 * parent, so `current float height + deficit` IS the float's natural
 * content height: each box's visible part is counted once by its parent
 * and its hidden remainder once by its own deficit. Overflow-visible
 * elements are skipped — their overflow already rides up into the
 * nearest clipping ancestor's scrollHeight (counting both would double).
 * One-shot O(subtree) walk; runs only on a collapsed-card lift.
 */
export function collectClippedHeight(root: HTMLElement): number {
  let sum = Math.max(0, root.scrollHeight - root.clientHeight);
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    const deficit = el.scrollHeight - el.clientHeight;
    if (deficit <= 0) continue;
    if (getComputedStyle(el).overflowY === "visible") continue;
    sum += deficit;
  }
  return sum;
}
