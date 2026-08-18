/**
 * **The pomodoro session store** — the ONE piece of state behind the Virgil
 * bar's timer (task 354).
 *
 * ## Why a store and not `useState` in the bar
 *
 * `TopBar` / `TabStrip` / `StatusCluster` are each `memo`ized deliberately, so
 * that background ticks (the compile spinner, the AI dot, a warm pane's
 * `pdfStale` flip) do not re-execute the bar's JSX tree. A timer threaded
 * through `StatusClusterProps` would undo exactly that: every start, pause and
 * — worse — every second would arrive as a new prop and repaint the whole bar.
 *
 * So the timer is PUBLISHED and its two bar residents ask, through
 * `useSyncExternalStore`. Both of them take **no props at all**
 * ([PomodoroTimer.tsx](../components/PomodoroTimer.tsx)), which is what makes
 * the perf claim structural rather than careful: there is no prop for the
 * timer to change, so `StatusCluster` cannot re-render because of it — not on
 * a tick, and not on a toggle either. The same shape the preservation notice
 * and the external-change badge already have.
 *
 * ## The clock is TIMESTAMPS, never accumulated ticks
 *
 * > **A running timer is `endAt`; a stopped one is `remainingMs`. The elapsed
 * > figure is DERIVED from `Date.now()` at read time and is never
 * > accumulated.**
 *
 * Background tabs throttle `setInterval` to about once a minute, so a timer
 * that added 1000 ms per fire would report ~40 seconds after a 25-minute
 * background run — silently, and in the direction that makes the user trust
 * it. With the endpoint stored, a throttled tick costs nothing but the
 * DISPLAY's freshness: the next fire (or the `visibilitychange` snap the
 * widget takes) shows the truth immediately, and completion is detected on
 * the next opportunity rather than missed.
 *
 * The watchdog below is why completion still lands while the widget is closed
 * or the tab is hidden. It is a **wall-clock service** in the sanctioned
 * `DiskWatcher` class — it subscribes to no editor, walks no document, and
 * costs ONE `Date.now()` compare per fire; it exists only while a timer is
 * actually running, and it notifies subscribers only on the completion
 * TRANSITION, never per second. Per-second work belongs to the widget's own
 * local state (see its header) — that is the keystroke-sanctity/perf split
 * this whole design rests on.
 *
 * ## Scope, decided for v1 and stated so a later extension is a decision
 *
 *  - **One timer per window.** A second one would need a list, an ordering and
 *    a layout answer on a bar that has room for neither.
 *  - **App-level, not per document.** It survives a doc switch, because what
 *    it measures is the person's sitting, not the paper's.
 *  - **Not persisted across reload, and no cross-window sync.** Nothing here
 *    touches `localStorage`, so the cross-window-storage law (a store that
 *    caches a `localStorage` snapshot must re-hydrate on the `storage` event)
 *    does not reach it — a reload starts fresh, and two windows keep two
 *    independent timers.
 *  - **No break cycle.** This is a timer, not a pomodoro scheduler: it counts
 *    one interval down and says so. Work/break alternation is a different
 *    feature with its own state machine.
 */

import { playPomodoroChime } from "@/lib/pomodoro-chime";

export type PomodoroStatus = "idle" | "running" | "paused" | "done";

export interface PomodoroState {
  /** Is the widget mounted on the bar? Independent of `status`: a running
   *  timer whose widget is closed keeps running (the icon says so). */
  open: boolean;
  status: PomodoroStatus;
  /** The chosen interval. `remainingMs` counts down from this. */
  durationMs: number;
  /**
   * Wall-clock ms epoch this run ends at. **Authoritative while running** —
   * `remainingMs` is stale the moment the clock moves, which is the whole
   * point of storing an endpoint rather than a countdown.
   */
  endAt: number | null;
  /** Authoritative while NOT running (idle / paused / done). */
  remainingMs: number;
}

/** Selectable interval lengths, in minutes. First start uses {@link DEFAULT_PRESET_MIN}. */
export const POMODORO_PRESETS_MIN = [5, 15, 25, 50] as const;
export const DEFAULT_PRESET_MIN = 25;

const MIN = 60_000;

function initialState(): PomodoroState {
  return {
    open: false,
    status: "idle",
    durationMs: DEFAULT_PRESET_MIN * MIN,
    endAt: null,
    remainingMs: DEFAULT_PRESET_MIN * MIN,
  };
}

let state: PomodoroState = Object.freeze(initialState());
const listeners = new Set<() => void>();

/** The frozen snapshot. Identity changes ONLY on a real transition, so a
 *  subscriber that re-renders on an unrelated change bails on an equal read. */
export function getPomodoroState(): PomodoroState {
  return state;
}

export function subscribePomodoro(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function commit(next: PomodoroState): void {
  state = Object.freeze(next);
  syncWatchdog();
  for (const fn of listeners) fn();
}

/**
 * Milliseconds left, derived at read time. The ONE place the running/stopped
 * fork is expressed — every display, every progress fraction and the watchdog
 * itself read it, so no surface can invent a second answer.
 */
export function pomodoroRemainingMs(
  s: PomodoroState = state,
  now: number = Date.now(),
): number {
  const raw = s.status === "running" && s.endAt !== null ? s.endAt - now : s.remainingMs;
  return Math.max(0, Math.min(s.durationMs, raw));
}

/** Elapsed fraction in [0, 1]. `done` reads 1 even if the duration is 0. */
export function pomodoroProgress(
  s: PomodoroState = state,
  now: number = Date.now(),
): number {
  if (s.status === "done") return 1;
  if (s.durationMs <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - pomodoroRemainingMs(s, now) / s.durationMs));
}

/* ── Actions ─────────────────────────────────────────────────────────────
   Each is a transition; each commits at most one new snapshot. A call that
   would not change anything commits nothing, so a subscriber never sees a
   no-op notify. */

/** Toggle the widget. Opening never starts the clock — the play button does,
 *  which is also the gesture that arms the audio device. */
export function togglePomodoroOpen(): void {
  commit({ ...state, open: !state.open });
}

export function openPomodoro(): void {
  if (state.open) return;
  commit({ ...state, open: true });
}

/**
 * The × on the widget: close AND stop. Deliberately not "close, keep running"
 * — that is what clicking the bar ICON does, and a surface needs one way to
 * end a thing. A dismissed timer is gone; a hidden one is still counting and
 * the icon's active state says so.
 */
export function dismissPomodoro(): void {
  commit({ ...state, open: false, status: "idle", endAt: null, remainingMs: state.durationMs });
}

export function startPomodoro(now: number = Date.now()): void {
  if (state.status === "running") return;
  // From `done` (or a fully-elapsed pause) a play press means "again", not
  // "resume zero" — otherwise the button would complete instantly.
  const left = state.status === "done" || state.remainingMs <= 0 ? state.durationMs : state.remainingMs;
  commit({ ...state, open: true, status: "running", endAt: now + left, remainingMs: left });
}

export function pausePomodoro(now: number = Date.now()): void {
  if (state.status !== "running") return;
  commit({ ...state, status: "paused", endAt: null, remainingMs: pomodoroRemainingMs(state, now) });
}

/** Back to a full, stopped interval at the current duration. */
export function resetPomodoro(): void {
  commit({ ...state, status: "idle", endAt: null, remainingMs: state.durationMs });
}

/**
 * Adopt a new interval length. Only reachable while the clock is STOPPED —
 * the widget renders the duration as plain text while running rather than as
 * a control that would silently discard the run (what the surface offers is
 * what the click does). Guarded here too, so the rule survives a second
 * caller.
 */
export function setPomodoroDuration(ms: number): void {
  if (state.status === "running") return;
  const durationMs = Math.max(1000, Math.round(ms));
  if (durationMs === state.durationMs && state.status !== "done") return;
  commit({ ...state, status: "idle", durationMs, endAt: null, remainingMs: durationMs });
}

/** The next preset after the current duration, wrapping. */
export function nextPomodoroPresetMs(durationMs: number = state.durationMs): number {
  const i = POMODORO_PRESETS_MIN.findIndex((m) => m * MIN === durationMs);
  const next = POMODORO_PRESETS_MIN[(i + 1) % POMODORO_PRESETS_MIN.length];
  return (i === -1 ? DEFAULT_PRESET_MIN : next) * MIN;
}

export function cyclePomodoroDuration(): void {
  setPomodoroDuration(nextPomodoroPresetMs());
}

/**
 * The completion edge. Idempotent by construction (it only fires from
 * `running`), so the watchdog, a widget tick and a `visibilitychange` snap can
 * all call it for the same elapse and the chime still plays exactly once.
 */
export function completePomodoroIfElapsed(now: number = Date.now()): boolean {
  if (state.status !== "running") return false;
  if (pomodoroRemainingMs(state, now) > 0) return false;
  commit({ ...state, status: "done", endAt: null, remainingMs: 0 });
  playPomodoroChime();
  return true;
}

/* ── The watchdog ────────────────────────────────────────────────────────
   Exists ONLY while a timer runs. One `Date.now()` compare per fire, and it
   notifies only on the completion transition — so a running timer costs no
   render anywhere until it finishes. This is what makes completion survive a
   closed widget and a backgrounded tab: the browser throttles the interval,
   it does not stop it, so the chime lands on the next opportunity. */

const WATCHDOG_MS = 1000;
let watchdog: ReturnType<typeof setInterval> | null = null;

function syncWatchdog(): void {
  const want = state.status === "running";
  if (want && watchdog === null) {
    if (typeof setInterval !== "function") return;
    watchdog = setInterval(() => {
      completePomodoroIfElapsed();
    }, WATCHDOG_MS);
  } else if (!want && watchdog !== null) {
    clearInterval(watchdog);
    watchdog = null;
  }
}

/**
 * `mm:ss`, clamped at zero.
 *
 * The rounding is a parameter because the widget shows BOTH ends of the same
 * instant and they must not contradict each other: a countdown rounds UP (a
 * timer with 24 minutes 59.5 seconds left reads `25:00`, not `24:59`, on its
 * first frame) while the elapsed figure beside it rounds DOWN (0.5 s in reads
 * `0:00`). Rounding both the same way makes `elapsed + remaining` visibly
 * exceed the total for most of every second.
 */
export function formatPomodoroClock(
  ms: number,
  round: "up" | "down" = "up",
): string {
  const total = Math.max(0, round === "up" ? Math.ceil(ms / 1000) : Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Test-only: drop the watchdog and return to a pristine session. */
export function __resetPomodoroForTest(): void {
  if (watchdog !== null) {
    clearInterval(watchdog);
    watchdog = null;
  }
  state = Object.freeze(initialState());
  for (const fn of listeners) fn();
}
