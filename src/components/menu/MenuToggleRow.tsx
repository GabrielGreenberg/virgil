"use client";

/**
 * `<MenuToggleRow>` — the one checkbox/toggle row of the `<Menu>` primitive.
 *
 * Registers into the enclosing provider's registry via `useMenuItem` (region
 * "list", DOM order), so Arrow Up/Down/Home/End + Enter drive it through the
 * shared roving controller, and it carries `role="menuitemcheckbox"` +
 * `aria-checked` for assistive tech. The visual treatment (label left, accent
 * ✓ right, `hover-on-light`, roving tint) is fixed here so every toggle row in
 * the app reads identically.
 *
 * Extracted from MenuBar's local `ViewToggleRow` (task 180) when OutlinePanel's
 * hand-rolled kebab folded onto `ItemMenu`: both wanted byte-identical row
 * markup, and the second copy would have been the point where the two drifted.
 *
 * Closing is the CALLER's business, because the two menus that host these rows
 * dismiss differently:
 *   - MenuBar's ViewMenu rows close (or not) from inside their own `onToggle`
 *     (`… ; setOpen(false)`), which is why this component never closes anything
 *     by itself;
 *   - `ItemMenu` wraps its children in an `onClick` that closes on ANY bubbled
 *     click, so a row that must survive repeated toggling passes `keepMenuOpen`.
 */

import type { ReactNode } from "react";
import { useMenuItem } from "./useMenuItem";

export interface MenuToggleRowProps {
  /** Unique within the menu. */
  id: string;
  label: string;
  checked: boolean;
  /**
   * Decorative element rendered before the label — Search's per-scope colour
   * dot, the one thing its hand-rolled rows had that this row didn't (task
   * 143). Purely visual: state is carried by `aria-checked`, so a `leading`
   * node is `aria-hidden` by the caller and never announced.
   */
  leading?: ReactNode;
  /** Indent depth (0 = top level, 1 = group child, 2 = nested child). */
  indent?: 0 | 1 | 2;
  /**
   * Keep the menu open across this row's activation. Set inside `ItemMenu`,
   * whose children wrapper closes the menu on any bubbled click — without this,
   * a five-toggle menu would close after every single toggle. Inert in menus
   * that don't close on activation (MenuBar's ViewMenu).
   *
   * It covers BOTH activation paths since task 477: the DOM `stopPropagation`
   * below for the mouse, and `useMenuItem`'s own opt-out for the keyboard
   * controller, which runs a row by calling its handler directly and so never
   * produces a click to stop.
   */
  keepMenuOpen?: boolean;
  /**
   * ARIA fork for a MUTUALLY-EXCLUSIVE set (task 477): `menuitemradio` where
   * picking one un-picks the others (a card panel's View Active / Archives /
   * All, Bibliography's Cited-only / Full, Citations' package and style), and
   * the default `menuitemcheckbox` for an independent toggle. Both carry
   * `aria-checked`; only the ROLE tells a screen-reader user whether the row's
   * siblings move with it.
   */
  role?: "menuitemcheckbox" | "menuitemradio";
  onToggle: () => void;
}

export function MenuToggleRow({
  id,
  label,
  checked,
  leading,
  indent = 0,
  keepMenuOpen = false,
  role = "menuitemcheckbox",
  onToggle,
}: MenuToggleRowProps) {
  const { active, getItemProps } = useMenuItem({
    id,
    region: "list",
    role,
    run: onToggle,
    keepMenuOpen,
  });
  const itemProps = getItemProps();
  const pad = indent === 2 ? "pl-9 pr-3" : indent === 1 ? "pl-6 pr-3" : "px-3";
  return (
    <button
      {...itemProps}
      onClick={(e) => {
        if (keepMenuOpen) e.stopPropagation();
        itemProps.onClick(e);
      }}
      type="button"
      aria-checked={checked}
      className={`w-full text-left ${pad} py-1.5 text-xs text-ink-body hover-on-light flex items-center justify-between gap-3`}
      style={{ background: active ? "var(--menu-roving-bg)" : undefined }}
    >
      {/* Markup stays byte-identical without a `leading` node — the wrapper
          only appears when there is something to sit beside the label, since
          the button's `justify-between` would otherwise push two bare siblings
          to opposite ends. */}
      {leading ? (
        <span className="flex items-center gap-2 min-w-0">
          {leading}
          <span className="truncate">{label}</span>
        </span>
      ) : (
        <span>{label}</span>
      )}
      {/* The ✓ column is RESERVED, not conditionally rendered. An empty span is
          zero-width, so in a content-sized menu (ItemMenu is `min-w-[100px]`
          with no width — only MenuBar's ViewMenu pins `w-52`) the whole dropdown
          would shrink by a glyph the moment the widest row is unchecked, and
          jitter under the cursor across a run of toggles. State is carried by
          `aria-checked`; the glyph is decoration. */}
      <span className={`text-[var(--accent)]${checked ? "" : " opacity-0"}`} aria-hidden="true">
        ✓
      </span>
    </button>
  );
}
