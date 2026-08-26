"use client";

/**
 * React context plumbing for the `<Menu>` primitive. `<MenuProvider>` creates
 * one `MenuRegistry` and shares it (plus the role + a `registerExclude` hook
 * for nested-popover click-outside exemptions) through `MenuContext`.
 * `useMenuItem` / `<MenuItemsFromRegistry>` consume it.
 *
 * `MenuStackContext` carries the provider-nesting depth so a nested
 * `<MenuProvider>` can (a) early-out its keyboard controller when it is NOT the
 * topmost open menu (R6 — only the top of the stack captures window keydown),
 * and (b) auto-register its container into the parent's click-outside exclude
 * set (R8). B1 wires the context shape; the nested-menu cases land in Phase C,
 * but the contract is here so they require no refactor.
 */

import { createContext, useContext, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { MenuRegistry } from "./registry";
import type { MenuRole } from "./types";

type AnyKeyboardEvent = ReactKeyboardEvent | KeyboardEvent;

export interface MenuContextValue {
  registry: MenuRegistry;
  role: MenuRole;
  /** Register an element the click-outside dismissal must treat as "inside"
   *  (a spawned color popover, a combobox's external input). Returns an
   *  unregister fn. A nested `<MenuProvider>` calls this with its container. */
  registerExclude: (el: HTMLElement | null) => () => void;
  /** The combobox seam (§3.5). For an input-bearing `role="listbox"` menu, the
   *  owned `<input>` is the keyboard SOURCE — the provider mounts its keyboard
   *  controller in `source: "input"` mode and exposes the controller's
   *  `handleKeyDown` here so a child input (via `useMenuCombobox`) can wire it
   *  onto its own `onKeyDown` without the provider rendering the input itself.
   *  Undefined for the window-source command menus. */
  handleKeyDown?: (e: AnyKeyboardEvent) => void;
  /** Stable id of the provider's listbox container (the input's `aria-controls`
   *  target). `${menuId}-listbox`. Present only when `role === "listbox"`. */
  listboxId?: string;
  /**
   * Called by `useMenuItem` after a registered row's `run()` — from EITHER
   * activation path (the DOM click and the keyboard controller's
   * `registry.activate()`), and only for a row that did not opt out with
   * `keepMenuOpen` (task 477).
   *
   * This is the MENU-layer statement of the policy `AnchoredMenu`'s
   * `closeOnInsideClick` states at the DOM layer, and the two are not
   * interchangeable: `closeOnInsideClick` is an `onClick` handler on a wrapper
   * div, and the keyboard controller activates a row by calling its `run()`
   * DIRECTLY — no DOM event, nothing to bubble. So a registered row activated
   * with Enter ran its action and left the menu open, which `AnchoredMenu`'s
   * own docstring recorded as a known limit while `ItemMenu`'s rows were
   * unregistered and could not reach that path at all. Registering them is
   * exactly what makes the limit reachable, so the policy moves to the layer
   * both paths share.
   *
   * Undefined on a provider that does not close on activation (MenuBar's
   * ViewMenu, whose rows close from inside their own `onToggle`).
   */
  onItemActivated?: (id: string) => void;
}

export const MenuContext = createContext<MenuContextValue | null>(null);

export function useMenuContext(): MenuContextValue {
  const ctx = useContext(MenuContext);
  if (!ctx) {
    throw new Error(
      "useMenuItem / MenuItemsFromRegistry must be used inside a <MenuProvider>",
    );
  }
  return ctx;
}

/** Non-throwing variant — for a child popover that may or may not be nested
 *  inside a parent menu (it auto-registers into the parent's exclude set when
 *  one exists). */
export function useOptionalMenuContext(): MenuContextValue | null {
  return useContext(MenuContext);
}

// ── Provider stack (R6) ──────────────────────────────────────────────────────

/**
 * The shared open-menu stack controller (R6). One instance is created by the
 * OUTERMOST `<MenuProvider>` (the first whose parent depth is the -1 root
 * sentinel) and handed down unchanged through every nested provider via
 * `MenuStackContext`, so all providers in one React subtree share ONE source of
 * truth for "who is the deepest currently-open menu".
 *
 * Each WINDOW-source provider registers its own depth here while it is open and
 * unregisters on close/unmount; `topDepth()` returns the greatest open depth, so
 * a provider is the TOP iff its depth equals `topDepth()` — i.e. no descendant
 * window-source provider is open below it. Only the top provider's keyboard
 * controller installs its window-capture keydown and only the top provider owns
 * Escape, so keys are scoped to the innermost open menu (no double-move).
 *
 * Input-source providers (combobox / native-input menus) do NOT register here —
 * they install no window listener, so they're inherently scoped to their own
 * input and never contend for the window keydown. Registering them would wrongly
 * make a parent window-source menu non-top while a child combobox is open.
 *
 * Everything here is O(1) per open/close: a `Set<number>` add/delete + a cached
 * max, and one notify to the subscribed providers. It runs on mount/unmount and
 * a `setActive`-style open flip — NEVER on the keystroke path.
 */
export interface MenuStackController {
  /** Mark a window-source provider at `depth` as open. Returns an unregister
   *  fn (call on close/unmount). Idempotent per depth via a refcount so two
   *  providers can never collide (depths are unique per subtree anyway). */
  registerOpen: (depth: number) => () => void;
  /** The greatest currently-open window-source depth, or -1 if none. */
  topDepth: () => number;
  /** Subscribe to open-set changes (a provider re-evaluates its `isTop`). */
  subscribe: (fn: () => void) => () => void;
}

export function createMenuStackController(): MenuStackController {
  // Refcount per depth so a transient double-register (StrictMode double-invoke,
  // a remount race) can't leave a phantom open depth pinned.
  const counts = new Map<number, number>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const fn of listeners) fn();
  };
  return {
    registerOpen(depth) {
      counts.set(depth, (counts.get(depth) ?? 0) + 1);
      notify();
      return () => {
        const n = (counts.get(depth) ?? 0) - 1;
        if (n <= 0) counts.delete(depth);
        else counts.set(depth, n);
        notify();
      };
    },
    topDepth() {
      let max = -1;
      for (const d of counts.keys()) if (d > max) max = d;
      return max;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

export interface MenuStackValue {
  /** Depth of THIS provider in the open-menu stack (0 = root). */
  depth: number;
  /** The shared open-stack controller (R6). Null only at the -1 root sentinel
   *  (no `<MenuProvider>` above) — the outermost provider creates one. */
  controller: MenuStackController | null;
}

export const MenuStackContext = createContext<MenuStackValue>({
  depth: -1,
  controller: null,
});

export function useMenuStack(): MenuStackValue {
  return useContext(MenuStackContext);
}
