// @vitest-environment jsdom
//
// HeadingTypeMenu on the <Menu> primitive (Phase C): behavior PARITY + the new
// arrow nav. Drives the REAL component through the full primitive stack
// (MenuProvider + useMenuItem + useMenuKeyboard), mirroring
// drag-handle-menu-keyboard.test.tsx:
//
//   - click selects a level (onPick) / "No heading" (onPick no-heading);
//   - the current-level row carries the ✓ marker + aria-checked/data-current;
//   - disabled levels (unsupported by the documentclass) stay VISIBLE + greyed
//     + unselectable (click is inert) + arrow-skipped;
//   - Escape closes (onClose); click-outside dismisses;
//   - Up/Down/Home/End arrow nav moves a visible data-active highlight,
//     skipping disabled rows; Enter activates the active row;
//   - the active item's domId mirrors onto a focused contentEditable's
//     aria-activedescendant (NO focus move to the item).

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import { HeadingTypeMenu } from "../../HeadingTypeMenu";
import { HEADING_TYPES } from "@/lib/heading-types";

// jsdom has no ResizeObserver; useFloatingMenuPosition measures with one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const RECT = { left: 100, top: 100, right: 160, bottom: 124, width: 60, height: 24 };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

function key(k: string, opts: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...opts }));
  });
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
  if (!b) return "";
  // The label is the last span (the leading span is the checkmark gutter).
  const spans = b.querySelectorAll("span");
  return spans[spans.length - 1]?.textContent ?? "";
}

function buttonByLabel(label: string): HTMLButtonElement | undefined {
  return menuButtons().find((b) => labelOf(b) === label);
}

const NO_HEADING = "No heading";

describe("HeadingTypeMenu — click selection parity", () => {
  it("clicking a level fires onPick with that level", () => {
    const onPick = vi.fn();
    render(
      <HeadingTypeMenu anchorRect={RECT} currentLevel={2} documentClass={null} onPick={onPick} onClose={() => {}} />,
    );
    const section = buttonByLabel("Section"); // level 2
    expect(section).toBeDefined();
    fireEvent.click(section!);
    expect(onPick).toHaveBeenCalledWith({ kind: "level", level: 2 });
  });

  it("clicking 'No heading' fires onPick no-heading", () => {
    const onPick = vi.fn();
    render(
      <HeadingTypeMenu anchorRect={RECT} currentLevel={2} documentClass={null} onPick={onPick} onClose={() => {}} />,
    );
    fireEvent.click(buttonByLabel(NO_HEADING)!);
    expect(onPick).toHaveBeenCalledWith({ kind: "no-heading" });
  });

  it("renders every heading level plus a 'No heading' row", () => {
    render(
      <HeadingTypeMenu anchorRect={RECT} currentLevel={2} documentClass={null} onPick={() => {}} onClose={() => {}} />,
    );
    expect(menuButtons()).toHaveLength(HEADING_TYPES.length + 1);
    expect(buttonByLabel(NO_HEADING)).toBeDefined();
  });
});

describe("HeadingTypeMenu — current-level marker", () => {
  it("marks the current level with ✓ + aria-checked + data-current; others unmarked", () => {
    render(
      <HeadingTypeMenu anchorRect={RECT} currentLevel={3} documentClass={null} onPick={() => {}} onClose={() => {}} />,
    );
    const subsection = buttonByLabel("Subsection"); // level 3
    expect(subsection!.getAttribute("aria-checked")).toBe("true");
    expect(subsection!.hasAttribute("data-current")).toBe(true);
    expect(subsection!.textContent).toContain("✓");

    const section = buttonByLabel("Section"); // level 2 — not current
    expect(section!.getAttribute("aria-checked")).toBe("false");
    expect(section!.hasAttribute("data-current")).toBe(false);
    expect(section!.textContent).not.toContain("✓");
  });

  it("'No heading' never carries the current marker", () => {
    render(
      <HeadingTypeMenu anchorRect={RECT} currentLevel={0} documentClass={null} onPick={() => {}} onClose={() => {}} />,
    );
    const noHeading = buttonByLabel(NO_HEADING)!;
    expect(noHeading.hasAttribute("aria-checked")).toBe(false);
    expect(noHeading.hasAttribute("data-current")).toBe(false);
  });
});

describe("HeadingTypeMenu — disabled levels (unsupported by documentclass)", () => {
  it("greys out + disables an unsupported level (article has no \\chapter)", () => {
    render(
      <HeadingTypeMenu anchorRect={RECT} currentLevel={2} documentClass="article" onPick={() => {}} onClose={() => {}} />,
    );
    const chapter = buttonByLabel("Chapter"); // level 1 — unsupported by article
    expect(chapter).toBeDefined();
    expect(chapter!.disabled).toBe(true);
    expect(chapter!.getAttribute("aria-disabled")).toBe("true");
    // It stays VISIBLE (still rendered).
    expect(chapter!.isConnected).toBe(true);
  });

  it("clicking a disabled level is inert (no onPick)", () => {
    const onPick = vi.fn();
    render(
      <HeadingTypeMenu anchorRect={RECT} currentLevel={2} documentClass="article" onPick={onPick} onClose={() => {}} />,
    );
    fireEvent.click(buttonByLabel("Chapter")!); // disabled
    expect(onPick).not.toHaveBeenCalled();
  });

  it("a null / unknown documentClass disables nothing", () => {
    render(
      <HeadingTypeMenu anchorRect={RECT} currentLevel={2} documentClass={null} onPick={() => {}} onClose={() => {}} />,
    );
    expect(menuButtons().every((b) => !b.disabled)).toBe(true);
  });

  it("arrow nav skips the disabled Chapter row", () => {
    render(
      <HeadingTypeMenu anchorRect={RECT} currentLevel={2} documentClass="article" onPick={() => {}} onClose={() => {}} />,
    );
    // Part (0) is enabled → Down should land on Section (2), skipping Chapter (1).
    key("ArrowDown");
    expect(labelOf(activeButton())).toBe("Part");
    key("ArrowDown");
    expect(labelOf(activeButton())).toBe("Section"); // Chapter skipped
    // No active row through a full traversal is ever the disabled Chapter.
    for (let i = 0; i < 12; i++) {
      key("ArrowDown");
      expect(activeButton()?.disabled).not.toBe(true);
      expect(labelOf(activeButton())).not.toBe("Chapter");
    }
  });

  it("Enter never activates a disabled row", () => {
    const onPick = vi.fn();
    render(
      <HeadingTypeMenu anchorRect={RECT} currentLevel={2} documentClass="article" onPick={onPick} onClose={() => {}} />,
    );
    // Walk the whole list pressing Enter at each stop; a disabled row can never
    // be the active target, so onPick is never called with level 1 (Chapter).
    for (let i = 0; i < HEADING_TYPES.length + 2; i++) {
      key("ArrowDown");
      key("Enter");
    }
    expect(onPick).not.toHaveBeenCalledWith({ kind: "level", level: 1 });
  });
});

describe("HeadingTypeMenu — Escape + click-outside", () => {
  it("Escape closes", () => {
    const onClose = vi.fn();
    render(
      <HeadingTypeMenu anchorRect={RECT} currentLevel={2} documentClass={null} onPick={() => {}} onClose={onClose} />,
    );
    key("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("click outside dismisses (after the deferred mount)", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(
      <HeadingTypeMenu anchorRect={RECT} currentLevel={2} documentClass={null} onPick={() => {}} onClose={onClose} />,
    );
    act(() => {
      vi.runAllTimers();
    });
    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe("HeadingTypeMenu — NEW arrow navigation", () => {
  it("Down/Up move a visible data-active highlight; Enter activates it", () => {
    const onPick = vi.fn();
    render(
      <HeadingTypeMenu anchorRect={RECT} currentLevel={2} documentClass={null} onPick={onPick} onClose={() => {}} />,
    );
    key("ArrowDown"); // no active → first enabled (Part)
    expect(labelOf(activeButton())).toBe("Part");
    key("ArrowDown");
    expect(labelOf(activeButton())).toBe("Chapter");
    key("ArrowUp");
    expect(labelOf(activeButton())).toBe("Part");

    key("Enter");
    expect(onPick).toHaveBeenCalledWith({ kind: "level", level: 0 });
  });

  it("End jumps to 'No heading' (last), Home back to 'Part' (first)", () => {
    render(
      <HeadingTypeMenu anchorRect={RECT} currentLevel={2} documentClass={null} onPick={() => {}} onClose={() => {}} />,
    );
    key("End");
    expect(labelOf(activeButton())).toBe(NO_HEADING);
    key("Home");
    expect(labelOf(activeButton())).toBe("Part");
  });

  it("Enter on the 'No heading' row fires the no-heading pick", () => {
    const onPick = vi.fn();
    render(
      <HeadingTypeMenu anchorRect={RECT} currentLevel={2} documentClass={null} onPick={onPick} onClose={() => {}} />,
    );
    key("End"); // No heading
    key("Enter");
    expect(onPick).toHaveBeenCalledWith({ kind: "no-heading" });
  });
});

describe("HeadingTypeMenu — aria-activedescendant (no focus theft)", () => {
  it("mirrors the active item's domId onto a focused contentEditable, never focusing the item", () => {
    // A stand-in for the PM view's focused contentEditable (see the parity note
    // in drag-handle-menu-keyboard.test.tsx for why we force isContentEditable).
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    editable.tabIndex = 0;
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);
    editable.focus();
    expect(document.activeElement).toBe(editable);

    render(
      <HeadingTypeMenu anchorRect={RECT} currentLevel={2} documentClass={null} onPick={() => {}} onClose={() => {}} />,
    );
    key("ArrowDown");

    const active = activeButton();
    expect(active).toBeDefined();
    expect(editable.getAttribute("aria-activedescendant")).toBe(active!.id);
    expect(document.activeElement).toBe(editable);
  });
});
