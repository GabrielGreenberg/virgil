"use client";

/**
 * Click-to-open action menu anchored to a paragraph / selection / heading
 * drag handle. Lists the same set of actions the user can run from the
 * Actions toolbar, but scoped to the passage the handle represents — so
 * the menu items act on the whole paragraph, the selected range, or the
 * whole section depending on the handle that opened the menu.
 *
 * Items show icon + label + a right-aligned single-letter keyboard hint.
 * The letters are visible labels and also active shortcuts WHILE the
 * menu is open — pressing F runs Footnote, etc. They are not global
 * keybindings.
 *
 * ── MENU-PRIMITIVE MIGRATION (Phase B1) ──
 * This is the clean LIST reference for the `<Menu>` primitive
 * (`src/components/menu/`, design `docs/agents/menu-system-design.md`). It now
 * renders via `<MenuProvider layout="list" role="menu" portal>` +
 * `<MenuItemsFromRegistry>`; the provider owns positioning
 * (`useFloatingMenuPosition`), click-outside dismissal, the Escape handler, and
 * the keyboard controller. The menu GAINS Up/Down/Home/End/Enter arrow nav with
 * a visible active highlight, and KEEPS the letter fast-path + the
 * Backspace/Delete → delete alias (registered on the delete row's
 * `letterAliases`). Behavior is otherwise identical to before the migration.
 */

import { useMemo } from "react";
import {
  type FloatingMenuPlacement,
} from "@/hooks/useFloatingMenuPosition";
import { isTextObjectKind } from "@/text-objects/text-object-registry";
import type { TextObjectKind } from "@/text-objects/types";
import {
  cardActionRows,
  type ActionContext,
  type ActionRef,
} from "@/lib/actions/action-registry";
import { MenuProvider } from "./menu/MenuProvider";
import {
  MenuItemsFromRegistry,
  type DecoratedMenuRow,
} from "./menu/MenuItemsFromRegistry";

// The action union is owned here so the registry's per-kind action lists
// in `text-object-registry.ts` constrain a subset of this union — the
// menu is the source of truth for the global vocabulary, the registry
// for the per-kind subset. (CHIP 3: the menu DATA — labels / letters / icons
// / per-kind grey-out — now lives in `VIRGIL_ACTION_REGISTRY`; this menu is a
// thin view rendered via `cardActionRows("grab")`. The `DragHandleAction`
// TYPE stays here as the shared action-id union the dispatcher + the
// `TEXT_OBJECT_REGISTRY[kind].actions` lists speak.)
export type DragHandleAction =
  | "footnote"
  | "citation"
  | "note"
  | "highlight"
  | "todo"
  | "suggest-edit"
  | "cutter"
  | "report"
  | "duplicate"
  | "archive"
  | "delete";

const MENU_W = 220;
const MENU_PAD_Y = 6;

const DRAG_HANDLE_PLACEMENTS: FloatingMenuPlacement[] = [
  { side: "left-of", align: "center" },
  { side: "right-of", align: "center" },
];

interface Props {
  /** Bounding rect of the handle that triggered the menu — used to anchor the popover. */
  anchorRect: DOMRect | { left: number; top: number; right: number; bottom: number; width: number; height: number };
  onSelect: (action: DragHandleAction) => void;
  onClose: () => void;
  /** The kind that opened the menu. Drives the registry's per-kind `applies()`
   *  grey-out. `"selection"` is the gesture-input case and exposes the full
   *  action list (matches today's behavior). Omit to expose the full list as
   *  well — defensive default for legacy call sites until they pass a ref. */
  kind?: TextObjectKind | "selection";
  /** Whether this user may currently edit the main text — the UNIFORM
   *  collab-read-only gate (CHIP 7b). Threaded from `collab.canEditMainText`
   *  (the SSOT — see `ActionContext.canEdit`). When `false` (partner holds the
   *  pen) EVERY card action greys out, declaratively, via the row's `applies()`.
   *  Defaults to `true` (editable) so legacy call sites + non-collab docs are
   *  un-gated — NO over-gating. In practice the grab handle's hover-zone math
   *  already suppresses the handle when `!editor.isEditable`, so the menu rarely
   *  opens in read-only; this makes the greying DECLARATIVE rather than
   *  incidental. */
  canEdit?: boolean;
}

/** The PM view's focused contentEditable holds the caret while the menu is
 *  open (the menu never steals focus — roving aria-activedescendant only). Use
 *  it as the activedescendant host so a screen reader tracks the active item
 *  without the caret moving; fall back to null (the provider then no-ops the
 *  attribute write) if focus isn't on an editable element. */
function getActiveDescendantHost(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const el = document.activeElement;
  if (el instanceof HTMLElement && el.isContentEditable) return el;
  return null;
}

export function DragHandleMenu({ anchorRect, onSelect, onClose, kind, canEdit = true }: Props) {
  // Render the CARD action rows straight off the registry (the SSOT) and
  // decorate each with its per-kind disabled state from the row's own
  // `applies()`. Disabled entries stay in the list (visible-disabled
  // grey-out) so the menu shape is consistent across kinds. The registry
  // mapper + nav controller both gate on `disabled`. See
  // ACTION-MENU-DIAGNOSIS.md cluster C1 + §7 q3.
  const rows = useMemo<DecoratedMenuRow[]>(() => {
    const cardRows = cardActionRows("grab");
    // Synthesize the ref the registry's `applies()` reads. A persistent
    // TextObject kind → a `TextObjectRef` (the id is irrelevant to the
    // per-kind grey-out, which keys off `kind` alone); `"selection"` / no
    // kind / an unknown kind → a live selection ref, which exposes the full
    // vocabulary (matching the former "full list" branch).
    const ref: ActionRef =
      kind && kind !== "selection" && isTextObjectKind(kind)
        ? { kind, id: "" }
        : { kind: "selection", from: 0, to: 1, paragraphId: "" };
    // The card rows' `applies()` reads only `ctx.ref` + `ctx.canEdit`; the rest
    // of the `ActionContext` (editor/view) is unused for the per-kind grey-out,
    // so a minimal context is sufficient at menu-decoration time. `canEdit` is
    // threaded so the row's uniform collab gate (CHIP 7b) greys EVERYTHING when
    // the partner holds the pen. `canEdit !== false` ⇒ un-gated (no over-gating).
    const ctx = { ref, canEdit } as ActionContext;
    return cardRows.map<DecoratedMenuRow>((row) => ({
      id: row.id,
      label: row.label,
      letter: row.letter,
      // The destructive `delete` row also activates on Backspace / Delete —
      // preserved from the bespoke keydown listener as a letter-alias.
      letterAliases: row.id === "delete" ? ["Backspace", "Delete"] : undefined,
      icon: row.icon,
      separator: row.separator,
      destructive: row.destructive,
      disabled: row.applies(ctx) === "disabled",
      run: () => {
        onSelect(row.id as DragHandleAction);
      },
    }));
  }, [kind, canEdit, onSelect]);

  if (typeof document === "undefined") return null;

  return (
    <MenuProvider
      id="grab"
      layout="list"
      role="menu"
      portal
      anchorRect={anchorRect}
      placements={DRAG_HANDLE_PLACEMENTS}
      letterShortcuts
      getActiveDescendantHost={getActiveDescendantHost}
      onClose={onClose}
      ariaLabel="Passage actions"
      containerStyle={{
        width: MENU_W,
        background: "var(--pod-editor)",
        border: "var(--pod-border)",
        boxShadow: "var(--pod-shadow)",
        borderRadius: "var(--pod-radius)",
        padding: `${MENU_PAD_Y}px 0`,
      }}
    >
      <MenuItemsFromRegistry rows={rows} />
    </MenuProvider>
  );
}
