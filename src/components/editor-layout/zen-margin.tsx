"use client";

import { useCallback, useRef } from "react";
import { useDragGap } from "@/hooks/useDragGap";
import type { Side } from "@/hooks/useViewPrefs";

/**
 * Empty page margin shown on each side of the editor in Zen mode, in
 * place of the icon strip + panel column that would normally live there.
 * The inner edge (toward the editor) is a drag handle that adjusts the
 * margin width. Width is shared with the panel column width so the
 * mental model stays simple: "the margin is where the panel is."
 */
export function ZenMargin({
  side,
  width,
  onWidthChange,
}: {
  side: Side;
  width: number;
  onWidthChange: (w: number) => void;
}) {
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onMove = useCallback(
    (e: MouseEvent) => {
      const delta = side === "right"
        ? startX.current - e.clientX
        : e.clientX - startX.current;
      onWidthChange(Math.max(20, Math.min(1200, startWidth.current + delta)));
    },
    [side, onWidthChange],
  );

  const { gapRef, onMouseDown: gapMouseDown } = useDragGap({
    cursor: "col-resize",
    onMove,
    deadzone: 3,
  });

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      startX.current = e.clientX;
      startWidth.current = width;
      gapMouseDown(e);
    },
    [width, gapMouseDown],
  );

  return (
    <div className="relative flex shrink-0" style={{ width, paddingTop: 'var(--pod-gap)', paddingBottom: 'var(--pod-gap)', paddingLeft: 4, paddingRight: 4 }}>
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
