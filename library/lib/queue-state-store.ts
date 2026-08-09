"use client";

/**
 * Module-level singleton for the library's **queue state** — the third cowork
 * reconciliation channel, alongside `catalog-store` (catalog.json) and
 * `useNotificationStream` (inbox.json).
 *
 * ## Why this exists
 *
 * `.virgil/queue/*.json` is written by BOTH sides: the frontend files intent
 * (an AI-request checkbox, a row action), and a background Claude session
 * (`/loop /library/index-pending`) drains and DELETES the file when the work
 * lands. The catalog and the inbox each had a poll channel for that
 * out-of-band mutation; the queue files did not. Every consumer therefore
 * invented its own cadence, and one of them had no cadence at all:
 *
 *   - `useRowDotState` polled the whole queue directory every 6 s → the red
 *     "pending" dot in the list. Truthful, but citekey-granular only.
 *   - `PaperHeader` read five targeted queue files ONCE per `(handle,
 *     citekey)` mount. The Reader is kept alive by `ReaderLRU`
 *     (`KeepAliveSlot` = `display:none`, not a remount), so that effect never
 *     re-ran: after a skill drained the queue, the AI-request checkboxes and
 *     the `PaperAiRequestsMenu` count badge kept claiming "queued" for the
 *     whole keep-alive lifetime (task 132).
 *   - `useBibReviewState` implemented a THIRD cadence (focus-regain) for one
 *     kind, and had no consumers at all.
 *
 * The same gap ran the other way too: `LibraryView`'s row actions
 * (`queueBibReview` / `queuePaperReview` / `queueImportBib` / `queueDelete`)
 * write a queue file and notify nobody, so a paper's OPEN reader header never
 * learned about a request filed from the list, and the row dot lagged a poll.
 *
 * ## The shape
 *
 * ONE scan of the queue directory per tick, refcounted across every consumer
 * (same tactic as `catalog-store`), producing a per-(citekey, kind) snapshot.
 * The header therefore adds ZERO disk reads — it reads the scan the row dots
 * were already paying for — and both surfaces now answer from the same bytes,
 * so they cannot disagree.
 *
 * Emits are equality-gated: an idle tick over an unchanged queue returns the
 * SAME snapshot object, so `useSyncExternalStore` notifies nobody and no
 * consumer re-renders (the `catalog-store` R6 rule).
 *
 * After a LOCAL write, call `refreshQueueState()` — it re-reads immediately
 * and is the single notification channel for every queue writer.
 */

import { useEffect, useSyncExternalStore } from "react";
import { listDir, readJsonFile, SUBDIRS } from "./library-storage";
import { normalizeQueueEntry, type QueueEntry, type QueueKind } from "./queue";

const POLL_MS = 6000;

export interface QueueSnapshot {
  /** citekey → the queue kinds that have a `requested` entry on disk RIGHT
   *  NOW. A kind absent from the set (or a citekey absent from the map) means
   *  nothing is queued — a drained request disappears here exactly as it does
   *  on disk. `running`/`done`/`failed` entries are deliberately excluded:
   *  "queued" means cancellable, which is what both consumers render. */
  requested: ReadonlyMap<string, ReadonlySet<QueueKind>>;
  /** False until the first scan completes, so a consumer can tell "nothing is
   *  queued" from "we haven't looked yet". */
  loaded: boolean;
  /** Bumps on every real change. Useful as a cache-bust / effect key. */
  revision: number;
}

const EMPTY: ReadonlyMap<string, ReadonlySet<QueueKind>> = new Map();

let state: QueueSnapshot = { requested: EMPTY, loaded: false, revision: 0 };

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function getState(): QueueSnapshot {
  return state;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** True when a `requested` entry of `kind` exists for `citekey`. */
export function isQueued(
  snapshot: QueueSnapshot,
  citekey: string | null | undefined,
  kind: QueueKind,
): boolean {
  if (!citekey) return false;
  return snapshot.requested.get(citekey)?.has(kind) ?? false;
}

/** True when ANY request is queued for `citekey` (the row-dot predicate). */
export function hasQueuedRequest(
  snapshot: QueueSnapshot,
  citekey: string | null | undefined,
): boolean {
  if (!citekey) return false;
  return (snapshot.requested.get(citekey)?.size ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

/** One directory listing → the per-(citekey, kind) requested map.
 *
 *  Filename-agnostic BY DESIGN: the kind is read from the entry's own `kind`
 *  field, not inferred from the path. That's what makes `index` and
 *  `authenticate` — which SHARE `queue/<citekey>.json` — separable, and what
 *  makes the legacy `<citekey>-richindex.json` spelling resolve to `deepIndex`
 *  through `normalizeQueueEntry` with no second filename table to keep in
 *  sync with `queueFilename`. */
async function scanQueue(
  handle: FileSystemDirectoryHandle,
): Promise<Map<string, Set<QueueKind>>> {
  const out = new Map<string, Set<QueueKind>>();
  const entries = await listDir(handle, SUBDIRS.queue);
  if (!entries) return out;
  await Promise.all(
    entries.map(async (e) => {
      if (e.kind !== "file") return;
      if (!e.name.endsWith(".json")) return;
      // Aggregate manifest, triage entries (no citekey to attach to), and the
      // rotated-stale-done sibling.
      if (e.name === "pending-reviews.json") return;
      if (e.name.startsWith("_triage-")) return;
      if (e.name.endsWith(".done.json")) return;
      const entry = normalizeQueueEntry(
        (await readJsonFile<QueueEntry>(
          handle,
          `${SUBDIRS.queue}/${e.name}`,
        )) ?? null,
      );
      if (!entry) return;
      if (entry.status !== "requested") return;
      if (!entry.citekey) return;
      let set = out.get(entry.citekey);
      if (!set) {
        set = new Set<QueueKind>();
        out.set(entry.citekey, set);
      }
      set.add(entry.kind);
    }),
  );
  return out;
}

function requestedEqual(
  a: ReadonlyMap<string, ReadonlySet<QueueKind>>,
  b: ReadonlyMap<string, ReadonlySet<QueueKind>>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [citekey, kinds] of a) {
    const other = b.get(citekey);
    if (!other) return false;
    if (other.size !== kinds.size) return false;
    for (const k of kinds) if (!other.has(k)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Polling loop
// ---------------------------------------------------------------------------

/** The library root every consumer reads through. The Library tab and a
 *  standalone outer paper tab each run their own `useLibraryHandle`, so the
 *  same directory arrives under two object identities — which is why adopting
 *  a new handle re-reads but never INVALIDATES the snapshot (both handles
 *  answer for the same bytes; a genuinely different folder converges on the
 *  next scan). */
let activeHandle: FileSystemDirectoryHandle | null = null;
let consumerCount = 0;
let pollIntervalId: number | null = null;
let focusListener: (() => void) | null = null;

// Newest-scan-wins. A scan started BEFORE a local write must never overwrite
// the state a scan started after it produced, however the two happen to
// interleave — `refreshQueueState()` is awaited by every writer.
let scanSeq = 0;
let appliedSeq = 0;

async function reload(): Promise<void> {
  const seq = ++scanSeq;
  const handle = activeHandle;
  if (!handle) {
    if (seq < appliedSeq) return;
    appliedSeq = seq;
    if (state.loaded || state.requested.size > 0) {
      state = { requested: EMPTY, loaded: false, revision: state.revision + 1 };
      emit();
    }
    return;
  }
  let requested: Map<string, Set<QueueKind>>;
  try {
    requested = await scanQueue(handle);
  } catch {
    // Read failures are non-fatal; subscribers keep the last-good snapshot
    // until a future poll succeeds (catalog-store's rule).
    return;
  }
  if (seq < appliedSeq) return;
  appliedSeq = seq;
  if (state.loaded && requestedEqual(state.requested, requested)) return;
  state = { requested, loaded: true, revision: state.revision + 1 };
  emit();
}

/** Force an immediate re-read. Every queue WRITER awaits this — it is the
 *  library's single "the queue changed" notification channel. */
export function refreshQueueState(): Promise<void> {
  return reload();
}

function startPolling() {
  if (pollIntervalId !== null) return;
  focusListener = () => void reload();
  window.addEventListener("focus", focusListener);
  pollIntervalId = window.setInterval(() => void reload(), POLL_MS);
}

function stopPolling() {
  if (pollIntervalId !== null) {
    window.clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
  if (focusListener) {
    window.removeEventListener("focus", focusListener);
    focusListener = null;
  }
}

/** Subscribe to the shared queue snapshot. Every mounted consumer passes the
 *  library root it was given; the poll runs once regardless of how many are
 *  listening, and shuts down entirely when the last one unmounts. */
export function useQueueState(
  handle: FileSystemDirectoryHandle | null,
): QueueSnapshot {
  const snapshot = useSyncExternalStore(subscribe, getState, getState);
  useEffect(() => {
    if (!handle) return;
    if (handle !== activeHandle) {
      activeHandle = handle;
      void reload();
    } else if (!state.loaded) {
      void reload();
    }
    consumerCount += 1;
    if (consumerCount === 1) startPolling();
    return () => {
      consumerCount = Math.max(0, consumerCount - 1);
      if (consumerCount === 0) stopPolling();
    };
  }, [handle]);
  return snapshot;
}
