/**
 * CI teeth for the synthesis matching contract (task 372).
 *
 * `library/scripts/tests/` is pytest-shaped and nothing in CI runs Python —
 * `npm test` is vitest-only — so every Python guard is advisory unless
 * something shells out to it. This does, exactly as
 * `warning-recompute-merge-python.test.ts` does for the catalog-warnings
 * merge (task 323).
 *
 * What it protects: what `synthesize_canonical_entries.py` is willing to write
 * into a user's `references.bib`. Its docstring promised "title-similarity
 * >= 0.85 AND author overlap >= 1" and the body implemented neither — a
 * substring surname test (`Smith` matched `Smithson`), no year check, no use
 * of `--min-similarity`, and a ranking under which whichever candidate the
 * loop saw LAST won. A wrong canonical entry is worse than an unresolved
 * warning: it looks correct, survives every structural validator, and is only
 * caught by a human who tries to follow it.
 *
 * Fourteen of the suite's nineteen legs fail against the pre-372
 * implementation (measured); the other five are controls that must pass on
 * both trees, so a script that simply refuses everything cannot read as a fix.
 *
 * If `python3` is genuinely unavailable the test FAILS rather than skips — a
 * guard that quietly opts out of the environment it protects is worthless.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SUITE = path.join(
  REPO_ROOT,
  "library/scripts/tests/test_synthesize_canonical_entries.py",
);

describe("canonical-entry synthesis matching contract (Python)", () => {
  it("passes library/scripts/tests/test_synthesize_canonical_entries.py", () => {
    let output: string;
    try {
      // `--standalone` forces the suite's built-in runner: this assertion reads
      // the "<n>/<n> passed" tally it prints, which pytest (if installed on the
      // machine) would replace with its own format — failing this guard for a
      // reason that has nothing to do with what it guards.
      output = execFileSync("python3", [SUITE, "--standalone"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message: string };
      throw new Error(
        `Python synthesis-contract suite failed:\n${e.stdout ?? ""}\n${e.stderr ?? e.message}`,
      );
    }
    // The runner prints "<n>/<n> passed"; assert the tally explicitly so a
    // suite that silently collects zero tests can't read as a pass.
    const m = output.match(/(\d+)\/(\d+) passed/);
    expect(m, `no pass tally in output:\n${output}`).not.toBeNull();
    const [, passed, total] = m!;
    expect(Number(total)).toBeGreaterThan(0);
    expect(passed).toBe(total);
  });
});
