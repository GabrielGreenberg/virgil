// @vitest-environment jsdom
//
// ItemMenu rows are KEYBOARD-OPERABLE (task 477).
//
// The four numbers the audit measured on the pre-477 tree, driving this same
// REAL component with one `MenuDelete` and one plain row:
//
//     container role="menu" present : true
//     registered menuitem children  : 0        ← the registry was empty
//     Enter on a focused row        : defaultPrevented = true, onClick 0 times
//     ArrowDown                     : defaultPrevented = true
//     aria-activedescendant         : null (before and after)
//
// Each of the three legs below flips one of them, and every one fails on the
// pre-fix rows (measured by neutering each half in turn). The census in
// `menu/__tests__/menu-row-registration-census.test.ts` is the leg with teeth —
// this file proves the mechanism works, that one proves nothing new escapes it.
//
// The keyboard is driven at `window` in CAPTURE phase, which is where
// `useMenuKeyboard` installs its listener: dispatching on the row would be a
// different (and easier) question than the one the controller answers.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen, act } from "@testing-library/react";

// panel-primitives pulls the storage barrel transitively; stub it so the heavy
// FSA/dev backend graph doesn't load under vitest.
vi.mock("@/lib/storage", () => ({}));
// Keep the auto-injected text-size row inert: no enclosing panel body key.
vi.mock("../panel-kind-context", () => ({ useEnclosingPanelBodyKey: () => null }));

import { ItemMenu, MenuDelete, MenuArchive } from "../panel-primitives";
import { CardViewModeMenuItems } from "@/panels/_shared/CardViewModeMenu";
import { CardArchiveViewProvider } from "@/panels/_shared/card-archive-view";

afterEach(() => cleanup());

function openMenu(container: HTMLElement) {
  fireEvent.click(container.querySelector('[aria-haspopup="menu"]') as HTMLElement);
}
const menu = () => document.body.querySelector('[role="menu"]') as HTMLElement | null;
const items = () =>
  [...document.body.querySelectorAll('[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]')];
// `act` because a consumed key can close the menu, which is React STATE in
// `AnchoredMenu` — a bare `dispatchEvent` leaves that update unflushed and the
// assertion reads a menu that is already logically closed.
const key = (k: string) => {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
  act(() => {
    window.dispatchEvent(e);
  });
  return e;
};

describe("ItemMenu rows — registration + keyboard (task 477)", () => {
  it("registers its rows as menuitems (the registry was EMPTY)", () => {
    const { container } = render(
      <ItemMenu>
        <MenuArchive onClick={() => {}} />
        <MenuDelete onClick={() => {}} />
      </ItemMenu>,
    );
    openMenu(container);
    expect(menu()).toBeTruthy();
    expect(items()).toHaveLength(2);
    expect(items().map((el) => el.getAttribute("role"))).toEqual([
      "menuitem",
      "menuitem",
    ]);
  });

  it("ArrowDown moves the roving cursor and the trigger's aria-activedescendant", () => {
    const { container } = render(
      <ItemMenu>
        <MenuArchive onClick={() => {}} />
        <MenuDelete onClick={() => {}} />
      </ItemMenu>,
    );
    const trigger = container.querySelector('[aria-haspopup="menu"]') as HTMLElement;
    openMenu(container);
    expect(trigger.getAttribute("aria-activedescendant")).toBeNull();

    key("ArrowDown");
    const first = trigger.getAttribute("aria-activedescendant");
    expect(first).toBeTruthy();
    expect(document.getElementById(first!)?.textContent).toBe("Archive");

    key("ArrowDown");
    const second = trigger.getAttribute("aria-activedescendant");
    expect(second).not.toBe(first);
    expect(document.getElementById(second!)?.textContent).toBe("Delete");
  });

  it("Enter activates the active row AND closes the menu", () => {
    const onDelete = vi.fn();
    const { container } = render(
      <ItemMenu>
        <MenuArchive onClick={() => {}} />
        <MenuDelete onClick={onDelete} />
      </ItemMenu>,
    );
    openMenu(container);
    key("ArrowDown");
    key("ArrowDown");
    const e = key("Enter");
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
    // The close is the MENU-layer policy (`closeOnActivate`), not the DOM
    // wrapper: the controller runs a row by calling its handler directly, so
    // there is no click to bubble into `closeOnInsideClick`.
    expect(menu()).toBeNull();
  });

  it("a MOUSE click still fires the row and closes (non-regression)", () => {
    const onDelete = vi.fn();
    const { container } = render(
      <ItemMenu>
        <MenuDelete onClick={onDelete} />
      </ItemMenu>,
    );
    openMenu(container);
    fireEvent.click(screen.getByText("Delete"));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(menu()).toBeNull();
  });

  it("does not swallow Enter when the menu has NO registered rows", () => {
    // Defence-in-depth: a menu whose rows a future author forgets to register
    // must degrade to Tab+Enter rather than to nothing. Pre-477 `consume()`
    // returned true unconditionally and `preventDefault()` suppressed the very
    // click the focused control needed.
    const { container } = render(
      <ItemMenu>
        <span>not a row</span>
      </ItemMenu>,
    );
    openMenu(container);
    expect(items()).toHaveLength(0);
    expect(key("Enter").defaultPrevented).toBe(false);
  });

  it("the three View rows are a menuitemRADIO set, keyboard-pickable", () => {
    // A mutually-exclusive set: picking one un-picks the others, which is the
    // radio semantic — `menuitemcheckbox` would announce three independent
    // toggles. Pre-477 they were bare `<button aria-pressed>`s the registry
    // never saw, activated only by `onMouseDown`.
    const setView = vi.fn();
    const { container } = render(
      <CardArchiveViewProvider
        value={{
          getView: () => "active",
          setView,
          suppressAtomWarning: false,
          setSuppressAtomWarning: () => {},
        }}
      >
        <ItemMenu align="left">
          <CardViewModeMenuItems kind="notes" />
        </ItemMenu>
      </CardArchiveViewProvider>,
    );
    openMenu(container);
    const rows = [...document.body.querySelectorAll('[role="menuitemradio"]')];
    expect(rows.map((r) => r.textContent?.replace("✓", "").trim())).toEqual([
      "View Active",
      "View Archives",
      "View All",
    ]);
    expect(rows.map((r) => r.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
      "false",
    ]);

    key("ArrowDown");
    key("ArrowDown");
    key("Enter");
    expect(setView).toHaveBeenCalledWith("notes", "archived");
    // A View pick still dismisses the kebab, exactly as it did through the
    // bubbled click before: these three are ONE decision, not a run of toggles,
    // so the row deliberately does not pass `keepMenuOpen`.
    expect(menu()).toBeNull();
  });
});
