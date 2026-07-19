// @vitest-environment jsdom
//
// The FocusBand edge-drag gesture (task 185). It is deliberately NOT on the
// pane-resize engine — a snap-to-row selection has no px value to apply — so
// it carries the engine's two pointer invariants at its own callsites, and
// this file pins them:
//
//   1. a mousemove with the PRIMARY BUTTON UP is a release we never observed
//      (over the PDF iframe, outside the window): the gesture ends THERE,
//      without incorporating that event's coordinate;
//   2. after that end, the band no longer tracks the pointer and the user's
//      NEXT CLICK commits nothing — the pre-185 bug wrote an onSnapBoundary
//      boundary the user never chose;
//   3. a non-primary press starts no gesture at all;
//   4. every exit (mouseup, failsafe, unmount) runs the SAME end path, so the
//      body cursor/user-select stamp is always cleared.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup, act } from "@testing-library/react";
import { useRef } from "react";

import { useFocusBandEdgeDrag, type FocusBandRow } from "../focus-band-drag";

// Deterministic RAF: callbacks queue until flushRaf(); cancel really cancels.
let rafSeq = 0;
let rafCallbacks = new Map<number, FrameRequestCallback>();
const flushRaf = () => {
  const cbs = [...rafCallbacks.values()];
  rafCallbacks.clear();
  for (const cb of cbs) cb(0);
};

beforeEach(() => {
  rafCallbacks = new Map();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafSeq += 1;
    rafCallbacks.set(rafSeq, cb);
    return rafSeq;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    rafCallbacks.delete(id);
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
});

// Three rows, 100px apart — a cursor at y snaps to the nearest `mid`.
const ROWS: FocusBandRow[] = [
  { blockIndex: 0, top: 0, mid: 50, bottom: 100 },
  { blockIndex: 5, top: 100, mid: 150, bottom: 200 },
  { blockIndex: 9, top: 200, mid: 250, bottom: 300 },
];

function setup() {
  const onSnapBoundary = vi.fn<(edge: "top" | "bottom", blockIndex: number) => void>();
  const setBand = vi.fn();
  const setAnimated = vi.fn();
  const restore = vi.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);

  const rendered = renderHook(() => {
    const isDraggingRef = useRef(false);
    const api = useFocusBandEdgeDrag({
      getScrollContainer: () => container,
      enabled: true,
      measureRows: () => ROWS,
      // Committed band = rows 0..5, i.e. top edge at 0px, bottom edge at 200px.
      getBand: () => ({ top: 0, height: 200 }),
      getRange: () => ({ startBlockIndex: 0, endBlockIndex: 5 }),
      minPx: 12,
      setBand,
      setAnimated,
      restore,
      setDragging: (dragging: boolean) => {
        isDraggingRef.current = dragging;
      },
      onSnapBoundary,
    });
    return { ...api, isDraggingRef };
  });

  const press = (edge: "top" | "bottom", button = 0) =>
    act(() => {
      rendered.result.current.startDrag(edge)({
        button,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent);
    });

  const move = (clientY: number, buttons = 1) =>
    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientY, buttons }));
      flushRaf();
    });

  const release = () =>
    act(() => {
      document.dispatchEvent(new MouseEvent("mouseup", { buttons: 0 }));
    });

  return { rendered, press, move, release, onSnapBoundary, setBand, restore, setAnimated };
}

describe("useFocusBandEdgeDrag — pointer invariants (task 185)", () => {
  it("ends the gesture on a mousemove with the primary button up", () => {
    const { press, move, rendered } = setup();
    press("bottom");
    expect(document.body.style.cursor).toBe("ns-resize");
    expect(rendered.result.current.isDraggingRef.current).toBe(true);

    move(250); // real drag onto row 9, button held
    move(50, 0); // released over the PDF iframe — we only see the move

    expect(rendered.result.current.isDraggingRef.current).toBe(false);
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });

  it("does NOT incorporate the failsafe event's coordinate (no ghost movement)", () => {
    const { press, move, setBand, onSnapBoundary } = setup();
    press("bottom");
    move(250); // last position with the button genuinely held → row 9
    setBand.mockClear();
    move(50, 0); // ghost coordinate — would snap to row 0 if it were read

    for (const call of setBand.mock.calls) {
      // Row 9's rect (top 0, bottom 300) — never row 0's collapsed one.
      expect(call[0]).toEqual({ top: 0, height: 300 });
    }
    // The gesture ends as a normal release at the last held row.
    expect(onSnapBoundary).toHaveBeenCalledTimes(1);
    expect(onSnapBoundary).toHaveBeenCalledWith("bottom", 9);
  });

  it("the next click after a missed release commits nothing (the durable harm)", () => {
    const { press, move, release, onSnapBoundary } = setup();
    press("bottom");
    move(250);
    move(50, 0); // failsafe ends it, committing row 9 once
    onSnapBoundary.mockClear();

    // The user's next click anywhere — pre-185 this ran the still-live mouseup
    // handler and wrote a boundary at wherever the cursor happened to be.
    move(50, 0);
    release();
    expect(onSnapBoundary).not.toHaveBeenCalled();
  });

  it("a non-primary press starts no gesture", () => {
    const { press, move, release, onSnapBoundary, rendered } = setup();
    press("bottom", 2); // right-press

    expect(rendered.result.current.isDraggingRef.current).toBe(false);
    expect(document.body.style.cursor).toBe("");
    move(250);
    release();
    expect(onSnapBoundary).not.toHaveBeenCalled();
  });

  it("still commits a normal drag, once, on mouseup", () => {
    const { press, move, release, onSnapBoundary } = setup();
    press("bottom");
    move(150); // snap to row 5 … then on to row 9
    move(250);
    release();
    expect(onSnapBoundary).toHaveBeenCalledTimes(1);
    expect(onSnapBoundary).toHaveBeenCalledWith("bottom", 9);
  });

  it("commits the painted row when release lands in the same frame as the move", () => {
    // The queued frame is flushed by the end path, so a fast drag-and-release
    // can't commit a stale (or null) row.
    const { press, release, onSnapBoundary, rendered } = setup();
    press("bottom");
    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientY: 250, buttons: 1 }));
    }); // no flushRaf — the frame is still pending
    release();
    expect(onSnapBoundary).toHaveBeenCalledWith("bottom", 9);
    expect(rendered.result.current.isDraggingRef.current).toBe(false);
  });

  it("restores the authoritative rect when the drag ends on its own row", () => {
    const { press, move, release, onSnapBoundary, restore } = setup();
    press("bottom");
    move(150); // row 5 IS the bottom edge's committed row → no-op drag
    release();
    expect(onSnapBoundary).not.toHaveBeenCalled();
    expect(restore).toHaveBeenCalled();
  });

  it("unmounting mid-gesture clears the body stamp and commits nothing", () => {
    const { press, move, rendered, onSnapBoundary } = setup();
    press("bottom");
    move(250);
    act(() => rendered.unmount());

    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
    expect(onSnapBoundary).not.toHaveBeenCalled();
  });
});
