/**
 * Lint Web Worker entry (perf Wave 1 / S5) — hosts the unified-latex parse
 * off the main thread. The parse of a large doc measured multi-second on
 * the main thread at 2,883 blocks; here it costs the UI nothing.
 *
 * Protocol: { runId, text, bibKeys } in → { runId, errors } out, or
 * { runId, failed: true } when the pass rejected anyway (`runLint` is
 * contracted never to reject — this is belt-and-braces so EVERY request
 * settles; the client re-runs a failed one on the main thread). The client
 * (lint-client.ts) matches runIds; stale results are dropped there.
 */

import { runLint } from "./latex-lint-core";

interface LintRequest {
  runId: number;
  text: string;
  bibKeys?: readonly string[];
}

self.onmessage = (e: MessageEvent<LintRequest>) => {
  const { runId, text, bibKeys } = e.data;
  const post = (msg: unknown) => (self as unknown as Worker).postMessage(msg);
  void runLint(text, bibKeys).then(
    (errors) => post({ runId, errors }),
    () => post({ runId, failed: true }),
  );
};
