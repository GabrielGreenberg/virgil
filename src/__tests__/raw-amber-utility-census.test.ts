/**
 * Raw-amber census (task 2026-10-05-951) — no Tailwind DEFAULT amber utility in
 * app source, anywhere.
 *
 * WHY A WHOLE-TREE ZERO, NOT AN ALLOWLIST
 * ---------------------------------------
 * The repo's amber is a TOKEN scale (`--amber-50/100/200/500/600/700` and the
 * `--amber-highlight-*` family in globals.css). There is no `--color-amber-*`
 * in `@theme inline`, so a bare `bg-amber-400` is not a typo Tailwind drops —
 * it is v4's default oklch orange, a real colour, the wrong one, sitting next to
 * chips (`AMBER_PENDING_CHIP`, `AMBER_ATTENTION_STRIP`) that paint the token.
 * STYLE_GUIDE names this as the silent wrong-colour failure, and it had already
 * earned two per-surface guards (`examples-amber-token.test.ts`,
 * `bibliography-amber-strip-convergence.test.ts`) plus scoped legs in
 * `panel-chrome-palette-guardrail` and `card-chrome-shell-census` — each
 * watching one surface while the next surface over drifted (the Bibliography
 * pending dots, the suggestion `stale` dot). Task 951 drained the last four
 * sites, so the honest bound is ZERO across both silos: a new site is a
 * `bg-[var(--amber-…)]` (or a `StatusDot tone="pending"`), never an entry here.
 *
 * REACH: `.ts`/`.tsx` under `src/` and `library/`, tests excluded, comments
 * stripped (a comment NAMING the retired utility to explain its absence is
 * prose). Any colour-taking utility prefix, with or without a variant
 * (`hover:`, `dark:`) or an opacity suffix. It does NOT see a class composed at
 * runtime (`` `bg-${hue}-400` ``) — Tailwind could not emit that either.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { commentsStripped, walkFiles } from "@/lib/__tests__/_source-scan";

const ROOT = path.resolve(__dirname, "..", "..");

const RAW_AMBER =
  /\b(?:bg|text|border|ring|from|via|to|fill|stroke|decoration|outline|shadow|accent|caret|divide|placeholder)-amber-\d{2,3}\b/g;

export function rawAmberIn(source: string): string[] {
  return [...commentsStripped(source).matchAll(RAW_AMBER)].map((m) => m[0]);
}

function census(): string[] {
  const out: string[] = [];
  for (const dir of ["src", "library"]) {
    for (const abs of walkFiles(path.join(ROOT, dir), {
      skipDirs: (n) => n === "__tests__" || n.startsWith("."),
    })) {
      if (!/\.tsx?$/.test(abs) || /\.test\.tsx?$/.test(abs)) continue;
      const src = readFileSync(abs, "utf8");
      for (const hit of rawAmberIn(src)) out.push(`${path.relative(ROOT, abs)} :: ${hit}`);
    }
  }
  return out;
}

describe("raw Tailwind amber census (task 951)", () => {
  it("finds no default-palette amber utility in app source", () => {
    expect(census()).toEqual([]);
  });

  it("catches a planted raw amber, and spares the token + prose spellings (canary)", () => {
    const fixture = [
      'const a = <span className="w-2 h-2 rounded-full bg-amber-400" />;',
      'const b = "hover:text-amber-600/80";',
      'const ok1 = "bg-[var(--amber-500)]";',
      "// prose: the retired bg-amber-500 was v4's orange",
      "/* also prose: border-amber-200 */",
    ].join("\n");
    expect(rawAmberIn(fixture)).toEqual(["bg-amber-400", "text-amber-600"]);
  });

  it("walks real source (the sweep is not vacuous)", () => {
    const files = walkFiles(path.join(ROOT, "src")).filter((f) => /\.tsx$/.test(f));
    expect(files.length).toBeGreaterThan(100);
  });
});
