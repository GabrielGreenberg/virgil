/**
 * **The ONE write coalescer** (task 1327) — trailing debounce + maxWait +
 * flush, for every writer of the user's content.
 *
 * Task 1174 established a rule for the `.tex` autosave: *continuous typing
 * must still write*. A pure trailing debounce never fires during a burst with
 * no pause as long as its window, so the burst's FIRST arm is recorded and
 * every re-arm is capped at `maxWaitMs` from it. That rule was written as
 * private code inside `useDocument`, and every other writer — the sidecar
 * hook's card-body writes, the card editor's own upstream stage — kept a
 * hand-rolled `setTimeout` re-arm with no cap, so a long burst inside a card
 * reached disk only when the typist paused. The rule now lives here, once; the
 * writers own WHAT a fire does, never WHEN it happens.
 *
 * Semantics:
 * - `arm()` (re)starts the trailing window. The first arm of a burst stamps
 *   its start; each re-arm schedules `min(delayMs, burstStart + maxWaitMs −
 *   now)`, so a burst fires at least every `maxWaitMs`. A fire ENDS the burst
 *   (whichever path the fire body takes): an `arm()` from inside `fire` starts
 *   a fresh one — the shape `useDocument`'s pause re-arm relies on.
 * - `pending` is true from an arm until the timer fires or is cancelled. It is
 *   ALREADY false while `fire` runs: "armed", never "landed" — a writer's dirty
 *   predicate must also ask whether the write it handed off has landed.
 * - `flush()` fires a pending window synchronously (returns whether it did).
 * - `cancel()` disarms without firing; the payload is the caller's business.
 *
 * Keystroke sanctity: `arm()` is O(1) — one clearTimeout, one setTimeout, no
 * document read. The capped fire is the SAME `fire` as the trailing one.
 */

export interface WriteCoalescerOptions {
  /** The trailing window: this long without an `arm()` fires. */
  delayMs: number;
  /** The burst cap: a window armed continuously still fires this long after
   *  the burst's first arm. `Infinity` (the default) = a pure trailing
   *  debounce — only for state nothing reads while the doc is open. A cap
   *  shorter than `delayMs` is raised to it (lodash's rule): the cap bounds a
   *  burst, it never shortens a caller's chosen window. */
  maxWaitMs?: number;
  /** The write. Runs with the coalescer already disarmed. */
  fire: () => void;
  /** Where the window's timer is armed. Defaults to the global clock. An owner
   *  bound by the timer-lifetime law (a NodeView / React component's ONE
   *  `ViewLifetime`) passes its scope, so its teardown disarms the window and
   *  an arm after disposal arms nothing — the coalescer owns WHEN, the scope
   *  owns how long it may live. */
  scheduler?: CoalescerScheduler;
}

/** The two timer verbs a coalescer needs. `ViewLifetime` satisfies it. */
export interface CoalescerScheduler {
  setTimeout(cb: () => void, ms: number): unknown;
  clear(handle: never): void;
}

const GLOBAL_SCHEDULER = {
  setTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms),
  clear: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
};

export interface WriteCoalescer {
  arm(): void;
  flush(): boolean;
  cancel(): void;
  readonly pending: boolean;
}

export function createWriteCoalescer({
  delayMs,
  maxWaitMs = Infinity,
  fire,
  scheduler = GLOBAL_SCHEDULER as CoalescerScheduler,
}: WriteCoalescerOptions): WriteCoalescer {
  const cap = Math.max(maxWaitMs, delayMs);
  const clock = scheduler as {
    setTimeout(cb: () => void, ms: number): unknown;
    clear(handle: unknown): void;
  };
  let timer: unknown = null;
  let burstStart: number | null = null;

  const disarm = (): void => {
    if (timer !== null) clock.clear(timer);
    timer = null;
    burstStart = null;
  };

  const run = (): void => {
    timer = null;
    burstStart = null;
    fire();
  };

  return {
    arm() {
      if (timer !== null) clock.clear(timer);
      const now = Date.now();
      if (burstStart === null) burstStart = now;
      const delay = Math.max(0, Math.min(delayMs, burstStart + cap - now));
      timer = clock.setTimeout(run, delay);
    },
    flush() {
      if (timer === null) return false;
      clock.clear(timer);
      run();
      return true;
    },
    cancel: disarm,
    get pending() {
      return timer !== null;
    },
  };
}
