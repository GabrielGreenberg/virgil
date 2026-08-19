/**
 * The Outline's parTitle ink clears AA at the density the Outline renders it
 * (task 2026-08-18-361, the residual task 284 recorded).
 *
 * 284 was right to retire the Outline's frozen `#857070` for the user
 * preference `--par-title-color` — the whole point being that a recolour in
 * Preferences should reach this panel. What it could not see is that the
 * Outline renders that ink at **11px / weight 400** where every other consumer
 * renders it at `--par-title-size` (12.5px) / weight 500, so the shipped
 * default crossed the AA line HERE and nowhere else: 4.55:1 (the old literal)
 * → 4.17:1 on `--pod-panel`.
 *
 * The fix is a derived rung, `--par-title-color-dense`, and what it needs
 * guarding is not the mix expression (that is one line in the sheet) but the
 * PROPERTY it exists to buy — which nothing else in CI measures:
 *
 *  - `panel-chrome-palette-guardrail` asks whether the panel reads the
 *    preference-backed token rather than a literal. A rung that tracks the
 *    preference and lands at 3:1 satisfies it exactly.
 *  - `phantom-css-var` asks whether a `var()` READ resolves to a definition.
 *  - `inert-preference-controls` asks whether a DEFINED token has a reader.
 *
 * None of them can see a contrast ratio, which is how the pre-284 literal and
 * then the post-284 token both sat under-measured. So this leg does the WCAG
 * arithmetic on the values the sheet actually ships.
 *
 * The oklab mix and the luminance formula are implemented here rather than
 * imported: jsdom does not evaluate `color-mix()`, and `color-math` has no
 * oklab rung at all. Both are pinned against known values below so
 * "independent" cannot quietly mean "wrong in the same direction".
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

const globals = readFileSync(
  join(process.cwd(), "src/app/globals.css"),
  "utf8",
);
const outline = readFileSync(
  join(process.cwd(), "src/panels/Outline/OutlinePanel.tsx"),
  "utf8",
);

/** AA for body text. The Outline's rows are 11px/400 — normal text, not large. */
const AA_NORMAL_TEXT = 4.5;

/* ── The values the sheet ships ──────────────────────────────────── */

/**
 * The LAST declaration wins, which matters: the PROMOTE-DEFAULTS block near
 * the bottom of `:root` re-declares several of these from the JSON sidecars,
 * and that copy is what the browser computes. Reading the first hit would
 * measure a value no user ever sees.
 */
function rootToken(name: string): string {
  const hits = [
    ...globals.matchAll(
      new RegExp(`^\\s*${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`, "gm"),
    ),
  ];
  if (hits.length === 0) throw new Error(`no solid hex declared for ${name}`);
  return hits[hits.length - 1][1].toLowerCase();
}

/* ── Independent sRGB / oklab / WCAG oracle ──────────────────────── */

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (c: number) => {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
};
function rgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a solid hex: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toOklab(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, A, B]: [number, number, number]): string {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const out = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(toSrgb);
  return `#${out.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** `color-mix(in oklab, a <pct>%, b)`. */
function mixOklab(a: string, b: string, pct: number): string {
  const [la, lb] = [toOklab(a), toOklab(b)];
  const p = pct / 100;
  return fromOklab([0, 1, 2].map((i) => la[i] * p + lb[i] * (1 - p)) as [
    number,
    number,
    number,
  ]);
}

const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Perceptual distance in oklab — how far a recolour actually travels. */
function distance(a: string, b: string): number {
  const [la, lb] = [toOklab(a), toOklab(b)];
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

describe("the oracle", () => {
  it("agrees with WCAG's own reference ratios", () => {
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  it("round-trips a colour through oklab", () => {
    for (const hex of ["#c45a5a", "#44403c", "#fffdfa", "#3b82f6"]) {
      expect(fromOklab(toOklab(hex))).toBe(hex);
    }
  });

  it("mixes the endpoints it is given", () => {
    expect(mixOklab("#c45a5a", "#44403c", 100)).toBe("#c45a5a");
    expect(mixOklab("#c45a5a", "#44403c", 0)).toBe("#44403c");
  });
});

/* ── The contract ────────────────────────────────────────────────── */

describe("--par-title-color-dense", () => {
  const PANEL = () => rootToken("--pod-panel");
  const PREF = () => rootToken("--par-title-color");
  const INK = () => rootToken("--ink-body");

  /** The mix percentage, read from the sheet rather than restated here. */
  function declaredMix(): { pct: number; toward: string } {
    const m =
      /--par-title-color-dense:\s*color-mix\(\s*in oklab\s*,\s*var\(--par-title-color\)\s*(\d+(?:\.\d+)?)%\s*,\s*var\((--[a-z-]+)\)\s*\)/.exec(
        globals,
      );
    if (!m) throw new Error("--par-title-color-dense is not an oklab mix of --par-title-color");
    return { pct: Number(m[1]), toward: m[2] };
  }

  it("is derived from the PREFERENCE, so a recolour still reaches the Outline", () => {
    const { toward } = declaredMix();
    expect(toward).toBe("--ink-body");
    // Two different preference values must produce two different rungs — the
    // property a frozen literal (pre-284) would fail, and a 0% mix would too.
    const { pct } = declaredMix();
    expect(mixOklab(PREF(), INK(), pct)).not.toBe(mixOklab("#2f8f8f", INK(), pct));
  });

  it("clears AA on --pod-panel at the shipped default", () => {
    const { pct } = declaredMix();
    const rung = mixOklab(PREF(), INK(), pct);
    expect(contrast(rung, PANEL())).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it("is the DEFECT leg: the bare preference does NOT clear AA there", () => {
    // If this ever stops failing, the preference default moved and the rung
    // may no longer be earning its keep — a reason to re-measure, not to
    // delete the leg silently.
    expect(contrast(PREF(), PANEL())).toBeLessThan(AA_NORMAL_TEXT);
  });

  it("keeps real headroom, not a rounding step", () => {
    const { pct } = declaredMix();
    const ratio = contrast(mixOklab(PREF(), INK(), pct), PANEL());
    // 90% lands at 4.55 — over the line by less than a rounding step. The
    // shipped 85% lands at 4.76. Anything under this floor is the thin-margin
    // shape the token's own comment argues against.
    expect(ratio).toBeGreaterThanOrEqual(4.6);
  });

  it("still tracks a recolour visibly — it does not freeze the preference", () => {
    const { pct } = declaredMix();
    // A recolour travels ≥80% as far after the mix as before it. A low mix
    // would clear AA by making every user colour look the same; that is the
    // objection recorded against the muted-mix option in task 284.
    const full = distance(PREF(), "#2f8f8f");
    const mixed = distance(mixOklab(PREF(), INK(), pct), mixOklab("#2f8f8f", INK(), pct));
    expect(mixed / full).toBeGreaterThanOrEqual(0.8);
  });

  it("is a STATED limit, not a claim to rescue every colour", () => {
    // A pale user ink is under AA at any mix that leaves its hue recognisable.
    // The rung tracks the user's choice rather than overriding it; the token's
    // comment says so, and this pins that the claim is scoped to the default.
    const { pct } = declaredMix();
    expect(contrast(mixOklab("#f0a0a0", INK(), pct), PANEL())).toBeLessThan(
      AA_NORMAL_TEXT,
    );
  });
});

describe("census: the Outline reads the rung, nothing else has to", () => {
  it("every parTitle site in the Outline takes the dense rung", () => {
    expect(outline).toContain("text-[var(--par-title-color-dense,#b05756)]");
    // The bare token would be the pre-361 under-AA spelling.
    expect(outline).not.toContain("text-[var(--par-title-color,#c45a5a)]");
  });

  it("the 11px/400 density the rung exists for is still what renders", () => {
    // If the rows ever move to the family's 12.5px/500, the rung's premise is
    // gone and the plain token should come back (resolution (1) in the 284
    // memo). Pin the premise so that is a decision rather than a drift.
    const sites = outline.match(
      /text-\[11px\][^"`]*text-\[var\(--par-title-color-dense/g,
    );
    expect(sites?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("the 12.5px consumers keep the bare preference", () => {
    // The rung is the DENSE context's answer only. Its siblings must not
    // inherit a darkening they do not need.
    for (const rule of [
      ".par-title-annotation",
      ".card-title-input",
      ".par-title-input",
    ]) {
      const body = new RegExp(`\\${rule}[^{]*\\{([^}]*)\\}`).exec(globals)?.[1];
      expect(body, `${rule} not found`).toBeTruthy();
      expect(body).not.toContain("--par-title-color-dense");
    }
  });
});
