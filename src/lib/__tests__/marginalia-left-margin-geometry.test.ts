/**
 * Task 670 — the LEFT-margin lane SSOT.
 *
 * The right margin has had an ordered band list since task 325, and
 * `marginalia-right-margin-geometry.test.ts` pins it. The LEFT margin had
 * PROSE: `MARGINALIA_OUTER_PAD_LEFT` was "widened to 22px to host the heading
 * fold-chevron in that strip", and the chevron's actual column was authored
 * only in `globals.css`. The two were never compared, because they are measured
 * from OPPOSITE EDGES — the marker grid from `podLeft`, the chevron from the
 * prose content edge — so they coincided at exactly one margin (88px, the
 * shipped `--editor-pl`) and overlapped at every value below it.
 *
 * At the pre-670 markers-on floor (80) the chevron's 14px box overlapped col0's
 * badge by 8px; at 72 (`MARGIN_MIN.left`, reachable with markers hidden) the
 * chevron sat entirely inside the badge. The badge is `pointer-events:auto`
 * inside a `zIndex:10` container while the chevron is `z-index:1` in a pod that
 * establishes no stacking context, so the overlap cost the chevron its CLICKS,
 * not just its pixels.
 *
 * The legs below are the left-margin counterparts of the right's: the lane is a
 * list, its sum IS the floor, and the sweep asserts disjointness at every margin
 * in `[0, MARGIN_MAX]` rather than at the one value the layout was tuned at.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LEFT_LANE_BANDS,
  LEFT_LANE_POD_WIDTH,
  LEFT_LANE_TEXT_WIDTH,
  leftLaneOffset,
  resolveLeftLane,
  resolveMarkerCols,
  marginaliaGridX,
  marginaliaEffectiveCols,
  marginGridInset,
  MARGINALIA_GRID_X_LEFT,
  MARGINALIA_ICON_SIZE,
  MARGINALIA_COL_GAP,
  MARGINALIA_OUTER_PAD_LEFT,
  MARGINALIA_INNER_PAD,
  MARGINALIA_MARGIN_WIDTH_LEFT,
  MARGINALIA_MIN_MARGIN_LEFT,
  MARGINALIA_CHEVRON_INSET,
  LANE_MEASUREMENT_EPSILON_PX,
  MARGIN_COL_CHEVRON_OFFSET,
  MARGIN_COL_CHEVRON_WIDTH,
  ICONS_BLOCK_WIDTH,
} from "@/lib/marginalia";
import { MARGIN_MIN, MARGIN_MAX, MARGIN_MIN_WITH_MARKERS } from "@/hooks/useMarginEdit";

/** True iff [aL,aR] and [bL,bR] overlap (share any x). */
function rangesIntersect(
  [aL, aR]: [number, number],
  [bL, bR]: [number, number],
): boolean {
  return aL < bR && bL < aR;
}

/**
 * The fold-chevron column's band in CONTAINER coordinates (origin `podLeft`) at
 * a given measured `available` margin. This reproduces the CSS, not the SSOT:
 * `.heading-fold-chevron` / `.source-pod-fold-chevron` are
 * `position:absolute; left: var(--margin-col-chevron)` inside a box whose left
 * edge IS the prose content edge, which sits `available` px right of `podLeft`.
 */
function chevronBand(available: number): [number, number] {
  const left = available + MARGIN_COL_CHEVRON_OFFSET;
  return [left, left + MARGIN_COL_CHEVRON_WIDTH];
}

/** The marker columns the LEFT grid actually renders at this margin, as
 *  container-relative [left,right] bands — walked at the same offsets `cellAt`
 *  packs against, via the RESOLVED column count. */
function leftColumnBands(available: number | null): Array<[number, number]> {
  const cols = resolveMarkerCols("left", available);
  const stride = MARGINALIA_ICON_SIZE + MARGINALIA_COL_GAP;
  return Array.from({ length: cols }, (_u, col): [number, number] => {
    const x = marginaliaGridX("left") + col * stride;
    return [x, x + MARGINALIA_ICON_SIZE];
  });
}

describe("left-margin geometry SSOT — the ordered band list", () => {
  it("every band declares the EDGE it is measured from, and both halves are non-empty", () => {
    // The finding in one assertion: this lane is not one stack, it is two
    // growing toward each other. A single-anchor list could not state it.
    const anchors = new Set(LEFT_LANE_BANDS.map((b) => b.anchor));
    expect(anchors).toEqual(new Set(["pod", "text"]));
    expect(LEFT_LANE_POD_WIDTH).toBeGreaterThan(0);
    expect(LEFT_LANE_TEXT_WIDTH).toBeGreaterThan(0);
  });

  it("the lane's two halves sum to the margin FLOOR (= 88), and the floor is no longer the container width", () => {
    const sum = LEFT_LANE_BANDS.reduce((s, b) => s + b.width, 0);
    expect(LEFT_LANE_POD_WIDTH + LEFT_LANE_TEXT_WIDTH).toBe(sum);
    expect(MARGINALIA_MIN_MARGIN_LEFT).toBe(sum);
    expect(MARGINALIA_MIN_MARGIN_LEFT).toBe(88);
    // The pre-670 identity `MIN === CONTAINER_WIDTH` was the hand-typed
    // coincidence: the container width counts an inner pad and a second
    // (reserved) column but no chevron at all.
    expect(MARGINALIA_MARGIN_WIDTH_LEFT).toBe(
      MARGINALIA_OUTER_PAD_LEFT + ICONS_BLOCK_WIDTH + MARGINALIA_INNER_PAD,
    );
    expect(MARGINALIA_MIN_MARGIN_LEFT).toBeGreaterThan(MARGINALIA_MARGIN_WIDTH_LEFT);
  });

  it("the bands are ordered, sequential and (within each anchor) non-overlapping", () => {
    let pod = 0;
    let text = 0;
    for (const band of LEFT_LANE_BANDS) {
      expect(band.width).toBeGreaterThan(0);
      if (band.anchor === "pod") {
        expect(leftLaneOffset(band.key)).toBe(pod);
        pod += band.width;
      } else {
        text += band.width;
      }
    }
    expect(pod).toBe(LEFT_LANE_POD_WIDTH);
    expect(text).toBe(LEFT_LANE_TEXT_WIDTH);
  });

  it("the marker grid's col0 x and its innermost edge are READ from the list, not re-derived", () => {
    expect(MARGINALIA_GRID_X_LEFT).toBe(leftLaneOffset("col0"));
    expect(MARGINALIA_GRID_X_LEFT).toBe(MARGINALIA_OUTER_PAD_LEFT);
    // The pod half IS the grid's innermost painted edge (task 214's inset).
    expect(marginGridInset("left")).toBe(LEFT_LANE_POD_WIDTH);
  });

  it("the chevron band is the TEXT half, and its inset is the CSS offset sign-flipped", () => {
    expect(leftLaneOffset("chevron")).toBe(
      MARGINALIA_CHEVRON_INSET - MARGIN_COL_CHEVRON_WIDTH,
    );
    expect(MARGINALIA_CHEVRON_INSET).toBe(-MARGIN_COL_CHEVRON_OFFSET);
    expect(LEFT_LANE_TEXT_WIDTH).toBe(MARGINALIA_CHEVRON_INSET);
  });

  it("unknown band keys throw rather than silently reading 0", () => {
    expect(() => leftLaneOffset("scrollbar")).toThrow(/unknown left-lane band/);
  });
});

describe("left-margin geometry SSOT — globals.css is a DERIVED output", () => {
  const CSS = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

  /** The authored value of a `--margin-*` custom property at the :root rung. */
  function authored(token: string): string {
    const m = new RegExp(`${token}:\\s*([^;]+);`).exec(CSS);
    return m ? m[1].trim() : "";
  }

  it("`--margin-col-chevron` / `--margin-col-chevron-width` match the lane SSOT's constants", () => {
    // The stylesheet is where the chevron is PLACED; the lane list is where its
    // column is DECLARED. Before 670 those were independent knobs — the whole
    // mechanism of the overlap. This leg is what keeps them one number, and it
    // is the reason `block-frame.ts` can take its token fallbacks from the SSOT.
    expect(authored("--margin-col-chevron")).toBe(`${MARGIN_COL_CHEVRON_OFFSET}px`);
    expect(authored("--margin-col-chevron-width")).toBe(`${MARGIN_COL_CHEVRON_WIDTH}px`);
  });
});

describe("left-margin geometry SSOT — disjointness across the whole margin range", () => {
  it("the chevron column and every rendered marker column are DISJOINT at every margin in [0, MARGIN_MAX]", () => {
    // Whole-pixel steps on purpose: the bands are TANGENT at the floor, and the
    // resolution deliberately tolerates a sub-pixel shortfall there
    // (`LANE_MEASUREMENT_EPSILON_PX` — see the tolerance leg below, which states
    // exactly what is accepted inside that half-pixel).
    const collisions: number[] = [];
    for (let available = 0; available <= MARGIN_MAX; available++) {
      const chevron = chevronBand(available);
      for (const col of leftColumnBands(available)) {
        if (rangesIntersect(chevron, col)) collisions.push(available);
      }
    }
    expect(collisions).toEqual([]);
  });

  it("the PRE-FIX placement collided for every margin in (52, 88) — the band this suite exists for", () => {
    // Reconstruct the retired answer: the left grid asked the prose-clearance
    // question ALONE (`marginGridInset("left")`), so it packed its full column
    // count at the fixed pod offsets wherever the margin still cleared the text.
    const preFixCols = (available: number) =>
      available - marginGridInset("left") >= MARGINALIA_INNER_PAD
        ? marginaliaEffectiveCols("left")
        : 0;
    const collided: number[] = [];
    for (let available = 0; available <= MARGIN_MAX; available++) {
      const chevron = chevronBand(available);
      const stride = MARGINALIA_ICON_SIZE + MARGINALIA_COL_GAP;
      for (let col = 0; col < preFixCols(available); col++) {
        const x = marginaliaGridX("left") + col * stride;
        if (rangesIntersect(chevron, [x, x + MARGINALIA_ICON_SIZE])) {
          collided.push(available);
          break;
        }
      }
    }
    // Exactly the open band the finding names: 53…87 inclusive.
    expect(collided[0]).toBe(53);
    expect(collided[collided.length - 1]).toBe(87);
    // …and the two values the finding calls out by name.
    expect(collided).toContain(80); // the pre-670 markers-on drag floor
    expect(collided).toContain(72); // MARGIN_MIN.left, reachable with markers hidden
  });

  it("at the FLOOR the chevron and col0 are exactly tangent — the lane is packed, not padded", () => {
    const [chevronLeft] = chevronBand(MARGINALIA_MIN_MARGIN_LEFT);
    const [col0] = leftColumnBands(MARGINALIA_MIN_MARGIN_LEFT);
    expect(col0[1]).toBe(chevronLeft);
    expect(chevronLeft).toBe(LEFT_LANE_POD_WIDTH);
  });

  it("a SUB-PIXEL-short measurement at the floor still renders the lane (the tangent-band tolerance)", () => {
    // The floor is the EXACT band sum, so the bands are tangent there. A
    // fractional DPR / browser zoom routinely measures 87.99 for an authored
    // 88; without the tolerance the left column would vanish at the shipped
    // `--editor-pl` on those displays.
    for (const available of [88 - 0.01, 88 - 0.25, 88 - 0.49]) {
      expect(resolveMarkerCols("left", available)).toBe(
        marginaliaEffectiveCols("left"),
      );
    }
    // …and the tolerance is sub-pixel, not a licence: a whole pixel short still
    // degrades, so the 8px sliver the finding names cannot come back.
    expect(resolveMarkerCols("left", 87)).toBe(0);
    expect(LANE_MEASUREMENT_EPSILON_PX).toBeLessThan(1);
  });

  it("ABOVE the floor nothing degrades: the shipped layout keeps its full column count", () => {
    for (const available of [88, 104, 140, MARGIN_MAX]) {
      expect(resolveMarkerCols("left", available)).toBe(
        marginaliaEffectiveCols("left"),
      );
    }
  });
});

describe("left-margin geometry SSOT — resolveLeftLane", () => {
  it("BELOW the floor the grid yields to the chevron (the outboard occupant places first)", () => {
    // 80 is the pre-670 floor — the 8px sliver that stole the chevron's clicks.
    expect(resolveLeftLane(80).markerCols).toBe(0);
    // 72 is MARGIN_MIN.left, where the chevron sat entirely inside the badge.
    expect(resolveLeftLane(72).markerCols).toBe(0);
    // 48 is the compressed code-view comfort gutter: already hidden pre-670 by
    // the prose-clearance question, and still hidden — the two guards agree.
    expect(resolveLeftLane(48).markerCols).toBe(0);
  });

  it("the chevron NEVER degrades — it holds its column at every margin, including 0", () => {
    for (const available of [0, 20, 48, 72, 80, 88, MARGIN_MAX]) {
      expect(resolveLeftLane(available).chevronX).toBe(
        available - MARGINALIA_CHEVRON_INSET,
      );
    }
  });

  it("an UNMEASURED margin fails OPEN to the reserved layout (the pre-predicate render)", () => {
    for (const unmeasured of [null, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = resolveLeftLane(unmeasured);
      expect(r.markerCols).toBe(marginaliaEffectiveCols("left"));
      expect(r.chevronX).toBe(MARGINALIA_MIN_MARGIN_LEFT - MARGINALIA_CHEVRON_INSET);
    }
  });

  it("`resolveMarkerCols(\"left\")` is the resolution — no call site re-derives it", () => {
    for (let available = 0; available <= MARGIN_MAX; available += 7) {
      expect(resolveMarkerCols("left", available)).toBe(
        resolveLeftLane(available).markerCols,
      );
    }
  });
});

describe("left-margin geometry SSOT — the drag floors", () => {
  it("the markers-on floor IS the lane sum, so the drag can never enter the overlap band", () => {
    expect(MARGIN_MIN_WITH_MARKERS.left).toBe(MARGINALIA_MIN_MARGIN_LEFT);
    expect(resolveMarkerCols("left", MARGIN_MIN_WITH_MARKERS.left)).toBe(
      marginaliaEffectiveCols("left"),
    );
  });

  it("the markers-OFF floor still holds the chevron's whole column (the structural half of MARGIN_MIN.left)", () => {
    // 72 is a hand-tuned comfort value; `MARGINALIA_CHEVRON_INSET` is the
    // requirement underneath it. The `Math.max` is what makes the requirement
    // bind if the comfort value is ever re-tuned downward.
    expect(MARGIN_MIN.left).toBeGreaterThanOrEqual(MARGINALIA_CHEVRON_INSET);
    const [chevronLeft] = chevronBand(MARGIN_MIN.left);
    expect(chevronLeft).toBeGreaterThanOrEqual(0); // never left of the pod edge
  });
});
