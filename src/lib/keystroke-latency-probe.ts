// Keystroke-latency probe — the runtime half of the typing-responsiveness
// guardrail (companion CI guard: `src/lib/__tests__/editor-observer-guardrail.
// test.ts`; contract in AGENTS.md "Editor-observer stability"). It measures
// the number the user actually feels — keydown → pixels-on-screen — plus a
// work-attribution channel that names WHICH observer/measure sites ran on the
// keystroke path, so a regression is attributable from the dev console.
//
// Read it from the dev console while typing in the editor:
//   window.__keystrokeStats()
//   → { api, keystrokes, samples, p50, p95, max, over16, over32,
//       work: { "scrollbar-ro": { total, lastKeystroke, maxPerKeystroke }, … } }
//   window.__keystrokeStatsReset()
//
// Latency channel: prefers the Event Timing API (Chrome) — `entry.duration`
// on a `keydown` event entry is the browser's own input→next-presentation
// measurement, which no userland timer can replicate. Entries under the 16 ms
// observer threshold are NOT reported by the API; the percentile math counts
// the missing (keystrokes − samples) as "≤16 ms" values at the low end so
// p50/p95 are honest, not survivorship-biased toward the slow tail. Where
// Event Timing is unavailable (Safari/Firefox), a double-RAF fallback
// approximates post-paint and reports `api: "raf-fallback"` so readers know
// it under-measures presentation delay.
//
// Work channel: keystroke-path sites (the scrollbar geometry sync, the three
// content measurement observers) call `recordKeystrokeWork(siteId)` — a
// no-op in production. A fire is attributed to the current keystroke when it
// lands within ATTRIBUTION_WINDOW_MS of the last editor keydown. A healthy
// plain keystroke attributes ZERO fires; a wrap-changing keystroke attributes
// at most one per site.

/** Canonical work-site ids wired to record into the probe. */
export const KEYSTROKE_WORK_SCROLLBAR_RO = "scrollbar-ro";
export const KEYSTROKE_WORK_INTEXT_RO = "intext-ro";
export const KEYSTROKE_WORK_MARGINALIA_RO = "marginalia-ro";
export const KEYSTROKE_WORK_VIEWPORT_CACHE_RO = "viewport-cache-ro";

/** Event Timing entries below this duration are not delivered by the API. */
const EVENT_TIMING_THRESHOLD_MS = 16;
/** A work fire within this window of the last editor keydown is "on the keystroke". */
const ATTRIBUTION_WINDOW_MS = 100;
/** Ring-buffer cap for recorded durations (oldest evicted). */
const MAX_SAMPLES = 512;

export interface KeystrokeWorkStat {
  /** Lifetime fires (attributed or not). */
  total: number;
  /** Fires attributed to the most recent keystroke that saw any. */
  lastKeystroke: number;
  /** Max fires attributed to any single keystroke since reset. */
  maxPerKeystroke: number;
}

export interface KeystrokeStats {
  api: "event-timing" | "raf-fallback" | "none";
  /** Editor keydowns seen since reset (our own capture listener). */
  keystrokes: number;
  /** Measured durations since reset (Event Timing: only the ≥16 ms ones). */
  samples: number;
  /** Percentiles over ALL keystrokes — unmeasured ones count as ≤16 ms. */
  p50: number;
  p95: number;
  max: number;
  /** Keystrokes with a measured duration ≥16 ms / ≥32 ms. */
  over16: number;
  over32: number;
  work: Record<string, KeystrokeWorkStat>;
}

interface WorkState {
  total: number;
  /** The keystroke sequence number fires are currently accumulating under. */
  seqSeen: number;
  countThisKeystroke: number;
  lastKeystroke: number;
  maxPerKeystroke: number;
}

// Dev/test only — production pays a single boolean check per recordKeystrokeWork
// call and installs no listeners or observers.
const enabled =
  typeof window !== "undefined" && process.env.NODE_ENV !== "production";

let installed = false;
let api: KeystrokeStats["api"] = "none";

let keystrokes = 0;
let keystrokeSeq = 0;
let lastKeydownTs = -Infinity;
/** Durations of measured keystrokes (ms), unsorted ring buffer. */
let durations: number[] = [];
let over32Count = 0;
let maxDuration = 0;

const work = new Map<string, WorkState>();

/** RAF-fallback: one in-flight sample at a time. */
let rafPending = false;

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function getWork(siteId: string): WorkState {
  let s = work.get(siteId);
  if (!s) {
    s = {
      total: 0,
      seqSeen: -1,
      countThisKeystroke: 0,
      lastKeystroke: 0,
      maxPerKeystroke: 0,
    };
    work.set(siteId, s);
  }
  return s;
}

function recordKeydown(): void {
  keystrokes++;
  keystrokeSeq++;
  lastKeydownTs = now();
}

function recordDuration(ms: number): void {
  if (durations.length >= MAX_SAMPLES) durations.shift();
  durations.push(ms);
  if (ms >= 32) over32Count++;
  if (ms > maxDuration) maxDuration = ms;
}

/**
 * Percentile over the union of measured samples and the (keystrokes − samples)
 * unmeasured keystrokes, each of which counts as a ≤16 ms value at the low
 * end. With the RAF fallback every keystroke is measured, so the fill-in set
 * is empty and this is a plain percentile.
 */
function percentile(p: number): number {
  const sorted = [...durations].sort((a, b) => a - b);
  const measured = sorted.length;
  const total = Math.max(keystrokes, measured);
  if (total === 0) return 0;
  const fillIn = total - measured;
  const idx = Math.min(total - 1, Math.max(0, Math.ceil(p * total) - 1));
  if (idx < fillIn) return EVENT_TIMING_THRESHOLD_MS; // "≤16 ms" bucket
  return sorted[idx - fillIn];
}

function snapshot(): KeystrokeStats {
  const workOut: Record<string, KeystrokeWorkStat> = {};
  for (const [id, s] of work) {
    workOut[id] = {
      total: s.total,
      lastKeystroke:
        s.seqSeen === keystrokeSeq ? s.countThisKeystroke : s.lastKeystroke,
      maxPerKeystroke: s.maxPerKeystroke,
    };
  }
  return {
    api,
    keystrokes,
    samples: durations.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: maxDuration,
    over16: durations.filter((d) => d >= EVENT_TIMING_THRESHOLD_MS).length,
    over32: over32Count,
    work: workOut,
  };
}

function reset(): void {
  keystrokes = 0;
  keystrokeSeq = 0;
  lastKeydownTs = -Infinity;
  durations = [];
  over32Count = 0;
  maxDuration = 0;
  work.clear();
  rafPending = false;
}

function isEditorTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest(".ProseMirror") !== null
  );
}

/** Event Timing entry shape (lib.dom doesn't ship it everywhere). */
interface EventTimingEntryLike extends PerformanceEntry {
  target?: Node | null;
}

function handleEventTimingEntry(entry: EventTimingEntryLike): void {
  if (entry.name !== "keydown") return;
  // Target can be null after DOM churn; fall back to "an editor keydown just
  // happened" so we don't drop slow samples (the ones we care most about).
  const inEditor =
    entry.target != null
      ? isEditorTarget(entry.target)
      : now() - lastKeydownTs <= 500;
  if (!inEditor) return;
  recordDuration(entry.duration);
}

function onKeydownCapture(e: KeyboardEvent): void {
  if (!isEditorTarget(e.target)) return;
  recordKeydown();
  if (api === "raf-fallback" && !rafPending) {
    rafPending = true;
    const t0 = now();
    // Double RAF ≈ after the next frame's paint. Under-measures compositor
    // presentation delay; good enough as a cross-browser floor.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        rafPending = false;
        recordDuration(now() - t0);
      });
    });
  }
}

/**
 * Install the probe (idempotent). Called from the editor's probe effect next
 * to `installBusStatsProbe()` — dev/test only, no-op in production.
 */
export function installKeystrokeLatencyProbe(): void {
  if (!enabled || installed) return;
  installed = true;

  window.addEventListener("keydown", onKeydownCapture, {
    capture: true,
    passive: true,
  });

  const supported =
    typeof PerformanceObserver !== "undefined" &&
    Array.isArray(PerformanceObserver.supportedEntryTypes) &&
    PerformanceObserver.supportedEntryTypes.includes("event");
  if (supported) {
    api = "event-timing";
    try {
      const po = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          handleEventTimingEntry(entry as EventTimingEntryLike);
        }
      });
      // durationThreshold floors at 16 in Chrome; passing it explicitly
      // documents the sub-threshold fill-in contract in `percentile()`.
      po.observe({ type: "event", durationThreshold: 16 } as PerformanceObserverInit);
    } catch {
      api = "raf-fallback";
    }
  } else {
    api = "raf-fallback";
  }

  (
    window as unknown as {
      __keystrokeStats?: () => KeystrokeStats;
      __keystrokeStatsReset?: () => void;
    }
  ).__keystrokeStats = snapshot;
  (
    window as unknown as { __keystrokeStatsReset?: () => void }
  ).__keystrokeStatsReset = reset;
}

/**
 * Record one fire of a keystroke-path work site (observer callback, geometry
 * sync, measurement pass). Attributed to the current keystroke when it lands
 * within the attribution window of the last editor keydown. No-op in
 * production; call it unconditionally — the disabled cost is one boolean.
 */
export function recordKeystrokeWork(siteId: string): void {
  if (!enabled) return;
  const s = getWork(siteId);
  s.total++;
  if (now() - lastKeydownTs > ATTRIBUTION_WINDOW_MS) return;
  if (s.seqSeen !== keystrokeSeq) {
    s.seqSeen = keystrokeSeq;
    s.countThisKeystroke = 0;
  }
  s.countThisKeystroke++;
  s.lastKeystroke = s.countThisKeystroke;
  if (s.countThisKeystroke > s.maxPerKeystroke) {
    s.maxPerKeystroke = s.countThisKeystroke;
  }
}

/** Read the current stats directly (tests and callers without `window`). */
export function readKeystrokeStats(): KeystrokeStats {
  return snapshot();
}

// ── Test-support hooks ─────────────────────────────────────────────────────
// The unit test drives the SAME internal state machine the real listener/
// PerformanceObserver wiring drives, so the pinned math is production logic.

/** @internal test-only — clear all probe state (including install flag). */
export function __resetKeystrokeProbeForTest(): void {
  reset();
  installed = false;
  api = "none";
}

/** @internal test-only — simulate an editor keydown. */
export function __recordKeydownForTest(): void {
  recordKeydown();
}

/** @internal test-only — simulate a delivered Event Timing duration (ms). */
export function __recordEntryForTest(durationMs: number): void {
  recordDuration(durationMs);
}

/** @internal test-only — rewind the last-keydown timestamp by `ms`. */
export function __ageLastKeydownForTest(ms: number): void {
  lastKeydownTs -= ms;
}
