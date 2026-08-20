/**
 * The open-dialog STACK — one keyboard owner at a time.
 *
 * Every `SystemDialog` installs a `window` keydown listener while it is open.
 * With more than one dialog open at once — and they DO stack: `ManageStylesModal`
 * stays mounted while `StyleEditorModal` / `StyleApplyDialog` / `DocTypeChangeDialog`
 * open on top of it — a key with no owner is answered by ALL of them. Pre-stack that
 * was already a live defect for `Escape` (one press closed the nested dialog *and*
 * the one behind it); making `Enter` unconditional (task 389) would have added a
 * second, worse one: both cued defaults firing from one press.
 *
 * So the shell keeps a LIFO of open dialogs and only the TOP entry answers a key.
 * Order is MOUNT order, which is what "most recently opened" means for a dialog:
 * a nested dialog mounts after its host, and a confirm raised from anywhere mounts
 * after whatever was already up. Same shape as the menu system's `isTop` rule
 * (`useMenuKeyboard`) — one live keyboard owner per stack.
 *
 * **The owner is not simply the top entry.** A MODAL owns the keyboard by
 * definition, so the topmost modal wins outright. The scrimless variants are
 * deliberately NOT modal — `PreferencesModal` and `BugReportWindow` are both
 * `variant="draggable"`, both rendered side by side in `EditorLayout`, and both
 * can be open at once — so between two non-modal windows the owner is the one
 * the user is actually IN (its frame contains `document.activeElement`), and
 * mount order is only the fallback. Ordering by mount alone would send `Escape`
 * to whichever window opened last and close the one the user is not typing in.
 *
 * A separate module rather than module-scope state inside the component, for two
 * reasons that are about this file and not about a future caller: the resolution
 * is pure and testable without React, and a leaf cannot re-form an import cycle
 * with the component that reads it.
 */

export interface DialogToken {
  readonly id: number;
}

interface Entry {
  token: DialogToken;
  modal: boolean;
  /** The dialog's own frame element (the box, not the scrim), read lazily. */
  getFrame: () => HTMLElement | null;
}

let nextId = 1;
const stack: Entry[] = [];

/** Push a newly-opened dialog onto the stack; returns its token. */
export function pushDialog(
  modal: boolean,
  getFrame: () => HTMLElement | null,
): DialogToken {
  const token: DialogToken = { id: nextId++ };
  stack.push({ token, modal, getFrame });
  return token;
}

/** Remove a dialog from the stack (close/unmount). */
export function popDialog(token: DialogToken): void {
  const i = stack.findIndex((e) => e.token === token);
  if (i !== -1) stack.splice(i, 1);
}

/**
 * Which open dialog answers a key right now?
 *
 * Topmost MODAL if there is one — modality IS the claim "I own the keyboard".
 * Otherwise the non-modal window CONTAINING focus, because two scrimless windows
 * genuinely coexist and the user is only in one of them. Mount order is the last
 * resort, for the case where focus is nowhere near any of them — which is exactly
 * the never-claimed-focus state task 389 is about.
 */
export function keyOwner(): DialogToken | null {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].modal) return stack[i].token;
  }
  const active = typeof document !== "undefined" ? document.activeElement : null;
  if (active) {
    for (let i = stack.length - 1; i >= 0; i--) {
      const frame = stack[i].getFrame();
      if (frame && frame.contains(active)) return stack[i].token;
    }
  }
  return stack.length ? stack[stack.length - 1].token : null;
}

/** Is this dialog the live keyboard owner? */
export function isKeyOwner(token: DialogToken): boolean {
  return keyOwner() === token;
}

/** Test-only: drop every entry (suites share this module's state). */
export function __resetDialogStack(): void {
  stack.length = 0;
}
