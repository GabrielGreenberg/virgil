"use client";

/**
 * Dropdown popover for the heading lozenge's type chip. Lists every
 * heading level (Part…Subparagraph) plus a "No heading" demote option.
 * Entries whose `\command` isn't supported by the current documentclass
 * are rendered disabled with a tooltip — they stay visible so authors
 * see the full vocabulary even when their current class can't reach it.
 *
 * Modelled on `DragHandleMenu`: portal-mounted, fixed-position, closes
 * on Escape / click-outside.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HEADING_TYPES } from "@/lib/heading-types";
import { CLASS_COMMANDS } from "@/lib/document-class";

const MENU_W = 200;
const MENU_PAD_Y = 6;
const ITEM_H = 28;
const SEPARATOR_H = 9;
const VIEWPORT_MARGIN = 8;

export type HeadingTypePick = { kind: "level"; level: number } | { kind: "no-heading" };

interface Props {
  anchorRect: DOMRect | { left: number; top: number; right: number; bottom: number; width: number; height: number };
  currentLevel: number;
  documentClass: string | null;
  onPick: (pick: HeadingTypePick) => void;
  onClose: () => void;
}

export function HeadingTypeMenu({ anchorRect, currentLevel, documentClass, onPick, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const supported = documentClass && Object.prototype.hasOwnProperty.call(CLASS_COMMANDS, documentClass)
    ? CLASS_COMMANDS[documentClass]
    : null;

  const menuHeight = MENU_PAD_Y * 2 + HEADING_TYPES.length * ITEM_H + SEPARATOR_H + ITEM_H;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = anchorRect.left;
    if (left + MENU_W > vw - VIEWPORT_MARGIN) {
      left = Math.max(VIEWPORT_MARGIN, vw - MENU_W - VIEWPORT_MARGIN);
    }
    let top = anchorRect.bottom + 4;
    if (top + menuHeight > vh - VIEWPORT_MARGIN) {
      top = Math.max(VIEWPORT_MARGIN, anchorRect.top - menuHeight - 4);
    }
    setPos({ left, top });
  }, [anchorRect.left, anchorRect.top, anchorRect.right, anchorRect.bottom, menuHeight]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    const onMouseDown = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    const t = window.setTimeout(() => {
      window.addEventListener("mousedown", onMouseDown, true);
    }, 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onMouseDown, true);
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;
  if (!pos) return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="Heading type"
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
      onMouseDown={(e) => e.stopPropagation()}
    >
      {HEADING_TYPES.map((entry) => {
        const disabled = supported ? !supported.has(entry.command) : false;
        const isCurrent = entry.level === currentLevel;
        const title = disabled
          ? `Not supported by \`${documentClass}\` class — switch the document class to use ${entry.name}`
          : undefined;
        return (
          <button
            key={entry.level}
            type="button"
            role="menuitem"
            disabled={disabled}
            data-hint={title}
            onClick={() => {
              if (disabled) return;
              onPick({ kind: "level", level: entry.level });
            }}
            className="w-full flex items-center gap-2 px-3 text-sm text-left hover-on-light"
            style={{
              height: ITEM_H,
              color: disabled ? "var(--ink-subtle)" : "var(--ink-strong)",
              background: "transparent",
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.55 : 1,
            }} aria-label={title}
          >
            <span style={{ width: 14, display: "inline-block", color: "var(--accent)" }}>
              {isCurrent ? "✓" : ""}
            </span>
            <span className="flex-1">{entry.name}</span>
          </button>
        );
      })}
      <div
        aria-hidden
        style={{
          height: 1,
          margin: "4px 8px",
          background: "var(--edge-hover)",
          opacity: 0.5,
        }}
      />
      <button
        type="button"
        role="menuitem"
        onClick={() => onPick({ kind: "no-heading" })}
        className="w-full flex items-center gap-2 px-3 text-sm text-left hover-on-light"
        style={{
          height: ITEM_H,
          color: "var(--ink-strong)",
          background: "transparent",
        }}
      >
        <span style={{ width: 14, display: "inline-block" }} />
        <span className="flex-1">No heading</span>
      </button>
    </div>,
    document.body,
  );
}
