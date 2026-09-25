"use client";

/**
 * `<MenuRadioGroup>` — the ONE door for a pick-one row set in a `<Menu>`
 * (task 770).
 *
 * `<MenuToggleRow>` carried a `role` prop, and a mutually-exclusive set took
 * `role="menuitemradio"` only when its author REMEMBERED to spell it. Two
 * MenuBar sets did not (the ¶ block-type rows, hand-built as
 * `menuitemcheckbox`; the divider-width rows, left on the checkbox default), so
 * a screen reader announced Body / Chapter / Section as independent checkboxes
 * — as if a block could be several at once.
 *
 * Here the role is DERIVED from the shape of the input: the caller hands ONE
 * `value` and the option list, and every row this renders is `menuitemradio`,
 * checked iff its option equals `value`. There is no role to forget. The rows
 * sit in a `role="group"` so each set is its own radio group even where one
 * menu hosts two (Citations' Package + Style) — ARIA scopes a radio set by
 * its group, not by the separators between them.
 *
 * `menu-radio-census.test.ts` holds the rule: a `<MenuToggleRow>` whose
 * `checked` is an equality against one value, or which spells `role=`, is a
 * pick-one row authored outside this door.
 */

import { MenuToggleRow } from "./MenuToggleRow";

export interface MenuRadioOption<V extends string | number> {
  value: V;
  label: string;
  /** Visible but inert and arrow-skipped (e.g. a heading level the document
   *  class does not define). */
  disabled?: boolean;
  /** Tooltip + `aria-description` (why a row is disabled). */
  hint?: string;
}

export interface MenuRadioGroupProps<V extends string | number> {
  /** Row ids are `${idPrefix}${value}` — unique within the menu. */
  idPrefix: string;
  /** Names the group for assistive tech (a visible section label's text). */
  ariaLabel?: string;
  options: readonly MenuRadioOption<V>[];
  /** The current pick; no row is checked when it matches none. */
  value: V | null | undefined;
  onPick: (value: V) => void;
  indent?: 0 | 1 | 2;
  keepMenuOpen?: boolean;
}

export function MenuRadioGroup<V extends string | number>({
  idPrefix,
  ariaLabel,
  options,
  value,
  onPick,
  indent,
  keepMenuOpen,
}: MenuRadioGroupProps<V>) {
  return (
    <div role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <MenuToggleRow
          key={String(o.value)}
          id={`${idPrefix}${o.value}`}
          role="menuitemradio"
          label={o.label}
          checked={o.value === value}
          disabled={o.disabled}
          hint={o.hint}
          indent={indent}
          keepMenuOpen={keepMenuOpen}
          onToggle={() => onPick(o.value)}
        />
      ))}
    </div>
  );
}
