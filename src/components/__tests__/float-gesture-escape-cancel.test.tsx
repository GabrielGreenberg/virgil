// @vitest-environment jsdom
//
// Task 1617 — **Escape abandons a float move/resize, and the press is
// CLAIMED.** Task 1167's Escape census parked `FloatingPanel` under an `owed`
// verdict: its end path had a non-committing ending, but no key reached it, so
// Escape mid-drag did not stop the drag (the next release still committed the
// rect / redock / stack capture) AND, unclaimed, travelled on to every other
// Escape owner — a scrimless dialog behind the float closed, an open
// margin-edit session was discarded, and an opt-in dialog float's own
// `useNonModalDialogKeys` closed the whole window instead of the drag.
//
// The two owners below are the 471 harness shape: a `document` CAPTURE owner
// (the dialog stack) and a `window` BUBBLE owner (`useMarginEdit`). Presses are
// dispatched from INSIDE the document — one dispatched at `window` could never
// reach a `document` listener, and the "reaches no other owner" legs would
// pass vacuously.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { useState } from "react";
import { render, fireEvent, cleanup, act } from "@testing-library/react";
import FloatingPanel from "@/components/FloatingPanel";
import { getDockDragTarget, setDockDragTarget } from "@/components/editor-layout/dock-drag";

const HELD = { buttons: 1 };
const RECT = { x: 300, y: 200, width: 320, height: 240 };

// A controllable frame clock: the move writes its translate one frame late.
const frames = new Map<number, FrameRequestCallback>();
let nextId = 0;
const realRaf = window.requestAnimationFrame;
const realCaf = window.cancelAnimationFrame;
function flushFrames() {
  const pending = [...frames.values()];
  frames.clear();
  act(() => {
    for (const cb of pending) cb(performance.now());
  });
}

let docCapture: ReturnType<typeof vi.fn<(e: KeyboardEvent) => void>>;
let winBubble: ReturnType<typeof vi.fn<(e: KeyboardEvent) => void>>;
beforeEach(() => {
  frames.clear();
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    frames.set(++nextId, cb);
    return nextId;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = ((id: number) => {
    frames.delete(id);
  }) as typeof window.cancelAnimationFrame;
  docCapture = vi.fn<(e: KeyboardEvent) => void>();
  winBubble = vi.fn<(e: KeyboardEvent) => void>();
  document.addEventListener("keydown", docCapture, true);
  window.addEventListener("keydown", winBubble);
});

afterEach(() => {
  cleanup();
  window.requestAnimationFrame = realRaf;
  window.cancelAnimationFrame = realCaf;
  document.removeEventListener("keydown", docCapture, true);
  window.removeEventListener("keydown", winBubble);
  setDockDragTarget(null);
  document.body.style.userSelect = "";
  document.body.style.cursor = "";
});

const shell = () => document.querySelector<HTMLDivElement>('[data-floating-panel="true"]')!;
const body = () => document.querySelector<HTMLElement>('[data-testid="body"]')!;
const move = (clientX: number, clientY: number) =>
  act(() => {
    fireEvent.mouseMove(window, { clientX, clientY, ...HELD });
  });
const up = (clientX: number, clientY: number) =>
  act(() => {
    fireEvent.mouseUp(window, { clientX, clientY });
  });
const escape = () =>
  act(() => {
    fireEvent.keyDown(document.body, { key: "Escape" });
  });

function mountFloat(extra: Partial<React.ComponentProps<typeof FloatingPanel>> = {}) {
  const onChange = vi.fn();
  const onMaybeRedock = vi.fn();
  render(
    <FloatingPanel
      panelId="notes"
      mode="floating"
      initialX={RECT.x}
      initialY={RECT.y}
      initialWidth={RECT.width}
      initialHeight={RECT.height}
      zIndex={1200}
      onChange={onChange}
      onMaybeRedock={onMaybeRedock}
      {...extra}
    >
      <div data-testid="body">float body</div>
    </FloatingPanel>,
  );
  return { onChange, onMaybeRedock };
}

const renderedRect = () => {
  const s = shell().style;
  return {
    x: parseFloat(s.left),
    y: parseFloat(s.top),
    width: parseFloat(s.width),
    height: parseFloat(s.height),
  };
};

describe("Escape abandons a float gesture (task 1617)", () => {
  it("a MOVE: drops the live translate, commits nothing, reaches no other owner", () => {
    const { onChange, onMaybeRedock } = mountFloat();
    fireEvent.mouseDown(body(), { clientX: 400, clientY: 220, ...HELD });
    move(500, 300);
    flushFrames();
    expect(shell().style.transform).toContain("translate3d");

    escape();
    expect(docCapture).not.toHaveBeenCalled();
    expect(winBubble).not.toHaveBeenCalled();
    expect(shell().style.transform).toBe("");
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");

    // The release that follows decides nothing.
    up(500, 300);
    expect(onChange).not.toHaveBeenCalled();
    expect(onMaybeRedock).not.toHaveBeenCalled();
    expect(renderedRect()).toEqual(RECT);
  });

  it("a RESIZE: the per-frame commits are undone to the pre-gesture rect", () => {
    const { onChange } = mountFloat();
    const edge = document.querySelector<HTMLElement>('[data-resize-edge="right"]')!;
    fireEvent.mouseDown(edge, { clientX: 620, clientY: 300, ...HELD });
    move(700, 300);
    flushFrames();
    expect(renderedRect().width).toBeGreaterThan(RECT.width);

    escape();
    expect(docCapture).not.toHaveBeenCalled();
    expect(winBubble).not.toHaveBeenCalled();
    expect(renderedRect()).toEqual(RECT);
    up(700, 300);
    expect(onChange).not.toHaveBeenCalled();
    expect(renderedRect()).toEqual(RECT);
  });

  it("a DOCKED start that undocked mid-drag goes back to its band, saved float rect restored", () => {
    const onChange = vi.fn();
    const onUndock = vi.fn();
    const onMaybeRedock = vi.fn();
    const SAVED = { x: 40, y: 60, width: 300, height: 260 };
    function DockedHost() {
      const [rect, setRect] = useState<typeof SAVED | null>(null);
      return (
        <FloatingPanel
          panelId="notes"
          mode={rect ? "floating" : "docked"}
          slotKey={rect ? null : "right-2"}
          initialX={rect?.x ?? SAVED.x}
          initialY={rect?.y ?? SAVED.y}
          initialWidth={rect?.width ?? SAVED.width}
          initialHeight={rect?.height ?? SAVED.height}
          zIndex={1200}
          onChange={onChange}
          onUndock={(r) => {
            onUndock(r);
            setRect(r);
          }}
          onMaybeRedock={onMaybeRedock}
        >
          <div data-testid="body">docked body</div>
        </FloatingPanel>
      );
    }
    render(<DockedHost />);
    fireEvent.mouseDown(body(), { clientX: 500, clientY: 500, ...HELD });
    move(520, 510);
    expect(onUndock).toHaveBeenCalledTimes(1);

    escape();
    expect(docCapture).not.toHaveBeenCalled();
    expect(winBubble).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(SAVED);
    expect(onMaybeRedock).toHaveBeenCalledTimes(1);
    expect(onMaybeRedock).toHaveBeenCalledWith({ side: "right", index: 2 });
    expect(getDockDragTarget()).toBeNull();

    up(520, 510);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onMaybeRedock).toHaveBeenCalledTimes(1);
  });

  it("a DIALOG float: Escape mid-drag cancels the drag and leaves the window open; the next closes it", () => {
    const onCancel = vi.fn();
    mountFloat({ dialog: { labelledBy: "t", onCancel } });
    fireEvent.mouseDown(body(), { clientX: 400, clientY: 220, ...HELD });
    move(450, 260);
    escape();
    expect(onCancel).not.toHaveBeenCalled();
    act(() => {
      fireEvent.keyUp(document.body, { key: "Escape" });
    });
    escape();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("control: with no gesture live, Escape reaches both owners", () => {
    mountFloat();
    escape();
    expect(docCapture).toHaveBeenCalledTimes(1);
    expect(winBubble).toHaveBeenCalledTimes(1);
  });
});
