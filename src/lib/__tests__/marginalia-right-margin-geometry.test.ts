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
 *  (a) the marker outer-pad reserves the bolt band + the scrollbar gutter;
 *  (b) the rightmost marker column's right edge clears the scrollbar gutter
 *      (modelled through `computeMarkerPositions`, the real placement fn);
 *  (c) the bolt gets its OWN dedicated band just outboard of the marker grid
 *      (the lane was widened to make room), so the bolt is FULLY DISJOINT from
 *      BOTH marker columns AND the scrollbar. The disjointness is asserted
 *      against the column x-ranges from the REAL `computeMarkerPositions` (so
 *      they aren't hand-derived) and against the scrollbar band at the minimum
 *      lane (the tight case — the gap only grows for wider margins). The test
 *      FAILS if anyone shrinks the lane back under the disjoint minimum.
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
  MARGINALIA_BOLT_MARKER_GAP,
  MARGINALIA_BOLT_SCROLLBAR_GAP,
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
  it("the right outer-pad reserves the bolt band + the scrollbar gutter (outboard of the markers)", () => {
    // The outer-pad now seats THREE elements outboard of the marker grid:
    //   [BOLT_MARKER_GAP] [BOLT] [BOLT_SCROLLBAR_GAP] [SCROLLBAR_GUTTER]
    expect(MARGINALIA_OUTER_PAD_RIGHT).toBe(
      MARGINALIA_BOLT_MARKER_GAP +
        MARGINALIA_BOLT_SIZE +
        MARGINALIA_BOLT_SCROLLBAR_GAP +
        SCROLLBAR_GUTTER,
    );
    // Concrete pin: 6 + 28 + 3 + 9 = 46.
    expect(MARGINALIA_OUTER_PAD_RIGHT).toBe(46);
    // It still clears the scrollbar (the old 6 < 9 bug stays fixed) — and now
    // also clears the whole bolt band.
    expect(MARGINALIA_OUTER_PAD_RIGHT).toBeGreaterThan(SCROLLBAR_GUTTER);
    // The reused gap consts are the ratified inter-column / marker-scrollbar
    // gaps, so the bolt band reads consistently with the grid.
    expect(MARGINALIA_BOLT_MARKER_GAP).toBe(6);
    expect(MARGINALIA_BOLT_SCROLLBAR_GAP).toBe(MARKER_SCROLLBAR_GAP);
  });

  it("the right margin width recomputes from the new outer-pad", () => {
    expect(MARGINALIA_MARGIN_WIDTH_RIGHT).toBe(
      MARGINALIA_INNER_PAD + ICONS_BLOCK_WIDTH + MARGINALIA_OUTER_PAD_RIGHT,
    );
  });

  it("the rightmost marker column's right edge sits LEFT of the scrollbar gutter, clearing the whole bolt band", () => {
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
    // ...and the clearance now spans the whole bolt band that sits between the
    // marker grid and the scrollbar: BOLT_MARKER_GAP + BOLT + BOLT_SCROLLBAR_GAP.
    expect(scrollbarLeft - iconRightEdge).toBe(
      MARGINALIA_BOLT_MARKER_GAP +
        MARGINALIA_BOLT_SIZE +
        MARGINALIA_BOLT_SCROLLBAR_GAP,
    );
  });
});

describe("right-margin geometry SSOT — selection bolt joins the lane", () => {
  it("the bolt sits in its OWN band just outboard of the marker grid (INNER_PAD + ICONS_BLOCK_WIDTH + BOLT_MARKER_GAP)", () => {
    expect(MARGINALIA_BOLT_LEFT_FROM_TEXT).toBe(
      MARGINALIA_INNER_PAD + ICONS_BLOCK_WIDTH + MARGINALIA_BOLT_MARKER_GAP,
    );
    // Concrete pin: 8 + 50 + 6 = 64 → band [64…92].
    expect(MARGINALIA_BOLT_LEFT_FROM_TEXT).toBe(64);
    // It is NOT the grid's inner edge (that put a 28px bolt squarely over the
    // 22px left marker column — the user's complaint).
    expect(MARGINALIA_BOLT_LEFT_FROM_TEXT).not.toBe(MARGINALIA_INNER_PAD);
  });

  it("the bolt sits in the margin (not over the prose) and clears the scrollbar at the minimum lane", () => {
    const textRight = 0; // measure offsets from the text edge
    const boltLeft = textRight + MARGINALIA_BOLT_LEFT_FROM_TEXT;
    const boltRight = boltLeft + BOLT_SIZE;

    // Left edge is in the margin, off the prose (past the marker grid even).
    expect(boltLeft).toBeGreaterThanOrEqual(textRight + MARGINALIA_INNER_PAD);
    // The bolt clears the scrollbar with a strictly-positive gap. The bolt is
    // FIXED-from-text; the scrollbar tracks the pod's right edge, so the
    // tightest case is the MINIMUM lane (where the pod edge is closest to the
    // text). Its right edge (92) sits a BOLT_SCROLLBAR_GAP (3) left of the
    // scrollbar's left edge (95).
    const scrollbarLeft =
      textRight + (MARGINALIA_MIN_MARGIN_RIGHT - SCROLLBAR_GUTTER);
    expect(boltRight).toBeLessThan(scrollbarLeft);
    expect(scrollbarLeft - boltRight).toBe(MARGINALIA_BOLT_SCROLLBAR_GAP);
    // Concrete pins for the band and the scrollbar at the min lane.
    expect(boltRight).toBe(92);
    expect(scrollbarLeft).toBe(95);
  });

  // THE original complaint: the bolt must not paint over the LEFT marker
  // column (the column the default/single marker occupies). Driven through the
  // REAL grid placement fn so the column x-ranges are not hand-derived.
  it("the bolt's x-range does NOT intersect the LEFT marker column (col0 — the user's collision)", () => {
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

  // NEW (the widened-lane invariant the prior test pair LACKED): the bolt band
  // is now disjoint from BOTH marker columns AND the scrollbar. These pins
  // FAIL the moment anyone shrinks the lane back under the disjoint minimum.
  it("the bolt's x-range does NOT intersect the OUTBOARD (right) marker column (col1) — the widened-lane fix", () => {
    const boltRange: [number, number] = [
      MARGINALIA_BOLT_LEFT_FROM_TEXT,
      MARGINALIA_BOLT_LEFT_FROM_TEXT + BOLT_SIZE,
    ];
    const ranges = rightColumnRangesFromText();
    const rightCol = ranges[ranges.length - 1]; // col1 = outboard
    // Previously the bolt OVERLAPPED this column (the accepted-collision bug).
    // The lane was widened so it no longer does.
    expect(rangesIntersect(boltRange, rightCol)).toBe(false);
    // ...with a strictly-positive clearance: the bolt is to the RIGHT of col1.
    expect(boltRange[0]).toBeGreaterThan(rightCol[1]);
    // The gap is exactly the ratified BOLT_MARKER_GAP.
    expect(boltRange[0] - rightCol[1]).toBe(MARGINALIA_BOLT_MARKER_GAP);
  });

  it("the bolt's x-range does NOT intersect the scrollbar band (computed from the SSOT, at the minimum lane)", () => {
    const boltRange: [number, number] = [
      MARGINALIA_BOLT_LEFT_FROM_TEXT,
      MARGINALIA_BOLT_LEFT_FROM_TEXT + BOLT_SIZE,
    ];
    // Scrollbar band at the minimum lane, in text-edge offsets: it occupies
    // the outer SCROLLBAR_GUTTER of the lane → [MIN − GUTTER, MIN].
    const scrollbarBand: [number, number] = [
      MARGINALIA_MIN_MARGIN_RIGHT - SCROLLBAR_GUTTER,
      MARGINALIA_MIN_MARGIN_RIGHT,
    ];
    expect(rangesIntersect(boltRange, scrollbarBand)).toBe(false);
    // ...with a strictly-positive clearance: the bolt is to the LEFT of the bar.
    expect(boltRange[1]).toBeLessThan(scrollbarBand[0]);
    expect(scrollbarBand[0] - boltRange[1]).toBe(MARGINALIA_BOLT_SCROLLBAR_GAP);
  });

  it("the three outboard elements tile the lane with no overlap: col1 < bolt < scrollbar, all disjoint", () => {
    // One assertion that the entire outboard run is monotone + disjoint, so a
    // future pad/gap edit can't quietly re-introduce ANY pairwise overlap.
    const ranges = rightColumnRangesFromText();
    const col0 = ranges[0];
    const col1 = ranges[ranges.length - 1];
    const boltRange: [number, number] = [
      MARGINALIA_BOLT_LEFT_FROM_TEXT,
      MARGINALIA_BOLT_LEFT_FROM_TEXT + BOLT_SIZE,
    ];
    const scrollbarBand: [number, number] = [
      MARGINALIA_MIN_MARGIN_RIGHT - SCROLLBAR_GUTTER,
      MARGINALIA_MIN_MARGIN_RIGHT,
    ];
    // Strictly increasing left-to-right with no shared x anywhere.
    expect(col0[1]).toBeLessThanOrEqual(col1[0]); // col0 ≤ col1 (gap between)
    expect(col1[1]).toBeLessThan(boltRange[0]); // col1 < bolt
    expect(boltRange[1]).toBeLessThan(scrollbarBand[0]); // bolt < scrollbar
    // Concrete band pins (col0 8…30, col1 36…58, bolt 64…92, scrollbar 95…104).
    expect(col0).toEqual([8, 30]);
    expect(col1).toEqual([36, 58]);
    expect(boltRange).toEqual([64, 92]);
    expect(scrollbarBand).toEqual([95, 104]);
  });

  it("the bolt's left edge no longer straddles the text/grid boundary (the old `textRight + 6` bug)", () => {
    // Old placement dropped the bolt at textRight + 6, landing half on the
    // prose (< INNER_PAD) and squarely on the grid's left column. The derived
    // band placement starts well past the marker grid instead.
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
