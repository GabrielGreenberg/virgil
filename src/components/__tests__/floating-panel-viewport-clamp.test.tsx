// @vitest-environment jsdom
//
// Task 1221 — a float can never be PLACED where its header is unreachable.
//
// Before: only the move gesture clamped. A persisted rect saved on a wider
// display, a spawn cascade (`indexHint * 24`) walked past the edge, or a window
// shrunk under a float all left the shell off-screen with no header to grab.
// After: ONE `clampFloatPos` rule is applied at the mount seed, at a re-seed from
// new props, at the window-resize settle (parked on the layout-gesture bus — one
// settle per OS window drag, not one per frame), and by the move gesture.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import FloatingPanel, {
  clampFloatPos,
  readFloatViewportBounds,
} from "@/components/FloatingPanel";

function setViewport(w: number, h: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: h });
}

beforeEach(() => setViewport(1280, 800));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Float({ x, y, mode = "floating" }: { x: number; y: number; mode?: "floating" | "docked" }) {
  return (
    <FloatingPanel
      cardKey="note:n1"
      mode={mode}
      surface="card"
      initialX={x}
      initialY={y}
      initialWidth={300}
      initialHeight={200}
      zIndex={1000}
      onChange={vi.fn()}
    >
      <div>float body</div>
    </FloatingPanel>
  );
}

const shell = () =>
  document.querySelector('[data-floating-panel="true"]') as HTMLElement;
const left = () => parseFloat(shell().style.left);
const top = () => parseFloat(shell().style.top);

describe("clampFloatPos — the one placement rule", () => {
  it("keeps the header reachable on every edge and is identity-preserving in bounds", () => {
    const b = { maxX: 1220, maxY: 760, insetTop: 0 };
    expect(clampFloatPos({ x: 2200, y: 100, width: 300 }, b)).toMatchObject({ x: 1220, y: 100 });
    expect(clampFloatPos({ x: -900, y: 100, width: 300 }, b)).toMatchObject({ x: -240 });
    expect(clampFloatPos({ x: 10, y: 5000, width: 300 }, b)).toMatchObject({ y: 760 });
    expect(clampFloatPos({ x: 10, y: -50, width: 300 }, { ...b, insetTop: 32 })).toMatchObject({ y: 32 });
    const inside = { x: 100, y: 100, width: 300 };
    expect(clampFloatPos(inside, b)).toBe(inside);
  });

  it("reads the live viewport", () => {
    setViewport(1000, 600);
    expect(readFloatViewportBounds()).toMatchObject({ maxX: 940, maxY: 560 });
  });
});

describe("FloatingPanel — placement is clamped at mount, re-seed and resize settle", () => {
  it("a restored rect from a wider display mounts on-screen", () => {
    render(<Float x={2200} y={100} />);
    expect(left()).toBe(1280 - 60);
    expect(top()).toBe(100);
  });

  it("a long spawn cascade stays in the viewport", () => {
    // FloatWindow's cascade: max(40, vh/2 - h/2 + indexHint*24) at indexHint=60.
    const y = Math.max(40, 800 / 2 - 200 / 2 + 60 * 24);
    const x = Math.max(40, 1280 / 2 - 300 / 2 + 60 * 24);
    render(<Float x={x} y={y} />);
    expect(left()).toBeLessThanOrEqual(1280 - 60);
    expect(top()).toBeLessThanOrEqual(800 - 40);
  });

  it("an in-bounds rect is untouched", () => {
    render(<Float x={200} y={150} />);
    expect(left()).toBe(200);
    expect(top()).toBe(150);
  });

  it("new props are re-seeded through the clamp", () => {
    const { rerender } = render(<Float x={200} y={150} />);
    rerender(<Float x={5000} y={5000} />);
    expect(left()).toBe(1220);
    expect(top()).toBe(760);
  });

  it("a one-shot window shrink pulls the shell back immediately", () => {
    render(<Float x={1100} y={600} />);
    expect(left()).toBe(1100);
    act(() => {
      setViewport(800, 500);
      window.dispatchEvent(new Event("resize"));
    });
    expect(left()).toBe(740);
    expect(top()).toBe(460);
  });

  it("a continuous window resize settles ONCE on its end edge, not per frame", () => {
    vi.useFakeTimers();
    render(<Float x={1100} y={600} />);
    act(() => {
      setViewport(1000, 700);
      window.dispatchEvent(new Event("resize"));
      setViewport(900, 650);
      window.dispatchEvent(new Event("resize"));
      setViewport(800, 500);
      window.dispatchEvent(new Event("resize"));
    });
    // Mid-gesture: the second event inside the burst window declared a gesture,
    // so the follow-up frames parked — the shell has not chased the edge.
    const midLeft = left();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(midLeft).not.toBe(740);
    expect(left()).toBe(740);
    expect(top()).toBe(460);
  });
});
