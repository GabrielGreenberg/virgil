"use client";

/**
 * Color-picker popover spawned from the right-side SelectionActionsMenu's
 * Color button (and from the lightning grid's text-color cell). Shows 7
 * swatches + a native custom-color picker + a Clear action. Picking a custom
 * color replaces the least-recently-used slot. Palette + MRU order persist via
 * localStorage on the parent.
 *
 * ── MENU-PRIMITIVE MIGRATION (Phase C) ──
 * Migrated onto the `<Menu>` primitive (`src/components/menu/`, design
 * `docs/agents/menu-system-design.md` §3.5 + §4 the SelectionColorPopover row)
 * as the `role="dialog"` / `region="widget"` adapter. It now renders via a
 * `<MenuProvider layout="list" portal>` whose container is the `role="dialog"`
 * popover; the provider owns positioning (the old manual viewport-clamp
 * positioner → `placements`), click-outside dismissal (the old deferred
 * mousedown effect → the provider's), the Escape handler, and the keyboard
 * controller. The swatch buttons + the clear button register via
 * `useMenuItem({ region: "list", run })` and spread `getItemProps()`, so the
 * row GAINS arrow nav with a visible `data-active` highlight +
 * `aria-activedescendant` (NO focus theft — the PM view's contentEditable holds
 * the caret).
 *
 * Horizontal layout note: the swatches are laid out horizontally, but the
 * shared `list` layout binds Up/Down (Left/Right are inert in a flat list —
 * `nav-core.ts` listMove). Per the migration brief we navigate the swatches
 * with Up/Down (every swatch + clear is one flat list) rather than touching the
 * primitive; Left/Right over a horizontal list is left as a follow-up the
 * primitive owns.
 *
 * The native `<input type="color">` registers as `region: "widget"` — a
 * focus-island skipped by roving (the registry/nav-core skip `region==="widget"`
 * nodes) but reachable by Tab and clickable, keeping its native click-to-open
 * picker behavior. It styles itself as the rainbow "custom" swatch (replacing
 * the old hidden-input + visible-`+`-button pair).
 *
 * PRESERVED: clicking a swatch applies the color (onApply) + the clear handler
 * (onClear) + the custom-pick handler (onPickCustom); `role="dialog"` +
 * `aria-label="Text color"`; the `onContainerRef` wiring (so the parent
 * lightning `<MenuProvider>` registers this popover into its click-outside
 * `excludeRefs` — the lightning panel stays open while you use the color
 * popover); Escape-close; click-outside dismiss.
 */

import { useLayoutEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import type { FloatingMenuPlacement } from "@/hooks/useFloatingMenuPosition";
import { MenuProvider } from "./menu/MenuProvider";
import { useMenuItem } from "./menu/useMenuItem";
import type { MenuRole } from "./menu/types";

const POPOVER_W = 220;
const SWATCH_SIZE = 22;

// The old manual positioner opened the popover start-aligned below the trigger
// and flipped it above on viewport overflow. That is exactly
// `[{ side: "below", align: "start" }, { side: "above" }]`.
const COLOR_POPOVER_PLACEMENTS: FloatingMenuPlacement[] = [
  { side: "below", align: "start" },
  { side: "above" },
];

interface Props {
  editor: Editor;
  /** Bounding rect of the Color button that triggered the popover. */
  anchorRect: DOMRect;
  palette: string[];
  /** Apply a color: dispatches the mark to the live selection AND notifies
   *  the parent to bump MRU + persist. */
  onApply: (color: string) => void;
  /** Strip the displayColor mark from the live selection. */
  onClear: () => void;
  /** Replace the least-recently-used slot with a custom color, then apply. */
  onPickCustom: (color: string) => void;
  onClose: () => void;
  /**
   * Surface the popover's container element to a parent (the lightning
   * `<MenuProvider>`) so it can register it into the menu's click-outside
   * `excludeRefs` set — the menu stays open while you use the color popover.
   * Called with the live element on mount and `null` on unmount. Optional, so
   * the standalone SelectionActionsMenu caller is unaffected.
   */
  onContainerRef?: (el: HTMLDivElement | null) => void;
}

/** The PM view's focused contentEditable holds the caret while the popover is
 *  open (the popover never steals focus — roving aria-activedescendant only).
 *  Use it as the activedescendant host so a screen reader tracks the active
 *  swatch without the caret moving; fall back to null (the provider then no-ops
 *  the attribute write) if focus isn't on an editable element. Mirrors
 *  `HeadingTypeMenu` / `DragHandleMenu`'s resolver. */
function getActiveDescendantHost(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const el = document.activeElement;
  if (el instanceof HTMLElement && el.isContentEditable) return el;
  return null;
}

export function SelectionColorPopover({
  anchorRect,
  palette,
  onApply,
  onClear,
  onPickCustom,
  onClose,
  onContainerRef,
}: Props) {
  if (typeof document === "undefined") return null;

  return (
    <MenuProvider
      id="selection-color"
      layout="list"
      // The swatch row is visually horizontal, so Left/Right step it (Up/Down
      // are inert here) — matching the user's spatial expectation.
      orientation="horizontal"
      // KEEP role="dialog" (no filter input → not a combobox). The primitive's
      // `MenuRole` type covers only the ARIA item-fork ("menu" | "listbox"); the
      // dialog container role is set verbatim on the provider's container, so we
      // pass "dialog" through (cast at the call site — no primitive change). The
      // item-role resolution falls to "menuitem" (menuRole !== "listbox"), which
      // is the correct role for the swatch/clear command buttons.
      role={"dialog" as MenuRole}
      portal
      anchorRect={anchorRect}
      placements={COLOR_POPOVER_PLACEMENTS}
      gap={6}
      getActiveDescendantHost={getActiveDescendantHost}
      onClose={onClose}
      ariaLabel="Text color"
      containerStyle={{
        width: POPOVER_W,
        background: "var(--pod-editor)",
        border: "var(--pod-border)",
        boxShadow: "var(--pod-shadow)",
        borderRadius: "var(--pod-radius)",
        padding: 8,
      }}
    >
      <ColorPopoverBody
        palette={palette}
        onApply={onApply}
        onClear={onClear}
        onPickCustom={onPickCustom}
        onContainerRef={onContainerRef}
      />
    </MenuProvider>
  );
}

interface BodyProps {
  palette: string[];
  onApply: (color: string) => void;
  onClear: () => void;
  onPickCustom: (color: string) => void;
  onContainerRef?: (el: HTMLDivElement | null) => void;
}

/** The popover body — lives INSIDE the provider so the swatches + clear can
 *  register via `useMenuItem` and the native color input can register as a
 *  `region: "widget"` focus-island. */
function ColorPopoverBody({
  palette,
  onApply,
  onClear,
  onPickCustom,
  onContainerRef,
}: BodyProps) {
  // Surface the provider's `role="dialog"` container to the parent's
  // `onContainerRef` (the lightning panel's `excludeRefs`). The provider owns
  // its container ref and doesn't expose it, so resolve it from this row (a
  // descendant of the dialog) via `closest('[role="dialog"]')`. Done in a layout
  // effect so the parent's exclude set sees the live element before the next
  // click-outside test.
  const rowRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const container = rowRef.current?.closest<HTMLDivElement>('[role="dialog"]') ?? null;
    onContainerRef?.(container);
    return () => onContainerRef?.(null);
  }, [onContainerRef]);

  return (
    <div ref={rowRef} style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {palette.map((color, i) => (
        <Swatch key={`${color}-${i}`} id={`swatch-${i}`} color={color} onApply={onApply} />
      ))}
      <CustomColorInput onPickCustom={onPickCustom} />
      <ClearButton onClear={onClear} />
    </div>
  );
}

interface SwatchProps {
  id: string;
  color: string;
  onApply: (color: string) => void;
}

/** One palette swatch. Registers as a `list` item so the roving cursor crosses
 *  it; spreads `getItemProps()` so it gains arrow nav + the `data-active`
 *  highlight. Click / Enter / Space applies the color. */
function Swatch({ id, color, onApply }: SwatchProps) {
  const { active, getItemProps } = useMenuItem({
    id,
    region: "list",
    run: () => onApply(color),
  });
  return (
    <button
      {...getItemProps()}
      type="button"
      data-hint={color}
      aria-label={color}
      style={{
        width: SWATCH_SIZE,
        height: SWATCH_SIZE,
        borderRadius: "var(--radius-sm)",
        background: color,
        // The roving-active swatch gets a stronger ring so the active item is
        // unambiguous while arrowing (no focus move).
        border: active ? "2px solid var(--accent-blue)" : "1px solid var(--edge-hover)",
        cursor: "pointer",
        padding: 0,
      }}
    />
  );
}

interface CustomColorInputProps {
  onPickCustom: (color: string) => void;
}

/** The custom-color picker — a native `<input type="color">` registered as a
 *  `region: "widget"` focus-island: skipped by roving (the registry/nav-core
 *  ignore `region==="widget"` nodes), but Tab-reachable + clickable, keeping its
 *  native click-to-open behavior. We register it for the snapshot (so the roving
 *  cursor correctly steps OVER it) but DO NOT apply `getItemProps().tabIndex`
 *  (-1) — the input must stay in the Tab order — so we spread only its `ref`,
 *  `id`, and `role`. Styled as the rainbow "custom" swatch. */
function CustomColorInput({ onPickCustom }: CustomColorInputProps) {
  const { getItemProps } = useMenuItem({
    id: "custom",
    region: "widget",
    run: () => {},
  });
  // Pull only the registry ref + id off the getter; deliberately omit
  // `tabIndex: -1` (Tab-reachable) and the `onClick`/`onMouseEnter` roving hooks
  // (the native input owns its own interaction).
  const { ref, id } = getItemProps();
  return (
    <input
      ref={ref}
      id={id}
      type="color"
      data-hint="Pick a custom color"
      aria-label="Pick a custom color"
      onChange={(e) => {
        const c = e.target.value;
        if (c) onPickCustom(c);
      }}
      style={{
        width: SWATCH_SIZE,
        height: SWATCH_SIZE,
        marginLeft: 4,
        borderRadius: "var(--radius-sm)",
        // Hide the native swatch chrome so the rainbow gradient reads as the
        // "custom" affordance, matching the old visible `+` button.
        background:
          "conic-gradient(from 0deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)",
        border: "1px solid var(--edge-hover)",
        cursor: "pointer",
        padding: 0,
        appearance: "none",
        WebkitAppearance: "none",
      }}
    />
  );
}

interface ClearButtonProps {
  onClear: () => void;
}

/** The clear-color action. Registers as a `list` item (so arrows reach it) and
 *  spreads `getItemProps()`; click / Enter / Space strips the color mark. */
function ClearButton({ onClear }: ClearButtonProps) {
  const { active, getItemProps } = useMenuItem({
    id: "clear",
    region: "list",
    run: onClear,
  });
  return (
    <button
      {...getItemProps()}
      type="button"
      data-hint="Clear color"
      aria-label="Clear color"
      style={{
        width: SWATCH_SIZE,
        height: SWATCH_SIZE,
        borderRadius: "var(--radius-sm)",
        background: "transparent",
        border: active ? "2px solid var(--accent-blue)" : "1px solid var(--edge-hover)",
        cursor: "pointer",
        padding: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--ink-muted)",
        fontSize: 14,
        lineHeight: 1,
      }}
    >
      ×
    </button>
  );
}
