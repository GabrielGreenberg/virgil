// Task 1179 — ONE selection halo, worn by the margin marker AND its card.
//
// The marker and the card present the same selection (the store's one
// `selected {kind,id}`), so they wear the same ring: `selectionHaloRing`, the
// only spelling. Two legs:
//   1. PARITY — for several card kinds, the selected card's inline box-shadow
//      carries exactly the ring the marker paints (the marker's own border
//      tint of the kind's accent), on by default, with the ambient lift kept.
//   2. CENSUS — no production .ts/.tsx outside panel-theme.ts hand-spells a
//      `0 0 0 1.5px` ring (a second spelling is how marker and card drift).

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { strip, walkFiles } from "@/lib/__tests__/_source-scan";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { selectionHaloRing, DEFAULT_PANEL_COLORS, type PanelThemeKey } from "@/lib/panel-theme";
import { themedCardStyle, CARD_THEMES } from "@/components/panel-primitives";
import { MARKER_META } from "@/lib/marginalia";
import { panelThemeKeyForMarkerType } from "@/cards/marker-meta";

const SRC = path.resolve(__dirname, "../..");

describe("selection halo — marker/card parity", () => {
  const MARKERS = ["note", "todo", "revision", "cut", "report"] as const;

  it.each(MARKERS)("%s: the card's selected ring IS the marker's ring", (type) => {
    const key = panelThemeKeyForMarkerType(type as never) as PanelThemeKey;
    const theme = CARD_THEMES[key];
    const ring = selectionHaloRing(theme.accent);
    // The marker's ring tint is its own badge border.
    expect(ring).toBe(`0 0 0 1.5px ${MARKER_META[type as keyof typeof MARKER_META].border}`);
    const style = themedCardStyle(theme, true);
    expect(String(style.boxShadow)).toContain(ring);
    expect(String(style.boxShadow)).toContain("var(--card-shadow-ambient)");
  });

  it("the halo is selection-only and default-on (no pref gate)", () => {
    const theme = CARD_THEMES.note;
    expect(String(themedCardStyle(theme, false).boxShadow)).toBe("var(--card-shadow-ambient)");
    expect(String(themedCardStyle(theme, true).boxShadow)).toBe(
      `${selectionHaloRing(theme.accent)}, var(--card-shadow-ambient)`,
    );
  });

  it("composes UNDER the drop-target ring, never replacing it", () => {
    const theme = CARD_THEMES.todo;
    const shadow = String(themedCardStyle(theme, true, { dropTarget: true }).boxShadow);
    expect(shadow.indexOf("--ring-drag-target")).toBeLessThan(
      shadow.indexOf(selectionHaloRing(theme.accent)),
    );
  });

  it("a kind-less row (theme null) has no accent to ring with", () => {
    expect(String(themedCardStyle(null, true).boxShadow)).toBe("var(--card-shadow-ambient)");
  });

  it("follows a user colour override (derived from the accent, not baked)", () => {
    const other = DEFAULT_PANEL_COLORS.todo;
    expect(selectionHaloRing(other)).not.toBe(selectionHaloRing(DEFAULT_PANEL_COLORS.note));
  });
});

describe("selection halo — census: one spelling of the ring", () => {
  const files = walkFiles(SRC).filter(
    (f) =>
      /\.tsx?$/.test(f) &&
      !f.includes(`${path.sep}__tests__${path.sep}`) &&
      !/\.test\.tsx?$/.test(f),
  );
  const RING = /0 0 0 1\.5px/;

  it("no production .ts/.tsx outside panel-theme.ts spells a 1.5px ring", () => {
    const offenders = files
      .filter((f) => RING.test(strip(readFileSync(f, "utf8"), true)))
      .map((f) => path.relative(SRC, f).split(path.sep).join("/"))
      .filter((f) => f !== "lib/panel-theme.ts");
    // A hit is MIGRATE-it (compose `selectionHaloRing`), never an allowlist.
    expect(offenders).toEqual([]);
  });

  it("the census sees a synthetic offender (comments stripped, strings kept)", () => {
    expect(RING.test(strip("// 0 0 0 1.5px prose", true))).toBe(false);
    expect(RING.test(strip("const r = `0 0 0 1.5px ${c}`;", true))).toBe(true);
  });

  it("scanned a plausible number of files", () => {
    expect(files.length).toBeGreaterThan(500);
  });
});
