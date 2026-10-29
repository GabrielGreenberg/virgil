// @vitest-environment jsdom
//
// Task 154 — `placement.visible` overload decoupling. SelectionActionsMenu once
// used ONE `placement.visible` flag for both (a) "paint the resting bolt here"
// and (b) the OPEN menu's lifecycle + render gate. Because the transient scroll/
// drag `suppress()` wrote `placement.visible = false`, a bolt-only jitter guard
// silently unmounted the OPEN menu on the first scroll tick, and Cmd+/ with an
// off-screen caret was swallowed. The fix splits transient suppression into its
// own `suppressed` channel and decouples the open menu from the bolt gate.
//
// These tests drive the REAL component with mocked heavy deps and pin the three
// contract points from the task's `## Verify`:
//   (1) menuTarget survives a scroll (menu not unmounted) — the sev-med
//       regression; since task 1355 the resting bolt survives it too;
//   (2) a scroll that carries the line out of the band still closes the menu
//       (through the live anchor read — the bolt has no scroll listener);
//   (3) Cmd+/ with an off-screen caret calls scrollIntoView and, once the caret
//       is brought on-screen, opens the panel at a real (non-0,0) position.

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
    paperEl: null,
    toPortalCoords: (x: number, y: number) => ({ x, y }),
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
    // The live-anchor thunk the menu hands the panel (task 1200).
    track: null as null | (() => { top: number; left: number } | null),
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
    trackAnchor,
  }: {
    triggerRect: { left: number; top: number };
    trackAnchor?: () => { top: number; left: number } | null;
  }) => {
    h.track = trackAnchor ?? null;
    return (
    <div
      data-testid="actions-menu-panel"
      data-left={triggerRect.left}
      data-top={triggerRect.top}
    />
    );
  },
}));
vi.mock("../Hint", () => ({ useHint: () => ({}) }));
vi.mock("../editor-layout/panel-icons", () => ({
  IconZap: () => <span data-testid="icon-zap" />,
}));
vi.mock("@/components/editor-layout/layout-scroll", () => ({
  findEditorScrollFor: () => h.scrollParent,
}));
vi.mock("@/floats/float-policy", () => ({ IN_SCROLL_MARGIN_TRIGGER_Z: 20 }));
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
  h.track = null;
  h.scrollParent = document.createElement("div");
  document.body.appendChild(h.scrollParent);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

function openViaBolt(container: HTMLElement) {
  const bolt = container.ownerDocument.querySelector(
    'button[aria-label="Open actions menu"]',
  ) as HTMLButtonElement | null;
  expect(bolt).toBeTruthy();
  act(() => {
    fireEvent.click(bolt!);
  });
}

describe("SelectionActionsMenu — placement.visible decoupling (task 154)", () => {
  // Task 1355 — the resting bolt RIDES ITS LINE: it no longer listens to the
  // scroll at all (it portals into the in-scroll host and moves by layout), so
  // a scroll can neither hide the bolt nor close the open menu while the line
  // stays in the band.
  it("keeps the resting bolt AND the open menu mounted across a scroll", () => {
    const { baseElement } = render(<SelectionActionsMenu editor={makeEditor()} />);
    const bolt = () =>
      baseElement.querySelector('button[aria-label="Open actions menu"]');

    openViaBolt(baseElement as HTMLElement);
    expect(
      baseElement.querySelector('[data-testid="actions-menu-panel"]'),
    ).toBeTruthy();

    act(() => {
      fireEvent.scroll(h.scrollParent!);
      fireEvent.scroll(h.scrollParent!);
    });
    expect(bolt(), "the bolt stays painted mid-scroll").toBeTruthy();
    expect(
      baseElement.querySelector('[data-testid="actions-menu-panel"]'),
      "menu must survive the scroll",
    ).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(bolt(), "…and after it").toBeTruthy();
    expect(
      baseElement.querySelector('[data-testid="actions-menu-panel"]'),
    ).toBeTruthy();
  });

  it("paints the bolt in portal coords at position:absolute, pointer-events on", () => {
    // The portal host's origin sits 40px down / 10px right of the viewport.
    const prev = h.cache as unknown as Record<string, unknown>;
    const saved = prev.toPortalCoords;
    prev.toPortalCoords = (x: number, y: number) => ({ x: x - 10, y: y - 40 });
    try {
      const { baseElement } = render(<SelectionActionsMenu editor={makeEditor()} />);
      const bolt = baseElement.querySelector(
        'button[aria-label="Open actions menu"]',
      ) as HTMLButtonElement;
      expect(bolt.style.position).toBe("absolute");
      expect(bolt.style.pointerEvents).toBe("auto");
      expect(bolt.style.left).toBe("750px"); // 760 − 10
      expect(bolt.style.top).toBe("60px"); // line top 100 − 40, NO band clamp
      // The open menu anchors in VIEWPORT coords (portal origin added back).
      act(() => {
        fireEvent.click(bolt);
      });
      const panel = baseElement.querySelector(
        '[data-testid="actions-menu-panel"]',
      ) as HTMLElement;
      expect(panel.dataset.left).toBe("760");
      expect(panel.dataset.top).toBe("100");
      expect(h.track!()).toMatchObject({ left: 760, top: 100 });
    } finally {
      prev.toPortalCoords = saved;
    }
  });

  it("portals the bolt into the in-scroll [data-grab-handle-portal] host", () => {
    const column = document.createElement("div");
    const host = document.createElement("div");
    host.setAttribute("data-grab-handle-portal", "");
    column.appendChild(host);
    document.body.appendChild(column);
    const prev = h.cache as unknown as Record<string, unknown>;
    prev.paperEl = column;
    try {
      render(<SelectionActionsMenu editor={makeEditor()} />);
      const bolt = document.querySelector('button[aria-label="Open actions menu"]');
      expect(bolt?.parentElement).toBe(host);
    } finally {
      prev.paperEl = null;
    }
  });

  it("closes the menu when a scroll carries the anchored line out of the band", () => {
    const { baseElement } = render(<SelectionActionsMenu editor={makeEditor()} />);
    openViaBolt(baseElement as HTMLElement);
    const panel = () =>
      baseElement.querySelector('[data-testid="actions-menu-panel"]');
    expect(panel()).toBeTruthy();
    // The provider's open-time measure reads the live anchor once, in band.
    expect(h.track!()).toMatchObject({ top: 100 });

    // The line scrolls above the band; the menu provider's next live re-read
    // (≤1/frame on scroll) is what notices — the bolt has no scroll listener.
    h.coords = { left: 200, top: -80, bottom: -60 };
    let rect: unknown;
    act(() => {
      rect = h.track!();
    });
    // The closing read answers the LAST in-band rect, never null (null would
    // fling the menu back to its open-time rect for the closing frame).
    expect(rect).toMatchObject({ top: 100 });
    expect(panel(), "an off-band line closes the menu").toBeNull();
  });

  // Task 1200 — the OPEN menu (a fixed `<Menu>` portal) gets a `trackAnchor`
  // thunk that re-reads the head line from the live view mid-scroll.
  it("hands the open menu a LIVE anchor that follows the line mid-scroll", () => {
    const { baseElement } = render(<SelectionActionsMenu editor={makeEditor()} />);
    openViaBolt(baseElement as HTMLElement);
    const panel = () =>
      baseElement.querySelector('[data-testid="actions-menu-panel"]') as HTMLElement;
    expect(h.track, "the panel receives a trackAnchor thunk").toBeTypeOf("function");
    expect(h.track!()?.top).toBe(100);

    h.coords = { left: 200, top: 300, bottom: 320 };
    act(() => {
      fireEvent.scroll(h.scrollParent!);
      vi.advanceTimersByTime(16);
    });
    // The static open-time rect stays where it was opened…
    expect(panel().dataset.top).toBe("100");
    // …but the live anchor answers the line's CURRENT position.
    expect(h.track!()).toMatchObject({ top: 300, left: 760 });
  });

  // Task 299 — the resting ⚡ bolt's hover-on-light affordance must be LIVE.
  // An inline `background` shorthand sets `background-color` and (as an inline
  // decl) shadows `.hover-on-light:hover`, so the resting bg MUST live on the
  // class layer for the hover tint to fire. We pin the source-shape contract
  // (jsdom applies no stylesheet, so :hover computed styles aren't meaningful):
  // the affordance class is present AND no inline background shadows it.
  it("keeps the resting bolt's hover affordance live (no inline bg shadow)", () => {
    const { baseElement } = render(<SelectionActionsMenu editor={makeEditor()} />);
    const bolt = baseElement.querySelector(
      'button[aria-label="Open actions menu"]',
    ) as HTMLButtonElement | null;
    expect(bolt).toBeTruthy();
    // The hover affordance signal is present…
    expect(bolt!.className).toContain("hover-on-light");
    // …the resting bg lives on the class layer (so the class `:hover` can win)…
    expect(bolt!.className).toContain("bg-[var(--pod-editor)]");
    // …and NO inline background shadows the class-layer :hover tint.
    expect(bolt!.style.background).toBe("");
    expect(bolt!.style.backgroundColor).toBe("");
    // The pod chrome the bolt is meant to keep stays inline & unchanged.
    expect(bolt!.style.border).toBe("var(--pod-border)");
    expect(bolt!.style.boxShadow).toBe("var(--menu-shadow)");
    expect(bolt!.style.borderRadius).toBe("var(--pod-radius)");
  });

  it("Cmd+/ with an off-screen caret calls scrollIntoView and opens on-screen", () => {
    const editor = makeEditor();
    // Caret starts off-screen. The bolt is still MOUNTED (task 1355): it sits
    // beside its line in portal coords and the row scroll container clips it.
    h.coords = { left: 200, top: -80, bottom: -60 };
    // PM scrolls synchronously inside the scrollIntoView dispatch.
    h.scrollIntoView.mockImplementation(() => {
      h.coords = { left: 200, top: 100, bottom: 120 };
    });
    const { baseElement } = render(<SelectionActionsMenu editor={editor} />);
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(
      baseElement.querySelector('[data-testid="actions-menu-panel"]'),
    ).toBeNull();

    act(() => {
      fireEvent.keyDown(document.body, { key: "/", metaKey: true });
    });
    expect(h.scrollIntoView).toHaveBeenCalledTimes(1);
    const panel = baseElement.querySelector(
      '[data-testid="actions-menu-panel"]',
    );
    expect(panel, "Cmd+/ opens the menu at the scrolled-in caret").toBeTruthy();
    expect(panel?.getAttribute("data-left")).toBe("760");
    expect(panel?.getAttribute("data-top")).toBe("100");
    h.scrollIntoView.mockReset();
  });
});

describe("SelectionActionsMenu — tracked editor binding (task 736)", () => {
  const listenerCount = (ed: Editor) =>
    (ed as unknown as { __count: () => number }).__count();
  function countingEditor(): Editor {
    const ed = makeEditor();
    let n = 0;
    const on = ed.on.bind(ed);
    const off = ed.off.bind(ed);
    return Object.assign(ed, {
      on: (e: string, cb: () => void) => { n += 1; return on(e as never, cb as never); },
      off: (e: string, cb: () => void) => { n -= 1; return off(e as never, cb as never); },
      __count: () => n,
    });
  }

  it("binds when the editor arrives AFTER first render, and re-binds on a swap", () => {
    const { baseElement, rerender } = render(<SelectionActionsMenu editor={null} />);
    expect(baseElement.querySelector('button[aria-label="Open actions menu"]')).toBeNull();

    const a = countingEditor();
    rerender(<SelectionActionsMenu editor={a} />);
    act(() => { vi.advanceTimersByTime(50); });
    expect(listenerCount(a), "the arrived editor is subscribed").toBe(4);
    expect(
      baseElement.querySelector('button[aria-label="Open actions menu"]'),
      "the bolt resolves against the arrived editor",
    ).toBeTruthy();

    const b = countingEditor();
    rerender(<SelectionActionsMenu editor={b} />);
    expect(listenerCount(a), "the swapped-out editor is released").toBe(0);
    expect(listenerCount(b), "the swapped-in editor is subscribed").toBe(4);
  });
});
