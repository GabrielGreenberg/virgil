"use client";

/**
 * **The ONE visibility hook every Virgil-bar status item renders through**
 * (task 1174) — the policy's must-see verdict PLUS its settle rule.
 *
 * `bar-status-policy.ts` says whether a state is must-see and how long it must
 * LAST before it paints (`settleMs`, `immediate`). This hook is where that
 * dwell is enforced, once, for every item: it watches the verdict's EDGE into
 * `settle` and arms ONE timeout to the boundary through the component's
 * `ViewLifetime` (the timer-lifetime law — no timer outlives the item). If the
 * state leaves must-see first, the timer is cleared and nothing ever painted.
 * No item component carries a timer of its own.
 *
 * KEYSTROKE SANCTITY: no editor subscription. The hook re-runs its effect only
 * when the VERDICT changes (`hidden` / `now` / `settle`), and every item's
 * state is already edge-driven (`useSaveState` notifies on tier changes, the
 * pen / watcher stores on their own transitions) — so typing arms nothing.
 */

import { useEffect, useState } from "react";

import { useViewLifetime } from "@/hooks/useViewLifetime";
import {
  BAR_STATUS_POLICY,
  barStatusVerdict,
  type BarStatusItemId,
  type BarStatusStates,
} from "@/lib/bar-status-policy";

export function useBarStatusVisible<K extends BarStatusItemId>(
  id: K,
  state: BarStatusStates[K],
): boolean {
  // Declared first: its disposal runs before the effect cleanup below.
  const lifetime = useViewLifetime();
  const verdict = barStatusVerdict(id, state);
  const settleMs = BAR_STATUS_POLICY[id].settleMs;
  const waiting = verdict === "settle";
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!waiting) return;
    const handle = lifetime.setTimeout(() => setSettled(true), settleMs);
    return () => {
      lifetime.clear(handle);
      // Leaving `settle` (cleared, or escalated to `now`) ends this dwell; a
      // later re-entry starts a fresh window.
      setSettled(false);
    };
  }, [waiting, settleMs, lifetime]);
  return verdict === "now" || (waiting && settled);
}
