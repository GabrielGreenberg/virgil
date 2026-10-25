// @vitest-environment jsdom
//
// Task 1280: the "+" menu's Recents remove affordance. Two halves:
//   - KEYBOARD: Delete/Backspace on the ACTIVE recent row forgets it through
//     the menu primitive's remove verb (useMenuItem({ remove })) — the menu
//     stays open and the highlight steps to a neighbour; a row with no verb
//     (an action row) lets the key fall through untouched.
//   - PAINT/SLOT: the X carries no background of its own (the old
//     bg-[var(--background)] beige patch over the white menu), and the
//     relative-time cell yields to it (invisible) while the row is active.
// Harness shared with tab-plus-menu-keyboard.test.tsx.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";

// Stub the icon barrel — its real transitive import (panel-registry →
// tiptap) is the vitest barrel gotcha and irrelevant to menu behavior.
vi.mock("../editor-layout/panel-icons", () => ({
  IconPlus: () => <span data-testid="icon-plus" />,
}));
// doc-index is IndexedDB-backed; in devStorage mode the recents path skips it.
vi.mock("@/lib/doc-index", () => ({ getDocHandle: vi.fn() }));
vi.mock("@/lib/fsa-permissions", () => ({ ensureRW: vi.fn() }));
// Surface the multi-window item deterministically off (so the menu shape is
// just recents + Open folder + Create new in these tests).
vi.mock("@/lib/multi-window/bus", () => ({ multiWindowSupported: () => false }));

import { TabPlusMenu } from "../TabPlusMenu";

// jsdom has no ResizeObserver; useFloatingMenuPosition measures with one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

const DOCS = [
  {
    id: "doc-a",
    name: "Alpha paper",
    folderName: "Alpha paper",
    lastAccessedAt: new Date(Date.now() - 1000).toISOString(),
  },
  {
    id: "doc-b",
    name: "Beta paper",
    folderName: "Beta paper",
    lastAccessedAt: new Date(Date.now() - 2000).toISOString(),
  },
] as Parameters<typeof TabPlusMenu>[0]["docs"];

function renderMenu(
  overrides: Partial<Parameters<typeof TabPlusMenu>[0]> = {},
) {
  const handlers = {
    onOpenRecent: vi.fn(),
    onOpenFolder: vi.fn(),
    onCreateNew: vi.fn(),
    onOpenExample: vi.fn(),
    onResetExample: vi.fn(),
    onOpenNewWindow: vi.fn(),
    onRemoveRecent: vi.fn(),
  };
  const utils = render(
    <TabPlusMenu
      docs={DOCS}
      openTabIds={[]}
      currentDocId={null}
      onOpenRecent={handlers.onOpenRecent}
      onOpenFolder={handlers.onOpenFolder}
      onCreateNew={handlers.onCreateNew}
      onOpenExample={handlers.onOpenExample}
      onResetExample={handlers.onResetExample}
      onOpenNewWindow={handlers.onOpenNewWindow}
      onRemoveRecent={handlers.onRemoveRecent}
      devStorage={false}
      exampleAvailable={false}
      {...overrides}
    />,
  );
  return { ...utils, ...handlers };
}

function openMenu(container: HTMLElement) {
  fireEvent.click(container.querySelector("button")!);
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
  return b?.textContent?.trim() ?? "";
}

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

function keyEvent(k: string): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
  act(() => {
    window.dispatchEvent(ev);
  });
  return ev;
}

describe("TabPlusMenu — Delete forgets the active recent row", () => {
  it("ArrowDown onto a recent, Delete → onRemoveRecent(id); menu stays open, highlight steps on", () => {
    const { container, onRemoveRecent, onOpenRecent } = renderMenu();
    openMenu(container);
    key("ArrowDown");
    expect(labelOf(activeButton())).toContain("Alpha paper");
    const ev = keyEvent("Delete");
    expect(ev.defaultPrevented).toBe(true);
    expect(onRemoveRecent).toHaveBeenCalledWith("doc-a");
    expect(onOpenRecent).not.toHaveBeenCalled();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(labelOf(activeButton())).toContain("Beta paper");
  });

  it("Backspace is the same verb", () => {
    const { container, onRemoveRecent } = renderMenu();
    openMenu(container);
    key("ArrowDown");
    key("ArrowDown");
    keyEvent("Backspace");
    expect(onRemoveRecent).toHaveBeenCalledWith("doc-b");
  });

  it("a row with no remove verb (Open folder…) lets Delete fall through", () => {
    const { container, onRemoveRecent } = renderMenu();
    openMenu(container);
    key("ArrowDown");
    key("ArrowDown");
    key("ArrowDown");
    expect(labelOf(activeButton())).toMatch(/^Open folder/);
    const ev = keyEvent("Delete");
    expect(onRemoveRecent).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it("without onRemoveRecent, Delete on a recent row does nothing", () => {
    const { container } = renderMenu({ onRemoveRecent: undefined });
    openMenu(container);
    key("ArrowDown");
    const ev = keyEvent("Delete");
    expect(ev.defaultPrevented).toBe(false);
    expect(document.querySelector('[data-testid="recent-paper-remove"]')).toBeNull();
  });
});

describe("TabPlusMenu — the X shares the row's paint and slot", () => {
  it("the X has no background of its own", () => {
    const { container } = renderMenu();
    openMenu(container);
    const xs = Array.from(document.querySelectorAll('[data-testid="recent-paper-remove"]'));
    expect(xs.length).toBe(2);
    for (const x of xs) {
      expect(x.className).not.toMatch(/bg-/);
      expect((x as HTMLElement).style.background).toBe("");
      expect((x as HTMLElement).style.backgroundColor).toBe("");
    }
  });

  it("the active row reveals its X and the time cell yields (invisible, width kept)", () => {
    const { container } = renderMenu();
    openMenu(container);
    key("ArrowDown");
    const xs = Array.from(document.querySelectorAll('[data-testid="recent-paper-remove"]'));
    const times = Array.from(document.querySelectorAll('[data-testid="recent-paper-time"]'));
    expect(xs[0].className).toMatch(/\bopacity-100\b/);
    expect(times[0].className).toMatch(/(^|\s)invisible(\s|$)/);
    // The inactive row still hides its X until hover/focus.
    expect(xs[1].className.split(/\s+/)).not.toContain("opacity-100");
    expect(times[1].className).toMatch(/group-hover:invisible/);
  });
});
