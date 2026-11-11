// @vitest-environment jsdom
//
// Task 1568 — **a press and release in one place is a click, and a click
// decides nothing.**
//
// `FloatingPanel`'s end edge ran every release through the Stack test, the
// redock test and the persistence commit without asking whether the pointer
// had moved. All three answer from where the float RESTS, so a click on the
// header could capture a float parked over the StackIcon, redock one resting
// near a dock, or store a rect the viewport clamp had narrowed as though the
// user had chosen it. Task 470 closed this class for the resize engine; this
// bespoke gesture did not inherit it.
//
// Each leg drives the REAL gesture. The "real move" legs are the other half:
// the guard must not swallow a drag, including one that comes back to where it
// started, or a card lift handed off before the shell existed.

import { describe, it, expect, vi, afterEach } from "vitest";
import { createRef } from "react";
import { render, fireEvent, cleanup, act } from "@testing-library/react";
import FloatingPanel, { type FloatingPanelHandle } from "@/components/FloatingPanel";
import { getDockDragTarget, setDockDragTarget } from "@/components/editor-layout/dock-drag";
import {
  setStackIconRect,
  __resetStackIconRect,
  setStackDropTarget,
} from "@/lib/stack/stack-drop-target";

const RECT_OWNER = {};
const ICON = { left: 12, top: 700, right: 68, bottom: 756 };
const ON_ICON = { clientX: 40, clientY: 728 };
const HELD = { buttons: 1 };

const SIZE = { initialWidth: 320, initialHeight: 240 };

// jsdom's rects are all zero, so the dock column states its own. The float's
// top-right corner rests on the column's snap corner (1200, 45).
const WINDOW = { width: 1400, height: 900 };
const NEAR_DOCK = { x: 880, y: 45 };
const COL = { left: 900, top: 0, width: 300, height: 800 };
const FRAME = { left: 905, top: 45, width: 290, height: 700 };
const BAND = { left: 910, top: 50, width: 280, height: 200 };

function stubRect(el: HTMLElement, r: { left: number; top: number; width: number; height: number }) {
  el.getBoundingClientRect = () =>
    ({ ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON() {} }) as DOMRect;
}

function mountDock() {
  const col = document.createElement("div");
  col.dataset.panelColumnSide = "right";
  stubRect(col, COL);
  const frame = document.createElement("div");
  frame.setAttribute("data-stack-frame", "");
  stubRect(frame, FRAME);
  const band = document.createElement("div");
  band.setAttribute("data-dock-slot", "right-0");
  stubRect(band, BAND);
  frame.appendChild(band);
  col.appendChild(frame);
  document.body.appendChild(col);
}

const realWidth = window.innerWidth;
const realHeight = window.innerHeight;
function sizeWindow(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}

afterEach(() => {
  cleanup();
  __resetStackIconRect();
  setStackDropTarget(false);
  setDockDragTarget(null);
  sizeWindow(realWidth, realHeight);
  document.body.style.userSelect = "";
  document.body.style.cursor = "";
  document.querySelectorAll("[data-panel-column-side]").forEach((el) => el.remove());
});

const body = () => document.querySelector<HTMLElement>('[data-testid="body"]')!;
const move = (clientX: number, clientY: number) =>
  act(() => {
    fireEvent.mouseMove(window, { clientX, clientY, ...HELD });
  });
const up = (clientX: number, clientY: number) =>
  act(() => {
    fireEvent.mouseUp(window, { clientX, clientY });
  });

function mountCard(handle?: React.Ref<FloatingPanelHandle>) {
  const onChange = vi.fn();
  render(
    <FloatingPanel
      ref={handle}
      cardKey="note:n1"
      mode="floating"
      surface="card"
      initialX={300}
      initialY={200}
      {...SIZE}
      zIndex={1200}
      onChange={onChange}
    >
      <div data-testid="body">float body</div>
    </FloatingPanel>,
  );
  setStackIconRect(RECT_OWNER, ICON);
  return { onChange };
}

function mountPanelNearDock() {
  sizeWindow(WINDOW.width, WINDOW.height);
  mountDock();
  const onChange = vi.fn();
  const onMaybeRedock = vi.fn();
  render(
    <FloatingPanel
      panelId="notes"
      mode="floating"
      initialX={NEAR_DOCK.x}
      initialY={NEAR_DOCK.y}
      {...SIZE}
      zIndex={1200}
      onChange={onChange}
      onMaybeRedock={onMaybeRedock}
    >
      <div data-testid="body">panel body</div>
    </FloatingPanel>,
  );
  return { onChange, onMaybeRedock };
}

/** Collect every `virgil-stack-drop` raised while `run` executes. */
function drops(run: () => void) {
  const seen: unknown[] = [];
  const listener = (e: Event) => seen.push((e as CustomEvent).detail);
  window.addEventListener("virgil-stack-drop", listener);
  try {
    run();
  } finally {
    window.removeEventListener("virgil-stack-drop", listener);
  }
  return seen;
}

describe("a click on the header decides nothing", () => {
  it("does not capture a float pressed over the StackIcon, or store its rect", () => {
    const { onChange } = mountCard();
    const seen = drops(() => {
      fireEvent.mouseDown(body(), { ...ON_ICON, ...HELD });
      up(ON_ICON.clientX, ON_ICON.clientY);
    });
    expect(seen).toEqual([]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not redock a panel float resting beside a dock, or store its rect", () => {
    const { onChange, onMaybeRedock } = mountPanelNearDock();
    fireEvent.mouseDown(body(), { clientX: 1000, clientY: 60, ...HELD });
    up(1000, 60);
    expect(onMaybeRedock).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("still a click when the browser re-reports the press point as a move", () => {
    const { onChange, onMaybeRedock } = mountPanelNearDock();
    fireEvent.mouseDown(body(), { clientX: 1000, clientY: 60, ...HELD });
    move(1000, 60);
    up(1000, 60);
    expect(onMaybeRedock).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a missed release after no movement commits nothing either", () => {
    const { onChange, onMaybeRedock } = mountPanelNearDock();
    fireEvent.mouseDown(body(), { clientX: 1000, clientY: 60, ...HELD });
    act(() => {
      fireEvent.mouseMove(window, { clientX: 1100, clientY: 400, buttons: 0 });
    });
    expect(onMaybeRedock).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe("");
  });

  it("leaves no drag chrome behind", () => {
    mountCard();
    fireEvent.mouseDown(body(), { ...ON_ICON, ...HELD });
    expect(document.body.style.cursor).toBe("grabbing");
    up(ON_ICON.clientX, ON_ICON.clientY);
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
    expect(getDockDragTarget()).toBeNull();
  });

  it("a press and release on a resize edge stores nothing", () => {
    const { onChange } = mountCard();
    const edge = document.querySelector<HTMLElement>('[data-resize-edge="right"]')!;
    fireEvent.mouseDown(edge, { clientX: 620, clientY: 300, ...HELD });
    up(620, 300);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("a real move still decides", () => {
  it("dragging onto the StackIcon captures and persists", () => {
    const { onChange } = mountCard();
    const seen = drops(() => {
      fireEvent.mouseDown(body(), { clientX: 500, clientY: 300, ...HELD });
      move(ON_ICON.clientX, ON_ICON.clientY);
      up(ON_ICON.clientX, ON_ICON.clientY);
    });
    expect(seen).toHaveLength(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("a nudge beside a dock redocks and persists", () => {
    const { onChange, onMaybeRedock } = mountPanelNearDock();
    fireEvent.mouseDown(body(), { clientX: 1000, clientY: 60, ...HELD });
    move(1001, 60);
    up(1001, 60);
    expect(onMaybeRedock).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("a drag that returns to its press point is still a drag", () => {
    const { onChange } = mountCard();
    fireEvent.mouseDown(body(), { clientX: 500, clientY: 300, ...HELD });
    move(540, 340);
    move(500, 300);
    up(500, 300);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("a resize persists", () => {
    const { onChange } = mountCard();
    const edge = document.querySelector<HTMLElement>('[data-resize-edge="right"]')!;
    fireEvent.mouseDown(edge, { clientX: 620, clientY: 300, ...HELD });
    move(660, 300);
    up(660, 300);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("a card lift handed off to the shell (beginDragAt)", () => {
  // The cursor already travelled, on the card, before this float existed. A
  // release with no further event is the end of that drag, not a click.
  it("released without a further move still commits where it spawned", () => {
    const handle = createRef<FloatingPanelHandle>();
    const { onChange } = mountCard(handle);
    act(() => handle.current!.beginDragAt(500, 300));
    up(500, 300);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toMatchObject({ x: 300, y: 200 });
  });
});
