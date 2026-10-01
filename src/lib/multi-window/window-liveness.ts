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

import { getWindowId, remintWindowId } from "./window-id";

const LOCK_PREFIX = "virgil-window/";

/** The id this window was born with — sessionStorage's value before any
 *  re-mint. A duplicated tab's inherited tab record lives under it. */
export interface WindowIdentity {
  id: string;
  inheritedId: string;
}

let claim: Promise<WindowIdentity> | null = null;

/** Try to take `virgil-window/<id>` without waiting. Resolves `true` once the
 *  lock is held (it is then held for the page's life — page teardown
 *  releases it), `false` when another live window already holds it. */
function tryHold(locks: LockManager, id: string): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    locks
      .request(LOCK_PREFIX + id, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(false);
          return undefined;
        }
        resolve(true);
        return new Promise<never>(() => {});
      })
      .catch(reject);
  });
}

/**
 * Make this window's id a CHECKED fact (task 871), then hold its liveness
 * lock. The id comes from sessionStorage, which the browser's "Duplicate
 * tab" copies — so two live windows can start with one id. The lock is the
 * one place that can tell: if a live twin already holds `virgil-window/<id>`,
 * this window re-mints a fresh id and takes the lock under that instead.
 *
 * Idempotent (one claim per page). Every id-keyed startup step — the tab
 * record hydrate above all — awaits it before reading or writing under the
 * id. Where Web Locks are unavailable there is no liveness either; the
 * stored id is used as-is.
 */
export function claimWindowIdentity(): Promise<WindowIdentity> {
  if (claim) return claim;
  const inheritedId = getWindowId();
  const locks =
    typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks) {
    claim = Promise.resolve({ id: inheritedId, inheritedId });
    return claim;
  }
  claim = (async () => {
    try {
      if (await tryHold(locks, inheritedId)) {
        return { id: inheritedId, inheritedId };
      }
      // A live twin holds our inherited id: become a new window.
      const fresh = remintWindowId();
      if (!(await tryHold(locks, fresh))) {
        // A fresh UUID cannot be held by anyone else; if the browser still
        // says no, queue for it so liveness is eventually recorded.
        void locks
          .request(LOCK_PREFIX + fresh, () => new Promise<never>(() => {}))
          .catch(() => {});
      }
      return { id: fresh, inheritedId };
    } catch {
      return { id: getWindowId(), inheritedId };
    }
  })();
  return claim;
}

/** Take this window's liveness lock (idempotent) — the identity claim. */
export function holdWindowLiveness(): void {
  void claimWindowIdentity();
}

/**
 * The ids of every window that holds (or is waiting for) its liveness lock,
 * always including this one. Where Web Locks are unavailable only this
 * window is known — callers then fall back on age alone.
 */
export async function liveWindowIds(): Promise<Set<string>> {
  if (typeof navigator === "undefined" || !navigator.locks) {
    return new Set<string>([getWindowId()]);
  }
  // Settle (and if need be re-mint) our own id first, so "this window" in
  // the answer is the id we actually hold the lock under (task 871).
  await claimWindowIdentity();
  const ids = new Set<string>([getWindowId()]);
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
  claim = null;
}
