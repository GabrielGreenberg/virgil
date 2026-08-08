/**
 * CI teeth for the Python-side `references.bib` upsert contract (task 168).
 *
 * The Library's Python pipeline has a pytest-shaped suite under
 * `library/scripts/tests/`, but nothing in CI runs Python — `npm test` is
 * vitest-only. That made every Python guard advisory: a regression in
 * `_bib_parse.upsert_entry_text` (the splice that stops a paper's cited works
 * from being replaced by one entry) would land green.
 *
 * `test_references_bib_upsert.py` carries its own no-pytest runner precisely
 * so it can be driven from here. This shells out to it and fails the JS suite
 * on any Python failure, so the doctrine in library/AGENTS.md
 * ("`references.bib` is upsert-only") is enforced by the same `npx vitest run`
 * that gates everything else.
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
  "library/scripts/tests/test_references_bib_upsert.py",
);

describe("references.bib upsert contract (Python)", () => {
  it("passes library/scripts/tests/test_references_bib_upsert.py", () => {
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
        `Python upsert suite failed:\n${e.stdout ?? ""}\n${e.stderr ?? e.message}`,
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
