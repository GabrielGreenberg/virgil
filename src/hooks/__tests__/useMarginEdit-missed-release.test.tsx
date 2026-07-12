// @vitest-environment jsdom
//
// Pins useMarginEdit's missed-release end edge (pane-drag-guardrail allowlist
// justification — the "engine-conformant by hand" claim). The gesture is
// window-mouse (no pointer capture: it pre-dates the engine and its 4-side
// axis tables live outside the single-value PaneResizeSpec shape), so a
// release delivered elsewhere — into the compiled-PDF iframe, or eaten by a
// cmd-tab focus loss — never fires window mouseup. Without the failsafes the
// guide ghost-resumes when the cursor re-enters, the body cursor stays
// wedged, and a later stray mouseup commits a margin the user never chose.
//
//   1. primary-button start gate — a non-primary mousedown starts nothing.
//   2. mid-move (buttons & 1) === 0 = missed release: commits the LAST LIVE
//      value, NOT the stray event's coordinate (no ghost movement), restores
//      the body cursor, and detaches — later moves are inert.
//   3. window blur = missed release: same end path.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type * as React from "react";

import { useMarginEdit, type MarginEditViewPrefs } from "@/hooks/useMarginEdit";

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
  document.body.style.cursor = "";
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function makeViewPrefs(): MarginEditViewPrefs {
  return {
    prefs: {
      editorLeftMargin: 88,
      editorRightMargin: 88,
      editorTopMargin: 40,
      editorBottomMargin: 40,
    },
    setEditorLeftMargin: vi.fn(),
    setEditorRightMargin: vi.fn(),
    setEditorTopMargin: vi.fn(),
    setEditorBottomMargin: vi.fn(),
  };
}

function makeHarness() {
  const col = document.createElement("div");
  col.setAttribute("data-editor-col", "");
  const frame = document.createElement("div");
  frame.setAttribute("data-margin-frame", "");
  const handle = document.createElement("div");
  frame.appendChild(handle);
  col.appendChild(frame);
  document.body.appendChild(col);
  // The drag measures against the guide-overlay frame rect.
  frame.getBoundingClientRect = () =>
    ({ left: 0, right: 800, top: 0, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

  const hook = renderHook(() => useMarginEdit({ viewPrefs: makeViewPrefs() }));

  const mouseDown = (button = 0) =>
    ({
      preventDefault: () => {},
      stopPropagation: () => {},
      button,
      currentTarget: handle,
      clientX: 0,
      clientY: 0,
    }) as unknown as React.MouseEvent<HTMLElement>;

  const move = (clientX: number, buttons: number) =>
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX, buttons }));
    });

  return { hook, col, mouseDown, move };
}

describe("useMarginEdit missed-release failsafes", () => {
  it("ignores a non-primary-button mousedown outright", () => {
    const h = makeHarness();
    act(() => h.hook.result.current.beginDrag(h.mouseDown(2), "right"));
    expect(document.body.style.cursor).toBe("");
    h.move(650, 1);
    flushRaf();
    expect(h.col.style.getPropertyValue("--editor-pr")).toBe("");
    expect(h.hook.result.current.liveMargins).toBeNull();
  });

  it("primary-button-up mid-move commits the last LIVE value, not the stray coordinate, and detaches", () => {
    const h = makeHarness();
    act(() => h.hook.result.current.beginDrag(h.mouseDown(), "right"));
    expect(document.body.style.cursor).toBe("ew-resize");

    // Live drag: right margin tracks 800 - clientX - 1 = 149.
    h.move(650, 1);

    // Missed release: buttons mask says primary is up. The pending 149 frame
    // is flushed and committed; the stray coordinate (400 → 399 → clamped
    // 240) must NOT be incorporated.
    h.move(400, 0);
    expect(h.hook.result.current.liveMargins?.right).toBe(149);
    expect(h.col.style.getPropertyValue("--editor-pr")).toBe("149px");
    expect(document.body.style.cursor).toBe("");

    // Detached: a later move (any buttons state) is inert.
    h.move(300, 1);
    flushRaf();
    expect(h.hook.result.current.liveMargins?.right).toBe(149);
    expect(h.col.style.getPropertyValue("--editor-pr")).toBe("149px");
  });

  it("window blur ends the gesture on the same commit path", () => {
    const h = makeHarness();
    act(() => h.hook.result.current.beginDrag(h.mouseDown(), "right"));
    h.move(700, 1);
    flushRaf();
    expect(h.col.style.getPropertyValue("--editor-pr")).toBe("99px");

    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(h.hook.result.current.liveMargins?.right).toBe(99);
    expect(document.body.style.cursor).toBe("");

    h.move(200, 1);
    flushRaf();
    expect(h.hook.result.current.liveMargins?.right).toBe(99);
  });
});
