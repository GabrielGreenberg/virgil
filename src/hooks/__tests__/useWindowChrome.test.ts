// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { readWindowInsets, getWindowInsetTopPx } from "../useWindowChrome";

/**
 * Unit coverage for the WCO title-bar geometry math. This is the durable
 * proof: Window Controls Overlay only resolves in an installed desktop PWA,
 * so the visual behaviour can't be exercised in a browser tab / the dev
 * preview — the inset arithmetic (especially the right-gutter calc and the
 * visibility gate) is verified here instead.
 */

interface FakeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function setWCO(cfg: { visible: boolean; rect?: FakeRect } | null) {
  if (cfg === null) {
    delete (navigator as unknown as { windowControlsOverlay?: unknown }).windowControlsOverlay;
    return;
  }
  const rect = cfg.rect ?? { x: 0, y: 0, width: 0, height: 0 };
  Object.defineProperty(navigator, "windowControlsOverlay", {
    configurable: true,
    value: {
      visible: cfg.visible,
      getTitlebarAreaRect: () => rect as DOMRect,
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  });
}

function setViewportWidth(px: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: px });
}

afterEach(() => {
  setWCO(null);
  try {
    localStorage.removeItem("virgil:wco-debug");
  } catch {
    /* ignore */
  }
});

describe("readWindowInsets", () => {
  it("is all-zero when the UA has no windowControlsOverlay (normal tab)", () => {
    setWCO(null);
    expect(readWindowInsets()).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("is all-zero when WCO exists but is not currently visible", () => {
    setWCO({ visible: false, rect: { x: 80, y: 0, width: 600, height: 40 } });
    expect(readWindowInsets()).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("derives top/left/right from the visible title-bar rect", () => {
    // 820px viewport, free rect [x=80 .. x+width=680], height 40:
    //   left gutter  = x               = 80  (e.g. macOS traffic lights)
    //   right gutter = 820-(80+600)    = 140 (e.g. Chrome ⋮/puzzle/fold)
    //   top strip    = height          = 40
    setViewportWidth(820);
    setWCO({ visible: true, rect: { x: 80, y: 0, width: 600, height: 40 } });
    expect(readWindowInsets()).toEqual({ top: 40, right: 140, bottom: 0, left: 80 });
  });

  it("never returns a negative right gutter when the rect spans the viewport", () => {
    setViewportWidth(1000);
    setWCO({ visible: true, rect: { x: 0, y: 0, width: 1000, height: 33 } });
    const insets = readWindowInsets();
    expect(insets.right).toBe(0);
    expect(insets.left).toBe(0);
    expect(insets.top).toBe(33);
  });

  it("rounds sub-pixel rect values", () => {
    setViewportWidth(800);
    setWCO({ visible: true, rect: { x: 79.6, y: 0, width: 600.2, height: 39.4 } });
    const insets = readWindowInsets();
    expect(insets.left).toBe(80);
    expect(insets.top).toBe(39);
    // 800 - round-safe(79.6 + 600.2) → max(0, round(120.2)) = 120
    expect(insets.right).toBe(120);
  });

  it("honors the dev override regardless of WCO state", () => {
    localStorage.setItem("virgil:wco-debug", "1");
    setWCO(null);
    const insets = readWindowInsets();
    expect(insets.top).toBe(48);
    expect(insets.left).toBe(80);
    expect(insets.right).toBe(140);
  });
});

describe("getWindowInsetTopPx", () => {
  it("returns just the top strip height (the floating-panel clamp reads this)", () => {
    setViewportWidth(820);
    setWCO({ visible: true, rect: { x: 80, y: 0, width: 600, height: 40 } });
    expect(getWindowInsetTopPx()).toBe(40);
  });

  it("returns 0 in a normal tab so the clamp stays at the viewport top", () => {
    setWCO(null);
    expect(getWindowInsetTopPx()).toBe(0);
  });
});
