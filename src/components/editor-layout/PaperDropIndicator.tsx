"use client";

import { clampIndicatorX } from "@/components/chrome/tab-strip-occupancy";

/** The indicator's own width — the accent line is 2px. */
const INDICATOR_W = 2;

/**
 * Vertical line marking the insertion point during a paper-tab drag
 * onto the Virgil bar. Mirrors the inner library strip's drop indicator
 * shape (2px `--insertion-bar` line) but positioned inside the outer tab strip.
 *
 * It is a child of the strip's NON-scrolling root (`position: relative`), not
 * of the scroller: an absolutely-positioned child of a scroll container
 * scrolls with the content, and this line is placed from live VIEWPORT rects,
 * which already account for `scrollLeft`. So it stays correct at any scroll
 * position with no correction — and because the root does not clip, a drop
 * aimed past the scrolled-out boundary still paints a bar, CLAMPED to the
 * scroller's visible span (`clampIndicatorX`), instead of an indicator nobody
 * can see (the second half of task 395's stated residual, closed by 561).
 */
export function PaperDropIndicator({
  stripEl,
  scrollerEl,
  tabRefs,
  order,
  index,
}: {
  stripEl: HTMLDivElement | null;
  /** The strip's scroller box — the visible span the line is clamped into. */
  scrollerEl: HTMLElement | null;
  tabRefs: Map<string, HTMLElement>;
  order: string[];
  index: number;
}) {
  if (!stripEl) return null;
  const stripRect = stripEl.getBoundingClientRect();
  let x: number;
  if (order.length === 0) {
    x = 4;
  } else if (index <= 0) {
    const first = tabRefs.get(order[0]);
    x = first ? first.getBoundingClientRect().left - stripRect.left - 1 : 4;
  } else if (index >= order.length) {
    const last = tabRefs.get(order[order.length - 1]);
    x = last ? last.getBoundingClientRect().right - stripRect.left + 1 : 4;
  } else {
    const left = tabRefs.get(order[index - 1]);
    const right = tabRefs.get(order[index]);
    if (left && right) {
      const lr = left.getBoundingClientRect();
      const rr = right.getBoundingClientRect();
      x = (lr.right + rr.left) / 2 - stripRect.left - 1;
    } else {
      x = 4;
    }
  }
  x = clampIndicatorX(x, scrollerEl, stripRect.left, INDICATOR_W);
  return (
    <div
      data-paper-drop-indicator=""
      style={{
        position: "absolute",
        top: 4,
        bottom: 0,
        left: x,
        width: INDICATOR_W,
        background: "var(--insertion-bar)",
        borderRadius: 1,
        pointerEvents: "none",
        zIndex: 30,
      }}
    />
  );
}
