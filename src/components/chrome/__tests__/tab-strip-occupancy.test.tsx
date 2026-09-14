// @vitest-environment jsdom
/**
 * THE TAB-STRIP OCCUPANCY LADDER — compress, then scroll (task 2026-09-13-561).
 *
 * Gabriel, from a crowded Virgil bar: tabs should compress to a reasonable
 * minimum as their number grows; the strip should scroll left/right like
 * Chrome/Safari; the current page's tab should always be scrolled into view.
 * The INNER Library strip already had exactly that ladder ("F#15"); the OUTER
 * bar strip had none of it and clipped its rightmost tabs away. This module is
 * the ONE implementation both strips read.
 *
 * jsdom has no layout, so every geometry here is STUBBED per element — a rect,
 * a `scrollWidth`/`clientWidth` pair — and what is asserted is the DECISION
 * each primitive makes from those numbers, plus the wiring the hook performs.
 * The real-browser halves (the seam overhang under `overflow-y: hidden`, the
 * wheel mapping's feel, the drop indicator at a non-zero scrollLeft) are a
 * preview eyeball, OWED and stated in the AGENTS.md section, not claimed here.
 */

import { describe, it, expect, afterEach } from "vitest";
import { useRef, type RefObject } from "react";
import { render, cleanup, act } from "@testing-library/react";
import {
  DRAG_EDGE_STEP_PX,
  DRAG_EDGE_ZONE_PX,
  INACTIVE_MIN_LABEL_PX,
  TAB_LABEL_ATTR,
  TAB_LABEL_FLOOR_MIN_WIDTH,
  autoScrollForDrag,
  clampIndicatorX,
  nudgeTabIntoView,
  tabRowNaturalWidth,
  useTabStripScroller,
  wheelToStripScroll,
} from "@/components/chrome/tab-strip-occupancy";
import { TAB_LABEL_MAX_PX } from "@/components/chrome/folder-tab-geometry";
import {
  __resetLayoutGestureBusForTest,
  beginContentGesture,
  endContentGesture,
} from "@/lib/pane-resize/layout-gesture-bus";

// ── Fixture helpers ─────────────────────────────────────────────────────────

type Rect = { left: number; right: number };

/** A scroll container with stubbed geometry. `scrollLeft` is jsdom's own
 *  settable property, so writes are observable without a spy. */
function scroller(opts: {
  clientWidth: number;
  scrollWidth: number;
  rect?: Rect;
  scrollLeft?: number;
}): HTMLDivElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "clientWidth", { value: opts.clientWidth, configurable: true });
  Object.defineProperty(el, "scrollWidth", { value: opts.scrollWidth, configurable: true });
  const r = opts.rect ?? { left: 0, right: opts.clientWidth };
  el.getBoundingClientRect = () =>
    ({ left: r.left, right: r.right, width: r.right - r.left, top: 0, bottom: 0, height: 0, x: r.left, y: 0, toJSON() {} }) as DOMRect;
  el.scrollLeft = opts.scrollLeft ?? 0;
  return el;
}

function box(rect: Rect): HTMLDivElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({ left: rect.left, right: rect.right, width: rect.right - rect.left, top: 0, bottom: 0, height: 0, x: rect.left, y: 0, toJSON() {} }) as DOMRect;
  return el;
}

function wheel(init: Partial<WheelEventInit>): WheelEvent {
  return new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaMode: 0, ...init });
}

// ── nudgeTabIntoView ────────────────────────────────────────────────────────

describe("nudgeTabIntoView — the minimum scrollLeft delta, never scrollIntoView", () => {
  it("scrolls RIGHT by exactly the overshoot when the tab hangs past the right edge", () => {
    const s = scroller({ clientWidth: 300, scrollWidth: 900, scrollLeft: 100 });
    const tab = box({ left: 250, right: 380 }); // 80px past the scroller's right edge
    expect(nudgeTabIntoView(s, tab)).toBe(80);
    expect(s.scrollLeft).toBe(180);
  });

  it("scrolls LEFT by exactly the shortfall when the tab starts before the left edge", () => {
    const s = scroller({ clientWidth: 300, scrollWidth: 900, scrollLeft: 400 });
    const tab = box({ left: -60, right: 40 });
    expect(nudgeTabIntoView(s, tab)).toBe(-60);
    expect(s.scrollLeft).toBe(340);
  });

  it("leaves a tab already in view alone (a stable strip does not creep)", () => {
    const s = scroller({ clientWidth: 300, scrollWidth: 900, scrollLeft: 120 });
    const tab = box({ left: 10, right: 120 });
    expect(nudgeTabIntoView(s, tab)).toBe(0);
    expect(s.scrollLeft).toBe(120);
  });

  it("does nothing at all above the floors (no overflow ⇒ nothing to scroll)", () => {
    // Above the floors the tabs SHARE the width; a rect that reads "past the
    // edge" there is a stale measurement, not a scroll target.
    const s = scroller({ clientWidth: 300, scrollWidth: 300, scrollLeft: 0 });
    const tab = box({ left: 250, right: 380 });
    expect(nudgeTabIntoView(s, tab)).toBe(0);
    expect(s.scrollLeft).toBe(0);
  });
});

// ── wheelToStripScroll ──────────────────────────────────────────────────────

describe("wheelToStripScroll — a vertical wheel over the strip scrolls it sideways", () => {
  it("maps deltaY onto scrollLeft and reports the event as consumed", () => {
    const s = scroller({ clientWidth: 300, scrollWidth: 900, scrollLeft: 100 });
    expect(wheelToStripScroll(s, wheel({ deltaY: 40 }))).toBe(true);
    expect(s.scrollLeft).toBe(140);
    expect(wheelToStripScroll(s, wheel({ deltaY: -60 }))).toBe(true);
    expect(s.scrollLeft).toBe(80);
  });

  it("clamps into [0, max] and does NOT consume a wheel that cannot move the strip", () => {
    // At the end the event must bubble exactly as before the listener
    // existed — a consumed no-op would swallow the page's own scroll.
    const s = scroller({ clientWidth: 300, scrollWidth: 900, scrollLeft: 580 });
    expect(wheelToStripScroll(s, wheel({ deltaY: 100 }))).toBe(true);
    expect(s.scrollLeft).toBe(600); // clamped at max
    expect(wheelToStripScroll(s, wheel({ deltaY: 100 }))).toBe(false);
    expect(s.scrollLeft).toBe(600);
    s.scrollLeft = 0;
    expect(wheelToStripScroll(s, wheel({ deltaY: -10 }))).toBe(false);
  });

  it("leaves a genuine HORIZONTAL gesture to the browser (trackpad swipe, Shift+wheel)", () => {
    // Chromium re-axes Shift+wheel into deltaX and already scrolls an
    // overflow-x:auto box for it; hijacking it would double-scroll.
    const s = scroller({ clientWidth: 300, scrollWidth: 900, scrollLeft: 100 });
    expect(wheelToStripScroll(s, wheel({ deltaX: 30, deltaY: 0 }))).toBe(false);
    expect(wheelToStripScroll(s, wheel({ deltaX: 30, deltaY: 5 }))).toBe(false);
    expect(s.scrollLeft).toBe(100);
  });

  it("never hijacks a pinch-zoom (ctrl+wheel) and ignores a strip with no overflow", () => {
    const s = scroller({ clientWidth: 300, scrollWidth: 900, scrollLeft: 100 });
    expect(wheelToStripScroll(s, wheel({ deltaY: 40, ctrlKey: true }))).toBe(false);
    expect(s.scrollLeft).toBe(100);
    const flat = scroller({ clientWidth: 300, scrollWidth: 300 });
    expect(wheelToStripScroll(flat, wheel({ deltaY: 40 }))).toBe(false);
  });

  it("scales a line-mode delta into pixels", () => {
    const s = scroller({ clientWidth: 300, scrollWidth: 900, scrollLeft: 0 });
    expect(wheelToStripScroll(s, wheel({ deltaY: 2, deltaMode: 1 }))).toBe(true);
    expect(s.scrollLeft).toBe(32);
  });
});

// ── autoScrollForDrag / clampIndicatorX ─────────────────────────────────────

describe("autoScrollForDrag — an HTML5 drag near an edge slides the hidden tabs into reach", () => {
  it("steps toward the edge the pointer is near, and only when the strip overflows", () => {
    const s = scroller({ clientWidth: 300, scrollWidth: 900, scrollLeft: 100, rect: { left: 50, right: 350 } });
    autoScrollForDrag(s, 350 - DRAG_EDGE_ZONE_PX + 1);
    expect(s.scrollLeft).toBe(100 + DRAG_EDGE_STEP_PX);
    autoScrollForDrag(s, 50 + DRAG_EDGE_ZONE_PX - 1);
    expect(s.scrollLeft).toBe(100);
    autoScrollForDrag(s, 200); // the middle: no movement
    expect(s.scrollLeft).toBe(100);
    const flat = scroller({ clientWidth: 300, scrollWidth: 300, scrollLeft: 0, rect: { left: 50, right: 350 } });
    autoScrollForDrag(flat, 349);
    expect(flat.scrollLeft).toBe(0);
  });
});

describe("clampIndicatorX — a drop past the scrolled-out boundary still paints at the edge", () => {
  it("clamps into the scroller's visible span, measured from the strip's left", () => {
    const s = scroller({ clientWidth: 300, scrollWidth: 900, rect: { left: 40, right: 340 } });
    // Strip root starts at viewport x=10, so the scroller's span is [30, 330).
    expect(clampIndicatorX(500, s, 10, 2)).toBe(328);
    expect(clampIndicatorX(-100, s, 10, 2)).toBe(30);
    expect(clampIndicatorX(100, s, 10, 2)).toBe(100);
    expect(clampIndicatorX(500, null, 10, 2)).toBe(500);
  });
});

// ── tabRowNaturalWidth ──────────────────────────────────────────────────────

describe("tabRowNaturalWidth — the natural width a compression has hidden", () => {
  function row(labels: Array<{ scrollWidth: number; clientWidth: number }>): HTMLDivElement {
    const el = document.createElement("div");
    for (const l of labels) {
      const span = document.createElement("span");
      span.setAttribute(TAB_LABEL_ATTR, "");
      Object.defineProperty(span, "scrollWidth", { value: l.scrollWidth });
      Object.defineProperty(span, "clientWidth", { value: l.clientWidth });
      el.appendChild(span);
    }
    return el;
  }

  it("ROOMY: the box IS the natural width (no label lost anything)", () => {
    const r = row([{ scrollWidth: 100, clientWidth: 100 }, { scrollWidth: 80, clientWidth: 80 }]);
    const s = scroller({ clientWidth: 500, scrollWidth: 500 });
    expect(tabRowNaturalWidth(r, s, 260)).toBe(260);
  });

  it("COMPRESSED: box + what each ellipsized label lost — the anti-oscillation number", () => {
    // The row sits at the scroller's 300px; its labels were 100 and 80 wide
    // and now show 60 and 50. The natural width is 300 + 40 + 30 = 370, and
    // THAT is what the bar's rule must be handed — the 300 would say "fits".
    const r = row([{ scrollWidth: 100, clientWidth: 60 }, { scrollWidth: 80, clientWidth: 50 }]);
    const s = scroller({ clientWidth: 300, scrollWidth: 300 });
    expect(tabRowNaturalWidth(r, s, 300)).toBe(370);
  });

  it("a label ellipsized by its CAP alone contributes only the cap", () => {
    // A 400px name shown at TAB_LABEL_MAX_PX is not compression — it was
    // capped before any squeeze, and the row's natural width already
    // reflects the cap.
    const r = row([{ scrollWidth: 400, clientWidth: TAB_LABEL_MAX_PX }]);
    const s = scroller({ clientWidth: 500, scrollWidth: 500 });
    expect(tabRowNaturalWidth(r, s, 260)).toBe(260);
    // …and a capped name squeezed further loses only cap − shown.
    const r2 = row([{ scrollWidth: 400, clientWidth: 90 }]);
    expect(tabRowNaturalWidth(r2, s, 260)).toBe(260 + (TAB_LABEL_MAX_PX - 90));
  });

  it("OVERFLOWING: the stick-out past the scroller is added on top of the deficit", () => {
    const r = row([{ scrollWidth: 100, clientWidth: INACTIVE_MIN_LABEL_PX }]);
    const s = scroller({ clientWidth: 300, scrollWidth: 420 });
    expect(tabRowNaturalWidth(r, s, 300)).toBe(300 + 80 + 120);
  });

  it("with no scroller bound (a bare mount) reads the box plus the deficit", () => {
    const r = row([{ scrollWidth: 100, clientWidth: 60 }]);
    expect(tabRowNaturalWidth(r, null, 200)).toBe(240);
  });
});

// ── The hook ────────────────────────────────────────────────────────────────

let observed: Array<{ el: Element; cb: ResizeObserverCallback }> = [];
const RealRO = globalThis.ResizeObserver;
class FakeRO {
  constructor(private cb: ResizeObserverCallback) {}
  observe(el: Element) {
    observed.push({ el, cb: this.cb });
  }
  unobserve(el: Element) {
    observed = observed.filter((o) => o.el !== el);
  }
  disconnect() {
    observed = observed.filter((o) => o.cb !== this.cb);
  }
}
function deliverWidth(el: Element, width: number) {
  act(() => {
    for (const o of observed) {
      if (o.el !== el) continue;
      o.cb([{ target: el, contentRect: { width } as DOMRectReadOnly } as ResizeObserverEntry], {} as ResizeObserver);
    }
  });
}
const nextFrame = () => act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });

function Strip({
  activeKey,
  tabCount,
  tabRefs,
  scrollerRef,
}: {
  activeKey: string | null;
  tabCount: number;
  tabRefs: RefObject<Map<string, HTMLElement>>;
  scrollerRef: RefObject<HTMLDivElement | null>;
}) {
  useTabStripScroller({ scrollerRef, tabRefs, activeKey, tabCount });
  return <div ref={scrollerRef} data-testid="scroller" />;
}

function Harness(props: { activeKey: string | null; tabCount: number; tabRefs: RefObject<Map<string, HTMLElement>> }) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  return <Strip {...props} scrollerRef={scrollerRef} />;
}

function stubScroller(el: HTMLElement, clientWidth: number, scrollWidth: number, rect: Rect) {
  Object.defineProperty(el, "clientWidth", { value: clientWidth, configurable: true });
  Object.defineProperty(el, "scrollWidth", { value: scrollWidth, configurable: true });
  el.getBoundingClientRect = () =>
    ({ left: rect.left, right: rect.right, width: rect.right - rect.left, top: 0, bottom: 0, height: 0, x: rect.left, y: 0, toJSON() {} }) as DOMRect;
}

describe("useTabStripScroller — the scroll half, wired", () => {
  afterEach(() => {
    cleanup();
    observed = [];
    globalThis.ResizeObserver = RealRO;
    __resetLayoutGestureBusForTest();
  });

  it("nudges the active tab into view on ACTIVATION, by the minimum delta, before paint (layout effect)", () => {
    globalThis.ResizeObserver = FakeRO as unknown as typeof ResizeObserver;
    const tabRefs = { current: new Map<string, HTMLElement>() };
    tabRefs.current.set("a", box({ left: 0, right: 100 }));
    tabRefs.current.set("c", box({ left: 600, right: 700 }));
    const { getByTestId, rerender } = render(<Harness activeKey="a" tabCount={3} tabRefs={tabRefs} />);
    const s = getByTestId("scroller");
    stubScroller(s, 300, 900, { left: 0, right: 300 });
    expect(s.scrollLeft).toBe(0);
    rerender(<Harness activeKey="c" tabCount={3} tabRefs={tabRefs} />);
    expect(s.scrollLeft, "activating an off-screen tab scrolls it into view").toBe(400);
  });

  it("re-nudges on a NEIGHBOUR's close (tab count), with the active key unchanged", () => {
    globalThis.ResizeObserver = FakeRO as unknown as typeof ResizeObserver;
    const tabRefs = { current: new Map<string, HTMLElement>() };
    const c = box({ left: 100, right: 200 });
    tabRefs.current.set("c", c);
    const { getByTestId, rerender } = render(<Harness activeKey="c" tabCount={3} tabRefs={tabRefs} />);
    const s = getByTestId("scroller");
    stubScroller(s, 300, 900, { left: 0, right: 300 });
    s.scrollLeft = 400;
    // A tab to its left closed: the row shifted and the active tab now starts
    // 50px before the scroller's left edge.
    c.getBoundingClientRect = () =>
      ({ left: -50, right: 50, width: 100, top: 0, bottom: 0, height: 0, x: -50, y: 0, toJSON() {} }) as DOMRect;
    rerender(<Harness activeKey="c" tabCount={2} tabRefs={tabRefs} />);
    expect(s.scrollLeft).toBe(350);
  });

  it("maps a vertical wheel over the scroller onto scrollLeft through a NON-passive listener", () => {
    globalThis.ResizeObserver = FakeRO as unknown as typeof ResizeObserver;
    const tabRefs = { current: new Map<string, HTMLElement>() };
    const { getByTestId } = render(<Harness activeKey={null} tabCount={0} tabRefs={tabRefs} />);
    const s = getByTestId("scroller");
    stubScroller(s, 300, 900, { left: 0, right: 300 });
    const e = wheel({ deltaY: 50 });
    s.dispatchEvent(e);
    expect(s.scrollLeft).toBe(50);
    expect(e.defaultPrevented, "a consumed wheel must not also scroll the page").toBe(true);
    // A horizontal gesture is NOT consumed — the browser scrolls it natively.
    const h = wheel({ deltaX: 20, deltaY: 0 });
    s.dispatchEvent(h);
    expect(h.defaultPrevented).toBe(false);
    expect(s.scrollLeft).toBe(50);
  });

  it("nudges on a strip RESIZE — RAF-coalesced, width-equality-bailed, and PARKED during a layout gesture", async () => {
    globalThis.ResizeObserver = FakeRO as unknown as typeof ResizeObserver;
    const tabRefs = { current: new Map<string, HTMLElement>() };
    const c = box({ left: 400, right: 500 });
    tabRefs.current.set("c", c);
    const { getByTestId } = render(<Harness activeKey="c" tabCount={1} tabRefs={tabRefs} />);
    const s = getByTestId("scroller");
    expect(observed.filter((o) => o.el === s).length, "ONE observer over the scroller's own box").toBe(1);
    stubScroller(s, 300, 900, { left: 0, right: 300 });
    s.scrollLeft = 0;
    // The window narrowed under the active tab.
    deliverWidth(s, 300);
    expect(s.scrollLeft, "the nudge is a FRAME away, not synchronous").toBe(0);
    await nextFrame();
    expect(s.scrollLeft).toBe(200);
    // Same width again: the equality bail schedules nothing.
    s.scrollLeft = 0;
    deliverWidth(s, 300);
    await nextFrame();
    expect(s.scrollLeft).toBe(0);
    // A width change DURING a layout gesture is parked and settles ONCE on the end edge.
    beginContentGesture("drag-1");
    deliverWidth(s, 280);
    deliverWidth(s, 260);
    await nextFrame();
    expect(s.scrollLeft, "no nudge mid-gesture").toBe(0);
    act(() => endContentGesture());
    await nextFrame();
    expect(s.scrollLeft).toBe(200);
  });
});

// ── The floor constant's own contract ───────────────────────────────────────

describe("the inactive-tab floor", () => {
  it("is a LABEL floor that never pads a name shorter than itself", () => {
    // `calc-size(max-content, min(size, N))`: the floor, but never wider than
    // the name — so the roomy layout is byte-identical to the pre-561 one.
    expect(TAB_LABEL_FLOOR_MIN_WIDTH).toBe(
      `calc-size(max-content, min(size, ${INACTIVE_MIN_LABEL_PX}px))`,
    );
    // Byte-neutral for the inner strip's plain closable tab: its old
    // tab-level floor was 60 with 40px of fixed chrome (14 + 4 padding, an
    // 18px close, 4px trailing pad).
    expect(INACTIVE_MIN_LABEL_PX).toBe(60 - 40);
  });
});
