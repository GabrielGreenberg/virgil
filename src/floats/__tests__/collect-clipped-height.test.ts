// @vitest-environment jsdom
//
// Pins collectClippedHeight's one subtle rule (collapsed-lift grow, #20):
// overflow-visible elements are SKIPPED — their overflow already rides up
// into the nearest clipping ancestor's scrollHeight, so counting both
// would double the deficit.

import { describe, it, expect } from "vitest";
import { collectClippedHeight } from "../float-policy";

/** jsdom has no layout: stub the scroll/client metrics explicitly. */
function box(scrollHeight: number, clientHeight: number, overflowY: string): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
  el.style.overflowY = overflowY;
  return el;
}

describe("collectClippedHeight", () => {
  it("sums scrollHeight−clientHeight over clipping containers, root included", () => {
    const root = box(300, 100, "hidden"); // deficit 200
    const inner = box(150, 100, "auto"); // deficit 50
    root.appendChild(inner);
    document.body.appendChild(root);
    expect(collectClippedHeight(root)).toBe(250);
    root.remove();
  });

  it("skips overflow-visible descendants (their overflow rides up — no double count)", () => {
    const root = box(300, 100, "hidden"); // deficit 200
    const visible = box(180, 100, "visible"); // deficit 80 — must NOT count
    root.appendChild(visible);
    document.body.appendChild(root);
    expect(collectClippedHeight(root)).toBe(200);
    root.remove();
  });

  it("zero when nothing is clipped (already at natural height)", () => {
    const root = box(100, 100, "hidden");
    const inner = box(80, 80, "auto");
    root.appendChild(inner);
    document.body.appendChild(root);
    expect(collectClippedHeight(root)).toBe(0);
    root.remove();
  });

  it("root deficit never goes negative", () => {
    const root = box(50, 100, "hidden"); // client > scroll (padding edge cases)
    document.body.appendChild(root);
    expect(collectClippedHeight(root)).toBe(0);
    root.remove();
  });
});
