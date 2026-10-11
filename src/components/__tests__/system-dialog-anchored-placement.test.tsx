// @vitest-environment jsdom
//
// Task 1065: an anchored modal's placement is a MEASUREMENT of the frame it
// renders, clamped into the visible band — not a fixed 340×180 guess clamped
// from below only. Since task 976 every card-delete confirm opens anchored, and
// a keyboard Delete on a card scrolled above the fold used to open it off the
// top of the window.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { createRef } from "react";

vi.mock("@/lib/storage", () => ({ isDevStorage: true }));

import SystemDialog, { placeAnchoredFrame } from "../system-dialog";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const VIEW = { width: 1200, height: 800, insetTop: 0 };
const rect = (top: number, bottom: number, left = 500, right = 600) => ({
  top,
  bottom,
  left,
  right,
});

describe("placeAnchoredFrame", () => {
  it("prefers below the anchor, centred on it", () => {
    const p = placeAnchoredFrame({
      anchor: rect(100, 140),
      frame: { width: 340, height: 160 },
      viewport: VIEW,
    });
    expect(p).toEqual({ top: 148, left: 550 - 170 });
  });

  it("an anchor wholly above the viewport centres the frame (null)", () => {
    expect(
      placeAnchoredFrame({
        anchor: rect(-300, -260),
        frame: { width: 340, height: 160 },
        viewport: VIEW,
      }),
    ).toBeNull();
  });

  it("an anchor straddling the top clamps the frame to top ≥ 16", () => {
    const p = placeAnchoredFrame({
      anchor: rect(-200, 4),
      frame: { width: 340, height: 160 },
      viewport: VIEW,
    })!;
    expect(p.top).toBeGreaterThanOrEqual(16);
  });

  it("flips above when a tall frame does not fit below; never clips the bottom", () => {
    const p = placeAnchoredFrame({
      anchor: rect(700, 740),
      frame: { width: 340, height: 260 },
      viewport: VIEW,
    })!;
    expect(p.top + 260).toBeLessThanOrEqual(800 - 16);
    expect(p.top).toBe(700 - 8 - 260);
  });

  it("honours the window inset (WCO title bar) at the top", () => {
    const p = placeAnchoredFrame({
      anchor: rect(20, 60),
      frame: { width: 340, height: 600 },
      viewport: { ...VIEW, insetTop: 40 },
    })!;
    expect(p.top).toBeGreaterThanOrEqual(56);
  });

  it("an anchor hidden under the window inset counts as off-screen", () => {
    expect(
      placeAnchoredFrame({
        anchor: rect(0, 30),
        frame: { width: 340, height: 160 },
        viewport: { ...VIEW, insetTop: 40 },
      }),
    ).toBeNull();
  });

  it("clamps horizontally by the frame's real width", () => {
    const p = placeAnchoredFrame({
      anchor: rect(100, 140, 1150, 1190),
      frame: { width: 380, height: 160 },
      viewport: VIEW,
    })!;
    expect(p.left).toBe(1200 - 380 - 16);
  });
});

describe("SystemDialog anchored placement (measured)", () => {
  function renderAnchored(
    anchorRect: DOMRect,
    frameSize: { w: number; h: number },
    size: "sm" | "md" = "sm",
  ) {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(
      frameSize.w,
    );
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(
      frameSize.h,
    );
    const anchor = document.createElement("div");
    anchor.getBoundingClientRect = () => anchorRect;
    document.body.appendChild(anchor);
    const ref = createRef<HTMLElement>();
    (ref as { current: HTMLElement | null }).current = anchor;
    render(
      <SystemDialog open onClose={() => {}} anchorRef={ref} size={size}>
        <p>Delete this card?</p>
      </SystemDialog>,
    );
    return screen.getByText("Delete this card?").parentElement as HTMLElement;
  }

  const domRect = (top: number, bottom: number, left = 500, right = 600) =>
    ({ top, bottom, left, right, width: right - left, height: bottom - top, x: left, y: top }) as DOMRect;

  it("a scrolled-away anchor opens the confirm centred, not off-screen", () => {
    const frame = renderAnchored(domRect(-400, -360), { w: 340, h: 160 });
    expect(frame.style.position).toBe("");
    expect(frame.style.top).toBe("");
  });

  it("a tall frame near the bottom stays wholly on screen", () => {
    const ih = window.innerHeight;
    const frame = renderAnchored(domRect(ih - 60, ih - 20), { w: 340, h: 300 });
    const top = parseFloat(frame.style.top);
    expect(top + 300).toBeLessThanOrEqual(ih - 16);
    expect(top).toBeGreaterThanOrEqual(16);
  });

  it("size=md centres on the anchor by the measured md width", () => {
    const frame = renderAnchored(domRect(100, 140, 400, 500), { w: 380, h: 160 }, "md");
    expect(parseFloat(frame.style.left)).toBe(450 - 190);
    expect(parseFloat(frame.style.top)).toBe(148);
  });
});
