// @vitest-environment jsdom
//
// ItemMenu — the three-dot card/panel header menu (panel-primitives.tsx),
// used by all 8 card panels + CardViewModeMenu.
//
// Pins surface #4 of the dialog/overlay primitive-unification cluster (task 033):
// the menu folds off its old hand-rolled `fixed z-[9999]` portal + bespoke
// `document.addEventListener('mousedown')` closer onto the shared `<Menu>`
// primitive (MenuProvider) — BODY-PORTALED at the chrome-menu tier
// (OPEN_CHROME_MENU_Z = 2000), one dismiss/keyboard controller, Esc-to-close.
//
// Contracts pinned:
//   1. the dropdown renders under document.body, NOT inside the trigger wrapper
//      (escapes the sticky-bar stacking-context trap — same win as #6);
//   2. it carries the chrome-menu z tier (2000), not the old 9999;
//   3. a click on any item closes the menu (the old "any click inside dismisses"
//      semantics) and the item's own handler still fires;
//   4. Escape closes the menu (new — the hand-rolled version had no keyboard);
//   5. an outside mousedown closes it, but a click on the trigger toggles it
//      (the trigger is exempt from click-outside via excludeRefs);
//   6. both align="left" and align="right" open (placement smoke).
//
// panel-kind context is mocked so the PanelTextSizeRow auto-injection stays
// inert (bodyKey = null) and this is a focused chrome test, not a panel boot.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen, act } from "@testing-library/react";

/** Flush the `setTimeout(…, 0)` that defers the click-outside listener attach. */
const flushDeferredListeners = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

// panel-primitives pulls the storage barrel transitively; stub it so the
// heavy FSA/dev backend graph doesn't load under vitest (the documented
// `@/lib/storage-fsa` resolution failure).
vi.mock("@/lib/storage", () => ({}));

// Keep the auto-injected text-size row inert: no enclosing panel body key.
vi.mock("../panel-kind-context", () => ({
  useEnclosingPanelBodyKey: () => null,
}));

import { ItemMenu } from "../panel-primitives";

afterEach(() => cleanup());

function trigger(container: HTMLElement): HTMLElement {
  return container.querySelector('[aria-haspopup="menu"]') as HTMLElement;
}
function openMenu(container: HTMLElement) {
  fireEvent.click(trigger(container));
}

describe("ItemMenu — <Menu> fold (surface #4)", () => {
  it("body-portals the dropdown (escapes the sticky-bar stacking trap)", () => {
    const { container } = render(
      <ItemMenu>
        <button>Delete</button>
      </ItemMenu>,
    );
    openMenu(container);
    const menu = document.body.querySelector('[role="menu"]');
    expect(menu).toBeTruthy();
    // NOT a descendant of the trigger's own wrapper — that's the whole point.
    expect(container.contains(menu)).toBe(false);
  });

  it("carries the chrome-menu z tier (2000), not the old inline 9999", () => {
    const { container } = render(
      <ItemMenu>
        <button>Delete</button>
      </ItemMenu>,
    );
    openMenu(container);
    const menu = document.body.querySelector('[role="menu"]') as HTMLElement;
    expect(menu.style.zIndex).toBe("2000");
  });

  it("closes on an item click and still fires the item's handler", () => {
    const onPick = vi.fn();
    const { container } = render(
      <ItemMenu>
        <button onClick={onPick}>Delete</button>
      </ItemMenu>,
    );
    openMenu(container);
    fireEvent.click(screen.getByText("Delete"));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it("fires an item that activates on mousedown+preventDefault (MenuDelete pattern)", () => {
    const onPick = vi.fn();
    const { container } = render(
      <ItemMenu>
        <button onMouseDown={(e) => { e.preventDefault(); onPick(); }}>Delete</button>
      </ItemMenu>,
    );
    openMenu(container);
    const item = screen.getByText("Delete");
    fireEvent.mouseDown(item);
    fireEvent.click(item);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it("closes on Escape (the hand-rolled version had no keyboard)", () => {
    const { container } = render(
      <ItemMenu>
        <button>Delete</button>
      </ItemMenu>,
    );
    openMenu(container);
    expect(document.body.querySelector('[role="menu"]')).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it("closes on an outside mousedown but the trigger toggles it", async () => {
    const { container } = render(
      <ItemMenu>
        <button>Delete</button>
      </ItemMenu>,
    );
    openMenu(container);
    expect(document.body.querySelector('[role="menu"]')).toBeTruthy();
    // The click-outside listener attaches on a deferred setTimeout(0) so the
    // opening click can't self-close it — flush before the outside mousedown.
    await flushDeferredListeners();
    fireEvent.mouseDown(document.body);
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    // Trigger re-opens (it's exempt from click-outside).
    openMenu(container);
    expect(document.body.querySelector('[role="menu"]')).toBeTruthy();
  });

  it("opens for both align variants", () => {
    const left = render(
      <ItemMenu align="left">
        <button>L</button>
      </ItemMenu>,
    );
    openMenu(left.container);
    expect(document.body.querySelector('[role="menu"]')).toBeTruthy();
    cleanup();

    const right = render(
      <ItemMenu align="right">
        <button>R</button>
      </ItemMenu>,
    );
    openMenu(right.container);
    expect(document.body.querySelector('[role="menu"]')).toBeTruthy();
  });
});
