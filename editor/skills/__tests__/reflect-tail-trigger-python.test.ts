/**
 * CI teeth for the capture layer's tail-trigger and its SINK SSOT.
 *
 * The sibling of `dream-synced-sink-python.test.ts`, and it exists for the same
 * reason: `npm test` is vitest, so a Python guard is advisory until a vitest
 * file shells out to it — and this suite is the one that pins the invariant the
 * whole dev-loop rests on, that the WRITER (reflect) and the READER (dream)
 * resolve the SAME memo sink from any cwd. Task 521 moved that sink onto a
 * synced transport and RENEGOTIATED two of its legs; a renegotiated leg that no
 * CI run executes is a claim nobody checks.
 *
 * If `python3` is genuinely unavailable this FAILS rather than skips.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SUITE = path.join(
  REPO_ROOT,
  "editor/scripts/tests/test_reflect_tail_trigger.py",
);

describe("capture tail-trigger + sink SSOT (Python, editor silo)", () => {
  it(
    "passes editor/scripts/tests/test_reflect_tail_trigger.py",
    { timeout: 180_000 },
    () => {
      const r = spawnSync("python3", [SUITE], {
        cwd: REPO_ROOT,
        encoding: "utf8",
      });
      const output = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
      expect(r.status, `Python tail-trigger suite failed:\n${output}`).toBe(0);
      // …and a FLOOR, because this suite reports its own tally and a run gutted
      // down to a handful of legs would otherwise pass silently.
      const tally = output.match(/=+ (\d+) passed, (\d+) failed =+/);
      expect(tally, `no pass tally in output:\n${output}`).not.toBeNull();
      expect(Number(tally![2])).toBe(0);
      expect(Number(tally![1])).toBeGreaterThanOrEqual(40);
    },
  );
});
