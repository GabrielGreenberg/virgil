"use client";

/**
 * The `<Menu>` primitive — public surface (design `docs/agents/menu-system-design.md`).
 *
 * Phase B1 builds the core + adopts the grab-bar menu (`DragHandleMenu`) as the
 * clean list reference. The core already supports list / grid / composite
 * layouts so B2 (lightning) can mount a composite menu without refactoring.
 */

export { MenuProvider } from "./MenuProvider";
export type { MenuProviderProps } from "./MenuProvider";
export { MenuItemsFromRegistry } from "./MenuItemsFromRegistry";
export type {
  MenuItemsFromRegistryProps,
  DecoratedMenuRow,
} from "./MenuItemsFromRegistry";
export { MenuToggleRow } from "./MenuToggleRow";
export type { MenuToggleRowProps } from "./MenuToggleRow";
export { MenuGrid, MenuList, useMenuGrid } from "./regions";
export type { MenuGridProps, MenuListProps } from "./regions";
export { useMenuItem } from "./useMenuItem";
export type { UseMenuItemOptions } from "./useMenuItem";
export { useMenuCombobox } from "./useMenuCombobox";
export type {
  UseMenuComboboxResult,
  ComboboxInputProps,
  GetInputPropsOptions,
} from "./useMenuCombobox";
export { useMenuKeyboard } from "./useMenuKeyboard";
export type {
  UseMenuKeyboardOptions,
  UseMenuKeyboardResult,
} from "./useMenuKeyboard";
export { useMenuDismiss } from "./useMenuDismiss";
export type { UseMenuDismissOptions } from "./useMenuDismiss";
export {
  MenuRegistry,
  registryFor,
  publishRegistry,
  unpublishRegistry,
} from "./registry";
export type { MenuItemRegistration } from "./registry";
export {
  computeNextActive,
  buildLetterMap,
  initialActiveId,
  freshNavMemory,
} from "./nav-core";
export type { NavMemory } from "./nav-core";
export type {
  MenuLayout,
  MenuOrientation,
  MenuRole,
  MenuRegion,
  MenuCoords,
  MenuNode,
  NavDir,
  MenuRegistryHandle,
  MenuEscapeConfig,
  MenuDismissConfig,
  UseMenuItemResult,
  MenuItemProps,
} from "./types";
