/**
 * CENSUS (task 1333): the small uppercase caption OUTSIDE card bodies — a
 * panel/window section label ("Request entry", "Pending requests (n)",
 * "Recent", "Browse", a font group, a preferences divider) — is spelled ONCE,
 * as `.section-caption` in globals.css, and `<MenuSectionLabel>` composes the
 * same class. Before this, ~15 hand-typed copies had drifted across
 * 9/10/11px, two grays, two trackings and two weights.
 *
 * A line that types `text-[9|10|11px]` + `uppercase` + `tracking-*` is a
 * hand-rolled twin unless it is one of the NAMED other registers:
 *   - a CHIP (the line carries `rounded` — provenance/membership chips,
 *     citation-card toggles; STYLE_GUIDE "Membership chip");
 *   - an allowlisted file below, each with its reason.
 * Card bodies have their own class (`.card-meta-label`, census
 * card-ui-consistency.test.tsx).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { walkFiles } from "../../lib/__tests__/_source-scan";

const SRC = resolve(__dirname, "../..");

const ALLOWLIST: Record<string, string> = {
  "components/panel-primitives.tsx":
    "PanelHeader title/view/count — the 11px/600 panel HEADER scale, not a body caption",
  "components/field-primitives.tsx":
    "the dialog field-label `section` register (11px by spec, FieldLabel)",
};

/** A `<legend>` anywhere but the `Fieldset` primitive re-types a group's
 *  section label by hand — the Print dialog's three did, in 12px sentence
 *  case, invisible to the uppercase-twin scan above (task 1498). */
const LEGEND_DOOR = "components/field-primitives.tsx";
export function legendOffenders(rel: string, source: string): string[] {
  if (rel === LEGEND_DOOR) return [];
  const out: string[] = [];
  source.split("\n").forEach((line, i) => {
    if (/<legend\b/.test(line)) out.push(`${rel}:${i + 1}: ${line.trim()}`);
  });
  return out;
}

describe("section caption CENSUS (task 1333)", () => {
  it("no hand-rolled small uppercase caption outside the primitives and named registers", () => {
    const offenders: string[] = [];
    for (const file of walkFiles(SRC, { skipDirs: ["__tests__"] }).filter((f) => f.endsWith(".tsx"))) {
      const rel = relative(SRC, file);
      if (rel in ALLOWLIST) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (
            /text-\[(?:9|10|11)px\]/.test(line) &&
            /\buppercase\b/.test(line) &&
            /\btracking-/.test(line) &&
            !/\brounded\b/.test(line)
          ) {
            offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
          }
        });
    }
    expect(offenders, "use the .section-caption class (or <MenuSectionLabel> inside a menu)").toEqual([]);
  });

  it("every <legend> goes through <Fieldset> (task 1498)", () => {
    const offenders = walkFiles(SRC, { skipDirs: ["__tests__"] })
      .filter((f) => f.endsWith(".tsx"))
      .flatMap((f) => legendOffenders(relative(SRC, f), readFileSync(f, "utf8")));
    expect(offenders, "use <Fieldset legend=…> from field-primitives").toEqual([]);
  });

  it("the legend scan catches a planted hand-styled legend", () => {
    const planted = '<fieldset>\n  <legend className="text-xs text-ink-subtle">Group</legend>';
    expect(legendOffenders("components/Planted.tsx", planted)).toHaveLength(1);
    expect(legendOffenders(LEGEND_DOOR, planted)).toEqual([]);
  });

  it(".section-caption sits in @layer components so call-site utilities compose", () => {
    const css = readFileSync(resolve(SRC, "app/globals.css"), "utf8");
    const layer = css.indexOf("@layer components {\n  .card-meta-label");
    const cls = css.indexOf(".section-caption {");
    expect(layer).toBeGreaterThan(-1);
    expect(cls).toBeGreaterThan(layer);
    expect(css.indexOf("\n}\n", layer)).toBeGreaterThan(cls);
  });

  it("MenuSectionLabel composes .section-caption (menu and panel captions cannot drift)", () => {
    const src = readFileSync(resolve(SRC, "components/menu/MenuChrome.tsx"), "utf8");
    expect(src).toMatch(/`section-caption \$\{padding\}`/);
    expect(src).not.toMatch(/text-\[10px\]/);
  });
});
