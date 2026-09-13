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
 * Registrations are token-matched (the `doc-pipeline.ts` shape): unregister
 * removes only the identical function, so a stale cleanup can't evict a live
 * sibling's registration — which matters more now that a document holds many.
 */

type Flusher = () => Promise<void>;

const flushers = new Map<string, Set<Flusher>>();

export function registerPendingFlusher(docId: string, fn: Flusher): void {
  let set = flushers.get(docId);
  if (!set) {
    set = new Set();
    flushers.set(docId, set);
  }
  set.add(fn);
}

/**
 * Idempotent unregister. Only removes `fn` itself — a newer registration for
 * the same docId (or a sibling writer's) isn't accidentally cleared by a stale
 * cleanup.
 */
export function unregisterPendingFlusher(docId: string, fn: Flusher): void {
  const set = flushers.get(docId);
  if (!set) return;
  set.delete(fn);
  if (set.size === 0) flushers.delete(docId);
}

/**
 * Fire EVERY registered debounce for `docId` and await their writes. No-op if
 * nothing is registered. Errors are propagated (the first rejection wins, the
 * rest still run — every flusher is started before any is awaited); callers
 * that want fire-and-forget semantics should attach `.catch(() => {})`
 * themselves. In practice the sidecar flushers never reject — their `persist`
 * catches and logs — so a rejection here is the bundle write's.
 */
export async function flushPendingForDoc(docId: string): Promise<void> {
  const set = flushers.get(docId);
  if (!set || set.size === 0) return;
  await Promise.all([...set].map((fn) => fn()));
}

/**
 * Fire EVERY registered debounce of EVERY document and wait for all of them.
 * The app-wide doors (the reload door, task 391) are not per-document: a
 * reload drops every mounted pipeline at once, and under multi-doc keep-alive
 * the paper holding unsaved work is often a BACKGROUND one nobody is looking
 * at. Individual failures are swallowed — one writer's failed flush must not
 * strand the rest.
 */
export async function flushAllPendingDocs(): Promise<void> {
  const all: Promise<void>[] = [];
  for (const set of flushers.values()) {
    for (const fn of set) all.push(fn().catch(() => {}));
  }
  await Promise.all(all);
}

/** Test helper — how many writers are registered under `docId`. */
export function __registeredCountForTests(docId: string): number {
  return flushers.get(docId)?.size ?? 0;
}

/** Test helper — wipe all registrations. */
export function __resetForTests(): void {
  flushers.clear();
}
