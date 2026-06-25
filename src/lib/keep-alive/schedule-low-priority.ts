// Defer non-urgent work off the critical keep-alive re-show flip.
//
// When a kept-alive editor flips display:none→visible, the user-visible event is
// the display flip + the republish of cached geometry (synchronous, O(1)). Any
// genuinely-needed correction (a re-measure because the doc or container width
// changed while hidden — the rare "dirty" path) must NOT land as a long task on
// that synchronous transition. Schedule it here instead, after the visible paint.
//
// requestIdleCallback is preferred (runs in idle time, with a timeout so a busy
// main thread can't starve the correction). Browsers without it (Safari) fall
// back to a double-rAF (≈ "after the next paint"). Test/jsdom environments
// without either fall back to setTimeout(0) so deferred work still runs and is
// flushable. Returns a cancel function.

export function requestLowPriority(fn: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(() => fn(), { timeout: 200 });
    return () => cancelIdleCallback(id);
  }
  if (typeof requestAnimationFrame === "function") {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => fn());
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }
  const t = setTimeout(fn, 0);
  return () => clearTimeout(t);
}
