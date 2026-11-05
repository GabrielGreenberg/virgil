"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import {
  fitColumns,
  type ReorderableColId,
  type ResizableColId,
} from "@library/lib/list-columns";
import { parkDuringLayoutGesture } from "@/lib/pane-resize/layout-gesture-park";
import { LAYOUT_SITE_LIBRARY_COLUMNS } from "@/lib/layout-gesture-probe";

const sameColumns = (a: readonly ReorderableColId[], b: readonly ReorderableColId[]) =>
  a.length === b.length && a.every((col, i) => col === b[i]);

/**
 * The list's columns that fit its width right now (`fitColumns`). A verdict, not
 * a measurement: state changes only when the SET of columns does, and a pane
 * drag parks the read to its end edge, so a whole resize costs one settle.
 *
 * `reservedPx` is the row's fixed chrome outside the column grid.
 */
export function useFittedColumns(
  rootRef: RefObject<HTMLElement | null>,
  order: readonly ReorderableColId[],
  widths: Record<ResizableColId, number>,
  reservedPx: number,
): readonly ReorderableColId[] {
  const [fitted, setFitted] = useState(order);
  const latest = useRef({ order, widths });
  latest.current = { order, widths };

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const update = () => {
      const measured = el.clientWidth;
      const next = fitColumns(
        latest.current.order,
        latest.current.widths,
        measured > 0 ? measured - reservedPx : 0,
      );
      setFitted((prev) => (sameColumns(prev, next) ? prev : next));
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const park = parkDuringLayoutGesture(update, LAYOUT_SITE_LIBRARY_COLUMNS);
    const ro = new ResizeObserver(() => park.fire());
    ro.observe(el);
    return () => {
      ro.disconnect();
      park.dispose();
    };
  }, [rootRef, order, widths, reservedPx]);

  return fitted;
}
