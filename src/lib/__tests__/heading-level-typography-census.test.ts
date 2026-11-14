/**
 * Heading-level typography CENSUS (task 1614).
 *
 * `\subsubsection` (level 4) once had no `.tiptap h4` rule at all, so Tailwind
 * preflight's `h4 { font-size: inherit; font-weight: inherit }` rendered it as
 * body text — while its fold chevron was centred on a typed `1rem`. The root
 * shape: each level's size was spelled twice by hand (font-size rule + chevron
 * rule), and a level fell out of one list. This census derives the levels from
 * HEADING_TYPES and pins, for every one: a declared size token, ONE stamp of
 * that token as `--heading-size` reaching both the wrapper and the element, and
 * a typography rule that reads it. The chevron is centred by ONE rule reading
 * `--heading-size`, never a per-level hand list.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";
import { HEADING_TYPES } from "@/lib/heading-types";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const root = postcss.parse(css);

type Rule = { selectors: string[]; decls: Map<string, string> };
const RULES: Rule[] = [];
root.walkRules((r) => {
  if (r.parent && r.parent.type === "atrule") return; // print/media variants aside
  const decls = new Map<string, string>();
  r.walkDecls((d) => void decls.set(d.prop, d.value));
  RULES.push({ selectors: r.selectors.map((s) => s.trim()), decls });
});

const declared = (prop: string) => RULES.some((r) => r.decls.has(prop));

describe("heading-level typography census (task 1614)", () => {
  for (const { level, command } of HEADING_TYPES) {
    const el = `h${level}`;
    const token = `--font-headers-h${level}-size`;

    it(`\\${command} (level ${level}) declares its size token`, () => {
      expect(declared(token), `${token} is read but never declared`).toBe(true);
    });

    it(`\\${command} stamps --heading-size from that token on wrapper AND element`, () => {
      const stamps = RULES.filter((r) => r.decls.get("--heading-size") === `var(${token})`);
      const sels = stamps.flatMap((r) => r.selectors);
      expect(sels, `no wrapper stamp for level ${level}`).toContain(`.heading-wrapper-l${level}`);
      expect(sels, `no element stamp for level ${level}`).toContain(`.tiptap ${el}`);
    });

    it(`\\${command} has a typography rule that reads --heading-size`, () => {
      const typo = RULES.filter(
        (r) =>
          r.decls.get("font-size") === "var(--heading-size)" &&
          r.selectors.some((s) => new RegExp(`(^|[\\s>])${el}$`).test(s)),
      );
      expect(typo.length, `level ${level} falls back to preflight body text`).toBeGreaterThan(0);
      const body = typo[0].decls;
      expect(body.get("font-weight")).toMatch(new RegExp(`--font-headers-h${level}-weight`));
      expect(body.get("font-family")).toMatch(/--font-headers-family/);
    });
  }

  it("the fold chevron is centred by ONE rule reading --heading-size, not a per-level list", () => {
    const tops = RULES.filter(
      (r) => r.decls.has("top") && r.selectors.some((s) => s.includes("heading-fold-chevron")),
    );
    expect(tops.map((r) => r.selectors.join(", "))).toEqual([".heading-fold-chevron"]);
    expect(tops[0].decls.get("top")).toMatch(/^calc\(var\(--heading-size\) \* 0\.75/);
  });
});
