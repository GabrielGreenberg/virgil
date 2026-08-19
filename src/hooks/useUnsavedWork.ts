"use client";

/**
 * React reads of the unsaved-work channel (task 391).
 *
 * Same `useSyncExternalStore` door as `usePreservationNotice` — the store
 * notifies on real state transitions only (the clean→dirty EDGE, a change of
 * blocking reason, a landed write), so a subscriber costs nothing while the
 * user types.
 */

import { useEffect, useState, useSyncExternalStore } from "react";

import {
  getUnsavedWork,
  docsWithUnlandedWork,
  subscribeUnsavedWork,
  type UnsavedWorkState,
} from "@/lib/unsaved-work";

/** This document's state, or `null` when it has none. */
export function useUnsavedWork(
  docId: string | null | undefined,
): UnsavedWorkState | null {
  return useSyncExternalStore(
    subscribeUnsavedWork,
    () => getUnsavedWork(docId),
    () => null,
  );
}

/**
 * Does ANY open document hold work that has not reached disk? The app-wide
 * doors read this: a reload drops every mounted pipeline at once, and under
 * multi-doc keep-alive the paper at risk is often a background one.
 *
 * Returns a BOOLEAN rather than the list, deliberately — `docsWithUnlandedWork`
 * allocates a fresh array per call, which `useSyncExternalStore` would read as
 * a new snapshot on every notification and loop. Consumers that need the list
 * take it once, inside the gesture, from `prepareForReload`.
 */
export function useAnyUnlandedWork(): boolean {
  return useSyncExternalStore(
    subscribeUnsavedWork,
    () => docsWithUnlandedWork().length > 0,
    () => false,
  );
}

/**
 * A human label for how long this document's work has been unsaved — "47
 * minutes", "1 hour", "a few seconds" — or `null` when nothing is unsaved.
 *
 * TASK 391, "the pause gets a clock." The store is deliberately edge-driven
 * (it notifies on a state transition, never on the passage of time), so the
 * TICKING lives here: one 30-second interval, mounted only while the document
 * is actually dirty, that bumps a counter so the label re-derives. A pause
 * that quietly outlives the debounce by seventy minutes behind a pill reading
 * the same words at minute 1 and minute 70 was the incident's second act.
 */
export function useUnsavedAgeLabel(
  docId: string | null | undefined,
  format: (ms: number) => string,
): string | null {
  const state = useUnsavedWork(docId);
  const dirtySince = state?.dirtySince ?? null;
  const [, bump] = useState(0);
  useEffect(() => {
    if (dirtySince === null) return;
    const id = setInterval(() => bump((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [dirtySince]);
  if (dirtySince === null) return null;
  return format(Math.max(0, Date.now() - dirtySince));
}
