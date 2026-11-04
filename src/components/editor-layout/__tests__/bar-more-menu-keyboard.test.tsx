// @vitest-environment jsdom
//
// The bar's ⋯ menu on the `<Menu>` primitive (task 1361, as the Help menu it
// grew out of, the bar's last census-declared holdout): a hand-rolled window-click closer, NO Escape (the
// Escape-means-cancel law), no menu ARIA, no roving nav — and a Commands
// sub-menu that opened on HOVER only, so a keyboard user could not reach a
// single command. Pinned here through the REAL primitive stack (AnchoredMenu +
// a nested MenuProvider + useMenuItem + the shared stack controller):
//   - the trigger opens a real `role="menu"`;
//   - ArrowDown reaches Commands, ArrowRight / Enter open its sub-menu with the
//     cursor on the first command, Enter inserts it and closes everything;
//   - Escape pops ONE level (sub-menu first, then the ⋯ menu), ArrowLeft
//     closes the sub-menu only;
//   - Helper mode is a real `menuitemcheckbox`.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act, screen } from "@testing-library/react";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);
vi.mock("@/lib/tiptap-extensions", () => ({
  VIRGIL_COMMAND_NAMES: ["virgilnote", "virgiltodo"],
}));

import { BarMoreMenu } from "../BarMoreMenu";

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

function setup(over: Partial<Parameters<typeof BarMoreMenu>[0]> = {}) {
  const onInsertVirgilCommand = vi.fn();
  const onHelperToggle = vi.fn();
  render(
    <BarMoreMenu
      appVersion="9.9.9"
      hasDoc={false}
      skillSyncNotice={null}
      onResyncSkills={() => {}}
      onDismissSkillSyncNotice={() => {}}
      helperOn={false}
      onHelperToggle={onHelperToggle}
      onInsertVirgilCommand={onInsertVirgilCommand}
      zenOn={false}
      onToggleZen={() => {}}
      onOpenStyle={() => {}}
      onOpenPrint={() => {}}
      onOpenPreferences={() => {}}
      onEnableCollab={() => {}}
      onDisableCollab={() => {}}
      toolsCollapsed={false}
      onToggleTools={() => {}}
      view="text"
      onViewChange={() => {}}
      onCompile={() => {}}
      onOpenAiRequests={() => {}}
      {...over}
    />,
  );
  const trigger = screen.getByRole("button", { name: "More" });
  act(() => {
    trigger.focus();
    trigger.click();
  });
  return { trigger, onInsertVirgilCommand, onHelperToggle };
}

const menus = () => [...document.querySelectorAll('[role="menu"]')];
const moreMenu = () => document.querySelector('[role="menu"][aria-label="More"]');
const subMenu = () => document.querySelector('[role="menu"][aria-label="Commands"]');
const commandsRow = () =>
  [...document.querySelectorAll('[role="menuitem"]')].find((el) =>
    el.textContent?.includes("Commands"),
  ) as HTMLElement;
const helperRow = () =>
  [...document.querySelectorAll('[role="menuitemcheckbox"]')].find((el) =>
    el.textContent?.includes("Helper mode"),
  ) as HTMLElement;
/** Style, Print, Zen, Timer and Collaborator mode sit above Commands. */
const toCommands = () => {
  for (let i = 0; i < 6; i++) key("ArrowDown");
};

describe("the ⋯ menu — on the menu primitive (task 1361)", () => {
  it("the trigger opens a real role=menu with menu-trigger ARIA", () => {
    const { trigger } = setup();
    expect(moreMenu()).not.toBeNull();
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(commandsRow().getAttribute("aria-haspopup")).toBe("menu");
  });

  it("ArrowDown reaches Commands; ArrowRight opens it on the first command; Enter inserts and closes", () => {
    const { onInsertVirgilCommand } = setup();
    toCommands();
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
    toCommands();
    key("Enter");
    expect(subMenu()).not.toBeNull();
    expect(moreMenu()).not.toBeNull();
  });

  it("Escape pops one level — the sub-menu first, then the ⋯ menu", () => {
    const { trigger } = setup();
    toCommands();
    key("ArrowRight");
    expect(menus()).toHaveLength(2);
    key("Escape");
    expect(subMenu()).toBeNull();
    expect(moreMenu()).not.toBeNull();
    key("Escape");
    expect(menus()).toHaveLength(0);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("ArrowLeft closes the sub-menu and hands the keyboard back to the parent", () => {
    setup();
    toCommands();
    key("ArrowRight");
    key("ArrowLeft");
    expect(subMenu()).toBeNull();
    expect(moreMenu()).not.toBeNull();
    // The parent's cursor is still on Commands, and live again.
    expect(commandsRow().hasAttribute("data-active")).toBe(true);
    key("ArrowDown");
    expect(helperRow().hasAttribute("data-active")).toBe(true);
  });

  it("Helper mode is a menuitemcheckbox carrying its state", () => {
    const { onHelperToggle } = setup({ helperOn: true });
    const helper = helperRow();
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

  const rowNames = () =>
    [...document.querySelectorAll('[role^="menuitem"]')].map((el) => el.textContent ?? "");

  it("the folded tools stand in here only while they are folded", () => {
    setup();
    expect(rowNames().some((t) => t.includes("Compile"))).toBe(false);
    cleanup();
    setup({ toolsCollapsed: true });
    const rows = rowNames();
    for (const name of ["Text", "Code", "PDF", "Compile", "AI requests"]) {
      expect(rows.some((t) => t.includes(name)), name).toBe(true);
    }
  });

  it("the toolbar row names the state it will leave", () => {
    setup();
    expect(rowNames().some((t) => t.includes("Hide toolbar"))).toBe(true);
    cleanup();
    setup({ toolsCollapsed: true });
    expect(rowNames().some((t) => t.includes("Show toolbar"))).toBe(true);
  });

  it("a folded view row runs the switch's own handler and closes the menu", () => {
    const onViewChange = vi.fn();
    setup({ toolsCollapsed: true, onViewChange });
    const code = [...document.querySelectorAll('[role^="menuitem"]')].find((el) =>
      el.textContent?.includes("Code"),
    ) as HTMLElement;
    act(() => code.click());
    expect(onViewChange).toHaveBeenCalledWith("code");
    expect(menus()).toHaveLength(0);
  });
});
