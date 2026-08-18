"use client";

/**
 * **The Virgil-bar pomodoro timer** — the icon and the widget (task 354).
 *
 * Two residents of the bar, and the thing to know about both is that they take
 * **no props**. All session state lives in
 * [pomodoro-timer.ts](../lib/pomodoro-timer.ts) and is read here through
 * `useSyncExternalStore`, so nothing about the timer can travel as a
 * `StatusClusterProps` member — which is what makes the perf claim structural:
 * `TopBar` / `TabStrip` / `StatusCluster` are memoized precisely so background
 * ticks do not repaint the bar, and a timer threaded as props would have
 * repainted it every second. There is no prop for the timer to change, so they
 * cannot re-render because of it — not on a tick, and not on a toggle either.
 *
 * ## Where the per-second tick lives
 *
 * In `useState` local to the widget BODY (`PomodoroWidget`), and nowhere else.
 * The store notifies only on real transitions (start / pause / complete /
 * duration / open); the body's 1 s interval exists only while the widget is
 * mounted AND running, and it re-renders that leaf and nothing above it. The
 * store's watchdog (see its header) is what still lands the completion while
 * this widget is closed or the tab is hidden.
 *
 * The open/closed fork is a MOUNT boundary (see {@link PomodoroTimer}), so
 * "closed schedules nothing" is structural rather than a condition inside an
 * effect, and a re-opened widget seeds `now` fresh instead of snapping it a
 * frame later.
 *
 * A `visibilitychange` snap sits beside the interval because a background tab
 * throttles timers to roughly once a minute: the DISPLAY can be up to a minute
 * stale while hidden, and it must be truthful the instant the user looks at
 * it. Timestamp arithmetic (never accumulated ticks) is what makes the snap
 * possible at all.
 *
 * ## Affordances
 *
 * The duration is a BUTTON that cycles the presets while the clock is stopped
 * and plain text while it runs — what the surface offers is what the click
 * does, so there is no control that would silently discard a live run. The ×
 * closes AND stops; clicking the bar icon closes but keeps counting (the
 * icon's status dot says so). No plain "hide while running" ambiguity: the two
 * gestures mean two different things and each says which.
 *
 * Where each resident sits on the bar is the other half of the affordance, and
 * the two answers differ deliberately: the ICON takes the ordinary tool rules
 * (inside the collapsible group, inside the zen gate) while the WIDGET is
 * rendered before both. A timer is STARTED from a normal bar and stays VISIBLE
 * in a stripped one — which is what the request asked for, and it costs no
 * exception in `StatusCluster`'s gating.
 *
 * The done treatment is colour + label (`--positive`, the goal-reached family)
 * with deliberately NO motion: the completion already announces itself with a
 * sound, and a pulse on the app's top bar is the kind of thing that outstays
 * its welcome on the twentieth interval of the day.
 */

import { memo, useCallback, useEffect, useState } from "react";
import { iconHint } from "@/components/Hint";
import { StatusDot } from "@/components/StatusDot";
import { usePomodoro } from "@/hooks/usePomodoro";
import { armPomodoroAudio } from "@/lib/pomodoro-chime";
import {
  completePomodoroIfElapsed,
  cyclePomodoroDuration,
  dismissPomodoro,
  formatPomodoroClock,
  pausePomodoro,
  pomodoroProgress,
  pomodoroRemainingMs,
  startPomodoro,
  togglePomodoroOpen,
  type PomodoroState,
} from "@/lib/pomodoro-timer";

/** Tomato-clock: the house 16px stroke glyph — a round face with a leaf. */
function TimerIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M12 10v3.5l2.4 1.6" />
      <path d="M8.6 4.6c1.4-.9 3-.9 3.4.4.4-1.3 2-1.3 3.4-.4" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden>
      <polygon points="7 4 20 12 7 20 7 4" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

/**
 * The bar icon. Lives INSIDE the collapsible group (an ordinary tool), and
 * carries a status dot so a timer left running behind a closed widget — or a
 * collapsed strip — is still visible as a state of the app.
 */
function PomodoroToggleButtonImpl() {
  const { open, status } = usePomodoro();
  return (
    <button
      type="button"
      onClick={togglePomodoroOpen}
      className="topbarbtn relative"
      aria-pressed={open}
      {...iconHint({ label: "Timer" })}
    >
      <TimerIcon />
      {/* The traffic-light SSOT's own vocabulary: `warn` is "pending /
          working", `ok` is "done". Decorative — the button carries its own
          name and hint. */}
      {status === "running" && (
        <StatusDot tone="warn" size="sm" className="absolute top-0 right-0" />
      )}
      {status === "done" && (
        <StatusDot tone="ok" size="sm" className="absolute top-0 right-0" />
      )}
    </button>
  );
}

export const PomodoroToggleButton = memo(PomodoroToggleButtonImpl);

/**
 * The two ghost controls inside the pill: the design system's indicator
 * WITHOUT the 20x20 `iconbtn` geometry, because these sit in a ~22px bar pill
 * and have to be 16px (STYLE_GUIDE "Interaction" -> Focus).
 *
 * `focus-ring` is deliberately NOT folded in here and is spelled at each
 * button instead. `icon-button-a11y-guardrail` reads the literal `className`
 * of every icon-only button, so a ring hidden behind a shared constant is
 * invisible to the census that exists to notice a missing one — and the guard
 * is the thing that keeps a third ghost button from shipping without it.
 */
const GHOST =
  "inline-flex items-center justify-center rounded hover-on-light text-ink-subtle";

/**
 * The open/closed fork, and it is a MOUNT boundary rather than a branch inside
 * one component — which is what keeps the per-second clock honest without a
 * setState-in-effect.
 *
 * The body's `now` is seeded at MOUNT (`useState(() => Date.now())`), so a
 * widget re-opened over a timer that has been running unseen for ten minutes
 * paints the truth on its first frame. Doing it the other way — one component
 * that returns null while closed, snapping `now` from an effect on the open
 * transition — is the same picture one frame later and an
 * `react-hooks/set-state-in-effect` error, because a state write in an effect
 * body is a second render React cannot batch into the first.
 *
 * It also makes the "closed costs nothing" claim structural: while the widget
 * is closed the body is UNMOUNTED, so there is no interval and no listener to
 * reason about — only the store's own watchdog, which is what lands the
 * completion behind a closed widget.
 */
function PomodoroTimerImpl() {
  const state = usePomodoro();
  if (!state.open) return null;
  return <PomodoroWidget state={state} />;
}

function PomodoroWidget({ state }: { state: PomodoroState }) {
  const { status, durationMs } = state;
  const running = status === "running";
  const done = status === "done";

  // THE per-second tick, and the only one in this feature that causes a
  // render. Local, leaf-scoped, and armed only while there is something to
  // count — a stopped timer schedules nothing at all.
  const [now, setNow] = useState(() => Date.now());
  // Closes over nothing but the setter, so its identity is stable for the life
  // of the widget: the effect below re-subscribes on `running` alone and never
  // once per second.
  const snap = useCallback(() => {
    setNow(Date.now());
    completePomodoroIfElapsed();
  }, []);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(snap, 1000);
    // A hidden tab throttles the interval to ~1/min, so the readout can be a
    // minute stale by the time the user looks. Snap on the way back.
    const onVis = () => {
      if (!document.hidden) snap();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [running, snap]);

  const onPlayPause = useCallback(() => {
    if (running) {
      pausePomodoro();
      return;
    }
    // The gesture that arms the audio device: a completion is a timer event,
    // and a context first created there would be muted by the autoplay policy.
    armPomodoroAudio();
    startPomodoro();
    setNow(Date.now());
  }, [running]);

  const remaining = pomodoroRemainingMs(state, now);
  const elapsed = durationMs - remaining;
  const pct = Math.round(pomodoroProgress(state, now) * 100);

  return (
    <div
      className="inline-flex items-center gap-1.5 mr-1 pl-1.5 pr-1 py-0.5 rounded-full border text-[11px] shrink-0"
      style={{
        borderColor: done ? "var(--positive)" : "var(--edge-subtle)",
        background: "var(--surface-muted)",
        color: "var(--ink-body)",
      }}
      data-pomodoro-status={status}
    >
      <button
        type="button"
        onClick={onPlayPause}
        className={`${GHOST} focus-ring w-4 h-4`}
        {...iconHint({ label: running ? "Pause timer" : done ? "Restart timer" : "Start timer" })}
      >
        {running ? <PauseIcon /> : <PlayIcon />}
      </button>

      {/* elapsed / total. A stopped clock offers the preset cycle; a running
          one is text, so the control can never discard a live run. */}
      {running ? (
        <span className="tabular-nums" data-pomodoro-clock>
          {formatPomodoroClock(elapsed, "down")} / {formatPomodoroClock(durationMs)}
        </span>
      ) : (
        <button
          type="button"
          onClick={cyclePomodoroDuration}
          className="tabular-nums rounded px-0.5 hover-on-light focus-ring"
          data-pomodoro-clock
          data-hint="Change the interval — 5 / 15 / 25 / 50 min"
        >
          {formatPomodoroClock(elapsed, "down")} / {formatPomodoroClock(durationMs)}
        </button>
      )}

      <span
        className="h-[3px] w-12 rounded-full overflow-hidden shrink-0"
        style={{ background: "var(--edge-subtle)" }}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="Timer progress"
      >
        <span
          className="block h-full rounded-full"
          style={{
            width: `${pct}%`,
            background: done ? "var(--positive)" : "var(--accent)",
          }}
        />
      </span>

      {done && (
        <span style={{ color: "var(--positive-strong)" }} data-pomodoro-done>
          Done
        </span>
      )}

      <button
        type="button"
        onClick={dismissPomodoro}
        className={`${GHOST} focus-ring w-4 h-4`}
        {...iconHint({ label: "Dismiss timer", hint: "Dismiss — stops the timer" })}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}

export const PomodoroTimer = memo(PomodoroTimerImpl);
export default PomodoroTimer;
