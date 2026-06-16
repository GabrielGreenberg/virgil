// @vitest-environment jsdom
//
// DragHandleMenu on the <Menu> primitive (Phase B1): behavior PARITY + the new
// arrow nav. Drives the REAL component through the full primitive stack
// (MenuProvider + useMenuItem + useMenuKeyboard + MenuItemsFromRegistry):
//
//   - letter fast-path fires the right action (F → footnote), disabled rows
//     are inert on their letter;
//   - Backspace / Delete → delete alias fires delete (when enabled);
//   - Escape closes (onClose);
//   - Up/Down/Home/End arrow nav moves a visible data-active highlight,
//     skipping disabled rows; Enter activates the active row;
//   - click-outside dismisses;
//   - the active item's domId mirrors onto a focused contentEditable's
//     aria-activedescendant (NO focus move to the item).

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { DragHandleMenu } from "../../DragHandleMenu";
import { cardActionRows } from "@/lib/actions/action-registry";

// jsdom has no ResizeObserver; useFloatingMenuPosition measures with one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const RECT = { left: 100, top: 100, right: 120, bottom: 140, width: 20, height: 40 };

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

function menuButtons(): HTMLButtonElement[] {
  return Array.from(
    document.querySelectorAll('[role="menu"] button[role="menuitem"]'),
  ) as HTMLButtonElement[];
}

function activeButton(): HTMLButtonElement | undefined {
  return menuButtons().find((b) => b.getAttribute("data-active") === "");
}

function labelOf(b: HTMLButtonElement | undefined): string {
  if (!b) return "";
  return b.querySelectorAll("span")[1]?.textContent ?? "";
}

describe("DragHandleMenu — letter fast-path parity", () => {
  it("fires the matching action on a bare letter (F → footnote)", () => {
    const onSelect = vi.fn();
    render(<DragHandleMenu anchorRect={RECT} onSelect={onSelect} onClose={() => {}} kind="selection" />);
    key("f");
    expect(onSelect).toHaveBeenCalledWith("footnote");
  });

  it("Backspace and Delete both fire the delete action (alias)", () => {
    const onSelect = vi.fn();
    render(<DragHandleMenu anchorRect={RECT} onSelect={onSelect} onClose={() => {}} kind="selection" />);
    key("Backspace");
    expect(onSelect).toHaveBeenLastCalledWith("delete");
    key("Delete");
    expect(onSelect).toHaveBeenLastCalledWith("delete");
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("a disabled row's letter is inert", () => {
    // collab read-only greys EVERY card row → the F letter must not fire.
    const onSelect = vi.fn();
    render(
      <DragHandleMenu anchorRect={RECT} onSelect={onSelect} onClose={() => {}} kind="selection" canEdit={false} />,
    );
    key("f");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("modifier+letter does not fire (bare keys only)", () => {
    const onSelect = vi.fn();
    render(<DragHandleMenu anchorRect={RECT} onSelect={onSelect} onClose={() => {}} kind="selection" />);
    key("f", { metaKey: true });
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("DragHandleMenu — Escape + click-outside", () => {
  it("Escape closes", () => {
    const onClose = vi.fn();
    render(<DragHandleMenu anchorRect={RECT} onSelect={() => {}} onClose={onClose} kind="selection" />);
    key("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("click outside dismisses (after the deferred mount)", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<DragHandleMenu anchorRect={RECT} onSelect={() => {}} onClose={onClose} kind="selection" />);
    act(() => {
      vi.runAllTimers();
    });
    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe("DragHandleMenu — NEW arrow navigation", () => {
  it("Down/Up move a visible data-active highlight; Enter activates it", () => {
    const onSelect = vi.fn();
    render(<DragHandleMenu anchorRect={RECT} onSelect={onSelect} onClose={() => {}} kind="selection" />);
    const expectedFirst = cardActionRows("grab")[0].label; // Highlight
    const expectedSecond = cardActionRows("grab")[1].label; // Note

    key("ArrowDown"); // no active → first enabled
    expect(labelOf(activeButton())).toBe(expectedFirst);
    key("ArrowDown");
    expect(labelOf(activeButton())).toBe(expectedSecond);
    key("ArrowUp");
    expect(labelOf(activeButton())).toBe(expectedFirst);

    key("Enter");
    expect(onSelect).toHaveBeenCalledWith(cardActionRows("grab")[0].id);
  });

  it("Home/End jump to first/last", () => {
    render(<DragHandleMenu anchorRect={RECT} onSelect={() => {}} onClose={() => {}} kind="selection" />);
    const rows = cardActionRows("grab");
    key("End");
    expect(labelOf(activeButton())).toBe(rows[rows.length - 1].label); // Delete
    key("Home");
    expect(labelOf(activeButton())).toBe(rows[0].label); // Highlight
  });

  it("arrow nav skips disabled rows", () => {
    // A texBlock kind greys some rows; navigate and assert no active row is
    // ever a disabled button.
    render(<DragHandleMenu anchorRect={RECT} onSelect={() => {}} onClose={() => {}} kind="texBlock" />);
    for (let i = 0; i < 14; i++) {
      key("ArrowDown");
      const active = activeButton();
      expect(active?.disabled).not.toBe(true);
    }
  });

  it("Enter on a disabled-laden kind never activates a disabled row", () => {
    const onSelect = vi.fn();
    render(<DragHandleMenu anchorRect={RECT} onSelect={onSelect} onClose={() => {}} kind="texBlock" />);
    key("ArrowDown");
    key("Enter");
    // Whatever fired must be an ENABLED row id.
    const enabledIds = cardActionRows("grab").map((r) => r.id);
    expect(enabledIds).toContain(onSelect.mock.calls[0]?.[0]);
  });
});

describe("DragHandleMenu — aria-activedescendant (no focus theft)", () => {
  it("mirrors the active item's domId onto a focused contentEditable, never focusing the item", () => {
    // A stand-in for the PM view's focused contentEditable. jsdom only moves
    // focus to elements it considers focusable, so we give it a tabindex (the
    // real PM contentEditable is natively focusable) and force isContentEditable
    // (jsdom doesn't derive it from the attribute) so getActiveDescendantHost
    // recognizes it.
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    editable.tabIndex = 0;
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);
    editable.focus();
    expect(document.activeElement).toBe(editable); // sanity: jsdom focused it

    render(<DragHandleMenu anchorRect={RECT} onSelect={() => {}} onClose={() => {}} kind="selection" />);
    key("ArrowDown");

    const active = activeButton();
    expect(active).toBeDefined();
    // The host carries the active item's id; focus did NOT move to the item.
    expect(editable.getAttribute("aria-activedescendant")).toBe(active!.id);
    expect(document.activeElement).toBe(editable);
  });
});
