"use client";

/**
 * The dialog BEHAVIOUR contract, for hosts that are not `SystemDialog`.
 *
 * `SystemDialog` owns the whole contract for every dialog built on it: a place
 * on the open-dialog stack (`dialog-stack.ts`), Escape answered only by the key
 * owner, and focus given BACK on close (task 531). A tool window hosted by
 * `FloatingPanel` instead — the Fonts… window, Gabriel's sanctioned pod-styled
 * fork (task 033, 2026-07-05) — keeps its pod CHROME but owes the same
 * BEHAVIOUR, and before task 1304 it had none of it: no role, no name, and an
 * Escape that did nothing at all.
 *
 * So the two legs a non-shell host needs live here, and the shell reads one of
 * them too, so there is one restore and one stack rule rather than a copy:
 *
 *  - `useDialogFocusRestore(open)` — the focus-restore leg, lifted verbatim out
 *    of `SystemDialog` (its doctrine comment stays at the call site there).
 *  - `useNonModalDialogKeys({ active, getFrame, onCancel })` — a NON-MODAL
 *    stack entry whose Escape is a CANCEL (escape-means-cancel law). Non-modal
 *    because a tool window is scrimless: with Preferences beside it, the window
 *    holding focus answers Escape, and mount order is only the fallback.
 *
 * Enter is deliberately absent: a tool window that commits live has no cued
 * default to press, and a plain Enter inside one belongs to its fields.
 */

import { useEffect, useRef } from "react";
import { isKeyOwner, popDialog, pushDialog } from "./dialog-stack";

/**
 * Give focus back, on close, to whatever held it when the dialog opened.
 *
 * [cost: O(1) per OPEN] — one `document.activeElement` read on the open edge
 * and at most one `focus()` on the close edge.
 */
export function useDialogFocusRestore(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    // Nothing was focused (or only the document itself was) ⇒ nothing to give
    // back; `<body>` is where focus lands anyway once the portal goes.
    if (
      !previous ||
      previous === document.body ||
      previous === document.documentElement
    ) {
      return;
    }
    return () => {
      // STAND DOWN when something else has already claimed focus during the
      // close. By the time a passive cleanup runs the portal is already
      // detached, so a dialog that held focus leaves `activeElement` on
      // `<body>` — anything ELSE there is a deliberate claim someone made
      // (a handler that focused a fresh card, an outside mousedown that landed
      // on a real control, a dialog that opened another dialog) and stealing it
      // back would be the reposition-policy defect one axis over.
      const now = document.activeElement;
      if (now && now !== document.body && now !== document.documentElement) {
        return;
      }
      // FAIL SAFE. An element that has since unmounted — the trash button of
      // the card the confirm just deleted, the grab handle of the block it
      // removed — restores NOTHING, rather than guessing a substitute target.
      if (!previous.isConnected) return;
      const el = previous as HTMLElement;
      if (typeof el.focus !== "function") return;
      try {
        // `preventScroll` because a restore is a FOCUS, not a NAVIGATION: the
        // caret was already where the user left it, and yanking the viewport to
        // it is the "Refocus is not navigation" class (task 486) arriving
        // through the shell.
        el.focus({ preventScroll: true });
      } catch {
        /* a detached or hostile target — nothing to do */
      }
    };
  }, [open]);
}

/**
 * Put a non-modal window on the dialog stack while `active`, and CANCEL it on
 * Escape when — and only when — it is the stack's key owner.
 *
 * `getFrame` and `onCancel` are read through refs at key time, so a caller may
 * pass fresh closures each render without re-pushing the entry (which would
 * reorder the stack and hand the key to the wrong window).
 *
 * [cost: O(1) per OPEN] — one stack push/pop and one `window` keydown listener
 * for the window's lifetime; per key, a stack walk over the open dialogs.
 */
export function useNonModalDialogKeys({
  active,
  getFrame,
  onCancel,
}: {
  active: boolean;
  getFrame: () => HTMLElement | null;
  onCancel: () => void;
}): void {
  const getFrameRef = useRef(getFrame);
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    getFrameRef.current = getFrame;
    onCancelRef.current = onCancel;
  });
  useEffect(() => {
    if (!active) return;
    const token = pushDialog(false, () => getFrameRef.current());
    // BUBBLE phase on `window`, same seat as SystemDialog's Escape: the open-menu
    // controller (window capture) still wins while a picker's menu is up, so
    // the first Escape closes the menu and only the next one the window.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!isKeyOwner(token)) return;
      e.preventDefault();
      onCancelRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      popDialog(token);
    };
  }, [active]);
}
