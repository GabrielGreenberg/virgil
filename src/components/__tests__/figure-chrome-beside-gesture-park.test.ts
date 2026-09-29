// @vitest-environment jsdom
/**
 * Task 837 — the figure chrome's "beside?" observer PARKS during a layout
 * gesture. Before it, every mounted figure re-ran the fit test (column style +
 * rect, chrome rect, a full block-frame resolve) on every frame of a pane drag
 * or window resize, for a chrome that is hover-hidden the whole time.
 *
 * Contract: while a layout gesture is live, a column/block resize schedules NO
 * recompute; the gesture's end edge replays exactly ONE; dispose() leaves the
 * bus with no listener and cancels a queued frame.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { watchChromeBeside } from "../figure-chrome-beside";
import {
  beginLayoutGesture,
  endLayoutGesture,
  __resetLayoutGestureBusForTest,
  __layoutGestureListenerCountForTest,
  type LayoutGestureInfo,
} from "@/lib/pane-resize/layout-gesture-bus";

const INFO: LayoutGestureInfo = { kind: "pane", id: "figure-837", axis: "x" };

// A ResizeObserver stand-in whose deliveries the test drives by hand.
const observers: FakeRO[] = [];
class FakeRO {
  cb: ResizeObserverCallback;
  targets = new Set<Element>();
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
    observers.push(this);
  }
  observe(el: Element) {
    this.targets.add(el);
  }
  unobserve(el: Element) {
    this.targets.delete(el);
  }
  disconnect() {
    this.targets.clear();
  }
  deliver() {
    this.cb([], this as unknown as ResizeObserver);
  }
}

// A manual frame queue, so "scheduled a recompute" is countable.
let frames: Array<() => void> = [];
function flushFrames() {
  const q = frames;
  frames = [];
  for (const f of q) f();
}

function mountFigure() {
  const column = document.createElement("div");
  const block = document.createElement("div");
  block.className = "figure-block";
  const chrome = document.createElement("div");
  chrome.className = "figure-chrome";
  block.appendChild(chrome);
  column.appendChild(block);
  document.body.appendChild(column);
  return { column, block };
}

beforeEach(() => {
  __resetLayoutGestureBusForTest();
  observers.length = 0;
  frames = [];
  vi.stubGlobal("ResizeObserver", FakeRO);
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    frames.push(() => fn(0));
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    frames = [];
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetLayoutGestureBusForTest();
  document.body.innerHTML = "";
});

describe("figure chrome beside — layout-gesture park (task 837)", () => {
  it("off-gesture: a resize schedules a recompute (the observer is live between gestures)", () => {
    const { block } = mountFigure();
    const onBeside = vi.fn();
    const dispose = watchChromeBeside(block, onBeside);
    flushFrames(); // the mount measure
    expect(onBeside).toHaveBeenCalledTimes(1);

    observers[0].deliver();
    expect(frames).toHaveLength(1);
    flushFrames();
    expect(onBeside).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("mid-gesture: N resize deliveries schedule NO recompute; the end edge replays exactly ONE", () => {
    const { block } = mountFigure();
    const onBeside = vi.fn();
    const dispose = watchChromeBeside(block, onBeside);
    flushFrames();
    onBeside.mockClear();

    beginLayoutGesture(INFO);
    for (let i = 0; i < 30; i++) observers[0].deliver(); // 30 drag frames
    expect(frames).toHaveLength(0);
    expect(onBeside).not.toHaveBeenCalled();

    endLayoutGesture(INFO);
    expect(frames).toHaveLength(1);
    flushFrames();
    expect(onBeside).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("a gesture with no resize replays nothing", () => {
    const { block } = mountFigure();
    const onBeside = vi.fn();
    const dispose = watchChromeBeside(block, onBeside);
    flushFrames();
    onBeside.mockClear();

    beginLayoutGesture(INFO);
    endLayoutGesture(INFO);
    expect(frames).toHaveLength(0);
    expect(onBeside).not.toHaveBeenCalled();
    dispose();
  });

  it("observes the block AND its column, and dispose() unsubscribes from the bus", () => {
    const { block, column } = mountFigure();
    const before = __layoutGestureListenerCountForTest();
    const dispose = watchChromeBeside(block, vi.fn());
    expect([...observers[0].targets]).toEqual([block, column]);
    expect(__layoutGestureListenerCountForTest()).toBe(before + 1);

    beginLayoutGesture(INFO);
    observers[0].deliver(); // parked
    dispose();
    expect(__layoutGestureListenerCountForTest()).toBe(before);
    expect(observers[0].targets.size).toBe(0);
    endLayoutGesture(INFO);
    expect(frames).toHaveLength(0); // the parked call was dropped, not replayed
  });
});
