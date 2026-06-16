// @vitest-environment jsdom
//
// R6 — nested-provider key ownership (design §6 R6, §3.1). The load-bearing
// case the Phase C fan-out surfaced: a `<MenuProvider>` nested inside another's
// React tree (e.g. the lightning grid spawning the color popover / a
// BlockTypeDropdown) must become the TOP of the stack — ONLY the innermost open
// window-source provider's window-capture keydown is live, so an arrow moves
// the INNER menu's cursor and NOT the outer's (no double-move). Closing the
// inner restores the outer as top. Escape pops one level (innermost first).
//
// Drives the REAL primitive stack (MenuProvider + useMenuItem + useMenuKeyboard
// + the shared MenuStackController), not a hand-built harness, so the
// depth/topDepth computation is exercised end-to-end.

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  cleanup,
  act,
  type RenderResult,
} from "@testing-library/react";
import { MenuProvider } from "../MenuProvider";
import { useMenuItem } from "../useMenuItem";

// jsdom has no ResizeObserver; useFloatingMenuPosition measures with one.
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
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

function key(k: string, opts: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: k,
        bubbles: true,
        cancelable: true,
        ...opts,
      }),
    );
  });
}

/** A bare menu item that registers into the surrounding provider. */
function Item({ id }: { id: string }) {
  const { getItemProps } = useMenuItem({ id, run: () => {} });
  return (
    <button {...getItemProps()} data-test-id={id}>
      {id}
    </button>
  );
}

/** The active (data-active) item inside a given menu container. */
function activeId(menu: HTMLElement | null): string | null {
  const el = menu?.querySelector('[data-active=""]') as HTMLElement | null;
  return el?.getAttribute("data-test-id") ?? null;
}

/**
 * An OUTER window-source menu that optionally renders an INNER window-source
 * menu nested INSIDE its React tree (mirroring the lightning grid spawning a
 * sub-popover — the child provider flows context even through the portal).
 */
function NestedMenus({
  innerOpen,
  onOuterClose = () => {},
  onInnerClose = () => {},
}: {
  innerOpen: boolean;
  onOuterClose?: () => void;
  onInnerClose?: () => void;
}) {
  return (
    <MenuProvider
      id="outer"
      layout="list"
      anchorRect={RECT}
      placements={PLACEMENTS}
      onClose={onOuterClose}
      ariaLabel="outer"
    >
      <Item id="o1" />
      <Item id="o2" />
      <Item id="o3" />
      {innerOpen && (
        <MenuProvider
          id="inner"
          layout="list"
          anchorRect={RECT}
          placements={PLACEMENTS}
          onClose={onInnerClose}
          ariaLabel="inner"
        >
          <Item id="i1" />
          <Item id="i2" />
          <Item id="i3" />
        </MenuProvider>
      )}
    </MenuProvider>
  );
}

const outerMenu = () =>
  document.querySelector('[aria-label="outer"]') as HTMLElement | null;
const innerMenu = () =>
  document.querySelector('[aria-label="inner"]') as HTMLElement | null;

describe("R6 — nested window-source providers: key ownership", () => {
  it("a lone window-source menu IS the top (arrows drive it)", () => {
    render(<NestedMenus innerOpen={false} />);
    key("ArrowDown");
    // Single-level baseline: the only menu consumes the arrow.
    expect(activeId(outerMenu())).toBe("o1");
  });

  it("with an inner menu open, ArrowDown drives ONLY the inner — the outer does NOT move (no double-move)", () => {
    render(<NestedMenus innerOpen={true} />);
    key("ArrowDown");
    // The INNER (deepest) provider consumed the arrow.
    expect(activeId(innerMenu())).toBe("i1");
    // The OUTER provider's controller did NOT fire — its cursor is untouched.
    expect(activeId(outerMenu())).toBe(null);

    key("ArrowDown");
    expect(activeId(innerMenu())).toBe("i2");
    // Still no leak to the outer.
    expect(activeId(outerMenu())).toBe(null);
  });

  it("closing the inner menu restores the outer as top (arrows drive the outer again)", () => {
    let result: RenderResult;
    act(() => {
      result = render(<NestedMenus innerOpen={true} />);
    });
    // Inner is top: it consumes the arrow.
    key("ArrowDown");
    expect(activeId(innerMenu())).toBe("i1");
    expect(activeId(outerMenu())).toBe(null);

    // Close the inner menu (unmount the nested provider).
    act(() => {
      result.rerender(<NestedMenus innerOpen={false} />);
    });
    expect(innerMenu()).toBe(null);

    // The outer provider is top again — the arrow now drives IT.
    key("ArrowDown");
    expect(activeId(outerMenu())).toBe("o1");
  });

  it("Escape pops one level — the innermost provider closes first, the outer stays open", () => {
    const onOuterClose = vi.fn();
    const onInnerClose = vi.fn();
    render(
      <NestedMenus
        innerOpen={true}
        onOuterClose={onOuterClose}
        onInnerClose={onInnerClose}
      />,
    );
    key("Escape");
    // Only the innermost provider owns Escape → only it closes.
    expect(onInnerClose).toHaveBeenCalledTimes(1);
    expect(onOuterClose).not.toHaveBeenCalled();
  });

  it("once the inner closes, the outer owns Escape (single-level restored)", () => {
    const onOuterClose = vi.fn();
    let result: RenderResult;
    act(() => {
      result = render(
        <NestedMenus innerOpen={true} onOuterClose={onOuterClose} />,
      );
    });
    // Pop the inner provider.
    act(() => {
      result.rerender(<NestedMenus innerOpen={false} onOuterClose={onOuterClose} />);
    });
    key("Escape");
    expect(onOuterClose).toHaveBeenCalledTimes(1);
  });
});
