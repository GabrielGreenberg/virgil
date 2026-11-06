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

import { set, del, createStore } from "idb-keyval";
import { readStoredValue, type StoredVerdict } from "@/lib/stored-state";

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

function validateOwner(value: unknown): StoredVerdict {
  const r = value as Partial<OwnerRecord> | null;
  if (typeof r !== "object" || r === null) return { why: "invalid", detail: "not an object" };
  if (typeof r.windowId !== "string") return { why: "invalid", detail: "no windowId" };
  if (typeof r.acquiredAt !== "number") return { why: "invalid", detail: "no acquiredAt" };
  return true;
}

/** Through the stored-state door (task 852): a malformed record is no owner. */
async function readOwner(docId: string): Promise<OwnerRecord | undefined> {
  return (
    (await readStoredValue<OwnerRecord>(OWNER_PREFIX + docId, {
      store,
      validate: validateOwner,
    })) ?? undefined
  );
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
 * Docs this window holds the lock for ONLY for the span of a
 * `withDocIfUnclaimed` section (it never opened them). Kept apart from
 * `heldReleasers` so `ownsDoc` and `releaseDoc` are untouched by it —
 * the section is not an open doc and must not publish open/close events.
 */
const exclusiveSections = new Set<string>();

/** Docs whose hold `releaseDoc` has dropped from `heldReleasers` but the
 *  browser has not yet taken back — still this window's lock for that span. */
const releasing = new Map<string, Promise<unknown>>();

/*
 * ── The per-doc claim/release state machine (task 1454) ──────────────────
 *
 * A doc moves through these states in ONE window; this module is the only
 * owner of the transitions, so no caller has to know which one is in flight:
 *
 *   free ──claimDoc──▶ CLAIMING ──grant──▶ HELD ──releaseDoc──▶ DRAINING
 *     ▲                                     ▲                     │
 *     │                                     └──claimDoc (cancel)──┤
 *     └───────────── RELEASING ◀────────── drain done, not wanted ┘
 *
 *  - CLAIMING (`claiming`): a second `claimDoc` in this window joins the
 *    first rather than racing it — before, both reached `ifAvailable`
 *    before either set `heldReleasers`, and the second read this window's
 *    own pending lock as a peer's (a false "open elsewhere" prompt whose
 *    handoff goes to ourselves and times out).
 *  - DRAINING (`draining`): the hold is still ours (`ownsDoc` is true, so
 *    the drain's writes take `withDocLock`'s short-circuit). A `claimDoc`
 *    here is a RE-ADMIT — the paper was reopened while its close was still
 *    flushing — and CANCELS the release: the drain finishes, the hold is
 *    kept, nothing is published. Before, the reopen saw `ownsDoc` and
 *    skipped the claim, the drain then dropped the lock under the open doc,
 *    and a peer window could claim it and write beside us.
 *  - RELEASING (`releasing`): the hold is gone from `heldReleasers` but the
 *    browser has not taken the lock back. A `claimDoc` here waits it out and
 *    claims afresh — our own lock is not a peer's.
 *
 * So "open" means "claimed": every door that shows a paper calls
 * `claimDoc` (cheap when HELD), never `ownsDoc` as a stand-in for it.
 */

type ClaimResult = { owned: true } | { owned: false; currentOwner?: string };

/** In-flight claims, so concurrent claims in one window are ONE claim. */
const claiming = new Map<string, Promise<ClaimResult>>();

/** In-flight releases still in their drain. `wanted` flips true when the
 *  doc is re-claimed mid-drain; the release then keeps the hold. */
interface Drain {
  done: Promise<void>;
  wanted: boolean;
}
const draining = new Map<string, Drain>();

/** Wait out this window's own lock hand-back for `docId` (RELEASING). The
 *  first mark covers the owner-record clear; `release()` then re-points it
 *  at the lock's settle — so loop until the mark is gone. */
async function awaitOwnRelease(docId: string): Promise<void> {
  while (releasing.has(docId)) {
    const pending = releasing.get(docId);
    await pending;
    if (releasing.get(docId) === pending) releasing.delete(docId);
  }
}

/**
 * Try to claim a doc for this window. Returns `{ owned: true }` if we
 * got the lock; otherwise returns the current owner's windowId so the
 * caller can offer a handoff.
 *
 * The Web Locks API holds a lock for the lifetime of the callback
 * passed to `request`. We park the callback on a release-signal
 * promise so the lock stays held until `releaseDoc` resolves it.
 */
export async function claimDoc(docId: string): Promise<ClaimResult> {
  if (typeof navigator === "undefined" || !navigator.locks) {
    return { owned: true }; // graceful degrade — single-window environments
  }
  // DRAINING: a re-admit cancels the release in flight (see the state
  // machine above). HELD: already ours.
  const drain = draining.get(docId);
  if (drain) drain.wanted = true;
  if (heldReleasers.has(docId)) return { owned: true };
  // CLAIMING: join the claim already in flight.
  const inFlight = claiming.get(docId);
  if (inFlight) return inFlight;
  const claim = takeLock(docId);
  claiming.set(docId, claim);
  try {
    return await claim;
  } finally {
    if (claiming.get(docId) === claim) claiming.delete(docId);
  }
}

/** The free → HELD transition: wait out our own RELEASING, then try the
 *  lock. Only `claimDoc` calls this (it owns the in-flight dedup). */
async function takeLock(docId: string): Promise<ClaimResult> {
  await awaitOwnRelease(docId);
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

  // Settles only once the browser has actually given the lock back —
  // after `release()` AND the callback's own return.
  const given = navigator.locks
    .request(
      lockName(docId),
      { mode: "exclusive", ifAvailable: true },
      async (lock) => {
        if (!lock) {
          resolveGrant(false);
          return;
        }
        heldReleasers.set(docId, () => {
          releasing.set(docId, given);
          release();
        });
        resolveGrant(true);
        await releaseSignal;
      },
    )
    .catch(() => resolveGrant(false))
    .finally(() => {
      if (releasing.get(docId) === given) releasing.delete(docId);
    });

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
  // A claim in flight lands first, so a close that races its own open
  // releases the hold rather than missing it and leaking it.
  const inFlight = claiming.get(docId);
  if (inFlight) await inFlight.catch(() => {});
  // DRAINING already: this close supersedes any re-admit since — join it.
  const drain = draining.get(docId);
  if (drain) {
    drain.wanted = false;
    return drain.done;
  }
  if (!heldReleasers.has(docId)) return;
  // Registered BEFORE the drain starts: with no drain hook it runs to its
  // first real await synchronously and unregisters itself on the way.
  const entry: Drain = { done: Promise.resolve(), wanted: false };
  draining.set(docId, entry);
  entry.done = drainThenRelease(docId, entry);
  return entry.done;
}

/** HELD → DRAINING → (RELEASING | HELD). Only `releaseDoc` calls this. */
async function drainThenRelease(docId: string, entry: Drain): Promise<void> {
  try {
    if (drainHook) {
      try {
        await drainHook(docId);
      } catch {
        /* a failed write must not strand the lock */
      }
    }
  } finally {
    if (draining.get(docId) === entry) draining.delete(docId);
  }
  // Re-admitted mid-drain: the doc is open again, so the hold stays.
  if (entry.wanted) return;
  const release = heldReleasers.get(docId);
  if (!release) return;
  heldReleasers.delete(docId);
  // The lock is still OURS until the browser takes it back; mark it so
  // `claimDoc` and `withDocIfUnclaimed` wait this out rather than mistake
  // our own hold for a peer's. `release()` re-points the mark at the
  // lock's settle.
  let cleared!: () => void;
  releasing.set(docId, new Promise<void>((r) => (cleared = r)));
  // Owner record cleared first so a peer reading the cache after the
  // release event sees no stale owner.
  try {
    await clearOwner(docId);
  } finally {
    cleared();
    release();
  }
  publish({
    type: "doc-handoff-released",
    docId,
    byWindowId: getWindowId(),
  });
  publish({ type: "doc-closed", windowId: getWindowId(), docId });
}

/** True iff this window currently holds the lock for `docId` (HELD or
 *  DRAINING). A door that OPENS a paper calls `claimDoc` instead — a
 *  reopen mid-drain must cancel the release, which this read cannot. */
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
  // When this window already holds the lock — as an open doc, or for
  // the span of a `withDocIfUnclaimed` section — navigator.locks would
  // queue a second request behind ourselves and deadlock. Skip the
  // request and just run.
  if (heldReleasers.has(docId) || exclusiveSections.has(docId)) return fn();
  return navigator.locks.request(lockName(docId), { mode: "exclusive" }, fn) as Promise<T>;
}


/**
 * Run `fn` only if NO OTHER live window holds `docId` — and keep it that
 * way until `fn` settles (task 1105).
 *
 * The door for an operation that retires a doc's identity (forgetting it,
 * resetting it): such an operation deletes the doc's folder handle, its
 * emergency mirror and its local sidecars, so run under a peer's live
 * editor it pulls the floor out from under that window's next save. Two
 * properties make this the right question rather than a cache read:
 *
 *  - **Liveness is the browser's.** The answer is the Web Lock itself, not
 *    the `doc-owner/` record (a cache that a crashed window can leave
 *    behind). A closed or crashed window's lock is already gone.
 *  - **No gap.** When this window does not own the doc, the lock is TAKEN
 *    (`ifAvailable`) and held while `fn` runs, so a peer cannot open the
 *    doc between the check and the purge. Writes this window issues
 *    inside `fn` short-circuit (`withDocLock`) instead of queueing behind
 *    the section and deadlocking.
 *
 * Returns `{ ran: false }` without calling `fn` when a peer holds the doc.
 * A window that already owns the doc runs `fn` directly (no peer can hold
 * it). Where Web Locks are unavailable there is only one window.
 *
 * Callers drain this window's queued writes for the doc BEFORE entering:
 * a write already waiting on a real lock request would make the
 * `ifAvailable` take fail, which reads as "held elsewhere".
 */
export async function withDocIfUnclaimed<T>(
  docId: string,
  fn: () => Promise<T>,
): Promise<{ ran: true; value: T } | { ran: false }> {
  if (
    typeof navigator === "undefined" ||
    !navigator.locks ||
    heldReleasers.has(docId) ||
    exclusiveSections.has(docId)
  ) {
    return { ran: true, value: await fn() };
  }
  // Our own release in flight is not a peer: let it finish first. Nor is
  // our own claim in flight — let it land, and if it took the doc, the doc
  // is ours.
  await awaitOwnRelease(docId);
  const inFlight = claiming.get(docId);
  if (inFlight) await inFlight.catch(() => {});
  if (heldReleasers.has(docId) || exclusiveSections.has(docId)) {
    return { ran: true, value: await fn() };
  }
  const NOT_GRANTED = Symbol("not-granted");
  const out = await navigator.locks.request(
    lockName(docId),
    { mode: "exclusive", ifAvailable: true },
    async (lock) => {
      if (!lock) return NOT_GRANTED;
      exclusiveSections.add(docId);
      try {
        return { value: await fn() };
      } finally {
        exclusiveSections.delete(docId);
      }
    },
  );
  if (out === NOT_GRANTED) return { ran: false };
  return { ran: true, value: (out as { value: T }).value };
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
