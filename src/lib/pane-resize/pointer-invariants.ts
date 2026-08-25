/**
 * The invariants every drag gesture in the app must honor — the SSOT behind
 * `usePaneResizeHandle`'s start gate, its missed-release failsafe (task 185)
 * and its key claim (task 470's sibling, 471).
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

/**
 * A live pointer gesture OWNS the keys it answers.
 *
 * A gesture is the INNERMOST transient thing on screen — more transient than
 * any dialog, menu or mode the user has left open behind it — so one press
 * must end exactly one thing. Virgil already states that rule one level down,
 * for dialogs (`dialog-stack.ts`, task 389: "only the TOP entry answers a
 * key"); a gesture is the one Escape owner that used to answer without
 * claiming, and it cost real work. The engine cancels a divider drag from a
 * `window` CAPTURE listener and neither `preventDefault`ed nor
 * `stopPropagation`ed, so ONE Escape press also reached:
 *
 *   - `useMarginEdit`'s `window` BUBBLE listener, whose `cancel()` drops
 *     `liveMargins` — every guide the user has dragged this session and not
 *     yet Saved — and closes margin-edit mode under them. Not a race: a
 *     window-capture listener always precedes a window-bubble one for the
 *     same event, so this happened on every such press;
 *   - `system-dialog`'s `document` CAPTURE handler, which deliberately
 *     ignores `defaultPrevented` ("a modal always has a way out"), so a
 *     scrimless draggable window — Preferences, and the bug reporter with a
 *     half-typed report in it — closed from the same press too.
 *
 * STATED LIMIT, so nobody discovers it later and calls it a bug: this claims
 * PROPAGATION, not the whole target. `stopPropagation()` does not stop a
 * listener already registered on the SAME target in the SAME phase, so an
 * open menu's `window`+capture Escape handlers (`useMenuDismiss`,
 * `useMenuKeyboard`) still run. That is accepted: a menu is dismissed by the
 * divider's own `pointerdown` long before Escape is pressed, and
 * `stopImmediatePropagation()` — the only thing that would reach them — would
 * also silence unrelated same-target listeners the app depends on
 * (`input-modality`'s typing tracker is exactly the shape AGENTS.md says must
 * never be silenced). Claim propagation, not the target.
 */
export function claimGestureKey(e: KeyboardEvent): void {
  e.preventDefault();
  e.stopPropagation();
}
