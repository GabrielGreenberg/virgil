/**
 * Task 866 — relative time has ONE owner (`@/lib/relative-time`): one floored
 * bucketing ladder, two registers (`long` "5m ago" / `compact` "5m"). Before it,
 * five surfaces each hand-wrote their own ladder with divergent edges.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { formatElapsed, formatRelativeTime } from "../relative-time";

const MIN = 60;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("the ladder — bucket edges (long register)", () => {
  const cases: Array<[number, string]> = [
    [0, "just now"],
    [59, "just now"],
    [60, "1m ago"],
    [HOUR - 1, "59m ago"],
    [HOUR, "1h ago"],
    [DAY - 1, "23h ago"],
    [DAY, "1d ago"],
    [7 * DAY - 1, "6d ago"],
    [7 * DAY, "1w ago"],
    [35 * DAY - 1, "4w ago"],
    [35 * DAY, "1mo ago"],
    [360 * DAY - 1, "11mo ago"],
    [360 * DAY, "1y ago"], // never "0y" (the pre-866 copies said so)
    [365 * DAY, "1y ago"],
    [800 * DAY, "2y ago"],
  ];
  for (const [sec, label] of cases) {
    it(`${sec}s → ${label}`, () => {
      expect(formatElapsed(sec)).toBe(label);
    });
  }
});

describe("the compact register shares the ladder, drops the suffix", () => {
  it.each([
    [10, "now"],
    [5 * MIN, "5m"],
    [2 * HOUR, "2h"],
    [3 * DAY, "3d"],
    [14 * DAY, "2w"],
    [400 * DAY, "1y"],
  ])("%is → %s", (sec, label) => {
    expect(formatElapsed(sec, { register: "compact" })).toBe(label);
  });
});

describe("options", () => {
  it("`seconds` resolves the sub-minute bucket, still 'now' under 5 s", () => {
    const o = { register: "compact", seconds: true } as const;
    expect(formatElapsed(4, o)).toBe("now");
    expect(formatElapsed(5, o)).toBe("5s");
    expect(formatElapsed(59, o)).toBe("59s");
    expect(formatElapsed(60, o)).toBe("1m");
  });

  it("`dateAfterDays` swaps the tail for a locale date at the edge", () => {
    const now = Date.parse("2026-05-31T12:00:00.000Z");
    const just = new Date(now - (30 * DAY - 1) * 1000).toISOString();
    const at = new Date(now - 30 * DAY * 1000).toISOString();
    expect(formatRelativeTime(just, { dateAfterDays: 30 }, now)).toBe(
      "4w ago",
    );
    expect(formatRelativeTime(at, { dateAfterDays: 30 }, now)).toBe(
      new Date(at).toLocaleDateString(),
    );
  });
});

describe("degenerate input", () => {
  const now = Date.parse("2026-05-14T12:00:00.000Z");
  it("an unparseable timestamp says nothing", () => {
    expect(formatRelativeTime("not a date", {}, now)).toBe("");
  });
  it("a future timestamp (clock skew) reads as now", () => {
    expect(formatRelativeTime("2026-05-14T13:00:00.000Z", {}, now)).toBe(
      "just now",
    );
  });
  it("an unknown duration says nothing; a negative one reads as now", () => {
    expect(formatElapsed(null)).toBe("");
    expect(formatElapsed(-5)).toBe("just now");
  });
  it("formatRelativeTime measures from `now`", () => {
    expect(formatRelativeTime("2026-05-14T11:55:00.000Z", {}, now)).toBe(
      "5m ago",
    );
    expect(
      formatRelativeTime(
        "2026-05-11T12:00:00.000Z",
        { register: "compact" },
        now,
      ),
    ).toBe("3d");
  });
});

describe("census: no surface hand-writes its own ladder", () => {
  const SRC = join(__dirname, "..", "..");
  const OWNER = "lib/relative-time.ts";

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name !== "__tests__" && name !== "node_modules") walk(p, out);
      } else if (/\.tsx?$/.test(name)) out.push(p);
    }
    return out;
  }

  // The tell of a hand-written ladder: the "just now" label, or a minute
  // bucket emitting a template literal ending in `m ago` / `m`.
  const LADDER = /"just now"|`\$\{\w+\}m ago`|if \(\w+ < 60\) return `\$\{\w+\}m`/;

  it("only the owner module carries a relative-time ladder", () => {
    const offenders = walk(SRC)
      .map((p) => relative(SRC, p))
      .filter((rel) => rel !== OWNER)
      .filter((rel) => LADDER.test(readFileSync(join(SRC, rel), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the census can see a ladder (canary)", () => {
    expect(LADDER.test("if (m < 60) return `${m}m ago`;")).toBe(true);
    expect(LADDER.test('if (sec < 45) return "just now";')).toBe(true);
  });
});
