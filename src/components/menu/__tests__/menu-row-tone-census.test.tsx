// @vitest-environment jsdom
//
// Menu row tones — ONE vocabulary (task 967; doctrine: STYLE_GUIDE "A command
// surface RENDERS its verdict" → "One grey, one red — stated once").
//
// The `<Menu>` primitive's three interactive rows used to paint the same
// states three ways: a greyed `MenuActionRow` was `text-ink-faint`, a greyed
// `MenuToggleRow` `text-ink-subtle opacity-55`, a greyed registry row (grab +
// lightning) `--ink-subtle` at `opacity: 0.45`; the registry's destructive row
// hovered with the NEUTRAL fill; and it hand-drew its separator instead of
// `<MenuSeparator>`. Two legs:
//
//   1. PARITY (RTL) — a disabled row from each primitive carries the same tone
//      class; the registry's destructive row carries the danger hover; its
//      separator is the `<MenuSeparator>` element.
//   2. CENSUS — no file under `src/components/menu/` other than `row-tone.ts`
//      spells a row-state literal (disabled ink, a dimming opacity, the danger
//      tint, the roving background), and none but `MenuChrome.tsx` spells a
//      separator — so a fourth row cannot invent a fourth grey.

import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { render, cleanup } from "@testing-library/react";
import { MenuProvider } from "../MenuProvider";
import { MenuActionRow } from "../MenuActionRow";
import { MenuToggleRow } from "../MenuToggleRow";
import { MenuItemsFromRegistry } from "../MenuItemsFromRegistry";
import { MenuSeparator } from "../MenuChrome";
import { menuRowToneClass } from "../row-tone";
import { SRC, stripComments, walkSource } from "./_menu-census";

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

function mount() {
  return render(
    <MenuProvider id="tone" layout="list" anchorRect={RECT} placements={PLACEMENTS} onClose={noop}>
      <MenuActionRow id="act" label="Search library…" disabled onSelect={noop} />
      <MenuToggleRow id="tog" label="Show cited" checked={false} disabled onToggle={noop} />
      <MenuItemsFromRegistry
        rows={[
          { id: "reg-off", label: "Footnote", disabled: true, run: noop },
          { id: "reg-del", label: "Delete", destructive: true, separator: true, disabled: false, run: noop },
        ]}
      />
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

function toneTokens(el: HTMLElement): string[] {
  const tone = new Set(menuRowToneClass("default", true).split(" "));
  return Array.from(el.classList).filter((c) => tone.has(c) || /^opacity-|^text-ink-/.test(c));
}

describe("menu row tones — parity across the three row primitives", () => {
  it("a disabled row looks the same in every primitive (ink only, no dimming)", () => {
    mount();
    const rows = ["Search library…", "Show cited", "Footnote"].map(rowByText);
    const expected = menuRowToneClass("default", true).split(" ").sort();
    for (const row of rows) {
      expect(row.disabled).toBe(true);
      expect(toneTokens(row).sort()).toEqual(expected);
      expect(row.style.opacity).toBe("");
    }
  });

  it("the registry's destructive row carries the danger ink AND the danger hover", () => {
    mount();
    const del = rowByText("Delete");
    for (const c of menuRowToneClass("danger", false).split(" ")) {
      expect(del.classList.contains(c)).toBe(true);
    }
    expect(del.classList.contains("hover-on-light")).toBe(false);
    // An inline background would beat the hover class — only the roving
    // highlight may set it, and this row is not active.
    expect(del.style.background).toBe("");
  });

  it("the registry separator IS `<MenuSeparator>`", () => {
    mount();
    const { container } = render(<MenuSeparator />);
    const canonical = (container.firstElementChild as HTMLElement).className;
    const del = rowByText("Delete");
    const sep = del.previousElementSibling as HTMLElement | null;
    expect(sep?.getAttribute("aria-hidden")).toBe("true");
    expect(sep?.className).toBe(canonical);
  });
});

describe("menu row tones — census", () => {
  const MENU_DIR = path.join(SRC, "components/menu");
  const OWNER = path.join(MENU_DIR, "row-tone.ts");
  const SEPARATOR_OWNER = path.join(MENU_DIR, "MenuChrome.tsx");

  const STATE_LITERALS: Array<[string, RegExp]> = [
    ["disabled ink", /\bink-faint\b/],
    ["disabled cursor", /cursor-not-allowed|cursor:\s*["']?not-allowed/],
    ["dimming opacity", /\bopacity-(?:[1-9]\d*)\b|opacity:\s*(?:row\.|0?\.\d)/],
    ["danger tint", /\bbg-danger-soft\b|--danger\b/],
    ["roving background", /--menu-roving-bg/],
  ];
  const SEPARATOR_LITERALS: RegExp = /border-t\s+border-edge|height:\s*1\b/;

  it("only row-tone.ts spells a row-state literal; only MenuChrome spells a separator", () => {
    const offences: string[] = [];
    for (const file of walkSource(MENU_DIR)) {
      const code = stripComments(readFileSync(file, "utf8"));
      const rel = path.relative(SRC, file);
      if (file !== OWNER) {
        for (const [name, re] of STATE_LITERALS) {
          if (re.test(code)) offences.push(`${rel}: ${name} (${re})`);
        }
      }
      if (file !== SEPARATOR_OWNER && SEPARATOR_LITERALS.test(code)) {
        offences.push(`${rel}: hand-drawn separator — use <MenuSeparator>`);
      }
    }
    expect(offences).toEqual([]);
  });

  it("the census is not vacuous — the owner spells what it forbids elsewhere", () => {
    const owner = stripComments(readFileSync(OWNER, "utf8"));
    for (const [name, re] of STATE_LITERALS.filter(([n]) => n !== "dimming opacity")) {
      expect(re.test(owner), name).toBe(true);
    }
    expect(SEPARATOR_LITERALS.test(readFileSync(SEPARATOR_OWNER, "utf8"))).toBe(true);
  });
});
