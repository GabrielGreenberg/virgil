/**
 * rafCoalesced — collapse a burst of imperative calls into ONE run on the
 * next animation frame.
 *
 * The held-backspace damper primitive (typing-latency fix 2c): a key-repeat
 * delete across N blocks fires a structural bus emit per block-merge tx, at
 * ~30/s. Handlers that do DOM-scale or render-triggering work (observed-set
 * resync, selection recompute, revision-counter setState) must not run per
 * emit — schedule() them instead, and the burst collapses to one trailing
 * run per frame. Backpressure is inherent: the longer the frame, the more
 * emits one run absorbs.
 *
 * SSR/test-safe: falls back to a 0 ms timeout when RAF is unavailable.
 */
export function rafCoalesced(fn: () => void): {
  /** Request a run; no-op if one is already pending this frame. */
  schedule: () => void;
  /** Cancel any pending run (unmount/teardown). */
  cancel: () => void;
} {
  let handle: number | null = null;
  let usedTimeout = false;

  const run = () => {
    handle = null;
    fn();
  };

  return {
    schedule() {
      if (handle !== null) return;
      if (typeof requestAnimationFrame === "function") {
        usedTimeout = false;
        handle = requestAnimationFrame(run);
      } else {
        usedTimeout = true;
        handle = setTimeout(run, 0) as unknown as number;
      }
    },
    cancel() {
      if (handle === null) return;
      if (!usedTimeout && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(handle);
      } else {
        clearTimeout(handle);
      }
      handle = null;
    },
  };
}
