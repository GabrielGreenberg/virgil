// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_PANEL_TYPOGRAPHY,
  getPanelDefault,
  getPanelTypography,
  getPanelTypographyOverrides,
  isPanelTypographyFieldOverridden,
  setTierBaseFontSizes,
  setPanelTypographyField,
  clearPanelTypographyField,
  type PanelBodyKey,
} from "@/lib/panel-typography";
import PanelTextSize from "@/components/PanelTextSizeRow";
import FontsDialog from "@/components/FontsDialog";
import { DEFAULT_PREFS } from "@/hooks/usePreferences";

vi.mock("@/lib/storage", () => ({}));

const STORAGE_KEY = "virgil-panel-typography";

function resetTypography() {
  setTierBaseFontSizes(NaN, NaN);
  for (const k of Object.keys(DEFAULT_PANEL_TYPOGRAPHY) as PanelBodyKey[]) {
    clearPanelTypographyField(k, "fontSize");
    clearPanelTypographyField(k, "fontFamily");
    clearPanelTypographyField(k, "color");
  }
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Task 626 — **snap-to-clear belongs to the one door that writes**.
 *
 * `BUG #30` made an un-overridden panel body's size DOC-RELATIVE: with no
 * `fontSize` override, footnotes track the document's body size. The rule that
 * protects that — "a value equal to the live default is not an override, so
 * don't store it" — used to live in ONE prefs surface (`SmartPreferences`), so
 * the Fonts… dialog and the per-panel three-dots stepper each wrote a pin that
 * looked identical today and silently froze the panel tomorrow. Stepping
 * 13 → 14 → 13 in the Fonts… dialog left footnotes locked at 13px.
 *
 * The rule now lives in `setPanelTypographyField`, so every door inherits it by
 * construction.
 */
describe("snap-to-clear lives in the store door, not the call sites", () => {
  afterEach(() => {
    cleanup();
    resetTypography();
  });

  it("away-and-back leaves NO stored override (the reported 13 → 14 → 13)", () => {
    setTierBaseFontSizes(15 - 2, 13); // borrowed base 13px

    setPanelTypographyField("footnote", "fontSize", 14);
    expect(getPanelTypographyOverrides("footnote")).toEqual({ fontSize: 14 });

    setPanelTypographyField("footnote", "fontSize", 13); // back to the default
    expect(getPanelTypographyOverrides("footnote")).toEqual({});
    expect(isPanelTypographyFieldOverridden("footnote", "fontSize")).toBe(false);
  });

  it("…and the panel then FOLLOWS a later change of the document's body size", () => {
    setTierBaseFontSizes(15 - 2, 13);
    setPanelTypographyField("footnote", "fontSize", 14);
    setPanelTypographyField("footnote", "fontSize", 13);

    // The user later enlarges the document: 1.25rem → 20px body → 18px borrowed.
    setTierBaseFontSizes(20 - 2, 16);
    expect(getPanelTypography("footnote").fontSize).toBe(18);
  });

  it("the pre-fix shape is exactly what fails: a stored-at-default value pins", () => {
    // Teeth check — this is what the old always-store door produced.
    setTierBaseFontSizes(15 - 2, 13);
    // Simulate the old behaviour by writing a value the door would now clear,
    // via a value that is NOT the default and then moving the base onto it.
    setPanelTypographyField("footnote", "fontSize", 13 + 1);
    setTierBaseFontSizes(20 - 2, 16);
    expect(getPanelTypography("footnote").fontSize).toBe(14); // pinned, not 18
  });

  it("the storage blob loses the key too — nothing is persisted at the default", () => {
    setTierBaseFontSizes(15 - 2, 13);
    setPanelTypographyField("footnote", "fontSize", 14);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      footnote: { fontSize: 14 },
    });
    setPanelTypographyField("footnote", "fontSize", 13);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({});
  });

  it("clearing one field doesn't disturb a real override on a sibling field", () => {
    setTierBaseFontSizes(15 - 2, 13);
    setPanelTypographyField("footnote", "fontFamily", "Lora");
    setPanelTypographyField("footnote", "fontSize", 13); // at default → clear
    expect(getPanelTypographyOverrides("footnote")).toEqual({ fontFamily: "Lora" });
  });

  it("the rule covers family and color, not just size (color case-insensitively)", () => {
    const def = getPanelDefault("note");
    setPanelTypographyField("note", "fontFamily", def.fontFamily);
    setPanelTypographyField("note", "color", def.color.toUpperCase());
    expect(getPanelTypographyOverrides("note")).toEqual({});
  });

  it("a genuine override is still stored, and still beats the doc-relative base", () => {
    setTierBaseFontSizes(15 - 2, 13);
    setPanelTypographyField("footnote", "fontSize", 22);
    expect(getPanelTypography("footnote").fontSize).toBe(22);
    setTierBaseFontSizes(20 - 2, 16);
    expect(getPanelTypography("footnote").fontSize).toBe(22);
  });
});

/**
 * The is-overridden predicate answers about the LIVE default, not the frozen
 * `BODY_CLASS_TYPOGRAPHY` literal — the same frozen-literal mistake BUG #30
 * fixed for the rendered size.
 */
describe("isPanelTypographyFieldOverridden compares against the live default", () => {
  afterEach(resetTypography);

  it("a stored 15px while the borrowed base is 13px IS an override", () => {
    setTierBaseFontSizes(15 - 2, 13);
    setPanelTypographyField("footnote", "fontSize", 15); // == the frozen literal
    expect(getPanelTypographyOverrides("footnote")).toEqual({ fontSize: 15 });
    expect(isPanelTypographyFieldOverridden("footnote", "fontSize")).toBe(true);
  });

  it("…and stops being one once the base itself moves onto that value", () => {
    setTierBaseFontSizes(15 - 2, 13);
    setPanelTypographyField("footnote", "fontSize", 15);
    setTierBaseFontSizes(17 - 2, 13); // borrowed base is now 15
    expect(isPanelTypographyFieldOverridden("footnote", "fontSize")).toBe(false);
  });
});

/**
 * The UI doors. There are three; none of them may carry its own copy of the
 * rule, and a fourth appearing must land in this list deliberately.
 */
describe("every UI door inherits the rule", () => {
  afterEach(() => {
    cleanup();
    resetTypography();
  });

  it("the per-panel three-dots stepper: typing the default clears the pin", () => {
    setTierBaseFontSizes(15 - 2, 13);
    setPanelTypographyField("footnote", "fontSize", 14);
    render(<PanelTextSize panelKey="footnote" />);
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "13" } });
    expect(getPanelTypographyOverrides("footnote")).toEqual({});
  });

  it("the Fonts… dialog: stepping footnote size away and back leaves no pin", () => {
    setTierBaseFontSizes(15 - 2, 13); // footnote default 13px
    render(
      <FontsDialog open onClose={() => {}} prefs={DEFAULT_PREFS} onUpdate={() => {}} />,
    );
    const card = screen.getByText("Footnotes").closest("div")!.parentElement!;
    const larger = within(card).getByLabelText("Larger");
    const smaller = within(card).getByLabelText("Smaller");

    fireEvent.click(larger);
    expect(getPanelTypographyOverrides("footnote")).toEqual({ fontSize: 14 });

    fireEvent.click(smaller);
    expect(getPanelTypographyOverrides("footnote")).toEqual({});
    expect(isPanelTypographyFieldOverridden("footnote", "fontSize")).toBe(false);

    // And the panel tracks the document again.
    setTierBaseFontSizes(20 - 2, 16);
    expect(getPanelTypography("footnote").fontSize).toBe(18);
  });

  it("census: exactly three production files write a typography override", () => {
    const root = path.resolve(__dirname, "../..");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === "__tests__" || e.name === "node_modules") continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && p !== path.join(root, "lib/panel-typography.ts")) {
          if (fs.readFileSync(p, "utf8").includes("setPanelTypographyField")) {
            hits.push(path.relative(root, p));
          }
        }
      }
    };
    walk(root);
    expect(hits.sort()).toEqual([
      "components/FontsDialog.tsx",
      "components/PanelTextSizeRow.tsx",
      "components/SmartPreferences.tsx",
    ]);
  });

  it("census: no door re-implements the at-default comparison", () => {
    const root = path.resolve(__dirname, "../..");
    for (const f of [
      "components/FontsDialog.tsx",
      "components/PanelTextSizeRow.tsx",
      "components/SmartPreferences.tsx",
    ]) {
      const src = fs.readFileSync(path.join(root, f), "utf8");
      // A per-door rule looks like `if (value === def[field]) clear…`. The one
      // legitimate `clearPanelTypographyField` use left in a door is a RESET
      // (an explicit user gesture), which is never guarded by a comparison.
      const guarded = /(===|!==)[^\n;]*\n?[^\n;]*clearPanelTypographyField/.test(src);
      expect(guarded, `${f} carries its own snap-to-clear`).toBe(false);
    }
  });
});
