"use client";

/**
 * The menu-TRIGGER contract, stated once (task 992).
 *
 * `MenuProvider` owns an OPEN menu; the element that opens it owes two things
 * the provider cannot supply:
 *
 *   1. **It is a real toggle.** The provider's click-outside listens for
 *      `pointerdown` in the window CAPTURE phase, so a trigger that is not in
 *      its `excludeRefs` closes the menu on the press and re-opens it on the
 *      click — a remount (one-frame flash, roving cursor and letter-shortcut
 *      state reset) where the user asked for "close". So the trigger's element
 *      goes into `excludeRefs`, and its activation reads `open ? close : open`.
 *   2. **It announces the popup.** `aria-haspopup` (DERIVED from the
 *      container role — a trigger that opens a `role="dialog"` swatch grid must
 *      not promise a command list) and `aria-expanded` tracking the open state.
 *
 * `AnchoredMenu` renders its own button and consumes `useMenuTrigger` itself.
 * A trigger that CANNOT be an `AnchoredMenu` button — the ⚡ bolt (a
 * `position:fixed` pane-overlay portal), a hand-rolled toolbar trigger, the
 * heading lozenge's type chip (vanilla DOM inside a NodeView) — takes the same
 * pieces from here instead of re-spelling them. `menu-trigger-census.test.ts`
 * pins every `role="menu"` provider to a trigger that does.
 */

import { useState } from "react";
import type { MenuRole } from "./types";

/** The two trigger attributes, as JSX props. `aria-haspopup` names what the
 *  trigger opens, so it follows the container role ("menu" stays "menu"). */
export function menuTriggerAria(
  role: MenuRole,
  open: boolean,
): { "aria-haspopup": MenuRole; "aria-expanded": boolean } {
  return { "aria-haspopup": role, "aria-expanded": open };
}

/** The same contract for a trigger React does not render (a NodeView's vanilla
 *  DOM chip): painted onto the element, re-painted on every open/close edge. */
export function paintMenuTriggerAria(
  el: HTMLElement,
  role: MenuRole,
  open: boolean,
): void {
  const aria = menuTriggerAria(role, open);
  el.setAttribute("aria-haspopup", aria["aria-haspopup"]);
  el.setAttribute("aria-expanded", String(aria["aria-expanded"]));
}

/**
 * The trigger half for a React-rendered trigger. Returns the trigger element in
 * STATE (not a ref): `excludeRefs` is read during render, and a ref read there
 * would exempt a trigger that attached after the last render one commit late.
 *
 * Usage: `ref={triggerRef}` + `{...triggerProps}` on the button, and
 * `excludeRefs={[triggerEl]}` on the provider the trigger opens.
 */
export function useMenuTrigger<T extends HTMLElement = HTMLButtonElement>({
  open,
  role = "menu",
}: {
  open: boolean;
  role?: MenuRole;
}): {
  triggerEl: T | null;
  triggerRef: (el: T | null) => void;
  triggerProps: ReturnType<typeof menuTriggerAria>;
} {
  const [triggerEl, triggerRef] = useState<T | null>(null);
  return { triggerEl, triggerRef, triggerProps: menuTriggerAria(role, open) };
}
