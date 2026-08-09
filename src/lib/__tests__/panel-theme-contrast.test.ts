/**
 * The contrast contract for derived palettes (task 176).
 *
 * The palette derives every value from ONE accent hex, which is the good part
 * of the design — and the reason nobody noticed that two of its transforms
 * reasoned in HSL lightness, a hue-blind coordinate, as a stand-in for
 * perceived contrast. Shipped result: badge/title text below AA on 5 of 13
 * accents and 7 of 14 picker presets (teal at 2.22:1), and a selected-card
 * border whose strength varied 1.36:1 → 5.62:1 across kinds for no reason a
 * user could name.
 *
 * This is the guard that stops the next preset from being added by eye. It runs
 * over BOTH color tables, because either one is a door: `DEFAULT_PANEL_COLORS`
 * is what ships, `PRESET_COLORS` is what a user can pick.
 *
 * The WCAG math here is deliberately a SECOND, independent implementation
 * rather than an import from `color-math`. A guard that measures with the very
 * helper it is guarding proves only self-consistency: a wrong luminance formula
 * would make the derivation and the assertion wrong in exactly the same
 * direction, and CI would stay green. The oracle is pinned against known ratios
 * below so "independent" cannot mean "quietly broken".
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_PANEL_COLORS,
  PRESET_COLORS,
  deriveCardPalette,
  deriveMarkerPalette,
  accentInk,
  TEXT_CONTRAST_MIN,
  AFFORDANCE_CONTRAST_TARGET,
  type PanelThemeKey,
} from "../panel-theme";

/* ── Independent WCAG 2.x oracle ─────────────────────────────────── */

function channels(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a solid hex: ${hex}`);
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  return la > lb ? (la + 0.05) / (lb + 0.05) : (lb + 0.05) / (la + 0.05);
}

/** Float slack only — the derivation measures the SAME quantized hex this
 *  oracle does, so a real miss is never within 1e-6 of the floor. */
const EPS = 1e-6;

/** The page surface a card border sits on (`--surface`, globals.css). */
const SURFACE = "#ffffff";

const ALL_ACCENTS: [string, string][] = [
  ...(Object.keys(DEFAULT_PANEL_COLORS) as PanelThemeKey[]).map(
    (k) => [`default:${k}`, DEFAULT_PANEL_COLORS[k]] as [string, string],
  ),
  ...PRESET_COLORS.map((p) => [`preset:${p.name}`, p.hex] as [string, string]),
];

describe("contrast oracle (self-check)", () => {
  it("reproduces the WCAG reference ratios", () => {
    expect(ratio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(ratio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(ratio("#767676", "#ffffff")).toBeGreaterThanOrEqual(4.5); // the canonical AA grey
    expect(ratio("#777777", "#ffffff")).toBeLessThan(4.5);           // one step lighter fails
    expect(ratio("#ffffff", "#000000")).toBeCloseTo(21, 5);          // symmetric
  });

  it("would have failed on the pre-fix values", () => {
    // The two worst shipped cases, verbatim from the pre-176 derivation: teal
    // passed straight through `readableOnWhite`'s `l < 0.45` branch onto its
    // own badgeBg (`tint("#14b8a6", 0.88)` = #e3f6f4), and
    // `atLightness("#0d9488", 0.62)` produced a near-invisible selection border.
    expect(ratio("#14b8a6", "#e3f6f4")).toBeLessThan(TEXT_CONTRAST_MIN); // 2.22:1
    expect(ratio("#4defe1", SURFACE)).toBeLessThan(2);                   // 1.42:1
  });
});

describe("badge / title ink clears AA on every surface it lands on", () => {
  it.each(ALL_ACCENTS)("%s", (_name, accent) => {
    const card = deriveCardPalette(accent);
    const marker = deriveMarkerPalette(accent);

    // ONE ink across the card badge, the card title and the marginalia glyph.
    expect(card.badgeColor).toBe(accentInk(accent));
    expect(card.titleColor).toBe(card.badgeColor);
    expect(marker.color).toBe(card.badgeColor);

    // Every surface that ink can land on. 10px badges and ~12.5px/500 titles
    // are normal-size text — no large-text exemption applies.
    for (const bg of [card.badgeBg, card.headerSelected, card.headerDefault, marker.bg, SURFACE]) {
      expect(ratio(card.badgeColor, bg)).toBeGreaterThanOrEqual(TEXT_CONTRAST_MIN - EPS);
    }
  });

  it("keeps the ink's hue — it darkens the accent, it does not grey it out", () => {
    // A contrast floor met by collapsing every accent to near-black would pass
    // the assertions above and destroy the one-accent-per-kind design.
    const inks = new Set(ALL_ACCENTS.map(([, hex]) => accentInk(hex)));
    expect(inks.size).toBeGreaterThanOrEqual(10);
    // A genuinely dark accent is already its own ink (no gratuitous darkening).
    expect(accentInk(DEFAULT_PANEL_COLORS.todo)).toBe(DEFAULT_PANEL_COLORS.todo);
  });
});

describe("borderSelected is one affordance strength, not one lightness coordinate", () => {
  const ratios = ALL_ACCENTS.map(
    ([name, hex]) => [name, ratio(deriveCardPalette(hex).borderSelected, SURFACE)] as const,
  );

  it.each(ratios)("%s sits at the affordance target", (_name, r) => {
    // The target is a FLOOR (WCAG 1.4.11), so the low side is exact — a
    // one-sided band is what gives this leg teeth. The upside allowance is 8-bit
    // quantization only: the measured worst overshoot is ~2.5%.
    expect(r).toBeGreaterThanOrEqual(AFFORDANCE_CONTRAST_TARGET - EPS);
    expect(r).toBeLessThan(AFFORDANCE_CONTRAST_TARGET * 1.05);
  });

  it("every kind's selected border reads at the same strength", () => {
    // The pre-fix spread was 4.1x (1.36:1 olive → 5.62:1 report). This bound is
    // deliberately tighter than the ±5% band above implies, so it can still
    // fail on a dispersion regression that stays inside the band.
    const values = ratios.map(([, r]) => r);
    expect(Math.max(...values) / Math.min(...values)).toBeLessThan(1.05);
  });
});

/* ── The domain leg ──────────────────────────────────────────────────
 *
 * The census above is 27 hexes; the ACCENT DOMAIN is every value the color
 * picker's `<input type="color">` can emit (`PreferenceModePicker` →
 * `setPanelColor`, which accepts any `#rrggbb`). A guard that only measures the
 * shipped table cannot tell this fix from the bug it replaced: substituting the
 * literal bug shape — `accentInk = (h) => withLightness(h, 0.25)`, a bare
 * hue-blind lightness coordinate — clears every assertion above, because on
 * those 27 hexes it happens to land safely. It does not on the domain, which is
 * why this leg exists: it is the one that catches the ORIGINAL shape.
 */
describe("the contract holds across the whole accent domain, not just the shipped table", () => {
  /** A deterministic sweep: an even RGB grid plus an LCG scatter, so the set is
   *  reproducible run to run (a flaky guard is a guard people delete). */
  function domainAccents(): string[] {
    const out: string[] = [];
    for (let r = 0; r < 256; r += 51)
      for (let g = 0; g < 256; g += 51)
        for (let b = 0; b < 256; b += 51)
          out.push(`#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`);
    let seed = 0x176c0107;
    for (let i = 0; i < 1200; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      out.push(`#${(seed >>> 8).toString(16).padStart(6, "0").slice(-6)}`);
    }
    return out;
  }

  const ACCENTS = domainAccents();

  it("every accent's ink clears AA on every surface that accent paints", () => {
    const failures: string[] = [];
    for (const accent of ACCENTS) {
      const card = deriveCardPalette(accent);
      const marker = deriveMarkerPalette(accent);
      for (const bg of [card.badgeBg, card.headerSelected, card.headerDefault, marker.bg, SURFACE]) {
        const r = ratio(card.badgeColor, bg);
        if (r < TEXT_CONTRAST_MIN - EPS) failures.push(`${accent} ink ${card.badgeColor} on ${bg} = ${r.toFixed(3)}`);
      }
    }
    expect(failures.slice(0, 8)).toEqual([]);
  });

  it("every accent's selected border meets the affordance floor", () => {
    const failures: string[] = [];
    for (const accent of ACCENTS) {
      const r = ratio(deriveCardPalette(accent).borderSelected, SURFACE);
      if (r < AFFORDANCE_CONTRAST_TARGET - EPS || r >= AFFORDANCE_CONTRAST_TARGET * 1.05) {
        failures.push(`${accent} border = ${r.toFixed(3)}`);
      }
    }
    expect(failures.slice(0, 8)).toEqual([]);
  });

  it("the sweep is not vacuous", () => {
    expect(ACCENTS.length).toBeGreaterThan(1000);
    // …and neither is the census it complements: a silently shrunk preset list
    // would quietly shrink the table half of this guard.
    expect(PRESET_COLORS.length).toBe(14);
    expect(ALL_ACCENTS.length).toBe(27);
  });
});

describe("derivation is memoized by accent", () => {
  it("returns a stable identity for the same hex", () => {
    // `useCardTheme` re-derives on every render of every card; the contrast
    // search must not run there, and consumers memoizing by reference must not
    // see a new object each time.
    expect(deriveCardPalette("#3b82f6")).toBe(deriveCardPalette("#3b82f6"));
    expect(deriveMarkerPalette("#3b82f6")).toBe(deriveMarkerPalette("#3b82f6"));
    expect(deriveCardPalette("#3b82f6")).not.toBe(deriveCardPalette("#9333ea"));
  });
});
