/**
 * A6/R16 pin tests — gutter overflow with a reserved "+K" pill cell.
 *
 * `computeMarkerPositions` is a pure function (no DOM): when a node's
 * markers exceed its line-grid capacity, the LAST cell is reserved for the
 * overflow pill and the markers that don't fit come back in an overflow
 * group instead of stacking on the last row.
 */
import { describe, it, expect } from "vitest";
import { computeMarkerPositions } from "@/lib/marginalia-grid";
import {
  MARGINALIA_COLS,
  MARGINALIA_COL_GAP,
  MARGINALIA_GUTTER_WIDTH,
  MARGINALIA_ICON_SIZE,
  MARGINALIA_INNER_PAD,
  type AnchorNodeMetrics,
  type MarginaliaMarker,
} from "@/lib/marginalia";

const LINE_HEIGHT = 24;

function metricsFor(lineCount: number): AnchorNodeMetrics {
  return {
    id: "p1",
    top: 100,
    domTop: 96,
    height: lineCount * LINE_HEIGHT,
    lineHeight: LINE_HEIGHT,
    lineCount,
    isAtom: false,
  };
}

function marker(i: number, side: "left" | "right"): MarginaliaMarker {
  return {
    id: `m${i}:p1`,
    entityId: `m${i}`,
    type: "note",
    textObjectId: "p1",
    side, // explicit side override keeps the test independent of panel docks
  };
}

function expectedY(row: number): number {
  return 100 + row * LINE_HEIGHT + (LINE_HEIGHT - MARGINALIA_ICON_SIZE) / 2;
}

function expectedXRight(col: number): number {
  return MARGINALIA_INNER_PAD + col * (MARGINALIA_ICON_SIZE + MARGINALIA_COL_GAP);
}

function expectedXLeft(col: number): number {
  const iconsWidth =
    MARGINALIA_COLS * MARGINALIA_ICON_SIZE +
    (MARGINALIA_COLS - 1) * MARGINALIA_COL_GAP;
  return (
    MARGINALIA_GUTTER_WIDTH -
    MARGINALIA_INNER_PAD -
    iconsWidth +
    col * (MARGINALIA_ICON_SIZE + MARGINALIA_COL_GAP)
  );
}

describe("computeMarkerPositions overflow (A6/R16)", () => {
  it("1-line paragraph + 4 right markers → 1 visible + pill(+3) in the reserved cell", () => {
    // Right side, 1 line → capacity 2 (two columns). The 2nd cell is
    // reserved for the pill; markers 2-4 hide behind it.
    const markers = [1, 2, 3, 4].map((i) => marker(i, "right"));
    const { positioned, overflowGroups } = computeMarkerPositions(
      (uuid) => (uuid === "p1" ? metricsFor(1) : null),
      markers,
      {},
    );

    expect(positioned.map((m) => m.entityId)).toEqual(["m1"]);
    expect(positioned[0].cell).toEqual({
      col: 0,
      row: 0,
      x: expectedXRight(0),
      y: expectedY(0),
    });

    expect(overflowGroups).toHaveLength(1);
    const g = overflowGroups[0];
    expect(g.side).toBe("right");
    expect(g.textObjectId).toBe("p1");
    expect(g.hidden.map((m) => m.entityId)).toEqual(["m2", "m3", "m4"]);
    // Reserved LAST cell of the 1×2 grid: row 0, col 1.
    expect(g.cell).toEqual({
      col: 1,
      row: 0,
      x: expectedXRight(1),
      y: expectedY(0),
    });
  });

  it("left gutter has 1 effective column: 2-line paragraph + 3 markers → 1 visible + pill(+2)", () => {
    // Left side packs a single column (inner-left slot reserved for the
    // popout button) → capacity = lineCount. 2 lines, 3 markers → cell 0
    // visible, cell 1 (row 1) reserved for the pill.
    const markers = [1, 2, 3].map((i) => marker(i, "left"));
    const { positioned, overflowGroups } = computeMarkerPositions(
      () => metricsFor(2),
      markers,
      {},
    );

    expect(positioned.map((m) => m.entityId)).toEqual(["m1"]);
    expect(positioned[0].cell).toEqual({
      col: 0,
      row: 0,
      x: expectedXLeft(0),
      y: expectedY(0),
    });

    expect(overflowGroups).toHaveLength(1);
    const g = overflowGroups[0];
    expect(g.side).toBe("left");
    expect(g.hidden.map((m) => m.entityId)).toEqual(["m2", "m3"]);
    expect(g.cell).toEqual({
      col: 0,
      row: 1,
      x: expectedXLeft(0),
      y: expectedY(1),
    });
  });

  it("no pill when everything fits exactly (capacity boundary)", () => {
    // 2-line right grid → capacity 4; exactly 4 markers → all positioned,
    // no overflow group, no reserved cell.
    const markers = [1, 2, 3, 4].map((i) => marker(i, "right"));
    const { positioned, overflowGroups } = computeMarkerPositions(
      () => metricsFor(2),
      markers,
      {},
    );

    expect(overflowGroups).toEqual([]);
    expect(positioned.map((m) => m.entityId)).toEqual(["m1", "m2", "m3", "m4"]);
    expect(positioned.map((m) => [m.cell.row, m.cell.col])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]);
  });

  it("unmeasured nodes are skipped entirely (no markers, no pill)", () => {
    const markers = [1, 2, 3].map((i) => marker(i, "right"));
    const { positioned, overflowGroups } = computeMarkerPositions(
      () => null,
      markers,
      {},
    );
    expect(positioned).toEqual([]);
    expect(overflowGroups).toEqual([]);
  });
});
