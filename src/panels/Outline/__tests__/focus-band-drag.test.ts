import { describe, it, expect, vi } from "vitest";

// `useFocusMode` (for `regionForNode`, the commit side of the one row→range
// rule) transitively imports `@/lib/storage`, whose backend select vitest's
// aliaser can't resolve (the storage-mock gotcha). Nothing here touches it.
vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(async () => ({})),
  readSidecarIfExists: vi.fn(async () => ({})),
  writeSidecar: vi.fn(async () => undefined),
  readBib: vi.fn(async () => ({ bibText: "", detectedPackage: undefined })),
  mutateBib: vi.fn(async () => null),
}));
import { paintedBandRows, resolveDragCommit } from "../focus-band-drag";
import { regionForNode } from "@/hooks/useFocusMode";

/**
 * Task 113 — the FocusBand mouseup commit decision. The baseline is the
 * dragged edge's OWN row; comparing against the FIXED (opposite) edge silently
 * dropped the standard shrink gesture and let a return-to-origin drag commit a
 * no-op.
 *
 * Task 285 — the MOVED test still compares snapshot indices (both sides come
 * from the outline's own snapshot, so they share one revision), but what the
 * commit CARRIES is the row's durable `BlockAddress`.
 *
 * Task 1530 — the baseline is the row the edge was PAINTED on
 * (`paintedBandRows`), not the committed block index: a section's end is a
 * BODY block with no row, so comparing a row against it read a release on the
 * handle's own row as a move.
 */

/** Section `h-10` over blocks [10, 30]: rows h-10, pt-12, h-20, pt-25 (and a
 *  following section h-31 with pt-33), 40 blocks in all. */
const HEADINGS = [
  { index: 10, level: 1 },
  { index: 20, level: 2 },
  { index: 31, level: 1 },
];
const TITLED = [12, 25, 33];
const TOTAL = 40;
const ROWS = [0, 10, 12, 20, 25, 31, 33].map((index) => ({ index, uuid: `u${index}` }));
const BAND = { startBlockIndex: 10, endBlockIndex: 30 };

function paintedIndex(edge: "top" | "bottom", range = BAND): number | null {
  const p = paintedBandRows(ROWS, range.startBlockIndex, range.endBlockIndex);
  if (!p) return null;
  return ROWS[edge === "top" ? p.first : p.last].index;
}

describe("paintedBandRows — the band's one paint rule", () => {
  it("paints the bottom edge on the row that OWNS a body-block end", () => {
    expect(paintedIndex("bottom")).toBe(25);
    expect(paintedIndex("top")).toBe(10);
  });

  it("returns null when no rendered row is inside the range", () => {
    expect(paintedBandRows(ROWS, 26, 30)).toBeNull();
  });
});

describe("resolveDragCommit", () => {
  it("a press-and-release on the row the bottom handle is painted on writes nothing (the 1530 bug)", () => {
    // Band end = 30 (a body block), painted on pt-25. The old baseline compared
    // 25 against 30 and committed.
    expect(
      resolveDragCommit({ pending: { uuid: "u25", index: 25 }, paintedIndex: paintedIndex("bottom") }),
    ).toEqual({ commit: false });
  });

  it("commits a bottom-edge shrink onto the band's own start row (task 113)", () => {
    expect(
      resolveDragCommit({ pending: { uuid: "u10", index: 10 }, paintedIndex: paintedIndex("bottom") }),
    ).toEqual({ commit: true, target: { uuid: "u10", index: 10 } });
  });

  it("commits a top-edge shrink onto the band's bottom row (symmetric)", () => {
    expect(
      resolveDragCommit({ pending: { uuid: "u25", index: 25 }, paintedIndex: paintedIndex("top") }),
    ).toEqual({ commit: true, target: { uuid: "u25", index: 25 } });
  });

  it("skips a top-edge drag that lands back on its own row", () => {
    expect(
      resolveDragCommit({ pending: { uuid: "u10", index: 10 }, paintedIndex: paintedIndex("top") }),
    ).toEqual({ commit: false });
  });

  it("skips when no mousemove ran (plain click on the handle)", () => {
    expect(resolveDragCommit({ pending: null, paintedIndex: 25 })).toEqual({ commit: false });
    expect(resolveDragCommit({ pending: null, paintedIndex: null })).toEqual({ commit: false });
  });

  it("commits a move to a third row with that row's address", () => {
    expect(
      resolveDragCommit({ pending: { uuid: "u33", index: 33 }, paintedIndex: paintedIndex("bottom") }),
    ).toEqual({ commit: true, target: { uuid: "u33", index: 33 } });
  });
});

describe("paint and commit agree (task 1530 — one row→range rule)", () => {
  it("a bottom drop on a par-title row commits an end its trailing untitled blocks are inside", () => {
    // Drag the bottom edge up from pt-33 onto pt-25: the region END is 30 —
    // blocks 26–30 (untitled, row-less) stay in the band.
    const [, end] = regionForNode(25, HEADINGS, TOTAL, TITLED);
    expect(end).toBe(30);
  });

  it("for EVERY row, the committed bottom end is painted back on that same row", () => {
    for (const row of ROWS) {
      const [, end] = regionForNode(row.index, HEADINGS, TOTAL, TITLED);
      const p = paintedBandRows(ROWS, 0, end);
      const painted = p ? ROWS[p.last].index : null;
      // A heading's end is its section's end, painted on the section's last
      // row (its subtree is inside the band); every other row paints itself.
      const isHeading = HEADINGS.some((h) => h.index === row.index);
      if (isHeading) {
        const lastInSection = ROWS.filter((r) => r.index >= row.index && r.index <= end).at(-1)!;
        expect(painted).toBe(lastInSection.index);
      } else {
        expect(painted).toBe(row.index);
      }
    }
  });
});
