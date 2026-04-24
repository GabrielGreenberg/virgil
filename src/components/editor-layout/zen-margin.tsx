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
  marginPref,
  onMarginPrefChange,
  isResizing,
  onResizingChange,
  onSyncBeforeDrag,
}: {
  side: Side;
  marginPref: number;
  onMarginPrefChange: (w: number) => void;
  isResizing?: boolean;
  onResizingChange?: (r: boolean) => void;
  onSyncBeforeDrag?: () => void;
}) {
  const startX = useRef(0);
  const startMargin = useRef(0);

  const onMove = useCallback(
    (e: MouseEvent) => {
      const delta = side === "right"
        ? startX.current - e.clientX
        : e.clientX - startX.current;
      const marginMin = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--zen-margin-min'),
      ) || 0;
      let requested = Math.max(marginMin, startMargin.current + delta);
      const col = gapRef.current?.parentElement;
      const main = col?.parentElement;
      if (main) {
        const editor = main.querySelector('[data-editor-col]') as HTMLElement | null;
        const editorMin = editor ? (parseFloat(getComputedStyle(editor).minWidth) || 0) : 0;
        let reserved = editorMin;
        for (const child of Array.from(main.children)) {
          if (child !== col && child !== editor) {
            const el = child as HTMLElement;
            const basis = parseFloat(getComputedStyle(el).flexBasis);
            reserved += Number.isFinite(basis) ? basis : el.getBoundingClientRect().width;
          }
        }
        const maxMargin = Math.max(0, main.clientWidth - reserved);
        requested = Math.min(requested, maxMargin);
      }
      onMarginPrefChange(requested);
    },
    [side, onMarginPrefChange],
  );

  const { gapRef, onMouseDown: gapMouseDown } = useDragGap({
    cursor: "col-resize",
    onMove,
    deadzone: 3,
  });

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      startX.current = e.clientX;
      onSyncBeforeDrag?.();
      const col = gapRef.current?.parentElement;
      const rendered = col ? col.getBoundingClientRect().width : marginPref;
      startMargin.current = rendered;
      onResizingChange?.(true);
      const onUp = () => {
        onResizingChange?.(false);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mouseup", onUp);
      gapMouseDown(e);
    },
    [marginPref, gapMouseDown, onResizingChange, onSyncBeforeDrag],
  );

  return (
    <div data-flex-col={side} className="relative flex" style={{ flex: isResizing ? `0 0 ${marginPref}px` : `1 100 ${marginPref}px`, minWidth: isResizing ? 0 : 'var(--zen-margin-min)', paddingTop: 'var(--pod-gap)', paddingBottom: 'var(--pod-gap)', paddingLeft: 4, paddingRight: 4 }}>
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
