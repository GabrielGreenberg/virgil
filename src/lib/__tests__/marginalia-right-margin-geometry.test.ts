/**
 * Right-margin geometry SSOT (backlog #8).
 *
 * Three chrome elements share the editor's right margin — the marginalia
 * marker grid, the selection bolt (⚡), and the overlay scrollbar. They used
 * to be positioned by three independent ad-hoc constants in three coordinate
 * systems, so they overlapped: the rightmost marker column sat under the
 * scrollbar (6px outer-pad < 9px gutter), and the bolt at `textRight + 6`
 * straddled the marker grid's left column.
 *
 * These tests pin the ONE shared lane model so the three never drift:
 *  (a) the marker outer-pad = scrollbar gutter + breathing gap;
 *  (b) the rightmost marker column's right edge clears the scrollbar gutter
 *      (modelled through `computeMarkerPositions`, the real placement fn);
 *  (c) the bolt's x is derived from the lane (anchored OUTBOARD: right edge on
 *      the scrollbar's left edge). A 28px bolt cannot get a sub-band disjoint
 *      from BOTH marker columns AND the scrollbar inside a 70px lane already
 *      holding two 22px columns + the gutter — so the bolt instead clears the
 *      scrollbar AND the LEFT marker column (the user's actual complaint:
 *      single/default markers sit in col0), overlapping only the outboard
 *      right column in the dense-marker case. Pinned through the real
 *      `computeMarkerPositions` so the column x-ranges aren't re-derived.
 *  (d) the per-side min-floor equals the full lane width, and the margin-edit
 *      floor rises to it ONLY when the marker lane is reserved.
 */
import { describe, it, expect } from "vitest";
import {
  SCROLLBAR_THUMB_WIDTH,
  SCROLLBAR_RIGHT_INSET,
  SCROLLBAR_GUTTER,
  MARKER_SCROLLBAR_GAP,
} from "@/components/editor-layout/constants";
import {
  MARGINALIA_INNER_PAD,
  MARGINALIA_OUTER_PAD_RIGHT,
  MARGINALIA_OUTER_PAD_LEFT,
  ICONS_BLOCK_WIDTH,
  MARGINALIA_ICON_SIZE,
  MARGINALIA_MARGIN_WIDTH_RIGHT,
  MARGINALIA_MARGIN_WIDTH_LEFT,
  MARGINALIA_MIN_MARGIN_RIGHT,
  MARGINALIA_MIN_MARGIN_LEFT,
  MARGINALIA_BOLT_LEFT_FROM_TEXT,
  MARGINALIA_BOLT_SIZE,
  type AnchorNodeMetrics,
  type MarginaliaMarker,
} from "@/lib/marginalia";
import { computeMarkerPositions } from "@/lib/marginalia-grid";
import {
  MARGIN_MIN,
  MARGIN_MIN_WITH_MARKERS,
} from "@/hooks/useMarginEdit";

// The bolt's pixel size now lives in the SSOT (SelectionActionsMenu's
// BUTTON_SIZE aliases it), so the test can't drift from the component.
const BOLT_SIZE = MARGINALIA_BOLT_SIZE;

/**
 * Place 2 right-side markers on a 1-line node through the REAL grid fn, then
 * return each marker column's [left, right] x-range as an offset from the
 * text edge. For the RIGHT side `cellAt` packs from the text edge outward:
 * `cell.x = INNER_PAD + col*(ICON_SIZE + COL_GAP)` — i.e. cell.x is already
 * the offset-from-text-edge, the SAME coordinate system the bolt offset
 * (`MARGINALIA_BOLT_LEFT_FROM_TEXT`) lives in. So a column spans
 * `[cell.x, cell.x + ICON_SIZE]` and is directly comparable to the bolt.
 * Sorted left→right so [0] is col0 (the default/single-marker slot).
 */
function rightColumnRangesFromText(): Array<[number, number]> {
  const metrics: AnchorNodeMetrics = {
    id: "p1",
    top: 0,
    domTop: 0,
    height: 24,
    lineHeight: 24,
    lineCount: 1,
    isAtom: false,
  };
  const markers: MarginaliaMarker[] = [0, 1].map((i) => ({
    id: `m${i}:p1`,
    entityId: `m${i}`,
    type: "note" as const,
    textObjectId: "p1",
    side: "right" as const,
  }));
  const { positioned } = computeMarkerPositions(
    (uuid) => (uuid === "p1" ? metrics : null),
    markers,
    {},
  );
  return positioned
    .map((p): [number, number] => [p.cell.x, p.cell.x + MARGINALIA_ICON_SIZE])
    .sort((a, b) => a[0] - b[0]);
}

/** True iff [aL,aR] and [bL,bR] overlap (share any x). */
function rangesIntersect(
  [aL, aR]: [number, number],
  [bL, bR]: [number, number],
): boolean {
  return aL < bR && bL < aR;
}

describe("right-margin geometry SSOT — scrollbar gutter", () => {
  it("SCROLLBAR_GUTTER is the thumb width + its right inset (one SSOT, the old silent 9)", () => {
    expect(SCROLLBAR_GUTTER).toBe(SCROLLBAR_THUMB_WIDTH + SCROLLBAR_RIGHT_INSET);
    expect(SCROLLBAR_GUTTER).toBe(9);
  });
});

describe("right-margin geometry SSOT — marker grid clears the scrollbar", () => {
  it("the right outer-pad = scrollbar gutter + breathing gap (markers clear the scrollbar, not 6 < 9)", () => {
    expect(MARGINALIA_OUTER_PAD_RIGHT).toBe(SCROLLBAR_GUTTER + MARKER_SCROLLBAR_GAP);
    // The old bug: outer-pad 6 < gutter 9 → ~3px overlap. The fix puts it ABOVE.
    expect(MARGINALIA_OUTER_PAD_RIGHT).toBeGreaterThan(SCROLLBAR_GUTTER);
  });

  it("the right margin width recomputes from the new outer-pad", () => {
    expect(MARGINALIA_MARGIN_WIDTH_RIGHT).toBe(
      MARGINALIA_INNER_PAD + ICONS_BLOCK_WIDTH + MARGINALIA_OUTER_PAD_RIGHT,
    );
  });

  it("the rightmost marker column's right edge sits LEFT of the scrollbar gutter by exactly the breathing gap", () => {
    // Model the real placement: a 1-line node, right side, 2 markers → both
    // columns placed. The MarginColumn div is `right:0` width
    // MARGINALIA_MARGIN_WIDTH_RIGHT, so cell.x is measured from the column's
    // left edge = podRight - MARGINALIA_MARGIN_WIDTH_RIGHT.
    const metrics: AnchorNodeMetrics = {
      id: "p1",
      top: 0,
      domTop: 0,
      height: 24,
      lineHeight: 24,
      lineCount: 1,
      isAtom: false,
    };
    const markers: MarginaliaMarker[] = [0, 1].map((i) => ({
      id: `m${i}:p1`,
      entityId: `m${i}`,
      type: "note",
      textObjectId: "p1",
      side: "right",
    }));
    const { positioned } = computeMarkerPositions(
      (uuid) => (uuid === "p1" ? metrics : null),
      markers,
      {},
    );
    // The rightmost icon is the higher-x cell.
    const rightmost = positioned.reduce((a, b) => (b.cell.x > a.cell.x ? b : a));
    const iconRightEdgeFromColumnLeft = rightmost.cell.x + MARGINALIA_ICON_SIZE;

    const podRight = 1000; // arbitrary
    const columnLeft = podRight - MARGINALIA_MARGIN_WIDTH_RIGHT;
    const iconRightEdge = columnLeft + iconRightEdgeFromColumnLeft;
    const scrollbarLeft = podRight - SCROLLBAR_GUTTER;

    // Marker right edge must clear (be ≤) the scrollbar's left edge.
    expect(iconRightEdge).toBeLessThanOrEqual(scrollbarLeft);
    // ...and the clearance is exactly the ratified breathing gap.
    expect(scrollbarLeft - iconRightEdge).toBe(MARKER_SCROLLBAR_GAP);
  });
});

describe("right-margin geometry SSOT — selection bolt joins the lane", () => {
  it("the bolt is anchored OUTBOARD: its left offset is derived from the lane (margin − gutter − bolt size)", () => {
    expect(MARGINALIA_BOLT_LEFT_FROM_TEXT).toBe(
      MARGINALIA_MARGIN_WIDTH_RIGHT - SCROLLBAR_GUTTER - BOLT_SIZE,
    );
    // It is NOT the grid's inner edge anymore (that put a 28px bolt squarely
    // over the 22px left marker column — the user's complaint).
    expect(MARGINALIA_BOLT_LEFT_FROM_TEXT).not.toBe(MARGINALIA_INNER_PAD);
  });

  it("the bolt sits in the margin (not over the prose) and clears the scrollbar exactly", () => {
    const textRight = 0; // measure offsets from the text edge
    const boltLeft = textRight + MARGINALIA_BOLT_LEFT_FROM_TEXT;
    const boltRight = boltLeft + BOLT_SIZE;

    // Left edge is in the margin, off the prose (past the inner pad even).
    expect(boltLeft).toBeGreaterThanOrEqual(textRight + MARGINALIA_INNER_PAD);
    // The bolt clears the scrollbar: its right edge meets the gutter's left
    // edge exactly (outboard anchor). At the min-margin floor the scrollbar's
    // left edge sits at textRight + (MIN_MARGIN_RIGHT − SCROLLBAR_GUTTER).
    const scrollbarLeft =
      textRight + (MARGINALIA_MIN_MARGIN_RIGHT - SCROLLBAR_GUTTER);
    expect(boltRight).toBe(scrollbarLeft);
    expect(boltRight).toBeLessThanOrEqual(scrollbarLeft);
  });

  // THE worst-one test the reviewer flagged as MISSING: the bolt must not
  // paint over the LEFT marker column (the column the default/single marker
  // occupies — the user's literal complaint). Driven through the REAL grid
  // placement fn so the column x-ranges are not hand-derived.
  it("the bolt's x-range does NOT intersect the LEFT marker column (the user's collision)", () => {
    const boltRange: [number, number] = [
      MARGINALIA_BOLT_LEFT_FROM_TEXT,
      MARGINALIA_BOLT_LEFT_FROM_TEXT + BOLT_SIZE,
    ];
    const [leftCol] = rightColumnRangesFromText(); // col0 = leftmost
    // col0 is where a single/default right-side marker lands.
    expect(rangesIntersect(boltRange, leftCol)).toBe(false);
    // ...with a strictly-positive clearance (left of the bolt, not abutting).
    expect(boltRange[0]).toBeGreaterThan(leftCol[1]);
  });

  it("the bolt only ever transiently shares the OUTBOARD (right) marker column — and that's the worst case", () => {
    // Honesty pin: the 70px lane cannot host a 28px bolt disjoint from BOTH
    // columns + the scrollbar, so the bolt DOES overlap the outboard column
    // (occupied only when a line carries ≥2 markers). This documents the
    // accepted, minimized collision so a future edit can't silently regress
    // it back onto the left column without tripping the test above.
    const boltRange: [number, number] = [
      MARGINALIA_BOLT_LEFT_FROM_TEXT,
      MARGINALIA_BOLT_LEFT_FROM_TEXT + BOLT_SIZE,
    ];
    const ranges = rightColumnRangesFromText();
    const rightCol = ranges[ranges.length - 1]; // col1 = outboard
    expect(rangesIntersect(boltRange, rightCol)).toBe(true);
  });

  it("the bolt's left edge no longer straddles the text/grid boundary (the old `textRight + 6` bug)", () => {
    // Old placement dropped the bolt at textRight + 6, landing half on the
    // prose (< INNER_PAD) and squarely on the grid's left column. The derived
    // outboard placement starts well past the inner pad instead.
    const OLD_RIGHT_GAP = 6;
    expect(MARGINALIA_BOLT_LEFT_FROM_TEXT).toBeGreaterThan(OLD_RIGHT_GAP);
    expect(MARGINALIA_BOLT_LEFT_FROM_TEXT).toBeGreaterThan(MARGINALIA_INNER_PAD);
  });
});

describe("right-margin geometry SSOT — min-margin floor (gated on marker visibility)", () => {
  it("the per-side min-floor equals the full lane width", () => {
    expect(MARGINALIA_MIN_MARGIN_RIGHT).toBe(MARGINALIA_MARGIN_WIDTH_RIGHT);
    expect(MARGINALIA_MIN_MARGIN_LEFT).toBe(MARGINALIA_MARGIN_WIDTH_LEFT);
    // Concrete pins so a stray edit to a pad is caught.
    expect(MARGINALIA_MIN_MARGIN_RIGHT).toBe(
      MARGINALIA_INNER_PAD + ICONS_BLOCK_WIDTH + MARGINALIA_OUTER_PAD_RIGHT,
    );
    expect(MARGINALIA_MIN_MARGIN_LEFT).toBe(
      MARGINALIA_INNER_PAD + ICONS_BLOCK_WIDTH + MARGINALIA_OUTER_PAD_LEFT,
    );
  });

  it("the margin-edit horizontal floor RISES to the lane minimum ONLY when the lane is reserved", () => {
    // Reserved (editor, markers on, not zen): horizontal floors are the lane.
    expect(MARGIN_MIN_WITH_MARKERS.right).toBe(MARGINALIA_MIN_MARGIN_RIGHT);
    expect(MARGIN_MIN_WITH_MARKERS.left).toBe(MARGINALIA_MIN_MARGIN_LEFT);
    // Strictly higher than the unreserved base floors (the marker lane is
    // wider than the old loose minimums).
    expect(MARGIN_MIN_WITH_MARKERS.right).toBeGreaterThan(MARGIN_MIN.right);
    expect(MARGIN_MIN_WITH_MARKERS.left).toBeGreaterThanOrEqual(MARGIN_MIN.left);
    // Vertical floors are untouched — markers are a horizontal lane.
    expect(MARGIN_MIN_WITH_MARKERS.top).toBe(MARGIN_MIN.top);
    expect(MARGIN_MIN_WITH_MARKERS.bottom).toBe(MARGIN_MIN.bottom);
  });

  it("the unreserved base floors keep reading-mode freedom (zen / read-only reader)", () => {
    // When markers are hidden, the low base floors apply — the right margin
    // can shrink well below the lane width, so reading modes are not forced
    // into a wide margin.
    expect(MARGIN_MIN.right).toBeLessThan(MARGINALIA_MIN_MARGIN_RIGHT);
  });
});
