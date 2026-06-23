// Lightweight, flag-gated instrumentation for the library data layer.
//
// Off by default (zero cost). Turn on in the browser console with:
//     localStorage.setItem("virgil:lib-perf", "1")
// then reload. Timings print as `[lib-perf] <label> <ms>` so the cold
// master.bib parse, catalog read, and merge cost are visible on the real
// FSA library (the dev preview can't load it; this is how you confirm the
// browse-index win in production). See MEMO_LIBRARY_SCALE_RESEARCH.md.

function enabled(): boolean {
  try {
    // A global escape hatch for non-DOM contexts / quick toggling.
    if ((globalThis as { __VIRGIL_LIB_PERF?: boolean }).__VIRGIL_LIB_PERF) return true;
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem("virgil:lib-perf") === "1";
  } catch {
    return false;
  }
}

function report(label: string, deltaMs: number, extra?: string): void {
  console.log(
    `%c[lib-perf]%c ${label} %c${deltaMs.toFixed(1)} ms${extra ? "  " + extra : ""}`,
    "color:#b5651d;font-weight:bold",
    "color:inherit",
    "color:#b5651d",
  );
}

/** Time a synchronous block. Returns the block's value; logs only when the
 *  `virgil:lib-perf` flag is on. `extra` is computed lazily from the result. */
export function libPerf<T>(label: string, fn: () => T, extra?: (v: T) => string): T {
  if (!enabled()) return fn();
  const t0 = performance.now();
  const v = fn();
  report(label, performance.now() - t0, extra?.(v));
  return v;
}

/** Time an async block (e.g. an FSA read). */
export async function libPerfAsync<T>(
  label: string,
  fn: () => Promise<T>,
  extra?: (v: T) => string,
): Promise<T> {
  if (!enabled()) return fn();
  const t0 = performance.now();
  const v = await fn();
  report(label, performance.now() - t0, extra?.(v));
  return v;
}
