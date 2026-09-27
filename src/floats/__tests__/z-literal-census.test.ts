// Task 793 — the z-index ladder is guarded by a CENSUS, not a named list.
//
// STYLE_GUIDE "Z-index ladder": derive from a symbol in
// `src/floats/float-policy.ts`, never a magic number. The per-site wiring pins
// in float-policy.test.ts only cover the sites someone remembered to enroll;
// seven overlay layers kept their literals (9999, 999, 1100, 99999, …) because
// no list named them. This suite walks EVERY non-test source file under `src/`
// and fails on any bare z-index ≥ 100 — inline style, cssText, Tailwind
// arbitrary class, or CSS rule — outside the ladder SSOT and a short, REASONED
// allowlist. A new overlay must name its rung in float-policy.ts (and, for CSS,
// read a `--*-z` var mirrored + pinned there) instead of re-typing 9999.
//
// Low local z's (< 100: sticky pod caps, `z-10`, `z-50`) are local stacking
// inside a component and are out of scope — the ladder starts at the panel band.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../.."); // src/

/** The ladder SSOT itself — the only file whose job is to spell the numbers. */
const SSOT = "floats/float-policy.ts";

/**
 * Sites that may keep a bare literal, each with the reason it is NOT a ladder
 * rung. Keyed `relative/path:literal`. Keep this short; a new entry needs a
 * reason a reviewer would accept, not "it was already there".
 */
const ALLOWLIST: Record<string, string> = {
  "app/globals.css:1001":
    ".label-ref-popover-dropdown is position:absolute INSIDE the popover's own " +
    "fixed menu surface — a local stacking context, so the value orders it only " +
    "against the popover's children, never against the editor ladder.",
};

/** Bare z-index literals of 3+ digits, in every spelling Virgil uses. */
const PATTERNS: RegExp[] = [
  /zIndex\s*[:=]\s*["'`]?(\d{3,})\b/g, // style={{ zIndex: 999 }}, el.style.zIndex = "99999"
  /z-index\s*:\s*(\d{3,})\b/g, // CSS rules + cssText strings
  /\bz-\[(\d{3,})\]/g, // Tailwind arbitrary class
];

const EXTS = new Set([".ts", ".tsx", ".css"]);

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      walk(full, out);
    } else if (EXTS.has(path.extname(name)) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** Strip comments so prose that CITES a retired literal ("the old z-[9999]") passes. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, pre: string) => pre + " ".repeat(m.length - pre.length));
}

function findZLiterals(rel: string, text: string): string[] {
  const code = stripComments(text);
  const hits: string[] = [];
  for (const re of PATTERNS) {
    for (const m of code.matchAll(re)) {
      const key = `${rel}:${m[1]}`;
      if (ALLOWLIST[key]) continue;
      const line = code.slice(0, m.index).split("\n").length;
      hits.push(`${rel}:${line} → ${m[0].trim()}`);
    }
  }
  return hits;
}

describe("z-index literal census (task 793)", () => {
  const files = walk(SRC, []);

  it("finds no bare z-index ≥ 100 outside float-policy.ts and the reasoned allowlist", () => {
    const hits: string[] = [];
    for (const f of files) {
      const rel = path.relative(SRC, f).split(path.sep).join("/");
      if (rel === SSOT) continue;
      hits.push(...findZLiterals(rel, readFileSync(f, "utf8")));
    }
    expect(hits, "derive the rung from src/floats/float-policy.ts").toEqual([]);
  });

  it("every allowlist entry still matches a live literal (no stale exemptions)", () => {
    for (const key of Object.keys(ALLOWLIST)) {
      const [rel, lit] = key.split(":");
      const code = stripComments(readFileSync(path.join(SRC, rel), "utf8"));
      expect(code, key).toMatch(new RegExp(`z-index\\s*:\\s*${lit}\\b|zIndex\\s*[:=]\\s*["'\`]?${lit}\\b`));
    }
  });

  it("the detector catches every spelling it guards (planted literals)", () => {
    const planted = [
      "const a = <div style={{ zIndex: 9999 }} />;",
      'el.style.zIndex = "99999";',
      "el.style.cssText = `position:fixed;z-index:9998;`;",
      ".x { z-index: 1100; }",
      '<div className="fixed z-[9999]" />',
    ];
    for (const p of planted) {
      expect(findZLiterals("planted.tsx", p), p).toHaveLength(1);
    }
    // Symbols, vars, low local z's and comments pass.
    for (const ok of [
      "style={{ zIndex: DRAG_GHOST_Z }}",
      ".x { z-index: var(--float-z-base); }",
      "style={{ zIndex: 10 }}",
      '<div className="z-50" />',
      "// the old z-[9999] portal",
      "/* was z-index: 9999 */",
    ]) {
      expect(findZLiterals("ok.tsx", ok), ok).toEqual([]);
    }
  });
});
