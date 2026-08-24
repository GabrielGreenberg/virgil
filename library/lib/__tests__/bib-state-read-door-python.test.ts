/**
 * CI teeth for the Python-side F#4 bib-state READ contract (task 442).
 *
 * The Library's Python pipeline has a pytest-shaped suite under
 * `library/scripts/tests/`, but nothing in CI runs Python — `npm test` is
 * vitest-only. That is what let three Python readers keep asking the RETIRED
 * home for a bibliography entry's auth state for two months after F#4 moved
 * it into master.bib's `% bib.state` comment, answering "none" for 85% of the
 * corpus with every suite green.
 *
 * `test_bib_state_read_door.py` carries its own no-pytest runner precisely so
 * it can be driven from here (the shape `test_references_bib_upsert.py`
 * established). This shells out to it and fails the JS suite on any Python
 * failure, so the doctrine in library/AGENTS.md ("the auth-state HOME is
 * master.bib") is enforced by the same `npx vitest run` that gates everything
 * else — including its CENSUS, which is what stops a fourth reader appearing.
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
  "library/scripts/tests/test_bib_state_read_door.py",
);

describe("F#4 bib-state read door (Python)", () => {
  it("passes library/scripts/tests/test_bib_state_read_door.py", () => {
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
        `Python bib-state read-door suite failed:\n${e.stdout ?? ""}\n${
          e.stderr ?? e.message
        }`,
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
