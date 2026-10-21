// A polled reader's FAILURE EPISODE (task 1210).
//
// The Library read door (`library-storage.ts`) answers `undefined` for
// absence and REJECTS on a real failure (task 1115). A poll that re-reads
// every few seconds must therefore catch per tick — an uncaught rejection
// from a `void reload()` is an unhandled rejection every tick — and must keep
// its LAST-GOOD state rather than blanking (a fault is "unknown", not
// "empty"). This is the one place that decides how loudly a poll says so:
// once per episode (the first failing tick after a success), not once per
// tick. A successful tick closes the episode, so the next fault warns again.

export interface FaultEpisode {
  /** Record a failed tick; warns only on the episode's first failure. */
  fail(err: unknown): void;
  /** Record a successful tick; closes any open episode. */
  ok(): void;
}

export function faultEpisode(label: string): FaultEpisode {
  let open = false;
  return {
    fail(err) {
      if (open) return;
      open = true;
      console.warn(`[library] ${label}: read failed — keeping the last good state`, err);
    },
    ok() {
      open = false;
    },
  };
}
