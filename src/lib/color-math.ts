/**
 * Color math — the ONE home for hex/RGB/HSL conversion and, more importantly,
 * for the two questions a derived palette actually asks: *how bright does this
 * read?* and *what does it take to read legibly on that?*
 *
 * ## Why this file exists
 *
 * HSL **lightness is not a measure of perceived contrast.** It is hue-blind:
 * `hsl(…, 0.40)` says nothing about how bright a color reads, and the error is
 * largest exactly where a palette offers its most saturated hues (a teal at
 * `l = 0.40` reads far brighter than a red at the same coordinate). Any rule of
 * the form "if lightness is below X it's dark enough" or "put the border at
 * lightness Y" is therefore a *coordinate standing in for a perceptual
 * quantity it does not measure* — the bug class task 176 retired from
 * `panel-theme.ts`, where it had left badge/title text below AA on 5 shipped
 * accents and 7 of 14 picker presets, and made the "this card is selected"
 * border vary more than 4x in strength across kinds.
 *
 * So: **state the contrast you want, and search for it.** `inkOn` and
 * `atContrastAgainst` below take a target ratio and a real destination surface,
 * preserve the accent's hue and saturation, and move only lightness — which is
 * still the right *dial*, just not the right *measurement*.
 *
 * Everything here is pure and dependency-free (no DOM, no storage), so it is
 * safe to import from anywhere, including module-eval-time palette folds.
 */

/* ── Conversion primitives ───────────────────────────────────────── */

/** Parse a `#rrggbb` hex to `[r, g, b]` in 0..255. Returns [0,0,0] on error. */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return [h, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  if (s === 0) {
    const v = l * 255;
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const k = (n: number) => {
    const t = (h / 60 + n + 6) % 6;
    if (t < 1) return p + (q - p) * t;
    if (t < 3) return q;
    if (t < 4) return p + (q - p) * (4 - t);
    return p;
  };
  return [k(2) * 255, k(0) * 255, k(4) * 255];
}

/** `hex` with its lightness replaced, hue and saturation carried through.
 *  A *dial*, not a contrast decision — see the file header. Callers that want
 *  a legibility guarantee use `inkOn` / `atContrastAgainst` instead. */
export function withLightness(hex: string, targetL: number): string {
  const [r, g, b] = hexToRgb(hex);
  const [h, s] = rgbToHsl(r, g, b);
  const [r2, g2, b2] = hslToRgb(h, s, targetL);
  return rgbToHex(r2, g2, b2);
}

/** Lightness of `hex` in 0..1 (the HSL coordinate — again, not a contrast). */
export function lightnessOf(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHsl(r, g, b)[2];
}

/* ── Perceptual measurements (WCAG 2.x) ──────────────────────────── */

/** WCAG 2.x relative luminance of `hex`, 0 (black) .. 1 (white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two solid hexes, 1..21. Symmetric. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** The darkest (lowest-luminance) member of a surface list. The destination a
 *  single ink has to satisfy when it lands on several surfaces: clear the
 *  darkest and every lighter one follows. */
export function darkestSurface(surfaces: readonly string[]): string {
  return surfaces.reduce((a, b) => (relativeLuminance(a) <= relativeLuminance(b) ? a : b));
}

/* ── Contrast-targeted search ────────────────────────────────────── */

/** Lightness resolution of the search. The output is an 8-bit hex, so finer
 *  steps buy nothing; a coarser grid can only overshoot the target (never
 *  undershoot it), since every candidate is measured on the color it actually
 *  emits. */
const LIGHTNESS_STEPS = 256;

/**
 * The accent, moved along its own lightness axis only as far as legibility
 * requires: the candidate whose contrast against the darkest of `surfaces`
 * reaches `minRatio` while staying closest to the accent's own lightness.
 * Hue and saturation are carried through untouched, so the ink still reads as
 * the kind's color.
 *
 * Returns `hex` verbatim when the accent already clears the target — a genuinely
 * dark accent is its own ink, which is what the old `l < 0.45` passthrough was
 * reaching for and got wrong for saturated hues.
 *
 * If no lightness can reach the target (only possible against a mid-luminance
 * surface, where every candidate sits near the background's own brightness),
 * returns the highest-contrast candidate rather than a value that quietly
 * fails: the best available answer, never a false claim of legibility.
 */
export function inkOn(hex: string, surfaces: readonly string[], minRatio: number): string {
  const bg = darkestSurface(surfaces);
  if (contrastRatio(hex, bg) >= minRatio) return hex;
  const l0 = lightnessOf(hex);
  let best: string | null = null;
  let bestDistance = Infinity;
  let fallback = hex;
  let fallbackRatio = -1;
  for (let i = 0; i <= LIGHTNESS_STEPS; i++) {
    const l = i / LIGHTNESS_STEPS;
    const candidate = withLightness(hex, l);
    const ratio = contrastRatio(candidate, bg);
    if (ratio > fallbackRatio) { fallbackRatio = ratio; fallback = candidate; }
    if (ratio >= minRatio) {
      const distance = Math.abs(l - l0);
      if (distance < bestDistance) { bestDistance = distance; best = candidate; }
    }
  }
  return best ?? fallback;
}

/**
 * The accent moved to a *contrast target* against `bg` rather than to an
 * absolute lightness coordinate: the candidate that MEETS `targetRatio` and
 * exceeds it by the least, ties broken toward the accent's own lightness.
 *
 * This is the transform a non-text affordance wants (a selection border, a
 * rule) — it both lightens accents that are too dark and darkens accents that
 * are too light, so the same affordance reads with the same strength for every
 * kind. `withLightness(accent, 0.62)` could not: an absolute coordinate makes
 * the strength a function of the hue that happens to be in the picker.
 *
 * The target is a **floor**, not a nearest-value: a symmetric
 * `|ratio − target|` search picks 2.98 over 3.01 whenever 2.98 is the nearer
 * 1/256 step, which for a 3:1 target lands *below* WCAG 1.4.11 for about half
 * the accent space — a claim the caller cannot honestly make while the code
 * rounds the other way. Meeting the floor costs at most one lightness step.
 * Same shape as `inkOn`: admit only what passes, then move as little as
 * possible. Falls back to the highest-contrast candidate if nothing reaches
 * the target (impossible for any real surface, since `l = 0` is black).
 */
export function atContrastAgainst(hex: string, bg: string, targetRatio: number): string {
  const l0 = lightnessOf(hex);
  let best: string | null = null;
  let bestExcess = Infinity;
  let bestDistance = Infinity;
  let fallback = hex;
  let fallbackRatio = -1;
  for (let i = 0; i <= LIGHTNESS_STEPS; i++) {
    const l = i / LIGHTNESS_STEPS;
    const candidate = withLightness(hex, l);
    const ratio = contrastRatio(candidate, bg);
    if (ratio > fallbackRatio) { fallbackRatio = ratio; fallback = candidate; }
    if (ratio < targetRatio) continue;
    const excess = ratio - targetRatio;
    const distance = Math.abs(l - l0);
    if (excess < bestExcess - 1e-9 || (Math.abs(excess - bestExcess) <= 1e-9 && distance < bestDistance)) {
      bestExcess = excess;
      bestDistance = distance;
      best = candidate;
    }
  }
  return best ?? fallback;
}
