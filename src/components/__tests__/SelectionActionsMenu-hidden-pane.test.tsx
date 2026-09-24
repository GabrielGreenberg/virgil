// @vitest-environment jsdom
//
// Task 753 — a hidden keep-alive pane paints NOTHING outside itself. The ⚡
// bolt (and its open ActionsMenuPanel) are body portals, which a hidden
// KeepAliveSlot's `display:none` cannot reach; they re-placed only on the
// SHOW edge, so after a tab switch the hidden doc's bolt stayed painted — and
// clickable — over the shown doc. They now render through PaneOverlayPortal.
// Harness (mocks) shared in shape with SelectionActionsMenu-placement-decouple.

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
import { KeepAliveVisibilityProvider } from "@/lib/keep-alive/visibility-context";
import { PaneOverlayPortal } from "@/lib/keep-alive/PaneOverlayPortal";

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


const BOLT = 'button[aria-label="Open actions menu"]';
const PANEL = '[data-testid="actions-menu-panel"]';

function Pane({ visible, editor }: { visible: boolean; editor: Editor }) {
  return (
    <KeepAliveVisibilityProvider isVisible={visible}>
      <SelectionActionsMenu editor={editor} />
    </KeepAliveVisibilityProvider>
  );
}

describe("hidden keep-alive pane paints no bolt or menu (task 753)", () => {
  it("hide removes the bolt and closes the open menu; show restores the bolt", () => {
    const editor = makeEditor();
    const { rerender } = render(<Pane visible editor={editor} />);
    act(() => {
      vi.advanceTimersByTime(50);
    });
    const bolt = document.querySelector(BOLT) as HTMLButtonElement | null;
    expect(bolt).toBeTruthy();
    act(() => {
      fireEvent.click(bolt!);
    });
    expect(document.querySelector(PANEL)).toBeTruthy();

    // Tab switch: this pane is hidden. Nothing about the selection changed.
    rerender(<Pane visible={false} editor={editor} />);
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(document.querySelector(BOLT), "hidden pane paints no bolt").toBeNull();
    expect(document.querySelector(PANEL), "hidden pane's menu unmounts").toBeNull();

    // Shown again: the bolt re-appears at a recomputed placement; the menu
    // does not spring back open.
    rerender(<Pane visible editor={editor} />);
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(document.querySelector(BOLT)).toBeTruthy();
    expect(document.querySelector(PANEL)).toBeNull();
  });
});

describe("PaneOverlayPortal (task 753)", () => {
  it("portals to body only while its pane is shown", () => {
    const view = (visible: boolean) => (
      <KeepAliveVisibilityProvider isVisible={visible}>
        <PaneOverlayPortal>
          <div data-testid="overlay" />
        </PaneOverlayPortal>
      </KeepAliveVisibilityProvider>
    );
    const { rerender } = render(view(true));
    expect(document.body.querySelector('[data-testid="overlay"]')?.parentElement).toBe(document.body);
    rerender(view(false));
    expect(document.body.querySelector('[data-testid="overlay"]')).toBeNull();
    rerender(view(true));
    expect(document.body.querySelector('[data-testid="overlay"]')).toBeTruthy();
  });

  it("outside any provider it behaves as visible (legacy default)", () => {
    render(
      <PaneOverlayPortal>
        <div data-testid="overlay" />
      </PaneOverlayPortal>,
    );
    expect(document.body.querySelector('[data-testid="overlay"]')).toBeTruthy();
  });
});
