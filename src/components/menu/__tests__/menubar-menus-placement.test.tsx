// @vitest-environment jsdom
//
// Task 751 — MenuBar's two dropdowns are placed by the primitive's ONE
// positioner, not by hand.
//
// Both used to take `<MenuProvider portal={false}>` and hand-roll a RAF flip
// into placement classes, each dropping a different guard:
//   - the View menu (⋮) had no height cap: fully expanded (~1,100 px) under a
//     top-of-pane trigger it ran off the window, its last rows unreachable;
//   - the ¶ block-type dropdown's `absolute` classes lost to the docked
//     branch's inline `position: relative`, so it rendered in flow (pushing the
//     lightning grid) and its flip never applied.
// The docked path is gone; these drive the REAL components with stubbed rects
// and assert the placement the positioner resolves.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import { BlockTypeDropdown, ViewMenu } from "../../MenuBar";
import type { Editor } from "@tiptap/react";
import type { DividerLevel } from "@/hooks/useViewPrefs";
import { REGISTRY_DEFAULTS } from "@/lib/view-prefs/registry";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

type Box = { left: number; top: number; width: number; height: number };
const rect = ({ left, top, width, height }: Box): DOMRect =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;

let triggerBox: Box;
let menuSize: { width: number; height: number };

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 700 });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.getAttribute("aria-haspopup") === "menu") return rect(triggerBox);
    if (this.getAttribute("role") === "menu") return rect({ left: 0, top: 0, ...menuSize });
    return rect({ left: 0, top: 0, width: 0, height: 0 });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

async function settle() {
  // The positioner measures on a microtask after layout.
  await act(async () => {
    await Promise.resolve();
  });
}

function menuEl(): HTMLElement {
  return document.querySelector('[role="menu"]') as HTMLElement;
}

function stubEditor(): Editor {
  return {
    isEditable: true,
    schema: { nodes: { heading: { name: "heading" } } },
    isActive: () => false,
    chain: () => ({}),
    view: { editable: true, state: { selection: { head: 1 }, doc: {} } },
  } as unknown as Editor;
}

describe("ViewMenu — capped to the room below its top-of-pane trigger", () => {
  it("a fully expanded (taller-than-window) menu gets maxHeight + scroll, not overflow", async () => {
    triggerBox = { left: 900, top: 40, width: 20, height: 20 };
    menuSize = { width: 208, height: 1100 };
    const { container } = render(
      <ViewMenu
        viewPrefs={{ ...REGISTRY_DEFAULTS }}
        availableDividerLevels={new Set<DividerLevel>([1, 2, 3])}
        onToggleViewPref={vi.fn()}
        onSetViewPref={vi.fn()}
        onToggleViewPrefMember={vi.fn()}
        onCloseAllPanels={vi.fn()}
        onOpenFontsDialog={vi.fn()}
        onOpenMarginsMode={vi.fn()}
      />,
    );
    fireEvent.click(container.querySelector("button")!);
    await settle();
    const m = menuEl();
    expect(m.parentElement).toBe(document.body);
    expect(m.style.position).toBe("fixed");
    // Below the trigger (the side with room — "above" has ~26 px), capped to
    // exactly the space between trigger+gap and the bottom margin, scrolling.
    const roomBelow = 700 - 8 - (60 + 6);
    expect(parseFloat(m.style.top)).toBe(66);
    expect(parseFloat(m.style.maxHeight)).toBe(roomBelow);
    expect(m.style.overflowY).toBe("auto");
  });

  it("right-aligns to the kebab by default (the old `right-0`)", async () => {
    triggerBox = { left: 900, top: 40, width: 20, height: 20 };
    menuSize = { width: 208, height: 300 };
    const { container } = render(
      <ViewMenu
        viewPrefs={{ ...REGISTRY_DEFAULTS }}
        availableDividerLevels={new Set<DividerLevel>()}
        onToggleViewPref={vi.fn()}
        onSetViewPref={vi.fn()}
        onToggleViewPrefMember={vi.fn()}
        onCloseAllPanels={vi.fn()}
        onOpenFontsDialog={vi.fn()}
        onOpenMarginsMode={vi.fn()}
      />,
    );
    fireEvent.click(container.querySelector("button")!);
    await settle();
    expect(parseFloat(menuEl().style.left)).toBe(920 - 208);
  });
});

describe("BlockTypeDropdown — out of flow, and its flip is live", () => {
  it("opens below its trigger when there is room", async () => {
    triggerBox = { left: 100, top: 200, width: 30, height: 20 };
    menuSize = { width: 160, height: 260 };
    const { container } = render(<BlockTypeDropdown editor={stubEditor()} />);
    fireEvent.click(container.querySelector("button")!);
    await settle();
    const m = menuEl();
    expect(container.contains(m)).toBe(false);
    expect(m.style.position).toBe("fixed");
    expect(parseFloat(m.style.top)).toBe(224);
    expect(parseFloat(m.style.left)).toBe(100);
  });

  it("flips ABOVE when stubbed near the viewport bottom", async () => {
    triggerBox = { left: 100, top: 600, width: 30, height: 20 };
    menuSize = { width: 160, height: 260 };
    const { container } = render(<BlockTypeDropdown editor={stubEditor()} />);
    fireEvent.click(container.querySelector("button")!);
    await settle();
    expect(parseFloat(menuEl().style.top)).toBe(600 - 4 - 260);
  });

  it("a mousedown on its own trigger does not dismiss (the trigger toggles)", async () => {
    triggerBox = { left: 100, top: 200, width: 30, height: 20 };
    menuSize = { width: 160, height: 260 };
    vi.useFakeTimers();
    const { container } = render(<BlockTypeDropdown editor={stubEditor()} />);
    const trigger = container.querySelector("button")!;
    fireEvent.click(trigger);
    act(() => {
      vi.runAllTimers();
    });
    act(() => {
      trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(menuEl()).toBeTruthy();
    fireEvent.click(trigger);
    expect(menuEl()).toBeNull();
    vi.useRealTimers();
  });
});
