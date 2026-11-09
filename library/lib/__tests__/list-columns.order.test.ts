import { describe, expect, it } from "vitest";

import {
  DEFAULT_COL_ORDER,
  DEFAULT_WIDTHS,
  RESIZER_WIDTH,
  TITLE_MIN_WIDTH,
  fitColumns,
  gridTemplate,
  isReorderableColId,
  projectBoundaryDelta,
  renderedStatusWidth,
  resizeNeighborsForBoundary,
  resolveColOrder,
  type ReorderableColId,
} from "../list-columns";

const W = { ...DEFAULT_WIDTHS };
const R = `${RESIZER_WIDTH}px`;
const TITLE = "minmax(0, 1fr)";
/** The template's tracks; a `minmax(…)` or `clamp(…)` carries spaces. */
function tracksOf(template: string): string[] {
  const tracks: string[] = [];
  let depth = 0;
  let track = "";
  for (const ch of template) {
    if (ch === " " && depth === 0) {
      tracks.push(track);
      track = "";
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    track += ch;
  }
  tracks.push(track);
  return tracks;
}

describe("gridTemplate — order-driven track sequence (F#13)", () => {
  it("default order reproduces the 9-track grid (title = the lone 1fr)", () => {
    expect(tracksOf(gridTemplate(W))).toEqual([
      `${W.year}px`,
      R,
      `${W.author}px`,
      R,
      TITLE,
      R,
      `${W.status}px`,
      R,
      `${W.citekey}px`,
    ]);
  });

  it("a reordered order[] produces the matching track sequence with resizers interleaved", () => {
    const order: ReorderableColId[] = [
      "title",
      "citekey",
      "year",
      "author",
      "status",
    ];
    expect(tracksOf(gridTemplate(W, order))).toEqual([
      TITLE, // title first
      R,
      `${W.citekey}px`,
      R,
      `${W.year}px`,
      R,
      `${W.author}px`,
      R,
      `${W.status}px`,
    ]);
  });

  it("N columns yields N tracks + N-1 resizers", () => {
    const order: ReorderableColId[] = ["year", "title", "status"];
    const tracks = tracksOf(gridTemplate(W, order));
    // 3 content tracks + 2 resizer tracks = 5
    expect(tracks).toHaveLength(5);
    expect(tracks[1]).toBe(R);
    expect(tracks[3]).toBe(R);
  });
});

describe("a status column wider than its floor", () => {
  const wide = { ...W, status: 208 };

  it("gives its slack to the title first", () => {
    const tracks = tracksOf(gridTemplate(wide, ["year", "title", "status"]));
    expect(tracks[4]).toMatch(/^clamp\(148px, calc\(100% - \d+px\), 208px\)$/);
  });
});

describe("fitColumns — a column that does not fit steps aside whole", () => {
  const order = DEFAULT_COL_ORDER;
  const need = (cols: readonly ReorderableColId[]) =>
    cols.reduce(
      (sum, c) => sum + (c === "title" ? TITLE_MIN_WIDTH : W[c as keyof typeof W]),
      0,
    ) +
    (cols.length - 1) * RESIZER_WIDTH;
  const without = (...gone: ReorderableColId[]) => order.filter((c) => !gone.includes(c));

  it("keeps everything while it fits, and returns the same array", () => {
    expect(fitColumns(order, W, 2000)).toBe(order);
  });

  it("keeps everything when unmeasured", () => {
    expect(fitColumns(order, W, 0)).toBe(order);
  });

  it("gives up the citekey, then the status, then the year", () => {
    expect(fitColumns(order, W, need(order) - 1)).toEqual(without("citekey"));
    expect(fitColumns(order, W, need(without("citekey")) - 1)).toEqual(
      without("citekey", "status"),
    );
    expect(fitColumns(order, W, need(without("citekey", "status")) - 1)).toEqual(
      without("citekey", "status", "year"),
    );
  });

  it("never gives up author or title", () => {
    expect(fitColumns(order, W, 40)).toEqual(without("citekey", "status", "year"));
  });

  it("keeps the user's order among what stays", () => {
    const mine: ReorderableColId[] = ["title", "citekey", "author", "status", "year"];
    expect(fitColumns(mine, W, 1)).toEqual(["title", "author"]);
  });
});

describe("resizeNeighborsForBoundary — asymmetric title-1fr split (F#13)", () => {
  it("default order mirrors the legacy hard-coded resize pairs", () => {
    const order = [...DEFAULT_COL_ORDER];
    // boundaries: year|author, author|title, title|status, status|citekey
    expect(resizeNeighborsForBoundary(order, 0)).toEqual({ left: "year", right: null });
    expect(resizeNeighborsForBoundary(order, 1)).toEqual({ left: "author", right: null });
    expect(resizeNeighborsForBoundary(order, 2)).toEqual({ left: null, right: "status" });
    expect(resizeNeighborsForBoundary(order, 3)).toEqual({ left: "status", right: "citekey" });
  });

  it("title at index 0 — every boundary is right of title", () => {
    const order: ReorderableColId[] = ["title", "year", "author", "status", "citekey"];
    // boundary 0 is immediately right of title → shrink right neighbor only
    expect(resizeNeighborsForBoundary(order, 0)).toEqual({ left: null, right: "year" });
    // boundaries 1..3 pull two real px neighbors
    expect(resizeNeighborsForBoundary(order, 1)).toEqual({ left: "year", right: "author" });
    expect(resizeNeighborsForBoundary(order, 2)).toEqual({ left: "author", right: "status" });
    expect(resizeNeighborsForBoundary(order, 3)).toEqual({ left: "status", right: "citekey" });
  });

  it("title at last index — every boundary is left of title", () => {
    const order: ReorderableColId[] = ["year", "author", "status", "citekey", "title"];
    expect(resizeNeighborsForBoundary(order, 0)).toEqual({ left: "year", right: null });
    expect(resizeNeighborsForBoundary(order, 1)).toEqual({ left: "author", right: null });
    expect(resizeNeighborsForBoundary(order, 2)).toEqual({ left: "status", right: null });
    // boundary 3 is immediately left of title → pull citekey, delta into 1fr
    expect(resizeNeighborsForBoundary(order, 3)).toEqual({ left: "citekey", right: null });
  });

  it("title in the middle — left boundaries single-sided, right boundaries paired", () => {
    const order: ReorderableColId[] = ["year", "title", "author", "status", "citekey"];
    // boundary 0: year|title → year only, delta into 1fr
    expect(resizeNeighborsForBoundary(order, 0)).toEqual({ left: "year", right: null });
    // boundary 1: title|author → immediately right of title → shrink author only
    expect(resizeNeighborsForBoundary(order, 1)).toEqual({ left: null, right: "author" });
    // boundary 2: author|status → two real neighbors
    expect(resizeNeighborsForBoundary(order, 2)).toEqual({ left: "author", right: "status" });
    expect(resizeNeighborsForBoundary(order, 3)).toEqual({ left: "status", right: "citekey" });
  });

  it("never returns 'title' as a resizable neighbor", () => {
    const order: ReorderableColId[] = ["year", "title", "status", "author", "citekey"];
    for (let i = 0; i < order.length - 1; i++) {
      const { left, right } = resizeNeighborsForBoundary(order, i);
      expect(left).not.toBe("title");
      expect(right).not.toBe("title");
    }
  });
});

describe("resolveColOrder — fill/dedupe/drop (F#13)", () => {
  it("undefined → the default order", () => {
    expect(resolveColOrder(undefined)).toEqual([...DEFAULT_COL_ORDER]);
  });

  it("appends missing columns in default order", () => {
    expect(resolveColOrder(["citekey", "title"])).toEqual([
      "citekey",
      "title",
      "year",
      "author",
      "status",
    ]);
  });

  it("drops unknown ids and dedupes (first occurrence wins)", () => {
    expect(
      resolveColOrder(["status", "bogus", "status", "year"]),
    ).toEqual(["status", "year", "author", "title", "citekey"]);
  });

  it("always returns a complete permutation of the five reorderable columns", () => {
    const out = resolveColOrder(["nope"]);
    expect(new Set(out)).toEqual(new Set(DEFAULT_COL_ORDER));
    expect(out).toHaveLength(5);
  });
});

describe("isReorderableColId", () => {
  it("accepts the five known ids, rejects others", () => {
    for (const c of DEFAULT_COL_ORDER) expect(isReorderableColId(c)).toBe(true);
    expect(isReorderableColId("bibimp")).toBe(false);
    expect(isReorderableColId(null)).toBe(false);
    expect(isReorderableColId(42)).toBe(false);
  });
});

// Task 1545: the status track renders `clamp(floor, 100% − fixed − comfort,
// stored)`, so below the title's comfort width the RENDERED status width is
// not the stored one. A boundary drag must work in the rendered model: seed
// from what the grid shows, never leave it, commit what the user saw.
describe("status-column resize in the clamp regime (task 1545)", () => {
  const order = DEFAULT_COL_ORDER;
  // A user whose stored status predates the narrower default.
  const stored = { year: 56, author: 130, status: 208, citekey: 140 };
  // Fixed (non-title, non-status) width: 56 + 130 + 140 + 4 resizers.
  const fixed = 56 + 130 + 140 + 4 * RESIZER_WIDTH;

  /** The status width as the grid would render it after the projection. */
  const rendered = (w: typeof stored, g: number) => renderedStatusWidth(w, order, g);

  it("resolves the rendered width the clamp() track paints", () => {
    expect(rendered(stored, 2000)).toBe(208); // wide: the stored width
    expect(rendered(stored, 800)).toBe(800 - fixed - 280); // title at comfort
    expect(rendered(stored, 700)).toBe(148); // the floor
    // At or below the floor the track is plain px, whatever the grid.
    expect(rendered({ ...stored, status: 130 }, 500)).toBe(130);
  });

  it("status│citekey: status widens under the pointer, citekey pays, nothing slides", () => {
    const g = 800;
    const start = { ...stored, status: rendered(stored, g) };
    const r = projectBoundaryDelta(start, "status", "citekey", 20, order, g);
    expect(r.delta).toBe(20);
    expect(r.widths.status).toBe(start.status + 20);
    expect(rendered(r.widths, g)).toBe(start.status + 20);
    expect(r.widths.status + r.widths.citekey).toBe(start.status + start.citekey);
  });

  it("title│status: the rendered status moves from the first pixel (no dead zone)", () => {
    const g = 800;
    const start = { ...stored, status: rendered(stored, g) };
    for (const d of [1, 5, 20]) {
      const r = projectBoundaryDelta(start, null, "status", d, order, g);
      expect(r.delta).toBe(d);
      expect(rendered(r.widths, g)).toBe(start.status - d);
    }
    // Widening past the title's comfort is a wall, not a silent stored value.
    const wide = projectBoundaryDelta(start, null, "status", -30, order, g);
    expect(wide.delta).toBe(0);
  });

  it("every projected delta commits exactly the width the grid renders", () => {
    for (const g of [650, 700, 760, 800, 860, 1200]) {
      const start = { ...stored, status: rendered(stored, g) };
      for (let d = -80; d <= 80; d += 7) {
        for (const [l, rt] of [
          ["status", "citekey"],
          [null, "status"],
        ] as const) {
          const r = projectBoundaryDelta(start, l, rt, d, order, g);
          expect(rendered(r.widths, g)).toBe(r.widths.status);
        }
      }
    }
  });

  it("an unmeasured grid or a boundary away from status keeps the plain projection", () => {
    const r = projectBoundaryDelta(stored, "status", "citekey", 20, order, 0);
    expect(r.widths.status).toBe(228);
    const a = projectBoundaryDelta(stored, "author", null, 15, order, 700);
    expect(a.widths).toEqual({ ...stored, author: 145 });
  });
});
