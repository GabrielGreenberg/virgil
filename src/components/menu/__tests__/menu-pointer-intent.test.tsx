// @vitest-environment jsdom
//
// Task 996 — a hover is evidence of POINTER MOTION only when the pointer moved.
//
// Arrow-keying a height-clamped menu scrolls the list; the browser re-hit-tests
// the STATIONARY cursor and fires `mouseenter` on the row that slid under it.
// Before this task that `mouseenter` called `setActive`, handing the highlight
// back to the pointer (arrows looked stuck; Enter ran the hovered row). The
// registry's ONE pointer door (`pointerAt`) now accepts a hover after keyboard
// nav only once the client coordinates have changed, and a pointer-set active
// row owes no scroll-into-view (it is under the cursor already).

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, render, act, cleanup, fireEvent } from "@testing-library/react";
import { MenuRegistry } from "../registry";
import { useMenuKeyboard } from "../useMenuKeyboard";
import { MenuProvider } from "../MenuProvider";
import { useMenuItem } from "../useMenuItem";
import { useMenuContext } from "../context";
import { __resetRepeatSwallowForTests } from "@/lib/key-intent";

const RECT = { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 };
const PLACEMENTS = [{ side: "below" as const, align: "start" as const }];

afterEach(() => {
  cleanup();
  __resetRepeatSwallowForTests();
});

function makeRegistry() {
  const r = new MenuRegistry("m", "list");
  for (const id of ["a", "b", "c", "d"]) {
    r.register({ id, region: "list", disabled: false, run: () => {} });
  }
  return r;
}

describe("MenuRegistry.pointerAt — the pointer door", () => {
  it("a hover with no keyboard nav sets active (hover-on-open preserved)", () => {
    const r = makeRegistry();
    r.pointerAt("b", 10, 20);
    expect(r.activeId()).toBe("b");
    expect(r.activeSetByPointer()).toBe(true);
  });

  it("after keyboard nav, a mouseenter at the SAME coordinates does not take the highlight", () => {
    const r = makeRegistry();
    r.pointerAt("a", 10, 20); // pointer resting over row a
    r.move("down");
    r.move("down");
    expect(r.activeId()).toBe("c");
    // The list scrolled under the still cursor → row b now under it.
    r.pointerAt("b", 10, 20);
    expect(r.activeId()).toBe("c");
    expect(r.activeSetByPointer()).toBe(false);
  });

  it("after keyboard nav, a move with CHANGED coordinates takes the highlight and ends keyboard mode", () => {
    const r = makeRegistry();
    r.pointerAt("a", 10, 20);
    r.move("down");
    r.pointerAt("a", 11, 20);
    expect(r.activeId()).toBe("a");
    expect(r.activeSetByPointer()).toBe(true);
    // Keyboard mode over: a further hover is ordinary.
    r.pointerAt("d", 11, 60);
    expect(r.activeId()).toBe("d");
  });

  it("a container move (null id) records the position without changing active", () => {
    const r = makeRegistry();
    r.move("down"); // keyboard mode; pointer never seen
    const before = r.activeId();
    // Pointer resting on the menu's padding — recorded, and it ENDS keyboard
    // mode only if it had moved from a known position (it had none).
    r.pointerAt(null, 5, 5);
    expect(r.activeId()).toBe(before);
    // List scrolls; a row slides under the same point → still not hover.
    r.pointerAt("c", 5, 5);
    expect(r.activeId()).toBe(before);
    // A real move onto a row → hover.
    r.pointerAt("c", 6, 9);
    expect(r.activeId()).toBe("c");
  });

  it("a pointer never seen before cannot take the highlight from keyboard nav", () => {
    const r = makeRegistry();
    r.move("down");
    const before = r.activeId();
    r.pointerAt("d", 40, 40);
    expect(r.activeId()).toBe(before);
  });

  it("ignores disabled rows exactly as setActive does", () => {
    const r = new MenuRegistry("m", "list");
    r.register({ id: "a", region: "list", disabled: false, run: () => {} });
    r.register({ id: "x", region: "list", disabled: true, run: () => {} });
    r.pointerAt("a", 1, 1);
    r.pointerAt("x", 1, 9);
    expect(r.activeId()).toBe("a");
  });
});

describe("useMenuKeyboard — scroll-into-view only for keyboard/programmatic active", () => {
  it("scrolls a keyboard-set row into view, never a pointer-set one", () => {
    const r = makeRegistry();
    const els: Record<string, { scrollIntoView: ReturnType<typeof vi.fn> }> = {};
    for (const id of ["a", "b", "c", "d"]) {
      const el = document.createElement("div");
      const spy = vi.fn();
      el.scrollIntoView = spy;
      document.body.appendChild(el);
      r.setRef(id, el);
      els[id] = { scrollIntoView: spy };
    }
    renderHook(() => useMenuKeyboard({ registry: r, layout: "list", open: true }));
    act(() => r.pointerAt("b", 3, 3));
    expect(els.b.scrollIntoView).not.toHaveBeenCalled();
    act(() => r.move("down"));
    expect(els.c.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    // Programmatic seed (a combobox re-filter) still scrolls.
    act(() => r.setActive("a"));
    expect(els.a.scrollIntoView).toHaveBeenCalled();
  });
});

describe("useMenuItem + MenuProvider — the DOM halves feed the door", () => {
  function Row({ id }: { id: string }) {
    const { getItemProps } = useMenuItem({ id, run: () => {} });
    return <div {...getItemProps()} data-testid={id} />;
  }
  let reg: MenuRegistry | null = null;
  function Spy() {
    reg = useMenuContext().registry;
    return null;
  }

  it("a stationary mouseenter after arrowing keeps the keyboard row; a mousemove that moved reclaims", () => {
    const { getByTestId } = render(
      <MenuProvider id="pi" layout="list" anchorRect={RECT} placements={PLACEMENTS} onClose={() => {}}>
        <Spy />
        <Row id="a" />
        <Row id="b" />
        <Row id="c" />
      </MenuProvider>,
    );
    const r = reg!;
    fireEvent.mouseMove(getByTestId("a"), { clientX: 10, clientY: 10 });
    expect(r.activeId()).toBe("a");
    act(() => r.move("down"));
    act(() => r.move("down"));
    expect(r.activeId()).toBe("c");
    fireEvent.mouseOver(getByTestId("b"), { clientX: 10, clientY: 10 });
    expect(r.activeId()).toBe("c");
    fireEvent.mouseMove(getByTestId("b"), { clientX: 10, clientY: 12 });
    expect(r.activeId()).toBe("b");
  });
});
