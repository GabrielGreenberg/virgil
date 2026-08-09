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

import { useMenuItem } from "./useMenuItem";

export interface MenuActionRowProps {
  /** Unique within the menu. */
  id: string;
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}

export function MenuActionRow({
  id,
  label,
  disabled = false,
  onSelect,
}: MenuActionRowProps) {
  const { active, getItemProps } = useMenuItem({
    id,
    region: "list",
    disabled,
    run: onSelect,
  });
  const itemProps = getItemProps();
  return (
    <button
      {...itemProps}
      type="button"
      disabled={disabled}
      className={
        disabled
          ? "w-full text-left px-3 py-1 text-sm text-ink-faint cursor-not-allowed"
          : "w-full text-left px-3 py-1 text-sm text-[var(--foreground)] hover-on-light"
      }
      style={{ background: active && !disabled ? "var(--menu-roving-bg)" : undefined }}
    >
      {label}
    </button>
  );
}
