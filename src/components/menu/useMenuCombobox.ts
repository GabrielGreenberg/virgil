"use client";

/**
 * `useMenuCombobox(...)` — the input-bearing combobox seam of the `<Menu>`
 * primitive (design §3.5). For a `role="listbox"` menu whose keyboard SOURCE is
 * an owned `<input>` (label-ref, bib-picker), this hook — used by the input —
 * returns the combobox ARIA prop-getter plus the live active-option accessor so
 * the input drives the roving cursor while real focus STAYS in the input (NO
 * focus theft) and `aria-activedescendant` sits on the input.
 *
 * `getInputProps({ open, onKeyDown })` returns:
 *   - `role: "combobox"`, `aria-autocomplete: "list"`,
 *   - `aria-expanded`: the `open` flag (dropdown visible),
 *   - `aria-controls`: the provider's listbox container id (`${menuId}-listbox`),
 *   - `onKeyDown`: a composed handler that routes ONLY the navigation keys
 *     (Arrow/Home/End) through the menu controller — which `preventDefault`s
 *     them so the single-line caret never moves — and delegates EVERY other key
 *     (Enter / Escape / typing) to the caller's `onKeyDown`. Enter stays the
 *     caller's so it can commit the active option OR fall back to the typed
 *     value; Escape is owned by `useMenuDismiss`'s two-stage `onEscape`.
 *
 * `activeId` is the reactive id of the roving-active option (null = nothing
 * highlighted) so the caller's Enter handler decides commit-active vs.
 * commit-typed. The `aria-activedescendant` attribute itself is written by the
 * controller onto the input via the provider's `getActiveDescendantHost`.
 *
 * Keystroke sanctity: the nav routing is O(1) index math in the controller; the
 * active-id subscription fires only on a cursor change, never per keystroke.
 */

import { useCallback, useSyncExternalStore } from "react";
import { useMenuContext } from "./context";

/** The navigation keys the controller owns for a combobox input — routed to the
 *  menu controller (which `preventDefault`s the single-line caret). Enter,
 *  Escape, and all typing are explicitly NOT here (the caller owns them). */
const NAV_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
]);

export interface ComboboxInputProps {
  role: "combobox";
  "aria-autocomplete": "list";
  "aria-expanded": boolean;
  "aria-controls": string | undefined;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

export interface GetInputPropsOptions {
  /** Whether the dropdown listbox is visible (drives `aria-expanded`). */
  open: boolean;
  /** Caller's own keydown for the keys the controller does NOT own — Enter
   *  (commit active option or typed fallback), typing, etc. */
  onKeyDown?: (e: React.KeyboardEvent) => void;
  /** Fired when a navigation key is routed to the controller (BEFORE the move),
   *  so the caller can reopen a collapsed dropdown on the first arrow — matching
   *  the old `setDropdownOpen(true)` on ArrowUp/Down. */
  onNavigate?: () => void;
}

export interface UseMenuComboboxResult {
  /** The roving-active option id (null = nothing highlighted → Enter falls back
   *  to the typed value). Reactive: re-renders the input on a cursor change. */
  activeId: string | null;
  /** Clear the roving highlight (null) — call on a filter keystroke so a stale
   *  highlight never points past the re-filtered set, matching the old
   *  `setActiveIndex(-1)` on typing. */
  clearActive: () => void;
  /** Spread onto the combobox `<input>` (ARIA + the composed keydown). */
  getInputProps: (opts: GetInputPropsOptions) => ComboboxInputProps;
}

export function useMenuCombobox(): UseMenuComboboxResult {
  const { registry, handleKeyDown, listboxId } = useMenuContext();

  const clearActive = useCallback(() => registry.setActive(null), [registry]);

  // The active option id, narrowed to a primitive so the input re-renders only
  // on a cursor change (not on every registry notify).
  const activeId = useSyncExternalStore(
    (cb) => registry.subscribe(cb),
    () => registry.activeId(),
    () => null,
  );

  const getInputProps = useCallback(
    ({ open, onKeyDown, onNavigate }: GetInputPropsOptions): ComboboxInputProps => ({
      role: "combobox",
      "aria-autocomplete": "list",
      "aria-expanded": open,
      "aria-controls": listboxId,
      onKeyDown: (e) => {
        // The controller owns the navigation keys — it moves the roving cursor
        // and `preventDefault`s the arrow so the single-line caret stays put.
        if (NAV_KEYS.has(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
          onNavigate?.();
          handleKeyDown?.(e);
          return;
        }
        // Everything else (Enter / Escape / typing) is the caller's.
        onKeyDown?.(e);
      },
    }),
    [handleKeyDown, listboxId],
  );

  return { activeId, clearActive, getInputProps };
}
