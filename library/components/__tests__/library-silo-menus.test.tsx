// @vitest-environment jsdom
//
// The Library silo's menus on the ONE menu door (task 1011).
//
// Until task 1011 the silo's four menus — the catalog/pod row kebab
// (`RowMenu`), the paper header's AI-request menu (`PaperAiRequestsMenu`) and
// the tab strip's ⋮ / "+" popups — each re-implemented dismissal with a
// deferred `window` mousedown, and each dropped a different subset of what the
// `src/` menus get from `AnchoredMenu` / `MenuProvider`: the AI menu never
// flipped (it ran off a short window), the kebab flipped off an item-count
// ESTIMATE, the tab-strip popups had no arrow-key nav, and the trigger's own
// press closed them so the click re-opened them. This file pins the behaviour
// they share now, per menu: ↑/↓ roves, Escape closes AND hands focus back to
// the trigger (the one thing the AI menu had that the primitive lacked — it
// moved INTO `MenuProvider` as `returnFocusOnCancel`), click-away closes, the
// trigger is a real toggle, and placement flips on the MEASURED menu.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import RowMenu from "../RowMenu";
import PaperAiRequestsMenu, { type AiRequestItem } from "../PaperAiRequestsMenu";
import { PanelTabStrip, type TabDef } from "../panel-tabs/PanelTabStrip";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

type Box = { left: number; top: number; width: number; height: number };
const rect = ({ left, top, width, height }: Box): DOMRect =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;

let triggerBox: Box;
const menuSize = { width: 180, height: 160 };

beforeEach(() => {
  triggerBox = { left: 300, top: 200, width: 24, height: 24 };
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 700 });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.hasAttribute("aria-haspopup")) return rect(triggerBox);
    if (this.getAttribute("role") === "menu") return rect({ left: 0, top: 0, ...menuSize });
    return rect({ left: 0, top: 0, width: 0, height: 0 });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

const menuEl = () => document.body.querySelector('[role="menu"]') as HTMLElement | null;

/** The positioner measures on a microtask; the dismiss controller arms its
 *  outside-press listener a `setTimeout(0)` after open. */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** The shared keyboard contract every migrated menu now honours. */
async function expectKeyboardContract(trigger: HTMLButtonElement) {
  fireEvent.click(trigger);
  await settle();
  expect(menuEl(), "opens on click").not.toBeNull();
  expect(trigger.getAttribute("aria-expanded")).toBe("true");

  // ↓ roves: the highlighted row is announced on the trigger, which keeps focus.
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const first = trigger.getAttribute("aria-activedescendant");
  expect(first, "↓ highlights a row").toBeTruthy();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const second = trigger.getAttribute("aria-activedescendant");
  expect(second).toBeTruthy();
  expect(second).not.toBe(first);

  // A row a mouse user clicked takes DOM focus as a <button>; Escape must hand
  // it back to the trigger rather than drop it on <body> when the menu unmounts.
  const row = menuEl()!.querySelector("button:not([disabled])") as HTMLButtonElement;
  row.focus();
  expect(document.activeElement).toBe(row);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(menuEl(), "Escape closes").toBeNull();
  expect(document.activeElement, "Escape returns focus to the trigger").toBe(trigger);

  // Click-away dismisses.
  fireEvent.click(trigger);
  await settle();
  expect(menuEl()).not.toBeNull();
  fireEvent.pointerDown(document.body);
  expect(menuEl(), "click-away closes").toBeNull();

  // The trigger is a real toggle: its own press is not an outside press.
  fireEvent.click(trigger);
  await settle();
  fireEvent.pointerDown(trigger);
  fireEvent.mouseDown(trigger);
  fireEvent.click(trigger);
  expect(menuEl(), "trigger press + click closes, not close-then-reopen").toBeNull();
}

describe("RowMenu (task 1011)", () => {
  const items = [
    { key: "a", label: "Action A", onSelect: vi.fn() },
    { key: "div", divider: true as const },
    { key: "del", label: "Delete", onSelect: vi.fn(), destructive: true },
  ];

  it("honours the shared keyboard / dismissal contract", async () => {
    const { getByLabelText } = render(<RowMenu items={items} ariaLabel="Row actions" />);
    await expectKeyboardContract(getByLabelText("Row actions") as HTMLButtonElement);
  });

  it("Enter on a roved row runs it and closes the menu", async () => {
    const onSelect = vi.fn();
    const { getByLabelText } = render(
      <RowMenu items={[{ key: "a", label: "Action A", onSelect }]} ariaLabel="Row actions" />,
    );
    const trigger = getByLabelText("Row actions") as HTMLButtonElement;
    fireEvent.click(trigger);
    await settle();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(menuEl()).toBeNull();
  });

  it("flips ABOVE on the MEASURED menu near the viewport bottom", async () => {
    // Below the trigger there is 700 − 624 = 76px; the measured menu is 160.
    // (The old estimate, items × 30, would have said 90 for three entries.)
    triggerBox = { left: 300, top: 600, width: 24, height: 24 };
    const { getByLabelText } = render(<RowMenu items={items} ariaLabel="Row actions" />);
    fireEvent.click(getByLabelText("Row actions"));
    await settle();
    expect(parseFloat(menuEl()!.style.top)).toBe(600 - 2 - menuSize.height);
  });

  it("aligns to the trigger's RIGHT edge (the kebab sits at a row's end)", async () => {
    const { getByLabelText } = render(<RowMenu items={items} ariaLabel="Row actions" />);
    fireEvent.click(getByLabelText("Row actions"));
    await settle();
    expect(parseFloat(menuEl()!.style.left)).toBe(300 + 24 - menuSize.width);
  });

  it("Escape RETURNS focus, never steals it from somewhere else", async () => {
    const { getByLabelText, getByTestId } = render(
      <>
        <input data-testid="elsewhere" />
        <RowMenu items={items} ariaLabel="Row actions" />
      </>,
    );
    fireEvent.click(getByLabelText("Row actions"));
    await settle();
    const elsewhere = getByTestId("elsewhere");
    elsewhere.focus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(menuEl()).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
  });

  it("a click on a greyed row is not a pick: the menu stays open", async () => {
    const dead = vi.fn();
    const { getByLabelText, getByText } = render(
      <RowMenu items={[{ key: "d", label: "Dead", onSelect: dead, disabled: true }]} ariaLabel="Row actions" />,
    );
    fireEvent.click(getByLabelText("Row actions"));
    await settle();
    fireEvent.click(getByText("Dead"));
    expect(dead).not.toHaveBeenCalled();
    expect(menuEl()).not.toBeNull();
  });

  it("keys pressed on the trigger do not reach the enclosing row", () => {
    const rowKey = vi.fn();
    const { getByLabelText } = render(
      <div onKeyDown={rowKey}>
        <RowMenu items={items} ariaLabel="Row actions" />
      </div>,
    );
    fireEvent.keyDown(getByLabelText("Row actions"), { key: "Enter" });
    expect(rowKey).not.toHaveBeenCalled();
  });
});

describe("PaperAiRequestsMenu (task 1011)", () => {
  type K = "index" | "deep" | "bib";
  const makeItems = (checked: Partial<Record<K, boolean>> = {}): AiRequestItem<K>[] => [
    { kind: "index", label: "Index", checked: !!checked.index, disabled: false },
    { kind: "deep", label: "Deep index", checked: !!checked.deep, disabled: false },
    { kind: "bib", label: "Bib review", checked: false, disabled: true, title: "Index the paper first" },
  ];

  const trigger = (c: HTMLElement) =>
    c.querySelector('[aria-haspopup="menu"]') as HTMLButtonElement;

  it("honours the shared keyboard / dismissal contract", async () => {
    const { container } = render(<PaperAiRequestsMenu items={makeItems()} onToggle={() => {}} />);
    await expectKeyboardContract(trigger(container));
  });

  it("a toggle keeps the menu open (multi-select) and reports the next state", async () => {
    const onToggle = vi.fn();
    const { container, getByText } = render(
      <PaperAiRequestsMenu items={makeItems({ deep: true })} onToggle={onToggle} />,
    );
    fireEvent.click(trigger(container));
    await settle();
    fireEvent.click(getByText("Index"));
    fireEvent.click(getByText("Deep index"));
    expect(onToggle.mock.calls).toEqual([
      ["index", true],
      ["deep", false],
    ]);
    expect(menuEl()).not.toBeNull();
    // The disabled row is inert.
    fireEvent.click(getByText("Bib review"));
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it("flips ABOVE near the bottom of a short window (it used to run off it)", async () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 400 });
    triggerBox = { left: 300, top: 330, width: 90, height: 22 };
    const { container } = render(<PaperAiRequestsMenu items={makeItems()} onToggle={() => {}} />);
    fireEvent.click(trigger(container));
    await settle();
    expect(parseFloat(menuEl()!.style.top)).toBe(330 - 4 - menuSize.height);
  });

  it("a paper switch closes an open menu (PaperHeader keys it by citekey)", async () => {
    // The host's contract, exercised with the same key the header uses.
    const { container, rerender } = render(
      <PaperAiRequestsMenu key="smith2020" items={makeItems()} onToggle={() => {}} />,
    );
    fireEvent.click(trigger(container));
    await settle();
    expect(menuEl()).not.toBeNull();
    rerender(<PaperAiRequestsMenu key="jones2021" items={makeItems()} onToggle={() => {}} />);
    expect(menuEl(), "the NEW paper's menu starts closed").toBeNull();

    // …and the header really does key it that way.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const header = readFileSync(path.resolve(here, "../PaperHeader.tsx"), "utf8");
    expect(header).toMatch(/<PaperAiRequestsMenu\s[^>]*?key=\{citekey/);
  });
});

describe("PanelTabStrip menus (task 1011)", () => {
  function renderStrip(tabs: TabDef[]) {
    return render(
      <PanelTabStrip
        panel="left"
        tabs={tabs}
        activeId="central"
        recentLibraries={[{ id: "r1", label: "Old library" } as never]}
        onActivate={() => {}}
        onClose={() => {}}
        onRename={() => {}}
        onCreate={() => "new"}
        onOpenRecent={() => {}}
        onMoveTab={() => {}}
        onDropEntries={() => {}}
        panelRef={createRef<HTMLDivElement>()}
        showAddTab
        showRecent
      />,
    );
  }

  it("the tab ⋮ menu honours the shared keyboard / dismissal contract", async () => {
    const { getByLabelText } = renderStrip([
      {
        id: "central",
        label: "Central Library",
        closable: false,
        renamable: false,
        menu: [
          { label: "Sync", onClick: () => {} },
          { label: "Export", onClick: () => {} },
        ],
      },
    ]);
    await expectKeyboardContract(getByLabelText("Library options") as HTMLButtonElement);
  });

  it("the + menu states its trigger ARIA and honours the shared contract", async () => {
    const { getByLabelText } = renderStrip([
      { id: "central", label: "Central Library", closable: false, renamable: false },
    ]);
    const plus = getByLabelText("New tab") as HTMLButtonElement;
    expect(plus.getAttribute("aria-haspopup")).toBe("menu");
    await expectKeyboardContract(plus);
  });

  it("activating a tab-menu row runs it and closes the menu", async () => {
    const onClick = vi.fn();
    const { getByLabelText, getByText } = renderStrip([
      {
        id: "central",
        label: "Central Library",
        closable: false,
        renamable: false,
        menu: [{ label: "Sync", onClick }],
      },
    ]);
    fireEvent.click(getByLabelText("Library options"));
    await settle();
    fireEvent.click(getByText("Sync"));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(menuEl()).toBeNull();
  });
});
