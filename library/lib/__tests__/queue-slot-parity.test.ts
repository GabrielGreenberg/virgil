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
import {
  isQueueRequestFilename,
  QUEUE_DONE_JSON_SUFFIX,
  QUEUE_KINDS,
  QUEUE_NON_REQUEST_FILENAMES,
  QUEUE_PENDING_STATUS,
  QUEUE_SLOT_SUFFIX,
} from "../queue";

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

describe("queue population — TS ↔ Python parity (task 794)", () => {
  const py = (expr: string) =>
    JSON.parse(
      run([
        "-c",
        [
          "import json, sys",
          `sys.path.insert(0, ${JSON.stringify(SCRIPTS)})`,
          "import queue_slot",
          `print(json.dumps(${expr}))`,
        ].join("\n"),
      ]),
    );

  it("the non-request exclusion set is stated once on each side, equal", () => {
    expect(py("list(queue_slot.NON_REQUEST_FILENAMES)")).toEqual([
      ...QUEUE_NON_REQUEST_FILENAMES,
    ]);
    expect(py("queue_slot.DONE_JSON_SUFFIX")).toBe(QUEUE_DONE_JSON_SUFFIX);
    expect(py("queue_slot.PENDING_STATUS")).toBe(QUEUE_PENDING_STATUS);
  });

  it("is_request_filename and isQueueRequestFilename agree name by name", () => {
    const names = [
      "pending-reviews.json",
      "smith2020.json",
      "smith2020-auth.json",
      "smith2020-deepindex.json",
      "smith2020-richindex.json",
      "_triage-foo.json",
      "smith2020.done",
      "smith2020.index.20260101T000000Z.done",
      "smith2020.done.json",
      "smith2020.lock",
    ];
    const pyVerdicts = py(
      `{n: queue_slot.is_request_filename(n) for n in ${JSON.stringify(names)}}`,
    );
    const tsVerdicts = Object.fromEntries(names.map((n) => [n, isQueueRequestFilename(n)]));
    expect(tsVerdicts).toEqual(pyVerdicts);
    expect(tsVerdicts["pending-reviews.json"]).toBe(false);
    expect(tsVerdicts["smith2020.json"]).toBe(true);
  });

  it("every Python-slotted kind is a TS QueueKind (triage has no citekey slot)", () => {
    const pyKinds = py("sorted(queue_slot.SLOT_SUFFIX)");
    expect([...pyKinds, "triage"].sort()).toEqual([...QUEUE_KINDS].sort());
  });
});
