/**
 * Relative time — the ONE owner of "how long ago, as a short label" (task 866).
 *
 * Before this module the app carried five hand-written formatters (the start
 * screen's recent papers, its twin in the tab-strip "+" menu, the AI window,
 * the Stack thumbnail, the collab pen pill), each with its own bucketing: some
 * floored and some rounded, "now" began at 5 s, 30 s, 45 s or 60 s, and only
 * two knew about weeks. They now read ONE ladder, in one of two REGISTERS:
 *
 *   - `long`    — sentence-ready: "just now", "5m ago", "3w ago".
 *   - `compact` — chip-sized:     "now",      "5m",     "3w".
 *
 * The ladder (floored, so a label never claims more time than has passed):
 *
 *   < 60 s → now · < 60 m → Nm · < 24 h → Nh · < 7 d → Nd · < 5 w → Nw
 *   · < 12 mo (30-day months) → Nmo · otherwise Ny
 *
 * Two options, each a register-independent refinement rather than a second
 * ladder: `seconds` resolves the sub-minute bucket for a LIVE duration (the
 * pen pill's idle timer — "now" under 5 s, then "Ns"), and `dateAfterDays`
 * swaps the tail of the ladder for a locale date once an item is old enough
 * that "7mo ago" says less than the date would (the AI window).
 */

export type RelativeTimeRegister = "long" | "compact";

export interface RelativeTimeOptions {
  /** Defaults to `"long"`. */
  register?: RelativeTimeRegister;
  /** Resolve the sub-minute bucket as "Ns" (below 5 s it stays "now"). */
  seconds?: boolean;
  /** At or beyond this many days, show the locale date instead. Needs a
   *  timestamp, so only `formatRelativeTime` honours it. */
  dateAfterDays?: number;
}

const NOW_LABEL: Record<RelativeTimeRegister, string> = {
  long: "just now",
  compact: "now",
};

/** Below this many seconds a `seconds` ladder still says "now". */
const SECONDS_NOW_FLOOR = 5;

/**
 * Format an elapsed duration in SECONDS. Negative or non-finite input reads as
 * zero elapsed ("now") rather than a nonsense label; `null` reads as unknown
 * ("").
 */
export function formatElapsed(
  elapsedSec: number | null,
  opts: RelativeTimeOptions = {},
): string {
  if (elapsedSec == null) return "";
  const register = opts.register ?? "long";
  const suffix = register === "long" ? " ago" : "";
  const sec = Number.isFinite(elapsedSec)
    ? Math.max(0, Math.floor(elapsedSec))
    : 0;
  if (sec < 60) {
    if (opts.seconds && sec >= SECONDS_NOW_FLOOR) return `${sec}s${suffix}`;
    return NOW_LABEL[register];
  }
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m${suffix}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${suffix}`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d${suffix}`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w${suffix}`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo${suffix}`;
  // 360–364 days is past twelve 30-day months but short of 365: the old
  // copies printed "0y ago" there. A year bucket is never below one.
  return `${Math.max(1, Math.floor(d / 365))}y${suffix}`;
}

/**
 * Format how long ago an ISO timestamp was, relative to `now` (ms). An
 * unparseable timestamp yields "" — a label that says nothing beats one that
 * says something false. A future timestamp (clock skew) reads as "now".
 */
export function formatRelativeTime(
  iso: string,
  opts: RelativeTimeOptions = {},
  now: number = Date.now(),
): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const elapsedSec = Math.max(0, (now - then) / 1000);
  if (
    opts.dateAfterDays != null &&
    elapsedSec >= opts.dateAfterDays * 86_400
  ) {
    return new Date(then).toLocaleDateString();
  }
  return formatElapsed(elapsedSec, opts);
}
