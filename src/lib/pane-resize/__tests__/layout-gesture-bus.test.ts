// Pins the pane-drag bus's edge discipline: listeners fire exactly once on
// the begin edge and once on the end edge — never per frame, never twice —
// and stray/mismatched calls can't fake an edge. (The bus replaces
// library/lib/gutter-drag.ts + the editor's virgil:drag-gap-start/end window
// events; this suite is the successor of gutter-drag.test.ts's contract.)

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isLayoutGestureActive,
  onLayoutGestureChange,
  beginLayoutGesture,
  endLayoutGesture,
  __resetLayoutGestureBusForTest,
  type LayoutGestureInfo,
} from "../layout-gesture-bus";

const INFO: LayoutGestureInfo = { kind: "pane", id: "lib-nav", axis: "x" };

beforeEach(() => {
  __resetLayoutGestureBusForTest();
});

describe("layout-gesture-bus", () => {
  it("is idle by default", () => {
    expect(isLayoutGestureActive()).toBe(false);
  });

  it("fires exactly one begin edge and one end edge per gesture", () => {
    const calls: Array<[boolean, LayoutGestureInfo]> = [];
    onLayoutGestureChange((active, info) => calls.push([active, info]));

    beginLayoutGesture(INFO);
    expect(isLayoutGestureActive()).toBe(true);
    endLayoutGesture(INFO);
    expect(isLayoutGestureActive()).toBe(false);

    expect(calls).toEqual([
      [true, INFO],
      [false, INFO],
    ]);
  });

  it("swallows a begin while a drag is already active (no double edge)", () => {
    const fn = vi.fn();
    onLayoutGestureChange(fn);
    beginLayoutGesture(INFO);
    beginLayoutGesture({ kind: "pane", id: "other", axis: "y" });
    expect(fn).toHaveBeenCalledTimes(1);
    // The interloper's end must not clear the real drag either.
    endLayoutGesture({ kind: "pane", id: "other", axis: "y" });
    expect(isLayoutGestureActive()).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("ignores an end with no active drag or a mismatched id", () => {
    const fn = vi.fn();
    onLayoutGestureChange(fn);
    endLayoutGesture(INFO);
    expect(fn).not.toHaveBeenCalled();

    beginLayoutGesture(INFO);
    fn.mockClear();
    endLayoutGesture({ kind: "pane", id: "someone-else", axis: "x" });
    expect(fn).not.toHaveBeenCalled();
    expect(isLayoutGestureActive()).toBe(true);
  });

  it("unsubscribe stops notifications", () => {
    const fn = vi.fn();
    const off = onLayoutGestureChange(fn);
    off();
    beginLayoutGesture(INFO);
    endLayoutGesture(INFO);
    expect(fn).not.toHaveBeenCalled();
  });

  it("gives every subscriber the same edge (the park/settle contract)", () => {
    const a = vi.fn();
    const b = vi.fn();
    onLayoutGestureChange(a);
    onLayoutGestureChange(b);

    beginLayoutGesture(INFO);
    endLayoutGesture(INFO);

    expect(a.mock.calls).toEqual([
      [true, INFO],
      [false, INFO],
    ]);
    expect(b.mock.calls).toEqual([
      [true, INFO],
      [false, INFO],
    ]);
  });

  // Re-expressed from the retired gutter-drag.test.ts (task 090): the
  // consumer-side park→settle contract implemented against this bus —
  // parked fires stash a dirty bit, and the end edge reconciles exactly
  // once. The surviving tab-chrome consumer is PanelTabStrip's flush-right
  // tuck ResizeObserver (the PanelFolderTab / TabbedLibraryPanel observers
  // were DELETED outright with the measured-SVG chrome in Phase 3, not
  // parked); Phases 4/5 add reader/editor-side consumers of the same
  // protocol.
  it("models the park→settle cycle: a parked observer reconciles exactly once on release", () => {
    let measures = 0;
    let dirty = false;
    const observerFire = () => {
      if (isLayoutGestureActive()) {
        dirty = true;
        return;
      }
      measures += 1;
    };
    onLayoutGestureChange((active) => {
      if (!active && dirty) {
        dirty = false;
        measures += 1;
      }
    });

    beginLayoutGesture(INFO);
    // 60 pointermove frames worth of RO fires while dragging → all parked.
    for (let i = 0; i < 60; i++) observerFire();
    expect(measures).toBe(0);

    endLayoutGesture(INFO); // one settle
    expect(measures).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Perf Wave 2 — the content publisher, the set channel, and kind filtering.
// ---------------------------------------------------------------------------

import {
  beginContentGesture,
  endContentGesture,
  hasActiveLayoutGesture,
  onLayoutGestureSetChange,
} from "../layout-gesture-bus";

describe("content publisher (drop-mode sessions)", () => {
  it("begin/end publish ordinary bus edges with kind 'content'", () => {
    const calls: Array<[boolean, LayoutGestureInfo]> = [];
    onLayoutGestureChange((active, info) => calls.push([active, info]));
    beginContentGesture("float:card:note:n1");
    expect(isLayoutGestureActive()).toBe(true);
    expect(hasActiveLayoutGesture(["content"])).toBe(true);
    endContentGesture();
    expect(isLayoutGestureActive()).toBe(false);
    expect(calls.map(([a, i]) => [a, i.kind])).toEqual([
      [true, "content"],
      [false, "content"],
    ]);
  });

  it("is single-flight: a second begin while one is live is swallowed, and one end clears it", () => {
    beginContentGesture("a");
    beginContentGesture("b"); // programming error upstream — must not double-enter
    endContentGesture();
    expect(isLayoutGestureActive()).toBe(false);
  });

  it("end without a live content gesture is a no-op (idempotent cancel funnel)", () => {
    const calls: boolean[] = [];
    onLayoutGestureChange((active) => calls.push(active));
    endContentGesture();
    expect(calls).toEqual([]);
    // The double-end shape the controller actually produces: commit entry
    // ends it, then endDropSession ends it again.
    beginContentGesture("a");
    endContentGesture();
    endContentGesture();
    expect(calls).toEqual([true, false]);
  });
});

describe("hasActiveLayoutGesture — kind-filtered predicate", () => {
  it("answers per kind family, not per the whole set", () => {
    beginContentGesture("a");
    expect(hasActiveLayoutGesture(["pane", "window"])).toBe(false);
    expect(hasActiveLayoutGesture(["content"])).toBe(true);
    beginLayoutGesture(INFO); // pane joins
    expect(hasActiveLayoutGesture(["pane", "window"])).toBe(true);
    endLayoutGesture(INFO);
    // Content still live: resize-family predicate must flip back NOW.
    expect(hasActiveLayoutGesture(["pane", "window"])).toBe(false);
    expect(isLayoutGestureActive()).toBe(true);
    endContentGesture();
  });
});

describe("onLayoutGestureSetChange — every gesture's own edges, even under overlap", () => {
  it("delivers begin AND end per gesture where the main channel collapses to outermost", () => {
    const setCalls: Array<[boolean, string]> = [];
    const mainCalls: Array<[boolean, string]> = [];
    onLayoutGestureSetChange((began, info) => setCalls.push([began, `${info.kind}:${info.id}`]));
    onLayoutGestureChange((active, info) => mainCalls.push([active, `${info.kind}:${info.id}`]));

    // window begins → content begins → window ends → content ends.
    beginLayoutGesture({ kind: "window", id: "window", axis: "both" });
    beginContentGesture("drag-1");
    endLayoutGesture({ kind: "window", id: "window", axis: "both" });
    endContentGesture();

    // Main channel: only the outermost edges, carrying DIFFERENT gestures —
    // exactly why an info.kind filter there is unsound.
    expect(mainCalls).toEqual([
      [true, "window:window"],
      [false, "content:drag-1"],
    ]);
    // Set channel: all four membership changes, each with its own info.
    expect(setCalls).toEqual([
      [true, "window:window"],
      [true, "content:drag-1"],
      [false, "window:window"],
      [false, "content:drag-1"],
    ]);
  });
});
