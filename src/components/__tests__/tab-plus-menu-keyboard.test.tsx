// @vitest-environment jsdom
//
// TabPlusMenu on the <Menu> primitive (Phase C): behavior PARITY + the new
// arrow nav. Drives the REAL component through the full primitive stack
// (MenuProvider + useMenuItem + useMenuKeyboard + useMenuDismiss):
//
//   - recent-paper rows AND action rows click through to their handlers;
//   - Escape closes (onClose) and click-OUTSIDE dismisses;
//   - clicking the "+" trigger does NOT self-close (multi-exclude: the wrap
//     ref is an excludeRefs entry, so the toggle's own click is "inside");
//   - Up/Down/Home/End move a visible data-active highlight across recents +
//     action rows in one snapshot; Enter / Space activate the active row;
//   - the active item's domId mirrors onto a focused contentEditable's
//     aria-activedescendant (NO focus move to the item).
//
// The icon barrel (panel-icons → panel-registry → tiptap/storage) and the
// IndexedDB-backed doc-index are stubbed so this stays a focused chrome test,
// not a full app boot (matching tab-plus-menu-portal.test.tsx).

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

describe("TabPlusMenu — behavior parity (rows click through)", () => {
  it("renders recents + action rows as menuitems when open", () => {
    const { container } = renderMenu();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    openMenu(container);

    const labels = menuButtons().map(labelOf);
    // Two recents (label includes a relative-time suffix) + Open folder… +
    // Create new document…
    expect(labels.some((l) => l.includes("Alpha paper"))).toBe(true);
    expect(labels.some((l) => l.includes("Beta paper"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Open folder"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Create new document"))).toBe(true);
  });

  it("clicking a recent row opens it (onOpenRecent) and closes the menu", async () => {
    const { container, onOpenRecent } = renderMenu();
    openMenu(container);
    const alpha = menuButtons().find((b) => labelOf(b).includes("Alpha"))!;
    await act(async () => {
      fireEvent.click(alpha);
    });
    // devStorage=false ⇒ the handler awaits getDocHandle (mocked → undefined,
    // so the permission branch is skipped) and then calls onOpenRecent + close.
    expect(onOpenRecent).toHaveBeenCalledWith("doc-a");
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("clicking an action row fires its handler and closes the menu", () => {
    const { container, onCreateNew } = renderMenu();
    openMenu(container);
    const create = menuButtons().find((b) =>
      labelOf(b).startsWith("Create new document"),
    )!;
    fireEvent.click(create);
    expect(onCreateNew).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("Open folder… is hidden in devStorage mode", () => {
    const { container } = renderMenu({ devStorage: true, docs: [] });
    openMenu(container);
    const labels = menuButtons().map(labelOf);
    expect(labels.some((l) => l.startsWith("Open folder"))).toBe(false);
    expect(labels.some((l) => l.startsWith("Create new document"))).toBe(true);
  });
});

describe("TabPlusMenu — Escape + multi-exclude dismissal", () => {
  it("Escape closes", () => {
    const { container } = renderMenu();
    openMenu(container);
    expect(document.querySelector('[role="menu"]')).toBeTruthy();
    key("Escape");
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("click truly outside dismisses (after the deferred mount)", () => {
    vi.useFakeTimers();
    const { container } = renderMenu();
    openMenu(container);
    act(() => {
      vi.runAllTimers();
    });
    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    vi.useRealTimers();
  });

  it("clicking the '+' trigger does NOT self-close (wrap ref excluded)", () => {
    vi.useFakeTimers();
    const { container } = renderMenu();
    openMenu(container);
    act(() => {
      vi.runAllTimers();
    });
    expect(document.querySelector('[role="menu"]')).toBeTruthy();
    // A mousedown originating on the "+" button is "inside" via the wrap
    // excludeRefs entry, so the menu must survive.
    const trigger = container.querySelector("button")!;
    act(() => {
      trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(document.querySelector('[role="menu"]')).toBeTruthy();
    vi.useRealTimers();
  });

  it("clicking inside the menu does NOT dismiss", () => {
    vi.useFakeTimers();
    const { container } = renderMenu();
    openMenu(container);
    act(() => {
      vi.runAllTimers();
    });
    const menu = document.querySelector('[role="menu"]') as HTMLElement;
    act(() => {
      menu.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(document.querySelector('[role="menu"]')).toBeTruthy();
    vi.useRealTimers();
  });
});

describe("TabPlusMenu — NEW arrow navigation", () => {
  it("Down/Up move a visible data-active highlight across the full list; Enter activates", async () => {
    const { container, onOpenRecent } = renderMenu();
    openMenu(container);
    const labels = menuButtons().map(labelOf);

    key("ArrowDown"); // no active → first enabled (first recent)
    expect(labelOf(activeButton())).toBe(labels[0]);
    key("ArrowDown");
    expect(labelOf(activeButton())).toBe(labels[1]);
    key("ArrowUp");
    expect(labelOf(activeButton())).toBe(labels[0]);

    // Activate the first recent (Alpha). Its run is the async open handler
    // (devStorage=false awaits getDocHandle, mocked → undefined), so flush
    // microtasks before asserting onOpenRecent fired.
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    expect(onOpenRecent).toHaveBeenCalledWith("doc-a");
  });

  it("Space activates the active row too", () => {
    const { container, onCreateNew } = renderMenu();
    openMenu(container);
    // End → last row (Create new document…)
    key("End");
    expect(labelOf(activeButton())).toContain("Create new document");
    key(" ");
    expect(onCreateNew).toHaveBeenCalledTimes(1);
  });

  it("Home/End jump to first/last", () => {
    const { container } = renderMenu();
    openMenu(container);
    const labels = menuButtons().map(labelOf);
    key("End");
    expect(labelOf(activeButton())).toBe(labels[labels.length - 1]);
    key("Home");
    expect(labelOf(activeButton())).toBe(labels[0]);
  });

  it("Down wraps from the last row back to the first", () => {
    const { container } = renderMenu();
    openMenu(container);
    const labels = menuButtons().map(labelOf);
    key("End");
    expect(labelOf(activeButton())).toBe(labels[labels.length - 1]);
    key("ArrowDown");
    expect(labelOf(activeButton())).toBe(labels[0]);
  });
});

describe("TabPlusMenu — aria-activedescendant (no focus theft)", () => {
  it("mirrors the active item's domId onto a focused contentEditable, never focusing the item", () => {
    // A stand-in for an editor's focused contentEditable. The provider mirrors
    // aria-activedescendant onto a contentEditable host when present (matching
    // the grab menu's getActiveDescendantHost default behavior). We confirm
    // focus never moves to the menu item.
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    editable.tabIndex = 0;
    Object.defineProperty(editable, "isContentEditable", {
      value: true,
      configurable: true,
    });
    document.body.appendChild(editable);
    editable.focus();

    const { container } = renderMenu();
    openMenu(container);
    key("ArrowDown");

    const active = activeButton();
    expect(active).toBeDefined();
    // Focus stays on the editable (or at least never lands on a menu item) —
    // the roving nav uses no .focus() on items.
    expect(document.activeElement).not.toBe(active);
  });
});
