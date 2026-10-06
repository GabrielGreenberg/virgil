import { describe, expect, it } from "vitest";
import { SMART_PREFERENCES, type SmartPanelItem } from "../smart-preferences";
import {
  PANEL_THEME_FAMILIES,
  SYSTEM_THEME_KEYS,
  type PanelThemeKey,
} from "../panel-theme";

// Task 977: the Preferences "Panel theme" section was a hand list of eight that
// omitted highlight, example and report. Its rows must be exactly the
// user-overridable union of PANEL_THEME_FAMILIES.
describe("smart preferences — Panel theme section", () => {
  const section = SMART_PREFERENCES.find((s) => s.id === "panel-theme")!;
  const keys = section.items
    .filter((i): i is SmartPanelItem => i.kind === "panel-color")
    .map((i) => i.panelKey);

  it("lists every overridable theme key exactly once", () => {
    const expected = Object.values(PANEL_THEME_FAMILIES)
      .flatMap((f) => f.keys as readonly PanelThemeKey[])
      .filter((k) => !SYSTEM_THEME_KEYS.has(k));
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual([...expected].sort());
    for (const k of ["highlight", "example", "report"] as const) {
      expect(keys).toContain(k);
    }
  });

  it("never offers a system (non-overridable) key", () => {
    for (const k of keys) expect(SYSTEM_THEME_KEYS.has(k)).toBe(false);
  });

  it("gives every row a non-empty label", () => {
    for (const i of section.items as SmartPanelItem[]) expect(i.label.trim()).not.toBe("");
  });
});
