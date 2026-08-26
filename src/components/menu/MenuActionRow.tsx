"use client";

/**
 * `<MenuActionRow>` — the one plain COMMAND row of the `<Menu>` primitive, the
 * sibling of `<MenuToggleRow>` (checkbox) and `<MenuItemsFromRegistry>` (the
 * registry-driven icon + letter-hint list).
 *
 * Registers via `useMenuItem`, so it carries `role="menuitem"` and joins the
 * roving arrow-nav controller. A `disabled` row renders as a real disabled
 * `<button>` (inert to click, greyed) rather than a div that merely looks
 * inert — the Bibliography add-menu's "Search library…" depends on that when no
 * library is mounted.
 *
 * The label is the button's DIRECT text content, not a wrapped span: callers
 * (and tests) address these rows by their text, and a wrapper would hand them
 * the span instead of the control.
 */

import type { ReactNode } from "react";
import { useMenuItem } from "./useMenuItem";

/**
 * A command row's ink. `default` is body text; `danger` is the destructive
 * tone the retired hand-rolled `MenuDelete` carried (task 477). A TONE rather
 * than a caller-supplied className, for the reason `.menu-surface` exists: the
 * moment a row's look is a caller's string, the second delete row in the app
 * spells a different red.
 */
export type MenuActionRowTone = "default" | "danger";

export interface MenuActionRowProps {
  /** Unique within the menu. */
  id: string;
  label: string;
  disabled?: boolean;
  /** Ink + hover tint. Default `"default"`. */
  tone?: MenuActionRowTone;
  /**
   * Decorative element rendered before the label (Bibliography's export glyph).
   * Purely visual — the accessible name is the label, so a caller marks it
   * `aria-hidden`. Same contract as `MenuToggleRow`'s `leading`.
   */
  leading?: ReactNode;
  onSelect: () => void;
}

export function MenuActionRow({
  id,
  label,
  disabled = false,
  tone = "default",
  leading,
  onSelect,
}: MenuActionRowProps) {
  const { active, getItemProps } = useMenuItem({
    id,
    region: "list",
    disabled,
    run: onSelect,
  });
  const itemProps = getItemProps();
  const toneClass = disabled
    ? "text-ink-faint cursor-not-allowed"
    : tone === "danger"
      ? "text-danger hover:bg-danger-soft transition-colors"
      : "text-ink-body hover-on-light";
  return (
    <button
      {...itemProps}
      type="button"
      disabled={disabled}
      // ROW METRICS, shared with `MenuToggleRow` (task 477). This row shipped
      // `text-sm px-3 py-1` while every other row in the app — the toggle row,
      // and the four hand-rolled families this task retired — was
      // `text-xs px-3 py-1.5`, so it was the outlier rather than the standard.
      // It matters beyond tidiness now that one menu can hold both kinds:
      // Bibliography's kebab stacks two filter TOGGLES above an *Export
      // cited.bib* ACTION, and a 14px row under two 12px ones reads as a
      // different control.
      className={`w-full text-left px-3 py-1.5 text-xs ${toneClass}${leading ? " flex items-center gap-2" : ""}`}
      style={{ background: active && !disabled ? "var(--menu-roving-bg)" : undefined }}
    >
      {/* Markup stays byte-identical without a `leading` node — the flex
          wrapper only appears when there is something to sit beside the label,
          the same rule `MenuToggleRow` follows. */}
      {leading}
      {label}
    </button>
  );
}
