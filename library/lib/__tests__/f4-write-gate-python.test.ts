/**
 * CI teeth for the Python-side F#4 WRITE gate (task 443).
 *
 * The mirror of `bib-state-read-door-python.test.ts`. Nothing in CI runs
 * Python — `npm test` is vitest-only — which is what let the third catalog
 * writer skip F#4's holdings gate for two months with every suite green:
 * `index_paper._sync_catalog_entry_from_master` called `upsert_catalog_entry`
 * unconditionally, and that function APPENDS when no row matches, so
 * `/library/authenticate-bib` step 7 minted exactly the rows its two sibling
 * writers refuse — once per entry of every `.bib` import.
 *
 * `test_f4_write_gate.py` carries its own no-pytest runner so it can be driven
 * from here. What matters most is its CENSUS: the gate was never the part that
 * could misbehave, a writer that never asks it is, and that runs perfectly.
 *
 * If `python3` is genuinely unavailable the test FAILS rather than skips — a
 * guard that quietly opts out of the environment it's meant to protect is the
 * thing this file exists to stop.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SUITE = path.join(
  REPO_ROOT,
  "library/scripts/tests/test_f4_write_gate.py",
);

describe("F#4 catalog-row write gate (Python)", () => {
  it("passes library/scripts/tests/test_f4_write_gate.py", () => {
    let output: string;
    try {
      output = execFileSync("python3", [SUITE], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message: string };
      throw new Error(
        `Python F#4 write-gate suite failed:\n${e.stdout ?? ""}\n${
          e.stderr ?? e.message
        }`,
      );
    }
    // Assert a non-zero pass count explicitly, so a suite that silently
    // collects ZERO tests cannot read as a pass.
    //
    // TWO tallies, because the suite has two runners and which one runs is a
    // property of the MACHINE, not of the code: its `__main__` uses pytest
    // when importable and its own standalone runner otherwise. A regex for
    // only the standalone form ("<n>/<n> passed") is green here purely
    // because pytest is not installed, and fails on any machine where it is —
    // with every Python test passing. (`bib-state-read-door-python.test.ts`
    // still carries the one-form version; same hazard, pinned here.)
    const both = output.match(/(\d+)\/(\d+) passed/);
    const pytest = output.match(/(\d+) passed/);
    if (both) {
      const [, passed, total] = both;
      expect(Number(total)).toBeGreaterThan(0);
      expect(passed).toBe(total);
    } else {
      expect(pytest, `no pass tally in output:\n${output}`).not.toBeNull();
      expect(Number(pytest![1])).toBeGreaterThan(0);
      expect(output).not.toMatch(/\b\d+ (failed|error)/);
    }
  });
});
