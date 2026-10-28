/**
 * Task 1340 — the two sibling time questions share `relative-time.ts`'s owner:
 * `formatWhen` ("at what moment?") and `describeDuration` ("how much time?").
 * And the CENSUS: no Date locale formatter is called outside that module, so
 * the next timestamp reader cannot invent a fifth spelling (the mirror badge's
 * date-less "3:15 PM", the bib row's "Invalid Date", the byline's year-less
 * formatter were the four before it).
 */
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { describeDuration, formatWhen } from "../relative-time";
import { REPO_ROOT, codeOnly, walkFiles } from "./_source-scan";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// A fixed local "now": Oct 28 2026, 17:00.
const NOW = new Date(2026, 9, 28, 17, 0).getTime();

describe("formatWhen", () => {
  it("today → clock time only", () => {
    const t = new Date(2026, 9, 28, 15, 15).getTime();
    expect(formatWhen(t, NOW)).toBe(
      new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
    );
    expect(formatWhen(t, NOW)).not.toMatch(/Oct|2026/);
    expect(formatWhen(t, NOW, { dateOnly: true })).toBe("Today");
  });

  it("earlier this year → names the day, no year", () => {
    const t = new Date(2026, 9, 25, 15, 15).getTime();
    const label = formatWhen(t, NOW);
    expect(label).toMatch(/Oct/);
    expect(label).toMatch(/25/);
    expect(label).not.toMatch(/2026/);
    expect(formatWhen(new Date(t).toISOString(), NOW)).toBe(label);
    expect(formatWhen(t, NOW, { dateOnly: true })).not.toMatch(/:/);
  });

  it("a prior year → names the year", () => {
    const t = new Date(2025, 9, 25, 15, 15).getTime();
    expect(formatWhen(t, NOW)).toMatch(/2025/);
    expect(formatWhen(t, NOW, { dateOnly: true })).toMatch(/2025/);
  });

  it("unparseable → empty, never 'Invalid Date'", () => {
    expect(formatWhen("garbage", NOW)).toBe("");
    expect(formatWhen("garbage", NOW, { dateOnly: true })).toBe("");
    expect(formatWhen(Number.NaN, NOW)).toBe("");
  });
});

describe("describeDuration", () => {
  const cases: Array<[number, string]> = [
    [3_000, "a few seconds"],
    [-5_000, "a few seconds"],
    [MIN, "1 minute"],
    [47 * MIN, "47 minutes"],
    [HOUR, "1 hour"],
    [90 * MIN, "1h 30m"],
    [2 * HOUR, "2 hours"],
    [DAY - MIN, "23h 59m"],
    [DAY, "1 day"],
    [DAY + 4 * HOUR, "1 day"],
    [3 * DAY + 5 * MIN, "3 days"],
  ];
  for (const [ms, label] of cases) {
    it(`${ms}ms → ${label}`, () => expect(describeDuration(ms)).toBe(label));
  }
});

/** A locale formatter called on a DATE. The `(n: number) => n.toLocaleString()`
 *  number formatters (WordCount / Cutter / Revisions) are the shape this must
 *  NOT match: their receiver is a bare `n`. */
const DATE_LOCALE = /\.toLocale(?:Date|Time)String\(|\)\.toLocaleString\(|\b(?:d|date|when|then|at)\.toLocaleString\(/;

/** The owner, and the one stated exemption: `\today`'s LaTeX emission is an
 *  output format, not a UI label. */
const EXEMPT = new Set(["src/lib/relative-time.ts", "src/lib/latex-dynamic-commands.ts"]);

function offenders(src: string): boolean {
  return DATE_LOCALE.test(codeOnly(src));
}

describe("CENSUS: time labels read one owner", () => {
  it("no Date locale formatter outside relative-time.ts", () => {
    const bad: string[] = [];
    for (const abs of walkFiles(`${REPO_ROOT}/src`, { skipDirs: ["__tests__"] })) {
      if (!/\.tsx?$/.test(abs)) continue;
      const rel = relative(REPO_ROOT, abs);
      if (EXEMPT.has(rel)) continue;
      if (offenders(readFileSync(abs, "utf8"))) bad.push(rel);
    }
    expect(bad, `route these through formatWhen / describeDuration (@/lib/relative-time): ${bad.join(", ")}`).toEqual([]);
  });

  it("the needle bites on a planted reader, and spares the number formatters", () => {
    expect(offenders("const s = new Date().toLocaleTimeString();")).toBe(true);
    expect(offenders("const s = new Date(x).toLocaleDateString();")).toBe(true);
    expect(offenders("const s = d.toLocaleString(undefined, {});")).toBe(true);
    expect(offenders("const fmt = (n: number) => n.toLocaleString();")).toBe(false);
    expect(offenders("// new Date().toLocaleTimeString() in a comment")).toBe(false);
  });
});
