/**
 * Task 1334 — a span-anchored marker sits on its span's LINE, not on its
 * paragraph's row 0. `computeMarkerPositions` asks the caller's `lineOf` (the
 * grid stays DOM-free) for every marker carrying an `anchorId`; a marker
 * without one keeps row 0, and an out-of-range answer is clamped into the node.
 */
import { describe, it, expect } from "vitest";
import { computeMarkerPositions } from "@/lib/marginalia-grid";
import {
  MARGINALIA_ICON_SIZE,
  marginaliaEffectiveCols,
  type AnchorNodeMetrics,
  type MarginaliaMarker,
} from "@/lib/marginalia";

const COLS = {
  left: marginaliaEffectiveCols("left"),
  right: marginaliaEffectiveCols("right"),
} as const;
const LH = 30;
const P: AnchorNodeMetrics = {
  id: "P",
  top: 100,
  domTop: 100,
  height: 6 * LH,
  lineHeight: LH,
  lineCount: 6,
  isAtom: false,
};
const get = (uuid: string) => (uuid === "P" ? P : null);
const rowY = (row: number) => P.top + row * LH + (LH - MARGINALIA_ICON_SIZE) / 2;

function marker(id: string, anchorId?: string): MarginaliaMarker {
  return {
    id: `${id}:P`,
    entityId: id,
    entityKind: "note",
    type: "note",
    textObjectId: "P",
    side: "right",
    ...(anchorId ? { anchorId } : {}),
  };
}

const LINES: Record<string, number> = { A3: 3, A99: 99 };
const lineOf = (m: MarginaliaMarker) => (m.anchorId ? LINES[m.anchorId] ?? null : null);

describe("span-anchored markers follow their span's line (task 1334)", () => {
  it("a span marker sits on its line; a whole-paragraph marker on row 0", () => {
    const { positioned } = computeMarkerPositions(
      get,
      [marker("whole"), marker("span", "A3")],
      {},
      COLS,
      lineOf,
    );
    const whole = positioned.find((p) => p.entityId === "whole")!;
    const span = positioned.find((p) => p.entityId === "span")!;
    expect(whole.cell.row).toBe(0);
    expect(whole.cell.y).toBe(rowY(0));
    expect(span.cell.row).toBe(3);
    expect(span.cell.y).toBe(rowY(3));
  });

  it("without a lineOf reader every marker keeps row 0 (pre-1334 behaviour)", () => {
    const { positioned } = computeMarkerPositions(get, [marker("span", "A3")], {}, COLS);
    expect(positioned[0].cell.row).toBe(0);
    expect(positioned[0].cell.y).toBe(rowY(0));
  });

  it("an out-of-range line is clamped to the node's last line", () => {
    const { positioned } = computeMarkerPositions(get, [marker("far", "A99")], {}, COLS, lineOf);
    expect(positioned[0].cell.row).toBe(P.lineCount - 1);
    expect(positioned[0].cell.y).toBe(rowY(P.lineCount - 1));
  });

  it("span groups pack with the paragraph's row-0 grid — nothing overprints", () => {
    const markers = [
      ...Array.from({ length: 6 }, (_, i) => marker(`w${i}`)),
      marker("s1", "A3"),
      marker("s2", "A3"),
    ];
    const { positioned, overflowGroups } = computeMarkerPositions(get, markers, {}, COLS, lineOf);
    const boxes = [
      ...positioned.map((p) => ({ x: p.cell.x, y: p.cell.y })),
      ...overflowGroups.map((g) => ({ x: g.cell.x, y: g.cell.y })),
    ];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const same = boxes[i].x === boxes[j].x && Math.abs(boxes[i].y - boxes[j].y) < MARGINALIA_ICON_SIZE;
        expect(same).toBe(false);
      }
    }
    // Every marker is accounted for exactly once.
    const hidden = overflowGroups.flatMap((g) => g.hidden);
    expect(positioned.length + hidden.length).toBe(markers.length);
  });
});
