/**
 * CI teeth for the PYTHON half of the preservation measure (task 357).
 *
 * Same arrangement — and the same reason — as the Library's
 * `bib-auth-cli-python.test.ts`: nothing in CI runs Python, so every Python
 * guard is advisory until a vitest file shells out to it. The parity contract
 * this drives is the only thing holding `_common.py`'s port of
 * `tex-preservation.ts` to the rule it claims to implement, and the only thing
 * exercising `apply_response.py`'s `region-replace` refusals — the third writer
 * of a user's `.tex`, and the one that until now had no net at all.
 *
 * `test_preservation_measure.py` carries its own no-pytest runner. If `python3`
 * is genuinely unavailable this FAILS rather than skips: a guard that quietly
 * opts out of the environment it protects is the thing this file exists to stop.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SUITE = path.join(
  REPO_ROOT,
  "editor/scripts/tests/test_preservation_measure.py",
);

describe("preservation measure + region-replace gate (Python)", () => {
  it(
    "passes editor/scripts/tests/test_preservation_measure.py",
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
          `Python preservation-measure suite failed:\n${e.stdout ?? ""}\n${
            e.stderr ?? e.message
          }`,
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
