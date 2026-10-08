"use client";

import type { CSSProperties, ReactNode } from "react";
import { AnchoredMenu } from "@/components/menu/AnchoredMenu";
import { MenuActionRow } from "@/components/menu/MenuActionRow";
import { MenuSeparator } from "@/components/menu/MenuChrome";

/**
 * RowMenu — the single portaled three-dot (⋮) menu primitive for the
 * Library's row affordances. F#5/F#7 build the Libraries-pod and
 * My-Papers-pod row menus on it; `RowActionMenu` (the catalog paper rows)
 * is refactored onto it too, so "a row's overflow menu" is ONE component
 * with one trigger/positioning/escape/outside-click behaviour everywhere.
 *
 * Declarative: callers pass an `items` array. Since task 1011 this is a thin
 * adapter over the app's ONE menu door (`AnchoredMenu`): measured flip on
 * both axes + re-anchor, roving ↑/↓ nav, Escape (cancel, focus back to the
 * trigger) vs click-away (dismiss), the menu-trigger ARIA contract, the
 * `.menu-surface` chrome and the shared row tones. What stays HERE is only
 * the Library's declarative item vocabulary and its trigger look. Click-
 * through suppression (opening or selecting never fires the underlying row's
 * onClick) comes from the shell: the trigger stops its click and the provider
 * fences the menu container.
 *
 * Lives in `library/components/` and is import-safe from
 * `src/components/library/` too (MyPapersPod), matching the existing
 * `@library/components/*` bridge that `LibraryTabView` already uses.
 */

export interface RowMenuAction {
  key: string;
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

export interface RowMenuDivider {
  key: string;
  divider: true;
}

export type RowMenuEntry = RowMenuAction | RowMenuDivider;

function isDivider(e: RowMenuEntry): e is RowMenuDivider {
  return (e as RowMenuDivider).divider === true;
}

interface RowMenuProps {
  items: RowMenuEntry[];
  /** Disabled trigger (e.g. an un-triaged catalog row with no citekey). */
  disabled?: boolean;
  /** Tooltip for the trigger. */
  title?: string;
  /** Accessible label for the trigger. */
  ariaLabel?: string;
  /** Trigger glyph — defaults to the three-dot ⋮. F#5's "My libraries"
   *  header reuses this with a "+". */
  glyph?: ReactNode;
  /** Popup min width. */
  minWidth?: number;
  /** Override the trigger button style (size/colour). */
  triggerStyle?: CSSProperties;
}

export default function RowMenu({
  items,
  disabled = false,
  title,
  ariaLabel = "Row actions",
  glyph = "⋮",
  minWidth = 168,
  triggerStyle,
}: RowMenuProps) {
  // The trigger's background is the hover tint's (a class), so a caller's
  // inline `background` — the resting value the old `onMouseEnter` repaint
  // restored — would pin it and kill the hover. Every caller's was
  // `transparent`, which a `<button>` already is under the preflight.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { background: _restingBg, ...resolvedTriggerStyle } =
    triggerStyle ?? defaultTriggerStyle(disabled);

  return (
    // Keys pressed ON the trigger are the trigger's: a row that navigates on
    // Enter / arrows must not also act when the user opens its menu. (An OPEN
    // menu's keys never get this far — its controller reads them at window
    // capture.)
    <div style={{ display: "contents" }} onKeyDown={(e) => e.stopPropagation()}>
      <AnchoredMenu
        ariaLabel={ariaLabel}
        // The kebab sits at a row's RIGHT edge, so the menu drops leftward and
        // flips on the MEASURED body (the `items.length * ITEM_HEIGHT`
        // estimate it replaces misjudged dividers and long labels).
        align="end"
        gap={2}
        trigger={() => glyph}
        triggerDisabled={disabled}
        triggerHint={title ?? (disabled ? "Unavailable" : ariaLabel)}
        triggerClassName={disabled ? undefined : "hover:bg-black/[0.06]"}
        triggerStyle={resolvedTriggerStyle}
        wrapperClassName="relative shrink-0 flex"
        containerStyle={{ minWidth }}
        closeOnInsideClick
      >
        {items.map((item) =>
          isDivider(item) ? (
            <MenuSeparator key={item.key} />
          ) : (
            <MenuActionRow
              key={item.key}
              id={item.key}
              label={item.label}
              tone={item.destructive ? "danger" : "default"}
              disabled={item.disabled}
              onSelect={item.onSelect}
            />
          ),
        )}
      </AnchoredMenu>
    </div>
  );
}

function defaultTriggerStyle(disabled: boolean): CSSProperties {
  return {
    width: 24,
    height: 24,
    padding: 0,
    border: "none",
    color: disabled ? "var(--muted-light)" : "var(--muted)",
    cursor: disabled ? "default" : "pointer",
    fontSize: 16,
    lineHeight: 1,
    fontFamily: "inherit",
    borderRadius: "var(--radius-xs)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  };
}
