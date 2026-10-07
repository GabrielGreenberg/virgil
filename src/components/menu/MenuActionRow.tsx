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
import { Kbd } from "../Kbd";
import { useMenuItem } from "./useMenuItem";
import {
  menuRowReasonProps,
  menuRowRovingStyle,
  menuRowToneClass,
  type MenuRowTone,
} from "./row-tone";

/**
 * A command row's ink. `default` is body text; `danger` is the destructive
 * tone the retired hand-rolled `MenuDelete` carried (task 477). A TONE rather
 * than a caller-supplied className, for the reason `.menu-surface` exists: the
 * moment a row's look is a caller's string, the second delete row in the app
 * spells a different red.
 */
export type MenuActionRowTone = MenuRowTone;

export interface MenuActionRowProps {
  /** Unique within the menu. */
  id: string;
  label: string;
  /**
   * Greyed. Omitted, it is DERIVED from `disabledReason` — a row that knows
   * why it is greyed is greyed by saying so, so the reason cannot be dropped
   * where it is known (task 998). Pass it alone only where there is no
   * sentence to give.
   */
  disabled?: boolean;
  /**
   * WHY the row is greyed (task 968's "a greyed command says why", extended to
   * this row by task 998). Rendered exactly as the registry rows render their
   * verdict's reason: the row's hint and its accessible description. Ignored
   * on an enabled row.
   */
  disabledReason?: string;
  /**
   * A portable chord (`"Mod+Shift+N"`) rendered as a trailing `<Kbd>`. Pass the
   * SAME constant the binding matches (`matchesPortableChord`, or
   * `keysFromKeybinding(row.keybinding)`), never a hand-spelled copy — the
   * hint and the binding drift silently otherwise (task 985).
   */
  shortcut?: string;
  /**
   * Row metrics. `"compact"` (default) is the 12px command row every panel
   * menu shares (task 477). `"launcher"` is the 14px row of a menu whose other
   * rows are 14px too — the tab strip's "+" menu, where these commands sit
   * under `RecentPaperRow`'s 14px paper names. Metrics only; the state tones
   * are the same either way.
   */
  size?: "compact" | "launcher";
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
  disabled: disabledProp,
  disabledReason,
  shortcut,
  size = "compact",
  tone = "default",
  leading,
  onSelect,
}: MenuActionRowProps) {
  const disabled = disabledProp ?? !!disabledReason;
  const { active, getItemProps } = useMenuItem({
    id,
    region: "list",
    disabled,
    run: onSelect,
  });
  const itemProps = getItemProps();
  // State tones are the menu's ONE vocabulary (`row-tone.ts`, task 967).
  const toneClass = menuRowToneClass(tone, disabled);
  const metrics = size === "launcher" ? "text-sm" : "text-xs";
  const flex = size === "launcher"
    ? " flex items-center gap-2.5"
    : leading || shortcut
      ? " flex items-center gap-2"
      : "";
  return (
    <button
      {...itemProps}
      type="button"
      disabled={disabled}
      {...menuRowReasonProps(disabled, disabledReason)}
      // ROW METRICS, shared with `MenuToggleRow` (task 477). This row shipped
      // `text-sm px-3 py-1` while every other row in the app — the toggle row,
      // and the four hand-rolled families this task retired — was
      // `text-xs px-3 py-1.5`, so it was the outlier rather than the standard.
      // It matters beyond tidiness now that one menu can hold both kinds:
      // Bibliography's kebab stacks two filter TOGGLES above an *Export
      // cited.bib* ACTION, and a 14px row under two 12px ones reads as a
      // different control.
      className={`w-full text-left px-3 py-1.5 ${metrics} ${toneClass}${flex}`}
      style={menuRowRovingStyle(active, disabled)}
    >
      {/* Markup stays byte-identical without a `leading` node — the flex
          wrapper only appears when there is something to sit beside the label,
          the same rule `MenuToggleRow` follows. A trailing shortcut needs the
          label to take the slack, so only then is it wrapped. */}
      {leading}
      {shortcut ? <span className="flex-1">{label}</span> : label}
      {shortcut && <Kbd keys={shortcut} />}
    </button>
  );
}
