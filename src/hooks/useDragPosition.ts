"use client";

import { useState, useRef, useCallback } from "react";

interface Position {
  x: number;
  y: number;
}

/**
 * Makes a panel draggable by its header/handle.
 * Position starts as null (CSS centering), becomes {x,y} after first drag.
 */
export function useDragPosition() {
  const [position, setPosition] = useState<Position | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const offsetRef = useRef<Position>({ x: 0, y: 0 });
  const rafRef = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const panel = panelRef.current;
    if (!panel || e.button !== 0) return;

    const rect = panel.getBoundingClientRect();
    offsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    draggingRef.current = true;

    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";

    const handleMouseMove = (ev: MouseEvent) => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const panel = panelRef.current;
        if (!panel) return;
        const pw = panel.offsetWidth;
        const ph = panel.offsetHeight;
        const x = Math.max(0, Math.min(ev.clientX - offsetRef.current.x, window.innerWidth - pw));
        const y = Math.max(0, Math.min(ev.clientY - offsetRef.current.y, window.innerHeight - ph));
        setPosition({ x, y });
      });
    };

    const handleMouseUp = () => {
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }, []);

  return { position, onMouseDown, panelRef, isDraggingRef: draggingRef };
}
