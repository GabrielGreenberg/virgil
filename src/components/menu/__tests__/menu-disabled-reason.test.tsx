// @vitest-environment jsdom
//
// Task 998 — task 968's "a greyed command says why" reaches EVERY command row,
// and a row's advertised chord is the chord its binding matches.
//
//   1. REASON DOOR — `MenuActionRow` and `BarStatusMenuRow` take a
//      `disabledReason`, render it exactly as the registry rows render 968's
//      reason (hint + accessible description, via `menuRowReasonProps`), and
//      DERIVE `disabled` from it, so a row that knows why it is greyed cannot
//      grey silently.
//   2. CHORD — "New Virgil window" (TabPlusMenu) used to advertise a
//      hand-spelled `Mod+Shift+N` beside a hand-written keydown test in
//      EditorLayout. Both now read `NEW_WINDOW_SHORTCUT`; the handler matches
//      it through `matchesPortableChord`.

import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { render, cleanup } from "@testing-library/react";
import { MenuProvider } from "../MenuProvider";
import { MenuActionRow } from "../MenuActionRow";
import { MenuItemsFromRegistry } from "../MenuItemsFromRegistry";
import { BarStatusMenuRow } from "../../status/BarStatusPill";
import { matchesPortableChord } from "@/lib/portable-chord";
import { NEW_WINDOW_SHORTCUT } from "@/lib/multi-window/new-window-shortcut";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const RECT = { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 };
const PLACEMENTS = [{ side: "below" as const, align: "start" as const }];
const noop = () => {};
const SRC = path.resolve(__dirname, "../../..");

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function inMenu(children: React.ReactNode) {
  return render(
    <MenuProvider id="reason" layout="list" anchorRect={RECT} placements={PLACEMENTS} onClose={noop}>
      {children}
    </MenuProvider>,
  );
}

function rowByText(text: string): HTMLButtonElement {
  const b = Array.from(document.querySelectorAll("button")).find((el) =>
    (el.textContent ?? "").includes(text),
  );
  if (!b) throw new Error(`no row "${text}"`);
  return b as HTMLButtonElement;
}

describe("task 998 — a greyed command row says why", () => {
  it("MenuActionRow: a reason greys the row and is its hint + description", () => {
    inMenu(
      <>
        <MenuActionRow id="a" label="Export cited.bib" disabledReason="The paper cites nothing yet" onSelect={noop} />
        <MenuActionRow id="b" label="Archive" onSelect={noop} />
      </>,
    );
    const greyed = rowByText("Export cited.bib");
    expect(greyed.disabled).toBe(true);
    expect(greyed.getAttribute("data-hint")).toBe("The paper cites nothing yet");
    expect(greyed.getAttribute("aria-description")).toBe("The paper cites nothing yet");
    const live = rowByText("Archive");
    expect(live.disabled).toBe(false);
    expect(live.hasAttribute("data-hint")).toBe(false);
    expect(live.hasAttribute("aria-description")).toBe(false);
  });

  it("an explicit disabled={false} wins, and an enabled row never shows a reason", () => {
    inMenu(<MenuActionRow id="a" label="Go" disabled={false} disabledReason="stale" onSelect={noop} />);
    const row = rowByText("Go");
    expect(row.disabled).toBe(false);
    expect(row.hasAttribute("data-hint")).toBe(false);
  });

  it("MenuActionRow, BarStatusMenuRow and a registry row render a reason IDENTICALLY", () => {
    inMenu(
      <>
        <MenuActionRow id="a" label="Action" disabledReason="Why" onSelect={noop} />
        <BarStatusMenuRow id="b" label="Status" disabledReason="Why" run={noop} />
        <MenuItemsFromRegistry
          rows={[{ id: "c", label: "Registry", disabled: true, disabledReason: "Why", run: noop }]}
        />
      </>,
    );
    for (const label of ["Action", "Status", "Registry"]) {
      const row = rowByText(label);
      expect(row.disabled, label).toBe(true);
      expect(row.getAttribute("data-hint"), label).toBe("Why");
      expect(row.getAttribute("aria-description"), label).toBe("Why");
    }
  });

  it("the Bibliography rows that grey hand their reason through", () => {
    const src = readFileSync(path.join(SRC, "panels/Bibliography/BibliographyPanel.tsx"), "utf8");
    expect(src).not.toMatch(/disabled=\{citedKeys\.size === 0\}/);
    expect(src).toMatch(/disabledReason: isLibraryConnected \? undefined : LIBRARY_NOT_CONNECTED_HINT/);
    expect(src).toMatch(/disabledReason=\{citedKeys\.size === 0/);
  });
});

describe("task 998 — the New-window hint and binding are one chord", () => {
  const ev = (key: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "shiftKey" | "altKey", boolean>>) => ({
    key,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  });

  it("matchesPortableChord: Mod is ⌘ or Ctrl; Shift/Alt exact; key case-insensitive", () => {
    expect(matchesPortableChord(ev("N", { metaKey: true, shiftKey: true }), "Mod+Shift+N")).toBe(true);
    expect(matchesPortableChord(ev("n", { ctrlKey: true, shiftKey: true }), "Mod+Shift+N")).toBe(true);
    expect(matchesPortableChord(ev("n", { metaKey: true }), "Mod+Shift+N")).toBe(false);
    expect(matchesPortableChord(ev("N", { metaKey: true, shiftKey: true, altKey: true }), "Mod+Shift+N")).toBe(false);
    expect(matchesPortableChord(ev("N", { shiftKey: true }), "Mod+Shift+N")).toBe(false);
    expect(matchesPortableChord(ev("n", { metaKey: true, shiftKey: true }), "Mod+N")).toBe(false);
  });

  it("TabPlusMenu renders and EditorLayout binds the SAME constant; neither hand-spells it", () => {
    const menu = readFileSync(path.join(SRC, "components/TabPlusMenu.tsx"), "utf8");
    const layout = readFileSync(path.join(SRC, "components/EditorLayout.tsx"), "utf8");
    expect(menu).toMatch(/shortcut=\{NEW_WINDOW_SHORTCUT\}/);
    expect(layout).toMatch(/matchesPortableChord\(e, NEW_WINDOW_SHORTCUT\)/);
    expect(menu).not.toContain(`"${NEW_WINDOW_SHORTCUT}"`);
    expect(layout).not.toContain(`"${NEW_WINDOW_SHORTCUT}"`);
    expect(layout).not.toMatch(/e\.key\.toLowerCase\(\) === "n"/);
  });
});
