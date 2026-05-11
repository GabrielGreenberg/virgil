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

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  IconArchive,
  IconCitation,
  IconCutter,
  IconFootnote,
  IconNotes,
  IconQuotations,
  IconRevisions,
  IconTodo,
} from "./editor-layout/panel-icons";

export type DragHandleAction =
  | "footnote"
  | "citation"
  | "quotation"
  | "note"
  | "todo"
  | "review"
  | "suggest-edit"
  | "cutter"
  | "archive";

interface MenuEntry {
  action: DragHandleAction;
  label: string;
  letter: string;
  icon: React.ReactNode;
  destructive?: boolean;
  /** When true, draw a divider line above this entry. */
  separator?: boolean;
}

const MENU_ENTRIES: MenuEntry[] = [
  { action: "footnote", label: "Footnote", letter: "F", icon: <IconFootnote size={16} /> },
  { action: "citation", label: "Citation", letter: "C", icon: <IconCitation size={16} /> },
  { action: "quotation", label: "Quotation", letter: "Q", icon: <IconQuotations size={16} /> },
  { action: "note", label: "Note", letter: "N", icon: <IconNotes size={16} /> },
  { action: "todo", label: "Todo", letter: "T", icon: <IconTodo size={16} /> },
  { action: "review", label: "Review", letter: "R", icon: <IconRevisions size={16} /> },
  { action: "suggest-edit", label: "Suggest edit", letter: "S", icon: <IconRevisions size={16} /> },
  { action: "cutter", label: "Cutter", letter: "X", icon: <IconCutter size={16} /> },
  { action: "archive", label: "Archive", letter: "A", icon: <IconArchive size={16} />, destructive: true, separator: true },
];

const MENU_W = 220;
const MENU_PAD_Y = 6;
const ITEM_H = 30;
const SEPARATOR_H = 9;
const VIEWPORT_MARGIN = 8;

interface Props {
  /** Bounding rect of the handle that triggered the menu — used to anchor the popover. */
  anchorRect: DOMRect | { left: number; top: number; right: number; bottom: number; width: number; height: number };
  onSelect: (action: DragHandleAction) => void;
  onClose: () => void;
}

export function DragHandleMenu({ anchorRect, onSelect, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const menuHeight = useMemo(() => {
    const base = MENU_PAD_Y * 2;
    let h = 0;
    for (const entry of MENU_ENTRIES) {
      if (entry.separator) h += SEPARATOR_H;
      h += ITEM_H;
    }
    return base + h;
  }, []);

  // Position relative to the anchor — right of the handle by default,
  // flip left if it would overflow the viewport. Top-aligned with the
  // handle's top, nudged up if too close to the bottom edge.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = anchorRect.right + 6;
    if (left + MENU_W > vw - VIEWPORT_MARGIN) {
      left = anchorRect.left - MENU_W - 6;
    }
    if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
    let top = anchorRect.top;
    if (top + menuHeight > vh - VIEWPORT_MARGIN) {
      top = Math.max(VIEWPORT_MARGIN, vh - menuHeight - VIEWPORT_MARGIN);
    }
    setPos({ left, top });
  }, [anchorRect.left, anchorRect.top, anchorRect.right, anchorRect.bottom, menuHeight]);

  // Close on Escape, click-outside, or letter shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      // Ignore when modifier keys are held — the menu's shortcuts are bare letters.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length !== 1) return;
      const letter = e.key.toUpperCase();
      const hit = MENU_ENTRIES.find((m) => m.letter === letter);
      if (hit) {
        e.preventDefault();
        onSelect(hit.action);
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
  if (!pos) return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="Passage actions"
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
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
      {MENU_ENTRIES.map((entry) => (
        <div key={entry.action}>
          {entry.separator && (
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
            onClick={() => onSelect(entry.action)}
            className="w-full flex items-center gap-2.5 px-3 text-sm text-left hover-on-light"
            style={{
              height: ITEM_H,
              color: entry.destructive ? "var(--danger, #b45757)" : "var(--ink-strong)",
              background: "transparent",
            }}
          >
            <span className="shrink-0 flex items-center justify-center" style={{ width: 16, height: 16 }}>
              {entry.icon}
            </span>
            <span className="flex-1">{entry.label}</span>
            <span
              className="tabular-nums"
              style={{ fontSize: 11, color: "var(--ink-subtle)" }}
            >
              {entry.letter}
            </span>
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
