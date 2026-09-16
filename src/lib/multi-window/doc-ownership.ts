/**
 * Single-writer doc ownership across windows.
 *
 * Two coordination layers:
 *
 * 1. **Web Locks** (`navigator.locks`) — same-origin, cross-window. The
 *    actual ownership token is a held lock named `virgil-doc-${docId}`.
 *    Whoever holds it writes; nobody else can. Locks are released on
 *    page unload automatically, so a crashed window doesn't leave the
 *    doc unavailable.
 *
 * 2. **IndexedDB owner record** — stores which `windowId` currently
 *    owns each doc, purely so other windows can show the user a useful
 *    "currently open in window X" state and target the right window
 *    for a handoff. The lock is the source of truth; the IDB record
 *    is a cache.
 *
 * Writes through `withDocLock(docId, fn)` participate in the same lock
 * so a window-A handoff to window B can't slip in mid-write — B waits
 * for A's release, then claims, then writes.
 */

import { get, set, del, createStore } from "idb-keyval";

import { awaitRelease, getWindowId, publish } from "./bus";

const store = createStore("virgil", "kv");
const OWNER_PREFIX = "doc-owner/";

interface OwnerRecord {
  windowId: string;
  acquiredAt: number;
}

function lockName(docId: string): string {
  return `virgil-doc-${docId}`;
}

async function readOwner(docId: string): Promise<OwnerRecord | undefined> {
  return get<OwnerRecord>(OWNER_PREFIX + docId, store);
}

async function writeOwner(docId: string, rec: OwnerRecord): Promise<void> {
  await set(OWNER_PREFIX + docId, rec, store);
}

async function clearOwner(docId: string): Promise<void> {
  await del(OWNER_PREFIX + docId, store);
}

/**
 * Held locks per doc, indexed by docId. We grab a held lock the moment
 * a window opens a doc and only release it when the doc is closed in
 * this window or handed off to another. This is what makes ownership
 * truly exclusive across windows: even an unrelated `withDocLock` in
 * window B will queue behind window A's held lock.
 */
const heldReleasers = new Map<string, () => void>();

/**
 * Try to claim a doc for this window. Returns `{ owned: true }` if we
 * got the lock; otherwise returns the current owner's windowId so the
 * caller can offer a handoff.
 *
 * The Web Locks API holds a lock for the lifetime of the callback
 * passed to `request`. We park the callback on a release-signal
 * promise so the lock stays held until `releaseDoc` resolves it.
 */
export async function claimDoc(
  docId: string,
): Promise<{ owned: true } | { owned: false; currentOwner?: string }> {
  if (typeof navigator === "undefined" || !navigator.locks) {
    return { owned: true }; // graceful degrade — single-window environments
  }
  if (heldReleasers.has(docId)) return { owned: true };

  const windowId = getWindowId();

  let resolveGrant!: (granted: boolean) => void;
  const grantPromise = new Promise<boolean>((r) => {
    resolveGrant = r;
  });
  let release!: () => void;
  const releaseSignal = new Promise<void>((r) => {
    release = r;
  });

  navigator.locks
    .request(
      lockName(docId),
      { mode: "exclusive", ifAvailable: true },
      async (lock) => {
        if (!lock) {
          resolveGrant(false);
          return;
        }
        heldReleasers.set(docId, release);
        resolveGrant(true);
        await releaseSignal;
      },
    )
    .catch(() => resolveGrant(false));

  const granted = await grantPromise;
  if (!granted) {
    const owner = await readOwner(docId);
    return { owned: false, currentOwner: owner?.windowId };
  }
  await writeOwner(docId, { windowId, acquiredAt: Date.now() });
  publish({ type: "doc-opened", windowId, docId });
  return { owned: true };
}

/**
 * The doc DRAIN hook (task 596).
 *
 * Releasing ownership is not a UI event — it is a **write-ordered**
 * event: this window's queued writes must reach disk while the hold is
 * still valid, because `withDocLock` only short-circuits
 * (`heldReleasers.has`) while we own the doc. Drop the hold first and
 * every drain write issues a REAL `navigator.locks.request` instead —
 * which (a) disqualifies the peer's `ifAvailable` claim, because Web
 * Locks refuses a grant while an earlier conflicting request is merely
 * PENDING, so the handoff the user just confirmed silently does
 * nothing; or (b) queues behind the peer's new hold and lands late,
 * clobbering what the new owner has been writing.
 *
 * `releaseDoc` therefore drains BEFORE it drops the hold — and it owns
 * that ordering so no caller has to re-derive it (four call sites
 * today, one of which got it right). The hook is injected rather than
 * imported because `drainDoc` lives in `@/lib/storage`, whose FSA
 * backend imports `withDocLock` from this module: importing it back
 * would close the cycle. `@/lib/storage` registers itself at module
 * load; a window where nothing ever imported storage has nothing to
 * drain, so a null hook is a correct no-op rather than a failure.
 */
let drainHook: ((docId: string) => Promise<void>) | null = null;

/** Register the pending-write drain `releaseDoc` awaits. Called once,
 *  at module load, by `@/lib/storage`. */
export function registerDocDrain(fn: (docId: string) => Promise<void>): void {
  drainHook = fn;
}

/** Test seam: forget the registered drain. */
export function __resetDocDrainForTest(): void {
  drainHook = null;
}

/**
 * Release this window's hold on `docId`. Safe to call when not held.
 *
 * Awaits the doc's pending writes first (see `registerDocDrain`), so
 * the caller's `await releaseDoc(id)` means "this doc is on disk AND
 * available to peers", not just the second half. A drain that throws
 * does not strand the hold — we still release, because a doc nobody
 * can claim is worse than a write we already failed to make.
 */
export async function releaseDoc(docId: string): Promise<void> {
  if (!heldReleasers.has(docId)) return;
  if (drainHook) {
    try {
      await drainHook(docId);
    } catch {
      /* a failed write must not strand the lock */
    }
  }
  // Re-read after the await: a concurrent release may have won while
  // the drain was in flight, and releasing twice would publish two
  // handoff-released events for one hold.
  const release = heldReleasers.get(docId);
  if (!release) return;
  heldReleasers.delete(docId);
  // Owner record cleared first so a peer reading the cache after the
  // release event sees no stale owner.
  await clearOwner(docId);
  release();
  publish({
    type: "doc-handoff-released",
    docId,
    byWindowId: getWindowId(),
  });
  publish({ type: "doc-closed", windowId: getWindowId(), docId });
}

/** True iff this window currently holds the lock for `docId`. */
export function ownsDoc(docId: string): boolean {
  return heldReleasers.has(docId);
}

/** Read the current owner of `docId` (cache; lock is source of truth). */
export async function currentOwner(docId: string): Promise<string | undefined> {
  const rec = await readOwner(docId);
  return rec?.windowId;
}

/**
 * Ask the current owner of `docId` to release. Resolves true when the
 * release event arrives, false on timeout. Safe to call when there is
 * no current owner — returns true immediately.
 */
export async function requestHandoff(docId: string): Promise<boolean> {
  const owner = await currentOwner(docId);
  if (!owner) return true;
  publish({
    type: "doc-handoff-request",
    fromWindowId: getWindowId(),
    toWindowId: owner,
    docId,
  });
  return awaitRelease(docId);
}

/**
 * Run `fn` while holding the doc's exclusive lock. Use for every FSA
 * write: it serializes writes within a window (matches the existing
 * write-queue.ts semantics) AND across windows during a handoff window.
 *
 * If this window already owns the doc (claimDoc was called), the
 * outer hold satisfies the request and `fn` runs immediately. Otherwise
 * the request queues behind whichever window does own it.
 */
export async function withDocLock<T>(
  docId: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks) return fn();
  // When this window already holds the lock, navigator.locks would
  // queue a second request behind ourselves and deadlock. Skip the
  // request and just run.
  if (heldReleasers.has(docId)) return fn();
  return navigator.locks.request(lockName(docId), { mode: "exclusive" }, fn) as Promise<T>;
}

/**
 * Release every held doc on this window. Call from `pagehide` so a
 * clean close advertises availability before the lock would expire
 * on its own.
 *
 * DECIDED, not inherited (task 596): these releases drain like every
 * other one. A `pagehide` handler cannot await, so the drain may not
 * finish — but the ordering still matters in the two cases where the
 * page does NOT go away: a BFCache freeze (the page may be restored
 * with those writes still queued, and the hold is what keeps them
 * exclusive) and a `pagehide` that no unload follows. On a real
 * unload the browser releases the lock itself, so an unfinished drain
 * cannot strand a peer either way.
 */
export async function releaseAll(): Promise<void> {
  const ids = [...heldReleasers.keys()];
  await Promise.all(ids.map((id) => releaseDoc(id)));
}
