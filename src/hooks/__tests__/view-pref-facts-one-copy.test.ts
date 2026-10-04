// @vitest-environment jsdom
//
// Task 931 — a view pref's values, labels and default are stated ONCE, in
// VIEW_PREF_REGISTRY. Readers derive them:
//   1. enum-valued controls render off `enumOptions(key)` (the Bibliography
//      filter's labels used to be a private copy; the registry's were dead);
//   2. the legacy standalone-key migrations validate against the registry and
//      fall back to its DEFAULT (an unknown `virgil-divider-width` used to
//      become "full" while the shipped default is "text");
//   3. EditorPane's absent-prefs fallbacks read REGISTRY_DEFAULTS.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  VIEW_PREF_REGISTRY,
  REGISTRY_DEFAULTS,
  enumOptions,
} from "@/lib/view-prefs/registry";

vi.mock("@/lib/multi-window/window-id", () => ({ getWindowId: () => "test-window" }));
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));

import { loadPrefs } from "../useViewPrefs";

const SRC = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

describe("enumOptions — the registry's enum values + labels", () => {
  it("bibFilter options are exactly the registry's values and valueLabels", () => {
    const def = VIEW_PREF_REGISTRY.bibFilter;
    expect(enumOptions("bibFilter")).toEqual(
      def.values.map((v) => ({ value: v, label: def.valueLabels[v] })),
    );
  });

  it("dividerWidth options are exactly the registry's values and valueLabels", () => {
    const def = VIEW_PREF_REGISTRY.dividerWidth;
    expect(enumOptions("dividerWidth")).toEqual(
      def.values.map((v) => ({ value: v, label: def.valueLabels[v] })),
    );
  });

  it("BibliographyPanel restates no filter label, value union or default", () => {
    const src = read("panels/Bibliography/BibliographyPanel.tsx");
    for (const label of Object.values(VIEW_PREF_REGISTRY.bibFilter.valueLabels)) {
      expect(src).not.toContain(`"${label}"`);
    }
    expect(src).not.toMatch(/"cited"\s*\|\s*"all"/);
    expect(src).toContain('enumOptions("bibFilter")');
  });

  it("EditorPane's absent-prefs fallbacks read the registry defaults", () => {
    const src = read("components/EditorPane.tsx");
    expect(src).not.toMatch(/prefs\.checkSpelling \?\? (true|false)/);
    expect(src).not.toMatch(/prefs\.autocorrectTypos \?\? (true|false)/);
    expect(src).not.toMatch(/showHighlights: (true|false),/);
  });
});

describe("legacy standalone-key migrations validate against the registry", () => {
  beforeEach(() => localStorage.clear());

  it("an unrecognised virgil-divider-width migrates to the registry default", () => {
    localStorage.setItem("virgil-divider-width", "bogus");
    expect(loadPrefs().dividerWidth).toBe(REGISTRY_DEFAULTS.dividerWidth);
    expect(localStorage.getItem("virgil-divider-width")).toBeNull();
  });

  it("a recognised virgil-divider-width survives", () => {
    localStorage.setItem("virgil-divider-width", "mid");
    expect(loadPrefs().dividerWidth).toBe("mid");
  });

  it("legacy booleans: \"false\" is false, garbage takes the registry default", () => {
    localStorage.setItem("virgil-show-marginalia", "false");
    localStorage.setItem("virgil-show-heading-labels", "maybe");
    const p = loadPrefs();
    expect(p.showMarginalia).toBe(false);
    expect(p.showHeadingLabels).toBe(REGISTRY_DEFAULTS.showHeadingLabels);
  });

  it("a non-array legacy set takes the registry default", () => {
    localStorage.setItem("virgil-divider-levels", '"nope"');
    expect(loadPrefs().dividerLevels).toEqual(REGISTRY_DEFAULTS.dividerLevels);
  });
});
