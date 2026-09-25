"use client";

/**
 * Dropdown popover for the heading lozenge's type chip. Lists every
 * heading level (Part…Subparagraph) plus a "No heading" demote option.
 * Entries whose `\command` isn't supported by the current documentclass
 * are rendered disabled with a tooltip — they stay visible so authors
 * see the full vocabulary even when their current class can't reach it.
 *
 * ── MENU-PRIMITIVE MIGRATION (Phase C) ──
 * Migrated onto the `<Menu>` primitive (`src/components/menu/`, design
 * `docs/agents/menu-system-design.md` §4 the HeadingTypeMenu row). It now
 * renders via `<MenuProvider layout="list" role="menu" portal>`; the provider
 * owns positioning (`useFloatingMenuPosition`, the old manual below/flip-above
 * positioner → `placements`), click-outside dismissal, the Escape handler, and
 * the keyboard controller. Each heading-level row + "No heading" calls
 * `useMenuItem` and spreads `getItemProps()` onto its existing `<button>` (no
 * markup rewrite). The menu GAINS Up/Down/Home/End arrow nav with a visible
 * `data-active` highlight + `aria-activedescendant` (NO focus theft — the PM
 * view's contentEditable holds the caret). PRESERVED: the current-level
 * checkmark (now also `aria-checked`/`data-current`), the disabled levels stay
 * VISIBLE + greyed + arrow-skipped + inert, Escape-close, click-outside.
 */

import type { CSSProperties } from "react";
import { headingLevelOptions } from "@/lib/document-class";
import type { FloatingMenuPlacement } from "@/hooks/useFloatingMenuPosition";
import { MenuProvider } from "./menu/MenuProvider";
import type { LiveAnchor } from "./menu/live-anchor";
import { caretEditableHost } from "./menu/caret-host";
import { useMenuItem } from "./menu/useMenuItem";

const MENU_W = 200;
const MENU_PAD_Y = 6;
const ITEM_H = 28;

// The old manual positioner placed the menu start-aligned below the anchor and
// flipped it above on viewport overflow (`:45` of the pre-migration file). That
// is exactly `[{ side: "below", align: "start" }, { side: "above" }]`.
const HEADING_TYPE_PLACEMENTS: FloatingMenuPlacement[] = [
  { side: "below", align: "start" },
  { side: "above" },
];

export type HeadingTypePick = { kind: "level"; level: number } | { kind: "no-heading" };

interface Props {
  anchorRect: DOMRect | { left: number; top: number; right: number; bottom: number; width: number; height: number };
  /** Live re-read of the lozenge chip (task 747) — the menu follows it on
   *  scroll. See `menu/live-anchor`. */
  trackAnchor?: LiveAnchor;
  currentLevel: number;
  documentClass: string | null;
  onPick: (pick: HeadingTypePick) => void;
  onClose: () => void;
}

interface HeadingRowProps {
  id: string;
  label: string;
  disabled: boolean;
  /** Current-selected level marker (the checkmark + aria-checked/data-current). */
  current: boolean;
  /** Hover tooltip (the unsupported-by-documentclass explanation), or undefined. */
  hint?: string;
  /** Whether to reserve the leading checkmark gutter. "No heading" omits it. */
  showCheckGutter: boolean;
  run: () => void;
}

/** One heading-level row. Registers into the menu registry via `useMenuItem`
 *  and spreads `getItemProps()` onto its existing `<button>` so it GAINS arrow
 *  nav + the `data-active` highlight without a markup rewrite. */
function HeadingRow({ id, label, disabled, current, hint, showCheckGutter, run }: HeadingRowProps) {
  const { active, getItemProps } = useMenuItem({
    id,
    region: "list",
    // The level rows are a pick-ONE set — `menuitemradio` (task 770; a plain
    // `menuitem` may not carry `aria-checked`). "No heading" is a command.
    role: showCheckGutter ? "menuitemradio" : undefined,
    disabled,
    run,
  });
  const itemProps = getItemProps();

  const style: CSSProperties = {
    height: ITEM_H,
    color: disabled ? "var(--ink-subtle)" : "var(--ink-strong)",
    // The roving-active row paints the blue-tinted selection highlight, so the
    // active item is unambiguous while arrowing (no focus move).
    background: active && !disabled ? "var(--menu-roving-bg)" : "transparent",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
  };

  return (
    <button
      {...itemProps}
      type="button"
      disabled={disabled}
      // The current-level marker — `aria-checked` for assistive tech plus a
      // `data-current` hook, alongside the visible ✓ glyph. Only meaningful on
      // the level rows; "No heading" never carries the current marker.
      aria-checked={showCheckGutter ? current : undefined}
      data-current={current ? "" : undefined}
      data-hint={hint}
      aria-description={hint}
      className={
        disabled
          ? "w-full flex items-center gap-2 px-3 text-sm text-left"
          : "w-full flex items-center gap-2 px-3 text-sm text-left hover-on-light"
      }
      style={style}
    >
      {showCheckGutter ? (
        <span style={{ width: 14, display: "inline-block", color: "var(--accent)" }}>
          {current ? "✓" : ""}
        </span>
      ) : (
        <span style={{ width: 14, display: "inline-block" }} />
      )}
      <span className="flex-1">{label}</span>
    </button>
  );
}

export function HeadingTypeMenu({ anchorRect, trackAnchor, currentLevel, documentClass, onPick, onClose }: Props) {
  // The rows AND their per-class verdicts come from the ONE derivation the ¶
  // block-type dropdown also maps (task 752), so the two heading pickers can
  // no longer disagree about which levels this document can carry.
  const options = headingLevelOptions(documentClass);

  if (typeof document === "undefined") return null;

  return (
    <MenuProvider
      id="heading-type"
      layout="list"
      role="menu"
      anchorRect={anchorRect}
      trackAnchor={trackAnchor}
      placements={HEADING_TYPE_PLACEMENTS}
      gap={4}
      getActiveDescendantHost={caretEditableHost}
      onClose={onClose}
      ariaLabel="Heading type"
      containerStyle={{
        width: MENU_W,
        padding: `${MENU_PAD_Y}px 0`,
      }}
    >
      {options.map((option) => (
        <HeadingRow
          key={option.level}
          id={`level-${option.level}`}
          label={option.name}
          disabled={option.disabled}
          current={option.level === currentLevel}
          hint={option.hint}
          showCheckGutter
          run={() => onPick({ kind: "level", level: option.level })}
        />
      ))}
      <div
        aria-hidden
        style={{
          height: 1,
          margin: "4px 8px",
          background: "var(--edge-hover)",
          opacity: 0.5,
        }}
      />
      <HeadingRow
        id="no-heading"
        label="No heading"
        disabled={false}
        current={false}
        showCheckGutter={false}
        run={() => onPick({ kind: "no-heading" })}
      />
    </MenuProvider>
  );
}
