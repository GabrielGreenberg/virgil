import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/color-math";
import {
  AMBER_ATTENTION_CALLOUT,
  AMBER_ATTENTION_INK,
  AMBER_PENDING_CHIP,
} from "@/panels/_shared/amber-attention";

/**
 * AMBER ATTENTION INK — every text ink clears WCAG AA on its wash (task 1535).
 *
 * The amber "attention" family (`@/panels/_shared/amber-attention`) carries
 * reading text: the bib edit warning, the "Requested" chip, the Annotations
 * label. Its ink was `--amber-600`, which measures 3.03:1 on `--amber-50` —
 * under AA, unseen because, unlike the destructive-red, affirmative-green and
 * bib-state-tone families, amber had no contrast leg. This is that leg.
 *
 * It resolves the tokens from `globals.css` (following `var()` aliases) and
 * measures every `text-[var(--…)]` ink each exported class string names —
 * including `hover:` rungs — against every wash the family paints text on.
 * A new export or a retargeted ink is measured automatically.
 */

const ROOT = path.resolve(__dirname, "..", "..");
const globals = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");

function resolveToken(name: string, depth = 0): string {
  const m = globals.match(new RegExp(`^\\s*--${name}:\\s*([^;]+);`, "m"));
  if (!m) throw new Error(`--${name} is not defined in globals.css`);
  const value = m[1].trim();
  const alias = value.match(/^var\(--([\w-]+)\)$/);
  if (alias) {
    if (depth > 8) throw new Error(`--${name}: alias chain too deep`);
    return resolveToken(alias[1], depth + 1);
  }
  if (!/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`--${name} resolves to ${value}; the AA leg needs a 6-digit hex`);
  }
  return value;
}

const tokensIn = (cls: string, utility: "text" | "bg") =>
  [...cls.matchAll(new RegExp(`(?:^|\\s)(?:hover:)?${utility}-\\[var\\(--([\\w-]+)\\)\\]`, "g"))].map(
    (m) => m[1],
  );

/** The washes amber-family text is painted on: the chip/callout wash and the
 *  chip's hover wash. (The `/40` strip carries body ink, not amber ink.) */
const WASHES = ["amber-50", "amber-100"] as const;

const FAMILY = { AMBER_PENDING_CHIP, AMBER_ATTENTION_INK, AMBER_ATTENTION_CALLOUT };

describe("amber attention ink clears WCAG AA (task 1535)", () => {
  it("every family export names at least one text ink (anti-vacuity)", () => {
    for (const [name, cls] of Object.entries(FAMILY)) {
      expect(tokensIn(cls, "text").length, name).toBeGreaterThan(0);
    }
  });

  for (const [name, cls] of Object.entries(FAMILY)) {
    it(`${name}: every text ink ≥ 4.5:1 on every amber wash`, () => {
      for (const ink of tokensIn(cls, "text")) {
        for (const wash of WASHES) {
          const ratio = contrastRatio(resolveToken(ink), resolveToken(wash));
          expect(ratio, `--${ink} on --${wash} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }

  it("the family's text reads the ROLE token, never a raw scale step", () => {
    for (const [name, cls] of Object.entries(FAMILY)) {
      for (const ink of tokensIn(cls, "text")) {
        expect(ink, name).toMatch(/^amber-attention-ink/);
      }
    }
  });

  it("the old 600 ink is the defect this leg exists to catch", () => {
    // Anti-vacuity: the measurement fails the pre-1535 ink. 600 is oklch in
    // globals, so measure its hex (Tailwind v4 amber-600 → #e17100).
    expect(contrastRatio("#e17100", resolveToken("amber-50"))).toBeLessThan(4.5);
  });
});
