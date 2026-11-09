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
 * closes AND stops; unticking the ⋯ menu's Timer row closes but keeps
 * counting (the status dot on the ⋯ trigger says so). No plain "hide while
 * running" ambiguity: the two gestures mean two different things and each
 * says which.
 *
 * Where each resident sits on the bar is the other half of the affordance. The
 * Timer ROW lives in the bar's ⋯ menu, which is protected tier and not
 * zen-gated, so a timer can be started from a collapsed strip or in zen; its
 * status DOT rides the ⋯ trigger for the same reason; and the WIDGET is
 * rendered before the collapsible group. A timer is STARTED from a menu and
 * stays VISIBLE on a stripped bar — which costs no exception in
 * `StatusCluster`'s gating. The row closes the menu like every sibling row,
 * through the menu's own `close` (its one prop: a menu callback, never timer
 * state — `pomodoro-bar-residency.test.tsx`).
 *
 * The done treatment is colour + label (`--positive`, the goal-reached family)
 * with deliberately NO motion: the completion already announces itself with a
 * sound, and a pulse on the app's top bar is the kind of thing that outstays
 * its welcome on the twentieth interval of the day.
 */

import { memo, useCallback, useEffect, useState } from "react";
import { iconHint } from "@/components/Hint";
import { MenuToggleRow } from "@/components/menu";
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
import { useBarStatusVisible } from "@/hooks/useBarStatusVisible";
import { BarStatusPill } from "@/components/status/BarStatusPill";

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

/** The timer's row in the bar's ⋯ menu. A leaf that reads its own state, like
 *  the widget, so the timer never reaches the cluster's props. Its one prop is
 *  the menu's dismissal: picking the row closes the ⋯ menu exactly as its
 *  siblings' `pick(...)` does (task 1514) — on click and on Enter alike, since
 *  both reach `onToggle`. */
function PomodoroMenuRowImpl({ onPicked }: { onPicked?: () => void }) {
  const { open } = usePomodoro();
  return (
    <MenuToggleRow
      id="more-timer"
      label="Timer"
      checked={open}
      onToggle={() => {
        onPicked?.();
        togglePomodoroOpen();
      }}
    />
  );
}

export const PomodoroMenuRow = memo(PomodoroMenuRowImpl);

/** What keeps a timer visible behind a closed widget: a dot on the ⋯ trigger.
 *  The traffic-light SSOT's own vocabulary: `warn` is "pending / working", `ok`
 *  is "done". Decorative — the trigger carries its own name and hint. */
function PomodoroStatusDotImpl() {
  const { status } = usePomodoro();
  if (status === "running") {
    return <StatusDot tone="warn" size="sm" className="absolute top-0 right-0" />;
  }
  if (status === "done") {
    return <StatusDot tone="ok" size="sm" className="absolute top-0 right-0" />;
  }
  return null;
}

export const PomodoroStatusDot = memo(PomodoroStatusDotImpl);

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
  const visible = useBarStatusVisible("pomodoro", { open: state.open });
  if (!visible) return null;
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
    <BarStatusPill
      tone="quiet"
      ariaLabel="Writing timer"
      // Silent while the clock runs — a per-second readout is not news — and
      // spoken through the bar's announcer once the interval completes.
      announce={done ? "Writing timer done" : null}
      label={
        done ? (
          <span style={{ color: "var(--positive-strong)" }} data-pomodoro-done>
            Done
          </span>
        ) : null
      }
      data={{ "data-pomodoro-status": status }}
      widget={
        <>
          <button
            data-iconbtn-exempt="control inside a status pill: shares the pill's ghost hover"
            type="button"
            onClick={onPlayPause}
            className={`${GHOST} focus-ring w-4 h-4`}
            {...iconHint({ label: running ? "Pause timer" : done ? "Restart timer" : "Start timer" })}
          >
            {running ? <PauseIcon /> : <PlayIcon />}
          </button>

          {/* elapsed / total. Only a clock with nothing in progress (idle / done)
              offers the preset cycle; a running OR PAUSED one is text, so the
              control can never discard a live run (task 905 — a pause is a run
              the user means to resume). */}
          {running || status === "paused" ? (
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

          <button
            data-iconbtn-exempt="control inside a status pill: shares the pill's ghost hover"
            type="button"
            onClick={() => dismissPomodoro()}
            className={`${GHOST} focus-ring w-4 h-4`}
            {...iconHint({ label: "Dismiss timer", hint: "Dismiss — stops the timer" })}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </>
      }
    />
  );
}

export const PomodoroTimer = memo(PomodoroTimerImpl);
export default PomodoroTimer;
