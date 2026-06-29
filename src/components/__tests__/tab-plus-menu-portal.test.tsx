// @vitest-environment jsdom
//
// Backlog #9 — the Virgil-bar "+" menu (TabPlusMenu) must NOT paint inside
// the bar's `sticky z-30` stacking context, or floating panels / popped
// cards (z-1200+) layer over it. The fix portals the dropdown to
// document.body at a chrome-menu-tier zIndex (2000), matching
// DragHandleMenu / ActionsMenuPanel.
//
// We pin the load-bearing behavior:
//   1. while OPEN, the dropdown is a child of document.body — NOT a
//      descendant of the component's wrapper (so it escapes the z-30 trap);
//   2. the dropdown carries zIndex 2000 (clears floating panels at 1200+);
//   3. Escape closes it (the close handlers survive the portal move).
//
// The icon barrel (panel-icons → panel-registry → tiptap/storage) and the
// IndexedDB-backed doc-index are stubbed so this stays a focused chrome
// test, not a full app boot.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

// Stub the icon barrel — its real transitive import (panel-registry →
// tiptap) is the vitest barrel gotcha and irrelevant to portal behavior.
vi.mock("../editor-layout/panel-icons", () => ({
  IconPlus: () => <span data-testid="icon-plus" />,
}));
// doc-index is IndexedDB-backed; we never exercise the recents path here.
vi.mock("@/lib/doc-index", () => ({ getDocHandle: vi.fn() }));
vi.mock("@/lib/fsa-permissions", () => ({ ensureRW: vi.fn() }));
// Surface the multi-window item deterministically off (irrelevant here).
vi.mock("@/lib/multi-window/bus", () => ({ multiWindowSupported: () => false }));

import { TabPlusMenu } from "../TabPlusMenu";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderMenu() {
  return render(
    <TabPlusMenu
      docs={[]}
      openTabIds={[]}
      currentDocId={null}
      onOpenRecent={() => {}}
      onOpenFolder={() => {}}
      onCreateNew={() => {}}
      onOpenExample={() => {}}
      onResetExample={() => {}}
      onOpenNewWindow={() => {}}
      devStorage
      exampleAvailable={false}
    />,
  );
}

describe("TabPlusMenu portal (backlog #9)", () => {
  it("renders the dropdown into document.body, not inside the bar wrapper", () => {
    const { container } = renderMenu();
    const button = container.querySelector("button")!;
    expect(button).toBeTruthy();

    // Closed: no menu anywhere.
    expect(document.querySelector('[role="menu"]')).toBeNull();

    fireEvent.click(button);

    const menu = document.querySelector('[role="menu"]') as HTMLElement;
    expect(menu).toBeTruthy();
    // The load-bearing assertion: the menu is a body portal, NOT a
    // descendant of the component's own wrapper subtree (which lives
    // inside the z-30 sticky bar in the real app).
    expect(container.contains(menu)).toBe(false);
    expect(document.body.contains(menu)).toBe(true);
  });

  it("gives the portaled dropdown a chrome-menu-tier zIndex (2000)", () => {
    const { container } = renderMenu();
    fireEvent.click(container.querySelector("button")!);
    const menu = document.querySelector('[role="menu"]') as HTMLElement;
    expect(menu.style.zIndex).toBe("2000");
    // Portaled menus are positioned fixed by useFloatingMenuPosition.
    expect(menu.style.position).toBe("fixed");
  });

  it("closes on Escape (close handlers survive the portal)", () => {
    const { container } = renderMenu();
    fireEvent.click(container.querySelector("button")!);
    expect(document.querySelector('[role="menu"]')).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});
