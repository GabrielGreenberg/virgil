/**
 * Per-doc registry of "fire your pending React-debounced write now."
 *
 * A document's writes are coalesced in SEVERAL places, each holding its own
 * debounce in React-local state: `useDocument` (the `.tex` / bundle autosave,
 * 1500 ms), every `usePersistentState` instance (one per card sidecar — ~20 per
 * document, at the file's own tier cadence), and `useEditorUIState` (the
 * per-machine view-state coalescer). When a caller in another subtree needs to
 * make sure the most recent edit reaches the storage queue before that doc's
 * pipeline ends — `drainDoc` during a doc switch, the reload door before a
 * page tears down — it calls `flushPendingForDoc(docId)` (one document) or
 * `flushAllPendingDocs()` (every mounted one), which fire the registered
 * debounces immediately and return their write promises.
 *
 * Without this, pending edits inside a debounce window are dropped silently
 * when the editor unmounts or the page tears down. The storage layer's
 * `flushDoc` only drains writes that have already entered the queue; un-fired
 * debounces are invisible to it.
 *
 * ## A MULTI-SET, not a slot — task 559
 *
 * This was a `Map<docId, Flusher>` — ONE registration per document — and
 * exactly one writer took it (`useDocument`). Every sidecar hook kept its own
 * private timer and registered nothing, so the reload door's step 1 ("fire
 * every document's pending debounce") fired one debounce of the twenty-odd a
 * document holds: a note body typed in the 300 ms before an app-driven reload
 * was outside the door, outside the unsaved-work channel (which only the
 * bundle path feeds) and outside the mirror (which stores the TipTap MODEL,
 * where a card body does not live). The door then reported `unlanded: []` —
 * honestly by its own lights, and wrongly about the document.
 *
 * > **Every coalescing writer registers its settle door here, under its
 * > document, and "flush the document" means every one of them.** One
 * > registry, so the next app-wide door has nothing to remember. A second
 * > "flush all sidecars" registry beside this one would be the same gap with
 * > two names.
 *
 * ## TWO PHASES: settle, then write — task 559
 *
 * Not every coalescer writes DISK. The code pane holds the user's last 600 ms
 * of typing in CodeMirror and only then re-parses it INTO the TipTap model;
 * the bundle writer (`useDocument.flushPending`) reads that model live. So a
 * flat "fire everything at once" is order-dependent in exactly the wrong way:
 * the writer's registration is older (its host mounts first), so it starts
 * first, snapshots the model WITHOUT the pending code edit, and the edit then
 * lands in a model the page is about to discard. A flusher that feeds what
 * another flusher reads is a `settle` flusher, and every settle flusher is
 * awaited to completion before any `write` flusher STARTS.
 *
 * `write` is the default and that is the honest one, not an unstated choice:
 * a registrant that puts bytes on disk is what this registry has always held.
 * A `settle` registrant makes the STRONGER claim — "I mutate what a writer will
 * read" — and a stronger claim is stated by the one making it. Nothing else in
 * the phase is inferred.
 *
 * Registrations are token-matched (the `doc-pipeline.ts` shape): unregister
 * removes only the identical function, so a stale cleanup can't evict a live
 * sibling's registration — which matters more now that a document holds many.
 */

type Flusher = () => Promise<void>;

/**
 * `settle` — fires pending work INTO the document model (the code pane's
 * code→TipTap re-parse). `write` — fires a pending DISK write (the bundle
 * autosave, a sidecar debounce, the view-state coalescer). Settle completes
 * before write starts.
 */
export type FlushPhase = "settle" | "write";

interface DocFlushers {
  settle: Set<Flusher>;
  write: Set<Flusher>;
}

const flushers = new Map<string, DocFlushers>();

export interface RegisterPendingFlusherOptions {
  /** Defaults to `"write"` — see the module header for why that is the honest default. */
  phase?: FlushPhase;
}

export function registerPendingFlusher(
  docId: string,
  fn: Flusher,
  opts?: RegisterPendingFlusherOptions,
): void {
  let entry = flushers.get(docId);
  if (!entry) {
    entry = { settle: new Set(), write: new Set() };
    flushers.set(docId, entry);
  }
  entry[opts?.phase ?? "write"].add(fn);
}

/**
 * Idempotent unregister. Only removes `fn` itself — a newer registration for
 * the same docId (or a sibling writer's) isn't accidentally cleared by a stale
 * cleanup. Phase-blind: a function is registered under exactly one phase, so
 * removing it from both is removing it from the one it is in.
 */
export function unregisterPendingFlusher(docId: string, fn: Flusher): void {
  const entry = flushers.get(docId);
  if (!entry) return;
  entry.settle.delete(fn);
  entry.write.delete(fn);
  if (entry.settle.size === 0 && entry.write.size === 0) flushers.delete(docId);
}

/**
 * Run one document's flushers in phase order. Every member of a phase is
 * STARTED before any member of it is awaited (they are independent writes);
 * the `write` phase is not started until the whole `settle` phase has
 * resolved — that gap is the contract, see the module header. `run` wraps
 * each call so the caller decides between propagating and swallowing.
 */
async function flushDocPhased(
  entry: DocFlushers,
  run: (fn: Flusher) => Promise<void>,
): Promise<void> {
  if (entry.settle.size > 0) {
    await Promise.all([...entry.settle].map(run));
  }
  if (entry.write.size > 0) {
    await Promise.all([...entry.write].map(run));
  }
}

/**
 * Fire EVERY registered debounce for `docId` — settle phase, then write phase
 * — and await their writes. No-op if nothing is registered. Errors are
 * propagated (the first rejection of a phase wins, the rest of that phase
 * still run; a settle rejection stops the write phase, since the model the
 * writers would snapshot is then not the one the user has); callers that want
 * fire-and-forget semantics should attach `.catch(() => {})` themselves. In
 * practice the sidecar flushers never reject — their `persist` catches and
 * logs — so a rejection here is the bundle write's.
 */
export async function flushPendingForDoc(docId: string): Promise<void> {
  const entry = flushers.get(docId);
  if (!entry) return;
  await flushDocPhased(entry, (fn) => fn());
}

/**
 * Fire EVERY registered debounce of EVERY document and wait for all of them.
 * The app-wide doors (the reload door, task 391) are not per-document: a
 * reload drops every mounted pipeline at once, and under multi-doc keep-alive
 * the paper holding unsaved work is often a BACKGROUND one nobody is looking
 * at. Individual failures are swallowed — one writer's failed flush must not
 * strand the rest, and one document's must not strand another's. Documents
 * run concurrently; each document's phases run in order.
 */
export async function flushAllPendingDocs(): Promise<void> {
  const swallow = (fn: Flusher) => fn().catch(() => {});
  await Promise.all(
    [...flushers.values()].map((entry) => flushDocPhased(entry, swallow)),
  );
}

/** Test helper — how many flushers are registered under `docId`, optionally one phase's. */
export function __registeredCountForTests(
  docId: string,
  phase?: FlushPhase,
): number {
  const entry = flushers.get(docId);
  if (!entry) return 0;
  if (phase) return entry[phase].size;
  return entry.settle.size + entry.write.size;
}

/** Test helper — wipe all registrations. */
export function __resetForTests(): void {
  flushers.clear();
}
