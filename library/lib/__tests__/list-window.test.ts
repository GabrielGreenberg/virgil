import { describe, expect, it } from "vitest";
import { computeListWindow, ROW_HEIGHT } from "../list-window";

describe("computeListWindow (C7 fixed-height windowing)", () => {
  it("renders only the viewport slice + overscan, not all N", () => {
    // 1000 rows, 600px viewport, scrolled to row ~100.
    const w = computeListWindow({
      scrollTop: 100 * ROW_HEIGHT,
      viewportHeight: 600,
      count: 1000,
      overscan: 8,
    });
    // Window is a small slice — viewport holds ceil(600/29)=21 rows + 2*8
    // overscan ≈ 37, never 1000.
    expect(w.endIndex - w.startIndex).toBeLessThan(60);
    expect(w.startIndex).toBe(100 - 8);
    expect(w.totalHeight).toBe(1000 * ROW_HEIGHT);
    // The spacers + slice exactly reconstruct the full height.
    expect(w.padTop + (w.endIndex - w.startIndex) * ROW_HEIGHT + w.padBottom).toBe(
      w.totalHeight,
    );
  });

  it("clamps the start at 0 at the top of the list", () => {
    const w = computeListWindow({ scrollTop: 0, viewportHeight: 600, count: 234 });
    expect(w.startIndex).toBe(0);
    expect(w.padTop).toBe(0);
    expect(w.endIndex).toBeGreaterThan(0);
    expect(w.endIndex).toBeLessThanOrEqual(234);
  });

  it("clamps the end at count at the bottom of the list", () => {
    const count = 234;
    const w = computeListWindow({
      scrollTop: count * ROW_HEIGHT, // scrolled past the end
      viewportHeight: 600,
      count,
    });
    expect(w.endIndex).toBe(count);
    expect(w.padBottom).toBe(0);
  });

  it("returns an empty window for an empty list", () => {
    const w = computeListWindow({ scrollTop: 0, viewportHeight: 600, count: 0 });
    expect(w).toEqual({
      startIndex: 0,
      endIndex: 0,
      padTop: 0,
      padBottom: 0,
      totalHeight: 0,
    });
  });

  it("a small list fits entirely in the window (no clipping)", () => {
    const w = computeListWindow({ scrollTop: 0, viewportHeight: 600, count: 5 });
    expect(w.startIndex).toBe(0);
    expect(w.endIndex).toBe(5);
    expect(w.padTop).toBe(0);
    expect(w.padBottom).toBe(0);
  });
});
