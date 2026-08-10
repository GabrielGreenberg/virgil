/**
 * Lane regime — the CRAMPED margin (task 2026-07-22-214).
 *
 * Task 045 gave the selection bolt a cramped fallback: when the right margin is
 * too narrow to host its inboard slot, the bolt tucks against the scrollbar,
 * FLOORED at the prose edge, so `boltLeft ≥ editorRight + INNER_PAD` holds at
 * every margin. The parallel marker GRID never got the analogous regime — it
 * packed at the fixed 104-lane offsets whatever the margin was. So with the
 * lane un-reserved and the margin capped at the 48px code-view comfort gutter,
 * right col0 landed at `podRight − 62`, i.e. **14px inboard of the prose text
 * edge**, painting an opaque badge over the last words of every marked line.
 * No user action beyond opening the Code pane.
 *
 * The fix is ONE predicate, `laneSlotClearsProse(inset, available)`, asked by
 * every pod-anchored lane element with its own inset — the bolt's inboard slot
 * (96 ⇒ needs a 104px margin, byte-identical to the comparison it replaces) and
 * the marker grid's innermost painted edge (right 62 ⇒ 70; left 44 ⇒ 52). The
 * bolt TUCKS when it fails; the grid HIDES that side (a two-column grid has no
 * sub-lane left to tuck into, and zen / the read-only reader were already
 * documented to hide).
 *
 * These tests drive the REAL predicate into the REAL grid placement fn, so the
 * invariant they pin is the composition an actual render performs — not a
 * restatement of the arithmetic.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  MARGINALIA_INNER_PAD,
  MARGINALIA_ICON_SIZE,
  MARGINALIA_MARGIN_WIDTH_LEFT,
  MARGINALIA_MARGIN_WIDTH_RIGHT,
  MARGINALIA_GRID_X_RIGHT,
  MARGINALIA_GRID_X_LEFT,
  MARGINALIA_BOLT_X_RIGHT,
  MARGINALIA_BOLT_SIZE,
  MARGINALIA_BOLT_SCROLLBAR_GAP,
  CODE_VIEW_GUTTER_PX,
  computeBoltLeftFromPod,
  laneSlotClearsProse,
  marginGridInset,
  marginaliaEffectiveCols,
  markerGridFits,
  type AnchorNodeMetrics,
  type MarginaliaMarker,
} from "@/lib/marginalia";
import { computeMarkerPositions } from "@/lib/marginalia-grid";
import { SCROLLBAR_GUTTER } from "@/components/editor-layout/constants";
import { MARGIN_MIN } from "@/hooks/useMarginEdit";

/** A 3-line node, so both columns AND a second row are exercised. */
const NODE: AnchorNodeMetrics = {
  id: "p1",
  top: 0,
  domTop: 0,
  height: 72,
  lineHeight: 24,
  lineCount: 3,
  isAtom: false,
};

const POD_RIGHT = 1000;
const POD_LEFT = 0;

function markersOn(side: "left" | "right", n: number): MarginaliaMarker[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `m${i}:p1`,
    entityId: `m${i}`,
    type: "note" as const,
    textObjectId: "p1",
    side,
  }));
}

/**
 * Render `n` markers on `side` the way the app does: resolve the lane regime
 * from the MEASURED margin through `markerGridFits`, then hand the resolved
 * booleans to the real grid. Returns each cell's ABSOLUTE x-range plus the
 * prose text edge, in the same coordinate space (`cell.x` is relative to the
 * marker container, which is `podRight − WIDTH_RIGHT` / `podLeft`).
 */
function render(
  side: "left" | "right",
  available: number | null,
  n = 4,
  markers = markersOn(side, n),
) {
  const { positioned, overflowGroups, orphans } = computeMarkerPositions(
    (uuid) => (uuid === "p1" ? NODE : null),
    markers,
    {},
    {
      left: markerGridFits("left", side === "left" ? available : null),
      right: markerGridFits("right", side === "right" ? available : null),
    },
  );
  const containerLeft =
    side === "right" ? POD_RIGHT - MARGINALIA_MARGIN_WIDTH_RIGHT : POD_LEFT;
  const textEdge =
    available === null
      ? null
      : side === "right"
        ? POD_RIGHT - available
        : POD_LEFT + available;
  const boxes = [...positioned, ...overflowGroups].map(
    (p): [number, number] => [
      containerLeft + p.cell.x,
      containerLeft + p.cell.x + MARGINALIA_ICON_SIZE,
    ],
  );
  return { positioned, overflowGroups, orphans, boxes, textEdge };
}

describe("lane regime — the grid's inset is DERIVED from where the cells land", () => {
  it("right: the innermost painted edge is col0's LEFT edge (lane width − col0 offset)", () => {
    expect(marginGridInset("right")).toBe(
      MARGINALIA_MARGIN_WIDTH_RIGHT - MARGINALIA_GRID_X_RIGHT,
    );
    expect(marginGridInset("right")).toBe(62);
  });

  it("left: the innermost painted edge is the icon BLOCK's right edge, and the left grid is ONE column (the inner slot is the popout button's)", () => {
    expect(marginaliaEffectiveCols("left")).toBe(1);
    expect(marginaliaEffectiveCols("right")).toBe(2);
    expect(marginGridInset("left")).toBe(
      MARGINALIA_GRID_X_LEFT + MARGINALIA_ICON_SIZE,
    );
    expect(marginGridInset("left")).toBe(44);
    // Reserving the inner-left slot is exactly why the left threshold is NOT
    // the full lane width: a marker never lands in the 22px nearest the text.
    expect(marginGridInset("left")).toBeLessThan(MARGINALIA_MARGIN_WIDTH_LEFT);
  });

  it("the fit thresholds follow from inset + INNER_PAD (right 70, left 52)", () => {
    expect(markerGridFits("right", 69)).toBe(false);
    expect(markerGridFits("right", 70)).toBe(true);
    expect(markerGridFits("left", 51)).toBe(false);
    expect(markerGridFits("left", 52)).toBe(true);
  });
});

describe("lane regime — THE invariant: no marker cell ever paints over the prose", () => {
  // The grid analogue of `computeBoltLeftFromPod`'s `boltLeft ≥ editorRight +
  // INNER_PAD`. Swept over EVERY margin from 0 to 200 (well past the 104 lane),
  // both sides, with enough markers to force a second row and an overflow pill
  // — so the pill's reserved cell is covered by the same assertion.
  it.each(["left", "right"] as const)(
    "%s side: at every available margin, every cell (and the +K pill) clears the text edge by INNER_PAD",
    (side) => {
      let anyHidden = false;
      let anyShown = false;
      for (let available = 0; available <= 200; available++) {
        const { boxes, textEdge } = render(side, available, 9);
        if (boxes.length === 0) {
          anyHidden = true;
          continue;
        }
        anyShown = true;
        for (const [left, right] of boxes) {
          if (side === "right") {
            expect(left).toBeGreaterThanOrEqual(textEdge! + MARGINALIA_INNER_PAD);
          } else {
            expect(right).toBeLessThanOrEqual(textEdge! - MARGINALIA_INNER_PAD);
          }
        }
      }
      // The sweep is only meaningful if it crossed the regime boundary.
      expect(anyHidden).toBe(true);
      expect(anyShown).toBe(true);
    },
  );

  it("REGRESSION — at the 48px code-view gutter the pre-fix grid put right col0 14px INBOARD of the prose", () => {
    // Reconstruct the unconditional placement this fix retired: col0's absolute
    // left is `podRight − WIDTH_RIGHT + GRID_X_RIGHT` regardless of the margin.
    const oldCol0Left =
      POD_RIGHT - MARGINALIA_MARGIN_WIDTH_RIGHT + MARGINALIA_GRID_X_RIGHT;
    const textEdge = POD_RIGHT - CODE_VIEW_GUTTER_PX;
    expect(textEdge - oldCol0Left).toBe(14); // 14px of prose under an opaque badge
    // And the fixed grid renders nothing on that side instead.
    const { positioned, overflowGroups } = render("right", CODE_VIEW_GUTTER_PX, 9);
    expect(positioned).toHaveLength(0);
    expect(overflowGroups).toHaveLength(0);
  });

  it("the whole margin-edit floor range below the lane is covered (zen floors at MARGIN_MIN.right = 24)", () => {
    for (const available of [0, MARGIN_MIN.right, 32, CODE_VIEW_GUTTER_PX, 69]) {
      expect(render("right", available, 9).positioned).toHaveLength(0);
    }
  });
});

describe("lane regime — a hidden side hides its WHOLE column, and only that side", () => {
  it("the +K overflow pill and the orphan re-pin dock go with the cells", () => {
    const withOrphan: MarginaliaMarker[] = [
      ...markersOn("right", 9),
      {
        id: "orph:p1",
        entityId: "orph",
        type: "note",
        textObjectId: "p1",
        side: "right",
        unanchored: true,
      },
    ];
    // Lane-reserved: cells + a pill + the dock all render.
    const wide = render("right", MARGINALIA_MARGIN_WIDTH_RIGHT, 0, withOrphan);
    expect(wide.positioned.length).toBeGreaterThan(0);
    expect(wide.overflowGroups).toHaveLength(1);
    expect(wide.orphans).toHaveLength(1);
    // Cramped: nothing. The dock is pod-anchored inside the same column, so
    // leaving it behind would strand one badge in a lane the layout no longer
    // reserves — and at a narrow enough margin it paints on the prose too.
    const cramped = render("right", CODE_VIEW_GUTTER_PX, 0, withOrphan);
    expect(cramped.positioned).toHaveLength(0);
    expect(cramped.overflowGroups).toHaveLength(0);
    expect(cramped.orphans).toHaveLength(0);
  });

  it("the sides are independent — a cramped RIGHT margin never hides the LEFT markers", () => {
    const { positioned } = computeMarkerPositions(
      (uuid) => (uuid === "p1" ? NODE : null),
      [...markersOn("left", 2), ...markersOn("right", 2)],
      {},
      { left: markerGridFits("left", 120), right: markerGridFits("right", 48) },
    );
    expect(positioned.every((p) => p.side === "left")).toBe(true);
    expect(positioned).toHaveLength(2);
  });
});

describe("lane regime — an UNMEASURED frame fails OPEN", () => {
  // A zeroed viewport frame (pre-first-refresh, hidden pane, detached editor)
  // is indistinguishable from a zero-width margin. Hiding every marker there
  // would be a far worse failure than the overlap this guards, so `null` means
  // "render exactly as before this predicate existed".
  it("markerGridFits(side, null) is true on both sides", () => {
    expect(markerGridFits("left", null)).toBe(true);
    expect(markerGridFits("right", null)).toBe(true);
  });

  it("a NaN/Infinity available (a degenerate rect) also fails open", () => {
    expect(markerGridFits("right", Number.NaN)).toBe(true);
    expect(markerGridFits("right", Number.POSITIVE_INFINITY)).toBe(true);
  });

  it("with null, the grid places exactly what it placed at a full lane", () => {
    const unmeasured = render("right", null, 4);
    const reserved = render("right", MARGINALIA_MARGIN_WIDTH_RIGHT, 4);
    expect(unmeasured.positioned.map((p) => p.cell)).toEqual(
      reserved.positioned.map((p) => p.cell),
    );
    expect(unmeasured.positioned.length).toBeGreaterThan(0);
  });
});

describe("lane regime — the call site must ASK, and must measure the right element", () => {
  // The guard that catches the ORIGINAL shape. A test of the predicate alone
  // structurally cannot: the predicate was never the part that misbehaved —
  // the grid simply never asked. A REQUIRED param forces a value; only a grep
  // can say the value wasn't a hardcoded `true`.
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "__tests__") continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
    }
    return out;
  }

  const SRC = join(process.cwd(), "src");
  const LIBRARY = join(process.cwd(), "library");

  it("every production caller of computeMarkerPositions derives its lane fits from markerGridFits", () => {
    const callers = [...walk(SRC), ...walk(LIBRARY)]
      // The declaring module names itself; a declaration is not a call.
      .filter((f) => !f.endsWith("src/lib/marginalia-grid.ts"))
      .filter((f) => readFileSync(f, "utf8").includes("computeMarkerPositions("));
    // Exactly one production caller today (the renderer). If a second appears
    // it inherits the same obligation rather than an allowlist entry.
    expect(callers.map((f) => f.replace(process.cwd() + "/", ""))).toEqual([
      "src/components/Marginalia.tsx",
    ]);
    for (const f of callers) {
      const src = readFileSync(f, "utf8");
      expect(src, `${f} must ask the lane-regime SSOT`).toContain(
        "markerGridFits(",
      );
      // …and must not answer the question itself with a literal.
      expect(src).not.toMatch(/\{\s*left:\s*true\s*,\s*right:\s*true\s*\}/);
    }
  });

  it("the pod the fit MEASURES is the pod the markers are PINNED to (same element, two selectors)", () => {
    // `available` is `podRight − editorRight`, and that is only the room the
    // lane has because the marker container's positioning context IS the
    // element the geometry service measures. The two resolve it by different
    // selectors — the portal by `data-marginalia-host` (the marginalia SSOT),
    // the frame by the `.editor-pane-pod` class literal — so their coincidence
    // is a property of ONE JSX element, pinned here. If they ever split, the
    // failure is a silent total cull, not a type error.
    const pane = readFileSync(join(SRC, "components/EditorPane.tsx"), "utf8");
    const podIdx = pane.indexOf('className="editor-pane-pod"');
    expect(podIdx).toBeGreaterThan(-1);
    const attrIdx = pane.indexOf("MARGINALIA_HOST_ATTR]", podIdx);
    expect(attrIdx).toBeGreaterThan(-1);
    // Same JSX open tag: the attribute spread is on the very next lines.
    expect(pane.slice(podIdx, attrIdx).split("\n").length).toBeLessThanOrEqual(3);
    const frame = readFileSync(
      join(SRC, "lib/editor-geometry/viewport-frame.ts"),
      "utf8",
    );
    expect(frame).toContain('closest(".editor-pane-pod")');
  });
});

describe("lane regime — ONE predicate, two slots (the bolt keeps its exact behaviour)", () => {
  const BOLT_INSET = MARGINALIA_MARGIN_WIDTH_RIGHT - MARGINALIA_BOLT_X_RIGHT;

  it("the bolt's inset reduces the shared predicate to its old `margin ≥ 104` fork", () => {
    expect(BOLT_INSET).toBe(96);
    for (let available = 0; available <= 200; available++) {
      const editorRight = POD_RIGHT - available;
      const inboard =
        POD_RIGHT - MARGINALIA_MARGIN_WIDTH_RIGHT + MARGINALIA_BOLT_X_RIGHT;
      // The retired inline comparison, verbatim.
      const oldTakesInboard = inboard >= editorRight + MARGINALIA_INNER_PAD;
      expect(laneSlotClearsProse(BOLT_INSET, available)).toBe(oldTakesInboard);
      // …and the placement it feeds is unchanged at every margin. BOTH arms
      // are spelled out independently — an `else` branch that re-called the
      // function under test would be `f(x) === f(x)`, green whatever it
      // returned, which is exactly the shape this repo keeps finding in its
      // own guards.
      expect(computeBoltLeftFromPod({ podRight: POD_RIGHT, editorRight })).toBe(
        oldTakesInboard
          ? inboard
          : Math.max(
              POD_RIGHT -
                SCROLLBAR_GUTTER -
                MARGINALIA_BOLT_SCROLLBAR_GAP -
                MARGINALIA_BOLT_SIZE,
              editorRight + MARGINALIA_INNER_PAD,
            ),
      );
    }
  });

  it("the two thresholds differ BECAUSE the bolt is inboard of the markers: 70…103 shows markers with the bolt already tucked", () => {
    for (const available of [70, 80, 103]) {
      expect(markerGridFits("right", available)).toBe(true);
      expect(laneSlotClearsProse(BOLT_INSET, available)).toBe(false);
      // The markers that survive there still clear the prose — the invariant
      // above, restated at the interesting band.
      const { boxes, textEdge } = render("right", available, 4);
      expect(boxes.length).toBeGreaterThan(0);
      for (const [left] of boxes) {
        expect(left).toBeGreaterThanOrEqual(textEdge! + MARGINALIA_INNER_PAD);
      }
      // KNOWN RESIDUAL, stated rather than hidden: in this band the TUCKED
      // bolt ([podRight−40, podRight−12]) overlaps marker col1
      // ([podRight−34, podRight−12]) — the bolt tuck is a fixed pod-offset
      // that ignores the markers. Pre-existing and strictly NARROWED by this
      // change (before the cull it held for every margin below 104, markers
      // included); this suite asserts prose clearance, which is 214's scope,
      // and the bolt/marker overlap is filed separately.
      // And the tucked bolt clears the prose too (task 045's own invariant).
      const editorRight = POD_RIGHT - available;
      expect(
        computeBoltLeftFromPod({ podRight: POD_RIGHT, editorRight }),
      ).toBeGreaterThanOrEqual(editorRight + MARGINALIA_INNER_PAD);
    }
  });
});
