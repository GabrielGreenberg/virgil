/**
 * CI teeth for the library .bib entry doors + cite-key rewriter (task 620).
 *
 * `test_bib_doors.py` pins the five members of task 620: every master.bib /
 * references.bib entry removal, rename and update locates its entry through
 * the ONE locator readers use and refuses an entry it cannot delimit; a
 * library citekey rename rewrites `\\cite` keys through the editor's tested
 * rewriter and reaches other papers' references.bib + citekey-keyed sidecars.
 * Nothing in CI runs Python directly, so this shells out to the suite's own
 * no-pytest runner and fails on any Python failure.
 *
 * If `python3` is genuinely unavailable the test FAILS rather than skips —
 * a guard that quietly opts out of the environment it's meant to protect is
 * the thing this file exists to stop.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SUITE = path.join(
  REPO_ROOT,
  "library/scripts/tests/test_bib_doors.py",
);

describe("library .bib entry doors (Python)", () => {
  it("passes library/scripts/tests/test_bib_doors.py", () => {
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
        `Python bib-doors suite failed:\n${e.stdout ?? ""}\n${e.stderr ?? e.message}`,
      );
    }
    // The runner prints "<n>/<n> passed"; make the count assertion explicit so
    // a suite that silently collects zero tests can't read as a pass.
    const m = output.match(/(\d+)\/(\d+) passed/);
    expect(m, `no pass tally in output:\n${output}`).not.toBeNull();
    const [, passed, total] = m!;
    expect(Number(total)).toBeGreaterThan(0);
    expect(passed).toBe(total);
  });
});
