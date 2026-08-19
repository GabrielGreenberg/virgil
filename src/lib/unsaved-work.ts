/**
 * **The unsaved-work channel** — task 391.
 *
 * Virgil's disk-side laws are complete and were RIGHT in the 2026-08-19
 * incident: the 364 clobber guard PAUSED autosave while an external change
 * stood, and the 357 gates REFUSE a write that would drop content. Between
 * them the file on disk is protected against every automatic write.
 *
 * > **What no law covered is the other side: while a write is refused, paused,
 * > or erroring, the editor's memory is the ONLY copy of the user's work — and
 * > every door that drops memory (a service-worker reload, a badge reload, a
 * > tab close, a crash) stays fully armed.** So the state "this document holds
 * > work that has not landed on disk" is a fact about the DOCUMENT, published
 * > once to one store, and every gate that could drop memory reads it there.
 *
 * ## Why this is not `saveTimerRef.current !== null`
 *
 * `useDocument`'s debounce handle was the de-facto dirty flag, and it is
 * unsound for this question in BOTH directions. The timer callback sets it to
 * `null` *before* calling `save()`, so a REFUSED write leaves the document
 * dirty with the flag already cleared — the exact state in which the guards
 * downstream (the watcher's conflict severity, the unload prompt) go quiet
 * while the work is most at risk. And a re-armed pause keeps it non-null
 * forever, which says "a write is coming" when the truth is "no write can
 * land".
 *
 * This store answers the question directly instead: `dirtySince` is set by a
 * real user edit and cleared by nothing but a write that ACTUALLY LANDED.
 *
 * ## The blocking reason
 *
 * Every path that declines to write says WHY, through {@link noteSaveBlocked}.
 * The reason is what the surfaces quote back to the user, what decides whether
 * the emergency mirror arms immediately or after aging, and — for the update
 * banner — what tells the user which flow to resolve. A decline with no stated
 * reason is the silence this whole cluster exists to end.
 *
 * ## Keystroke sanctity
 *
 * {@link noteUnsavedEdit} runs on the typing path, so it is O(1) and it emits
 * ONLY on the clean→dirty edge: the second keystroke of a burst compares one
 * field and returns. Subscribers therefore see one notification per dirty
 * transition, never one per character. The AGE that surfaces display is
 * derived from `dirtySince` at render time by a per-minute ticker in the
 * component, never by a store write.
 */

/** Why a write did not land. Ordered loosely by how much the user must do. */
export type UnsavedBlockReason =
  /** The 364 clobber guard is holding autosave: an external change to this
   *  document is unresolved, so an automatic write would overwrite it. */
  | "conflict"
  /** A 350-D/357 preservation gate refused: the model represents the file
   *  less completely than the file does. */
  | "preservation"
  /** The write attempt threw — FSA permission lost, a lock error, a quota
   *  failure, a superseded pipeline. */
  | "error";

export interface UnsavedWorkState {
  docId: string;
  /** ms epoch of the edit that made this document dirty, or `null` when
   *  everything the user has typed is on disk. */
  dirtySince: number | null;
  /** ms epoch of the last write that ACTUALLY landed, or `null` if none has
   *  since this document was opened. */
  lastLandedAt: number | null;
  /** Why the last attempt did not land, or `null` when nothing is blocking
   *  (dirty-but-unblocked simply means a write is on its way). */
  reason: UnsavedBlockReason | null;
  /** ms epoch of the last attempt that was declined or failed. */
  lastAttemptAt: number | null;
}

const byDoc = new Map<string, UnsavedWorkState>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function current(docId: string): UnsavedWorkState {
  return (
    byDoc.get(docId) ?? {
      docId,
      dirtySince: null,
      lastLandedAt: null,
      reason: null,
      lastAttemptAt: null,
    }
  );
}

function commit(next: UnsavedWorkState): void {
  byDoc.set(next.docId, Object.freeze(next));
  emit();
}

/** `useSyncExternalStore` shape — see `preservation-notice.ts` for the same
 *  pattern. Per-doc snapshots are frozen and identity-stable, so a subscriber
 *  for doc A re-renders on a doc B change and then bails on an equal snapshot. */
export function subscribeUnsavedWork(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** This document's live state. Stable identity while nothing changes. */
export function getUnsavedWork(
  docId: string | null | undefined,
): UnsavedWorkState | null {
  if (!docId) return null;
  return byDoc.get(docId) ?? null;
}

/**
 * A real user edit landed in the model. **Typing path — O(1), and it emits
 * only on the clean→dirty edge.**
 */
export function noteUnsavedEdit(docId: string, now = Date.now()): void {
  const prev = byDoc.get(docId);
  if (prev && prev.dirtySince !== null) return; // already dirty — nothing to say
  commit({ ...current(docId), dirtySince: now });
}

/**
 * A write ACTUALLY landed — the disk now holds this model. Clears the dirty
 * state and any blocking reason. Never called from the absence of a throw:
 * `useDocument.save` reads the refusal channel first (task 357 hole 4).
 */
export function noteSaveLanded(docId: string, now = Date.now()): void {
  const prev = byDoc.get(docId);
  if (prev && prev.dirtySince === null && prev.reason === null) {
    // Already clean; only advance the landed clock if it moved.
    if (prev.lastLandedAt === now) return;
  }
  commit({
    ...current(docId),
    dirtySince: null,
    reason: null,
    lastLandedAt: now,
  });
}

/**
 * A write attempt did not land, and this is why. Idempotent for a repeated
 * reason (the autosave retries every 1500 ms while a gate stands, and the
 * paused debounce re-arms forever) — only the FIRST attempt of a run and any
 * change of reason notify, so a standing block costs no re-renders.
 *
 * A block implies dirt: a path can only decline a write it was asked to make,
 * so a reason arriving on a document with no `dirtySince` (the mint-flush
 * shape, which writes without typing) sets one.
 */
export function noteSaveBlocked(
  docId: string,
  reason: UnsavedBlockReason,
  now = Date.now(),
): void {
  const prev = current(docId);
  const dirtySince = prev.dirtySince ?? now;
  if (prev.reason === reason && prev.dirtySince === dirtySince) {
    // Same standing block. Record the attempt WITHOUT notifying: the retry
    // clock is not something any surface renders, and emitting here would
    // re-render the topbar every 1500 ms for the life of the block.
    byDoc.set(docId, Object.freeze({ ...prev, lastAttemptAt: now }));
    return;
  }
  commit({ ...prev, dirtySince, reason, lastAttemptAt: now });
}

/**
 * Does this document hold work that has not reached disk? The ONE predicate;
 * every door that could drop memory asks it rather than keeping its own.
 */
export function hasUnlandedWork(docId: string | null | undefined): boolean {
  const s = getUnsavedWork(docId);
  return s !== null && s.dirtySince !== null;
}

/** How long this document's work has been unsaved, in ms (0 when clean). */
export function unsavedAgeMs(
  docId: string | null | undefined,
  now = Date.now(),
): number {
  const s = getUnsavedWork(docId);
  if (!s || s.dirtySince === null) return 0;
  return Math.max(0, now - s.dirtySince);
}

/**
 * Every document that currently holds unlanded work. The app-wide doors (the
 * service-worker update banner) are not per-document — a reload drops every
 * mounted pipeline at once — so they ask this rather than the active doc's
 * state. Multi-doc keep-alive means a BACKGROUND paper can be the one holding
 * unsaved work, and it is exactly the one nobody is looking at.
 */
export function docsWithUnlandedWork(): UnsavedWorkState[] {
  const out: UnsavedWorkState[] = [];
  for (const s of byDoc.values()) if (s.dirtySince !== null) out.push(s);
  return out;
}

/**
 * Forget a document's state entirely — it was closed, or reloaded from disk
 * (an external-change Reload makes the disk authoritative, so whatever was
 * unlanded is gone by the user's own decision).
 */
export function clearUnsavedWork(docId?: string): void {
  if (docId === undefined) {
    if (byDoc.size === 0) return;
    byDoc.clear();
  } else if (!byDoc.delete(docId)) {
    return;
  }
  emit();
}
