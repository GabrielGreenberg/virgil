"use client";

/**
 * SESSION 4 (task 2026-07-03-020) — the transient "which side am I previewing"
 * state for an APPLIED pending AI change.
 *
 * The applied-suggestion card gained a NON-committing Original / Suggested
 * toggle that flips the LIVE in-document paragraph between the pre-splice
 * original and the AI suggestion so you can compare in place WITHOUT committing.
 * That preview direction is:
 *   - keyed by card id,
 *   - NEVER persisted to the sidecar (it's a UI compare state, not a decision),
 *   - default `"suggested"` (matches the live doc right after auto-apply), and
 *   - read by BOTH the card body (to render the active segment) AND the commit
 *     path (so Check / Cross reconcile from the canonical `appliedChange`, not
 *     the transient preview — a mid-preview commit stays deterministic).
 *
 * It is a tiny module-level external store rather than React state so the
 * `PendingChangeController` value can stay referentially stable across
 * keystrokes (baking preview state into the controller would re-identify it on
 * every toggle and thread `cards[]`-like churn through every consuming card
 * body). The store is poked ONLY by click-driven toggle / commit actions, so it
 * never fires on a plain keystroke — `usePreviewDir` subscribers stay quiet
 * while typing (keystroke sanctity).
 */

import { useCallback, useSyncExternalStore } from "react";

export type PreviewDir = "suggested" | "original";

/** Only cards currently previewing the ORIGINAL are stored; a missing id means
 *  the default `"suggested"` (so the map stays empty in the common case). */
const dirs = new Map<string, PreviewDir>();
const listeners = new Map<string, Set<() => void>>();

function emit(id: string): void {
  const set = listeners.get(id);
  if (set) for (const cb of set) cb();
}

/** The current preview direction for card `id` (default `"suggested"`). */
export function getPreviewDir(id: string): PreviewDir {
  return dirs.get(id) ?? "suggested";
}

/** Set the preview direction for card `id`; no-op (no emit) when unchanged. */
export function setPreviewDir(id: string, dir: PreviewDir): void {
  if (getPreviewDir(id) === dir) return;
  if (dir === "suggested") dirs.delete(id);
  else dirs.set(id, dir);
  emit(id);
}

/** Reset card `id` back to the default `"suggested"` — called on commit
 *  (Check / Cross) so a re-applied card next time starts on the suggested view. */
export function resetPreviewDir(id: string): void {
  setPreviewDir(id, "suggested");
}

function subscribe(id: string, cb: () => void): () => void {
  let set = listeners.get(id);
  if (!set) {
    set = new Set();
    listeners.set(id, set);
  }
  set.add(cb);
  return () => {
    set.delete(cb);
    if (set.size === 0) listeners.delete(id);
  };
}

/** Subscribe a card body to its own preview direction. Re-renders ONLY when
 *  `setPreviewDir(id, …)` runs for this id (a click), never on a keystroke. */
export function usePreviewDir(id: string): PreviewDir {
  const sub = useCallback((cb: () => void) => subscribe(id, cb), [id]);
  return useSyncExternalStore(
    sub,
    () => getPreviewDir(id),
    () => "suggested",
  );
}
