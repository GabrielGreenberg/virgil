/**
 * The queue slot table is stated twice — `QUEUE_SLOT_SUFFIX` here (the app's
 * writer) and `SLOT_SUFFIX` in `library/scripts/queue_slot.py` (the skills'
 * writers and the drain) — because the two silos cannot import each other.
 * This file holds them equal (task 618). The Python half's own suite,
 * `library/scripts/tests/test_queue_slot_lifecycle.py`, is driven by the
 * python-suites census (`scripts/__tests__/python-suites.test.ts`).
 *
 * If `python3` is unavailable the test FAILS rather than skips.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { QUEUE_SLOT_SUFFIX } from "../queue";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SCRIPTS = path.join(REPO_ROOT, "library/scripts");

function run(args: string[]): string {
  try {
    return execFileSync("python3", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    throw new Error(`python3 failed:\n${e.stdout ?? ""}\n${e.stderr ?? e.message}`);
  }
}

describe("queue slot table — TS ↔ Python parity", () => {
  it("queue.ts QUEUE_SLOT_SUFFIX equals queue_slot.SLOT_SUFFIX", () => {
    const out = run([
      "-c",
      [
        "import json, sys",
        `sys.path.insert(0, ${JSON.stringify(SCRIPTS)})`,
        "import queue_slot",
        "print(json.dumps({k: (v or '') for k, v in queue_slot.SLOT_SUFFIX.items()}))",
      ].join("\n"),
    ]);
    expect(JSON.parse(out)).toEqual(QUEUE_SLOT_SUFFIX);
  });
});
