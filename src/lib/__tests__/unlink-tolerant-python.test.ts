/**
 * CI teeth for the EDITOR silo's refused-delete policy (task 496).
 *
 * Same arrangement — and the same reason — as `preservation-measure-python.test.ts`:
 * `npm test` is vitest, so a Python guard is advisory until a vitest file shells
 * out to it. (The deploy gate and the coherence workflow do loop over
 * `editor/scripts/tests/test_*.py`, so this silo has a second net; the library
 * silo has only its own wrapper. Both are kept, because a red that is visible
 * from a local `npx vitest run` is what the task worker and the dev-dream
 * actually read before merging.)
 *
 * The suite this drives is the one thing standing between a landed skill commit
 * and the pre-496 behaviour on a delete-blocked mount: a rolled-back collab
 * restore that wedges the paper read-only, plus exit 2 with no result JSON on a
 * write-set already on disk.
 *
 * If `python3` is genuinely unavailable this FAILS rather than skips: a guard
 * that quietly opts out of the environment it protects is the thing this file
 * exists to stop.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SUITE = path.join(REPO_ROOT, "editor/scripts/tests/test_unlink_tolerant.py");

describe("refused-delete policy + release-by-rewrite (Python, editor silo)", () => {
  it(
    "passes editor/scripts/tests/test_unlink_tolerant.py",
    { timeout: 60_000 },
    () => {
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
          `Python refused-delete suite failed:\n${e.stdout ?? ""}\n${e.stderr ?? e.message}`,
        );
      }
      const m = output.match(/(\d+)\/(\d+) passed/);
      expect(m, `no pass tally in output:\n${output}`).not.toBeNull();
      const [, passed, total] = m!;
      expect(Number(total)).toBeGreaterThan(0);
      expect(passed).toBe(total);
    },
  );
});
