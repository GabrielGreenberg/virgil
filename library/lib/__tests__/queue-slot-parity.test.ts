/**
 * The queue slot table is stated twice — `QUEUE_SLOT_SUFFIX` here (the app's
 * writer) and `SLOT_SUFFIX` in `library/scripts/queue_slot.py` (the skills'
 * writers and the drain) — because the two silos cannot import each other.
 * This file holds them equal, and runs the Python half's suite, which nothing
 * else in `npm test` would (task 618).
 *
 * If `python3` is unavailable the test FAILS rather than skips (the
 * `f4-write-gate-python.test.ts` rule).
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

describe("queue slot lifecycle (Python)", () => {
  it("passes library/scripts/tests/test_queue_slot_lifecycle.py", () => {
    const output = run([path.join(SCRIPTS, "tests/test_queue_slot_lifecycle.py")]);
    // Two runner forms (pytest when importable, else the standalone runner).
    const both = output.match(/(\d+)\/(\d+) passed/);
    const pytest = output.match(/(\d+) passed/);
    if (both) {
      expect(Number(both[2])).toBeGreaterThan(0);
      expect(both[1]).toBe(both[2]);
    } else {
      expect(pytest, `no pass tally in output:\n${output}`).not.toBeNull();
      expect(Number(pytest![1])).toBeGreaterThan(0);
      expect(output).not.toMatch(/\b\d+ (failed|error)/);
    }
  }, 60_000);
});
