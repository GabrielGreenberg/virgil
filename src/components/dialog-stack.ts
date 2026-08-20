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
 * An import-free leaf on purpose — the shell is the only consumer today, but the
 * question "who owns the keyboard right now?" is not a React question, and the
 * next surface that needs to ask it must not have to import the component to do so.
 */

export interface DialogToken {
  readonly id: number;
}

let nextId = 1;
const stack: DialogToken[] = [];

/** Push a newly-opened dialog onto the stack; returns its token. */
export function pushDialog(): DialogToken {
  const token: DialogToken = { id: nextId++ };
  stack.push(token);
  return token;
}

/** Remove a dialog from the stack (close/unmount). Safe to call twice. */
export function popDialog(token: DialogToken): void {
  const i = stack.indexOf(token);
  if (i !== -1) stack.splice(i, 1);
}

/** Is this dialog the live keyboard owner? */
export function isTopDialog(token: DialogToken): boolean {
  return stack.length > 0 && stack[stack.length - 1] === token;
}

/** Test-only: drop every entry (a component that threw mid-mount can leak one). */
export function __resetDialogStack(): void {
  stack.length = 0;
}
