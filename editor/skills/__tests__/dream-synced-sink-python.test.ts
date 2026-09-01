/**
 * CI teeth for the dev-loop's SYNCED mailbox (task 521).
 *
 * Same arrangement — and the same reason — as `unlink-tolerant-python.test.ts`:
 * `npm test` is vitest, so a Python guard is advisory until a vitest file
 * shells out to it. That gap is sharper here than usual: the dream/reflect
 * suites are the ONLY editor-silo family with no wrapper at all, so before this
 * file every contract about where memos go was enforced by nothing a `npx
 * vitest run` could see — which is precisely how a writer and a reader came to
 * disagree about the mailbox for thirteen days.
 *
 * What this drives: the ladder (`VIRGIL_INBOX` → Dropbox → CloudStorage → the
 * documented `~/Virgil-Inbox` symlink → the local checkout), the honesty flag
 * that SAYS which rung answered, the corpus UNION over every sink this build
 * does not write to, and the write-once courtesy copy of the nightly digest.
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
  "editor/scripts/tests/test_dream_synced_sink.py",
);

describe("dev-loop synced mailbox (Python, editor silo)", () => {
  it(
    "passes editor/scripts/tests/test_dream_synced_sink.py",
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
      expect(
        r.status,
        `Python synced-sink suite failed:\n${output}`,
      ).toBe(0);
      expect(output, output).toMatch(/^OK$/m);
      // …and a FLOOR, because "OK" is what a suite gutted down to one leg also
      // prints. The number is a floor rather than an equality so adding a leg
      // is not a two-file change; it only ever moves up.
      const ran = output.match(/Ran (\d+) tests?/);
      expect(ran, `no test tally in output:\n${output}`).not.toBeNull();
      expect(Number(ran![1])).toBeGreaterThanOrEqual(35);
    },
  );
});
