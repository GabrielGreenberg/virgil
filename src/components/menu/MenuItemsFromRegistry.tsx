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
import { menuRowReasonProps, menuRowRovingStyle, menuRowToneClass } from "./row-tone";
import { useMenuItem } from "./useMenuItem";
import type { ActionSpec, ActionVerdict } from "@/lib/actions/action-registry";

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
  /** WHY the row is greyed — `verdictOf(row, ctx).reason` (task 968). Shown as
   *  the row's hint and announced as its description; ignored when enabled. */
  disabledReason?: string | null;
  run: () => void;
}

/**
 * The ONE registry-row → menu-row decorator (task 1538). Both card-action
 * surfaces (grab `DragHandleMenu`, ⚡ `ActionsMenuPanel`) build their rows here,
 * so every presentation facet the registry states — label, letter AND its key
 * aliases, icon, separator, destructive — reaches both surfaces identically.
 * A view supplies only what is genuinely its own: the verdict for its context
 * and the `run` that dispatches with its ref. Before this, each view hand-copied
 * the mapping, and the copies drifted (the grab menu bound Backspace/Delete to
 * Delete by an `id === "delete"` one-off; the ⚡ panel painted "⌫" over a key
 * that did nothing).
 */
export function decorateCardRow(
  row: Pick<
    ActionSpec,
    "id" | "label" | "letter" | "keyAliases" | "icon" | "separator" | "destructive"
  >,
  verdict: ActionVerdict,
  run: () => void,
): DecoratedMenuRow {
  return {
    id: row.id,
    label: row.label,
    letter: row.letter,
    letterAliases: row.keyAliases ? [...row.keyAliases] : undefined,
    icon: row.icon,
    separator: row.separator,
    destructive: row.destructive,
    disabled: verdict.state === "disabled",
    disabledReason: verdict.reason,
    run,
  };
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

  // Task 968: a greyed row SAYS why (STYLE_GUIDE "A command surface RENDERS its
  // verdict") — through the row-tone door every row shares (task 998).

  return (
    <div>
      {row.separator && <MenuSeparator />}
      <button
        {...itemProps}
        type="button"
        disabled={row.disabled}
        {...menuRowReasonProps(!!row.disabled, row.disabledReason)}
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
        {/* The visible hint is for sighted users; AT hears the same verb from
            the row's derived `aria-keyshortcuts` (task 1362), so the letter
            stays out of the accessible name ("Archive", not "Archive A"). */}
        <span
          aria-hidden="true"
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
