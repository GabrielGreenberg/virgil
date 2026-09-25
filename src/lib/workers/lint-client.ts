/**
 * Lint worker client (perf Wave 1 / S5).
 *
 * `lintInWorker(text, bibKeys)` runs the pure lint pass in a lazy singleton
 * Web Worker — moving the ~1MB unified-latex bundle AND the multi-second
 * large-doc parse off the main thread — with a transparent main-thread
 * fallback (SSR, vitest, or Worker construction failure). Each call gets a
 * fresh runId; a caller that fires again before the previous result lands
 * simply resolves both promises with their own results — the *consumer*
 * (useLatexLint) already supersedes stale results by its own runId, so no
 * cancellation protocol is needed here.
 *
 * CONTRACT (task 760): every call SETTLES WITH A REAL ANSWER. A pending run
 * keeps its own request (text + bibKeys), so when the worker dies, or
 * reports that a pass failed, the run is re-done on the main thread — never
 * resolved empty. An empty list is indistinguishable from "this paper has no
 * errors", and the consumer would show exactly that until the next edit.
 */

import type { LatexError } from "@/lib/latex-errors";

interface PendingRun {
  text: string;
  bibKeys?: readonly string[];
  resolve: (errors: LatexError[]) => void;
}

type WorkerReply =
  | { runId: number; errors: LatexError[] }
  | { runId: number; failed: true };

let worker: Worker | null = null;
let workerBroken = false;
let nextRunId = 1;
const pending = new Map<number, PendingRun>();

/** The main-thread path. `runLint` never rejects, so this always settles. */
async function lintOnMainThread(
  text: string,
  bibKeys?: readonly string[],
): Promise<LatexError[]> {
  const { runLint } = await import("./latex-lint-core");
  return runLint(text, bibKeys);
}

function settleOnMainThread(run: PendingRun): void {
  void lintOnMainThread(run.text, run.bibKeys).then(run.resolve);
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
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const run = pending.get(e.data.runId);
      if (!run) return;
      pending.delete(e.data.runId);
      if ("errors" in e.data) run.resolve(e.data.errors);
      else settleOnMainThread(run);
    };
    worker.onerror = () => {
      // Construction succeeded but the worker died (CSP, bundling issue,
      // OOM). Stop using it, and re-run every stranded request on the main
      // thread — each pending entry carries its own text for exactly this.
      workerBroken = true;
      const stranded = [...pending.values()];
      pending.clear();
      worker?.terminate();
      worker = null;
      for (const run of stranded) settleOnMainThread(run);
    };
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

export async function lintInWorker(
  text: string,
  bibKeys?: readonly string[],
): Promise<LatexError[]> {
  const w = getWorker();
  if (!w) return lintOnMainThread(text, bibKeys);
  const runId = nextRunId++;
  return new Promise<LatexError[]>((resolve) => {
    pending.set(runId, { text, bibKeys, resolve });
    w.postMessage({ runId, text, bibKeys });
  });
}

