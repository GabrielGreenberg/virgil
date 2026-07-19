import { describe, it, expect } from "vitest";
import { isMissedRelease, isPrimaryDragStart } from "../pointer-invariants";

/**
 * The two invariants every drag gesture shares — the engine's and the bespoke
 * ones alike (task 185). Pinned here so the bit-test rationale can't be
 * re-derived wrong at a new callsite.
 */
describe("isPrimaryDragStart", () => {
  it("accepts a primary-button press from the primary pointer", () => {
    expect(isPrimaryDragStart({ button: 0, isPrimary: true })).toBe(true);
  });

  it("accepts a MouseEvent-shaped press (no isPrimary field)", () => {
    expect(isPrimaryDragStart({ button: 0 })).toBe(true);
  });

  it("refuses secondary/middle buttons — the context menu can eat their end event", () => {
    expect(isPrimaryDragStart({ button: 2, isPrimary: true })).toBe(false);
    expect(isPrimaryDragStart({ button: 1, isPrimary: true })).toBe(false);
  });

  it("refuses a non-primary pointer", () => {
    expect(isPrimaryDragStart({ button: 0, isPrimary: false })).toBe(false);
  });
});

describe("isMissedRelease", () => {
  it("is true when no button is held", () => {
    expect(isMissedRelease({ buttons: 0 })).toBe(true);
  });

  it("is false while the primary button is still down", () => {
    expect(isMissedRelease({ buttons: 1 })).toBe(false);
    expect(isMissedRelease({ buttons: 0b11 })).toBe(false); // chorded, primary held
  });

  it("is TRUE when the primary released while a second button stays chorded", () => {
    // The whole reason this is a bit test: `buttons === 0` would miss this,
    // and no pointerup/mouseup fires until the LAST button goes up — so the
    // gesture would keep tracking a released primary until then.
    expect(isMissedRelease({ buttons: 0b10 })).toBe(true);
    expect(isMissedRelease({ buttons: 0b100 })).toBe(true);
  });
});
