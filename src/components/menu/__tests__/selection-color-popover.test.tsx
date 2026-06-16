// @vitest-environment jsdom
//
// SelectionColorPopover on the <Menu> primitive (Phase C): behavior PARITY +
// the new arrow nav over the swatches. Drives the REAL component through the
// full primitive stack (MenuProvider + useMenuItem + useMenuKeyboard) as the
// `role="dialog"` / `region="widget"` adapter:
//
//   - clicking a swatch applies that color (onApply); clicking clear strips it
//     (onClear); the native color input fires onPickCustom on change;
//   - the container is role="dialog" + aria-label="Text color" (the selector the
//     lightning panel's exclusion test pins);
//   - Up/Down arrow nav moves a visible data-active highlight over the swatches
//     + clear; Enter applies the active swatch;
//   - the native <input type="color"> registers as a region="widget"
//     focus-island — skipped by roving (never data-active) but Tab-reachable
//     (no tabIndex=-1);
//   - Escape closes (onClose); click-outside dismisses;
//   - onContainerRef reports the dialog container (the parent-exclusion wiring),
//     and a mousedown inside it is treated as "inside";
//   - the active swatch's domId mirrors onto a focused contentEditable's
//     aria-activedescendant (NO focus move to the swatch).

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import { SelectionColorPopover } from "../../SelectionColorPopover";

// jsdom has no ResizeObserver; useFloatingMenuPosition measures with one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const RECT = new DOMRect(100, 100, 30, 24);
const PALETTE = ["#e11d48", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#111827", "#6b7280"];

// A minimal Editor stub — the component never touches it (apply/clear/pick are
// all delegated to the parent's callbacks).
const editorStub = {} as unknown as Parameters<typeof SelectionColorPopover>[0]["editor"];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

function key(k: string, opts: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...opts }));
  });
}

function popover(): HTMLElement {
  return document.querySelector('div[role="dialog"][aria-label="Text color"]') as HTMLElement;
}

function swatchButtons(): HTMLButtonElement[] {
  // Swatches carry data-hint = the color; clear carries data-hint "Clear color".
  return Array.from(
    popover().querySelectorAll<HTMLButtonElement>('button[data-hint]'),
  );
}

function activeButton(): HTMLButtonElement | undefined {
  return swatchButtons().find((b) => b.getAttribute("data-active") === "");
}

function colorInput(): HTMLInputElement {
  return popover().querySelector('input[type="color"]') as HTMLInputElement;
}

function renderPopover(
  overrides: Partial<Parameters<typeof SelectionColorPopover>[0]> = {},
) {
  return render(
    <SelectionColorPopover
      editor={editorStub}
      anchorRect={RECT}
      palette={PALETTE}
      onApply={() => {}}
      onClear={() => {}}
      onPickCustom={() => {}}
      onClose={() => {}}
      {...overrides}
    />,
  );
}

describe("SelectionColorPopover — click parity", () => {
  it("renders role=dialog + aria-label='Text color'", () => {
    renderPopover();
    expect(popover()).toBeTruthy();
  });

  it("clicking a swatch fires onApply with that color", () => {
    const onApply = vi.fn();
    renderPopover({ onApply });
    const swatch = swatchButtons().find((b) => b.getAttribute("data-hint") === PALETTE[2]);
    expect(swatch).toBeDefined();
    fireEvent.click(swatch!);
    expect(onApply).toHaveBeenCalledWith(PALETTE[2]);
  });

  it("clicking clear fires onClear", () => {
    const onClear = vi.fn();
    renderPopover({ onClear });
    const clear = swatchButtons().find((b) => b.getAttribute("data-hint") === "Clear color");
    fireEvent.click(clear!);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("the custom color input fires onPickCustom on change", () => {
    const onPickCustom = vi.fn();
    renderPopover({ onPickCustom });
    const input = colorInput();
    fireEvent.change(input, { target: { value: "#abcdef" } });
    expect(onPickCustom).toHaveBeenCalledWith("#abcdef");
  });

  it("renders every palette swatch + a clear button", () => {
    renderPopover();
    const hints = swatchButtons().map((b) => b.getAttribute("data-hint"));
    for (const c of PALETTE) expect(hints).toContain(c);
    expect(hints).toContain("Clear color");
  });
});

describe("SelectionColorPopover — region='widget' focus-island", () => {
  it("the native color input is Tab-reachable (NOT tabIndex=-1) and not a roving stop", () => {
    renderPopover();
    const input = colorInput();
    // Tab-reachable: the registry/getItemProps tabIndex:-1 is NOT applied.
    expect(input.getAttribute("tabindex")).not.toBe("-1");
    // It carries the registry domId but never the roving highlight.
    expect(input.id).toBe("selection-color-item-custom");
    expect(input.getAttribute("data-active")).toBeNull();
  });

  it("arrow nav never lands on the widget color input", () => {
    renderPopover();
    // Walk the whole row twice; the active element is always a button, never the
    // input (roving skips region='widget').
    for (let i = 0; i < PALETTE.length + 4; i++) {
      key("ArrowDown");
      const active = activeButton();
      // Whatever is active is a button (the input never carries data-active).
      expect(colorInput().getAttribute("data-active")).toBeNull();
      if (active) expect(active.tagName).toBe("BUTTON");
    }
  });
});

describe("SelectionColorPopover — NEW arrow navigation over swatches", () => {
  it("Down/Up move a visible data-active highlight; Enter applies the active swatch", () => {
    const onApply = vi.fn();
    renderPopover({ onApply });
    key("ArrowDown"); // no active → first enabled (swatch 0)
    expect(activeButton()?.getAttribute("data-hint")).toBe(PALETTE[0]);
    key("ArrowDown");
    expect(activeButton()?.getAttribute("data-hint")).toBe(PALETTE[1]);
    key("ArrowUp");
    expect(activeButton()?.getAttribute("data-hint")).toBe(PALETTE[0]);

    key("Enter");
    expect(onApply).toHaveBeenCalledWith(PALETTE[0]);
  });

  it("End jumps to the clear button (last), Home back to the first swatch", () => {
    renderPopover();
    key("End");
    expect(activeButton()?.getAttribute("data-hint")).toBe("Clear color");
    key("Home");
    expect(activeButton()?.getAttribute("data-hint")).toBe(PALETTE[0]);
  });

  it("Enter on the clear button fires onClear", () => {
    const onClear = vi.fn();
    renderPopover({ onClear });
    key("End"); // clear
    key("Enter");
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

describe("SelectionColorPopover — Escape + click-outside", () => {
  it("Escape closes", () => {
    const onClose = vi.fn();
    renderPopover({ onClose });
    key("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("click outside dismisses (after the deferred mount)", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    renderPopover({ onClose });
    act(() => {
      vi.runAllTimers();
    });
    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("a mousedown INSIDE the popover does NOT dismiss", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    renderPopover({ onClose });
    act(() => {
      vi.runAllTimers();
    });
    const swatch = swatchButtons()[0];
    act(() => {
      swatch.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("SelectionColorPopover — parent-exclusion (onContainerRef)", () => {
  it("reports the role=dialog container on mount and null on unmount", () => {
    const onContainerRef = vi.fn();
    const { unmount } = renderPopover({ onContainerRef });
    // The first non-null call is the live dialog container.
    const reported = onContainerRef.mock.calls.map((c) => c[0]).find((el) => el !== null);
    expect(reported).toBeTruthy();
    expect(reported).toBe(popover());
    expect((reported as HTMLElement).getAttribute("role")).toBe("dialog");

    onContainerRef.mockClear();
    unmount();
    expect(onContainerRef).toHaveBeenCalledWith(null);
  });

  it("the reported container contains the swatches (so the parent excludes inner clicks)", () => {
    const onContainerRef = vi.fn();
    renderPopover({ onContainerRef });
    const reported = onContainerRef.mock.calls.map((c) => c[0]).find((el) => el !== null) as HTMLElement;
    expect(reported.contains(swatchButtons()[0])).toBe(true);
    expect(reported.contains(colorInput())).toBe(true);
  });
});

describe("SelectionColorPopover — aria-activedescendant (no focus theft)", () => {
  it("mirrors the active swatch's domId onto a focused contentEditable, never focusing the swatch", () => {
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    editable.tabIndex = 0;
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);
    editable.focus();
    expect(document.activeElement).toBe(editable);

    renderPopover();
    key("ArrowDown");

    const active = activeButton();
    expect(active).toBeDefined();
    expect(editable.getAttribute("aria-activedescendant")).toBe(active!.id);
    expect(document.activeElement).toBe(editable);
  });
});
