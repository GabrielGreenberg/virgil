// Task 370 — the census under the "one door" law.
//
// Every comparable law in AGENTS.md ships a census, and each states the same
// rationale: *the door was never the part that could misbehave — a call site
// that never asks it is.* This one exists because that prediction came true
// inside the fix's own first cut, and was caught only by an adversarial review:
// the companion one-shot effect (an items/resolvePos rebuild) called `measure()`
// DIRECTLY and never entered the convergence door, while two comments — one in
// this hook and one in the controller — asserted that "a later item arrival
// re-arms through the companion one-shot like any other trigger". It does not,
// unless someone remembers to make it. And that is the COMMONEST cold open
// there is: the editor mounts before the sidecar cards load, so the mount chain
// reports `inert` and terminates, and the cards then get exactly one pass
// against still-settling layout. The pre-370 defect, on the path the fix's own
// prose claimed was covered — with every behavioural leg green.
//
// So: enumerate the measure call sites, and require each to name why it is one.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnlyLines } from "@/lib/__tests__/_source-scan";

const ROOT = path.resolve(__dirname, "../../../..");

/** Every production .ts/.tsx in both silos (suites excluded — a test may NAME a
 *  retired mechanism to explain it). */
function productionFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "__tests__") continue;
        walk(p);
        continue;
      }
      if (!/\.tsx?$/.test(e.name) || /\.test\.tsx?$/.test(e.name)) continue;
      out.push(p);
    }
  };
  walk(path.join(ROOT, "src"));
  walk(path.join(ROOT, "library"));
  return out;
}
const HOOK = path.join(ROOT, "src/hooks/useInTextPositions.ts");
const MODULE = path.join(ROOT, "src/lib/editor-geometry/settle-convergence.ts");

/**
 * The two sites allowed to run a measure pass, keyed by the exact source line,
 * with the reason each is legitimate. Per LINE, not per file: a file-scoped
 * exemption would excuse the next bare `measure()` added beside them, which is
 * precisely the drift this census exists to catch.
 */
const PERMITTED_MEASURE_CALLS: Record<string, string> = {
  "return measureRef.current();":
    "THE DOOR. The convergence controller's measure closure — the only place a settle pass runs, and where the hidden / suppression / typing policy gates sit.",
  "measure();":
    "The companion one-shot's SYNCHRONOUS pass on an items/resolvePos rebuild, so a newly-added card paints at its position in this commit rather than a frame later. It is followed on the very next line by `convergeRef.current?.request()`, which the paired leg below enforces — the synchronous pass is an addition to the door, never a substitute for it.",
};

function measureCallLines(src: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  codeOnlyLines(src)
    .split("\n")
    .forEach((raw, i) => {
      // A CALL, not a declaration, a type, a ref assignment or a dep-list mention.
      if (!/\bmeasure(Ref\.current)?\s*\(/.test(raw)) return;
      if (/const measure = useCallback/.test(raw)) return;
      out.push({ line: i + 1, text: raw.trim() });
    });
  return out;
}

describe("settle convergence — the one-door census (task 370)", () => {
  const hookSrc = fs.readFileSync(HOOK, "utf8");

  it("every measure call site is one of the two permitted ones", () => {
    const hits = measureCallLines(hookSrc);
    // The census can only speak if it found something.
    expect(hits.length).toBeGreaterThanOrEqual(2);
    const unknown = hits.filter((h) => !(h.text in PERMITTED_MEASURE_CALLS));
    expect(
      unknown.map((h) => `useInTextPositions.ts:${h.line}  ${h.text}`),
    ).toEqual([]);
  });

  it("the synchronous companion pass is PAIRED with a request() on the next line", () => {
    // The leg with the teeth. The site is permitted precisely because it also
    // enters the door; permitting the call without pinning the pairing would
    // re-open the exact defect, since a bare `measure();` matches the allowlist
    // key either way.
    const lines = codeOnlyLines(hookSrc).split("\n");
    const idx = lines.findIndex((l) => l.trim() === "measure();");
    expect(idx).toBeGreaterThan(-1);
    expect(lines[idx + 1].trim()).toBe("convergeRef.current?.request();");
  });

  it("the controller has exactly ONE owner", () => {
    // A second `createConvergenceController` caller would be a second settle
    // authority with its own budget, its own probe contributions and no shared
    // rate limit — the module-singleton hazard, one subsystem over. If a second
    // consumer is ever genuinely wanted, that is a design decision, not an
    // allowlist entry.
    const owners = productionFiles().filter((p) =>
      /createConvergenceController\s*\(/.test(
        codeOnlyLines(fs.readFileSync(p, "utf8")),
      ),
    );
    expect(owners.map((p) => path.relative(ROOT, p)).sort()).toEqual([
      "src/hooks/useInTextPositions.ts",
      "src/lib/editor-geometry/settle-convergence.ts",
    ]);
  });

  it("the retired scrollHeight-proxy constants are gone from production", () => {
    // Over COMMENT-STRIPPED source: prose may NAME them (both changed files
    // explain what was retired and why, and a doctrine section that cannot name
    // the thing it retired is worse than no doctrine). What must not survive is
    // a live declaration or read — a second settle criterion beside the door.
    const found = productionFiles().filter((p) =>
      /SETTLE_MAX_FRAMES|SETTLE_STABLE_FRAMES/.test(
        codeOnlyLines(fs.readFileSync(p, "utf8")),
      ),
    );
    expect(found.map((p) => path.relative(ROOT, p))).toEqual([]);
  });

  it("the module states its own budget as a per-CHAIN constant", () => {
    // A refreshable deadline is not a deadline: a committing pass bumps
    // `measureVersion`, which re-runs the consumer's per-card ResizeObserver
    // effect, which re-observes every card, whose initial delivery arrives back
    // as a `request()`. Measured against a browser-faithful observer, the
    // refresh-on-request version never terminated. `request()` must therefore
    // touch neither the deadline nor the fast window while a chain is live.
    const src = codeOnlyLines(fs.readFileSync(MODULE, "utf8"));
    const open = src.indexOf("request(): void {");
    expect(open).toBeGreaterThan(-1);
    const body = src.slice(open, src.indexOf("stop(): void {", open));
    const guardAt = body.indexOf("if (chainStart < 0) {");
    expect(guardAt).toBeGreaterThan(-1);
    const guarded = body.slice(guardAt);
    for (const assign of ["deadline =", "fastUntil ="]) {
      // Written exactly once in `request()`, and only inside the new-chain guard.
      expect(body.split(assign).length - 1).toBe(1);
      expect(guarded).toContain(assign);
    }
  });
});
