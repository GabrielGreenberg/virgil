// @vitest-environment jsdom
//
// Task 747 — rect-opened menus follow their anchor on scroll.
//
// A portaled menu is `position: fixed`; handing `<MenuProvider>` only the rect
// captured at open froze it in place while its anchor scrolled away (the text-
// color swatches left behind by the lightning menu, the heading-type menu, the
// spelling menu, the `\ref` popover). Each now supplies a LIVE anchor from
// `menu/live-anchor`, which the provider's existing RAF-coalesced re-anchor
// reads on scroll. These tests drive the real consumers: open, move the anchor,
// fire a scroll → the menu's `top` follows.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { HeadingTypeMenu } from "@/components/HeadingTypeMenu";
import { SelectionColorPopover } from "@/components/SelectionColorPopover";
import { elementAnchor, caretAnchor } from "../live-anchor";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const MENU_W = 180;
const MENU_H = 120;
const originalRect = HTMLElement.prototype.getBoundingClientRect;

function rect(top: number): DOMRect {
  return { left: 100, top, right: 140, bottom: top + 20, width: 40, height: 20, x: 100, y: top, toJSON() {} } as DOMRect;
}

/** A trigger element in the document whose rect the test moves. */
function makeAnchor(initialTop: number): { el: HTMLElement; moveTo: (top: number) => void } {
  const el = document.createElement("button");
  document.body.appendChild(el);
  let top = initialTop;
  el.getBoundingClientRect = () => rect(top);
  return { el, moveTo: (t) => (top = t) };
}

function menuTop(selector: string): number {
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) throw new Error(`no menu ${selector}`);
  return parseFloat(el.style.top);
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function scroll() {
  await act(async () => {
    window.dispatchEvent(new Event("scroll"));
    await Promise.resolve();
  });
}

beforeEach(() => {
  // Every menu container measures MENU_W×MENU_H; anchors override per-instance.
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({ width: MENU_W, height: MENU_H, left: 0, top: 0, right: MENU_W, bottom: MENU_H, x: 0, y: 0, toJSON() {} }) as DOMRect;
  (window as unknown as { innerWidth: number }).innerWidth = 1000;
  (window as unknown as { innerHeight: number }).innerHeight = 800;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  HTMLElement.prototype.getBoundingClientRect = originalRect;
  vi.unstubAllGlobals();
});

describe("task 747 — rect-opened menus follow their anchor on scroll", () => {
  it("HeadingTypeMenu re-anchors to its chip", async () => {
    const a = makeAnchor(200);
    render(
      <HeadingTypeMenu
        anchorRect={a.el.getBoundingClientRect()}
        trackAnchor={elementAnchor(a.el)}
        currentLevel={1}
        documentClass={null}
        onPick={() => {}}
        onClose={() => {}}
      />,
    );
    await flush();
    const before = menuTop('[aria-label="Heading type"]');
    a.moveTo(350);
    await scroll();
    expect(menuTop('[aria-label="Heading type"]')).toBe(before + 150);
  });

  it("SelectionColorPopover re-anchors to the color cell (read through a ref)", async () => {
    const a = makeAnchor(300);
    const ref = { current: a.el as Element | null };
    render(
      <SelectionColorPopover
        anchorRect={a.el.getBoundingClientRect()}
        trackAnchor={elementAnchor(ref)}
        palette={["#ff0000"]}
        onApply={() => {}}
        onClear={() => {}}
        onPickCustom={() => {}}
        onClose={() => {}}
      />,
    );
    await flush();
    const before = menuTop('[aria-label="Text color"]');
    a.moveTo(250);
    await scroll();
    expect(menuTop('[aria-label="Text color"]')).toBe(before - 50);
  });

  it("without a live anchor the menu stays put (the pre-747 frozen shape)", async () => {
    const a = makeAnchor(200);
    render(
      <HeadingTypeMenu
        anchorRect={a.el.getBoundingClientRect()}
        currentLevel={1}
        documentClass={null}
        onPick={() => {}}
        onClose={() => {}}
      />,
    );
    await flush();
    const before = menuTop('[aria-label="Heading type"]');
    a.moveTo(350);
    await scroll();
    expect(menuTop('[aria-label="Heading type"]')).toBe(before);
  });

  it("a detached anchor falls back to the rect captured at open", async () => {
    const a = makeAnchor(200);
    render(
      <HeadingTypeMenu
        anchorRect={rect(200)}
        trackAnchor={elementAnchor(a.el)}
        currentLevel={1}
        documentClass={null}
        onPick={() => {}}
        onClose={() => {}}
      />,
    );
    await flush();
    const before = menuTop('[aria-label="Heading type"]');
    a.moveTo(500);
    a.el.remove();
    await scroll();
    expect(menuTop('[aria-label="Heading type"]')).toBe(before);
  });
});

describe("live-anchor thunks", () => {
  it("elementAnchor accepts an element, a ref, or a getter; null once detached", () => {
    const a = makeAnchor(10);
    expect(elementAnchor(a.el)()?.top).toBe(10);
    expect(elementAnchor({ current: a.el })()?.top).toBe(10);
    expect(elementAnchor(() => a.el)()?.top).toBe(10);
    expect(elementAnchor(null)()).toBeNull();
    a.el.remove();
    expect(elementAnchor(a.el)()).toBeNull();
  });

  it("caretAnchor is null for a missing editor", () => {
    expect(caretAnchor(null, 3)()).toBeNull();
  });
});
