/**
 * A CONTROL IS A `<button type="button">`. `role="button"` is spelled here,
 * ONCE, and only for a container that cannot be a real button.
 *
 * `role="button"` on a `<span>`/`<div>` is a three-part promise — the element
 * announces itself to a screen reader as operable, so it must be FOCUSABLE
 * (`tabIndex={0}`) and must ACTIVATE on Enter AND Space, the platform
 * contract for the role. Spelled by hand it is three chances to keep two of
 * the parts (task 536: the figure lozenge's `#` and `×` announced `role=
 * "button"` — the `#` with an `aria-pressed` state a keyboard user could not
 * flip — and were neither focusable nor key-bound; the heading strip's twin
 * spans carried the same false promise through `setAttribute`).
 *
 * Where a `<button>` genuinely cannot be used is ONE shape: a container that
 * must hold OTHER interactive content (a tab with its own close button, a
 * list row carrying action buttons, a title strip with its own `×`) — the
 * HTML content model forbids interactive content inside `<button>`, so those
 * stay `<div>`s and take this helper instead of re-deriving the contract.
 *
 * The one rule beyond the three parts is the TARGET GUARD: a key pressed on a
 * NESTED control belongs to that control. Without it, Enter on the tab's
 * close button both closes the tab (the button's own native activation) and
 * ACTIVATES it (the container's key handler, reached by bubbling) — the
 * latent shape every hand-rolled copy carried.
 *
 * Import-free leaf (React TYPES only), so the library silo and every chrome
 * component can reach it.
 *
 * Census: `src/components/__tests__/role-button-census.test.ts` — no
 * production file in either silo spells `role="button"` in any medium except
 * this one. Allowlist EMPTY.
 */
import type { KeyboardEvent, MouseEvent } from "react";

/** The two events an activation can arrive on — a click, or Enter/Space. */
export type ActivationEvent = MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>;

export interface ActivatableProps {
  role: "button";
  tabIndex: 0;
  onClick: (e: MouseEvent<HTMLElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}

/** Is `key` one of the two keys the `button` role activates on? */
export function isActivationKey(key: string): boolean {
  return key === "Enter" || key === " ";
}

/**
 * The props that make a non-`<button>` container a keyboard-operable
 * control: the role, a tab stop, click activation, and Enter/Space
 * activation scoped to the container ITSELF (a key on a nested control is
 * that control's).
 */
export function activatableProps(
  activate: (e: ActivationEvent) => void,
): ActivatableProps {
  return {
    role: "button",
    tabIndex: 0,
    onClick: (e) => activate(e),
    onKeyDown: (e) => {
      if (e.target !== e.currentTarget) return;
      if (!isActivationKey(e.key)) return;
      // Enter would otherwise submit an enclosing form; Space would scroll.
      e.preventDefault();
      activate(e);
    },
  };
}
