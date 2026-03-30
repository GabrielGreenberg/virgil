"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { Editor } from "@tiptap/react";

interface Connector {
  id: string;
  d: string;
}

export default function FootnoteConnectors({
  editor,
  selectedId,
  panelSide,
  mainRef,
}: {
  editor: Editor | null;
  selectedId: string | null;
  panelSide: "left" | "right";
  mainRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const rafRef = useRef(0);

  const compute = useCallback(() => {
    const main = mainRef.current;
    if (!editor || !main || !selectedId) {
      setConnectors([]);
      return;
    }

    const cr = main.getBoundingClientRect();

    const editorScrollEl = editor.view.dom.closest(".overflow-y-auto") as HTMLElement | null;
    if (!editorScrollEl) {
      setConnectors([]);
      return;
    }
    const edRect = editorScrollEl.getBoundingClientRect();

    const marginLaneX =
      panelSide === "right"
        ? edRect.right - 28 - cr.left
        : edRect.left + 28 - cr.left;

    const results: Connector[] = [];

    {
      const id = selectedId;
      const markerEl = editor.view.dom.querySelector(
        `[data-footnote-id="${id}"]`
      ) as HTMLElement | null;
      if (!markerEl) { setConnectors([]); return; }

      const entryEl = main.querySelector(
        `[data-footnote-entry="${id}"]`
      ) as HTMLElement | null;
      if (!entryEl) return;

      const mRect = markerEl.getBoundingClientRect();
      const eRect = entryEl.getBoundingClientRect();

      if (eRect.bottom < cr.top || eRect.top > cr.bottom) return;

      const mx = mRect.left + mRect.width / 2 - cr.left;
      const mTop = mRect.top - cr.top;
      const mBottom = mRect.bottom - cr.top;

      const markerAbove = mRect.bottom < cr.top;
      const markerBelow = mRect.top > cr.bottom;
      const mCenter = markerAbove ? 0 : markerBelow ? cr.height : (mTop + mBottom) / 2;

      const ey = eRect.top + 14 - cr.top;
      const ex =
        panelSide === "right"
          ? eRect.left - cr.left
          : eRect.right - cr.left;

      const entryBelow = ey >= mCenter;

      const startX = markerAbove || markerBelow ? marginLaneX : mx;
      const startY = markerAbove ? -2 : markerBelow ? cr.height + 2 : (entryBelow ? mBottom + 1 : mTop - 1);
      const exitDir = entryBelow ? 1 : -1;

      let d: string;

      if (markerAbove || markerBelow) {
        const r3 = 4;
        const hDir = panelSide === "right" ? 1 : -1;
        const entryDist = Math.abs(ex - marginLaneX);
        const vDist = Math.abs(ey - startY);
        const rr = Math.max(0.5, Math.min(r3, vDist * 0.35, entryDist * 0.35));

        d = [
          `M ${marginLaneX} ${startY}`,
          `L ${marginLaneX} ${ey - (ey > startY ? rr : -rr)}`,
          `Q ${marginLaneX} ${ey}, ${marginLaneX + hDir * rr} ${ey}`,
          `L ${ex} ${ey}`,
        ].join(" ");
      } else {
        const turnY = startY + exitDir * 4;
        const r = 4;
        const hDir = panelSide === "right" ? 1 : -1;
        const vDir = ey > turnY ? 1 : -1;

        const hDist = Math.abs(marginLaneX - startX);
        const vDist = Math.abs(ey - turnY);
        const exitDist = Math.abs(turnY - startY);
        const entryDist = Math.abs(ex - marginLaneX);

        const r1 = Math.max(0.5, Math.min(r, exitDist * 0.45, hDist * 0.35));
        const r2 = Math.max(0.5, Math.min(r, hDist * 0.35, vDist * 0.35));
        const r3 = Math.max(0.5, Math.min(r, vDist * 0.35, entryDist * 0.35));

        d = [
          `M ${startX} ${startY}`,
          `L ${startX} ${turnY - exitDir * r1}`,
          `Q ${startX} ${turnY}, ${startX + hDir * r1} ${turnY}`,
          `L ${marginLaneX - hDir * r2} ${turnY}`,
          `Q ${marginLaneX} ${turnY}, ${marginLaneX} ${turnY + vDir * r2}`,
          `L ${marginLaneX} ${ey - vDir * r3}`,
          `Q ${marginLaneX} ${ey}, ${marginLaneX + hDir * r3} ${ey}`,
          `L ${ex} ${ey}`,
        ].join(" ");
      }

      results.push({ id, d });
    }

    setConnectors(results);
  }, [editor, selectedId, panelSide, mainRef]);

  const scheduleCompute = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(compute);
  }, [compute]);

  useEffect(() => {
    compute();

    const main = mainRef.current;
    main?.addEventListener("scroll", scheduleCompute, {
      passive: true,
      capture: true,
    });
    window.addEventListener("resize", scheduleCompute);

    if (editor) {
      editor.on("update", scheduleCompute);
      editor.on("selectionUpdate", scheduleCompute);
    }

    return () => {
      cancelAnimationFrame(rafRef.current);
      main?.removeEventListener("scroll", scheduleCompute, { capture: true });
      window.removeEventListener("resize", scheduleCompute);
      if (editor) {
        editor.off("update", scheduleCompute);
        editor.off("selectionUpdate", scheduleCompute);
      }
    };
  }, [compute, scheduleCompute, editor, mainRef]);

  if (connectors.length === 0) return null;

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 10 }}
      width="100%"
      height="100%"
    >
      {connectors.map((c) => (
        <path
          key={c.id}
          d={c.d}
          stroke="#b45757"
          strokeWidth="1"
          strokeDasharray="3 3"
          fill="none"
          opacity={0.5}
        />
      ))}
    </svg>
  );
}
