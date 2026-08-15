/**
 * Right-margin geometry SSOT (backlog #8 → task 2026-07-03-030).
 *
 * Four chrome elements share the editor's right margin — the selection bolt
 * (⚡), the marginalia marker grid, and the overlay scrollbar. They used to be
 * positioned by independent ad-hoc constants in different coordinate systems,
 * so they overlapped and — worse — the bolt was TEXT-anchored while the markers
 * are POD-anchored, so dragging the right margin wide slid the markers outboard
 * while the bolt stayed put, drifting the bolt onto the markers.
 *
 * The lane is now ONE ordered band list (`RIGHT_LANE_BANDS`), so:
 *  (a) every element offset (bolt x, grid col x, scrollbar x) and the lane
 *      width derive from the SAME list — disjointness is STRUCTURAL (sequential
 *      non-overlapping bands cannot collide), not a hand-checked docstring;
 *  (b) BOLT_PLACEMENT = "inboard": the bolt is the first band after the inner
 *      pad, so the markers sit to its RIGHT;
 *  (c) the bolt is POD-anchored (`computeBoltLeftFromPod`), so it is
 *      MARGIN-INVARIANT — the wide-margin case the old text-edge-only suite
 *      structurally could not see (the task's headline regression);
 *  (d) the per-side min-floor equals the full lane width, and the margin-edit
 *      floor rises to it ONLY when the marker lane is reserved.
 */
import { describe, it, expect } from "vitest";
import {
  SCROLLBAR_THUMB_WIDTH,
  SCROLLBAR_RIGHT_INSET,
  SCROLLBAR_GUTTER,
  MARKER_SCROLLBAR_GAP,
} from "@/components/editor-layout/constants";
import {
  MARGINALIA_COLS,
  MARGINALIA_INNER_PAD,
  MARGINALIA_OUTER_PAD_LEFT,
  ICONS_BLOCK_WIDTH,
  MARGINALIA_ICON_SIZE,
  MARGINALIA_MARGIN_WIDTH_RIGHT,
  MARGINALIA_MARGIN_WIDTH_LEFT,
  MARGINALIA_MIN_MARGIN_RIGHT,
  MARGINALIA_MIN_MARGIN_LEFT,
  CODE_VIEW_GUTTER_PX,
  resolveHorizontalMargin,
  RIGHT_LANE_BANDS,
  rightLaneOffset,
  MARGINALIA_GRID_X_RIGHT,
  MARGINALIA_BOLT_X_RIGHT,
  MARGINALIA_BOLT_PLACEMENT,
  MARGINALIA_BOLT_SIZE,
  MARGINALIA_BOLT_MARKER_GAP,
  MARGINALIA_BOLT_SCROLLBAR_GAP,
  MARGINALIA_BOLT_TUCK_X_RIGHT,
  computeBoltLeftFromPod,
  type AnchorNodeMetrics,
  type MarginaliaMarker,
} from "@/lib/marginalia";
import { computeMarkerPositions } from "@/lib/marginalia-grid";
import {
  MARGIN_MIN,
  MARGIN_MIN_WITH_MARKERS,
} from "@/hooks/useMarginEdit";

// The bolt's pixel size lives in the SSOT (SelectionActionsMenu's BUTTON_SIZE
// aliases it), so the test can't drift from the component.
const BOLT_SIZE = MARGINALIA_BOLT_SIZE;

/** 1-line node metrics for driving the REAL grid placement fn. */
const ONE_LINE: AnchorNodeMetrics = {
  id: "p1",
  top: 0,
  domTop: 0,
  height: 24,
  lineHeight: 24,
  lineCount: 1,
  isAtom: false,
};

/**
 * Place 2 right-side markers on a 1-line node through the REAL grid fn, then
 * return each marker column's [left, right] x-range as a CONTAINER-relative
 * offset (`cell.x`). For the right side the marker container is `right:0` width
 * MARGINALIA_MARGIN_WIDTH_RIGHT, so `cell.x` is measured from the container's
 * left edge = `podRight − MARGINALIA_MARGIN_WIDTH_RIGHT` — the SAME origin the
 * pod-anchored bolt inboard slot uses. Sorted left→right so [0] is col0.
 */
function rightColumnRanges(): Array<[number, number]> {
  const markers: MarginaliaMarker[] = [0, 1].map((i) => ({
    id: `m${i}:p1`,
    entityId: `m${i}`,
    type: "note" as const,
    textObjectId: "p1",
    side: "right" as const,
  }));
  const { positioned } = computeMarkerPositions(
    (uuid) => (uuid === "p1" ? ONE_LINE : null),
    markers,
    {},
    // The band-disjointness geometry this file pins is the LANE-RESERVED
    // layout, so both sides get their full column count. The cramped regime
    // (margin too narrow for the whole lane, where the resolution hands the
    // outboard columns to the tucked bolt) is `marginalia-lane-regime.test.ts`.
    { left: 1, right: MARGINALIA_COLS },
  );
  return positioned
    .map((p): [number, number] => [p.cell.x, p.cell.x + MARGINALIA_ICON_SIZE])
    .sort((a, b) => a[0] - b[0]);
}

/** The bolt's inboard-slot band, in container-relative coordinates. */
const BOLT_BAND: [number, number] = [
  MARGINALIA_BOLT_X_RIGHT,
  MARGINALIA_BOLT_X_RIGHT + BOLT_SIZE,
];

/** True iff [aL,aR] and [bL,bR] overlap (share any x). */
function rangesIntersect(
  [aL, aR]: [number, number],
  [bL, bR]: [number, number],
): boolean {
  return aL < bR && bL < aR;
}

describe("right-margin geometry SSOT — scrollbar gutter", () => {
  it("SCROLLBAR_GUTTER is the thumb width + its right inset (one SSOT, the old silent 9)", () => {
    expect(SCROLLBAR_GUTTER).toBe(SCROLLBAR_THUMB_WIDTH + SCROLLBAR_RIGHT_INSET);
    expect(SCROLLBAR_GUTTER).toBe(9);
  });
});

describe("right-margin geometry SSOT — the ordered band list", () => {
  it("the lane width is the sum of every band (= 104), unchanged from the outboard-bolt layout", () => {
    const sum = RIGHT_LANE_BANDS.reduce((s, b) => s + b.width, 0);
    expect(MARGINALIA_MARGIN_WIDTH_RIGHT).toBe(sum);
    // The bolt band only MOVED (outboard→inboard); it was already counted, so
    // the lane width — and hence the reserved `--editor-pr` floor — is unchanged.
    expect(MARGINALIA_MARGIN_WIDTH_RIGHT).toBe(104);
  });

  it("the bands tile the lane with NO gaps and NO overlaps (disjointness is structural)", () => {
    // Every band's left offset = Σ prior widths; the next band starts exactly
    // where this one ends. So the lane is fully tiled and no two bands overlap —
    // the invariant the old hand-written docstring asserted is now computed.
    let cursor = 0;
    for (const band of RIGHT_LANE_BANDS) {
      expect(rightLaneOffset(band.key)).toBe(cursor);
      cursor += band.width;
    }
    expect(cursor).toBe(MARGINALIA_MARGIN_WIDTH_RIGHT);
  });

  it("the expected band order + concrete offsets (inboard bolt, markers to its right)", () => {
    expect(MARGINALIA_BOLT_PLACEMENT).toBe("inboard");
    // inner-pad 0, bolt 8, gap 36, col0 42, gap 64, col1 70, sb-gap 92, sb 95.
    expect(rightLaneOffset("inner-pad")).toBe(0);
    expect(rightLaneOffset("bolt")).toBe(8);
    expect(rightLaneOffset("col0")).toBe(42);
    expect(rightLaneOffset("col1")).toBe(70);
    expect(rightLaneOffset("scrollbar")).toBe(95);
    // The derived offset constants the grid + bolt consume.
    expect(MARGINALIA_BOLT_X_RIGHT).toBe(8);
    expect(MARGINALIA_GRID_X_RIGHT).toBe(42);
  });

  it("rightLaneOffset throws on an unknown band (a typo can't silently read 0)", () => {
    expect(() => rightLaneOffset("nope")).toThrow();
  });

  it("the CRAMPED tuck is a lane offset too, and its two derivations agree (task 325)", () => {
    // Task 045 pinned the tuck as pod arithmetic; task 325 re-based it into the
    // container's coordinate space so the grid can ask which columns it covers.
    // Byte-exact against BOTH spellings, so the re-basing is provably neutral:
    // the pod form re-based, and the band form (the bolt's right edge sits where
    // the marker→scrollbar gap begins, valid while the two gaps are one value).
    expect(MARGINALIA_BOLT_TUCK_X_RIGHT).toBe(
      MARGINALIA_MARGIN_WIDTH_RIGHT -
        SCROLLBAR_GUTTER -
        MARGINALIA_BOLT_SCROLLBAR_GAP -
        BOLT_SIZE,
    );
    expect(MARGINALIA_BOLT_SCROLLBAR_GAP).toBe(MARKER_SCROLLBAR_GAP);
    expect(MARGINALIA_BOLT_TUCK_X_RIGHT).toBe(
      rightLaneOffset("marker-scrollbar-gap") - BOLT_SIZE,
    );
    expect(MARGINALIA_BOLT_TUCK_X_RIGHT).toBe(64);
  });
});

describe("right-margin geometry SSOT — inboard bolt disjoint from the markers + scrollbar", () => {
  it("the bolt is INBOARD — its band sits LEFT of BOTH marker columns", () => {
    const [col0, col1] = rightColumnRanges();
    // Bolt band [8,36] is entirely left of col0 [42,64] and col1 [70,92].
    expect(rangesIntersect(BOLT_BAND, col0)).toBe(false);
    expect(rangesIntersect(BOLT_BAND, col1)).toBe(false);
    expect(BOLT_BAND[1]).toBeLessThanOrEqual(col0[0]); // bolt < col0
    // The gap between the bolt and col0 is exactly the ratified BOLT_MARKER_GAP.
    expect(col0[0] - BOLT_BAND[1]).toBe(MARGINALIA_BOLT_MARKER_GAP);
  });

  it("the marker grid now abuts the scrollbar by MARKER_SCROLLBAR_GAP (its pre-bolt-band home)", () => {
    const ranges = rightColumnRanges();
    const col1 = ranges[ranges.length - 1]; // outboard column, nearest scrollbar
    const scrollbarLeft = MARGINALIA_MARGIN_WIDTH_RIGHT - SCROLLBAR_GUTTER; // 95
    expect(col1[1]).toBeLessThanOrEqual(scrollbarLeft);
    expect(scrollbarLeft - col1[1]).toBe(MARKER_SCROLLBAR_GAP);
  });

  it("the four elements tile the lane monotone + disjoint: bolt < col0 < col1 < scrollbar", () => {
    const ranges = rightColumnRanges();
    const col0 = ranges[0];
    const col1 = ranges[ranges.length - 1];
    const scrollbarBand: [number, number] = [
      MARGINALIA_MARGIN_WIDTH_RIGHT - SCROLLBAR_GUTTER,
      MARGINALIA_MARGIN_WIDTH_RIGHT,
    ];
    expect(BOLT_BAND[1]).toBeLessThanOrEqual(col0[0]); // bolt ≤ col0
    expect(col0[1]).toBeLessThanOrEqual(col1[0]); // col0 ≤ col1
    expect(col1[1]).toBeLessThan(scrollbarBand[0]); // col1 < scrollbar
    // Concrete band pins (bolt 8…36, col0 42…64, col1 70…92, scrollbar 95…104).
    expect(BOLT_BAND).toEqual([8, 36]);
    expect(col0).toEqual([42, 64]);
    expect(col1).toEqual([70, 92]);
    expect(scrollbarBand).toEqual([95, 104]);
  });

  it("the bolt's inboard slot clears the prose (= INNER_PAD off the text edge)", () => {
    // The band's left edge is exactly one INNER_PAD off the container/text edge.
    expect(MARGINALIA_BOLT_X_RIGHT).toBe(MARGINALIA_INNER_PAD);
    expect(BOLT_BAND[0]).toBeGreaterThanOrEqual(MARGINALIA_INNER_PAD);
  });
});

describe("right-margin geometry SSOT — the bolt is POD-anchored (margin-invariant)", () => {
  // Fix a pod-right edge; vary only the right margin (--editor-pr). The marker
  // container is `right:0` width MARGIN_WIDTH_RIGHT, so its left = podRight −
  // MARGIN_WIDTH_RIGHT regardless of the margin. The bolt is pod-anchored the
  // SAME way, so its absolute x must NOT move as the margin widens.
  const podRight = 1000;
  const markerContainerLeft = podRight - MARGINALIA_MARGIN_WIDTH_RIGHT;

  /** Absolute marker column ranges at this podRight (container + cell.x). */
  function absoluteColumns(): Array<[number, number]> {
    return rightColumnRanges().map(
      ([l, r]): [number, number] => [
        markerContainerLeft + l,
        markerContainerLeft + r,
      ],
    );
  }

  it("DEFAULT margin (--editor-pr = 104): bolt seats in the inboard slot, LEFT of the markers", () => {
    const editorRight = podRight - 104; // text edge at the 104 floor
    const boltLeft = computeBoltLeftFromPod({ podRight, editorRight });
    const boltBand: [number, number] = [boltLeft, boltLeft + BOLT_SIZE];
    const [col0] = absoluteColumns();
    expect(boltBand[1]).toBeLessThanOrEqual(col0[0]);
    // Absolute inboard slot = container-left + BOLT_X_RIGHT.
    expect(boltLeft).toBe(markerContainerLeft + MARGINALIA_BOLT_X_RIGHT);
  });

  it("WIDE margin (--editor-pr = 160 and 200): the bolt does NOT move and NEVER paints on the markers", () => {
    // THE task's headline regression: the old text-anchored bolt would slide to
    // `editorRight + 64`, i.e. INTO the markers, as the margin widened. The
    // pod-anchored bolt is fixed relative to podRight, so it is identical at
    // every margin width and stays disjoint from both pod-anchored columns.
    const boltAt104 = computeBoltLeftFromPod({
      podRight,
      editorRight: podRight - 104,
    });
    for (const pr of [160, 200]) {
      const editorRight = podRight - pr;
      const boltLeft = computeBoltLeftFromPod({ podRight, editorRight });
      expect(boltLeft).toBe(boltAt104); // margin-invariant
      const boltBand: [number, number] = [boltLeft, boltLeft + BOLT_SIZE];
      const [col0, col1] = absoluteColumns();
      expect(rangesIntersect(boltBand, col0)).toBe(false);
      expect(rangesIntersect(boltBand, col1)).toBe(false);
      // Strictly LEFT (inboard) of the markers, by the ratified gap.
      expect(col0[0] - boltBand[1]).toBe(MARGINALIA_BOLT_MARKER_GAP);
    }
  });

  it("the OLD text-anchored formula drifted with the margin and collided with the (old) markers; the new one does neither", () => {
    // The retired placement was `editorRight + (INNER_PAD + ICONS_BLOCK + GAP)`
    // (= +64) — TEXT-anchored, so it moved with the margin while the markers
    // (pod-anchored) did not. Reconstruct it at two margins:
    const OLD_FROM_TEXT =
      MARGINALIA_INNER_PAD + ICONS_BLOCK_WIDTH + MARGINALIA_BOLT_MARKER_GAP; // 64
    const oldBoltAt104 = (podRight - 104) + OLD_FROM_TEXT;
    const oldBoltAt160 = (podRight - 160) + OLD_FROM_TEXT;
    // (1) TEXT-anchored → margin-DEPENDENT: it slid 56px inboard as the margin
    // widened from 104→160 (the drift mechanism).
    expect(oldBoltAt104 - oldBoltAt160).toBe(56);

    // (2) At the wide margin it slid onto the OLD marker col0, which packed at
    // the raw INNER_PAD (container-relative 8 → [8,30]). Old bolt at 160 lands
    // at container-relative 8 too → a direct overlap.
    const oldCol0: [number, number] = [
      markerContainerLeft + MARGINALIA_INNER_PAD,
      markerContainerLeft + MARGINALIA_INNER_PAD + MARGINALIA_ICON_SIZE,
    ];
    const oldBoltBand160: [number, number] = [oldBoltAt160, oldBoltAt160 + BOLT_SIZE];
    expect(rangesIntersect(oldBoltBand160, oldCol0)).toBe(true); // the drift bug

    // The new pod-anchored bolt is margin-invariant AND clears the new markers.
    const newBoltAt104 = computeBoltLeftFromPod({ podRight, editorRight: podRight - 104 });
    const newBoltAt160 = computeBoltLeftFromPod({ podRight, editorRight: podRight - 160 });
    expect(newBoltAt104 - newBoltAt160).toBe(0); // no drift
    const newBoltBand: [number, number] = [newBoltAt160, newBoltAt160 + BOLT_SIZE];
    expect(absoluteColumns().some((c) => rangesIntersect(newBoltBand, c))).toBe(false);
  });

  it("CRAMPED code-view gutter (--editor-pr = 48, lane NOT reserved): the bolt tucks against the scrollbar, never over the prose", () => {
    const editorRight = podRight - CODE_VIEW_GUTTER_PX; // 48px gutter
    const boltLeft = computeBoltLeftFromPod({ podRight, editorRight });
    const boltBand: [number, number] = [boltLeft, boltLeft + BOLT_SIZE];
    // The inboard slot would land back over the prose; the fallback tucks the
    // bolt against the scrollbar instead.
    expect(boltLeft).toBe(
      podRight - SCROLLBAR_GUTTER - MARGINALIA_BOLT_SCROLLBAR_GAP - BOLT_SIZE,
    );
    // Its right edge clears the scrollbar by BOLT_SCROLLBAR_GAP...
    const scrollbarLeft = podRight - SCROLLBAR_GUTTER;
    expect(scrollbarLeft - boltBand[1]).toBe(MARGINALIA_BOLT_SCROLLBAR_GAP);
    // ...and its left edge stays in the gutter, clear of the prose (≥ INNER_PAD).
    expect(boltBand[0]).toBeGreaterThanOrEqual(
      editorRight + MARGINALIA_INNER_PAD,
    );
  });

  // Task 045: the cramped tuck is a fixed pod-offset (`podRight − 40`) that
  // ignores `editorRight`, so below the 48px gutter it overshoots back OVER the
  // prose. The invariant `boltLeft ≥ editorRight + INNER_PAD` must hold across
  // the WHOLE cramped range down to the min right margin (24) — not just at 48
  // where it held only with equality (that gap is why the overshoot shipped).
  // Reachable with the lane unreserved: zen mode (margin floored at MARGIN_MIN
  // = 24) and compressed code-split with a persisted right margin < 48.
  it.each([MARGIN_MIN.right, 32, 40, CODE_VIEW_GUTTER_PX])(
    "CRAMPED bolt clears the prose edge at right margin = %i (never left of editorRight + INNER_PAD)",
    (rightMargin) => {
      const podRight = 1000;
      const editorRight = podRight - rightMargin; // text edge = podRight − margin
      const boltLeft = computeBoltLeftFromPod({ podRight, editorRight });
      // Structural prose-clearance: the bolt's LEFT edge is never left of the
      // prose edge + INNER_PAD, so its 28px body can't paint over the selection.
      expect(boltLeft).toBeGreaterThanOrEqual(
        editorRight + MARGINALIA_INNER_PAD,
      );
    },
  );

  // MARGIN_MIN.right is the actual floor the reachable paths clamp to, so pin it
  // (a drift there would reopen the overshoot band from the bottom).
  it("MARGIN_MIN.right is the cramped floor this guards (24)", () => {
    expect(MARGIN_MIN.right).toBe(24);
  });
});

describe("right-margin geometry SSOT — min-margin floor (gated on marker visibility)", () => {
  it("the per-side min-floor equals the full lane width", () => {
    expect(MARGINALIA_MIN_MARGIN_RIGHT).toBe(MARGINALIA_MARGIN_WIDTH_RIGHT);
    expect(MARGINALIA_MIN_MARGIN_LEFT).toBe(MARGINALIA_MARGIN_WIDTH_LEFT);
    // Concrete pins so a stray edit to a pad is caught.
    expect(MARGINALIA_MIN_MARGIN_RIGHT).toBe(104);
    expect(MARGINALIA_MIN_MARGIN_LEFT).toBe(
      MARGINALIA_INNER_PAD + ICONS_BLOCK_WIDTH + MARGINALIA_OUTER_PAD_LEFT,
    );
  });

  it("the margin-edit horizontal floor RISES to the lane minimum ONLY when the lane is reserved", () => {
    // Reserved (editor, markers on, not zen): horizontal floors are the lane.
    expect(MARGIN_MIN_WITH_MARKERS.right).toBe(MARGINALIA_MIN_MARGIN_RIGHT);
    expect(MARGIN_MIN_WITH_MARKERS.left).toBe(MARGINALIA_MIN_MARGIN_LEFT);
    // Strictly higher than the unreserved base floors (the marker lane is
    // wider than the old loose minimums).
    expect(MARGIN_MIN_WITH_MARKERS.right).toBeGreaterThan(MARGIN_MIN.right);
    expect(MARGIN_MIN_WITH_MARKERS.left).toBeGreaterThanOrEqual(MARGIN_MIN.left);
    // Vertical floors are untouched — markers are a horizontal lane.
    expect(MARGIN_MIN_WITH_MARKERS.top).toBe(MARGIN_MIN.top);
    expect(MARGIN_MIN_WITH_MARKERS.bottom).toBe(MARGIN_MIN.bottom);
  });

  it("the unreserved base floors keep reading-mode freedom (zen / read-only reader)", () => {
    // When markers are hidden, the low base floors apply — the right margin
    // can shrink well below the lane width, so reading modes are not forced
    // into a wide margin.
    expect(MARGIN_MIN.right).toBeLessThan(MARGINALIA_MIN_MARGIN_RIGHT);
  });
});

describe("resolveHorizontalMargin — compressed-code-split comfort cap vs. marker floor", () => {
  // A doc saved with generous margins; well above both the 48 cap and the
  // 104/80 lane floor, so the resolution rules are what move the number.
  const WIDE = 160;

  it("NORMAL markers-on editor (not compressed): the marker floor applies — margins rise to the 104/80 lane", () => {
    const right = resolveHorizontalMargin(40, {
      compress: false,
      laneReserved: true,
      floor: MARGINALIA_MIN_MARGIN_RIGHT,
    });
    const left = resolveHorizontalMargin(40, {
      compress: false,
      laneReserved: true,
      floor: MARGINALIA_MIN_MARGIN_LEFT,
    });
    expect(right).toBe(MARGINALIA_MIN_MARGIN_RIGHT); // 104
    expect(left).toBe(MARGINALIA_MIN_MARGIN_LEFT); //  80
    // A wide saved margin is left untouched (floor only RAISES).
    expect(
      resolveHorizontalMargin(WIDE, {
        compress: false,
        laneReserved: true,
        floor: MARGINALIA_MIN_MARGIN_RIGHT,
      }),
    ).toBe(WIDE);
  });

  it("COMPRESSED code-split: the lane is NOT reserved, so the 48px comfort cap WINS (floor is NOT applied)", () => {
    const right = resolveHorizontalMargin(WIDE, {
      compress: true,
      laneReserved: false,
      floor: MARGINALIA_MIN_MARGIN_RIGHT,
    });
    const left = resolveHorizontalMargin(WIDE, {
      compress: true,
      laneReserved: false,
      floor: MARGINALIA_MIN_MARGIN_LEFT,
    });
    expect(right).toBe(CODE_VIEW_GUTTER_PX); // 48, NOT 104
    expect(left).toBe(CODE_VIEW_GUTTER_PX); //  48, NOT 80
    expect(right).toBeLessThan(MARGINALIA_MIN_MARGIN_RIGHT);
    expect(left).toBeLessThan(MARGINALIA_MIN_MARGIN_LEFT);
  });

  it("regression guard: the OLD (buggy) behavior — floor still reserved while compressed — would have pinned 104/80", () => {
    const oldBuggy = resolveHorizontalMargin(WIDE, {
      compress: true,
      laneReserved: true, // the bug: lane stayed reserved while compressed
      floor: MARGINALIA_MIN_MARGIN_RIGHT,
    });
    const fixed = resolveHorizontalMargin(WIDE, {
      compress: true,
      laneReserved: false, // the fix: lane opted OUT in compressed code-split
      floor: MARGINALIA_MIN_MARGIN_RIGHT,
    });
    expect(oldBuggy).toBe(MARGINALIA_MIN_MARGIN_RIGHT); // 104 — the lost width
    expect(fixed).toBe(CODE_VIEW_GUTTER_PX); // 48 — width preserved
    expect(fixed).toBeLessThan(oldBuggy);
  });

  it("compressed but lane STILL reserved (markers on, NOT code-split → never happens, but pins the priority): floor wins over cap", () => {
    expect(
      resolveHorizontalMargin(WIDE, {
        compress: true,
        laneReserved: true,
        floor: MARGINALIA_MIN_MARGIN_RIGHT,
      }),
    ).toBe(MARGINALIA_MIN_MARGIN_RIGHT);
  });

  it("CODE_VIEW_GUTTER_PX is the 48px comfort cap (kept in sync with SplitWithCode)", () => {
    expect(CODE_VIEW_GUTTER_PX).toBe(48);
    expect(CODE_VIEW_GUTTER_PX).toBeLessThan(MARGINALIA_MIN_MARGIN_LEFT);
    expect(CODE_VIEW_GUTTER_PX).toBeLessThan(MARGINALIA_MIN_MARGIN_RIGHT);
  });
});
