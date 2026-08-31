/**
 * CI teeth for the LIBRARY silo's refused-delete policy (task 496).
 *
 * The library's python suites live under `library/scripts/tests/`, and — unlike
 * the editor's — NOTHING in CI loops over them, so this wrapper is the only net.
 * Same shape as `bib-state-read-door-python.test.ts`.
 *
 * What it protects: `drain_queue`'s three deletes (a `finally:` lock unlink that
 * could replace an entry's result with an OSError, `_mark_done`'s entry unlink,
 * and the rename-fallback that could itself raise) plus the census that keeps a
 * sixth site from being added without asking the shared helper.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SUITE = path.join(REPO_ROOT, "library/scripts/tests/test_unlink_tolerant.py");

describe("refused-delete policy (Python, library silo)", () => {
  it(
    "passes library/scripts/tests/test_unlink_tolerant.py",
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
          `Python library refused-delete suite failed:\n${e.stdout ?? ""}\n${
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
