import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Token CONTRACT — code is the truth, and the live spec must say so
 * (task 2026-07-18-172).
 *
 * The sibling `radius-scale.test.ts` locks the radius scale's values and
 * `color-token-consumers.test.ts` locks that consumers read their tokens.
 * This file locks the third leg: that the PROSE describing a token agrees
 * with `globals.css`.
 *
 * The bug that motivated it: `--header-h` moved 34px → 26px in ac006784
 * ("Unify card chrome across panels") and eight doc sites kept saying 34px —
 * four of them calling it **LOCKED**. That inverts the safe response to
 * noticing the mismatch: an agent reading "locked to 34px" naturally
 * "restores" the lock by editing the CODE back to 34px, which is a visual
 * regression across every panel. The word LOCKED was doing no work — nothing
 * enforced it. These tests are that enforcement.
 *
 * SCOPE — the LIVE spec surfaces only: `src/STYLE_GUIDE.md` (what AGENTS.md
 * points agents at) plus `docs/agents/*.md`. `docs/virgil-design-system/` is
 * deliberately NOT scanned: it is a frozen 2026 migration record that forks
 * the spec, and whether it should be updated or labelled historical is an
 * open product decision (task 2026-07-18-173). Fold it in here once 173 lands
 * and it is either current or explicitly marked historical.
 *
 * ESCAPE HATCH — a doc line that must state a non-current value (quoting
 * history, or an illustrative example) carries `token-doc-allow`, the same
 * convention as the radius guard's `radius-allow`.
 */
const ROOT = path.resolve(__dirname, "..", "..");
const globals = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");

/**
 * Tokens the guide calls LOCKED, with the value code actually ships. A token
 * described as locked needs an assertion, or "locked" is just a wish.
 */
const LOCKED_VALUES: ReadonlyArray<readonly [string, string]> = [
  // Panel header band. Every panel header height derives from it, so an
  // 8px error here is an 8px error in every offset computed against it.
  ["--header-h", "26px"],
];

/**
 * STYLE_GUIDE.md "Locked aliases (must track each other)". Each must be
 * DERIVED via `var()` from its partner, never a re-spelled literal — that is
 * what makes the tracking structural instead of aspirational.
 */
const LOCKED_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["--theme-color", "--topbar-bg"],
  ["--main-tab-bg", "--background"],
  ["--pod-editor", "--surface"],
  ["--h1-color", "--foreground"],
  ["--h2h3-color", "--editor-text-color"],
  ["--scrollbar-hover", "--muted-light"],
];

/** Every value `globals.css` gives a token (a token may be re-themed). */
function tokenDefinitions(css: string): Map<string, string[]> {
  const defs = new Map<string, string[]>();
  for (const m of css.matchAll(/(--[a-z][a-zA-Z0-9-]*)\s*:\s*([^;{}]+);/g)) {
    const values = defs.get(m[1]) ?? [];
    values.push(m[2].trim().replace(/\s+/g, " "));
    defs.set(m[1], values);
  }
  return defs;
}
const DEFS = tokenDefinitions(globals);

/** The docs an agent is actually routed to as current spec. */
const LIVE_SPEC_SURFACES: string[] = [
  "src/STYLE_GUIDE.md",
  ...readdirSync(path.join(ROOT, "docs/agents"))
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => `docs/agents/${f}`),
];

interface DocLine {
  file: string;
  line: number;
  text: string;
}

const DOC_LINES: DocLine[] = LIVE_SPEC_SURFACES.flatMap((file) =>
  readFileSync(path.join(ROOT, file), "utf8")
    .split("\n")
    .map((text, i) => ({ file, line: i + 1, text }))
    .filter(({ text }) => !text.includes("token-doc-allow")),
);

/**
 * Trim a documented value down to the declaration itself. Doc tables trail
 * prose after a column gap ("34px             panel header height"), and
 * markdown wraps values in backticks/parens.
 */
function normalizeDocValue(raw: string): string {
  return raw
    .split(/\s{2,}/)[0]
    .trim()
    .replace(/[`)\].,]+$/, "")
    .replace(/\s+/g, " ");
}

describe("locked token values", () => {
  it.each(LOCKED_VALUES)("globals.css defines %s = %s", (token, value) => {
    expect(globals).toMatch(new RegExp(`${token}:\\s*${value}\\s*;`));
  });
});

describe("locked aliases track their partner", () => {
  it.each(LOCKED_ALIASES)("%s is derived from var(%s)", (token, partner) => {
    // A literal here would let the pair desync silently on the next retone.
    expect(globals).toMatch(new RegExp(`${token}:\\s*var\\(${partner}\\)`));
  });
});

describe("the live spec agrees with globals.css", () => {
  it("states no value for a locked token that code contradicts", () => {
    // Catches BOTH the declaration form (`--header-h: 34px`) and the prose
    // form ("fixed 34px (`--header-h`)") — the prose form is how the number
    // survived in docs/agents/ui-chrome.md, so a declaration-only scan would
    // have left half the bug in place.
    const wrong: string[] = [];
    for (const [token, value] of LOCKED_VALUES) {
      const unit = value.match(/[a-z%]+$/)?.[0] ?? "px";
      for (const { file, line, text } of DOC_LINES) {
        if (!text.includes(token)) continue;
        for (const m of text.matchAll(new RegExp(`\\b(\\d+(?:\\.\\d+)?)${unit}\\b`, "g"))) {
          if (`${m[1]}${unit}` !== value) {
            wrong.push(`${file}:${line} says ${m[0]} for ${token} (code: ${value})`);
          }
        }
      }
    }
    expect(
      wrong,
      'Code is the truth — fix the DOC, never "restore" the code. If the line ' +
        "quotes history or names an unrelated px value, mark it token-doc-allow.",
    ).toEqual([]);
  });

  it("declares no token value that globals.css does not define", () => {
    const wrong: string[] = [];
    for (const { file, line, text } of DOC_LINES) {
      // The colon must follow the token NAME directly, so this reads real
      // declaration syntax only. Prose that labels a token with a backtick
      // before the colon ("`--pod-gap`: the gutter between pods") is not a
      // declaration and is correctly skipped.
      for (const m of text.matchAll(/(--[a-z][a-zA-Z0-9-]*)\s*:\s*([^;`<\n]+)/g)) {
        const token = m[1];
        const value = normalizeDocValue(m[2]);
        const defined = DEFS.get(token);
        if (!defined) {
          // A phantom token: a snippet reading `var(--nope)` silently no-ops.
          wrong.push(`${file}:${line} documents ${token}, which globals.css never defines`);
        } else if (!defined.includes(value)) {
          wrong.push(`${file}:${line} says ${token}: ${value} (code: ${defined.join(" | ")})`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});
