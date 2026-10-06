"use client";

/**
 * `<MenuItemsFromRegistry rows={cardActionRows(...)}>` — the registry-driven
 * declaration source (design §2.2(b)). Emits one registered `<MenuItem>` per
 * `cardActionRows(...)` row, carrying `row.run` / `row.letter` / the resolved
 * `applies(ctx) === "disabled"` flag. So `DragHandleMenu` (grab) and the
 * lightning list (B2) share ONE renderer; both populate the same registry
 * snapshot the nav controller drives.
 *
 * This component is presentation-light: it renders the same DOM the bespoke
 * `DragHandleMenu` did (icon + label + right-aligned single-letter hint, an
 * optional `<MenuSeparator>` above) but via `useMenuItem` getters, so the item GAINS
 * arrow nav + the data-active highlight without a markup rewrite.
 */

import type { CSSProperties, ReactNode } from "react";
import { MenuSeparator } from "./MenuChrome";
import { menuRowRovingStyle, menuRowToneClass } from "./row-tone";
import { useMenuItem } from "./useMenuItem";

/** A row decorated with its per-open disabled state — what a caller passes
 *  after resolving the registry `applies()` for this menu's kind/context. */
export interface DecoratedMenuRow {
  id: string;
  label: string;
  letter?: string;
  letterAliases?: string[];
  icon?: ReactNode;
  separator?: boolean;
  destructive?: boolean;
  disabled: boolean;
  run: () => void;
}

const ITEM_H = 30;

interface RegistryItemProps {
  row: DecoratedMenuRow;
}

/** One registry-driven list item. Internal — emitted per row by the mapper. */
function RegistryItem({ row }: RegistryItemProps) {
  const { active, getItemProps } = useMenuItem({
    id: row.id,
    region: "list",
    disabled: row.disabled,
    letter: row.letter,
    letterAliases: row.letterAliases,
    run: row.run,
  });
  const itemProps = getItemProps();

  // State tones (disabled grey, destructive red + its danger hover, body ink)
  // are the menu's ONE vocabulary (`row-tone.ts`, task 967). This row used to
  // spell its own: `--ink-subtle` at `opacity: 0.45` (greyed twice), and a
  // destructive row that hovered with the NEUTRAL fill. Only the METRICS below
  // are this icon list's own.
  const style: CSSProperties = {
    height: ITEM_H,
    ...menuRowRovingStyle(active, row.disabled),
  };

  return (
    <div>
      {row.separator && <MenuSeparator />}
      <button
        {...itemProps}
        type="button"
        disabled={row.disabled}
        className={`w-full flex items-center gap-2.5 px-3 text-sm text-left ${menuRowToneClass(
          row.destructive ? "danger" : "default",
          row.disabled,
        )}`}
        style={style}
      >
        <span
          className="shrink-0 flex items-center justify-center"
          style={{ width: 16, height: 16 }}
        >
          {row.icon}
        </span>
        <span className="flex-1">{row.label}</span>
        <span
          className="tabular-nums"
          style={{ fontSize: 11, color: "var(--ink-subtle)" }}
        >
          {row.letter}
        </span>
      </button>
    </div>
  );
}

export interface MenuItemsFromRegistryProps {
  rows: readonly DecoratedMenuRow[];
}

export function MenuItemsFromRegistry({ rows }: MenuItemsFromRegistryProps): ReactNode {
  return (
    <>
      {rows.map((row) => (
        <RegistryItem key={row.id} row={row} />
      ))}
    </>
  );
}
