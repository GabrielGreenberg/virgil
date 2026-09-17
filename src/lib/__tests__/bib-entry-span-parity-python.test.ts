/**
 * CI teeth for "where does a bib entry end?" in BOTH Python silos (task 614).
 *
 * Same arrangement as `unlink-tolerant-python.test.ts`: `npm test` is vitest, so
 * a Python guard is advisory until a vitest file shells out to it — and the
 * library silo's suites are run by no workflow at all.
 *
 * The two readers answer one corpus, `fixtures/bib-entry-span-corpus.json`:
 * the editor's `bib_resolve.find_entry_span` (whose old quote-toggling scan let
 * a German `{Grundz"uge}` run a library-sync swap through — and delete — the
 * entries after it) and the library's `_bib_parse.find_entry_span`. Neither can
 * import the other across the bundle seam, so this corpus is what keeps them
 * one rule.
 *
 * If `python3` is unavailable this FAILS rather than skips.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../..");

const SUITES: Array<[string, RegExp]> = [
  ["editor/scripts/tests/test_bib_entry_span_parity.py", /(\d+) passed, (\d+) failed/],
  ["library/scripts/tests/test_bib_entry_span_parity.py", /(\d+)\/(\d+) passed/],
];

describe("bib entry-span parity (Python, editor + library silos)", () => {
  for (const [rel, tally] of SUITES) {
    it(`passes ${rel}`, { timeout: 60_000 }, () => {
      let output: string;
      try {
        output = execFileSync("python3", [path.join(REPO_ROOT, rel)], {
          cwd: REPO_ROOT,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string; message: string };
        throw new Error(`${rel} failed:\n${e.stdout ?? ""}\n${e.stderr ?? e.message}`);
      }
      const m = output.match(tally);
      expect(m, `no pass tally in output:\n${output}`).not.toBeNull();
      const [, a, b] = m!;
      if (tally.source.includes("failed")) {
        expect(Number(a)).toBeGreaterThan(0);
        expect(Number(b)).toBe(0);
      } else {
        expect(Number(b)).toBeGreaterThan(0);
        expect(a).toBe(b);
      }
    });
  }
});
