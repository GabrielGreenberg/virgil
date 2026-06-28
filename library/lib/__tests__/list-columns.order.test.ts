import { describe, expect, it } from "vitest";

import {
  DEFAULT_COL_ORDER,
  DEFAULT_WIDTHS,
  RESIZER_WIDTH,
  gridTemplate,
  isReorderableColId,
  resizeNeighborsForBoundary,
  resolveColOrder,
  type ReorderableColId,
} from "../list-columns";

const W = { ...DEFAULT_WIDTHS };
const R = `${RESIZER_WIDTH}px`;

describe("gridTemplate — order-driven track sequence (F#13)", () => {
  it("default order reproduces the 9-track grid (title = the lone 1fr)", () => {
    expect(gridTemplate(W)).toBe(
      [
        `${W.year}px`,
        R,
        `${W.author}px`,
        R,
        "1fr",
        R,
        `${W.status}px`,
        R,
        `${W.citekey}px`,
      ].join(" "),
    );
  });

  it("a reordered order[] produces the matching track sequence with resizers interleaved", () => {
    const order: ReorderableColId[] = [
      "title",
      "citekey",
      "year",
      "author",
      "status",
    ];
    expect(gridTemplate(W, order)).toBe(
      [
        "1fr", // title first
        R,
        `${W.citekey}px`,
        R,
        `${W.year}px`,
        R,
        `${W.author}px`,
        R,
        `${W.status}px`,
      ].join(" "),
    );
  });

  it("N columns yields N tracks + N-1 resizers", () => {
    const order: ReorderableColId[] = ["year", "title", "status"];
    const tracks = gridTemplate(W, order).split(" ");
    // 3 content tracks + 2 resizer tracks = 5
    expect(tracks).toHaveLength(5);
    expect(tracks[1]).toBe(R);
    expect(tracks[3]).toBe(R);
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
