"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Centralised drag-gap behaviour for all resizable dividers.
 *
 * Handles:
 * - drag lifecycle (mousedown / mousemove / mouseup)
 * - body cursor + userSelect during drag
 * - "dragging" class on the gap element
 * - optional deadzone (px) before drag activates
 * - hover-preview: blue line appears after a short delay on hover
 */
export function useDragGap({
  cursor,
  onMove,
  deadzone = 0,
  hoverDelayMs = 120,
}: {
  cursor: "col-resize" | "row-resize";
  onMove: (e: MouseEvent) => void;
  deadzone?: number;
  hoverDelayMs?: number;
}) {
  const gapRef = useRef<HTMLDivElement>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  // ── Hover delay ──────────────────────────────────────────────────
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHover = useCallback(() => {
    if (hoverTimer.current !== null) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    gapRef.current?.classList.remove("hover-preview");
  }, []);

  useEffect(() => {
    const el = gapRef.current;
    if (!el) return;

    const onEnter = () => {
      hoverTimer.current = setTimeout(() => {
        el.classList.add("hover-preview");
      }, hoverDelayMs);
    };
    const onLeave = () => {
      clearHover();
    };

    el.addEventListener("mouseenter", onEnter);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mouseenter", onEnter);
      el.removeEventListener("mouseleave", onLeave);
      clearHover();
    };
  }, [hoverDelayMs, clearHover]);

  // ── Drag lifecycle ──────────────────────────────────────────────
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      clearHover(); // hover-preview off; dragging takes over

      const startX = e.clientX;
      const startY = e.clientY;
      let activated = deadzone <= 0;

      if (activated) {
        gapRef.current?.classList.add("dragging");
        document.body.style.cursor = cursor;
        document.body.style.userSelect = "none";
        window.dispatchEvent(new CustomEvent("virgil:drag-gap-start"));
      }

      const onMoveEvt = (ev: MouseEvent) => {
        if (!activated) {
          const dx = Math.abs(ev.clientX - startX);
          const dy = Math.abs(ev.clientY - startY);
          if (Math.max(dx, dy) <= deadzone) return;
          activated = true;
          gapRef.current?.classList.add("dragging");
          document.body.style.cursor = cursor;
          document.body.style.userSelect = "none";
          window.dispatchEvent(new CustomEvent("virgil:drag-gap-start"));
        }
        onMoveRef.current(ev);
      };

      const onUp = () => {
        gapRef.current?.classList.remove("dragging");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        if (activated) {
          window.dispatchEvent(new CustomEvent("virgil:drag-gap-end"));
        }
        window.removeEventListener("mousemove", onMoveEvt);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMoveEvt);
      window.addEventListener("mouseup", onUp);
    },
    [cursor, deadzone, clearHover],
  );

  return { gapRef, onMouseDown };
}
