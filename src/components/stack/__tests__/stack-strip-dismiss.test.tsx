// @vitest-environment jsdom
/**
 * Task 862 — the Stack strip ends through the SHARED dismiss door.
 *
 * It closed only on a hand-rolled document `mousedown`: Escape did nothing,
 * and a pen/touch press (or one whose target preventDefaults its pointerdown)
 * never dismissed it. Now `useMenuDismiss` owns it — with ONE exception pinned
 * here: while a drop session (a stack pull, which starts INSIDE the strip) is
 * live, Escape belongs to the drag alone.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

const { dropSession } = vi.hoisted(() => ({
  dropSession: { current: null as object | null },
}));
vi.mock("@/components/drop-mode/controller", async (orig) => ({
  ...(await orig<typeof import("@/components/drop-mode/controller")>()),
  getDropSession: () => dropSession.current,
}));

import { StackChromeHost } from "@/components/stack/StackChromeHost";
import {
  registerStackTerminal,
  openStackStrip,
  isStackStripOpen,
  __resetStackTerminals,
  __resetStackStripOpen,
  type StackTerminal,
} from "@/lib/stack/stack-terminal";
import { __resetStackIconRect } from "@/lib/stack/stack-drop-target";

const terminal: StackTerminal = {
  getEditor: () => null,
  getSource: () => ({ docId: "d1" }),
  getBibCtx: () => ({
    getBibEntry: () => undefined,
    getAnnotation: () => undefined,
  }),
  wantsChrome: true,
};

const flushDefer = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

const press = (el: Element | Window) =>
  act(() => {
    el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  });

const escape = () =>
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });

async function mountOpen() {
  registerStackTerminal({}, terminal);
  render(<StackChromeHost />);
  act(() => openStackStrip());
  await flushDefer();
  expect(isStackStripOpen()).toBe(true);
}

beforeEach(() => {
  __resetStackTerminals();
  __resetStackStripOpen();
  __resetStackIconRect();
  localStorage.clear();
  dropSession.current = null;
});

afterEach(() => {
  cleanup();
  __resetStackTerminals();
  __resetStackStripOpen();
  __resetStackIconRect();
});

describe("Stack strip dismissal (task 862)", () => {
  it("Escape closes the strip", async () => {
    await mountOpen();
    escape();
    expect(isStackStripOpen()).toBe(false);
  });

  it("an outside POINTERDOWN closes it (not just mousedown)", async () => {
    await mountOpen();
    press(document.body);
    expect(isStackStripOpen()).toBe(false);
  });

  it("a press inside the strip keeps it open", async () => {
    await mountOpen();
    const strip = document.querySelector('[data-stack-strip="true"]')!;
    press(strip);
    expect(isStackStripOpen()).toBe(true);
  });

  it("a press + click on the icon TOGGLES it closed (no close-then-reopen)", async () => {
    await mountOpen();
    const icon = document.querySelector(
      '[data-stack-icon-hit="true"]',
    ) as HTMLButtonElement;
    press(icon);
    expect(isStackStripOpen()).toBe(true); // excluded: the press alone does nothing
    act(() => icon.click());
    expect(isStackStripOpen()).toBe(false);
  });

  it("while a drop session is live, Escape is the drag's — the strip stays open", async () => {
    await mountOpen();
    dropSession.current = {};
    escape();
    expect(isStackStripOpen()).toBe(true);
    dropSession.current = null;
    escape();
    expect(isStackStripOpen()).toBe(false);
  });
});
