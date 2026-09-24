// @vitest-environment jsdom
//
// Task 745 — nav order is VISUAL order, and a live nav-field flip is an update,
// not an unmount. Drives the REAL hook path (MenuProvider + useMenuItem), which
// the old registry-level "unregister→register churn" test skipped: the hook's
// cleanup used to unregister on every `disabled` flip, which (a) re-stamped the
// row to the END of nav order, (b) deleted its ref for good (`setRef` has
// stable identity, React never re-attaches it) and (c) dropped the highlight.

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { MenuProvider } from "../MenuProvider";
import { useMenuContext } from "../context";
import { useMenuItem } from "../useMenuItem";
import type { MenuRegistry } from "../registry";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const RECT = { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 };
const PLACEMENTS = [{ side: "below" as const, align: "start" as const }];

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function key(k: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  });
}

let registry: MenuRegistry | null = null;
function Grab() {
  registry = useMenuContext().registry as MenuRegistry;
  return null;
}

function Item({ id, disabled = false }: { id: string; disabled?: boolean }) {
  const { getItemProps } = useMenuItem({ id, disabled, run: () => {} });
  return (
    <button {...getItemProps()} data-test-id={id}>
      {id}
    </button>
  );
}

function Menu({ bDisabled = false, showMid = false }: { bDisabled?: boolean; showMid?: boolean }) {
  return (
    <MenuProvider id="flip" layout="list" anchorRect={RECT} placements={PLACEMENTS} onClose={() => {}}>
      <Grab />
      <Item id="a" />
      {showMid && <Item id="mid" />}
      <Item id="b" disabled={bDisabled} />
      <Item id="c" />
    </MenuProvider>
  );
}

const ids = () => registry!.items().map((n) => n.id);
const active = () =>
  (document.querySelector('[data-active=""]') as HTMLElement | null)?.getAttribute("data-test-id") ?? null;

describe("menu nav order = visual order (task 745)", () => {
  it("a row that mounts while open sorts where it is DRAWN, not at the end", () => {
    const { rerender } = render(<Menu />);
    expect(ids()).toEqual(["a", "b", "c"]);
    rerender(<Menu showMid />);
    expect(ids()).toEqual(["a", "mid", "b", "c"]);
    key("ArrowDown"); // → a
    key("ArrowDown"); // → mid (not b)
    expect(active()).toBe("mid");
  });

  it("a live disabled-flip keeps position, ref and highlight (hook path, not a bare register)", () => {
    const { rerender } = render(<Menu bDisabled />);
    expect(ids()).toEqual(["a", "b", "c"]);
    rerender(<Menu />); // b: disabled → enabled while open
    expect(ids()).toEqual(["a", "b", "c"]);
    const bEl = document.querySelector('[data-test-id="b"]');
    expect(registry!.refFor("b")).toBe(bEl);
    key("ArrowDown");
    key("ArrowDown");
    expect(active()).toBe("b");
    // A non-inert re-render keeps the highlight; the row's ref survives.
    rerender(<Menu />);
    expect(active()).toBe("b");
    // Disabling the active row drops the highlight (inert rows can't be active).
    rerender(<Menu bDisabled />);
    expect(active()).toBeNull();
    expect(registry!.refFor("b")).toBe(bEl);
    expect(ids()).toEqual(["a", "b", "c"]);
  });
});
