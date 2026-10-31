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
 * THE DWELL HAS AN IDENTITY (task 1389). The items are mounted unkeyed, so a
 * paper switch hands one mounted item another document's state. A
 * `scope: "doc"` item therefore passes its document as `scopeKey` (required by
 * the overload — see `BarStatusDocScopedId`), and the dwell is remembered FOR
 * that key: paper A's settled dwell is not paper B's, so B starts a fresh
 * window — on the very render of the switch, not one effect later.
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
  type BarStatusDocScopedId,
  type BarStatusItemId,
  type BarStatusStates,
} from "@/lib/bar-status-policy";

const NOT_SETTLED: unique symbol = Symbol("bar-status-not-settled");

/** A per-document item names its document (null/undefined: no paper open). */
export function useBarStatusVisible<K extends BarStatusDocScopedId>(
  id: K,
  state: BarStatusStates[K],
  scopeKey: string | null | undefined,
): boolean;
/** A session-wide item has one dwell for the life of the item. */
export function useBarStatusVisible<
  K extends Exclude<BarStatusItemId, BarStatusDocScopedId>,
>(id: K, state: BarStatusStates[K]): boolean;
export function useBarStatusVisible<K extends BarStatusItemId>(
  id: K,
  state: BarStatusStates[K],
  scopeKey?: string | null,
): boolean {
  // Declared first: its disposal runs before the effect cleanup below.
  const lifetime = useViewLifetime();
  const verdict = barStatusVerdict(id, state);
  const settleMs = BAR_STATUS_POLICY[id].settleMs;
  const waiting = verdict === "settle";
  const scope = scopeKey ?? null;
  // WHICH scope's dwell has elapsed — `NOT_SETTLED` when none. Comparing it to
  // the current scope (rather than holding a bare boolean) is what keeps a
  // switch from painting B for the one render before the effect resets.
  const [settledFor, setSettledFor] = useState<
    string | null | typeof NOT_SETTLED
  >(NOT_SETTLED);
  useEffect(() => {
    if (!waiting) return;
    const handle = lifetime.setTimeout(() => setSettledFor(scope), settleMs);
    return () => {
      lifetime.clear(handle);
      // Leaving `settle` (cleared, or escalated to `now`) — or the scope
      // changing under it — ends this dwell; a re-entry starts a fresh window.
      setSettledFor(NOT_SETTLED);
    };
  }, [waiting, settleMs, scope, lifetime]);
  return verdict === "now" || (waiting && settledFor === scope);
}
