// Task 328 — the gutter-stability necessity rule, in isolation.
//
// The predicate was never the part that could misbehave (a call site that
// doesn't ask it is — see `gutter-stability-census`), but its RUNGS encode
// product decisions that a later "tightening" would be tempted to invert, so
// each one is pinned here with the reason it exists.

import { describe, it, expect } from "vitest";
import {
  farThresholdFor,
  holdWithinEpsilon,
  isFullyVisible,
  mayReposition,
  HEIGHT_EPSILON_PX,
  REPOSITION_EPSILON_PX,
  REPOSITION_FAR_MIN_PX,
} from "@/lib/reposition-policy";

const BAND = { top: 0, bottom: 800 };
const visibleRect = { top: 100, bottom: 200 };

describe("mayReposition — the four rungs", () => {
  it("holds a sub-epsilon move whatever else is true (rung 0: jitter is not intent)", () => {
    // Off screen AND unmeasurable — still a hold, because there is nothing to
    // gain from a move this small and the transition would make it visible.
    expect(
      mayReposition({
        current: 4000,
        target: 4000 + REPOSITION_EPSILON_PX,
        rect: null,
        band: null,
      }),
    ).toBe("hold");
  });

  it("fails OPEN when the rect or the band cannot be read (rung 1)", () => {
    // The asymmetry is the point: a needless move is the PRE-328 behaviour
    // and the user asked for it by clicking; a wrongly-held move makes a
    // deliberate click do nothing, with nothing on screen to explain it.
    expect(
      mayReposition({ current: 0, target: 500, rect: null, band: BAND }),
    ).toBe("move");
    expect(
      mayReposition({ current: 0, target: 500, rect: visibleRect, band: null }),
    ).toBe("move");
  });

  it("treats a DEGENERATE band or rect as unreadable, not as visible", () => {
    // A `display:none` keep-alive pane reports a zero-height band, and an
    // unrendered wrapper reports a zero-height rect. A naive containment test
    // calls both "fully visible" (the visible span and the whole are both 0)
    // and would hold every move for a pane nobody can see.
    const zeroBand = { top: 0, bottom: 0 };
    expect(
      mayReposition({ current: 0, target: 500, rect: visibleRect, band: zeroBand }),
    ).toBe("move");
    expect(
      mayReposition({
        current: 0,
        target: 500,
        rect: { top: 100, bottom: 100 },
        band: BAND,
      }),
    ).toBe("move");
  });

  it("moves an element that is not fully visible (rung 2)", () => {
    // Straddling the bottom edge: partly readable is not readable.
    expect(
      mayReposition({
        current: 0,
        target: 50,
        rect: { top: 750, bottom: 900 },
        band: BAND,
      }),
    ).toBe("move");
  });

  it("moves a visible element that is very far from the target (rung 3)", () => {
    const far = farThresholdFor(BAND);
    expect(
      mayReposition({
        current: 0,
        target: far + 1,
        rect: visibleRect,
        band: BAND,
      }),
    ).toBe("move");
    expect(
      mayReposition({
        current: 0,
        target: far - 1,
        rect: visibleRect,
        band: BAND,
      }),
    ).toBe("hold");
  });

  it("HOLDS the headline case: visible, and near enough (rung 4)", () => {
    // Task 328 example 2 — clicking the linked text of a card the user can
    // already see must not move it.
    expect(
      mayReposition({
        current: 120,
        target: 160,
        rect: visibleRect,
        band: BAND,
      }),
    ).toBe("hold");
  });
});

describe("isFullyVisible", () => {
  it("counts an element TALLER than its band as visible once it covers it", () => {
    // Otherwise a long card in a short gutter is permanently unsatisfiable —
    // and therefore permanently move-eligible, which is the jumpiest possible
    // answer for the card that needs stability most.
    expect(isFullyVisible({ top: -200, bottom: 1200 }, BAND)).toBe(true);
  });

  it("rejects an element hanging off either edge", () => {
    expect(isFullyVisible({ top: -10, bottom: 100 }, BAND)).toBe(false);
    expect(isFullyVisible({ top: 700, bottom: 810 }, BAND)).toBe(false);
  });
});

describe("farThresholdFor", () => {
  it("scales with the band and floors at the minimum", () => {
    expect(farThresholdFor({ top: 0, bottom: 2000 })).toBe(1000);
    // A squeezed panel must not make every small move look "very far".
    expect(farThresholdFor({ top: 0, bottom: 100 })).toBe(REPOSITION_FAR_MIN_PX);
    expect(farThresholdFor(null)).toBe(REPOSITION_FAR_MIN_PX);
  });
});

describe("holdWithinEpsilon — the measure-pass half of the same rule", () => {
  it("keeps the committed value for a sub-epsilon change and takes a real one", () => {
    expect(holdWithinEpsilon(100, 100 + REPOSITION_EPSILON_PX)).toBe(100);
    expect(holdWithinEpsilon(100, 100 + REPOSITION_EPSILON_PX + 0.5)).toBe(
      100 + REPOSITION_EPSILON_PX + 0.5,
    );
  });

  it("takes the first value when nothing was committed before", () => {
    expect(holdWithinEpsilon(undefined, 42)).toBe(42);
  });

  it("does not let a slow real drift integrate silently", () => {
    // Each step is sub-epsilon against the PREVIOUS MEASUREMENT but the
    // comparison is against the COMMITTED value, so the error is bounded by
    // one epsilon rather than accumulating without limit.
    let commit = 0;
    for (let i = 1; i <= 10; i++) commit = holdWithinEpsilon(commit, i * 3);
    expect(Math.abs(commit - 30)).toBeLessThanOrEqual(REPOSITION_EPSILON_PX);
  });

  it("takes a tighter epsilon for heights", () => {
    expect(holdWithinEpsilon(60, 60.4, HEIGHT_EPSILON_PX)).toBe(60);
    expect(holdWithinEpsilon(60, 64, HEIGHT_EPSILON_PX)).toBe(64);
  });
});
