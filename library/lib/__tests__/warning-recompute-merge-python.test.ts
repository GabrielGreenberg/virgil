/**
 * CI teeth for the Python-side catalog-warnings merge contract (task 323).
 *
 * `library/scripts/tests/` is pytest-shaped and nothing in CI runs Python —
 * `npm test` is vitest-only — so every Python guard is advisory unless
 * something shells out to it. This does, exactly as
 * `references-bib-upsert-python.test.ts` does for the `references.bib` upsert
 * doctrine (task 168).
 *
 * What it protects: `merge_indexed_warnings` + the opt-in
 * `--recompute-warning-kind` path through `update_catalog_entry`, which is
 * what lets `/library/clean-bibliography` persist its own three warning kinds
 * at source (so `synthesize_canonical_entries.py`, later in the same run, can
 * actually read them) WITHOUT clobbering the five kinds `deep-index.md` step 5
 * owns. The load-bearing leg is exact head-equality: a
 * `<kind>-false-positive:` suppression must survive a recompute declaring
 * `<kind>` — a `startswith` drop eats an operator's verified suppression, and
 * that variant fails three legs of the suite.
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
  "library/scripts/tests/test_warning_recompute_merge.py",
);

describe("catalog warnings per-kind recompute merge (Python)", () => {
  it("passes library/scripts/tests/test_warning_recompute_merge.py", () => {
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
        `Python warnings-merge suite failed:\n${e.stdout ?? ""}\n${e.stderr ?? e.message}`,
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
