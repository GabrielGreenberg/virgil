/**
 * Per-doc registry of "fire your pending React-debounced save now."
 *
 * `useDocument` holds the autosave debounce in React-local state. When a
 * caller in another subtree (e.g. `useFiles.flushOutgoing` during a doc
 * switch, or a `pagehide` listener during refresh) needs to make sure
 * the most recent edit reaches the storage queue before that doc's
 * pipeline ends, it calls `flushPendingForDoc(docId)` — which fires the
 * registered debounce immediately and returns its write promise.
 *
 * Without this, pending edits inside the debounce window are dropped
 * silently when the editor unmounts or the page tears down. The storage
 * layer's `flushDoc` only drains writes that have already entered the
 * queue; un-fired debounces are invisible to it.
 *
 * Mirrors the shape of `doc-pipeline.ts`: token-matched register/unregister
 * so a stale flusher can't accidentally evict the live one.
 */

type Flusher = () => Promise<void>;

const flushers = new Map<string, Flusher>();

export function registerPendingFlusher(docId: string, fn: Flusher): void {
  flushers.set(docId, fn);
}

/**
 * Idempotent unregister. Only removes if `fn` matches the currently
 * registered flusher, so a newer registration for the same docId isn't
 * accidentally cleared by a stale cleanup.
 */
export function unregisterPendingFlusher(docId: string, fn: Flusher): void {
  if (flushers.get(docId) === fn) flushers.delete(docId);
}

/**
 * Fire the registered debounce for `docId` and await its write. No-op if
 * nothing is registered. Errors are propagated; callers that want
 * fire-and-forget semantics should attach `.catch(() => {})` themselves.
 */
export async function flushPendingForDoc(docId: string): Promise<void> {
  const fn = flushers.get(docId);
  if (fn) await fn();
}


/**
 * Fire EVERY registered debounce and wait for all of them. The app-wide doors
 * (the reload door, task 391) are not per-document: a reload drops every
 * mounted pipeline at once, and under multi-doc keep-alive the paper holding
 * unsaved work is often a BACKGROUND one nobody is looking at. Individual
 * failures are swallowed — one doc's failed flush must not strand the rest.
 */
export async function flushAllPendingDocs(): Promise<void> {
  await Promise.all(
    [...flushers.values()].map((fn) => fn().catch(() => {})),
  );
}

/** Test helper — wipe all registrations. */
export function __resetForTests(): void {
  flushers.clear();
}
