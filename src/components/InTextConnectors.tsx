"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { Editor } from "@tiptap/react";

interface LineSegment {
  id: string;
  d: string; // SVG path
}

/**
 * Draws a connector line between an editor marker and its
 * corresponding panel entry in "in-text" (page) view.
 *
 * Only draws for the selected citation.
 *
 * Geometry: horizontal line from panel entry across to the marker's X,
 * then a small vertical jog up/down to connect to the marker.
 */
export default function InTextConnectors({
  editor,
  selectedId,
  panelSide,
  mainRef,
  markerAttr,
  entryAttr,
}: {
  editor: Editor | null;
  selectedId: string | null;
  panelSide: "left" | "right";
  mainRef: React.RefObject<HTMLDivElement | null>;
  markerAttr: string;
  entryAttr: string;
}) {
  const [segments, setSegments] = useState<LineSegment[]>([]);
  const rafRef = useRef(0);

  const compute = useCallback(() => {
    const main = mainRef.current;
    if (!editor?.view?.dom || !main || !selectedId) {
      setSegments([]);
      return;
    }

    const cr = main.getBoundingClientRect();
    const editorScrollEl = editor.view.dom.closest(".overflow-y-auto") as HTMLElement | null;
    if (!editorScrollEl) { setSegments([]); return; }
    const edRect = editorScrollEl.getBoundingClientRect();

    const marker = editor.view.dom.querySelector(`[${markerAttr}="${selectedId}"]`) as HTMLElement | null;
    if (!marker) { setSegments([]); return; }

    const mRect = marker.getBoundingClientRect();
    // Skip if marker outside editor viewport
    if (mRect.bottom < edRect.top || mRect.top > edRect.bottom) { setSegments([]); return; }

    const entry = main.querySelector(`[${entryAttr}="${selectedId}"]`) as HTMLElement | null;
    if (!entry) { setSegments([]); return; }
    if (getComputedStyle(entry).position !== "absolute") { setSegments([]); return; }
    const eRect = entry.getBoundingClientRect();

    const markerY = (mRect.top + mRect.bottom) / 2 - cr.top;
    const entryVisible = eRect.top >= cr.top - 100 && eRect.bottom <= cr.bottom + 100;
    const entryY = entryVisible ? eRect.top + 12 - cr.top : markerY;

    let entryX: number;
    const markerX = (mRect.left + mRect.right) / 2 - cr.left;

    if (panelSide === "right") {
      entryX = eRect.left - cr.left - 2;
    } else {
      entryX = eRect.right - cr.left + 2;
    }

    const yDiff = markerY - entryY;
    const needsJog = Math.abs(yDiff) > 1;

    let d: string;
    if (needsJog) {
      d = `M ${entryX} ${entryY} L ${markerX} ${entryY} L ${markerX} ${markerY}`;
    } else {
      d = `M ${entryX} ${entryY} L ${markerX} ${markerY}`;
    }

    setSegments([{ id: selectedId, d }]);
  }, [editor, selectedId, mainRef, panelSide, markerAttr, entryAttr]);

  const scheduleCompute = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(compute);
  }, [compute]);

  useEffect(() => {
    compute();
    if (!editor?.view?.dom) return;

    editor.on("update", scheduleCompute);
    editor.on("selectionUpdate", scheduleCompute);

    const scrollEl = editor.view.dom.closest(".overflow-y-auto");
    scrollEl?.addEventListener("scroll", scheduleCompute, { passive: true });
    window.addEventListener("resize", scheduleCompute);

    const allScrollEls = mainRef.current?.querySelectorAll(".overflow-y-auto") || [];
    allScrollEls.forEach((el) => {
      if (el !== scrollEl) el.addEventListener("scroll", scheduleCompute, { passive: true });
    });

    return () => {
      cancelAnimationFrame(rafRef.current);
      editor.off("update", scheduleCompute);
      editor.off("selectionUpdate", scheduleCompute);
      scrollEl?.removeEventListener("scroll", scheduleCompute);
      window.removeEventListener("resize", scheduleCompute);
      allScrollEls.forEach((el) => {
        if (el !== scrollEl) el.removeEventListener("scroll", scheduleCompute);
      });
    };
  }, [editor, compute, scheduleCompute]);

  if (segments.length === 0) return null;

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 10 }}
      width="100%"
      height="100%"
    >
      {segments.map((seg) => (
        <path
          key={seg.id}
          d={seg.d}
          stroke="#b8912e"
          strokeWidth="1.5"
          strokeDasharray="4 3"
          fill="none"
          opacity={0.6}
        />
      ))}
    </svg>
  );
}
