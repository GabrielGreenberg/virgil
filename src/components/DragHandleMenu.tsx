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
 */

import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import {
  useFloatingMenuPosition,
  type FloatingMenuPlacement,
} from "@/hooks/useFloatingMenuPosition";
import { isTextObjectKind } from "@/text-objects/text-object-registry";
import type { TextObjectKind } from "@/text-objects/types";
import {
  cardActionRows,
  type ActionContext,
  type ActionRef,
  type ActionSpec,
} from "@/lib/actions/action-registry";

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

/**
 * A registry card row decorated with its per-kind disabled state for THIS
 * menu open — the registry `ActionSpec` plus the resolved `disabled` flag the
 * render + keyboard handler gate on. Replaces the former per-instance
 * `MenuEntry`. `disabled` entries render greyed-out (visible) instead of being
 * filtered away, so the menu's shape stays consistent across kinds. See
 * ACTION-MENU-DIAGNOSIS.md cluster C1.
 */
interface DecoratedRow {
  row: ActionSpec;
  disabled: boolean;
}

const MENU_W = 220;
const MENU_PAD_Y = 6;
const ITEM_H = 30;

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
}

export function DragHandleMenu({ anchorRect, onSelect, onClose, kind }: Props) {
  // Render the CARD action rows straight off the registry (the SSOT) and
  // decorate each with its per-kind disabled state from the row's own
  // `applies()`. Disabled entries stay in the list (visible-disabled
  // grey-out) so the menu shape is consistent across kinds. The render and
  // keyboard handler both gate on `disabled`. See ACTION-MENU-DIAGNOSIS.md
  // cluster C1 + §7 q3.
  const entries = useMemo<DecoratedRow[]>(() => {
    const rows = cardActionRows("grab");
    // Synthesize the ref the registry's `applies()` reads. A persistent
    // TextObject kind → a `TextObjectRef` (the id is irrelevant to the
    // per-kind grey-out, which keys off `kind` alone); `"selection"` / no
    // kind / an unknown kind → a live selection ref, which exposes the full
    // vocabulary (matching the former "full list" branch).
    const ref: ActionRef =
      kind && kind !== "selection" && isTextObjectKind(kind)
        ? { kind, id: "" }
        : { kind: "selection", from: 0, to: 1, paragraphId: "" };
    // The card rows' `applies()` reads only `ctx.ref`; the rest of the
    // `ActionContext` (editor/view) is unused for the per-kind grey-out, so a
    // ref-only context is sufficient at menu-decoration time.
    const ctx = { ref } as ActionContext;
    return rows.map((row) => ({ row, disabled: row.applies(ctx) === "disabled" }));
  }, [kind]);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // Left of the handle by default so the menu doesn't cover the grip or
  // the prose to its right; flip right if there's no room on the left.
  // Vertically center on the handle. The hook handles flip + viewport
  // clamp using the menu's measured size, so adding/removing entries
  // doesn't drift the placement math out of sync.
  const { ref: positionRef, style: positionStyle } = useFloatingMenuPosition({
    anchorRect,
    placements: DRAG_HANDLE_PLACEMENTS,
  });
  const setMenuRef = (el: HTMLDivElement | null) => {
    menuRef.current = el;
    positionRef(el);
  };

  // Close on Escape, click-outside, or letter shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      // Ignore when modifier keys are held — the menu's shortcuts are bare keys.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Backspace / Delete map to the destructive delete action when present.
      if (e.key === "Backspace" || e.key === "Delete") {
        const hit = entries.find((m) => m.row.id === "delete");
        if (hit && !hit.disabled) {
          e.preventDefault();
          onSelect(hit.row.id as DragHandleAction);
        }
        return;
      }
      if (e.key.length !== 1) return;
      const letter = e.key.toUpperCase();
      const hit = entries.find((m) => m.row.letter === letter);
      if (hit && !hit.disabled) {
        e.preventDefault();
        onSelect(hit.row.id as DragHandleAction);
      }
    };
    const onMouseDown = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    // Defer so the click that opened the menu doesn't immediately close it.
    const t = window.setTimeout(() => {
      window.addEventListener("mousedown", onMouseDown, true);
    }, 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onMouseDown, true);
    };
  }, [onClose, onSelect]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={setMenuRef}
      role="menu"
      aria-label="Passage actions"
      style={{
        ...positionStyle,
        width: MENU_W,
        zIndex: 2000,
        background: "var(--pod-editor)",
        border: "var(--pod-border)",
        boxShadow: "var(--pod-shadow)",
        borderRadius: "var(--pod-radius)",
        padding: `${MENU_PAD_Y}px 0`,
      }}
      // Stop pointer events from bubbling to the editor or the underlying
      // selection — opening the menu shouldn't shift the editor caret.
      onMouseDown={(e) => e.stopPropagation()}
    >
      {entries.map(({ row, disabled }) => (
        <div key={row.id}>
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
            type="button"
            role="menuitem"
            disabled={disabled}
            aria-disabled={disabled || undefined}
            onClick={() => {
              if (disabled) return;
              onSelect(row.id as DragHandleAction);
            }}
            className={
              disabled
                ? "w-full flex items-center gap-2.5 px-3 text-sm text-left"
                : "w-full flex items-center gap-2.5 px-3 text-sm text-left hover-on-light"
            }
            style={{
              height: ITEM_H,
              color: disabled
                ? "var(--ink-subtle)"
                : row.destructive
                  ? "var(--danger, #b45757)"
                  : "var(--ink-strong)",
              background: "transparent",
              opacity: disabled ? 0.45 : 1,
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            <span className="shrink-0 flex items-center justify-center" style={{ width: 16, height: 16 }}>
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
      ))}
    </div>,
    document.body,
  );
}
