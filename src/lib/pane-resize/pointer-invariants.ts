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

import { isCancelEscape } from "@/lib/key-intent";
import { isMac } from "@/lib/platform";

/**
 * Is this press a CONTEXT click — the platform's "open the context menu"
 * chord rather than a primary press? On macOS (and iPadOS with a pointer)
 * Ctrl+click reports `button === 0` and is followed by a `contextmenu`, so the
 * button number alone cannot tell it from a plain click (task 1449). Elsewhere
 * Ctrl+click is an ordinary modified primary press and stays one.
 */
export function isContextClick(e: { button: number; ctrlKey?: boolean }): boolean {
  if (e.button === 2) return true;
  return e.button === 0 && e.ctrlKey === true && isMac();
}

/**
 * May this event START a drag — or act as a one-shot press (`press-props`)?
 *
 * Primary button, primary pointer only, and never a context click. A
 * right-press must not begin a gesture whose end event the context menu then
 * eats; a macOS Ctrl+click IS a right-press in all but its button number, so
 * it is refused too (task 1449) — a native `<button>` does not act on it, and
 * neither does any press or gesture this gate admits. `isPrimary` exists on
 * PointerEvent only; a MouseEvent-based gesture passes an object without it
 * and is gated on the button alone.
 *
 * Every caller takes this gate whole (task 1449 audited them: the pane-resize
 * engine, the float/card/marginalia/outline/scrollbar drags, the atom and
 * text-object grabs, the content-drag start, the ⚡ bolt's press latch and the
 * press door) — none of them means anything by a context click, and each would
 * otherwise start a gesture whose release the menu swallows. A caller that
 * someday wants Ctrl+click on a Mac must test `isContextClick` itself, out
 * loud, rather than re-derive the button check.
 */
export function isPrimaryDragStart(e: {
  button: number;
  isPrimary?: boolean;
  ctrlKey?: boolean;
}): boolean {
  return e.button === 0 && e.isPrimary !== false && !isContextClick(e);
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
 * The END edge for a LATCH — a "the primary button is held" flag that tracks
 * no movement of its own, so `isMissedRelease` has no move handler to live in
 * (task 993). The ⚡ bolt's editor-press latch is the shape: it took the start
 * gate, cleared only on a window `mouseup`, and so a release the page never saw
 * (Cmd+Tab with the button held, macOS Ctrl+click's context menu eating the
 * mouseup — Ctrl+click is `button 0`, so it passed the start gate until task
 * 1449 taught the gate `isContextClick`) wedged the latch until some later
 * click anywhere. The `contextmenu` edge below stays: any other menu chord
 * the gate does not know still ends the latch.
 *
 * Arm it at the press; `onEnd` fires EXACTLY ONCE, on the first of:
 *   - the real `mouseup`,
 *   - a `mousemove` that `isMissedRelease` (the release happened elsewhere),
 *   - a `contextmenu` (the menu that is about to eat the release),
 *   - a window `blur` (focus left the window mid-press).
 * All four are window-capture listeners, armed only while the press is held
 * and removed on the end edge — zero cost between presses, none per keystroke.
 * The returned disposer disarms without firing (effect cleanup).
 */
export function watchHeldPress(onEnd: () => void): () => void {
  let armed = true;
  const disarm = () => {
    if (!armed) return;
    armed = false;
    window.removeEventListener("mouseup", end, true);
    window.removeEventListener("mousemove", onMove, true);
    window.removeEventListener("contextmenu", end, true);
    window.removeEventListener("blur", end, true);
  };
  function end() {
    if (!armed) return;
    disarm();
    onEnd();
  }
  function onMove(e: MouseEvent) {
    if (isMissedRelease(e)) end();
  }
  window.addEventListener("mouseup", end, true);
  window.addEventListener("mousemove", onMove, true);
  window.addEventListener("contextmenu", end, true);
  window.addEventListener("blur", end, true);
  return disarm;
}

/**
 * A live gesture — or a live EDIT SESSION — OWNS the keys it answers.
 *
 * Whichever it is, it is the INNERMOST transient thing on screen — more
 * transient than any dialog, menu or mode the user has left open behind it —
 * so one press must end exactly one thing. Virgil already states that rule one level down,
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
 * The SECOND member is a live edit session, and it cost the same two victims
 * (task 552). The paragraph-title `<input>` is appended to `document.body`,
 * so it is the event TARGET and every `window`/`document` CAPTURE listener has
 * already run by the time its own handler fires — but Escape's damage is all
 * in the BUBBLE phase, which a claim from the target does stop. The paragraph
 * had been claiming by hand (a bare `ev.stopPropagation()` on EVERY keydown,
 * which also swallowed Cmd-S / Cmd-P — a key the session does NOT answer);
 * its list and expex twins claimed nothing at all, so Escape in either of
 * those inputs discarded an unsaved margin-edit session, closed a scrimless
 * Preferences / bug-report window, and committed-or-discarded an open
 * `NodeEditPopover`. `title-edit-session.ts` claims Enter and Escape here —
 * the keys it answers, and only those.
 *
 * STATED LIMIT, so nobody discovers it later and calls it a bug: this claims
 * PROPAGATION, not the whole target. `stopPropagation()` does not stop a
 * listener already registered on the SAME target in the SAME phase, so an
 * open menu's `window`+capture Escape handlers (`useMenuDismiss`,
 * `useMenuKeyboard`) still run. That is accepted: a menu is dismissed by the
 * divider's own `pointerdown` long before Escape is pressed (`useMenuDismiss`
 * reads the outside press on `pointerdown` since task 746 — on `mousedown`, a
 * divider's preventDefaulted pointerdown suppressed it and the menu stayed
 * open), and
 * `stopImmediatePropagation()` — the only thing that would reach them — would
 * also silence unrelated same-target listeners the app depends on
 * (`input-modality`'s typing tracker is exactly the shape AGENTS.md says must
 * never be silenced). Claim propagation, not the target.
 */
export function claimGestureKey(e: KeyboardEvent): void {
  e.preventDefault();
  e.stopPropagation();
}

/**
 * Arm a gesture's Escape cancel — the third invariant packaged as a DOOR, for
 * a held gesture whose pointer listeners are ELEMENT-scoped (React props, or
 * pointer capture) and so has no window-listener teardown block to hang a
 * keydown removal on (task 1617: the strip-icon reorder). A window CAPTURE
 * keydown that, on the first non-IME Escape, CLAIMS the press
 * (`claimGestureKey` — one press ends exactly one thing) and fires `onCancel`
 * once, disarming itself first. The returned disposer disarms without firing;
 * the gesture's one teardown calls it, so the listener lives exactly as long
 * as the gesture and costs nothing between gestures.
 *
 * A gesture that already owns a window-listener teardown block (FloatingPanel,
 * focus-band-drag) wires the same three lines inline there instead — the
 * Escape census reads both shapes (`answersEscape` in
 * `pane-drag-guardrail.test.ts`).
 */
export function armGestureEscape(onCancel: () => void): () => void {
  let armed = true;
  const disarm = () => {
    if (!armed) return;
    armed = false;
    window.removeEventListener("keydown", onKey, true);
  };
  function onKey(e: KeyboardEvent) {
    if (!isCancelEscape(e)) return;
    claimGestureKey(e);
    disarm();
    onCancel();
  }
  window.addEventListener("keydown", onKey, true);
  return disarm;
}
