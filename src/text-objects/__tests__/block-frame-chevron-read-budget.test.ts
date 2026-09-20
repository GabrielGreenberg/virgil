// @vitest-environment jsdom
/**
 * Task 662 — what the chevron branch of `resolveBlockFrame` COSTS, and which
 * element it reads from.
 *
 * `block-frame.ts` exists so every margin affordance reads ONE measurement and
 * they align by construction. The chevron tail broke that promise about its own
 * work twice over:
 *
 *   1. it took `el.getBoundingClientRect()` unconditionally, and for the kinds
 *      where the frame's text target IS the block (`texBlock` / `forestBlock` —
 *      the source pods, whose node DOM matches no wrapper branch of
 *      `resolveInlineContextElement`) that rect had ALREADY been measured one
 *      screen up as `firstLineRect`. Two reads of one element per resolve, on
 *      the hover/scroll/RAF placement path, on every pod hover. Not a degraded
 *      render — the normal case.
 *   2. it handed `resolveChevronColumnRight` the TARGET's computed style while
 *      taking the offset's ORIGIN from `el`'s rect. Those are the same element
 *      for a pod and different elements for a heading, and the offset is
 *      measured FROM the origin — so a per-block override was read off the
 *      wrong box. It worked only because the shipped tokens are `:root` px
 *      literals that inherit, which is a fact about the stylesheet, not a
 *      contract the function stated.
 *
 * Counted per ELEMENT rather than as a total, so each leg names the duplicate
 * rather than pinning an incidental sum (the convention
 * `grab-handle-typing-cost.test.tsx` set for the list arms).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveBlockFrame } from "@/text-objects/block-frame";

const CHEVRON_OFFSET = -44;
const CHEVRON_WIDTH = 14;

/** Elements whose rect reads we are counting, in call order. */
let rectReads: HTMLElement[] = [];

function countOf(reads: HTMLElement[], el: HTMLElement): number {
  return reads.filter((r) => r === el).length;
}

/** Give `el` a stubbed box (jsdom lays nothing out) and count every read. */
function stubRect(el: HTMLElement, left: number, width = 600): void {
  el.getBoundingClientRect = () => {
    rectReads.push(el);
    return {
      left,
      right: left + width,
      top: 0,
      bottom: 40,
      width,
      height: 40,
      x: left,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };
}

function mountBlock(el: HTMLElement): void {
  el.setAttribute("data-uuid", "b1");
  document.body.appendChild(el);
}

/** A source pod: the `[data-uuid]` node DOM IS the `.react-renderer` wrapper,
 *  which matches no descent branch — so the frame's target is the block. */
function makeSourcePod(kind: "texBlock" | "forestBlock", left: number) {
  const el = document.createElement("div");
  el.className = "react-renderer";
  el.setAttribute("data-text-object-kind", kind);
  el.style.setProperty("--margin-col-chevron", `${CHEVRON_OFFSET}px`);
  el.style.setProperty("--margin-col-chevron-width", `${CHEVRON_WIDTH}px`);
  mountBlock(el);
  stubRect(el, left);
  return el;
}

/** A heading: the block element is the `.heading-wrapper`, the frame's text
 *  target is the inner `<hN>` — two genuinely different boxes. */
function makeHeading(left: number, headingLeft: number) {
  const wrapper = document.createElement("div");
  wrapper.className = "heading-wrapper";
  wrapper.setAttribute("data-text-object-kind", "heading");
  const h = document.createElement("h2");
  wrapper.appendChild(h);
  mountBlock(wrapper);
  stubRect(wrapper, left);
  stubRect(h, headingLeft, 500);
  return { wrapper, h };
}

beforeEach(() => {
  rectReads = [];
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("resolveBlockFrame — chevron read budget (task 662)", () => {
  it("measures a source pod's block element ONCE, not twice", () => {
    const el = makeSourcePod("texBlock", 200);
    const frame = resolveBlockFrame(el);

    expect(
      countOf(rectReads, el),
      "the pod's rect answers both the first line and the chevron origin — one read",
    ).toBe(1);
    // ...and the answer is the one the second read used to produce.
    expect(frame.chevronRight).toBeCloseTo(200 + CHEVRON_OFFSET + CHEVRON_WIDTH, 5);
    expect(frame.firstLineRect.left).toBe(200);
  });

  it("holds for the other pod kind (forestBlock takes the same branch)", () => {
    const el = makeSourcePod("forestBlock", 120);
    const frame = resolveBlockFrame(el);
    expect(countOf(rectReads, el)).toBe(1);
    expect(frame.chevronRight).toBeCloseTo(120 + CHEVRON_OFFSET + CHEVRON_WIDTH, 5);
  });

  it("still pays the second read for a HEADING — there the boxes differ", () => {
    // A NET (passes pre-fix too). The point of the fix is not "never read
    // twice", it is "never read the SAME element twice": a heading's wrapper
    // and its <h2> are different boxes, so one read each is the FLOOR. Stated
    // so a later "optimization" that collapses them reads as the regression
    // it would be.
    const { wrapper, h } = makeHeading(200, 210);
    const frame = resolveBlockFrame(wrapper);
    expect(countOf(rectReads, wrapper)).toBe(1);
    expect(countOf(rectReads, h)).toBe(1);
    expect(frame.chevronRight).toBeCloseTo(200 + CHEVRON_OFFSET + CHEVRON_WIDTH, 5);
  });

  it("a row that reserves no chevron pays NO rect read for one", () => {
    const p = document.createElement("p");
    p.setAttribute("data-text-object-kind", "paragraph");
    mountBlock(p);
    stubRect(p, 200);
    const frame = resolveBlockFrame(p);
    expect(frame.chevronRight).toBeNull();
    expect(countOf(rectReads, p), "only the first-line read").toBe(1);
  });
});

describe("resolveBlockFrame — chevron token provenance (task 662)", () => {
  it("reads the tokens off the element the offset is measured FROM", () => {
    // A NET, not the finding: an override on the wrapper INHERITS down to the
    // <h2>, so the old code read the same number off the wrong element and
    // this leg passes pre-fix. It is here to pin the direction the fix must
    // not lose; the leg below is the one that fails on the old code.
    const { wrapper } = makeHeading(200, 210);
    wrapper.style.setProperty("--margin-col-chevron", "-60px");
    wrapper.style.setProperty("--margin-col-chevron-width", "20px");
    const frame = resolveBlockFrame(wrapper);
    expect(frame.chevronRight).toBeCloseTo(200 - 60 + 20, 5);
  });

  it("an override on the TEXT TARGET alone does not move the column", () => {
    // The mirror of the leg above, and the one that actually fails on the old
    // code: the <h2> is not the origin, so its own value must not be read.
    const { wrapper, h } = makeHeading(200, 210);
    wrapper.style.setProperty("--margin-col-chevron", `${CHEVRON_OFFSET}px`);
    wrapper.style.setProperty("--margin-col-chevron-width", `${CHEVRON_WIDTH}px`);
    h.style.setProperty("--margin-col-chevron", "-999px");
    h.style.setProperty("--margin-col-chevron-width", "999px");
    const frame = resolveBlockFrame(wrapper);
    expect(frame.chevronRight).toBeCloseTo(200 + CHEVRON_OFFSET + CHEVRON_WIDTH, 5);
  });
});
