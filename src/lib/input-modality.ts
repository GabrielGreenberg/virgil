/**
 * input-modality.ts — POINTER vs KEYBOARD, the app-level fact that
 * pointer-derived chrome must consult before it re-answers itself.
 *
 * > **A HOVER answer is derived from where the pointer IS. Only POINTER input
 * > may (re-)derive it. A document or selection change is not pointer input —
 * > it invalidates the answer, it never re-answers it.**
 *
 * This is the "typing in a list feels like being watched by large processes"
 * class (task 336). `TextObjectGrabHandle` stores the pointer's last position
 * and re-resolves the hovered block from it on every `docChanged` /
 * `selectionUpdate` — i.e. on every keystroke — because the physical pointer
 * is armed for the whole session: it rests wherever the user last clicked to
 * place the caret. Nothing moved and nothing could have changed the answer the
 * user cares about, yet each keystroke re-ran a hover hit-test plus one
 * `computePlacement` per containing level (2–3 in a list, each ~3× a
 * paragraph's forced-layout reads).
 *
 * Every previous probe missed it because the whole chain is mouse-gated: a
 * synthetic keystroke harness — and any measurement taken with the pointer
 * parked over devtools — leaves the stored position null, so the resolver
 * returns `[]` and costs nothing. The measurement condition that reproduces it
 * is "the mouse is ARMED", which is also the ordinary condition of use.
 *
 * ## Why the signal is the raw INPUT EVENT, not the derived change
 *
 * The obvious gate — "a `docChanged`/`selectionUpdate` invalidates the stored
 * point" — is wrong in a way that only shows up on a CLICK: clicking into
 * prose moves the selection, so it would invalidate the pointer's own answer
 * and the handle would stay hidden until the user jiggled the mouse. Whether a
 * re-arm from the click's own `mousedown` lands before or after ProseMirror's
 * selection sync is an ordering race we would then have to win.
 *
 * Reading the DEVICE removes the race: a `keydown` is keyboard, a `mousemove`
 * is pointer, and a click never produces a `keydown`. Pure modifiers
 * (Shift / Control / Alt / Meta / CapsLock) are deliberately NOT keyboard
 * input here — they type nothing, and treating them as typing would unmount
 * the very handle a user is reaching for with a chorded click.
 *
 * ## Shape
 *
 * The keyboard half is GLOBAL and self-installing (one capture-phase,
 * passive `keydown` listener on `document`, refcounted through
 * {@link subscribeInputModality}); the pointer half is REPORTED by consumers
 * from their own pointer handlers ({@link notePointerInput}), so no
 * always-on app-wide `mousemove` listener is added to restore a flag that
 * only pointer-derived chrome reads.
 *
 * KEYSTROKE SANCTITY: `noteKeyboard` / {@link notePointerInput} are O(1) with
 * an early return when the modality is unchanged, so a burst of keystrokes
 * notifies exactly ONCE (the flip edge) and a stream of mousemoves notifies
 * zero times after the first.
 */

export type InputModality = "pointer" | "keyboard";

let modality: InputModality = "pointer";

const listeners = new Set<(m: InputModality) => void>();

/**
 * Keys that type nothing on their own. A chorded click (Cmd-click, Shift-click)
 * begins with one of these, and a hover affordance that vanished on the
 * modifier keydown would be gone before the click that wanted it landed.
 */
const PURE_MODIFIER_KEYS = new Set([
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "CapsLock",
  "NumLock",
  "ScrollLock",
  "AltGraph",
  "Fn",
  "FnLock",
  "Hyper",
  "Super",
  "Symbol",
  "SymbolLock",
]);

function setModality(next: InputModality): void {
  if (next === modality) return;
  modality = next;
  for (const fn of listeners) fn(next);
}

function onKeyDown(e: KeyboardEvent): void {
  if (PURE_MODIFIER_KEYS.has(e.key)) return;
  setModality("keyboard");
}

let installed = false;

function install(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  // Capture phase: a handler that stops propagation (a popup's key trap) must
  // not be able to hide the fact that the user is typing. Passive: this never
  // calls preventDefault.
  document.addEventListener("keydown", onKeyDown, {
    capture: true,
    passive: true,
  });
}

function uninstall(): void {
  if (!installed || typeof document === "undefined") return;
  installed = false;
  document.removeEventListener("keydown", onKeyDown, { capture: true });
}

/**
 * Report REAL pointer input. Restores pointer modality, so a pointer-derived
 * answer becomes live again. Call it from a genuine pointer event handler —
 * never from a doc/selection change, which is precisely what this module
 * exists to stop being mistaken for pointer input.
 */
export function notePointerInput(): void {
  setModality("pointer");
}

/**
 * True while the user is working the KEYBOARD — the state in which a stored
 * pointer position is no longer a sanctioned basis for re-deriving hover
 * chrome. The read is a module-local boolean compare: safe on any hot path.
 */
export function isTypingModality(): boolean {
  return modality === "keyboard";
}

/** The live modality. Exposed for the flip-edge consumers' own diagnostics. */
export function currentInputModality(): InputModality {
  return modality;
}

/**
 * Subscribe to modality FLIPS (never to individual events — a 40-character
 * burst fires this once). The `keydown` listener is installed on the first
 * subscription and removed with the last, so an app with no pointer-derived
 * chrome mounted carries no listener at all.
 */
export function subscribeInputModality(
  fn: (m: InputModality) => void,
): () => void {
  listeners.add(fn);
  install();
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) uninstall();
  };
}
