/**
 * CI teeth for the `bib_auth.py` CLI contract (task 158).
 *
 * Same arrangement — and the same reason — as
 * `references-bib-upsert-python.test.ts`: the Library's Python suites live
 * under `library/scripts/tests/`, and nothing in CI runs Python, so every
 * Python guard is advisory until a vitest file shells out to it. The
 * fabricated-CLI defect this pins was live for months precisely because no
 * automated check ever ran the invocation the skills documented.
 *
 * `test_bib_auth_cli.py` carries its own no-pytest runner so it can be driven
 * from here. If `python3` is genuinely unavailable the test FAILS rather than
 * skips — a guard that quietly opts out of the environment it protects is the
 * thing this file exists to stop.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SUITE = path.join(REPO_ROOT, "library/scripts/tests/test_bib_auth_cli.py");

describe("bib_auth.py CLI contract (Python)", () => {
  it("passes library/scripts/tests/test_bib_auth_cli.py", () => {
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
        `Python bib_auth CLI suite failed:\n${e.stdout ?? ""}\n${e.stderr ?? e.message}`,
      );
    }
    const m = output.match(/(\d+)\/(\d+) passed/);
    expect(m, `no pass tally in output:\n${output}`).not.toBeNull();
    const [, passed, total] = m!;
    expect(Number(total)).toBeGreaterThan(0);
    expect(passed).toBe(total);
  });
});
