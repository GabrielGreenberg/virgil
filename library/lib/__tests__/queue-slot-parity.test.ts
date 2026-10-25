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
  QUEUE_PENDING_REVIEWS_FILENAME,
  isQueueEntryInFlight,
  QUEUE_LIVE_STATUSES,
  QUEUE_PENDING_STATUS,
  QUEUE_RUNNING_TTL_MS,
  QUEUE_SLOT_SUFFIX,
  queueSlotKinds,
  withPendingReview,
  withoutPendingReview,
} from "../queue";
import { readdirSync, readFileSync } from "node:fs";

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

describe("live request + in-flight claim — one predicate per silo, equal (task 1291)", () => {
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

  it("LIVE_STATUSES and the claim TTL are stated equal", () => {
    expect(py("list(queue_slot.LIVE_STATUSES)")).toEqual([...QUEUE_LIVE_STATUSES]);
    expect(py("queue_slot.RUNNING_TTL_SECONDS") * 1000).toBe(QUEUE_RUNNING_TTL_MS);
    expect(py("queue_slot.RUNNING_STATUS")).toBe("running");
  });

  it("slot_kinds and queueSlotKinds agree kind by kind", () => {
    const kinds = Object.keys(QUEUE_SLOT_SUFFIX) as (keyof typeof QUEUE_SLOT_SUFFIX)[];
    const pyKinds = py(
      `{k: list(queue_slot.slot_kinds(k)) for k in ${JSON.stringify(kinds)}}`,
    );
    expect(Object.fromEntries(kinds.map((k) => [k, queueSlotKinds(k)]))).toEqual(pyKinds);
  });

  it("is_in_flight and isQueueEntryInFlight agree entry by entry", () => {
    const now = Date.parse("2026-10-25T12:00:00Z");
    const entries = [
      { status: "running" },
      { status: "running", startedAt: "2026-10-25T11:30:00Z" },
      { status: "running", startedAt: "2026-10-25T10:00:00Z" },
      { status: "running", startedAt: "garbage" },
      { status: "requested", startedAt: "2026-10-25T11:59:00Z" },
      { status: "failed" },
    ];
    const pyVerdicts = py(
      `[queue_slot.is_in_flight(e, ${now / 1000}) for e in ${JSON.stringify(entries)}]`,
    );
    expect(
      entries.map((e) => isQueueEntryInFlight(e as Parameters<typeof isQueueEntryInFlight>[0], now)),
    ).toEqual(pyVerdicts);
    expect(pyVerdicts).toEqual([true, true, false, true, false, false]);
  });
});

describe("review manifest — one door per silo, same arithmetic (task 1041)", () => {
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

  it("names the same file", () => {
    expect(py("queue_slot.PENDING_REVIEWS_FILENAME")).toBe(QUEUE_PENDING_REVIEWS_FILENAME);
    expect(py("queue_slot.REVIEW_KIND")).toBe("authenticate");
  });

  // Malformed rows, a duplicate, an apostrophe citekey, a non-list field.
  const docs: unknown[] = [
    null,
    {},
    { pendingReviews: "not-a-list" },
    {
      pendingReviews: [
        null,
        3,
        "s",
        { requestedAt: "no-citekey" },
        { citekey: "o'neill2020", requestedAt: "a" },
        { citekey: "smith2020", requestedAt: "b" },
        { citekey: "o'neill2020", requestedAt: "c" },
        { citekey: "Tichy\u0301" + "2001", requestedAt: "d" },
      ],
    },
  ];
  // NFC query against an NFD row: the two silos must agree it matches.
  const keys = ["o'neill2020", "smith2020", "absent", "Tich\u00fd2001"];

  it("withoutPendingReview ≡ without_pending_review", () => {
    for (const doc of docs) {
      for (const k of keys) {
        const arg = JSON.stringify(JSON.stringify(doc));
        expect(
          py(`queue_slot.without_pending_review(json.loads(${arg}), ${JSON.stringify(k)})`),
        ).toEqual(withoutPendingReview(doc, k));
      }
    }
  });

  it("withPendingReview ≡ with_pending_review", () => {
    for (const doc of docs) {
      for (const k of keys) {
        const arg = JSON.stringify(JSON.stringify(doc));
        expect(
          py(`queue_slot.with_pending_review(json.loads(${arg}), ${JSON.stringify(k)}, "T")`),
        ).toEqual(withPendingReview(doc, k, "T"));
      }
    }
  });

  it("no skill's code block touches the manifest — skills go through queue_slot.py", () => {
    const offenders: string[] = [];
    for (const dir of ["library/skills", "editor/skills"]) {
      const abs = path.join(REPO_ROOT, dir);
      for (const name of readdirSync(abs, { recursive: true }) as string[]) {
        if (!name.endsWith(".md")) continue;
        const text = readFileSync(path.join(abs, name), "utf8");
        for (const block of text.match(/```[\s\S]*?```/g) ?? []) {
          if (block.includes(QUEUE_PENDING_REVIEWS_FILENAME)) offenders.push(`${dir}/${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
