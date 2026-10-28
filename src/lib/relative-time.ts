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
 *
 * Task 1340 gave the two SIBLING time questions the same owner, so no reader
 * spells its own:
 *
 *   - `formatWhen`       — "at what moment?": an absolute label that names the
 *                          day once the moment is not today ("3:15 PM" →
 *                          "Oct 25, 3:15 PM" → "Oct 25, 2025, 3:15 PM").
 *   - `describeDuration` — "how much time?": a duration that reads inside a
 *                          sentence ("47 minutes", "1h 30m", "3 days").
 *
 * `time-label-census.test.ts` holds the line: no Date locale formatter is
 * called outside this module.
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

export interface WhenOptions {
  /** Name the day only, never the clock time (a list row's date). */
  dateOnly?: boolean;
}

/**
 * "At what moment?" — an absolute label for a timestamp (ISO string or epoch
 * ms), relative to `now` only in how much of the date it needs to say:
 *
 *   same calendar day → "3:15 PM"            (dateOnly: "Today")
 *   same year         → "Oct 25, 3:15 PM"    (dateOnly: "Oct 25")
 *   otherwise         → "Oct 25, 2025, 3:15 PM" (dateOnly: "Oct 25, 2025")
 *
 * A clock time alone is only ever printed for today: on a surface that asks
 * the user to choose between two versions of their paper, "3:15 PM" for a
 * three-day-old copy reads as "this afternoon". Unparseable input yields "" —
 * a label that says nothing beats one that says "Invalid Date".
 */
export function formatWhen(
  t: string | number,
  now: number = Date.now(),
  opts: WhenOptions = {},
): string {
  const ms = typeof t === "number" ? t : new Date(t).getTime();
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const n = new Date(now);
  const sameYear = d.getFullYear() === n.getFullYear();
  const sameDay =
    sameYear && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  const time: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  if (sameDay) return opts.dateOnly ? "Today" : d.toLocaleTimeString(undefined, time);
  const date: Intl.DateTimeFormatOptions = sameYear
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" };
  return d.toLocaleString(undefined, opts.dateOnly ? date : { ...date, ...time });
}

/**
 * "How much time?" — a duration in MILLISECONDS, sentence-ready: "a few
 * seconds", "1 minute", "47 minutes", "1 hour", "1h 30m", "2 hours", and past a
 * day, whole days ("1 day", "3 days") — never "72h 5m". Floored, so it never
 * claims more time than has passed. Negative or non-finite input reads as
 * "a few seconds".
 */
export function describeDuration(ms: number): string {
  const mins = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 60_000)) : 0;
  if (mins < 1) return "a few seconds";
  if (mins === 1) return "1 minute";
  if (mins < 60) return `${mins} minutes`;
  const hours = Math.floor(mins / 60);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return days === 1 ? "1 day" : `${days} days`;
  }
  const rest = mins % 60;
  if (hours === 1 && rest === 0) return "1 hour";
  if (rest === 0) return `${hours} hours`;
  return `${hours}h ${rest}m`;
}
