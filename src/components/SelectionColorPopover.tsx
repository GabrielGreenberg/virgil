"use client";

/**
 * Color-picker popover spawned from the right-side SelectionActionsMenu's
 * Color button. Shows 7 swatches + a custom-color picker + a Clear
 * action. Picking a custom color replaces the least-recently-used slot.
 * Palette + MRU order persist via localStorage on the parent.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";

const POPOVER_W = 220;
const SWATCH_SIZE = 22;
const VIEWPORT_MARGIN = 8;

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
}

export function SelectionColorPopover({
  anchorRect,
  palette,
  onApply,
  onClear,
  onPickCustom,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const estimatedHeight = useMemo(() => {
    // Single row of swatches + picker + clear.
    return 8 + SWATCH_SIZE + 8;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Default: open below + aligned to the button's left.
    let left = anchorRect.left;
    let top = anchorRect.bottom + 6;
    if (left + POPOVER_W > vw - VIEWPORT_MARGIN) {
      left = Math.max(VIEWPORT_MARGIN, vw - POPOVER_W - VIEWPORT_MARGIN);
    }
    if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
    if (top + estimatedHeight > vh - VIEWPORT_MARGIN) {
      // Flip above.
      top = anchorRect.top - estimatedHeight - 6;
      if (top < VIEWPORT_MARGIN) top = VIEWPORT_MARGIN;
    }
    setPos({ left, top });
  }, [anchorRect.left, anchorRect.top, anchorRect.right, anchorRect.bottom, estimatedHeight]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    const onMouseDown = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    // Defer so the click that opened the popover doesn't immediately close it.
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
      ref={ref}
      role="dialog"
      aria-label="Text color"
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        width: POPOVER_W,
        zIndex: 2010,
        background: "var(--pod-editor)",
        border: "var(--pod-border)",
        boxShadow: "var(--pod-shadow)",
        borderRadius: "var(--pod-radius)",
        padding: 8,
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* Row 1: swatches + custom-picker + clear */}
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {palette.map((color, i) => (
          <button
            key={`${color}-${i}`}
            type="button"
            title={color}
            onClick={() => onApply(color)}
            style={{
              width: SWATCH_SIZE,
              height: SWATCH_SIZE,
              borderRadius: 4,
              background: color,
              border: "1px solid var(--edge-hover)",
              cursor: "pointer",
              padding: 0,
            }}
          />
        ))}
        <button
          type="button"
          title="Pick a custom color"
          onClick={() => fileInputRef.current?.click()}
          style={{
            width: SWATCH_SIZE,
            height: SWATCH_SIZE,
            marginLeft: 4,
            borderRadius: 4,
            background:
              "conic-gradient(from 0deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)",
            border: "1px solid var(--edge-hover)",
            cursor: "pointer",
            padding: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white",
            fontSize: 12,
            fontWeight: 700,
            textShadow: "0 0 2px rgba(0,0,0,0.6)",
          }}
        >
          +
        </button>
        <input
          ref={fileInputRef}
          type="color"
          aria-hidden
          style={{ position: "absolute", width: 0, height: 0, opacity: 0, pointerEvents: "none" }}
          onChange={(e) => {
            const c = e.target.value;
            if (c) onPickCustom(c);
          }}
        />
        <button
          type="button"
          title="Clear color"
          onClick={onClear}
          style={{
            width: SWATCH_SIZE,
            height: SWATCH_SIZE,
            borderRadius: 4,
            background: "transparent",
            border: "1px solid var(--edge-hover)",
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
      </div>
    </div>,
    document.body,
  );
}
