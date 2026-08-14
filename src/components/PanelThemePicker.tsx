"use client";

import { useCallback } from "react";
import {
  clearPanelColor,
  DEFAULT_PANEL_COLORS,
  PRESET_COLORS,
  setPanelColor,
  type PanelThemeKey,
} from "@/lib/panel-theme";
import { usePanelColor, useIsPanelColorOverridden } from "@/hooks/usePanelTheme";
import { AnchoredMenu } from "./menu/AnchoredMenu";
import { useMenuItem } from "./menu/useMenuItem";
import { iconHint } from "@/components/Hint";

/**
 * Color-picker swatch for per-panel theming. Renders a small color box that
 * reflects the current theme color; clicking opens a popover with preset
 * swatches + a "reset to default" action.
 *
 * Designed to sit inside a panel's header three-dot menu.
 *
 * ── MENU-PRIMITIVE MIGRATION (task 181) ──
 * This was the last hand-rolled dropdown in the panel silo, and the sharpest of
 * the four task 181 named: an `absolute right-0 top-full` popover at `z-[9999]`
 * — byte-identical to `DROP_INDICATOR_Z`, the precise collision `ItemMenu`'s own
 * migration comment says it was moved OFF of — with a bespoke
 * `document.addEventListener("mousedown")` closer, no Escape, no flip, no clamp,
 * no re-anchor, and no keyboard nav. It rendered INSIDE `ItemMenu`'s children,
 * i.e. a hand-rolled popover nested within a portaled `MenuProvider`, which is
 * structurally the task-151 class: a popover that is not a React descendant of
 * the provider escapes the `MenuStackController`, so Escape is not scoped to the
 * innermost menu. Being a React descendant here, it now inherits BOTH halves for
 * free — the provider's R8 auto-register puts this menu's container into the
 * parent kebab's click-outside exclude set (so picking a color does not dismiss
 * the kebab), and the shared stack scopes Escape to the deepest open menu (so
 * Escape closes the picker, not both).
 *
 * Why it escaped the CI census that was supposed to catch exactly this: the
 * `anchored-menu-guardrail` detector required a rect read (`getBoundingClientRect`
 * / `clientX`), and a popover positioned purely by CSS (`top-full`) reads no
 * rect. That hole is closed in the same task — see the CSS_ANCHORED signal there.
 *
 * The nav model is `composite` (grid above list), and this is its first real
 * consumer: the 7-column swatch grid registers as `region: "grid"` cells with
 * `coords`, so arrows step the grid in two axes; "Reset to default" registers as
 * the `region: "list"` row below it, which Down from the last grid row reaches
 * and Up returns from. Roving `aria-activedescendant` only — no `.focus()`, so
 * the editor caret never moves (the house keyboard model).
 */

/** Swatch columns. The grid `coords` are derived from this, so the nav model and
 *  the rendered layout cannot disagree about what "the row above" means. */
const SWATCH_COLS = 7;

export default function PanelThemePicker({
  panelKey,
  label,
}: {
  panelKey: PanelThemeKey;
  label?: string;
}) {
  const current = usePanelColor(panelKey);
  const isOverridden = useIsPanelColorOverridden(panelKey);

  const pick = useCallback(
    (hex: string) => {
      if (hex.toLowerCase() === DEFAULT_PANEL_COLORS[panelKey].toLowerCase()) {
        clearPanelColor(panelKey);
      } else {
        setPanelColor(panelKey, hex);
      }
    },
    [panelKey],
  );

  const onReset = useCallback(() => clearPanelColor(panelKey), [panelKey]);

  return (
    <AnchoredMenu
      ariaLabel={label ?? "Panel color"}
      // Grid above list — the swatch grid, then the reset row.
      layout="composite"
      // `role="menu"` (the shell default), deliberately NOT the
      // `role={"dialog" as MenuRole}` cast its `SelectionColorPopover` twin
      // ships. That cast is only coherent WITH the rest of the dialog pattern:
      // the popover pairs it with `getActiveDescendantHost`, so a focused
      // element carries `aria-activedescendant` and the roving cursor is
      // announced. `AnchoredMenu` has no such host — focus stays on the trigger
      // and every item is `tabIndex: -1` — so a dialog role here would leave a
      // screen-reader user with a "dialog popup" they cannot enter, containing
      // `menuitem`s with no owning menu (the item role forks only on
      // "listbox"). These are commands; a menu that happens to lay its items out
      // as a grid is the honest description, and it keeps trigger → container →
      // item a valid chain.
      // The old popover was `right-0` — the picker sits at the LEFT of a
      // panel-header kebab whose own menu is only `min-w-[100px]` wide, so a
      // 168px grid start-aligned to the swatch would overhang the kebab's right
      // edge. End-alignment reproduces the old visual; the placement ladder
      // flips it to the other edge (and above) when the viewport says so, which
      // the hand-rolled version never did.
      align="end"
      triggerHint={label ?? "Panel color"}
      triggerAriaLabel={label ?? "Panel color"}
      triggerClassName="w-5 h-5 rounded border border-edge-hover shadow-inner shrink-0 hover:ring-2 hover:ring-edge-subtle transition-shadow"
      triggerStyle={{ background: current }}
      wrapperClassName="relative shrink-0 inline-flex"
      trigger={() => null}
    >
      {({ close }) => (
        // Padding on the BODY, not via `containerStyle`: the surface class
        // already carries `py-1`, and two Tailwind padding utilities on one
        // element resolve by stylesheet order rather than attribute order.
        // (The click fence the hand-rolled popup carried here is gone because
        // `MenuProvider` now fences the whole container — see its `onClick`.
        // A body-level fence could never have covered the container's own
        // padding band anyway, which is what made this the wrong layer.)
        <div className="p-2">
          <div
            className="grid gap-1 w-[168px]"
            style={{ gridTemplateColumns: `repeat(${SWATCH_COLS}, minmax(0, 1fr))` }}
          >
            {PRESET_COLORS.map((c, i) => (
              <PresetSwatch
                key={c.hex}
                hex={c.hex}
                name={c.name}
                row={Math.floor(i / SWATCH_COLS)}
                col={i % SWATCH_COLS}
                active={c.hex.toLowerCase() === current.toLowerCase()}
                onPick={() => {
                  pick(c.hex);
                  close();
                }}
              />
            ))}
          </div>
          {isOverridden && (
            <ResetRow
              onReset={() => {
                onReset();
                close();
              }}
            />
          )}
        </div>
      )}
    </AnchoredMenu>
  );
}

/** One preset swatch — a `region: "grid"` cell carrying its `{row, col}`, so
 *  Left/Right step within the row and Up/Down cross rows by column. `active`
 *  here means "this is the panel's CURRENT color" (the selected ring the picker
 *  has always drawn); `roving` is the keyboard cursor, painted separately so the
 *  two signals can't be confused for each other. */
function PresetSwatch({
  hex,
  name,
  row,
  col,
  active,
  onPick,
}: {
  hex: string;
  name: string;
  row: number;
  col: number;
  active: boolean;
  onPick: () => void;
}) {
  const { active: roving, getItemProps } = useMenuItem({
    id: `swatch-${hex}`,
    region: "grid",
    coords: { row, col },
    run: onPick,
  });
  return (
    <button
      {...getItemProps()}
      type="button"
      {...iconHint({ label: name })}
      className={`w-5 h-5 rounded border transition-transform hover:scale-110 ${
        active ? "ring-2 ring-offset-1 ring-stone-500" : "border-edge-hover"
      } ${roving ? "outline outline-2 outline-offset-1 outline-[var(--accent-blue)]" : ""} focus-ring`}
      style={{ background: hex }}
    />
  );
}

/** The "reset to default" action — the `region: "list"` row beneath the grid. */
function ResetRow({ onReset }: { onReset: () => void }) {
  const { active, getItemProps } = useMenuItem({ id: "reset", run: onReset });
  return (
    <button
      {...getItemProps()}
      type="button"
      className={`mt-2 w-full text-[11px] text-ink-subtle hover:text-ink-body px-2 py-1 rounded hover-on-light ${
        active ? "bg-surface-muted-strong text-ink-body" : ""
      }`}
    >
      Reset to default
    </button>
  );
}
