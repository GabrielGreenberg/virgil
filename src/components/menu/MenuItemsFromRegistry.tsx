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
 * optional separator above) but via `useMenuItem` getters, so the item GAINS
 * arrow nav + the data-active highlight without a markup rewrite.
 */

import type { CSSProperties, ReactNode } from "react";
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

  const baseColor = row.disabled
    ? "var(--ink-subtle)"
    : row.destructive
      ? "var(--danger, #b45757)"
      : "var(--ink-strong)";

  const style: CSSProperties = {
    height: ITEM_H,
    color: baseColor,
    // The roving-active row paints the same highlight :hover uses, so the
    // active item is unambiguous while arrowing (no focus move).
    background: active && !row.disabled ? "var(--surface-muted-strong)" : "transparent",
    opacity: row.disabled ? 0.45 : 1,
    cursor: row.disabled ? "not-allowed" : "pointer",
  };

  return (
    <div>
      {row.separator && (
        <div
          aria-hidden
          style={{
            height: 1,
            margin: "4px 8px",
            background: "var(--edge-hover)",
            opacity: 0.5,
          }}
        />
      )}
      <button
        {...itemProps}
        type="button"
        disabled={row.disabled}
        className={
          row.disabled
            ? "w-full flex items-center gap-2.5 px-3 text-sm text-left"
            : "w-full flex items-center gap-2.5 px-3 text-sm text-left hover-on-light"
        }
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
