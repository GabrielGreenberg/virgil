// @vitest-environment jsdom
/**
 * FONT VOCABULARY — one catalogue, every picker a subset of it (task 901).
 *
 * The vocabulary used to be four hand lists. Fonts… wrote `fontSerif` from a
 * 35-font pool while the Preferences row for the same key offered 8, and that
 * row is a controlled <select> — so "Spectral" picked in Fonts… displayed as
 * "Source Serif 4" in Preferences, and any change there overwrote it.
 *
 * Two contracts:
 *  - every list a picker renders is a subset of `FONT_CATALOGUE`, and no
 *    module outside the catalogue re-spells a font list;
 *  - a picker whose stored value is outside its offer still SHOWS that value.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import {
  ALL_CATALOGUE_FONTS,
  DISPLAY_FONTS,
  FONT_CATALOGUE,
  LOGO_FONTS,
  MAIN_TEXT_FONTS,
  MONO_FONTS,
  PANEL_BODY_FONTS,
  asFontGroups,
  withCurrent,
} from "@/lib/font-catalogue";
import { PREFERENCES_TREE, isLeaf, type PrefNode, type PrefLeafFont } from "@/lib/preferences-tree";
import { PANEL_BODY_FONT_OPTIONS } from "@/lib/panel-typography";
import { DEFAULT_PREFS } from "@/hooks/usePreferences";
import { FontPref } from "@/components/PreferenceTree";
import { walkFiles } from "../lib/__tests__/_source-scan";

const catalogue = new Set(ALL_CATALOGUE_FONTS);

function fontLeaves(nodes: PrefNode[]): PrefLeafFont[] {
  return nodes.flatMap((n) =>
    isLeaf(n) ? (n.type === "font" ? [n] : []) : fontLeaves(n.children),
  );
}

describe("font vocabulary — one catalogue", () => {
  it("the catalogue names each family once", () => {
    expect(new Set(ALL_CATALOGUE_FONTS).size).toBe(ALL_CATALOGUE_FONTS.length);
  });

  it("every role list is a subset of the catalogue", () => {
    const roles: Record<string, readonly string[]> = {
      MAIN_TEXT_FONTS: MAIN_TEXT_FONTS.flatMap((g) => g.fonts),
      DISPLAY_FONTS,
      LOGO_FONTS,
      MONO_FONTS,
      PANEL_BODY_FONTS,
      PANEL_BODY_FONT_OPTIONS,
    };
    for (const [role, fonts] of Object.entries(roles)) {
      expect(fonts.length, role).toBeGreaterThan(0);
      for (const f of fonts) expect(catalogue.has(f), `${role}: ${f}`).toBe(true);
    }
  });

  it("the main-text pool is the catalogue's serif/sans/display groups (what Fonts… offers)", () => {
    expect(MAIN_TEXT_FONTS.map((g) => g.group)).toEqual(["Serif", "Sans-serif", "Display"]);
    for (const g of MAIN_TEXT_FONTS) {
      expect(g.fonts).toEqual(FONT_CATALOGUE.find((c) => c.group === g.group)!.fonts);
    }
  });

  it("every Preferences font row offers a catalogue subset that includes its shipped default", () => {
    const leaves = fontLeaves(PREFERENCES_TREE);
    expect(leaves.length).toBeGreaterThan(0);
    for (const leaf of leaves) {
      const offered = asFontGroups(leaf.options).flatMap((g) => g.fonts);
      for (const f of offered) expect(catalogue.has(f), `${leaf.key}: ${f}`).toBe(true);
      expect(offered, String(leaf.key)).toContain(DEFAULT_PREFS[leaf.key] as string);
    }
  });

  it("a row writing a key Fonts… also writes offers the whole main-text pool", () => {
    const mainText = MAIN_TEXT_FONTS.flatMap((g) => g.fonts);
    for (const leaf of fontLeaves(PREFERENCES_TREE).filter((l) => l.key === "fontSerif")) {
      expect(asFontGroups(leaf.options).flatMap((g) => g.fonts)).toEqual(mainText);
    }
  });

  it("no module outside the catalogue re-spells a font list", () => {
    // A hand list is the fork this task retired. FONT_STACKS (per-face CSS
    // stacks, keyed by name) is the one other legitimate home of font names.
    const allowed = new Set(["src/lib/font-catalogue.ts", "src/lib/panel-typography.ts"]);
    const root = path.resolve(__dirname, "../..");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const full of walkFiles(dir, { skipDirs: ["__tests__"] })) {
        if (!/\.(ts|tsx)$/.test(full)) continue;
        const rel = path.relative(root, full).split(path.sep).join("/");
        if (allowed.has(rel)) continue;
        // An array literal holding two or more catalogue names in a row.
        const src = readFileSync(full, "utf8");
        const listRe = /\[\s*"([^"]+)"\s*,\s*"([^"]+)"/g;
        for (const m of src.matchAll(listRe)) {
          if (catalogue.has(m[1]) && catalogue.has(m[2])) offenders.push(`${rel}: [${m[1]}, ${m[2]}, …]`);
        }
      }
    };
    walk(path.join(root, "src"));
    expect(offenders).toEqual([]);
  });
});

describe("font vocabulary — an unlisted stored value stays on offer", () => {
  it("withCurrent prepends an unlisted value and leaves a listed one alone", () => {
    expect(withCurrent(["Lora", "Georgia"], "Spectral")[0]).toEqual({ group: "Current", fonts: ["Spectral"] });
    expect(withCurrent(["Lora", "Georgia"], "Georgia")).toEqual([{ group: "", fonts: ["Lora", "Georgia"] }]);
    expect(withCurrent(MAIN_TEXT_FONTS, "Spectral")).toEqual(asFontGroups(MAIN_TEXT_FONTS));
  });

  it("FontPref with a value outside its options displays that value, not the first option", () => {
    const { container } = render(
      <FontPref label="Display" value="Comic Neue" options={DISPLAY_FONTS} onChange={() => {}} />,
    );
    const select = container.querySelector("select")!;
    expect(select.value).toBe("Comic Neue");
  });

  it("FontPref renders a grouped offer as optgroups and shows a Fonts…-only pick", () => {
    const { container } = render(
      <FontPref label="Body" value="Spectral" options={MAIN_TEXT_FONTS} onChange={() => {}} />,
    );
    const select = container.querySelector("select")!;
    expect(select.value).toBe("Spectral");
    expect([...container.querySelectorAll("optgroup")].map((g) => g.label)).toEqual(["Serif", "Sans-serif", "Display"]);
  });
});
