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
 * the keyboard controller. The rows render through the menu's own row doors —
 * the levels via `MenuRadioGroup`, "No heading" via `MenuActionRow` (task
 * 997). The menu GAINS Up/Down/Home/End arrow nav with a visible
 * `data-active` highlight + `aria-activedescendant` (NO focus theft — the PM
 * view's contentEditable holds the caret). PRESERVED: the current-level
 * checkmark (now also `aria-checked`), the disabled levels stay
 * VISIBLE + greyed + arrow-skipped + inert, Escape-close, click-outside.
 */

import { headingLevelOptions } from "@/lib/document-class";
import type { FloatingMenuPlacement } from "@/hooks/useFloatingMenuPosition";
import { MenuProvider } from "./menu/MenuProvider";
import type { LiveAnchor } from "./menu/live-anchor";
import { caretEditableHost } from "./menu/caret-host";
import { MenuSeparator } from "./menu/MenuChrome";
import { MenuRadioGroup } from "./menu/MenuRadioGroup";
import { MenuActionRow } from "./menu/MenuActionRow";

const MENU_W = 200;
const MENU_PAD_Y = 6;

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
  /** The lozenge's type chip that opened the menu — exempted from
   *  click-outside so re-clicking it toggles (task 992). */
  triggerEl?: HTMLElement | null;
  currentLevel: number;
  documentClass: string | null;
  onPick: (pick: HeadingTypePick) => void;
  onClose: () => void;
}

export function HeadingTypeMenu({ anchorRect, trackAnchor, triggerEl = null, currentLevel, documentClass, onPick, onClose }: Props) {
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
      excludeRefs={[triggerEl]}
      onClose={onClose}
      ariaLabel="Heading type"
      containerStyle={{
        width: MENU_W,
        padding: `${MENU_PAD_Y}px 0`,
      }}
    >
      {/* The levels are a pick-ONE set (a block is exactly one level), so
          they go through the radio door — the SAME component the ¶ block-type
          dropdown (`MenuBar`'s BlockTypeDropdown) renders these choices with
          (task 997). This list hand-built its radio rows until then: a second
          row vocabulary (leading ✓, `text-sm`, 28px) for the same choices,
          and no `role="group"` scoping the set. "No heading" is a COMMAND,
          not a radio option, so it is a sibling action row. */}
      <MenuRadioGroup
        idPrefix="level-"
        ariaLabel="Heading level"
        options={options.map((o) => ({
          value: o.level,
          label: o.name,
          disabled: o.disabled,
          hint: o.hint,
        }))}
        value={currentLevel}
        onPick={(level) => onPick({ kind: "level", level })}
      />
      <MenuSeparator />
      <MenuActionRow
        id="no-heading"
        label="No heading"
        onSelect={() => onPick({ kind: "no-heading" })}
      />
    </MenuProvider>
  );
}
