/**
 * Shared drag/press blocklist selectors — the SSOT for "which descendants of a
 * draggable surface must NOT start a drag/lift/pin gesture when pressed."
 *
 * Three sites used to carry a hand-copied, character-identical copy of the
 * interactive-controls list (FloatingPanel window-drag, PanelCard card-lift,
 * OmniViewPanel pin-on-mousedown). They drifted apart silently. This module
 * holds the ONE list so a new interactive control (or a fix) lands everywhere.
 *
 * Runtime LEAF — imports nothing — so any UI module can consume it without a
 * cycle.
 */

/**
 * Interactive controls a press must pass THROUGH untouched: native form
 * controls, links, rich-text surfaces, explicitly-draggable elements, and the
 * opt-out hatch `[data-no-window-drag]`. A press whose target `closest()`-es one
 * of these should NOT begin the surrounding drag/lift/pin gesture.
 *
 * This is the shared BASE list. The window-drag site additionally appends
 * `[data-card]` (see {@link WINDOW_DRAG_BLOCK_SELECTOR}) so a press on a CARD
 * surface inside a float lifts the card instead of dragging the whole window
 * (bug #36) — that exclusion is NOT shared, because the card-lift and omni-pin
 * sites legitimately fire on card surfaces.
 */
export const INTERACTIVE_CONTROL_SELECTOR =
  "button, input, textarea, select, a, [contenteditable='true'], [draggable='true'], [data-no-window-drag]";

/**
 * The blocklist for the FloatingPanel WINDOW-drag gesture (`onHeaderMouseDown`,
 * which wraps the whole float body). Extends {@link INTERACTIVE_CONTROL_SELECTOR}
 * with `[data-card]`: a press anywhere on a card surface inside a float must
 * lift that CARD (PanelCard's own 5px-threshold lift), not drag the window
 * (bug #36 — the window-drag armed with zero threshold and won the race). The
 * window stays draggable from inter-card gaps / background, which are outside
 * any `[data-card]`.
 */
/**
 * The card SHELL — the root element every `PanelCard` renders, the thing a
 * card-level gesture (lift, pin, delete key) is ABOUT. It is also the element
 * that is `draggable="true"` for cross-editor anchor drags, which is exactly
 * why a scoped interactive-control query must be asked against IT (or
 * something inside it), never against a wrapper that contains it — see
 * {@link cardShellWithin}.
 */
export const CARD_SHELL_SELECTOR = "[data-card]";

export const WINDOW_DRAG_BLOCK_SELECTOR = `${INTERACTIVE_CONTROL_SELECTOR}, ${CARD_SHELL_SELECTOR}`;

/**
 * True when a keyboard event originated inside an EDITABLE control — a text
 * `<input>`, `<textarea>`, `<select>`, or a `contentEditable` region.
 *
 * The keyboard twin of {@link INTERACTIVE_CONTROL_SELECTOR}, and it lives here
 * for the same reason: "which controls must a gesture pass through untouched"
 * gets ONE definition, in a leaf every layer can import. It was authored inside
 * the `panel-primitives` component barrel, which no lean hook can take — so the
 * menu controller's window-CAPTURE key handler had no guard at all and a bare
 * `Backspace` typed in a focused field activated the grab menu's DELETE row
 * (task 386's sweep; the same class as that task's own card-title loss).
 *
 * Narrower than the selector on purpose: a `<button>` or a link is interactive
 * but types nothing, so a bare-key shortcut over one is legitimate.
 */
export function isEditableEventTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * True when a press (or any event) whose target is `target` originated from an
 * interactive control nested STRICTLY INSIDE `container` — so the surrounding
 * gesture that `container` owns (a card lift, an omni pin-on-touch, a float
 * window-drag, a card-level delete key) must pass through untouched.
 *
 * This is the ONE statement of the SCOPING rule, and the scoping is the whole
 * point — the selector alone is not enough. A bare
 * `target.closest(INTERACTIVE_CONTROL_SELECTOR)` walks up past the container
 * and matches whatever sits ABOVE or AT it, and the container is very often a
 * match itself: a card ROOT is `draggable="true"` for cross-editor anchor
 * drags (`CitationCard` ships it today), and `[draggable='true']` is in the
 * selector. An unscoped query over such a card answers "interactive" for a
 * press ANYWHERE on it, and the gesture is silently dead for that whole card
 * kind — which is exactly what shipped on the omni pin-on-touch (task 423):
 * the card-lift blocker scoped its query and the pin blocker, written as a
 * "mirror" of it, did not. Two hand-written copies of one rule, one of them
 * wrong, each invisible to every behavioural test of the other.
 *
 * Rules, stated once:
 *  - The hit must be a STRICT descendant: `blocker !== container`. The
 *    container being interactive is not a reason for its OWN gesture to bail.
 *  - The hit must be INSIDE the container. An interactive ancestor outside it
 *    is not this gesture's business.
 *  - `target === container` answers false — the press landed on the surface
 *    itself, not on a control within it.
 *
 * `selector` defaults to the shared base list; the float window-drag passes
 * {@link WINDOW_DRAG_BLOCK_SELECTOR} because its pass-through set is wider.
 *
 * No production file may spell `closest(INTERACTIVE_CONTROL_SELECTOR)` /
 * `closest(WINDOW_DRAG_BLOCK_SELECTOR)` itself — every site enters this door
 * (CI: `interactive-control-scope-census.test.ts`).
 */
export function pressFromInteractiveControl(
  target: EventTarget | null,
  container: Element | null,
  selector: string = INTERACTIVE_CONTROL_SELECTOR,
): boolean {
  if (!(target instanceof Element) || !container || target === container) return false;
  const blocker = target.closest(selector);
  return !!blocker && blocker !== container && container.contains(blocker);
}

/**
 * The card shell the press landed in, confined to `wrapper` — or `null` when
 * the target sits in no shell inside it.
 *
 * A surface that wraps a card from OUTSIDE (the omni entry wrapper) cannot ask
 * {@link pressFromInteractiveControl} against itself: the card root is a
 * strict descendant of the wrapper AND a `[draggable='true']` match, so the
 * wrapper-scoped answer is "interactive" for a press anywhere on the card —
 * the task-423 defect in a second costume. The question is about the SHELL,
 * so the wrapper resolves the shell first and asks against that. A
 * `closest()` that walks OUT of the wrapper is not this wrapper's card.
 */
export function cardShellWithin(
  target: EventTarget | null,
  wrapper: Element | null,
): Element | null {
  if (!(target instanceof Element) || !wrapper) return null;
  const shell = target.closest(CARD_SHELL_SELECTOR);
  return shell && wrapper.contains(shell) ? shell : null;
}
