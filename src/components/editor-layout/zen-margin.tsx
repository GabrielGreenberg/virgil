"use client";

import { useCallback, useRef } from "react";
import { useDragGap } from "@/hooks/useDragGap";
import type { Side } from "@/hooks/useViewPrefs";

/**
 * Empty page margin shown on each side of the editor in Zen mode, in
 * place of the icon strip + panel column that would normally live there.
 * The inner edge (toward the editor) is a drag handle — dragging toward
 * center shrinks the page and grows this margin's preferred size in
 * lockstep, so the edge stays glued to the cursor. The other margin is
 * unaffected. The margin itself flexes to fill whatever window space
 * remains after icons + page + opposite margin.
 */
export function ZenMargin({
  side,
  pageWidth,
  onPageWidthChange,
  marginPref,
  onMarginPrefChange,
}: {
  side: Side;
  pageWidth: number;
  onPageWidthChange: (w: number) => void;
  marginPref: number;
  onMarginPrefChange: (w: number) => void;
}) {
  const startX = useRef(0);
  const startPage = useRef(0);
  const startMargin = useRef(0);

  const onMove = useCallback(
    (e: MouseEvent) => {
      const delta = side === "right"
        ? startX.current - e.clientX
        : e.clientX - startX.current;
      onPageWidthChange(startPage.current - delta);
      onMarginPrefChange(Math.max(0, startMargin.current + delta));
    },
    [side, onPageWidthChange, onMarginPrefChange],
  );

  const { gapRef, onMouseDown: gapMouseDown } = useDragGap({
    cursor: "col-resize",
    onMove,
    deadzone: 3,
  });

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      startX.current = e.clientX;
      startPage.current = pageWidth;
      startMargin.current = marginPref;
      gapMouseDown(e);
    },
    [pageWidth, marginPref, gapMouseDown],
  );

  return (
    <div className="relative flex" style={{ flex: `1 100 ${marginPref}px`, minWidth: 'var(--zen-margin-min)', paddingTop: 'var(--pod-gap)', paddingBottom: 'var(--pod-gap)', paddingLeft: 4, paddingRight: 4 }}>
      <div className={`flex-1 min-w-0 ${side === "left" ? "order-1" : "order-2"}`} />
      <div
        ref={gapRef}
        className={`drag-gap drag-gap-v shrink-0 ${side === "left" ? "order-2 drag-gap-toward-editor-right" : "order-1 drag-gap-toward-editor-left"}`}
        style={{ width: 'var(--pod-gap)' }}
        onMouseDown={onMouseDown}
      />
    </div>
  );
}
