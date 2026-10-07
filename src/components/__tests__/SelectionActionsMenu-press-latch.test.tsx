// @vitest-environment jsdom
//
// Task 993 — the ⚡ bolt's "mouse held in the editor" latch has an END edge
// beyond the window `mouseup`. It used to take the engine's START gate
// (`isPrimaryDragStart`) but clear ONLY on a mouseup, so a release the page
// never saw — Cmd+Tab with the button held, macOS Ctrl+click's context menu
// eating the mouseup, focus leaving the window — wedged the latch: every
// later selectionUpdate was ignored and no bolt appeared until some later
// click anywhere. `watchHeldPress` now also ends it on a missed-release move
// (`buttons & 1 === 0`), a `contextmenu` and a window `blur`.
//
// jsdom defaults `buttons` to 0, so the LIVE move below passes `buttons: 1`
// explicitly — which is what proves the missed-release leg is wired rather
// than passing vacuously.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import type { Editor } from "@tiptap/react";

const h = vi.hoisted(() => {
  const cache = {
    editorEl: { offsetHeight: 100 },
    podRight: 800,
    editorRight: 780,
    scrollTop: 0,
    scrollBottom: 600,
  };
  return {
    coords: { left: 200, top: 100, bottom: 120 } as {
      left: number;
      top: number;
      bottom: number;
    },
    cache,
    // STABLE frameRef identity — the real useViewportFrame returns a stable
    // ref, and SelectionActionsMenu's placement effect lists `cacheRef`
    // in its deps. A fresh ref each render would churn that effect (clearing the
    // scroll-idle timer mid-gesture), which the component never does in prod.
    cacheRef: { current: cache as unknown },
    scrollParent: null as HTMLElement | null,
    scrollIntoView: vi.fn(),
  };
});

vi.mock("@/lib/editor-geometry/use-viewport-frame", () => ({
  useViewportFrame: () => ({ frameRef: h.cacheRef, version: 0 }),
}));
// The barrel is mocked so the test stays hermetic against the geometry
// service's import graph; `coordsAtPosCached` passes through to the mocked
// editor's `coordsAtPos` (exactly the real helper's service-less fallback).
vi.mock("@/lib/editor-geometry", () => ({
  coordsAtPosCached: (editor: Editor, pos: number) => {
    try {
      return editor.view.coordsAtPos(pos);
    } catch {
      return null;
    }
  },
}));
vi.mock("../ActionsMenuPanel", () => ({
  ActionsMenuPanel: ({
    triggerRect,
  }: {
    triggerRect: { left: number; top: number };
  }) => (
    <div
      data-testid="actions-menu-panel"
      data-left={triggerRect.left}
      data-top={triggerRect.top}
    />
  ),
}));
vi.mock("../Hint", () => ({ useHint: () => ({}) }));
vi.mock("../editor-layout/panel-icons", () => ({
  IconZap: () => <span data-testid="icon-zap" />,
}));
vi.mock("@/components/editor-layout/layout-scroll", () => ({
  findEditorScrollFor: () => h.scrollParent,
}));
vi.mock("@/floats/float-policy", () => ({ RESTING_MARGIN_TRIGGER_Z: 1199 }));
vi.mock("@/lib/scroll-reposition-probe", () => ({
  recordScrollPlacement: () => {},
  SCROLL_PORTAL_SELECTION_BOLT: "selection-bolt",
}));
vi.mock("@/lib/marginalia", () => ({
  computeBoltLeftFromPod: () => 760,
  MARGINALIA_BOLT_SIZE: 20,
}));
vi.mock("@/lib/anchor-uuid", () => ({
  resolveAnchorableNode: () => ({ nodePos: 5 }),
  resolveAnchorUuidAndKind: () => ({ uuid: "u1", kind: "paragraph" }),
}));

import { SelectionActionsMenu } from "../SelectionActionsMenu";

// jsdom has no ResizeObserver; nothing in the mocked stack uses it, but stub
// defensively so a stray reference can't throw.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

function makeEditor(): Editor {
  const listeners: Record<string, Array<() => void>> = {};
  const dom = document.createElement("div");
  return {
    isDestroyed: false,
    isFocused: true,
    state: { selection: { empty: false, from: 10, to: 20, head: 15 } },
    view: {
      dom,
      coordsAtPos: () => h.coords,
    },
    commands: { scrollIntoView: h.scrollIntoView },
    on: (evt: string, cb: () => void) => {
      (listeners[evt] ??= []).push(cb);
    },
    off: (evt: string, cb: () => void) => {
      listeners[evt] = (listeners[evt] ?? []).filter((c) => c !== cb);
    },
  } as unknown as Editor;
}

beforeEach(() => {
  vi.useFakeTimers();
  // Drive rAF synchronously through fake timers so update()'s RAF and the
  // 120ms scroll-idle both flush under vi.advanceTimersByTime.
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0) as unknown as number) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) =>
    clearTimeout(id as unknown as ReturnType<typeof setTimeout>)) as typeof cancelAnimationFrame;
  h.coords = { left: 200, top: 100, bottom: 120 }; // on-screen by default
  h.scrollIntoView.mockClear();
  h.scrollParent = document.createElement("div");
  document.body.appendChild(h.scrollParent);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

function mount() {
  const listeners: Record<string, Array<() => void>> = {};
  const editor = makeEditor();
  const on = editor.on.bind(editor);
  (editor as unknown as { on: typeof editor.on }).on = ((evt: string, cb: () => void) => {
    (listeners[evt] ??= []).push(cb);
    return on(evt as never, cb as never);
  }) as typeof editor.on;
  // The press must start INSIDE the editor DOM and reach the window, so the
  // editor element has to be attached.
  document.body.appendChild(editor.view.dom);
  const r = render(<SelectionActionsMenu editor={editor} />);
  const bolt = () =>
    r.baseElement.querySelector('button[aria-label="Open actions menu"]');
  const selectionUpdate = () =>
    act(() => {
      for (const cb of listeners.selectionUpdate ?? []) cb();
      vi.advanceTimersByTime(50);
    });
  const press = () =>
    act(() => {
      fireEvent.mouseDown(editor.view.dom, { button: 0, buttons: 1 });
    });
  return { editor, bolt, selectionUpdate, press };
}

describe("SelectionActionsMenu — the press latch's end edge (task 993)", () => {
  it("hides the bolt while a press is held, and a live move keeps it hidden", () => {
    const m = mount();
    act(() => vi.advanceTimersByTime(50));
    expect(m.bolt()).toBeTruthy();
    m.press();
    expect(m.bolt(), "a held editor press hides the resting bolt").toBeNull();
    act(() => {
      fireEvent.mouseMove(window, { buttons: 1 });
    });
    m.selectionUpdate();
    expect(m.bolt(), "a LIVE move (button still held) keeps the latch").toBeNull();
    act(() => {
      fireEvent.mouseUp(window, { button: 0 });
    });
    m.selectionUpdate();
    expect(m.bolt(), "the real mouseup ends the latch").toBeTruthy();
  });

  it("a move with the primary button no longer held ends the latch (missed release)", () => {
    const m = mount();
    m.press();
    expect(m.bolt()).toBeNull();
    act(() => {
      fireEvent.mouseMove(window, { buttons: 0 });
    });
    m.selectionUpdate();
    expect(m.bolt(), "a missed release must not keep the bolt hidden").toBeTruthy();
  });

  it("a window blur ends the latch (focus left mid-press)", () => {
    const m = mount();
    m.press();
    expect(m.bolt()).toBeNull();
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    m.selectionUpdate();
    expect(m.bolt()).toBeTruthy();
  });

  it("a context menu ends the latch (it is about to eat the release)", () => {
    const m = mount();
    m.press();
    expect(m.bolt()).toBeNull();
    act(() => {
      fireEvent.contextMenu(m.editor.view.dom);
    });
    m.selectionUpdate();
    expect(m.bolt()).toBeTruthy();
  });

  it("disarms its end-edge listeners once the press has ended", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const m = mount();
    m.press();
    const armed = add.mock.calls.filter(([t]) => t === "mousemove").length;
    expect(armed).toBe(1);
    act(() => {
      fireEvent.mouseUp(window, { button: 0 });
    });
    expect(remove.mock.calls.filter(([t]) => t === "mousemove").length).toBe(1);
    add.mockRestore();
    remove.mockRestore();
  });
});
