/**
 * Lint worker client (perf Wave 1 / S5).
 *
 * `lintInWorker(text, bibKeys, lane)` runs the pure lint pass in a lazy
 * singleton Web Worker — moving the ~1MB unified-latex bundle AND the
 * multi-second large-doc parse off the main thread — with a transparent
 * main-thread fallback (SSR, vitest, or Worker construction failure).
 *
 * COALESCING (task 1551): dropping a stale RESULT (the consumer's runId) does
 * not drop the stale WORK — the worker runs its messages in order, so a burst
 * of typing pauses shorter than one pass used to enqueue one full parse per
 * pause, and the panel showed text several pauses old. So the client keeps at
 * most ONE pass in flight and, per LANE, at most ONE queued request: a newer
 * request on the same lane REPLACES the queued one, and the superseded
 * caller's promise rides along with it (settling with the newer text's real
 * errors, which its consumer drops by runId anyway). A lane is one consumer's
 * identity (one `useLatexLint` instance — one pane); requests with no lane
 * never coalesce, so one pane's text can never answer another pane's call.
 *
 * CONTRACT (task 760): every call SETTLES WITH A REAL ANSWER. A pending run
 * keeps its own request (text + bibKeys), so when the worker dies, or
 * reports that a pass failed, the run is re-done on the main thread — never
 * resolved empty. An empty list is indistinguishable from "this paper has no
 * errors", and the consumer would show exactly that until the next edit.
 * The queued slots are covered too: a worker death re-runs them on the main
 * thread alongside the in-flight pass.
 */

import type { LatexError } from "@/lib/latex-errors";

interface PendingRun {
  text: string;
  bibKeys?: readonly string[];
  /** Every caller this pass answers: its own, plus any it superseded. */
  resolvers: Array<(errors: LatexError[]) => void>;
}

type WorkerReply =
  | { runId: number; errors: LatexError[] }
  | { runId: number; failed: true };

let worker: Worker | null = null;
let workerBroken = false;
let nextRunId = 1;
/** The ONE pass the worker is running (it is serial; posting more only queues). */
let inFlight: { runId: number; run: PendingRun } | null = null;
/** At most one waiting request per lane, served in arrival order. */
const queued = new Map<unknown, PendingRun>();

function resolveAll(run: PendingRun, errors: LatexError[]): void {
  for (const resolve of run.resolvers) resolve(errors);
}

/** The main-thread path. `runLint` never rejects, so this always settles. */
async function lintOnMainThread(
  text: string,
  bibKeys?: readonly string[],
): Promise<LatexError[]> {
  const { runLint } = await import("./latex-lint-core");
  return runLint(text, bibKeys);
}

function settleOnMainThread(run: PendingRun): void {
  void lintOnMainThread(run.text, run.bibKeys).then((errors) =>
    resolveAll(run, errors),
  );
}

/** Post the oldest queued request if the worker is idle. */
function pump(w: Worker): void {
  if (inFlight) return;
  const next = queued.entries().next();
  if (next.done) return;
  const [lane, run] = next.value;
  queued.delete(lane);
  const runId = nextRunId++;
  inFlight = { runId, run };
  w.postMessage({ runId, text: run.text, bibKeys: run.bibKeys });
}

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  if (typeof Worker === "undefined") return null;
  try {
    // Bundler-visible worker entry. The specifier must stay EXTENSION-LESS:
    // Turbopack (Next 16.2) compiles `new Worker(new URL(...))` into a real
    // worker chunk only for an extension-less specifier — with an explicit
    // ".ts" it silently routes the file through the static-asset pipeline
    // instead, shipping RAW TypeScript that dies at parse time in the worker
    // and drops every lint onto the main thread via the fallback below.
    worker = new Worker(new URL("./latex-lint.worker", import.meta.url));
    const w = worker;
    w.onmessage = (e: MessageEvent<WorkerReply>) => {
      if (!inFlight || inFlight.runId !== e.data.runId) return;
      const { run } = inFlight;
      inFlight = null;
      if ("errors" in e.data) resolveAll(run, e.data.errors);
      else settleOnMainThread(run);
      pump(w);
    };
    w.onerror = () => {
      // Construction succeeded but the worker died (CSP, bundling issue,
      // OOM). Stop using it, and re-run every stranded request — the
      // in-flight pass AND every queued slot — on the main thread; each
      // carries its own text for exactly this.
      workerBroken = true;
      const stranded = [...(inFlight ? [inFlight.run] : []), ...queued.values()];
      inFlight = null;
      queued.clear();
      w.terminate();
      worker = null;
      for (const run of stranded) settleOnMainThread(run);
    };
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

/**
 * Lint `text`. `lane` names the caller (one consumer, e.g. one pane's
 * `useLatexLint`): a newer request on the same lane supersedes a queued older
 * one, which then settles with the newer result. Omit it and the request is
 * its own lane — run in full, never coalesced.
 */
export async function lintInWorker(
  text: string,
  bibKeys?: readonly string[],
  lane: unknown = Symbol("lint-lane"),
): Promise<LatexError[]> {
  const w = getWorker();
  if (!w) return lintOnMainThread(text, bibKeys);
  return new Promise<LatexError[]>((resolve) => {
    const superseded = queued.get(lane);
    // Re-insert so a lane that keeps typing does not jump ahead of lanes
    // that were already waiting.
    queued.delete(lane);
    queued.set(lane, {
      text,
      bibKeys,
      resolvers: [...(superseded?.resolvers ?? []), resolve],
    });
    pump(w);
  });
}
