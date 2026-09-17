/**
 * CI teeth for settled master.bib entries (task 621).
 *
 * `test_master_bib_settled_state.py` pins: the write door never lowers a
 * terminal `% bib.state` without `allow_downgrade`; `index_paper` does not
 * re-authenticate a settled entry; `_tools.master_entry_for` finds an entry
 * under either Unicode normalization and raises on an unreadable master.bib;
 * the `.bib`-drop merge reads through it and aborts rather than merging
 * against nothing.
 *
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
  "library/scripts/tests/test_master_bib_settled_state.py",
);

describe("settled master.bib state + single-entry read door (Python)", () => {
  it("passes library/scripts/tests/test_master_bib_settled_state.py", () => {
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
        `Python settled-state suite failed:\n${e.stdout ?? ""}\n${e.stderr ?? e.message}`,
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
