"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface FloatingPanelProps {
  children: ReactNode;
  initialX: number;
  initialY: number;
  initialWidth: number;
  initialHeight: number;
  zIndex: number;
  onChange: (pos: { x: number; y: number; width: number; height: number }) => void;
  onFocus?: () => void;
}

/**
 * A draggable floating window rendered via portal to document.body.
 * Drag starts on mousedown in the panel header (the top 34px strip) —
 * except when the initial target is an interactive element (button, input).
 * Resize via the bottom-right corner grip.
 */
export default function FloatingPanel({
  children,
  initialX,
  initialY,
  initialWidth,
  initialHeight,
  zIndex,
  onChange,
  onFocus,
}: FloatingPanelProps) {
  const [pos, setPos] = useState({ x: initialX, y: initialY, width: initialWidth, height: initialHeight });
  const rootRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<
    | { mode: "move"; startX: number; startY: number; origX: number; origY: number }
    | { mode: "resize"; startX: number; startY: number; origW: number; origH: number }
    | null
  >(null);
  const latestPosRef = useRef(pos);
  latestPosRef.current = pos;

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const s = dragStateRef.current;
      if (!s) return;
      e.preventDefault();
      if (s.mode === "move") {
        const dx = e.clientX - s.startX;
        const dy = e.clientY - s.startY;
        const maxX = window.innerWidth - 60;
        const maxY = window.innerHeight - 40;
        const nx = Math.max(-latestPosRef.current.width + 60, Math.min(maxX, s.origX + dx));
        const ny = Math.max(0, Math.min(maxY, s.origY + dy));
        setPos((p) => ({ ...p, x: nx, y: ny }));
      } else {
        const dw = e.clientX - s.startX;
        const dh = e.clientY - s.startY;
        const nw = Math.max(240, Math.min(900, s.origW + dw));
        const nh = Math.max(200, Math.min(window.innerHeight - 40, s.origH + dh));
        setPos((p) => ({ ...p, width: nw, height: nh }));
      }
    };
    const onUp = () => {
      if (!dragStateRef.current) return;
      dragStateRef.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      onChange(latestPosRef.current);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [onChange]);

  const onHeaderMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("button, input, textarea, select, a, [contenteditable='true']")) return;
    dragStateRef.current = {
      mode: "move",
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";
    e.preventDefault();
  };

  const onResizeMouseDown = (e: React.MouseEvent) => {
    dragStateRef.current = {
      mode: "resize",
      startX: e.clientX,
      startY: e.clientY,
      origW: pos.width,
      origH: pos.height,
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "nwse-resize";
    e.preventDefault();
    e.stopPropagation();
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={rootRef}
      className="fixed flex flex-col overflow-hidden"
      style={{
        left: pos.x,
        top: pos.y,
        width: pos.width,
        height: pos.height,
        zIndex,
        background: "var(--pod-panel, #f3f0eb)",
        borderRadius: "var(--pod-radius, 8px)",
        border: "var(--pod-border, 1px solid #e5e2dd)",
        boxShadow: "0 10px 30px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10)",
      }}
      onMouseDown={onFocus}
    >
      {/* Drag strip — exactly covers the panel header height. Children contain
          the panel's own <PanelHeader/>, whose buttons remain clickable because
          we ignore mousedown on interactive targets. */}
      <div
        onMouseDown={onHeaderMouseDown}
        style={{ cursor: "grab" }}
        className="flex flex-col min-h-0 flex-1"
      >
        {children}
      </div>
      {/* Resize handle */}
      <div
        onMouseDown={onResizeMouseDown}
        className="absolute bottom-0 right-0 w-3.5 h-3.5 cursor-nwse-resize"
        style={{
          background:
            "linear-gradient(135deg, transparent 0%, transparent 45%, #b8b4ad 45%, #b8b4ad 55%, transparent 55%, transparent 75%, #b8b4ad 75%, #b8b4ad 85%, transparent 85%)",
        }}
        aria-label="Resize"
      />
    </div>,
    document.body,
  );
}
