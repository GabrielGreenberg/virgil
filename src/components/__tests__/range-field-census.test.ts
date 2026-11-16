/**
 * RANGE FIELD CENSUS (task 2026-11-16-1653).
 *
 * STYLE_GUIDE → Inputs: "A slider is `RangeField`; its fill is the root
 * accent-color." The Preferences dialog hand-rolled the slider-plus-readout
 * control four times, and every copy repainted its fill `--accent` over
 * `:root { accent-color: var(--control-selected) }`.
 *
 *  1. `RangeField` is the one speller of `type="range"`.
 *  2. Nothing in `src/` re-points a native control's fill at `--accent` —
 *     neither the Tailwind arbitrary class nor a CSS `accent-color`. The one
 *     `accent-color` declaration is the `:root` rule in globals.css.
 *
 * Population: every tracked `.ts`/`.tsx`/`.css` under `src/`, tests excluded.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  REPO_ROOT,
  trackedFiles,
  commentsStripped,
  cssCommentsStripped,
} from "@/lib/__tests__/_source-scan";

const PRIMITIVE = "src/components/RangeField.tsx";

const rel = (abs: string) => path.relative(REPO_ROOT, abs);
const notTest = (p: string) => !p.includes("/__tests__/") && !/\.test\.tsx?$/.test(p);

const SOURCES = trackedFiles("src", /\.tsx?$/).map(rel).filter(notTest);
const STYLES = trackedFiles("src", /\.css$/).map(rel).filter(notTest);

const code = (p: string) => commentsStripped(readFileSync(path.join(REPO_ROOT, p), "utf8"));
const css = (p: string) => cssCommentsStripped(readFileSync(path.join(REPO_ROOT, p), "utf8"));

describe("RANGE FIELD CENSUS", () => {
  it("the population is real", () => {
    const consumers = SOURCES.filter((p) => /<RangeField\b/.test(code(p)));
    expect(consumers).toEqual(
      expect.arrayContaining([
        "src/components/PreferencesModal.tsx",
        "src/components/PreferenceTree.tsx",
        "src/components/SmartPreferences.tsx",
      ]),
    );
  });

  it('type="range" has one speller, the RangeField primitive', () => {
    const strays = SOURCES.filter(
      (p) => p !== PRIMITIVE && /type\s*=\s*\{?\s*["'`]range["'`]/.test(code(p)),
    );
    expect(
      strays,
      `hand-rolled slider(s) — render <RangeField …/> instead: ${strays.join(", ")}`,
    ).toEqual([]);
  });

  it("no control fill is re-pointed at --accent", () => {
    const classStrays = SOURCES.filter((p) => /accent-\[var\(--accent\)\]/.test(code(p)));
    const cssStrays = STYLES.filter((p) => /accent-color\s*:\s*var\(--accent\)/.test(css(p)));
    expect(
      [...classStrays, ...cssStrays],
      "a control's fill inherits :root accent-color (--control-selected); --accent is for colour that reads as text",
    ).toEqual([]);
  });
});
