// @vitest-environment jsdom
//
// Task 992 — the ⚡ bolt is a menu TRIGGER and pays the whole trigger contract
// (`menu/menu-trigger.ts`): it rides the lightning menu's `excludeRefs`, so a
// re-press is a TOGGLE (closed, not closed-then-remounted by the capture-phase
// click-outside), matching its keyboard twin Cmd+/; and it announces
// `aria-haspopup="menu"` + an `aria-expanded` that tracks the menu.
//
// Harness shared with `SelectionActionsMenu-placement-decouple.test.tsx`.

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
    mounts: 0,
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
// The panel is replaced by a minimal body on the REAL `<MenuProvider>`, wired
// exactly as `ActionsMenuPanel` wires its trigger (`excludeRefs`), so the test
// exercises the real capture-phase click-outside the bolt must be exempt from.
vi.mock("../ActionsMenuPanel", async () => {
  const { useEffect } = await import("react");
  const { MenuProvider } = await import("../menu/MenuProvider");
  function Panel({
    triggerRect,
    triggerEl,
    onClose,
  }: {
    triggerRect: DOMRect;
    triggerEl?: HTMLElement | null;
    onClose: () => void;
  }) {
    useEffect(() => {
      h.mounts += 1;
    }, []);
    return (
      <MenuProvider
        id="lightning"
        layout="composite"
        role="menu"
        anchorRect={triggerRect}
        placements={[{ side: "below", align: "start" }]}
        excludeRefs={[triggerEl ?? null]}
        onClose={onClose}
        ariaLabel="Selection actions"
      >
        <div data-testid="actions-menu-panel" />
      </MenuProvider>
    );
  }
  return { ActionsMenuPanel: Panel };
});
vi.mock("../Hint", () => ({ useHint: () => ({}) }));
vi.mock("../editor-layout/panel-icons", () => ({
  IconZap: () => <span data-testid="icon-zap" />,
}));
vi.mock("@/components/editor-layout/layout-scroll", () => ({
  findEditorScrollFor: () => h.scrollParent,
}));
vi.mock("@/floats/float-policy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/floats/float-policy")>()),
  RESTING_MARGIN_TRIGGER_Z: 1199,
}));
vi.mock("@/lib/scroll-reposition-probe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scroll-reposition-probe")>()),
  recordScrollPlacement: () => {},
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

const bolt = () =>
  document.querySelector(
    'button[aria-label="Open actions menu"]',
  ) as HTMLButtonElement | null;
const panel = () => document.querySelector('[data-testid="actions-menu-panel"]');

/** A real press: the capture-phase pointerdown the menu's click-outside hears,
 *  then the click. The dismiss listener arms one task after open. */
function press(el: Element) {
  act(() => {
    vi.advanceTimersByTime(10);
  });
  // Press and click in SEPARATE acts: in a browser they are separate tasks,
  // so a close on the press RENDERS before the click runs — one batched act
  // would hand the click a stale `menuTarget` and hide a close-then-reopen.
  act(() => {
    fireEvent.pointerDown(el);
    fireEvent.mouseDown(el);
  });
  act(() => {
    fireEvent.mouseUp(el);
    fireEvent.click(el);
  });
}

describe("SelectionActionsMenu — the bolt is a toggle trigger (task 992)", () => {
  beforeEach(() => {
    h.mounts = 0;
  });

  it("announces aria-haspopup=menu and an aria-expanded that tracks the menu", () => {
    render(<SelectionActionsMenu editor={makeEditor()} />);
    expect(bolt()!.getAttribute("aria-haspopup")).toBe("menu");
    expect(bolt()!.getAttribute("aria-expanded")).toBe("false");
    press(bolt()!);
    expect(panel()).toBeTruthy();
    expect(bolt()!.getAttribute("aria-expanded")).toBe("true");
    press(bolt()!);
    expect(bolt()!.getAttribute("aria-expanded")).toBe("false");
  });

  it("a second press on the bolt CLOSES the menu — no close-then-remount", () => {
    render(<SelectionActionsMenu editor={makeEditor()} />);
    press(bolt()!);
    expect(panel()).toBeTruthy();
    expect(h.mounts).toBe(1);

    press(bolt()!);
    expect(panel(), "re-pressing the bolt closes its menu").toBeNull();
    expect(h.mounts, "the menu was never re-mounted").toBe(1);

    // And it opens again on the next press (a toggle, not a one-way close).
    press(bolt()!);
    expect(panel()).toBeTruthy();
    expect(h.mounts).toBe(2);
  });

  it("a press OUTSIDE still dismisses (the exemption is the trigger alone)", () => {
    render(<SelectionActionsMenu editor={makeEditor()} />);
    press(bolt()!);
    expect(panel()).toBeTruthy();
    press(document.body);
    expect(panel()).toBeNull();
  });
});
