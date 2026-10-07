// @vitest-environment jsdom
//
// Task 995 — the editable an editor-anchored menu parks the caret in is OWNED
// per open, not re-derived from live focus.
//
// `caretEditableHost()` answers "whatever contentEditable is focused NOW". The
// keyboard controller used to ask it per keydown, so:
//   1. FOCUS DRIFT — focus that moved to another contentEditable while the menu
//      stayed open (nothing closes a menu on focus-out) became "the menu's":
//      its Backspace ran `DragHandleMenu`'s delete row on the ORIGINAL block.
//   2. NESTED CLOBBER — two menus sharing one host (⚡ + its color popover):
//      the child's close unconditionally removed `aria-activedescendant`, and
//      the parent's sync never re-fired, so the parent's row went unannounced.
//
// Keys are dispatched on the element that receives them, the way a browser
// does (task 731's class), never on `window`.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { DragHandleMenu } from "../../DragHandleMenu";
import { MenuProvider } from "../MenuProvider";
import { useMenuItem } from "../useMenuItem";
import { caretEditableHost, claimActiveDescendant } from "../caret-host";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const RECT = { left: 100, top: 100, right: 120, bottom: 140, width: 20, height: 40 };
const PLACEMENTS = [{ side: "below" as const, align: "start" as const }];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

function mountEditable(): HTMLDivElement {
  const el = document.createElement("div");
  el.contentEditable = "true";
  el.tabIndex = 0;
  Object.defineProperty(el, "isContentEditable", { value: true, configurable: true });
  document.body.appendChild(el);
  return el;
}

function keyOn(el: HTMLElement, k: string): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
  act(() => {
    el.dispatchEvent(e);
  });
  return e;
}

describe("task 995 — focus drift does not transfer menu ownership", () => {
  it("Backspace in a contentEditable focus drifted to is NOT consumed and runs no delete row", () => {
    const a = mountEditable();
    const b = mountEditable();
    a.focus();
    const onSelect = vi.fn();
    render(<DragHandleMenu anchorRect={RECT} onSelect={onSelect} onClose={() => {}} kind="selection" />);

    // Focus drifts (Tab into a card title / footnote sub-editor) while the
    // menu stays open.
    b.focus();
    expect(document.activeElement).toBe(b);

    const fieldHandler = vi.fn();
    b.addEventListener("keydown", fieldHandler);
    const e = keyOn(b, "Backspace");
    expect(onSelect).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
    expect(fieldHandler).toHaveBeenCalledTimes(1);
    // The drifted-to field never acquired the menu's activedescendant.
    expect(b.hasAttribute("aria-activedescendant")).toBe(false);
  });

  it("the ORIGINAL host still drives the menu after focus drifted away and back", () => {
    const a = mountEditable();
    const b = mountEditable();
    a.focus();
    const onSelect = vi.fn();
    render(<DragHandleMenu anchorRect={RECT} onSelect={onSelect} onClose={() => {}} kind="selection" />);
    b.focus();
    a.focus();
    keyOn(a, "Backspace");
    expect(onSelect).toHaveBeenLastCalledWith("delete");
  });
});

function Item({ id }: { id: string }) {
  const { getItemProps } = useMenuItem({ id, run: () => {} });
  return <button {...getItemProps()}>{id}</button>;
}

function NestedOnOneHost({ innerOpen }: { innerOpen: boolean }) {
  return (
    <MenuProvider
      id="outer"
      layout="list"
      anchorRect={RECT}
      placements={PLACEMENTS}
      onClose={() => {}}
      ariaLabel="outer"
      getActiveDescendantHost={caretEditableHost}
    >
      <Item id="o1" />
      <Item id="o2" />
      {innerOpen && (
        <MenuProvider
          id="inner"
          layout="list"
          anchorRect={RECT}
          placements={PLACEMENTS}
          onClose={() => {}}
          ariaLabel="inner"
          getActiveDescendantHost={caretEditableHost}
        >
          <Item id="i1" />
          <Item id="i2" />
        </MenuProvider>
      )}
    </MenuProvider>
  );
}

function domIdOfActive(label: string): string | null {
  const menu = document.querySelector(`[aria-label="${label}"]`);
  return (menu?.querySelector('[data-active=""]') as HTMLElement | null)?.id ?? null;
}

describe("task 995 — nested menus sharing one host", () => {
  it("closing the child re-shows the PARENT's active row instead of stripping the attribute", () => {
    const host = mountEditable();
    host.focus();
    const view = render(<NestedOnOneHost innerOpen={false} />);

    keyOn(host, "ArrowDown");
    keyOn(host, "ArrowDown");
    const parentId = domIdOfActive("outer");
    expect(parentId).toBeTruthy();
    expect(host.getAttribute("aria-activedescendant")).toBe(parentId);

    view.rerender(<NestedOnOneHost innerOpen={true} />);
    keyOn(host, "ArrowDown");
    const childId = domIdOfActive("inner");
    expect(childId).toBeTruthy();
    expect(host.getAttribute("aria-activedescendant")).toBe(childId);

    view.rerender(<NestedOnOneHost innerOpen={false} />);
    expect(host.getAttribute("aria-activedescendant")).toBe(parentId);

    view.unmount();
    expect(host.hasAttribute("aria-activedescendant")).toBe(false);
  });
});

describe("task 995 — claimActiveDescendant stack", () => {
  it("top writer shows; a lower writer's update is silent until it is top again", () => {
    const host = document.createElement("div");
    const parent = claimActiveDescendant(host);
    parent.set("p1");
    const child = claimActiveDescendant(host);
    expect(host.hasAttribute("aria-activedescendant")).toBe(false);
    child.set("c1");
    expect(host.getAttribute("aria-activedescendant")).toBe("c1");
    parent.set("p2");
    expect(host.getAttribute("aria-activedescendant")).toBe("c1");
    child.release();
    expect(host.getAttribute("aria-activedescendant")).toBe("p2");
    child.set("c2"); // a released claim writes nothing
    expect(host.getAttribute("aria-activedescendant")).toBe("p2");
    parent.release();
    expect(host.hasAttribute("aria-activedescendant")).toBe(false);
  });

  it("releasing a NON-top writer leaves the top's announcement alone", () => {
    const host = document.createElement("div");
    const a = claimActiveDescendant(host);
    a.set("a");
    const b = claimActiveDescendant(host);
    b.set("b");
    a.release();
    expect(host.getAttribute("aria-activedescendant")).toBe("b");
  });
});
