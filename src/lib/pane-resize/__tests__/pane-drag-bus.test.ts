// Pins the pane-drag bus's edge discipline: listeners fire exactly once on
// the begin edge and once on the end edge — never per frame, never twice —
// and stray/mismatched calls can't fake an edge. (The bus replaces
// library/lib/gutter-drag.ts + the editor's virgil:drag-gap-start/end window
// events; this suite is the successor of gutter-drag.test.ts's contract.)

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isPaneDragging,
  onPaneDragChange,
  beginPaneDrag,
  endPaneDrag,
  __resetPaneDragBusForTest,
  type PaneDragInfo,
} from "../pane-drag-bus";

const INFO: PaneDragInfo = { id: "lib-nav", axis: "x" };

beforeEach(() => {
  __resetPaneDragBusForTest();
});

describe("pane-drag-bus", () => {
  it("is idle by default", () => {
    expect(isPaneDragging()).toBe(false);
  });

  it("fires exactly one begin edge and one end edge per gesture", () => {
    const calls: Array<[boolean, PaneDragInfo]> = [];
    onPaneDragChange((active, info) => calls.push([active, info]));

    beginPaneDrag(INFO);
    expect(isPaneDragging()).toBe(true);
    endPaneDrag(INFO);
    expect(isPaneDragging()).toBe(false);

    expect(calls).toEqual([
      [true, INFO],
      [false, INFO],
    ]);
  });

  it("swallows a begin while a drag is already active (no double edge)", () => {
    const fn = vi.fn();
    onPaneDragChange(fn);
    beginPaneDrag(INFO);
    beginPaneDrag({ id: "other", axis: "y" });
    expect(fn).toHaveBeenCalledTimes(1);
    // The interloper's end must not clear the real drag either.
    endPaneDrag({ id: "other", axis: "y" });
    expect(isPaneDragging()).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("ignores an end with no active drag or a mismatched id", () => {
    const fn = vi.fn();
    onPaneDragChange(fn);
    endPaneDrag(INFO);
    expect(fn).not.toHaveBeenCalled();

    beginPaneDrag(INFO);
    fn.mockClear();
    endPaneDrag({ id: "someone-else", axis: "x" });
    expect(fn).not.toHaveBeenCalled();
    expect(isPaneDragging()).toBe(true);
  });

  it("unsubscribe stops notifications", () => {
    const fn = vi.fn();
    const off = onPaneDragChange(fn);
    off();
    beginPaneDrag(INFO);
    endPaneDrag(INFO);
    expect(fn).not.toHaveBeenCalled();
  });

  it("gives every subscriber the same edge (the park/settle contract)", () => {
    const a = vi.fn();
    const b = vi.fn();
    onPaneDragChange(a);
    onPaneDragChange(b);

    beginPaneDrag(INFO);
    endPaneDrag(INFO);

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
      if (isPaneDragging()) {
        dirty = true;
        return;
      }
      measures += 1;
    };
    onPaneDragChange((active) => {
      if (!active && dirty) {
        dirty = false;
        measures += 1;
      }
    });

    beginPaneDrag(INFO);
    // 60 pointermove frames worth of RO fires while dragging → all parked.
    for (let i = 0; i < 60; i++) observerFire();
    expect(measures).toBe(0);

    endPaneDrag(INFO); // one settle
    expect(measures).toBe(1);
  });
});
