// @vitest-environment jsdom
//
// Task 333 — the three bespoke gestures that owed the engine's pointer
// invariants and didn't pay, driven end to end.
//
// `useMarginEdit` already had this contract pinned (its own suite next door);
// these three did not, and each failed differently after a release the page
// never observes — a Cmd+Tab with the button held, a release over the
// compiled-PDF iframe, a context menu eating the mouseup:
//
//   1. `useDragPosition` (the Preferences window) — the dialog stayed glued to
//      the cursor and committed a position on the user's next click, with the
//      grabbing cursor and the global `user-select: none` wedged on <body>.
//      Its RAF body also read `offsetWidth`/`offsetHeight` per frame, a forced
//      layout inside the write path for a value that cannot change mid-drag.
//   2. The editor-scrollbar THUMB — no invariants at all, not even a button
//      gate, so a right-press started a drag whose end event the context menu
//      then ate, and the document ghost-scrolled under a released pointer.
//   3. The card-lift threshold detector — a swallowed mouseup left it armed,
//      so the user's next stray mouse movement popped a card out of the panel
//      from a press they had already let go of.
//
// The shape of each leg is the one the class demands: a mid-move carrying
// `buttons: 0` must END the gesture, must NOT incorporate that event's
// coordinate (it is movement the user never made), and must leave no chrome
// behind. Note that jsdom defaults `buttons` to 0, so every LIVE move here
// passes `buttons: 1` explicitly — which is exactly how these legs prove the
// invariant is wired rather than passing vacuously.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type * as React from "react";

import { useDragPosition } from "@/hooks/useDragPosition";

// panel-primitives transitively pulls `@/lib/storage` (the known barrel/
// storage gotcha) — stub it; nothing here touches a sidecar.
vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  const names = [
    "isDevStorage", "readSidecar", "readSidecarIfExists", "writeSidecar",
    "readTex", "writeTex", "readDocBundle", "writeDocBundle", "readBib",
    "writeBib", "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  return Object.fromEntries(names.map((n) => [n, noop]));
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, fireEvent } from "@testing-library/react";
import { PanelCard, CARD_THEMES } from "@/components/panel-primitives";
import { PoppedCardsContext, type PoppedCardsValue } from "@/hooks/usePoppedCards";
import { cardPopKey } from "@/panels/panel-registry";
import { EditorScrollbar } from "@/components/editor-layout/editor-scrollbar";

// ── RAF harness: these gestures coalesce, so nothing commits until a frame
// runs. Draining explicitly is what lets a leg distinguish "the stray
// coordinate was ignored" from "the stray coordinate is still queued".
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
  document.body.style.userSelect = "";
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const mouse = (type: string, init: MouseEventInit) =>
  new MouseEvent(type, { bubbles: true, ...init });

// ─────────────────────────────────────────────────────────────────────────────
// 1. useDragPosition — the Preferences window
// ─────────────────────────────────────────────────────────────────────────────

/** A panel with a real size, so the clamp bounds are meaningful. jsdom leaves
 *  `offsetWidth`/`offsetHeight` at 0 unless they are defined. */
function mountDragPosition(size = { w: 400, h: 300 }) {
  const panel = document.createElement("div");
  Object.defineProperty(panel, "offsetWidth", { value: size.w, configurable: true });
  Object.defineProperty(panel, "offsetHeight", { value: size.h, configurable: true });
  panel.getBoundingClientRect = () =>
    ({ left: 100, top: 100, width: size.w, height: size.h }) as DOMRect;
  document.body.appendChild(panel);

  const hook = renderHook(() => useDragPosition());
  act(() => {
    (hook.result.current.panelRef as React.RefObject<HTMLDivElement | null>).current = panel;
  });
  return { panel, hook };
}

/** A React-ish synthetic mousedown — the hook only reads these four fields. */
const down = (x: number, y: number, button = 0) =>
  ({ button, clientX: x, clientY: y }) as unknown as React.MouseEvent;

describe("useDragPosition — the Preferences window's move gesture (task 333)", () => {
  it("a mid-move with the primary button up ENDS the drag without taking its coordinate", () => {
    const { hook } = mountDragPosition();
    act(() => hook.result.current.onMouseDown(down(150, 150)));
    expect(hook.result.current.isDraggingRef.current).toBe(true);

    // One honest move: the cursor travelled +40/+30 with the button held.
    act(() => {
      window.dispatchEvent(mouse("mousemove", { clientX: 190, clientY: 180, buttons: 1 }));
      flushRaf();
    });
    const held = hook.result.current.position;
    expect(held).toEqual({ x: 140, y: 130 });

    // Now the release happens somewhere we never see, and the cursor keeps
    // moving. Pre-333 this committed (700, 600) and stayed live.
    act(() => {
      window.dispatchEvent(mouse("mousemove", { clientX: 750, clientY: 650, buttons: 0 }));
      flushRaf();
    });
    expect(hook.result.current.isDraggingRef.current).toBe(false);
    expect(hook.result.current.position).toEqual(held);

    // …and the chrome is not wedged on <body>.
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");

    // Later movement is inert — the listeners really are detached, not merely
    // gated. (A gate alone would still be glued to the cursor on re-entry.)
    act(() => {
      window.dispatchEvent(mouse("mousemove", { clientX: 300, clientY: 300, buttons: 1 }));
      flushRaf();
    });
    expect(hook.result.current.position).toEqual(held);
  });

  it("a queued frame cannot commit a coordinate behind the gesture's end", () => {
    // The subtle half: the bail alone is not enough. A move that arrives with
    // the button still held schedules a frame; if the missed release lands
    // before that frame runs and the end path does not CANCEL it, the drag
    // ends and then commits anyway, one frame later.
    const { hook } = mountDragPosition();
    act(() => hook.result.current.onMouseDown(down(150, 150)));
    act(() => {
      window.dispatchEvent(mouse("mousemove", { clientX: 190, clientY: 180, buttons: 1 }));
      flushRaf();
    });
    const held = hook.result.current.position;

    act(() => {
      // Held move — schedules a frame, deliberately NOT flushed.
      window.dispatchEvent(mouse("mousemove", { clientX: 500, clientY: 400, buttons: 1 }));
      // Missed release arrives first.
      window.dispatchEvent(mouse("mousemove", { clientX: 500, clientY: 400, buttons: 0 }));
      flushRaf();
    });
    expect(hook.result.current.position).toEqual(held);
  });

  it("refuses a non-primary press, and clamps against geometry read ONCE per gesture", () => {
    const { panel, hook } = mountDragPosition();

    act(() => hook.result.current.onMouseDown(down(150, 150, 2)));
    expect(hook.result.current.isDraggingRef.current).toBe(false);
    act(() => {
      window.dispatchEvent(mouse("mousemove", { clientX: 400, clientY: 400, buttons: 1 }));
      flushRaf();
    });
    expect(hook.result.current.position).toBeNull();

    // The SNAPSHOT obligation: count the forced-layout reads across a real
    // drag. Pre-333 the RAF body read both per frame; now the gesture edge
    // reads each exactly once, however many frames run.
    let widthReads = 0;
    let heightReads = 0;
    Object.defineProperty(panel, "offsetWidth", { get: () => (widthReads++, 400), configurable: true });
    Object.defineProperty(panel, "offsetHeight", { get: () => (heightReads++, 300), configurable: true });

    act(() => hook.result.current.onMouseDown(down(150, 150)));
    for (const x of [200, 240, 280, 320, 360]) {
      act(() => {
        window.dispatchEvent(mouse("mousemove", { clientX: x, clientY: 200, buttons: 1 }));
        flushRaf();
      });
    }
    expect({ widthReads, heightReads }).toEqual({ widthReads: 1, heightReads: 1 });

    // And the clamp those bounds feed still holds: the panel's far edge stops
    // at the viewport (jsdom's innerWidth/innerHeight are 1024×768).
    act(() => {
      window.dispatchEvent(mouse("mousemove", { clientX: 5000, clientY: 5000, buttons: 1 }));
      flushRaf();
    });
    expect(hook.result.current.position).toEqual({
      x: window.innerWidth - 400,
      y: window.innerHeight - 300,
    });
    act(() => window.dispatchEvent(mouse("mouseup", {})));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. The editor-scrollbar thumb — the category the chrome census cannot see
// ─────────────────────────────────────────────────────────────────────────────

/** A row/editor-column pair whose geometry makes the doc scrollable, so the
 *  thumb actually renders. Everything the measure pass reads is defined here;
 *  jsdom reports 0 for all of it otherwise. */
function mountScrollbar() {
  const row = document.createElement("div");
  const ec = document.createElement("div");
  const page = document.createElement("div");
  page.setAttribute("data-editor-page", "");
  ec.appendChild(page);
  row.appendChild(ec);
  document.body.appendChild(row);

  const size = (el: HTMLElement, props: Record<string, number>) => {
    for (const [k, v] of Object.entries(props)) {
      Object.defineProperty(el, k, { value: v, configurable: true });
    }
  };
  size(page, { scrollHeight: 4000 });
  size(ec, { scrollHeight: 4000 });
  size(row, { scrollHeight: 4000, clientHeight: 800 });
  // scrollTop must be writable — it is what the gesture actually moves.
  let scrollTop = 0;
  Object.defineProperty(row, "scrollTop", {
    get: () => scrollTop,
    set: (v: number) => { scrollTop = v; },
    configurable: true,
  });
  ec.getBoundingClientRect = () => ({ right: 1000, top: 0, height: 800 }) as DOMRect;
  row.getBoundingClientRect = () => ({ right: 1000, top: 0, height: 800 }) as DOMRect;

  const rowRef = { current: row };
  const ecRef = { current: ec };
  const utils = render(<EditorScrollbar rowRef={rowRef} editorColRef={ecRef} />);
  // The thumb is the wrapper's only child — the one element carrying
  // `cursor: grab` and the mousedown that starts the gesture.
  const thumb = utils.container.querySelector('[style*="grab"]') as HTMLElement | null;
  return { row, thumb, utils, get scrollTop() { return scrollTop; } };
}

describe("editor-scrollbar thumb — a gesture wearing no drag chrome (task 333)", () => {
  it("a mid-move with the primary button up ends the drag and does not scroll by it", () => {
    const h = mountScrollbar();
    expect(h.thumb, "the thumb must render, or every leg here is vacuous").toBeTruthy();

    fireEvent.mouseDown(h.thumb as HTMLElement, { button: 0, clientY: 100 });
    act(() => {
      window.dispatchEvent(mouse("mousemove", { clientY: 150, buttons: 1 }));
    });
    const held = h.scrollTop;
    expect(held).toBeGreaterThan(0);

    // The release lands over the compiled-PDF iframe; the cursor keeps going.
    // Pre-333 the document ghost-scrolled the whole way.
    act(() => {
      window.dispatchEvent(mouse("mousemove", { clientY: 700, buttons: 0 }));
    });
    expect(h.scrollTop).toBe(held);

    // Detached, not merely gated.
    act(() => {
      window.dispatchEvent(mouse("mousemove", { clientY: 400, buttons: 1 }));
    });
    expect(h.scrollTop).toBe(held);
  });

  it("a right-press starts nothing — the gate this thumb never had", () => {
    const h = mountScrollbar();
    fireEvent.mouseDown(h.thumb as HTMLElement, { button: 2, clientY: 100 });
    act(() => {
      window.dispatchEvent(mouse("mousemove", { clientY: 400, buttons: 2 }));
    });
    expect(h.scrollTop).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. The card-lift threshold detector
// ─────────────────────────────────────────────────────────────────────────────

const NOTE_KEY = cardPopKey("note", "n1");

function mountLiftableCard() {
  const popOutAtRect = vi.fn();
  const ctx: PoppedCardsValue = {
    poppedKeys: [],
    isPopped: () => false,
    toggle: vi.fn(),
    toggleAtAnchor: vi.fn(),
    popOutAtRect,
    close: vi.fn(),
    getFloatPosition: () => undefined,
    setFloatPosition: vi.fn(),
  };
  const utils = render(
    <PoppedCardsContext.Provider value={ctx}>
      <PanelCard
        theme={CARD_THEMES.note}
        selected={false}
        kind="note"
        isCollapsed
        cardKey={NOTE_KEY}
        onToggleExpanded={vi.fn()}
        onHeaderActivate={vi.fn()}
      >
        <div data-testid="body">body</div>
      </PanelCard>
    </PoppedCardsContext.Provider>,
  );
  const header = utils.container.querySelector('[data-card-header="1"]') as HTMLElement;
  return { header, popOutAtRect, utils };
}

describe("card-lift threshold detector (task 333)", () => {
  it("a swallowed mouseup disarms it — the next stray movement must not pop the card out", () => {
    const { header, popOutAtRect } = mountLiftableCard();
    fireEvent.mouseDown(header, { button: 0, clientX: 10, clientY: 10 });

    // A sub-threshold move with the button held: still armed, correctly.
    act(() => {
      window.dispatchEvent(mouse("mousemove", { clientX: 11, clientY: 11, buttons: 1 }));
    });
    expect(popOutAtRect).not.toHaveBeenCalled();

    // The release happens somewhere we never see. The user's next movement is
    // ordinary mousing, not a drag — pre-333 it crossed the threshold and
    // popped the card out of the panel.
    act(() => {
      window.dispatchEvent(mouse("mousemove", { clientX: 400, clientY: 400, buttons: 0 }));
    });
    expect(popOutAtRect).not.toHaveBeenCalled();
    act(() => {
      window.dispatchEvent(mouse("mousemove", { clientX: 500, clientY: 500, buttons: 1 }));
    });
    expect(popOutAtRect).not.toHaveBeenCalled();

    // The press visual is cleared too — the detector really tore down.
    expect(header.classList.contains("is-pressed")).toBe(false);
  });

  it("an honest held drag still lifts (the accepting control)", () => {
    // Without this the leg above would pass on a detector that never fires at
    // all — the shape a too-eager bail would produce.
    const { header, popOutAtRect } = mountLiftableCard();
    fireEvent.mouseDown(header, { button: 0, clientX: 10, clientY: 10 });
    act(() => {
      window.dispatchEvent(mouse("mousemove", { clientX: 60, clientY: 60, buttons: 1 }));
    });
    expect(popOutAtRect).toHaveBeenCalledTimes(1);
  });
});
