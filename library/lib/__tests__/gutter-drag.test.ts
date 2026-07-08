import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginGutterDrag,
  endGutterDrag,
  isGutterDragging,
  onGutterDragChange,
} from "@library/lib/gutter-drag";

// The module is a process-global singleton; make sure every test starts and
// leaves the flag cleared so ordering can't leak.
afterEach(() => {
  endGutterDrag();
});

describe("gutter-drag SSOT flag (task 090)", () => {
  it("starts cleared", () => {
    expect(isGutterDragging()).toBe(false);
  });

  it("begin sets the flag, end clears it", () => {
    beginGutterDrag();
    expect(isGutterDragging()).toBe(true);
    endGutterDrag();
    expect(isGutterDragging()).toBe(false);
  });

  it("notifies listeners only on the false→true / true→false EDGES (never per-frame)", () => {
    const seen: boolean[] = [];
    const unsub = onGutterDragChange((active) => seen.push(active));

    beginGutterDrag();
    beginGutterDrag(); // redundant — a second pointerdown while already dragging
    beginGutterDrag();
    expect(seen).toEqual([true]); // one edge, not three

    endGutterDrag();
    endGutterDrag(); // redundant
    expect(seen).toEqual([true, false]); // one clearing edge

    unsub();
  });

  it("gives every subscriber the same edge (the park/settle contract)", () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = onGutterDragChange(a);
    const unsubB = onGutterDragChange(b);

    beginGutterDrag();
    endGutterDrag();

    expect(a.mock.calls).toEqual([[true], [false]]);
    expect(b.mock.calls).toEqual([[true], [false]]);

    unsubA();
    unsubB();
  });

  it("stops notifying after unsubscribe", () => {
    const fn = vi.fn();
    const unsub = onGutterDragChange(fn);
    unsub();
    beginGutterDrag();
    endGutterDrag();
    expect(fn).not.toHaveBeenCalled();
  });

  it("models the park→settle cycle: a parked observer reconciles exactly once on release", () => {
    // Simulate an RO-backed observer that measures on every fire, but PARKS
    // (stashes dirty) while a gutter drag is active and settles once on the
    // clear edge — the pattern PanelFolderTab / TabbedLibraryPanel implement.
    let measures = 0;
    let dirty = false;
    const observerFire = () => {
      if (isGutterDragging()) {
        dirty = true;
        return;
      }
      measures += 1;
    };
    const unsub = onGutterDragChange((active) => {
      if (!active && dirty) {
        dirty = false;
        measures += 1;
      }
    });

    beginGutterDrag();
    // 60 pointermove frames worth of RO fires while dragging → all parked.
    for (let i = 0; i < 60; i++) observerFire();
    expect(measures).toBe(0);

    endGutterDrag(); // one settle
    expect(measures).toBe(1);

    unsub();
  });
});
