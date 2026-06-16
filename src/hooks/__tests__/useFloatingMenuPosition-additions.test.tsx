// @vitest-environment jsdom
//
// The Phase-B Menu-primitive additions to useFloatingMenuPosition (design
// §3.3): the optional `maxHeight` clamp + the `trackAnchor` RAF-coalesced
// scroll/resize re-anchor. The existing signature + behavior (a fixed-position
// style, off-screen-measure-then-place) must stay intact for current callers.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { useFloatingMenuPosition } from "../useFloatingMenuPosition";
import type { FloatingMenuPlacement } from "../useFloatingMenuPosition";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

// A menu element that reports a fixed measured size so placement math is
// deterministic. We stub getBoundingClientRect on the rendered element.
const MENU_W = 200;
const MENU_H = 300;

function stubMenuSize() {
  // Stub every div's rect to the menu size; the hook reads the menu element's.
  const proto = HTMLElement.prototype as unknown as {
    getBoundingClientRect: () => DOMRect;
  };
  proto.getBoundingClientRect = () =>
    ({ width: MENU_W, height: MENU_H, left: 0, top: 0, right: MENU_W, bottom: MENU_H, x: 0, y: 0, toJSON() {} }) as DOMRect;
}

interface HarnessProps {
  maxHeight?: boolean;
  trackAnchor?: () => DOMRect | null;
  anchorTop?: number;
}

function Harness({ maxHeight, trackAnchor, anchorTop = 100 }: HarnessProps) {
  const placements: FloatingMenuPlacement[] = [{ side: "below", align: "start" }];
  const anchorRect = {
    left: 100,
    top: anchorTop,
    right: 140,
    bottom: anchorTop + 20,
    width: 40,
    height: 20,
  };
  const { ref, style } = useFloatingMenuPosition({
    anchorRect,
    placements,
    maxHeight,
    trackAnchor,
  });
  // Spread the returned style onto the element so the test reads it back from
  // the live DOM (not via a render-time side effect).
  return (
    <div data-testid="menu" ref={ref as (el: HTMLDivElement | null) => void} style={style}>
      menu
    </div>
  );
}

/** Read the computed inline style off the rendered menu element. */
function menuStyle(): CSSStyleDeclaration {
  return (document.querySelector('[data-testid="menu"]') as HTMLElement).style;
}

beforeEach(() => {
  stubMenuSize();
  (window as unknown as { innerWidth: number }).innerWidth = 1000;
  (window as unknown as { innerHeight: number }).innerHeight = 800;
  // RAF synchronous so the trackAnchor coalescing fires within the test.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useFloatingMenuPosition — existing behavior intact", () => {
  it("returns a fixed-position style once measured (no maxHeight by default)", async () => {
    render(<Harness />);
    await act(async () => {
      await Promise.resolve(); // flush the queueMicrotask measure
    });
    expect(menuStyle().position).toBe("fixed");
    expect(menuStyle().maxHeight).toBe("");
    expect(menuStyle().overflowY).toBe("");
  });
});

describe("useFloatingMenuPosition — maxHeight clamp (§3.3)", () => {
  it("adds maxHeight + overflowY when maxHeight is on", async () => {
    // anchor below at top=100, bottom=120; placement "below" → space from
    // bottom+gap(6)=126 to vh(800)-margin(8)=792 → 666px available.
    render(<Harness maxHeight />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(menuStyle().overflowY).toBe("auto");
    expect(menuStyle().maxHeight).toBe(`${800 - 8 - (120 + 6)}px`);
  });
});

describe("useFloatingMenuPosition — trackAnchor re-anchor (§3.3)", () => {
  it("re-reads the anchor on scroll via the trackAnchor thunk", async () => {
    const thunk = vi.fn(
      () =>
        ({ left: 100, top: 100, right: 140, bottom: 120, width: 40, height: 20, x: 100, y: 100, toJSON() {} }) as DOMRect,
    );
    render(<Harness trackAnchor={thunk} />);
    await act(async () => {
      await Promise.resolve();
    });
    const callsBefore = thunk.mock.calls.length;
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(thunk.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("does NOT install a scroll listener when trackAnchor is absent", async () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    render(<Harness />);
    await act(async () => {
      await Promise.resolve();
    });
    const scrollSubs = addSpy.mock.calls.filter((c) => c[0] === "scroll");
    expect(scrollSubs).toHaveLength(0);
    addSpy.mockRestore();
  });
});
