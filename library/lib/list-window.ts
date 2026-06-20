// Fixed-height list windowing (chip C7).
//
// The catalog list rows are a FIXED height (LeftListRow: minHeight 28 + 1px
// border ≈ ROW_HEIGHT), so we virtualize with a tiny pure function instead of
// pulling in a dependency: render only the slice of rows intersecting the
// viewport (plus an overscan margin), inside a spacer of the full height so
// the scrollbar — and the existing raw-`scrollTop` save/restore — stay exact.
// Keystroke-sanctity: per scroll frame the list re-renders only ~viewport
// rows, never all N.

/** Measured height of one catalog row. LeftListRow is `minHeight: 28` with a
 *  1px bottom border and fixed line-height; every cell is `whiteSpace:nowrap`
 *  + ellipsis so a row can never grow. Verified against the live row. */
export const ROW_HEIGHT = 29;

/** Rows rendered beyond the viewport on each edge, so a fast scroll / wheel
 *  fling doesn't flash blank rows before the next frame lands. */
export const ROW_OVERSCAN = 8;

export interface ListWindow {
  /** First row index to render (inclusive). */
  startIndex: number;
  /** Last row index to render (EXCLUSIVE). */
  endIndex: number;
  /** Top spacer height in px (= startIndex * rowHeight). */
  padTop: number;
  /** Bottom spacer height in px (= (count - endIndex) * rowHeight). */
  padBottom: number;
  /** Full scroll height in px (= count * rowHeight) — drives the scrollbar. */
  totalHeight: number;
}

/**
 * Compute which row indices intersect the viewport. Pure + deterministic so
 * it can be unit-tested without a DOM. All inputs in px; `count` is the total
 * row count.
 */
export function computeListWindow(opts: {
  scrollTop: number;
  viewportHeight: number;
  rowHeight?: number;
  count: number;
  overscan?: number;
}): ListWindow {
  const rowHeight = opts.rowHeight ?? ROW_HEIGHT;
  const overscan = opts.overscan ?? ROW_OVERSCAN;
  const count = Math.max(0, Math.floor(opts.count));

  if (count === 0 || rowHeight <= 0) {
    return { startIndex: 0, endIndex: 0, padTop: 0, padBottom: 0, totalHeight: 0 };
  }

  const totalHeight = count * rowHeight;
  const scrollTop = Math.min(Math.max(0, opts.scrollTop), totalHeight);
  const viewportHeight = Math.max(0, opts.viewportHeight);

  const rawStart = Math.floor(scrollTop / rowHeight);
  const rawEnd = Math.ceil((scrollTop + viewportHeight) / rowHeight);

  const startIndex = Math.max(0, rawStart - overscan);
  const endIndex = Math.min(count, rawEnd + overscan);

  return {
    startIndex,
    endIndex,
    padTop: startIndex * rowHeight,
    padBottom: (count - endIndex) * rowHeight,
    totalHeight,
  };
}
