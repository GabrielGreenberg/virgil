/**
 * What does `Enter` do while a dialog is open?
 *
 * ONE rule, stated once, for every SystemDialog past and future:
 *
 * > **Enter in a dialog activates a BUTTON — the focused in-frame button if there
 * > is one, otherwise the dialog's CUED DEFAULT.** It is never gated on whether
 * > the cued button happens to be holding DOM focus.
 *
 * Pre-389 the shell activated the cued button only while
 * `document.activeElement === theCuedButton`, and the cue is set by a
 * `requestAnimationFrame` at open. That condition is an implementation accident
 * the user cannot see: the button RENDERS as the accented default whether or not
 * focus landed on it, so any dialog opened from a pointer gesture whose
 * surroundings manage focus — the drop-mode `confirm` at the end of a drag, the
 * reported "Re-anchor this snippet?" — showed a cued button that Return did not
 * press. That is the false-affordance shape: what the chrome OFFERS is what the
 * key must ACCEPT.
 *
 * The exceptions are stated as a question about the TARGET, not about focus:
 *
 *  - **Inside the frame**, a control that owns `Enter` keeps it. A `textarea` or
 *    contenteditable types a newline (CodeMirror inside `StyleEditorModal`), a
 *    `select` opens, a link navigates, a `<summary>` toggles, an input whose type
 *    natively activates does its own thing. A control that consumed the key by
 *    calling `preventDefault()` keeps it too — that is the platform's own way of
 *    saying "mine", and an in-dialog control that consumes Enter must say so.
 *  - **Inside the frame on a plain single-line `<input>`**, Enter SUBMITS to the
 *    cued default — the platform convention for prompt-style dialogs.
 *  - **Outside the frame**, a MODAL dialog owns the keyboard: `aria-modal` is a
 *    promise, and the commonest way focus ends up outside is exactly the theft
 *    this task is about. The shell answers such an Enter at window CAPTURE, so
 *    ProseMirror's own `Enter` (a new paragraph in the user's document, behind an
 *    open modal) never sees it. A SCRIMLESS variant is deliberately NOT modal —
 *    the Preferences window and the bug-report window sit beside the document
 *    while the user keeps typing — so it answers nothing from outside its frame.
 *
 * Activating a focused in-frame `<button>` OURSELVES (rather than leaving it to
 * the browser's synthesized click) is what makes the whole rule one rule and
 * exactly-once: `preventDefault()` on the keydown suppresses the native
 * activation, so the click fires once, in every environment. It also folds the
 * pre-389 special case — "the cued button is focused, so preventDefault + click"
 * — into the general statement instead of leaving it beside it.
 */

export type DialogEnterVerdict =
  /** The shell activates the dialog's registered cued default. */
  | { kind: "cued-default" }
  /** The shell activates THIS in-frame button (focused; native click suppressed). */
  | { kind: "activate"; button: HTMLButtonElement }
  /** Not ours — the target owns this key, or the dialog has no claim on it. */
  | { kind: "hands-off" };

const HANDS_OFF_TAGS = new Set(["TEXTAREA", "SELECT", "A", "SUMMARY"]);

/**
 * Input types the shell keeps its hands off.
 *
 * `button` / `submit` / `reset` / `image` / `file` activate themselves. `checkbox`
 * and `radio` are here for the opposite reason — they activate on SPACE and do
 * nothing on Enter — and that is a deliberate reversal of this file's first cut,
 * which excluded them so a "dialog checkbox" would answer Return. Measured, that
 * bought nothing and cost a real regression: `PrintDialog`'s options are
 * `<button>`s (already covered by the BUTTON rule), while the one genuine
 * `<input type="radio">` in a dialog is `ManageStylesModal`'s default-style
 * picker — whose cued default is "Done", so Enter on a focused radio would have
 * closed the entire modal. Pre-389 it did nothing; it does nothing now.
 */
const SELF_ACTIVATING_INPUT_TYPES = new Set([
  "button",
  "submit",
  "reset",
  "image",
  "file",
  "checkbox",
  "radio",
]);

function ownsEnter(el: Element): boolean {
  const tag = el.tagName;
  if (tag === "A") return el.hasAttribute("href");
  if (HANDS_OFF_TAGS.has(tag)) return true;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type?.toLowerCase() ?? "text";
    return SELF_ACTIVATING_INPUT_TYPES.has(type);
  }
  if (el.getAttribute("role") === "button") return true;
  // contenteditable — a CodeMirror surface, a ProseMirror card body, any rich
  // field the dialog happens to host. `isContentEditable` is inherited, so this
  // also covers a <span> inside one.
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

export interface DialogEnterQuery {
  /** `KeyboardEvent.target`. */
  target: EventTarget | null;
  /** The dialog's own frame element (the box, not the scrim). */
  frame: HTMLElement | null;
  /** Does this dialog OWN the keyboard (the scrimmed `modal` variant)? */
  modal: boolean;
  /** Has something already consumed this key (`KeyboardEvent.defaultPrevented`)? */
  alreadyHandled: boolean;
  /** Phase this listener is running in. */
  phase: "capture" | "bubble";
}

/**
 * Resolve one `Enter` press against one open dialog. Pure — no DOM writes, no
 * event mutation; the caller performs the verdict.
 *
 * Split by PHASE on purpose. An out-of-frame Enter must be answered at CAPTURE,
 * before ProseMirror (or a float, or a menu) can act on it. An in-frame Enter must
 * be answered at BUBBLE, AFTER the focused control had its chance to consume the
 * key — capture-intercepting a dialog's own input would take `Enter` away from the
 * handler that field wired for itself.
 */
export function resolveDialogEnter(q: DialogEnterQuery): DialogEnterVerdict {
  const node = q.target instanceof Element ? q.target : null;
  const inFrame = !!(q.frame && node && q.frame.contains(node));

  if (q.phase === "capture") {
    // Honoured in BOTH phases: at capture almost nothing has run yet, but an
    // upstream capture listener (an open menu) may already have consumed the key,
    // and a dialog must not answer a press that was not left for it.
    if (q.alreadyHandled) return { kind: "hands-off" };
    // No frame means no dialog DOM to be inside OR outside of. Claiming the key
    // there would swallow it on behalf of a dialog that is not on screen yet.
    if (!q.frame) return { kind: "hands-off" };
    if (inFrame) return { kind: "hands-off" }; // the bubble pass owns it
    if (!q.modal) return { kind: "hands-off" }; // a non-modal window owns nothing outside itself
    return { kind: "cued-default" };
  }

  // bubble
  if (!inFrame) return { kind: "hands-off" };
  if (q.alreadyHandled) return { kind: "hands-off" };
  if (node) {
    if (node.tagName === "BUTTON") {
      const btn = node as HTMLButtonElement;
      return btn.disabled ? { kind: "hands-off" } : { kind: "activate", button: btn };
    }
    if (ownsEnter(node)) return { kind: "hands-off" };
  }
  return { kind: "cued-default" };
}

/** Modifier / repeat / IME shapes that are never a dialog's `Enter`. */
export function isPlainEnter(e: KeyboardEvent): boolean {
  if (e.key !== "Enter") return false;
  // Shift+Enter is a DISTINCT key with its own muscle memory (a hard break in
  // ProseMirror, "send without a newline" in a composer). A cue promises what a
  // plain Return does, so it must not answer a chord.
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
  // A HELD Enter must not repeat-fire a confirm. Pre-389 that could only happen
  // with the button already focused, where the browser owns the repeat; now the
  // shell answers from anywhere, so it owns the rule.
  if (e.repeat) return false;
  // Enter during IME composition commits the candidate; it is not an activation.
  if (e.isComposing || e.keyCode === 229) return false;
  return true;
}
