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
 */

import type { LatexError } from "@/lib/latex-errors";

let worker: Worker | null = null;
let workerBroken = false;
let nextRunId = 1;
const pending = new Map<number, (errors: LatexError[]) => void>();

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  if (typeof Worker === "undefined") return null;
  try {
    // Bundler-visible worker entry (webpack + Turbopack both support the
    // `new Worker(new URL(...))` form — see next/dist/docs turbopack §Magic
    // Comments for the compatibility contract).
    worker = new Worker(new URL("./latex-lint.worker.ts", import.meta.url));
    worker.onmessage = (
      e: MessageEvent<{ runId: number; errors: LatexError[] }>,
    ) => {
      const resolve = pending.get(e.data.runId);
      if (resolve) {
        pending.delete(e.data.runId);
        resolve(e.data.errors);
      }
    };
    worker.onerror = () => {
      // Construction succeeded but the worker died (CSP, bundling issue).
      // Fail every pending run over to the main-thread path and stop using
      // the worker for future calls.
      workerBroken = true;
      const stranded = [...pending.entries()];
      pending.clear();
      worker?.terminate();
      worker = null;
      for (const [, resolve] of stranded) {
        // Resolve with a re-run on the main thread rather than dropping.
        void import("./latex-lint-core").then(({ runLint }) => {
          // Text is gone — the consumer's next debounce re-runs anyway;
          // resolve empty to unblock.
          void runLint;
          resolve([]);
        });
      }
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
  if (!w) {
    const { runLint } = await import("./latex-lint-core");
    return runLint(text, bibKeys);
  }
  const runId = nextRunId++;
  return new Promise<LatexError[]>((resolve) => {
    pending.set(runId, resolve);
    w.postMessage({ runId, text, bibKeys });
  });
}
