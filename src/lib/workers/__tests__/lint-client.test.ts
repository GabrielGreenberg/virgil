// Task 760 — a lint run always SETTLES WITH A REAL ANSWER.
//
// The worker client used to resolve every run stranded by a dying worker with
// `[]`, and the Errors panel read that as "No errors" until the next edit. And
// `runLint` could reject (a throwing syntax check sat outside its guard), which
// in the worker left the client's pending run hanging forever.

import { describe, it, expect, vi, afterEach } from "vitest";

// A paper with a structural error the pure-text checker always reports.
const TEXT = "\\begin{itemize}\n\\item one\n\nSome {unclosed text.\n";

type Listener = ((e: unknown) => void) | null;

/** A Worker stub: records posts; the test decides whether it answers,
 *  reports a failed pass, or dies. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: Listener = null;
  onerror: Listener = null;
  posted: Array<{ runId: number; text: string }> = [];
  terminated = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(msg: { runId: number; text: string }) {
    this.posted.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
}

async function freshClient() {
  vi.resetModules();
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
  return import("../lint-client");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("@/lib/syntax-check");
  vi.resetModules();
});

describe("lint-client — every run settles with a real answer (task 760)", () => {
  it("a worker death re-runs stranded requests on the main thread, not []", async () => {
    const { lintInWorker } = await freshClient();
    const { runLint } = await import("../latex-lint-core");
    const expected = await runLint(TEXT);
    expect(expected.length).toBeGreaterThan(0);

    const run = lintInWorker(TEXT);
    const w = FakeWorker.instances[0];
    expect(w.posted).toHaveLength(1);
    w.onerror?.(new Event("error"));

    await expect(run).resolves.toEqual(expected);
    expect(w.terminated).toBe(true);

    // The broken worker is not reused: a later call runs on the main thread.
    await expect(lintInWorker(TEXT)).resolves.toEqual(expected);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(w.posted).toHaveLength(1);
  });

  it("a worker-reported failed pass is re-done on the main thread", async () => {
    const { lintInWorker } = await freshClient();
    const { runLint } = await import("../latex-lint-core");
    const expected = await runLint(TEXT);

    const run = lintInWorker(TEXT);
    const w = FakeWorker.instances[0];
    const { runId } = w.posted[0];
    w.onmessage?.({ data: { runId, failed: true } });

    await expect(run).resolves.toEqual(expected);
  });

  it("a normal worker reply resolves with the worker's errors", async () => {
    const { lintInWorker } = await freshClient();
    const run = lintInWorker(TEXT);
    const w = FakeWorker.instances[0];
    const errors = [
      { id: "x", source: "lint", severity: "error", line: 1, message: "m" },
    ];
    w.onmessage?.({ data: { runId: w.posted[0].runId, errors } });
    await expect(run).resolves.toEqual(errors);
  });
});

// Task 1551 — superseded passes are coalesced at the client: one pass in
// flight, at most one queued request per lane.
describe("lint-client — superseded passes never reach the worker (task 1551)", () => {
  const errs = (tag: string) => [
    { id: tag, source: "lint", severity: "error", line: 1, message: tag },
  ];

  it("5 requests on one lane while a pass is in flight → exactly 2 passes; all settle", async () => {
    const { lintInWorker } = await freshClient();
    const lane = {};
    const runs = [1, 2, 3, 4, 5].map((n) => lintInWorker(`t${n}`, undefined, lane));
    const w = FakeWorker.instances[0];
    expect(w.posted.map((p) => p.text)).toEqual(["t1"]);

    w.onmessage?.({ data: { runId: w.posted[0].runId, errors: errs("t1") } });
    // The in-flight pass returned → only the LAST text is posted.
    expect(w.posted.map((p) => p.text)).toEqual(["t1", "t5"]);
    w.onmessage?.({ data: { runId: w.posted[1].runId, errors: errs("t5") } });

    const settled = await Promise.all(runs);
    expect(settled[0]).toEqual(errs("t1"));
    // The superseded requests settle with the newer text's REAL errors.
    for (const r of settled.slice(1)) expect(r).toEqual(errs("t5"));
    expect(w.posted).toHaveLength(2);
  });

  it("different lanes never answer each other", async () => {
    const { lintInWorker } = await freshClient();
    const a = {};
    const b = {};
    const first = lintInWorker("a1", undefined, a);
    const fromB = lintInWorker("b1", undefined, b);
    const fromA = lintInWorker("a2", undefined, a);
    const w = FakeWorker.instances[0];
    w.onmessage?.({ data: { runId: w.posted[0].runId, errors: errs("a1") } });
    expect(w.posted.map((p) => p.text)).toEqual(["a1", "b1"]);
    w.onmessage?.({ data: { runId: w.posted[1].runId, errors: errs("b1") } });
    expect(w.posted.map((p) => p.text)).toEqual(["a1", "b1", "a2"]);
    w.onmessage?.({ data: { runId: w.posted[2].runId, errors: errs("a2") } });
    await expect(first).resolves.toEqual(errs("a1"));
    await expect(fromB).resolves.toEqual(errs("b1"));
    await expect(fromA).resolves.toEqual(errs("a2"));
  });

  it("calls without a lane are never coalesced", async () => {
    const { lintInWorker } = await freshClient();
    void lintInWorker("x1");
    void lintInWorker("x2");
    void lintInWorker("x3");
    const w = FakeWorker.instances[0];
    for (let k = 0; k < 3; k++) {
      w.onmessage?.({ data: { runId: w.posted[k].runId, errors: [] } });
    }
    expect(w.posted.map((p) => p.text)).toEqual(["x1", "x2", "x3"]);
  });

  it("worker death mid-queue re-runs the in-flight AND queued requests on the main thread", async () => {
    const { lintInWorker } = await freshClient();
    const { runLint } = await import("../latex-lint-core");
    const expected = await runLint(TEXT);
    const lane = {};
    const inflight = lintInWorker("Plain text.", undefined, lane);
    const superseded = lintInWorker("Also plain.", undefined, lane);
    const last = lintInWorker(TEXT, undefined, lane);
    const w = FakeWorker.instances[0];
    expect(w.posted).toHaveLength(1);
    w.onerror?.(new Event("error"));

    await expect(inflight).resolves.toEqual(await runLint("Plain text."));
    await expect(superseded).resolves.toEqual(expected);
    await expect(last).resolves.toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
  });
});

describe("runLint never rejects (task 760)", () => {
  it("a throwing syntax check yields a parse-failure record", async () => {
    vi.resetModules();
    vi.doMock("@/lib/syntax-check", () => ({
      runSyntaxChecks: () => {
        throw new Error("boom");
      },
    }));
    const { runLint } = await import("../latex-lint-core");
    const errors = await runLint(TEXT);
    const failure = errors.find((e) => e.ruleId === "parse-failure");
    expect(failure).toBeDefined();
    expect(failure!.message).toContain("boom");
    expect(failure!.severity).toBe("error");
  });
});
