/**
 * The two pointer invariants every drag gesture in the app must honor — the
 * SSOT behind `usePaneResizeHandle`'s start gate and its missed-release
 * failsafe (task 185).
 *
 * They live apart from the engine because not every gesture FITS the engine.
 * A pane divider is a `getValue/apply/commit(px)` shape and belongs on
 * `usePaneResizeHandle`; a snap-to-row *selection* gesture (the Outline
 * FocusBand) or a float move has no px value to apply and legitimately stays
 * bespoke. What is NOT optional for either kind is these two checks: without
 * them a gesture whose end event is never delivered stays live, keeps
 * repainting under a released pointer, and commits on the user's next click.
 * A bespoke gesture imports these; it does not re-derive them.
 */

/**
 * May this event START a drag?
 *
 * Primary button, primary pointer only. A right-press must not begin a gesture
 * whose end event the context menu then eats. `isPrimary` exists on
 * PointerEvent only; a MouseEvent-based gesture passes an object without it
 * and is gated on the button alone.
 */
export function isPrimaryDragStart(e: { button: number; isPrimary?: boolean }): boolean {
  return e.button === 0 && e.isPrimary !== false;
}

/**
 * Did we MISS the release? True when a move event arrives with the primary
 * button no longer held — the release happened somewhere we never observed
 * (over an iframe, outside the window, swallowed by a context menu), so the
 * gesture must end NOW and must NOT incorporate this event's coordinate (that
 * would be ghost movement the user never made).
 *
 * Bit test, not `buttons === 0`: gestures are gated to button 0 at start, and
 * releasing it while another button is chorded fires a move with an updated
 * mask — `pointerup`/`mouseup` only fires for the LAST button, which would
 * keep a button-up drag tracking until then.
 */
export function isMissedRelease(e: { buttons: number }): boolean {
  return (e.buttons & 1) === 0;
}
