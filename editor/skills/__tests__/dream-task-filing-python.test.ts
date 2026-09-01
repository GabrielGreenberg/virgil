/**
 * CI teeth for the dev-loop's ONE output channel (task 522).
 *
 * Same arrangement — and the same reason — as `dream-synced-sink-python.test.ts`:
 * `npm test` is vitest, so a Python guard is advisory until a vitest file shells
 * out to it. That matters more here than usual, because what this suite guards
 * is a WRITE into the human's task queue: the routing that decides whether a
 * finding reaches the worker or reaches Gabriel, the id-collision protocol three
 * minters now share, the schema bar a filed task must clear, and the sandbox
 * rule that keeps a pinned test run from minting into the live queue at all.
 *
 * If `python3` is genuinely unavailable this FAILS rather than skips: a guard
 * that quietly opts out of the environment it protects is the thing this file
 * exists to stop.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SUITE = path.join(
  REPO_ROOT,
  "editor/scripts/tests/test_dream_task_filing.py",
);

describe("dev-loop task filing (Python, editor silo)", () => {
  it(
    "passes editor/scripts/tests/test_dream_task_filing.py",
    { timeout: 120_000 },
    () => {
      // `unittest` writes its tally to STDERR, so both streams are read —
      // an stdout-only wrapper passes vacuously on a suite that printed
      // nothing at all.
      const r = spawnSync("python3", [SUITE], {
        cwd: REPO_ROOT,
        encoding: "utf8",
      });
      const output = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
      expect(r.status, `Python task-filing suite failed:\n${output}`).toBe(0);
      expect(output, output).toMatch(/^OK$/m);
      // …and a FLOOR, because "OK" is what a suite gutted down to one leg also
      // prints. The number is a floor rather than an equality so adding a leg
      // is not a two-file change; it only ever moves up.
      const ran = output.match(/Ran (\d+) tests?/);
      expect(ran, `no test tally in output:\n${output}`).not.toBeNull();
      expect(Number(ran![1])).toBeGreaterThanOrEqual(21);
    },
  );
});
