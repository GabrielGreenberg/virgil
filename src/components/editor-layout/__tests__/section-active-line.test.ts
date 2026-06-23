// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  SECTION_ACTIVE_LINE_FRACTION,
  scrollHeadingToActiveLine,
} from "../layout-scroll";

/**
 * OUT-#6: clicking a section in the Outline must land its heading on the SAME
 * line the position detector treats as "current" (SECTION_ACTIVE_LINE_FRACTION
 * of the viewport from the top), so the clicked section immediately registers
 * as current. The old jump used scrollIntoView({block:"center"}) — 0.5, below
 * the 0.25 detector line — so the prior section stuck. This pins the landing
 * math.
 */

function rect(top: number, height: number): DOMRect {
  return {
    top,
    height,
    bottom: top + height,
    left: 0,
    right: 300,
    width: 300,
    x: 0,
    y: top,
    toJSON() {},
  } as DOMRect;
}

describe("section active line", () => {
  let scrollEl: HTMLDivElement;
  let heading: HTMLDivElement;

  beforeEach(() => {
    scrollEl = document.createElement("div");
    scrollEl.setAttribute("data-virgil-row-scroll", "");
    scrollEl.style.overflowY = "auto";
    Object.defineProperty(scrollEl, "scrollHeight", { value: 5000, configurable: true });
    Object.defineProperty(scrollEl, "clientHeight", { value: 1000, configurable: true });
    scrollEl.scrollTop = 0;
    scrollEl.getBoundingClientRect = () => rect(0, 1000);

    heading = document.createElement("div");
    heading.getBoundingClientRect = () => rect(600, 30); // currently 60% down
    scrollEl.appendChild(heading);
    document.body.appendChild(scrollEl);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("uses a 0.25 fraction (matches the detector reference line)", () => {
    expect(SECTION_ACTIVE_LINE_FRACTION).toBe(0.25);
  });

  it("scrolls so the heading lands on (just above) the active line, not centered", () => {
    // active line = 1000 * 0.25 = 250; slack 8 → target 242.
    // heading at 600 must move up 358 → scrollTop 358 (was 0).
    scrollHeadingToActiveLine(heading, heading);
    expect(scrollEl.scrollTop).toBe(358);

    // The heading's resulting top (600 - 358 = 242) sits ABOVE the detector
    // line (250), so `headingTop <= referenceY` holds and it registers.
    expect(600 - scrollEl.scrollTop).toBeLessThan(1000 * SECTION_ACTIVE_LINE_FRACTION);
  });

  it("clamps to the top and never scrolls negative", () => {
    heading.getBoundingClientRect = () => rect(100, 30); // already near top
    scrollHeadingToActiveLine(heading, heading);
    expect(scrollEl.scrollTop).toBeGreaterThanOrEqual(0);
  });
});
