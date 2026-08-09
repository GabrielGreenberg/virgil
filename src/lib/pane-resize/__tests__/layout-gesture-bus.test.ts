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
