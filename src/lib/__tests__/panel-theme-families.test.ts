// Theme families are a code fact (task 824).
//
// The family table used to live only as prose — in STYLE_GUIDE.md and in
// docs/virgil-design-system/05-cards-and-themes.md — and both copies drifted:
// a dead `quote` theme and the `comment` CSS token listed as keys, the live
// `highlight` and `report` keys missing, and an unpinned hex column. These pins
// make `PANEL_THEME_FAMILIES` the one owner and hold both prose copies to it.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PANEL_THEME_FAMILIES,
  DEFAULT_PANEL_COLORS,
  type PanelThemeFamily,
  type PanelThemeKey,
} from "@/lib/panel-theme";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const ALL_KEYS = Object.keys(DEFAULT_PANEL_COLORS) as PanelThemeKey[];

/** Parse a prose family list: the bullets `- **<Label>:** `a`, `b`` (or
 *  `- **<Label>** — `a`, …`) between two markers. Returns label → keys. */
function proseFamilies(file: string, from: string, to: string): Map<string, string[]> {
  const text = readFileSync(path.join(ROOT, file), "utf8");
  const start = text.indexOf(from);
  const end = text.indexOf(to, start);
  expect(start, `${file}: marker "${from}" missing`).toBeGreaterThanOrEqual(0);
  expect(end, `${file}: marker "${to}" missing`).toBeGreaterThan(start);
  const out = new Map<string, string[]>();
  // A bullet runs until the next bullet or a blank line.
  const bullets = text.slice(start, end).split(/\n(?=- \*\*)|\n\s*\n/);
  for (const b of bullets) {
    const m = /^- \*\*([^*:]+):?\*\*([\s\S]*)$/.exec(b.trim());
    if (!m) continue;
    // Only the keys before the first ":" gloss / sentence — i.e. the list
    // itself — count; a later prose mention (`SYSTEM_THEME_KEYS`) does not.
    const listPart = m[2].split(/[:.(]/)[0];
    out.set(m[1].trim(), [...listPart.matchAll(/`([A-Za-z]+)`/g)].map((x) => x[1]));
  }
  return out;
}

function expectMatchesCode(families: Map<string, string[]>, file: string) {
  const byLabel = new Map(
    (Object.keys(PANEL_THEME_FAMILIES) as PanelThemeFamily[]).map((f) => [
      PANEL_THEME_FAMILIES[f].label,
      PANEL_THEME_FAMILIES[f].keys,
    ]),
  );
  expect([...families.keys()].sort(), `${file}: family labels`).toEqual(
    [...byLabel.keys()].sort(),
  );
  for (const [label, names] of families) {
    for (const n of names) {
      expect(ALL_KEYS, `${file}: "${n}" (family ${label}) is not a PanelThemeKey`).toContain(n);
    }
    expect([...names].sort(), `${file}: family ${label}`).toEqual(
      [...byLabel.get(label)!].sort(),
    );
  }
}

describe("PANEL_THEME_FAMILIES (task 824)", () => {
  it("partitions PanelThemeKey exactly — every key in one family, none twice", () => {
    const listed = Object.values(PANEL_THEME_FAMILIES).flatMap((f) => f.keys);
    expect(new Set(listed).size, "a key is listed in two families").toBe(listed.length);
    expect([...listed].sort()).toEqual([...ALL_KEYS].sort());
  });

  it("STYLE_GUIDE.md's family list names exactly the code's families", () => {
    expectMatchesCode(
      proseFamilies(
        "src/STYLE_GUIDE.md",
        "**Theme families are a code fact**",
        "`cut`, `footnote`, and `error` share the rust accent.",
      ),
      "STYLE_GUIDE.md",
    );
  });

  it("the design-system doc's family list names exactly the code's families, with no hex restated", () => {
    const file = "docs/virgil-design-system/05-cards-and-themes.md";
    const from = "## The themes and their families";
    const to = "`cut`, `footnote`, and `error` share one rust accent.";
    expectMatchesCode(proseFamilies(file, from, to), file);
    const text = readFileSync(path.join(ROOT, file), "utf8");
    const section = text.slice(text.indexOf(from), text.indexOf(to));
    expect(section, "an unpinned accent hex crept back into the family table").not.toMatch(
      /#[0-9a-fA-F]{6}\b/,
    );
  });
});
