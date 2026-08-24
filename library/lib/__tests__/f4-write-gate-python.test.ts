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
    // The runner prints "<n>/<n> passed"; make the count assertion explicit so
    // a suite that silently collects zero tests can't read as a pass.
    const m = output.match(/(\d+)\/(\d+) passed/);
    expect(m, `no pass tally in output:\n${output}`).not.toBeNull();
    const [, passed, total] = m!;
    expect(Number(total)).toBeGreaterThan(0);
    expect(passed).toBe(total);
  });
});
