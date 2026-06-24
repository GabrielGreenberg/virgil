// Pure-logic test for the cold-load top-stack fix in `useInTextPositions`.
//
// BUG (MEMO_CARD_GUTTER_STACKING.md): `measure()` runs once in a
// `useLayoutEffect` against a not-yet-final layout. Before web fonts swap and
// before KaTeX/expex/figure NodeViews lay out, `coordsAtPos(pos).top` is read
// too small, so the *pre-clamp* natural (`coords.top - podRect.top`) goes
// strongly negative for many anchors. The old `if (naturalTop < 0) 0` clamp
// silently baked those to 0, and the cascade then spread the zeros into a
// tight top-stack (0, 64, 128, …).
//
// FIX (Part B): `isDegenerateMeasure` recognizes that fingerprint — ≥2 distinct
// anchors reporting strongly above the pod — so the caller can REJECT the
// measure (retain previously-cached good positions) instead of committing the
// garbage. The commit guard in the hook is:
//
//     if (naturalRef.current.size > 0 && isDegenerateMeasure(raws)) return;
//
// i.e. a degenerate re-measure does NOT overwrite previously-cached good
// naturals. These pins lock the detector's contract: it fires on the cold-load
// signature, and crucially does NOT fire on a *legitimate* all-top-anchored
// deck (which sits at pre-clamp ≈ 0, not strongly negative) — so good
// positions are never thrown away by a false positive.

import { describe, it, expect } from "vitest";
import { isDegenerateMeasure } from "../useInTextPositions";

type Raw = { preClampTop: number; height: number; pos: number };

const raw = (preClampTop: number, pos: number): Raw => ({
  preClampTop,
  height: 60,
  pos,
});

describe("isDegenerateMeasure — cold-load top-stack rejection", () => {
  it("flags the un-laid-out cold-load fingerprint (many distinct anchors strongly above the pod)", () => {
    // The repro: every deep anchor reported ~50px+ above the pod top because
    // the editor hadn't reached final layout. Distinct doc positions, all
    // strongly negative pre-clamp.
    const raws = [
      raw(-120, 100),
      raw(-90, 480),
      raw(-200, 920),
      raw(-310, 1500),
    ];
    expect(isDegenerateMeasure(raws)).toBe(true);
  });

  it("does NOT flag a legitimate all-top-anchored deck (pre-clamp ≈ 0, not strongly negative)", () => {
    // Cards genuinely anchored at the top of the document sit at natural ≈ 0.
    // A few sub-pixel/small negatives are normal and must NOT be mistaken for
    // the cold-load garbage — otherwise a real top deck would be rejected
    // forever.
    const raws = [
      raw(0, 100),
      raw(-2, 140),
      raw(2, 180),
      raw(-5, 220),
    ];
    expect(isDegenerateMeasure(raws)).toBe(false);
  });

  it("does NOT flag a single strongly-negative item (one unanchored block above the pod is legitimate)", () => {
    // A lone block above the pod top (the historical reason the ≥0 clamp
    // existed) is below the min-count threshold → not degenerate.
    const raws = [
      raw(-300, 50),
      raw(20, 400),
      raw(140, 800),
    ];
    expect(isDegenerateMeasure(raws)).toBe(false);
  });

  it("does NOT flag strongly-negative items that share the same anchor pos (no spread)", () => {
    // Co-located items can't both be legitimately far above the pod once laid
    // out, but the pos-spread guard means we only treat a *spread* of negative
    // anchors as the un-laid-out fingerprint. Same pos → no spread → not
    // degenerate (avoids over-eager rejection on a pathological duplicate).
    const raws = [raw(-300, 500), raw(-280, 500)];
    expect(isDegenerateMeasure(raws)).toBe(false);
  });

  it("does NOT flag an empty measure", () => {
    expect(isDegenerateMeasure([])).toBe(false);
  });

  it("commit-guard contract: a degenerate re-measure is rejected ONLY when previous-good naturals exist", () => {
    // Mirror the hook's guard `naturalRef.size > 0 && isDegenerateMeasure(raws)`.
    // The detector alone says "this looks degenerate"; the hook combines it
    // with "do we have something good to keep?". On a FIRST paint
    // (size === 0) we still commit so the column is never permanently blank;
    // the settle loop then corrects it. On a LATER degenerate re-measure
    // (size > 0) we retain the good cache.
    const coldLoad = [raw(-120, 100), raw(-200, 900), raw(-300, 1500)];

    const wouldReject = (prevGoodCount: number) =>
      prevGoodCount > 0 && isDegenerateMeasure(coldLoad);

    // First paint: nothing cached → commit (don't reject) so we paint
    // *something* and let the settle loop heal it.
    expect(wouldReject(0)).toBe(false);
    // Later: we already have good positions → reject the degenerate
    // re-measure, retaining the cached good naturals (no top-stack flash).
    expect(wouldReject(3)).toBe(true);
  });
});
