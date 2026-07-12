// Pins the park/settle protocol (plan §P3, task 090's successor): a trigger
// routed through parkDuringPaneDrag() runs straight through while no pane
// drag is live, is stashed during a gesture (LATEST args win), settles
// EXACTLY once on the end edge, and dispose() both unsubscribes and drops any
// parked call — an unmounted consumer can never settle into dead state.

import { describe, it, expect, vi, beforeEach } from "vitest";

import { parkDuringPaneDrag } from "../pane-drag-park";
import {
  beginPaneDrag,
  endPaneDrag,
  __resetPaneDragBusForTest,
  type PaneDragInfo,
} from "../pane-drag-bus";

const INFO: PaneDragInfo = { id: "gutter-under-test", axis: "x" };

beforeEach(() => {
  __resetPaneDragBusForTest();
});

describe("parkDuringPaneDrag", () => {
  it("passes calls straight through while idle (synchronously, args intact)", () => {
    const run = vi.fn();
    const park = parkDuringPaneDrag<[number, string]>(run);

    park.fire(7, "a");
    park.fire(8, "b");

    expect(run.mock.calls).toEqual([
      [7, "a"],
      [8, "b"],
    ]);
    park.dispose();
  });

  it("parks during a drag and settles exactly once on the end edge, latest args winning", () => {
    const run = vi.fn();
    const park = parkDuringPaneDrag<[number]>(run);

    beginPaneDrag(INFO);
    // 60 pointermove frames worth of observer fires — all parked.
    for (let i = 1; i <= 60; i++) park.fire(i);
    expect(run).not.toHaveBeenCalled();

    endPaneDrag(INFO);
    expect(run).toHaveBeenCalledExactlyOnceWith(60);
    park.dispose();
  });

  it("a zero-arg runner parked mid-drag still settles (the sentinel is null, not arg presence)", () => {
    const run = vi.fn();
    const park = parkDuringPaneDrag(run);

    beginPaneDrag(INFO);
    park.fire();
    expect(run).not.toHaveBeenCalled();

    endPaneDrag(INFO);
    expect(run).toHaveBeenCalledTimes(1);
    park.dispose();
  });

  it("an end edge with nothing parked runs nothing", () => {
    const run = vi.fn();
    const park = parkDuringPaneDrag(run);

    beginPaneDrag(INFO);
    endPaneDrag(INFO);

    expect(run).not.toHaveBeenCalled();
    park.dispose();
  });

  it("a settle clears the stash — the next gesture does not replay it, and post-settle fires pass through again", () => {
    const run = vi.fn();
    const park = parkDuringPaneDrag<[string]>(run);

    beginPaneDrag(INFO);
    park.fire("stale");
    endPaneDrag(INFO);
    expect(run).toHaveBeenCalledExactlyOnceWith("stale");

    // A clean second gesture must not resurrect the settled args.
    beginPaneDrag(INFO);
    endPaneDrag(INFO);
    expect(run).toHaveBeenCalledTimes(1);

    // And the park is back to idle passthrough.
    park.fire("fresh");
    expect(run).toHaveBeenLastCalledWith("fresh");
    expect(run).toHaveBeenCalledTimes(2);
    park.dispose();
  });

  it("dispose drops the parked call and unsubscribes — the end edge never settles a dead consumer", () => {
    const run = vi.fn();
    const park = parkDuringPaneDrag<[number]>(run);

    beginPaneDrag(INFO);
    park.fire(42);
    park.dispose();
    endPaneDrag(INFO);

    expect(run).not.toHaveBeenCalled();
  });

  it("parks are independent: each consumer settles with its own latest args", () => {
    const a = vi.fn();
    const b = vi.fn();
    const parkA = parkDuringPaneDrag<[string]>(a);
    const parkB = parkDuringPaneDrag<[string]>(b);

    beginPaneDrag(INFO);
    parkA.fire("a1");
    parkB.fire("b1");
    parkA.fire("a2");
    endPaneDrag(INFO);

    expect(a).toHaveBeenCalledExactlyOnceWith("a2");
    expect(b).toHaveBeenCalledExactlyOnceWith("b1");
    parkA.dispose();
    parkB.dispose();
  });
});
