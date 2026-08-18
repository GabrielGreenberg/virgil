"use client";

import { useSyncExternalStore } from "react";
import {
  getPomodoroState,
  subscribePomodoro,
  type PomodoroState,
} from "@/lib/pomodoro-timer";

const SERVER_SNAPSHOT: PomodoroState = Object.freeze({
  open: false,
  status: "idle" as const,
  durationMs: 0,
  endAt: null,
  remainingMs: 0,
});

/**
 * React read of the bar timer's SESSION state (task 354).
 *
 * Session, not clock: this notifies on start / pause / complete / duration /
 * open — never per second. The seconds readout is local state inside the
 * widget leaf, which is what keeps a running timer from repainting the bar.
 *
 * The store's snapshot is frozen and changes identity only on a real
 * transition, so `useSyncExternalStore` tears on nothing and an unrelated
 * change costs one bailed render.
 */
export function usePomodoro(): PomodoroState {
  return useSyncExternalStore(
    subscribePomodoro,
    getPomodoroState,
    () => SERVER_SNAPSHOT,
  );
}
