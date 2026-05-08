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

/** Release this window's hold on `docId`. Safe to call when not held. */
export async function releaseDoc(docId: string): Promise<void> {
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

/** Release every held doc on this window. Call from `pagehide` so a
 *  clean close advertises availability before the lock would expire
 *  on its own. */
export async function releaseAll(): Promise<void> {
  const ids = [...heldReleasers.keys()];
  await Promise.all(ids.map((id) => releaseDoc(id)));
}
