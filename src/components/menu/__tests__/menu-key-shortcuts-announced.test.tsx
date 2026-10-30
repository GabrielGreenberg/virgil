// @vitest-environment jsdom
//
// Task 1362 — the menu primitive owns every row's key verbs (letter, aliases,
// the task-1280 remove verb) and now ANNOUNCES them: `getItemProps()` emits
// `aria-keyshortcuts` derived from the registration the keyboard controller
// honours, and the visible hints (the registry list's letter, a row's `<Kbd>`
// chord chip) are `aria-hidden`, so they no longer join the accessible name
// ("Archive A").

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MenuProvider } from "../MenuProvider";
import { MenuActionRow } from "../MenuActionRow";
import { MenuItemsFromRegistry, type DecoratedMenuRow } from "../MenuItemsFromRegistry";
import { useMenuItem } from "../useMenuItem";
import { menuKeyShortcuts } from "../nav-core";
import { ariaKeyShortcut } from "../../Kbd";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const RECT = { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 };
const PLACEMENTS = [{ side: "below" as const, align: "start" as const }];
const noop = () => {};

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function inMenu(children: React.ReactNode, letterShortcuts = true) {
  return render(
    <MenuProvider
      id="keys"
      layout="list"
      anchorRect={RECT}
      placements={PLACEMENTS}
      letterShortcuts={letterShortcuts}
      onClose={noop}
    >
      {children}
    </MenuProvider>,
  );
}

function rowByText(text: string): HTMLElement {
  const el = Array.from(document.querySelectorAll<HTMLElement>("[role=menuitem]")).find((b) =>
    (b.textContent ?? "").includes(text),
  );
  if (!el) throw new Error(`no row "${text}"`);
  return el;
}

/** The name-from-content an AT computes for a row: its text with every
 *  `aria-hidden` subtree removed. (dom-accessibility-api answers "" here —
 *  the unpositioned menu container counts as hidden in jsdom.) */
function nameFromContent(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[aria-hidden=true]").forEach((h) => h.remove());
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

const row = (over: Partial<DecoratedMenuRow> & { id: string; label: string }): DecoratedMenuRow => ({
  disabled: false,
  run: noop,
  ...over,
});

function RemovableRow({ label }: { label: string }) {
  const { getItemProps } = useMenuItem({ id: label, run: noop, remove: noop });
  return <div {...getItemProps()}>{label}</div>;
}

describe("task 1362 — derivation (menuKeyShortcuts)", () => {
  const n = { region: "list" as const, disabled: false };
  it("announces letter + aliases only where the letter fast-path runs", () => {
    expect(menuKeyShortcuts({ ...n, letter: "a" }, false, true)).toBe("A");
    expect(menuKeyShortcuts({ ...n, letter: "a" }, false, false)).toBeUndefined();
    expect(
      menuKeyShortcuts({ ...n, letter: "D", letterAliases: ["Backspace", "Delete"] }, false, true),
    ).toBe("D Backspace Delete");
  });
  it("a remove verb announces Delete Backspace, whatever the letter mode", () => {
    expect(menuKeyShortcuts(n, true, false)).toBe("Delete Backspace");
    expect(menuKeyShortcuts({ ...n, region: "widget" }, true, false)).toBeUndefined();
  });
  it("a greyed row announces nothing (its keys are inert)", () => {
    expect(menuKeyShortcuts({ ...n, disabled: true, letter: "A" }, true, true)).toBeUndefined();
  });
  it("a display glyph registered as a letter is not a key", () => {
    expect(menuKeyShortcuts({ ...n, letter: "⌫" }, false, true)).toBeUndefined();
  });
  it("a portable chord maps to the ARIA grammar per platform", () => {
    expect(ariaKeyShortcut("Mod+Shift+n", true)).toBe("Meta+Shift+N");
    expect(ariaKeyShortcut("Mod+Shift+n", false)).toBe("Control+Shift+N");
  });
});

describe("task 1362 — rows carry the attribute, names exclude the hint", () => {
  it("registry list: letter row announces its letter; the visible letter leaves the name", () => {
    inMenu(
      <MenuItemsFromRegistry
        rows={[
          row({ id: "archive", label: "Archive", letter: "A" }),
          row({ id: "delete", label: "Delete", letter: "D", letterAliases: ["Backspace", "Delete"] }),
          row({ id: "plain", label: "Plain" }),
        ]}
      />,
    );
    const archive = rowByText("Archive");
    expect(archive.getAttribute("aria-keyshortcuts")).toBe("A");
    expect(nameFromContent(archive)).toBe("Archive");
    expect(rowByText("Delete").getAttribute("aria-keyshortcuts")).toBe("D Backspace Delete");
    expect(rowByText("Plain").hasAttribute("aria-keyshortcuts")).toBe(false);
  });

  it("a menu without the letter fast-path does not promise a letter", () => {
    inMenu(<MenuItemsFromRegistry rows={[row({ id: "archive", label: "Archive", letter: "A" })]} />, false);
    expect(rowByText("Archive").hasAttribute("aria-keyshortcuts")).toBe(false);
  });

  it("a row with a remove verb announces Delete/Backspace", () => {
    inMenu(<RemovableRow label="paper.tex" />, false);
    expect(rowByText("paper.tex").getAttribute("aria-keyshortcuts")).toBe("Delete Backspace");
  });

  it("MenuActionRow: the chord is announced and its chip leaves the name", () => {
    inMenu(<MenuActionRow id="nw" label="New window" shortcut="Mod+Shift+N" onSelect={noop} />);
    const nw = rowByText("New window");
    // jsdom's first paint reads Mac (useIsMac's server snapshot) before settling.
    expect(nw.getAttribute("aria-keyshortcuts")).toMatch(/^(Meta|Control)\+Shift\+N$/);
    expect(nameFromContent(nw)).toBe("New window");
  });
});
