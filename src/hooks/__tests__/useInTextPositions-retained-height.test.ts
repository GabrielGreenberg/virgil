// Pure-logic test for the card-deck overlap-then-snap fix (task 043).
//
// BUG: expanded omni/marginalia note cards render STACKED/OVERLAPPING when they
// scroll into view, then ~500ms later RE-SPACE to their proper de-overlapped
// positions — a visible jump. Root cause: the ±NEAR_ZONE_PX viewport gate in
// `measure()` substitutes `DEFAULT_ENTRY_HEIGHT` (60) for any card whose anchor
// is outside the visible band. A 120–200px card packed into a 60px cascade slot
// makes the PURE push-down solver (`resolveCascade`) pile the NEXT card on top
// of it. The ~500ms settle loop / per-card ResizeObserver only correct this
// AFTER the overlapping paint — one frame late.
//
// FIX (the card-side twin of task 041's `parked`): retain the last REAL
// in-zone-measured height per card id ACROSS the viewport gate. A card's
// rendered height is scroll-invariant, so a height read once stays truthful
// after the card scrolls out — `retainedEntryHeight` feeds the cascade that
// truth (fresh read → retained real → placeholder) so the FIRST pass after
// scroll-into-view is already de-overlapped. These pins lock:
//   1. the fallback order of `retainedEntryHeight`;
//   2. that a once-measured card NEVER re-collapses to 60 on a later
//      out-of-zone pass;
//   3. that `resolveCascade` produces ZERO overlap once fed retained heights
//      (the "overlapping tops are never computed for a paintable card" clause).

import { describe, it, expect } from "vitest";
import {
  retainedEntryHeight,
  resolveCascade,
  type NaturalEntry,
} from "../useInTextPositions";

const DEFAULT_ENTRY_HEIGHT = 60;

describe("retainedEntryHeight — retain real card height across the viewport gate", () => {
  it("prefers a fresh in-zone read over everything", () => {
    expect(retainedEntryHeight(150, 90)).toBe(150);
    expect(retainedEntryHeight(150, undefined)).toBe(150);
  });

  it("reuses the retained REAL height when out-of-zone (no fresh read) — NOT 60", () => {
    // This is the crux: a card that has scrolled out of the ±NEAR_ZONE band has
    // no fresh measurement this pass, so `measured` is undefined. It must reuse
    // its last real height, never collapse back to the 60px placeholder.
    expect(retainedEntryHeight(undefined, 150)).toBe(150);
    expect(retainedEntryHeight(undefined, 150)).not.toBe(DEFAULT_ENTRY_HEIGHT);
  });

  it("falls back to the placeholder ONLY for a never-measured card", () => {
    expect(retainedEntryHeight(undefined, undefined)).toBe(DEFAULT_ENTRY_HEIGHT);
  });

  it("retains a zero real height faithfully (0 is a real read, not 'missing')", () => {
    // `measured ?? retained` uses nullish coalescing, so a genuine 0 read is
    // kept rather than silently upgraded to the placeholder.
    expect(retainedEntryHeight(0, 150)).toBe(0);
    expect(retainedEntryHeight(undefined, 0)).toBe(0);
  });
});

// Mirror the measure() height decision for one card across two passes: pass 1
// in-zone (fresh read populates the retained cache), pass 2 out-of-zone (no
// fresh read). This is the exact "measure once, then scroll out" contract.
function heightAcrossPasses(realHeight: number): {
  inZone: number;
  afterScrollOut: number;
} {
  const cache = new Map<string, number>();
  const id = "card-1";

  // Pass 1 — in-zone: a real getBoundingClientRect read.
  let measured: number | undefined = realHeight;
  if (measured !== undefined) cache.set(id, measured);
  const inZone = retainedEntryHeight(measured, cache.get(id));

  // Pass 2 — scrolled out of the near-zone: gate skips the layout read.
  measured = undefined;
  const afterScrollOut = retainedEntryHeight(measured, cache.get(id));

  return { inZone, afterScrollOut };
}

describe("measure() height decision — a once-measured card never re-collapses to 60", () => {
  it("keeps the real height after the card scrolls out of the near-zone", () => {
    const { inZone, afterScrollOut } = heightAcrossPasses(174);
    expect(inZone).toBe(174);
    expect(afterScrollOut).toBe(174); // was 60 before the fix → the overlap
    expect(afterScrollOut).not.toBe(DEFAULT_ENTRY_HEIGHT);
  });
});

describe("resolveCascade — zero overlap once fed retained heights", () => {
  const nat = (naturalTop: number, height: number): NaturalEntry => ({
    naturalTop,
    height,
  });
  const items = [
    { id: "a", pos: 100 },
    { id: "b", pos: 200 },
    { id: "c", pos: 300 },
  ];

  it("OVERLAPS when tall cards are packed into 60px placeholder slots (the bug)", () => {
    // Three 160px cards whose natural tops sit ~70px apart. With every height
    // reported as the 60px placeholder, the push-down solver thinks 60+gap of
    // clearance is enough — so the committed tops land INSIDE the prior card's
    // real 160px extent: overlap.
    const natural = new Map<string, NaturalEntry>([
      ["a", nat(0, DEFAULT_ENTRY_HEIGHT)],
      ["b", nat(70, DEFAULT_ENTRY_HEIGHT)],
      ["c", nat(140, DEFAULT_ENTRY_HEIGHT)],
    ]);
    const pos = resolveCascade(natural, items, null);
    const REAL = 160;
    // b's committed top falls within a's real height → visible overlap.
    expect(pos.get("b")! - pos.get("a")!).toBeLessThan(REAL);
  });

  it("does NOT overlap once each card carries its RETAINED real height", () => {
    // Same anchors, but heights are the retained real 160px. The solver now
    // pushes each card fully below its predecessor's real extent → the deck is
    // de-overlapped on the FIRST resolve, before any settle/RO correction.
    const REAL = 160;
    const natural = new Map<string, NaturalEntry>([
      ["a", nat(0, REAL)],
      ["b", nat(70, REAL)],
      ["c", nat(140, REAL)],
    ]);
    const pos = resolveCascade(natural, items, null);
    const tops = ["a", "b", "c"].map((id) => pos.get(id)!);
    for (let i = 1; i < tops.length; i++) {
      // Each card clears the previous card's real height + the min gap.
      expect(tops[i]).toBeGreaterThanOrEqual(tops[i - 1] + REAL);
    }
  });
});
