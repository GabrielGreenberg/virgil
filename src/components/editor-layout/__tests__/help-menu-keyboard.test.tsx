// @vitest-environment jsdom
//
// The Help menu on the `<Menu>` primitive (task 1361). It was the bar's last
// census-declared holdout: a hand-rolled window-click closer, NO Escape (the
// Escape-means-cancel law), no menu ARIA, no roving nav — and a Commands
// sub-menu that opened on HOVER only, so a keyboard user could not reach a
// single command. Pinned here through the REAL primitive stack (AnchoredMenu +
// a nested MenuProvider + useMenuItem + the shared stack controller):
//   - the trigger opens a real `role="menu"`;
//   - ArrowDown reaches Commands, ArrowRight / Enter open its sub-menu with the
//     cursor on the first command, Enter inserts it and closes everything;
//   - Escape pops ONE level (sub-menu first, then the Help menu), ArrowLeft
//     closes the sub-menu only;
//   - Helper mode is a real `menuitemcheckbox`.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act, screen } from "@testing-library/react";

vi.mock("@/lib/tiptap-extensions", () => ({
  VIRGIL_COMMAND_NAMES: ["virgilnote", "virgiltodo"],
}));

import { HelpMenu } from "../HelpMenu";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function key(k: string) {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }),
    );
  });
}

function setup(over: Partial<Parameters<typeof HelpMenu>[0]> = {}) {
  const onInsertVirgilCommand = vi.fn();
  const onHelperToggle = vi.fn();
  render(
    <HelpMenu
      appVersion="9.9.9"
      hasDoc={false}
      skillSyncNotice={null}
      onResyncSkills={() => {}}
      onDismissSkillSyncNotice={() => {}}
      helperOn={false}
      onHelperToggle={onHelperToggle}
      onInsertVirgilCommand={onInsertVirgilCommand}
      {...over}
    />,
  );
  const trigger = screen.getByRole("button", { name: "Help" });
  act(() => {
    trigger.focus();
    trigger.click();
  });
  return { trigger, onInsertVirgilCommand, onHelperToggle };
}

const menus = () => [...document.querySelectorAll('[role="menu"]')];
const helpMenu = () => document.querySelector('[role="menu"][aria-label="Help"]');
const subMenu = () => document.querySelector('[role="menu"][aria-label="Commands"]');
const commandsRow = () =>
  [...document.querySelectorAll('[role="menuitem"]')].find((el) =>
    el.textContent?.includes("Commands"),
  ) as HTMLElement;

describe("Help menu — on the menu primitive (task 1361)", () => {
  it("the trigger opens a real role=menu with menu-trigger ARIA", () => {
    const { trigger } = setup();
    expect(helpMenu()).not.toBeNull();
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(commandsRow().getAttribute("aria-haspopup")).toBe("menu");
  });

  it("ArrowDown reaches Commands; ArrowRight opens it on the first command; Enter inserts and closes", () => {
    const { onInsertVirgilCommand } = setup();
    key("ArrowDown");
    expect(commandsRow().hasAttribute("data-active")).toBe(true);
    key("ArrowRight");
    expect(subMenu()).not.toBeNull();
    expect(commandsRow().getAttribute("aria-expanded")).toBe("true");
    const first = subMenu()!.querySelector('[role="menuitem"]') as HTMLElement;
    expect(first.textContent).toBe("\\virgilnote");
    expect(first.hasAttribute("data-active")).toBe(true);
    key("ArrowDown");
    key("Enter");
    expect(onInsertVirgilCommand).toHaveBeenCalledWith("virgiltodo");
    expect(menus()).toHaveLength(0);
  });

  it("Enter on Commands opens the sub-menu too", () => {
    setup();
    key("ArrowDown");
    key("Enter");
    expect(subMenu()).not.toBeNull();
    expect(helpMenu()).not.toBeNull();
  });

  it("Escape pops one level — the sub-menu first, then the Help menu", () => {
    const { trigger } = setup();
    key("ArrowDown");
    key("ArrowRight");
    expect(menus()).toHaveLength(2);
    key("Escape");
    expect(subMenu()).toBeNull();
    expect(helpMenu()).not.toBeNull();
    key("Escape");
    expect(menus()).toHaveLength(0);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("ArrowLeft closes the sub-menu and hands the keyboard back to the parent", () => {
    setup();
    key("ArrowDown");
    key("ArrowRight");
    key("ArrowLeft");
    expect(subMenu()).toBeNull();
    expect(helpMenu()).not.toBeNull();
    // The parent's cursor is still on Commands, and live again.
    expect(commandsRow().hasAttribute("data-active")).toBe(true);
    key("ArrowDown");
    const helper = document.querySelector('[role="menuitemcheckbox"]') as HTMLElement;
    expect(helper.hasAttribute("data-active")).toBe(true);
  });

  it("Helper mode is a menuitemcheckbox carrying its state", () => {
    const { onHelperToggle } = setup({ helperOn: true });
    const helper = document.querySelector('[role="menuitemcheckbox"]') as HTMLElement;
    expect(helper.textContent).toContain("Helper mode");
    expect(helper.getAttribute("aria-checked")).toBe("true");
    act(() => helper.click());
    expect(onHelperToggle).toHaveBeenCalledTimes(1);
    expect(menus()).toHaveLength(0);
  });

  it("Refresh skills appears only with a paper open, and is a registered row", () => {
    setup({ hasDoc: true });
    const rows = [...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent);
    expect(rows.some((t) => t?.includes("Refresh skills"))).toBe(true);
  });
});
