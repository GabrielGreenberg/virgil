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
//   (1) menuTarget survives a full scroll suppress→idle cycle (menu not
//       unmounted) — the sev-med regression;
//   (2) a genuine off-screen recompute (visible:false, range preserved) still
//       closes the menu;
//   (3) Cmd+/ with an off-screen caret calls scrollIntoView and, once the caret
//       is brought on-screen, opens the panel at a real (non-0,0) position.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { createRef } from "react";
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
    // STABLE cacheRef identity — the real useEditorViewportCache returns a
    // stable ref, and SelectionActionsMenu's placement effect lists `cacheRef`
    // in its deps. A fresh ref each render would churn that effect (clearing the
    // scroll-idle timer mid-gesture), which the component never does in prod.
    cacheRef: { current: cache as unknown },
    scrollParent: null as HTMLElement | null,
    scrollIntoView: vi.fn(),
  };
});

vi.mock("@/hooks/useEditorViewportCache", () => ({
  useEditorViewportCache: () => ({ cacheRef: h.cacheRef, version: 0 }),
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
  it("keeps the OPEN menu mounted across a scroll suppress→idle cycle", () => {
    const ref = createRef<Editor | null>();
    ref.current = makeEditor();
    const { baseElement } = render(<SelectionActionsMenu editorRef={ref} />);

    openViaBolt(baseElement as HTMLElement);
    expect(
      baseElement.querySelector('[data-testid="actions-menu-panel"]'),
    ).toBeTruthy();

    // First scroll tick → suppress() (hides the bolt, must NOT close the menu).
    act(() => {
      fireEvent.scroll(h.scrollParent!);
    });
    expect(
      baseElement.querySelector('[data-testid="actions-menu-panel"]'),
      "menu must survive the scroll-suppress tick",
    ).toBeTruthy();
    // The resting bolt is hidden during suppression.
    expect(
      baseElement.querySelector('button[aria-label="Open actions menu"]'),
    ).toBeNull();

    // Idle timer (120ms) + the RAF recompute fire; caret still on-screen.
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(
      baseElement.querySelector('[data-testid="actions-menu-panel"]'),
      "menu must survive the full suppress→idle cycle",
    ).toBeTruthy();
    // Bolt returns after settle.
    expect(
      baseElement.querySelector('button[aria-label="Open actions menu"]'),
    ).toBeTruthy();
  });

  it("closes the menu when the anchored selection scrolls fully off-screen", () => {
    const ref = createRef<Editor | null>();
    ref.current = makeEditor();
    const { baseElement } = render(<SelectionActionsMenu editorRef={ref} />);

    openViaBolt(baseElement as HTMLElement);
    expect(
      baseElement.querySelector('[data-testid="actions-menu-panel"]'),
    ).toBeTruthy();

    // Selection goes off-screen (bottom < scrollTop) → recompute yields
    // visible:false with range preserved → genuine close.
    h.coords = { left: 200, top: -80, bottom: -60 };
    act(() => {
      fireEvent.scroll(h.scrollParent!);
      vi.advanceTimersByTime(300);
    });
    expect(
      baseElement.querySelector('[data-testid="actions-menu-panel"]'),
      "a genuine off-screen drop still closes the menu",
    ).toBeNull();
  });

  // Task 299 — the resting ⚡ bolt's hover-on-light affordance must be LIVE.
  // An inline `background` shorthand sets `background-color` and (as an inline
  // decl) shadows `.hover-on-light:hover`, so the resting bg MUST live on the
  // class layer for the hover tint to fire. We pin the source-shape contract
  // (jsdom applies no stylesheet, so :hover computed styles aren't meaningful):
  // the affordance class is present AND no inline background shadows it.
  it("keeps the resting bolt's hover affordance live (no inline bg shadow)", () => {
    const ref = createRef<Editor | null>();
    ref.current = makeEditor();
    const { baseElement } = render(<SelectionActionsMenu editorRef={ref} />);
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
    expect(bolt!.style.boxShadow).toBe("var(--pod-shadow)");
    expect(bolt!.style.borderRadius).toBe("var(--pod-radius)");
  });

  it("Cmd+/ with an off-screen caret calls scrollIntoView and opens on-screen", () => {
    const ref = createRef<Editor | null>();
    ref.current = makeEditor();
    // Caret starts off-screen: no bolt, no menu.
    h.coords = { left: 200, top: -80, bottom: -60 };
    const { baseElement } = render(<SelectionActionsMenu editorRef={ref} />);
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(
      baseElement.querySelector('button[aria-label="Open actions menu"]'),
    ).toBeNull();

    // Cmd+/ — must NOT be swallowed: scrollIntoView is called and menuTarget set.
    act(() => {
      fireEvent.keyDown(document.body, { key: "/", metaKey: true });
    });
    expect(h.scrollIntoView).toHaveBeenCalledTimes(1);
    // Panel not yet rendered (placement still off-screen until scroll settles).
    expect(
      baseElement.querySelector('[data-testid="actions-menu-panel"]'),
    ).toBeNull();

    // scrollIntoView brings the caret on-screen; the resulting scroll settles
    // and the recompute yields a real placement — the RISE must NOT close the
    // menu it just opened, and the panel anchors off the 0,0 corner.
    h.coords = { left: 200, top: 100, bottom: 120 };
    act(() => {
      fireEvent.scroll(h.scrollParent!);
      vi.advanceTimersByTime(300);
    });
    const panel = baseElement.querySelector(
      '[data-testid="actions-menu-panel"]',
    );
    expect(panel, "Cmd+/ opens the menu after the caret scrolls in").toBeTruthy();
    expect(panel?.getAttribute("data-left")).not.toBe("0");
    expect(panel?.getAttribute("data-top")).not.toBe("0");
  });
});
