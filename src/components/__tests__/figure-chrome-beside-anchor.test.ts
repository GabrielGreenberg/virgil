// @vitest-environment jsdom
/**
 * Task 663 — `BlockFrame.contentRight` had ZERO coverage, and its only consumer
 * — the figure chrome's "beside" anchor (chip 4b) — had no geometry test at all.
 *
 * The field exists so the chrome that sits BESIDE a figure hugs the rendered
 * image's right edge the way the grab handle hugs the marker on the LEFT: both
 * from ONE frame, with no parallel measurement to drift. Nothing said so. The
 * whole point of the field is a NEGATIVE — that the chrome does not measure its
 * own box — and a negative is what a census leg is for (the convention
 * `first-line-target-census.test.ts` set: no behavioural leg can see a second
 * consumer being wired to the wrong door, because that is precisely how such a
 * thing ships).
 *
 * Three claims:
 *   A. the CSS anchor and the JS fit test use the same gap (they are two halves
 *      of one decision, and the source says so in a comment on each side);
 *   B. the fit test's right edge comes from `resolveBlockFrame(...).contentRight`
 *      and the module takes no independent right-edge measure of the figure box;
 *   C. `contentRight` on the HUG box is the image's right edge and differs from
 *      the full-column `.react-renderer` host's — which is why passing the hug
 *      box is load-bearing and not an incidental choice.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveBlockFrame } from "@/text-objects/block-frame";
import {
  FIXTURE,
  buildFigure,
  stubCanvas,
} from "@/text-objects/__tests__/_block-frame-fixtures";

const SRC = join(process.cwd(), "src");
const VIEW = readFileSync(join(SRC, "components/FigureBlockNodeView.tsx"), "utf8");
const CSS = readFileSync(join(SRC, "app/globals.css"), "utf8");

beforeEach(() => {
  // A figure resolves an optical center like every other block, and that reads
  // font metrics off a canvas jsdom doesn't have. Stub it so the fixture is
  // silent rather than warning four times per run.
  stubCanvas();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("figure chrome — the beside anchor reads the frame (task 663)", () => {
  it("the JS fit gap and the CSS anchor gap are the same number", () => {
    const js = /const CHROME_BESIDE_GAP = (\d+);/.exec(VIEW);
    expect(js, "CHROME_BESIDE_GAP must still be a literal in the view").not.toBeNull();
    const rule =
      /\.figure-block \.figure-chrome\.figure-chrome-beside \{[^}]*\}/.exec(CSS);
    expect(rule, "the .figure-chrome-beside rule must still exist").not.toBeNull();
    const css = /left:\s*calc\(100% \+ (\d+)px\)/.exec(rule![0]);
    expect(css, "the rule must still anchor with calc(100% + <gap>)").not.toBeNull();
    // Two halves of ONE decision: the CSS places the row, the JS decides whether
    // it fits. A gap edited on one side alone silently paints the row off the
    // column or refuses a row that would have fitted.
    expect(css![1]).toBe(js![1]);
  });

  it("the fit test's right edge comes from the frame, not from its own box", () => {
    expect(VIEW).toContain("resolveBlockFrame(block).contentRight");
    // ...and nowhere does the module measure the figure box's own right edge for
    // this. `column.getBoundingClientRect().right` (the fit BOUNDARY, a sibling
    // paragraph's wrap edge) is a different question and stays a direct measure;
    // `block.getBoundingClientRect()` for the figure's own edge is the parallel
    // measurement `contentRight` exists to retire.
    expect(VIEW).not.toContain("block.getBoundingClientRect()");
  });

  it("contentRight on the HUG box is the image's edge, not the full-column host's", () => {
    // The chrome's one subtlety: a figure's `[data-uuid]` node DOM is the
    // full-COLUMN-width `.react-renderer` host — the box the drop indicator
    // correctly spans for a full-width insert bar — so the chrome resolves the
    // frame on the INNER `.figure-block` hug box, whose right edge IS the image.
    // Two different answers from one resolve; if they were equal, `resolveFirst-
    // LineTarget` would have been descended to the hug box instead and the
    // drop indicator's figure-adjacent bar would have shrunk to image width.
    const { host, hug } = buildFigure({ hugWidth: 220 });
    const hostRight = resolveBlockFrame(host).contentRight;
    const hugRight = resolveBlockFrame(hug).contentRight;
    expect(hostRight).toBe(FIXTURE.editorLeft + FIXTURE.width);
    expect(hugRight).toBe(FIXTURE.editorLeft + 220);
    expect(hugRight).toBeLessThan(hostRight);
  });

  it("a figure as wide as its column leaves no room beside it", () => {
    // The fit test the chrome actually performs, in the frame's own numbers:
    // `available = columnRight − contentRight − gap`. A hug box filling the
    // column yields a negative, which is what flips the row back to its
    // top-right overlay.
    const gap = Number(/const CHROME_BESIDE_GAP = (\d+);/.exec(VIEW)![1]);
    const columnRight = FIXTURE.editorLeft + FIXTURE.width;
    const { hug } = buildFigure({ hugWidth: FIXTURE.width });
    const available =
      columnRight - resolveBlockFrame(hug).contentRight - gap;
    expect(available).toBeLessThan(0);
    const narrow = buildFigure({ hugWidth: 200, uuid: "b2" });
    expect(
      columnRight - resolveBlockFrame(narrow.hug).contentRight - gap,
    ).toBeGreaterThan(0);
  });
});
