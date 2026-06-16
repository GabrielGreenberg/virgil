"use client";

/**
 * The `<Menu>` primitive — shared types (design `docs/agents/menu-system-design.md`).
 *
 * One headless `<MenuProvider>` owns a live item-registry; items self-register
 * via `useMenuItem(...)` (bespoke JSX) or a `<MenuItemsFromRegistry>` mapper
 * (registry-driven grab/lightning lists). A single `useMenuKeyboard` controller
 * runs roving `aria-activedescendant` nav over the registry's ordered,
 * region-tagged snapshot — `list` / `grid` / `composite` — with NO DOM focus
 * move, so the editor caret never shifts.
 *
 * This module is the type SSOT every primitive piece imports. It is
 * React-runtime-free (only `type` imports) so it stays cheap for any consumer.
 */

import type { CSSProperties } from "react";

/** Menu layout — drives which key map `useMenuKeyboard` runs (§3.1/§3.4). */
export type MenuLayout = "list" | "grid" | "composite" | "combobox";

/**
 * List stepping axis (opt-in). A `list` layout steps Up/Down by default
 * ("vertical"); "horizontal" steps Left/Right instead (Up/Down inert), for a
 * horizontal swatch row (the color popover). ONLY consulted for the `list`
 * layout — `grid` / `composite` / `combobox` ignore it (a grid already maps all
 * four arrows; a combobox owns Left/Right via `onArrowHorizontal`). Default
 * "vertical", so every existing vertical menu is unaffected.
 */
export type MenuOrientation = "vertical" | "horizontal";

/** ARIA fork (§3.5). `menu` → role=menu + menuitem; `listbox` → the combobox
 *  pattern (an owned input drives aria-activedescendant over a listbox). */
export type MenuRole = "menu" | "listbox";

/** Where a node lives in the layout. `widget` is a focus-island (a native
 *  `<input type="color">` etc.) — skipped by roving, reachable by Tab. */
export type MenuRegion = "grid" | "list" | "widget";

/** Grid coordinates — present only on `region: "grid"` nodes. */
export interface MenuCoords {
  row: number;
  col: number;
}

/**
 * The registry's internal record for one navigable/activatable item. Populated
 * identically by both declaration sources (bespoke `useMenuItem` JSX and the
 * `<MenuItemsFromRegistry>` mapper) so the nav controller is source-agnostic
 * (design §2.2).
 */
export interface MenuNode {
  /** Unique within the menu. */
  id: string;
  /** Which region this node lives in. */
  region: MenuRegion;
  /** Grid coordinates (grid region only). */
  coords?: MenuCoords;
  /** Stays VISIBLE when true, but is skipped by nav + inert on activate. */
  disabled: boolean;
  /** Bare-key fast-path letter (e.g. "F"). Uppercased at registration. */
  letter?: string;
  /** Extra bare-key aliases that also activate this node (e.g. the grab
   *  menu's Backspace/Delete → delete). Uppercased / normalized at register. */
  letterAliases?: string[];
  /** Activation handler — run on click / Enter / Space / letter. */
  run: () => void;
  /** The activedescendant target: `${menuId}-item-${id}`. */
  domId: string;
  /** Live element ref (set by `getItemProps().ref`). */
  ref: HTMLElement | null;
}

/** The directional step the keyboard controller asks the registry to take. */
export type NavDir = "up" | "down" | "left" | "right" | "home" | "end";

/**
 * The registry contract the slash plugin (Phase C) drives behind the SAME
 * `{ items(), move(), activate() }` seam the React backend satisfies (§2.3).
 * Implemented FULLY by the React backend here; the PM-slash backend will
 * satisfy this type in Phase C (it reads the plugin's live `filtered` +
 * `selectedIndex` as the snapshot+cursor). This is the design's known leaky
 * seam (R2): `move()` is sync setState in React vs. async tx-dispatch in PM —
 * enforced by this shared type + a coverage test, with the React view a
 * one-way subscriber to the cursor.
 */
export interface MenuRegistryHandle {
  /** Ordered, region-tagged snapshot. */
  items(): MenuNode[];
  /** Step the active cursor in a direction. */
  move(dir: NavDir): void;
  /** Set the active node by id (e.g. mouse hover). */
  setActive(id: string): void;
  /** The currently active node id, or null. */
  activeId(): string | null;
  /** Run the active node's handler (no-op if disabled / none). */
  activate(): void;
}

/** Escape-dismissal config (§3.2). */
export interface MenuEscapeConfig {
  /** Call `e.stopPropagation()` on the consumed Escape. Defaults true for
   *  editor-anchored menus — reproduces `ActionsMenuPanel.tsx:338` (keeps
   *  Escape from reaching tab-indent.ts's Escape→blur). */
  stopPropagation?: boolean;
}

/** Per-menu dismissal options (§3.2). */
export interface MenuDismissConfig {
  escape?: MenuEscapeConfig;
}

/** The result of `useMenuItem` — prop-getters + the live active flag (§2.2). */
export interface UseMenuItemResult {
  /** Whether this node is the roving-active one (paint via `data-active`). */
  active: boolean;
  /** Whether this node is currently disabled (mirror of the registered flag). */
  disabled: boolean;
  /** Spread onto the item element. Carries role / id / aria-disabled /
   *  tabIndex:-1 / data-active / onClick / onMouseEnter / ref. */
  getItemProps: () => MenuItemProps;
}

/** The prop bag `getItemProps()` returns (design §2.2). */
export interface MenuItemProps {
  role: "menuitem" | "menuitemcheckbox" | "option";
  id: string;
  "aria-disabled": true | undefined;
  tabIndex: -1;
  "data-active": "" | undefined;
  onClick: (e: { preventDefault?: () => void }) => void;
  onMouseEnter: () => void;
  ref: (el: HTMLElement | null) => void;
  style?: CSSProperties;
}
