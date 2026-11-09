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
 *
 * ## Two kinds of writer, one fact — task 1503
 *
 * A document's content is written by more than the bundle autosave: every card
 * sidecar (`usePersistentState` — notes, todos, reports, cutter, revisions… —
 * plus the bespoke `useFootnotes` / `useBibReview` writers) holds the user's
 * card edits in its own debounce and its own in-flight write. Until 1503 only
 * `useDocument` published here, so a card body typed in the last 300 ms, or a
 * sidecar write still in flight, was invisible to the leave prompt, the save
 * badge and the reload door — "this document holds work not yet on disk" was
 * published by one of its writers.
 *
 * The two kinds stay DISTINGUISHABLE, because some readers are model-scoped:
 * `dirtySince` / `reason` are the MODEL's (the `.tex` bundle — what the
 * emergency mirror can store, what the clobber guard pauses, what a refusal
 * gate measures), and `sidecarDirtySince` is the earliest still-pending SIDECAR
 * writer's. Each sidecar writer is a member of a per-document SET
 * ({@link noteSidecarWork}), so a bundle landing (`noteSaveLanded`) cannot
 * clear a card's dirt, and one card's landing cannot clear another's. The
 * door predicates — {@link hasUnlandedWork}, {@link docsWithUnlandedWork} —
 * ask about EITHER kind; {@link hasUnlandedModelWork} is the model-only read
 * for the bundle writer's own flush/receipt paths and the mirror.
 */

/** Why a write did not land. Ordered loosely by how much the user must do. */
export type UnsavedBlockReason =
  /** The 364 clobber guard is holding autosave: an external change to this
   *  document is unresolved, so an automatic write would overwrite it. */
  | "conflict"
  /** A 350-D/357 preservation gate refused: the model represents the file
   *  less completely than the file does. */
  | "preservation"
  /** Task 489 — an `/editor/*` cowork skill holds this paper's pen: it is
   *  mid-commit against the same folder, so an automatic write would race it.
   *  Transient by construction (the hold is one atomic commit, and the pen
   *  self-expires), so it clears itself rather than opening a flow. */
  | "cowork"
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
  /** Task 1503 — ms epoch at which the EARLIEST still-pending card-sidecar
   *  writer of this document went dirty (an armed debounce, a write in
   *  flight, or a write that failed and has not since landed), or `null` when
   *  every sidecar write has settled onto disk. Never touched by the bundle's
   *  `noteSaveLanded`. */
  sidecarDirtySince: number | null;
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
      sidecarDirtySince: null,
    }
  );
}

/** Per document: each pending sidecar writer (an opaque token one writer
 *  instance owns) → when it went dirty. A SET, so no writer's landing can
 *  clear another's dirt (task 1503). */
const sidecarWriters = new Map<string, Map<object, number>>();

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
 * reason (a PAUSED autosave re-arms its debounce and retries every 1500 ms for
 * as long as the pause stands; a REFUSED one is disarmed, and every later
 * write of the document — the next keystroke, a mint flush, a manual save —
 * is refused again; task 567) — only the FIRST attempt of a run and any
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
 * Task 1503 — one card-sidecar WRITER's pending state, published. `writer` is
 * an opaque token the writer instance owns for its life (identity is the
 * key); `pending` is that writer's own dirty predicate, re-stated after every
 * transition (armed, in flight, settled). **Typing path — O(1), and it emits
 * only when the document's `sidecarDirtySince` actually changes**: a writer
 * already in the set returns on one lookup, so the second keystroke of a
 * burst notifies nobody. Settling a writer that is not in the set (never
 * dirty, or its document already cleared) is a no-op and creates no entry.
 */
export function noteSidecarWork(
  docId: string,
  writer: object,
  pending: boolean,
  now = Date.now(),
): void {
  let set = sidecarWriters.get(docId);
  if (pending) {
    if (set?.has(writer)) return; // already dirty — nothing to say
    if (!set) {
      set = new Map();
      sidecarWriters.set(docId, set);
    }
    set.set(writer, now);
    const prev = current(docId);
    // An earlier writer still pending keeps the document's (older) clock.
    if (prev.sidecarDirtySince !== null && byDoc.has(docId)) return;
    commit({ ...prev, sidecarDirtySince: now });
    return;
  }
  if (!set || !set.delete(writer)) return;
  let earliest: number | null = null;
  for (const since of set.values()) {
    if (earliest === null || since < earliest) earliest = since;
  }
  if (set.size === 0) sidecarWriters.delete(docId);
  const prev = byDoc.get(docId);
  if (!prev || prev.sidecarDirtySince === earliest) return;
  commit({ ...prev, sidecarDirtySince: earliest });
}

/**
 * One sidecar writer instance's door onto {@link noteSidecarWork} — the
 * bookkeeping every writer would otherwise repeat (task 1503): it owns the
 * token, and remembers WHICH document it last published dirt under, so a
 * write still in flight for document A when the instance moves to B settles
 * A's entry rather than leaving it dirty forever. `sync` is the writer's
 * dirty predicate restated after every transition; it is O(1).
 *
 * **The channel is the publisher's only memory of "am I registered?"** (task
 * 1516). `publishedFor` answers one question only — which document to RELEASE
 * when the target moves — and never short-circuits a registration: a
 * `pending` sync always reaches {@link noteSidecarWork}, whose own
 * `set.has(writer)` bail keeps the repeat O(1) and silent. A private "already
 * published" cache would desync the moment {@link clearUnsavedWork} forgets
 * the document (an external-change Reload keeps the doc open and the writer
 * mounted), and the next failed write would then be invisible to every door
 * that asks {@link hasUnlandedWork}.
 */
export interface SidecarWorkPublisher {
  sync(docId: string | null | undefined, pending: boolean): void;
}

export function createSidecarWorkPublisher(): SidecarWorkPublisher {
  const token = {};
  let publishedFor: string | null = null;
  return {
    sync(docId, pending) {
      const target = pending && docId ? docId : null;
      if (publishedFor !== null && publishedFor !== target) {
        noteSidecarWork(publishedFor, token, false);
      }
      publishedFor = target;
      // Unconditional: the channel decides whether this is news.
      if (target !== null) noteSidecarWork(target, token, true);
    },
  };
}

/** Does the document's state hold work of EITHER kind? */
function isDirty(s: UnsavedWorkState): boolean {
  return s.dirtySince !== null || s.sidecarDirtySince !== null;
}

/**
 * When this document's oldest unlanded work of EITHER kind began, or `null`
 * when everything is on disk. What a surface answering "is my work on disk?"
 * ages from (the save badge, the reload door's report).
 */
export function unlandedSince(state: UnsavedWorkState | null): number | null {
  if (!state) return null;
  const a = state.dirtySince;
  const b = state.sidecarDirtySince;
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

/**
 * Does this document hold work that has not reached disk — the MODEL's or any
 * card sidecar's? The ONE predicate; every door that could drop memory (the
 * leave prompt, the reload door, the update banner) asks it rather than
 * keeping its own.
 */
export function hasUnlandedWork(docId: string | null | undefined): boolean {
  const s = getUnsavedWork(docId);
  return s !== null && isDirty(s);
}

/**
 * The MODEL-scoped half (task 1503): does the `.tex` bundle hold edits not on
 * disk? For the bundle writer's own questions — "is there a bundle write to
 * make?", "did my write land?" — which a pending card write must not answer.
 */
export function hasUnlandedModelWork(docId: string | null | undefined): boolean {
  const s = getUnsavedWork(docId);
  return s !== null && s.dirtySince !== null;
}

/** How long this document's work has been unsaved, in ms (0 when clean). */
export function unsavedAgeMs(
  docId: string | null | undefined,
  now = Date.now(),
): number {
  const since = unlandedSince(getUnsavedWork(docId));
  if (since === null) return 0;
  return Math.max(0, now - since);
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
  for (const s of byDoc.values()) if (isDirty(s)) out.push(s);
  return out;
}

/**
 * Forget a document's state entirely — it was closed, or reloaded from disk
 * (an external-change Reload makes the disk authoritative, so whatever was
 * unlanded is gone by the user's own decision).
 */
export function clearUnsavedWork(docId?: string): void {
  if (docId === undefined) {
    sidecarWriters.clear();
    if (byDoc.size === 0) return;
    byDoc.clear();
  } else {
    sidecarWriters.delete(docId);
    if (!byDoc.delete(docId)) return;
  }
  emit();
}
