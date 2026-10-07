/**
 * The ONE row-state vocabulary of the `<Menu>` primitive (task 967).
 *
 * Three interactive rows — `MenuActionRow`, `MenuToggleRow` and the
 * registry-driven `MenuItemsFromRegistry` list (grab + lightning) — each used
 * to spell their own disabled grey, destructive tone and body ink: one greyed
 * with `text-ink-faint`, one with `text-ink-subtle opacity-55`, and one with
 * `--ink-subtle` at `opacity: 0.45` (dimmed twice). A greyed Delete in the grab
 * menu, a greyed "Search library…" in the Bibliography kebab and a greyed
 * toggle in the View menu were three different greys. Task 477 unified the
 * row METRICS between two of them and stopped there.
 *
 * So the STATE TONES live here, and every row reads them; a fourth row cannot
 * invent a fourth grey (`menu-row-tone-census.test.tsx` forbids a disabled
 * ink/opacity, a danger tint or the roving background spelled in any other
 * file under `src/components/menu/`). Row METRICS stay per row: the registry
 * list is a distinct icon row (30px, text-sm, 16px icon + letter hint) and
 * changing it would move every grab/lightning menu's height.
 *
 * Disabled = `text-ink-faint`, no extra opacity — the look STYLE_GUIDE's
 * "A command surface RENDERS its verdict" names. (STYLE_GUIDE's generic
 * "Buttons → Disabled. `opacity-40`" is scoped to standalone buttons.)
 */

import type { CSSProperties } from "react";

/** A row's ink. `danger` is the destructive tone (delete rows). */
export type MenuRowTone = "default" | "danger";

/**
 * Ink + hover classes for a menu row in the given state. Disabled wins over
 * tone: a greyed Delete is grey, not a faint red — a disabled row's colour
 * says only "not now".
 */
export function menuRowToneClass(tone: MenuRowTone, disabled: boolean): string {
  if (disabled) return "text-ink-faint cursor-not-allowed";
  return tone === "danger"
    ? "text-danger hover:bg-danger-soft transition-colors"
    : "text-ink-body hover-on-light";
}

/**
 * The roving-active row's background — the blue-tinted selection highlight,
 * so the active item is unambiguous while arrowing (focus does not move). A
 * disabled row is arrow-skipped, so it never paints it.
 */
export function menuRowRovingStyle(active: boolean, disabled: boolean): CSSProperties {
  return { background: active && !disabled ? "var(--menu-roving-bg)" : undefined };
}

/** A grid cell's state (the lightning menu's formatting grid). */
export interface MenuCellState {
  /** The roving (keyboard-cursor) cell. */
  roving: boolean;
  disabled?: boolean;
  /** The cell's format is applied to the selection (bold-is-on). */
  applied?: boolean;
  /** The cell's resting ink when neither applied nor disabled. */
  ink?: string;
}

/**
 * The grid-cell variant of the row tones (task 986). An icon cell in the
 * lightning grid and a card row in the list under it are ONE menu, so a greyed
 * cell is the same grey as a greyed row — `--ink-faint` + `not-allowed`, no
 * dimming opacity (which used to make the cell `0.4` over `--ink-muted`, a
 * second grey beside the row's `text-ink-faint`). The cell's third state,
 * "format applied", is a muted surface that LOSES to the roving fill by rule,
 * so the arrow cursor stays unambiguous even on an applied format; disabled
 * wins over both for the ink.
 */
export function menuCellToneStyle({
  roving,
  disabled = false,
  applied = false,
  ink = "var(--ink-muted)",
}: MenuCellState): CSSProperties {
  return {
    background: roving && !disabled
      ? "var(--menu-roving-bg)"
      : applied
        ? "var(--surface-muted-strong, rgba(0,0,0,0.08))"
        : "transparent",
    color: disabled ? "var(--ink-faint)" : applied ? "var(--ink-strong)" : ink,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}
