import { describe, it, expect } from "vitest";
import {
  DEFAULT_PANEL_TYPOGRAPHY,
  BODY_CLASS_TYPOGRAPHY,
  type PanelBodyKey,
} from "@/lib/panel-typography";
import { CARD_REGISTRY } from "@/cards/card-registry";

/**
 * A9 §C2: `DEFAULT_PANEL_TYPOGRAPHY` is DERIVED from `CardMeta.bodyClass`,
 * not hand-kept. This pins the two ratified fixes and the panel-consistency
 * invariant so the declared appearance class and the rendered default can
 * never silently drift.
 */
describe("DEFAULT_PANEL_TYPOGRAPHY is derived from CardMeta.bodyClass", () => {
  it("the two visual tiers are 15px Source Serif 4 (borrowed) and 12px Inter (sans)", () => {
    expect(BODY_CLASS_TYPOGRAPHY.borrowed).toEqual({
      fontFamily: "Source Serif 4",
      fontSize: 15,
      color: "#44403c",
    });
    expect(BODY_CLASS_TYPOGRAPHY.sans).toEqual({
      fontFamily: "Inter",
      fontSize: 12,
      color: "#44403c",
    });
  });

  it("example renders 15px Source Serif 4 (was 12 — the C2 fix)", () => {
    expect(CARD_REGISTRY.example.bodyClass).toBe("borrowed");
    expect(DEFAULT_PANEL_TYPOGRAPHY.example).toEqual(BODY_CLASS_TYPOGRAPHY.borrowed);
    expect(DEFAULT_PANEL_TYPOGRAPHY.example.fontSize).toBe(15);
  });

  it("report renders 12px Inter (R11 — Report is apparatus/sans)", () => {
    expect(CARD_REGISTRY.report.bodyClass).toBe("sans");
    expect(DEFAULT_PANEL_TYPOGRAPHY.report).toEqual(BODY_CLASS_TYPOGRAPHY.sans);
    expect(DEFAULT_PANEL_TYPOGRAPHY.report.fontFamily).toBe("Inter");
  });

  it("footnotes + archive stay 15px serif (borrowed)", () => {
    expect(CARD_REGISTRY.footnote.bodyClass).toBe("borrowed");
    expect(CARD_REGISTRY.archive.bodyClass).toBe("borrowed");
    expect(DEFAULT_PANEL_TYPOGRAPHY.footnote.fontSize).toBe(15);
    expect(DEFAULT_PANEL_TYPOGRAPHY.archive.fontSize).toBe(15);
  });

  it("every panel-body row matches its primary kind's declared class", () => {
    const cases: Array<[PanelBodyKey, "borrowed" | "sans"]> = [
      ["footnote", "borrowed"],
      ["note", "sans"],
      ["archive", "borrowed"],
      ["cut", "sans"],
      ["revision", "sans"],
      ["citation", "sans"],
      ["bib", "sans"],
      ["todo", "sans"],
      ["report", "sans"],
      ["example", "borrowed"],
    ];
    for (const [key, cls] of cases) {
      expect(DEFAULT_PANEL_TYPOGRAPHY[key]).toEqual(BODY_CLASS_TYPOGRAPHY[cls]);
    }
  });

  it("morph siblings share a bodyClass (the per-panel derivation is faithful)", () => {
    // A morph that flipped the rendered typography would be a bug; pin the
    // 4 pairs agree on their class.
    const pairs = [
      ["note", "highlight"],
      ["revision-comment", "revision-suggestion"],
      ["cutter-comment", "cutter-suggestion"],
      ["report", "report-request"],
    ] as const;
    for (const [a, b] of pairs) {
      expect(CARD_REGISTRY[a].bodyClass).toBe(CARD_REGISTRY[b].bodyClass);
    }
  });
});
