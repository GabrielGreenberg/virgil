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

import { createContext, useContext } from "react";
import type { MenuRegistry } from "./registry";
import type { MenuRole } from "./types";

export interface MenuContextValue {
  registry: MenuRegistry;
  role: MenuRole;
  /** Register an element the click-outside dismissal must treat as "inside"
   *  (a spawned color popover, a combobox's external input). Returns an
   *  unregister fn. A nested `<MenuProvider>` calls this with its container. */
  registerExclude: (el: HTMLElement | null) => () => void;
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

export interface MenuStackValue {
  /** Depth of THIS provider in the open-menu stack (0 = root). */
  depth: number;
}

export const MenuStackContext = createContext<MenuStackValue>({ depth: -1 });

export function useMenuStack(): MenuStackValue {
  return useContext(MenuStackContext);
}
