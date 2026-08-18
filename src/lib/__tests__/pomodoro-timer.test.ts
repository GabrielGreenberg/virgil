/**
 * The bar timer's SESSION model (task 354).
 *
 * The leg that matters is the CLOCK MODEL: a timer that accumulated ticks
 * would read correctly in every foreground test and lie by tens of minutes in
 * the one condition it is actually used in — a backgrounded tab, where the
 * browser throttles `setInterval` to roughly once a minute. That failure is
 * unrepresentable in a test that advances fake timers, because advancing them
 * fires every tick. So the model is exercised the way the browser exercises
 * it: the wall clock moves by MINUTES while the store is asked ONCE.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/pomodoro-chime", () => ({
  playPomodoroChime: vi.fn(),
  armPomodoroAudio: vi.fn(),
}));

import { playPomodoroChime } from "@/lib/pomodoro-chime";
import {
  DEFAULT_PRESET_MIN,
  POMODORO_PRESETS_MIN,
  __resetPomodoroForTest,
  completePomodoroIfElapsed,
  cyclePomodoroDuration,
  dismissPomodoro,
  formatPomodoroClock,
  getPomodoroState,
  nextPomodoroPresetMs,
  pausePomodoro,
  pomodoroProgress,
  pomodoroRemainingMs,
  resetPomodoro,
  setPomodoroDuration,
  startPomodoro,
  subscribePomodoro,
  togglePomodoroOpen,
} from "@/lib/pomodoro-timer";

const MIN = 60_000;
const T0 = 1_700_000_000_000;

beforeEach(() => {
  __resetPomodoroForTest();
  vi.mocked(playPomodoroChime).mockClear();
});
afterEach(() => {
  __resetPomodoroForTest();
});

describe("the clock is derived from timestamps, not accumulated", () => {
  it("reports the truth after a long gap in which NOTHING ticked", () => {
    startPomodoro(T0);
    // 24 minutes of a 25-minute interval pass with the tab backgrounded: the
    // store was not called once. An accumulated-tick model would still read
    // 25:00 left here.
    expect(pomodoroRemainingMs(getPomodoroState(), T0 + 24 * MIN)).toBe(1 * MIN);
    expect(pomodoroProgress(getPomodoroState(), T0 + 24 * MIN)).toBeCloseTo(24 / 25, 5);
  });

  it("clamps at zero rather than reporting negative time", () => {
    startPomodoro(T0);
    expect(pomodoroRemainingMs(getPomodoroState(), T0 + 90 * MIN)).toBe(0);
    expect(pomodoroProgress(getPomodoroState(), T0 + 90 * MIN)).toBe(1);
  });

  it("a pause freezes the REMAINING time, and resuming re-bases the endpoint", () => {
    startPomodoro(T0);
    pausePomodoro(T0 + 10 * MIN);
    expect(getPomodoroState().status).toBe("paused");
    expect(getPomodoroState().endAt).toBeNull();
    // An hour on the sofa must not consume the paused interval.
    expect(pomodoroRemainingMs(getPomodoroState(), T0 + 70 * MIN)).toBe(15 * MIN);

    startPomodoro(T0 + 70 * MIN);
    expect(getPomodoroState().endAt).toBe(T0 + 85 * MIN);
    expect(pomodoroRemainingMs(getPomodoroState(), T0 + 80 * MIN)).toBe(5 * MIN);
  });
});

describe("completion", () => {
  it("fires exactly once per elapse, however many callers notice", () => {
    startPomodoro(T0);
    expect(completePomodoroIfElapsed(T0 + 25 * MIN)).toBe(true);
    // The watchdog, the widget's own tick and a visibilitychange snap can all
    // land on the same elapse — the transition is what guards the chime.
    expect(completePomodoroIfElapsed(T0 + 25 * MIN)).toBe(false);
    expect(completePomodoroIfElapsed(T0 + 26 * MIN)).toBe(false);
    expect(playPomodoroChime).toHaveBeenCalledTimes(1);
    expect(getPomodoroState().status).toBe("done");
  });

  it("does not fire early, and never for a stopped timer", () => {
    startPomodoro(T0);
    expect(completePomodoroIfElapsed(T0 + 24 * MIN)).toBe(false);
    pausePomodoro(T0 + 24 * MIN);
    expect(completePomodoroIfElapsed(T0 + 99 * MIN)).toBe(false);
    expect(playPomodoroChime).not.toHaveBeenCalled();
  });

  it("play on a DONE timer starts a fresh interval instead of completing instantly", () => {
    startPomodoro(T0);
    completePomodoroIfElapsed(T0 + 25 * MIN);
    startPomodoro(T0 + 25 * MIN);
    expect(getPomodoroState().status).toBe("running");
    expect(pomodoroRemainingMs(getPomodoroState(), T0 + 25 * MIN)).toBe(25 * MIN);
  });
});

describe("duration", () => {
  it("cycles the presets and wraps", () => {
    expect(getPomodoroState().durationMs).toBe(DEFAULT_PRESET_MIN * MIN);
    const seen: number[] = [];
    for (let i = 0; i < POMODORO_PRESETS_MIN.length; i++) {
      cyclePomodoroDuration();
      seen.push(getPomodoroState().durationMs / MIN);
    }
    expect(new Set(seen)).toEqual(new Set(POMODORO_PRESETS_MIN));
    expect(getPomodoroState().durationMs).toBe(DEFAULT_PRESET_MIN * MIN);
  });

  it("an off-preset duration cycles back onto the default rather than getting stuck", () => {
    setPomodoroDuration(7 * MIN);
    expect(nextPomodoroPresetMs(7 * MIN)).toBe(DEFAULT_PRESET_MIN * MIN);
  });

  it("is REFUSED while the clock runs — a change would silently discard the run", () => {
    startPomodoro(T0);
    const before = getPomodoroState();
    cyclePomodoroDuration();
    setPomodoroDuration(5 * MIN);
    expect(getPomodoroState()).toBe(before);
  });

  it("a change while stopped resets the interval to full", () => {
    startPomodoro(T0);
    pausePomodoro(T0 + 10 * MIN);
    setPomodoroDuration(50 * MIN);
    expect(getPomodoroState().status).toBe("idle");
    expect(pomodoroRemainingMs(getPomodoroState(), T0 + 10 * MIN)).toBe(50 * MIN);
  });
});

describe("open / dismiss", () => {
  it("the icon toggle does NOT start or stop the clock", () => {
    startPomodoro(T0);
    togglePomodoroOpen();
    expect(getPomodoroState().open).toBe(false);
    expect(getPomodoroState().status).toBe("running");
    expect(pomodoroRemainingMs(getPomodoroState(), T0 + 5 * MIN)).toBe(20 * MIN);
  });

  it("dismiss closes AND stops", () => {
    startPomodoro(T0);
    dismissPomodoro();
    expect(getPomodoroState().open).toBe(false);
    expect(getPomodoroState().status).toBe("idle");
    expect(pomodoroRemainingMs(getPomodoroState(), T0 + 5 * MIN)).toBe(25 * MIN);
  });
});

describe("subscription discipline", () => {
  it("notifies on transitions, and not on a call that changes nothing", () => {
    let n = 0;
    const off = subscribePomodoro(() => { n += 1; });
    startPomodoro(T0);
    expect(n).toBe(1);
    startPomodoro(T0 + 1000); // already running
    expect(n).toBe(1);
    pausePomodoro(T0 + 1000);
    expect(n).toBe(2);
    pausePomodoro(T0 + 2000); // already paused
    expect(n).toBe(2);
    resetPomodoro();
    expect(n).toBe(3);
    off();
  });

  it("hands out a FROZEN snapshot whose identity tracks real change", () => {
    const a = getPomodoroState();
    expect(Object.isFrozen(a)).toBe(true);
    expect(getPomodoroState()).toBe(a);
    startPomodoro(T0);
    expect(getPomodoroState()).not.toBe(a);
  });
});

describe("formatPomodoroClock", () => {
  it("rounds the two ends of one instant in OPPOSITE directions", () => {
    // 24:59.5 left, 0:00.5 elapsed. Rounding both the same way would print
    // 25:00 / 25:00 (or 24:59 + 0:01 = 25:00 against a 24:59 sum) — the
    // displayed pair must never exceed the total.
    expect(formatPomodoroClock(24 * MIN + 59_500)).toBe("25:00");
    expect(formatPomodoroClock(500, "down")).toBe("0:00");
  });

  it("clamps negatives and pads seconds", () => {
    expect(formatPomodoroClock(-5000)).toBe("0:00");
    expect(formatPomodoroClock(65_000)).toBe("1:05");
  });
});
