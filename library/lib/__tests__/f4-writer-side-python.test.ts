// @vitest-environment node
//
// CI teeth for the Python-side F#4 WRITER suite (task 510).
//
// The sibling of `f4-write-gate-python.test.ts`, and the reason it exists is
// the same class one level over: nothing in CI runs Python — `npm test` is
// vitest-only — so a Python suite with no vitest shell is a suite nobody runs.
// `test_f4_writer_side.py` had none. It covers the F#4 writer half (a
// reference-only entry mints no catalog row but DOES get its `% bib.state`
// comment; the postflight shrinkage guard; the needs-reauth round trip; the
// prune script's back-fill-before-delete ordering) and it was reported 18/19
// locally for months, because its `__main__` runner injected `tmp_path`
// POSITIONALLY and one leg also takes `capsys` — a TypeError that reads like
// an ordinary failure. Both halves are the same finding: *a leg that cannot
// run is a habit, not a guard*, and a SUITE that cannot run is the same thing
// one size up.
//
// The runner is signature-driven now (`library/scripts/tests/_standalone.py`),
// so the file is 19/19 standalone as well as under pytest — which is what
// makes this shell worth having rather than a guard that pins a known-short
// tally.
//
// If `python3` is genuinely unavailable the test FAILS rather than skips — a
// guard that quietly opts out of the environment it is meant to protect is
// the thing this file exists to stop.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SUITE = path.join(
  REPO_ROOT,
  "library/scripts/tests/test_f4_writer_side.py",
);

describe("F#4 catalog-row writer side (Python)", () => {
  it("passes library/scripts/tests/test_f4_writer_side.py", () => {
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
        `Python F#4 writer-side suite failed:\n${e.stdout ?? ""}\n${
          e.stderr ?? e.message
        }`,
      );
    }
    // TWO tallies, because which runner ran is a property of the MACHINE, not
    // of the code: `__main__` uses pytest when importable and the standalone
    // runner otherwise. A regex for only one form is green here purely
    // because of what happens to be installed. (Copied from
    // `f4-write-gate-python.test.ts`, which records the same hazard.)
    const both = output.match(/(\d+)\/(\d+) passed/);
    const pytest = output.match(/(\d+) passed/);
    if (both) {
      const [, passed, total] = both;
      // A suite that silently collected ZERO tests must not read as a pass.
      expect(Number(total)).toBeGreaterThan(0);
      expect(passed).toBe(total);
    } else {
      expect(pytest, `no pass tally in output:\n${output}`).not.toBeNull();
      expect(Number(pytest![1])).toBeGreaterThan(0);
      expect(output).not.toMatch(/\b\d+ (failed|error)/);
    }
  });
});
