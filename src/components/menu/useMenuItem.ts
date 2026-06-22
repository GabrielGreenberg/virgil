"use client";

/**
 * `useMenuItem(...)` — registers a node into the provider's registry AND
 * returns prop-getters to spread onto existing JSX, so a menu migrates without
 * a markup rewrite (design §2.2, graft B). Both declaration sources (bespoke
 * JSX cells and the `<MenuItemsFromRegistry>` mapper) funnel through this hook,
 * so they populate the SAME snapshot and the nav controller is source-agnostic.
 *
 * `getItemProps()` returns `{ role, id, aria-disabled, tabIndex: -1,
 * data-active, onClick, onMouseEnter, ref }`. Items NEVER receive `.focus()`
 * (roving aria-activedescendant only) so the editor caret never moves.
 *
 * Keystroke sanctity: the registration write only bumps the registry's version
 * when a nav-relevant field changes; the `active` flag is read via a
 * subscription that fires only on an active-id change, not per keystroke.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { useMenuContext } from "./context";
import type { MenuItemProps, MenuRegion, MenuCoords, UseMenuItemResult } from "./types";

export interface UseMenuItemOptions {
  /** Unique within the menu. */
  id: string;
  /** Region this node lives in. Defaults to `"list"`. */
  region?: MenuRegion;
  /** Grid coordinates (grid region only). */
  coords?: MenuCoords;
  /** Stays visible when true, skipped by nav, inert on activate. */
  disabled?: boolean;
  /** Bare-key fast-path letter. */
  letter?: string;
  /** Extra bare-key aliases that also activate (e.g. Backspace/Delete). */
  letterAliases?: string[];
  /** Activation handler. */
  run: () => void;
  /** ARIA role override for checkbox/option rows (defaults from the menu role). */
  role?: MenuItemProps["role"];
  /**
   * Live VISUAL index (the row's position in the rendered list). Pass this from
   * a list whose rows REORDER without remounting — a fuzzy-ranked combobox whose
   * React `key` survives a re-rank — so nav follows what the user sees. The
   * registry's default insertion `order` is correct only while DOM order ==
   * registration order; this republishes the live index via `registry.setOrder`
   * whenever it changes, so arrow-nav steps strictly through visual order. Omit
   * for static menus (their DOM order already equals registration order).
   */
  order?: number;
}

export function useMenuItem(opts: UseMenuItemOptions): UseMenuItemResult {
  const {
    id,
    region = "list",
    coords,
    disabled = false,
    letter,
    letterAliases,
    run,
    role: roleOverride,
    order,
  } = opts;
  const { registry, role: menuRole } = useMenuContext();

  // Keep the latest `run` in a ref so re-registering on every render isn't
  // needed just because the closure identity changed; the registry calls the
  // live handler.
  const runRef = useRef(run);
  runRef.current = run;
  const stableRun = useCallback(() => runRef.current(), []);

  // Register / update on the nav-relevant fields. The registry de-dupes
  // no-op updates (only bumps its version when something nav-structural
  // changed), so this effect is cheap on re-render.
  const coordsRow = coords?.row;
  const coordsCol = coords?.col;
  const aliasesKey = (letterAliases ?? []).join(",");
  useEffect(() => {
    registry.register({
      id,
      region,
      coords:
        coordsRow != null && coordsCol != null
          ? { row: coordsRow, col: coordsCol }
          : undefined,
      disabled,
      letter,
      letterAliases,
      run: stableRun,
    });
    return () => registry.unregister(id);
    // aliasesKey stands in for the array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry, id, region, coordsRow, coordsCol, disabled, letter, aliasesKey, stableRun]);

  // Republish the live visual index (reorderable lists only). Kept SEPARATE
  // from the register effect on purpose: a re-rank changes only `order`, so this
  // updates the sort key WITHOUT the register effect's unregister/re-register
  // churn (which would transiently clear `active` and drop the highlight). The
  // registry no-ops when the order is unchanged, so this is inert for the
  // common (index-stable) re-render and entirely absent for menus that omit it.
  useEffect(() => {
    if (order == null) return;
    registry.setOrder(id, order);
  }, [registry, id, order]);

  // Subscribe to the active id; re-render only when THIS node's active flag
  // flips (not on every active change — the selector narrows it).
  const active = useSyncExternalStore(
    (cb) => registry.subscribe(cb),
    () => registry.activeId() === id,
    () => false,
  );

  const setRef = useCallback(
    (el: HTMLElement | null) => registry.setRef(id, el),
    [registry, id],
  );

  const getItemProps = useCallback((): MenuItemProps => {
    const resolvedRole: MenuItemProps["role"] =
      roleOverride ?? (menuRole === "listbox" ? "option" : "menuitem");
    return {
      role: resolvedRole,
      id: registry.domIdFor(id),
      "aria-disabled": disabled ? true : undefined,
      tabIndex: -1,
      "data-active": active ? "" : undefined,
      onClick: (e) => {
        if (disabled) {
          e.preventDefault?.();
          return;
        }
        runRef.current();
      },
      onMouseEnter: () => {
        if (!disabled) registry.setActive(id);
      },
      ref: setRef,
    };
  }, [roleOverride, menuRole, registry, id, disabled, active, setRef]);

  return { active, disabled, getItemProps };
}
