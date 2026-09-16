/**
 * "Is window X still open?" — answered by the browser, not by a heartbeat
 * (task 603).
 *
 * Each window holds one Web Lock named after its window id for the life of
 * the page. The browser drops it when the page goes away (close, reload,
 * crash), so `navigator.locks.query()` lists exactly the windows that are
 * open right now. That replaces the old windows registry — a record every
 * window rewrote every 30 s and on every tab change, which nothing read.
 *
 * Its one reader is the startup tab-record sweep (`sweepTabRecords`), which
 * must never delete the tabs of a window that is merely idle.
 */

import { getWindowId } from "./window-id";

const LOCK_PREFIX = "virgil-window/";

let holding = false;

/** Take this window's liveness lock (idempotent). The lock is never
 *  released by us — page teardown releases it. */
export function holdWindowLiveness(): void {
  if (holding) return;
  if (typeof navigator === "undefined" || !navigator.locks) return;
  holding = true;
  navigator.locks
    .request(LOCK_PREFIX + getWindowId(), () => new Promise<never>(() => {}))
    .catch(() => {
      holding = false;
    });
}

/**
 * The ids of every window that holds (or is waiting for) its liveness lock,
 * always including this one. Where Web Locks are unavailable only this
 * window is known — callers then fall back on age alone.
 */
export async function liveWindowIds(): Promise<Set<string>> {
  const ids = new Set<string>([getWindowId()]);
  if (typeof navigator === "undefined" || !navigator.locks) return ids;
  try {
    const snap = await navigator.locks.query();
    for (const l of [...(snap.held ?? []), ...(snap.pending ?? [])]) {
      if (l.name?.startsWith(LOCK_PREFIX)) ids.add(l.name.slice(LOCK_PREFIX.length));
    }
  } catch {
    /* unknown liveness — only this window is protected */
  }
  return ids;
}

/** Test seam. */
export function __resetWindowLivenessForTest(): void {
  holding = false;
}
