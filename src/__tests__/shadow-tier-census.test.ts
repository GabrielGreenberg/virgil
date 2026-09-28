/**
 * Shadow-tier census (task 818).
 *
 * Elevation is a property of the SURFACE TIER, never of the call site
 * (STYLE_GUIDE.md → "Hover never changes elevation"): pods/cards carry the
 * ambient lift (`--pod-shadow` / `--card-shadow-ambient`), menus and floating
 * chips `--menu-shadow`, floating panels `--shadow-float`, drag ghosts
 * `--shadow-drag-ghost-filter`. Radius has `check:radius`, colour has
 * `color-token-consumers`; this is the matching guard for shadow. Before it,
 * the twin pending-change navigators (`PendingChangePill` / Omni's sticky
 * header — the same chrome) wore `shadow-lg` and `shadow-sm`, and five more
 * chips and popovers each picked a literal of their own.
 *
 * Flagged, in `src/` + `library/` (`.ts` / `.tsx` / `.css`, tests excluded):
 *   - a Tailwind elevation utility in a string literal: `shadow`,
 *     `shadow-sm|md|lg|xl|2xl` (any variant prefix), and an arbitrary
 *     `shadow-[…]` whose value is not a `var(…)` read;
 *   - a LITERAL elevation layer anywhere in code: `x y blur [spread] <colour>`
 *     with a positive blur, outside a `var(…)` span (a fallback literal inside
 *     `var(--tok, …)` vouches for itself) and outside a CSS custom-property
 *     definition (that is where the tiers are MINTED).
 * Not flagged (they are not elevation): `inset` layers (seams, pressed wells,
 * insertion bars), zero-blur spread RINGS (`0 0 0 2px …` — focus / selection /
 * drop halos), `shadow-inner`, `shadow-none`.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");
const SCAN_DIRS = ["src", "library"];
const EXTS = new Set([".ts", ".tsx", ".css"]);

/** Annotated exceptions: a site may keep a non-tier shadow only here. */
const ALLOWLIST: ReadonlyArray<{ file: string; needle: string; why: string }> = [];

export interface ShadowViolation {
  line: number;
  kind: "tailwind-utility" | "literal-layer";
  text: string;
}

const TW_ELEVATION = /^(?:[\w-]+:)*shadow(?:-(?:sm|md|lg|xl|2xl))?$/;
const TW_ARBITRARY = /^(?:[\w-]+:)*shadow-\[(.*)\]$/;
const STRING_LITERAL = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
const NUM = String.raw`-?\d*\.?\d+(?:px|rem|em)?`;
const LAYER = new RegExp(
  String.raw`(?<![\w.#-])(${NUM})\s+(${NUM})\s+(\d*\.?\d+)(?:px|rem|em)?(?:\s+${NUM})?\s+(?:rgba?\(|hsla?\(|#[0-9a-fA-F]{3}|color-mix\(|oklch\(|black\b|white\b)`,
  "g",
);

/** Blank every bracket-balanced `var(…)` span (fallback literal included). */
function stripVarSpans(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; ) {
    if (s.startsWith("var(", i)) {
      let depth = 0;
      let j = i + 3;
      for (; j < s.length; j++) {
        if (s[j] === "(") depth++;
        else if (s[j] === ")" && --depth === 0) break;
      }
      out += " ".repeat(j + 1 - i);
      i = j + 1;
      continue;
    }
    out += s[i++];
  }
  return out;
}

const isCommentLine = (l: string) => /^\s*(\/\/|\/\*|\*)/.test(l);

export function scanShadowSource(src: string, file: string): ShadowViolation[] {
  const isCss = file.endsWith(".css");
  // Drop block comments (keeping line structure) so prose never trips a rule.
  const text = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const lines = text.split("\n");
  const out: ShadowViolation[] = [];
  let inTokenDef = false;
  lines.forEach((raw, i) => {
    if (!isCss && isCommentLine(raw)) return;
    const line = isCss ? raw : raw.replace(/(^|[^:"'`])\/\/.*$/, "$1");
    if (isCss) {
      // A custom-property definition (possibly wrapped) MINTS a tier.
      if (/^\s*--[\w-]+\s*:/.test(line)) inTokenDef = true;
      const wasTokenDef = inTokenDef;
      if (line.includes(";") || line.includes("}")) inTokenDef = false;
      if (wasTokenDef) return;
    } else {
      for (const lit of line.match(STRING_LITERAL) ?? []) {
        for (const tok of lit.slice(1, -1).split(/[\s"'`${}]+/)) {
          const arb = TW_ARBITRARY.exec(tok);
          if (TW_ELEVATION.test(tok) || (arb && !arb[1].trim().startsWith("var("))) {
            out.push({ line: i + 1, kind: "tailwind-utility", text: tok });
          }
        }
      }
    }
    const judged = stripVarSpans(line);
    for (const m of judged.matchAll(LAYER)) {
      if (parseFloat(m[3]) <= 0) continue; // a zero-blur spread ring
      const before = judged.slice(0, m.index);
      const layerStart = Math.max(before.lastIndexOf(","), before.lastIndexOf(":"), before.lastIndexOf('"'), before.lastIndexOf("'"));
      if (/\binset\b/.test(before.slice(layerStart + 1))) continue;
      out.push({ line: i + 1, kind: "literal-layer", text: m[0].trim() });
    }
  });
  return out;
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === "__tests__" || ent.name.startsWith(".")) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (EXTS.has(path.extname(ent.name)) && !/\.(test|spec)\.tsx?$/.test(ent.name)) acc.push(p);
  }
  return acc;
}

describe("shadow-tier census (task 818)", () => {
  it("every shadow in the tree is a tier token, a ring, an inset, or annotated", () => {
    const offenders: string[] = [];
    const usedAllow = new Set<number>();
    for (const dir of SCAN_DIRS) {
      for (const abs of walk(path.join(ROOT, dir))) {
        const rel = path.relative(ROOT, abs).split(path.sep).join("/");
        const src = fs.readFileSync(abs, "utf8");
        const srcLines = src.split("\n");
        for (const v of scanShadowSource(src, rel)) {
          const ai = ALLOWLIST.findIndex((a) => a.file === rel && srcLines[v.line - 1].includes(a.needle));
          if (ai >= 0) {
            usedAllow.add(ai);
            continue;
          }
          offenders.push(`${rel}:${v.line} [${v.kind}] ${v.text}`);
        }
      }
    }
    expect(offenders, "put the shadow on its tier token (STYLE_GUIDE elevation paragraph)").toEqual([]);
    // A stale exception is an unguarded hole: every entry must still match.
    const stale = ALLOWLIST.filter((_, i) => !usedAllow.has(i)).map((a) => `${a.file} (${a.needle})`);
    expect(stale, "remove allowlist entries that no longer match").toEqual([]);
  });

  describe("guard reach (planted fixtures)", () => {
    const hits = (src: string, file = "x.tsx") => scanShadowSource(src, file).map((v) => v.kind);

    it("fails a reintroduced Tailwind elevation utility", () => {
      expect(hits('<div className="rounded-md bg-surface shadow-lg" />')).toEqual(["tailwind-utility"]);
      expect(hits('const c = "px-2 shadow flex";')).toEqual(["tailwind-utility"]);
      expect(hits("const c = `a ${x ? \"hover:shadow-md\" : \"\"}`;")).toContain("tailwind-utility");
      expect(hits('const c = "shadow-[0_1px_2px_rgba(0,0,0,0.04)]";')).toEqual(["tailwind-utility"]);
    });

    it("fails a literal elevation layer in TS and CSS", () => {
      expect(hits('style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.16), var(--drag-ring-faint)" }}')).toEqual(["literal-layer"]);
      expect(hits(".x {\n  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);\n}", "x.css")).toEqual(["literal-layer"]);
      expect(hits(".x {\n  box-shadow:\n    0 0 0 2px red,\n    0 4px 16px rgba(0,0,0,.12);\n}", "x.css")).toEqual(["literal-layer"]);
      // A token branch does not immunize a literal beside it.
      expect(hits('const s = on ? "var(--menu-shadow)" : "0 1px 3px rgba(0,0,0,0.15)";')).toEqual(["literal-layer"]);
    });

    it("passes tier reads, rings, insets, token definitions and comments", () => {
      expect(hits('<div className="shadow-[var(--menu-shadow)] shadow-inner shadow-none" />')).toEqual([]);
      expect(hits('const s = { boxShadow: "var(--card-shadow-ambient, 0 2px 6px rgba(0,0,0,0.10))" };')).toEqual([]);
      expect(hits('const s = { boxShadow: "0 0 0 4px rgba(37, 99, 235, 0.18)" };')).toEqual([]);
      expect(hits('const s = { boxShadow: "inset 0 1px 2px rgba(0,0,0,0.2)" };')).toEqual([]);
      expect(hits(":root {\n  --shadow-float: 0 6px 16px rgba(0,0,0,0.10),\n    0 1px 3px rgba(0,0,0,0.06);\n}", "x.css")).toEqual([]);
      expect(hits("// was `shadow-lg` and 0 4px 16px rgba(0,0,0,.1)\n/* shadow-md */")).toEqual([]);
    });
  });
});
