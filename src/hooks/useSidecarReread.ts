"use client";

import { useCallback, useEffect, useRef } from "react";
import { readSidecarIfExists } from "@/lib/storage";
import { mergeSidecarState } from "@/lib/sidecar-merge";
import { markReadStart, type MergeBase } from "@/lib/sidecar-merged-write";
import { recordSidecarRefusal } from "@/lib/sidecar-refusal";
import {
  SIDECAR_CHANGED_EVENT,
  type SidecarChangedDetail,
} from "@/lib/sidecar-watcher";

export interface SidecarRereadOptions<S> {
  docId: string | null;
  /** Bare sidecar filename, e.g. `"footnotes.json"`. Module-level constant. */
  filename: string;
  /** The hook's merge-base CELL ref (re-minted per document). */
  baselineRef: { readonly current: MergeBase<S> };
  /** What memory holds when the file is removed externally. */
  defaultValue: S;
  /** Normalizes a raw on-disk value the way the hook's load does. */
  migrate?: (raw: unknown) => S;
  /** THE hook's dirty predicate: a write armed or in flight. */
  hasPendingWrite: () => boolean;
  /** Applies a derivation to memory (functional, so a concurrent edit survives). */
  apply: (fn: (prev: S) => S) => void;
  /**
   * THE MOUNT LOAD, through this door (task 1520). When set, the door performs
   * the document's FIRST read itself, under the same dirty and stale-read
   * guards as every re-read, instead of the hook taking a private
   * `readSidecar → setState` beside it. Needed by a hook whose writes are NOT
   * gated on its load (`useBibReview`: a request can be sent, or the rename
   * migrator fire, while the first read is in flight) — a private load that
   * resolves after such a write replaces memory with pre-write disk.
   *
   * `what` is the user-facing noun a failed load is reported under (the
   * `unreadable` reason on the sidecar-refusal channel, task 679); `onLoaded`
   * runs once the load has APPLIED (work that needs the loaded rows — a rename
   * that arrived before them — replays there).
   */
  load?: { what: string; onLoaded?: () => void };
}

/**
 * THE EXTERNAL RE-READ for a record-collection sidecar (task 1078) — the
 * watcher half of "memory converges with disk", shared by every sidecar hook
 * (`usePersistentState`'s fourteen files, `useFootnotes`, `useBibReview`) so
 * there is ONE policy rather than three. The write half is
 * `convergeOnWrite` ([sidecar-merged-write.ts](../lib/sidecar-merged-write.ts)).
 *
 * Before 1078 only `usePersistentState` listened: `footnotes.json` was read
 * once per doc and never again (a skill's footnote write was invisible until
 * reopen), and `bib-review-requests.json` re-read itself WHOLESALE on a private
 * 10 s timer — no dirty guard, no merge — beside the SidecarWatcher that was
 * already polling the same file.
 *
 * The policy, stated once:
 *
 * - DIRTY GUARD: re-read only when the hook holds no armed or in-flight write;
 *   otherwise DEFER, so an unsaved local edit is never stomped.
 * - WHAT A DEFERRAL MEANS (task 719 — no longer a discard): a DEBT. The watcher
 *   re-baselines its ledger to the new bytes BEFORE it emits, and our landed
 *   write re-baselines again to ours, so nothing re-emits; a deferral that
 *   merely returned dropped the change for good. It is remembered and paid by
 *   the returned `replayDeferred`, which the hook calls whenever its writes
 *   drain — and because the write MERGES, disk after the drain holds the union.
 * - MERGE, never adopt: base = the cell, disk = the read, local = memory. The
 *   guard proves no write is pending, not that memory equals the base.
 * - STALE-READ GUARD: a write that STARTS AND LANDS while the read is in flight
 *   leaves the read holding pre-write disk; merging it would read the user's
 *   just-saved insert as "in base, absent on disk, local == base" — an external
 *   delete — and drop it from memory. So the read notes the cell's write
 *   generation at its start (`markReadStart`), and a read that a write
 *   overtook is discarded and re-issued rather than merged.
 * - THE ONE EXCEPTION TO "MERGE" (task 1504): a REFUSED write's reconcile
 *   (`rereadNow({ adopt: true })`). The refused record is local-only — absent
 *   from base and disk — which a three-way merge reads as a local ADD and keeps,
 *   the phantom task 630 exists to take back. So the reconcile ADOPTS disk, the
 *   only base true for every mutation; and it does so under the SAME dirty and
 *   stale-read guards, so another write still in flight (or one that landed
 *   inside the read) is never dropped from memory or from under the base. A
 *   deferred adopt dominates a deferred merge: once every write has drained,
 *   disk holds the union, so adopting it pays both debts.
 *
 * KEYSTROKE SANCTITY: a `window` listener for a wall-clock watcher event, not
 * an `editor.on(...)` subscriber. Typing runs zero code here.
 */
export interface SidecarReread<S> {
  /** Pays a deferred re-read once the hook's writes have drained. */
  replayDeferred: () => void;
  /**
   * THE MANUAL RE-READ (task 1332) — a user's Refresh, under the SAME policy
   * as a watcher signal: deferred as a debt while a write is armed or in
   * flight, otherwise read with the stale-read guard and MERGED into memory
   * (base advanced). Never a raw `readSidecar → setState` adopt, which let a
   * Refresh inside the 300 ms write window drop a just-filed record from memory
   * and the next write delete it from disk.
   */
  rereadNow: (opts?: { adopt?: boolean }) => void;
  /**
   * THE MIGRATION DOOR (task 1520). A derivation applied to memory OUTSIDE a
   * read (the uid re-stamp once the bib entries arrive after the load) is
   * applied to the MERGE BASE in the same step. Memory and base must live in
   * the same normalized space: a re-stamp of memory alone made every stamped
   * row differ from its base record, so the merge read each as a LOCAL edit —
   * hiding a skill's on-disk completion on re-read and reverting it on the next
   * write.
   */
  migrateInPlace: (fn: (s: S) => S) => void;
}

/**
 * `load` is a merge (memory is the doc's empty default until it lands, and a
 * write that raced it merged against disk) whose failure is REPORTED and whose
 * success fires `onLoaded`.
 */
type RereadMode = "merge" | "load" | "adopt";

const MODE_RANK: Record<RereadMode, number> = { merge: 0, load: 1, adopt: 2 };

/**
 * Remembers a deferred re-read. An owed mode is never downgraded: an adopt
 * dominates (disk after the drain holds the union), and an owed load stays a
 * load until one lands.
 */
function owe(debt: { current: RereadMode | null }, mode: RereadMode): void {
  const prior = debt.current;
  debt.current = prior && MODE_RANK[prior] >= MODE_RANK[mode] ? prior : mode;
}

export function useSidecarReread<S>(opts: SidecarRereadOptions<S>): SidecarReread<S> {
  const { docId, filename, baselineRef } = opts;
  // Latest callbacks/values in a ref, so the listener effect keys on `docId`
  // alone (a re-render must not re-subscribe).
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  // The debt: null, or the mode owed (see `owe`).
  const deferredRef = useRef<RereadMode | null>(null);
  const rehydrateRef = useRef<((mode: RereadMode) => void) | null>(null);

  const replayDeferred = useCallback((): void => {
    const mode = deferredRef.current;
    if (!mode) return;
    if (optsRef.current.hasPendingWrite()) return;
    rehydrateRef.current?.(mode);
  }, []);

  const rereadNow = useCallback((o?: { adopt?: boolean }): void => {
    if (!rehydrateRef.current) return;
    const mode: RereadMode = o?.adopt ? "adopt" : "merge";
    if (optsRef.current.hasPendingWrite()) {
      owe(deferredRef, mode);
      return;
    }
    const owed = deferredRef.current;
    rehydrateRef.current(owed && MODE_RANK[owed] > MODE_RANK[mode] ? owed : mode);
  }, []);

  const migrateInPlace = useCallback((fn: (s: S) => S): void => {
    const cell = optsRef.current.baselineRef.current;
    if (cell.value !== null) cell.value = fn(cell.value);
    optsRef.current.apply(fn);
  }, []);

  useEffect(() => {
    if (!docId) return;
    let cancelled = false;

    const rehydrate = (mode: RereadMode) => {
      deferredRef.current = null;
      const cell = baselineRef.current;
      const overtaken = markReadStart(cell);
      readSidecarIfExists<S>(docId, filename)
        .then((raw) => {
          if (cancelled || baselineRef.current !== cell) return;
          const { hasPendingWrite, migrate, defaultValue, apply } = optsRef.current;
          // The user may have started editing — or a write may have started —
          // while the read was in flight. Never stomp either; re-arm the debt
          // so the drain replays.
          if (hasPendingWrite()) {
            owe(deferredRef, mode);
            return;
          }
          // A write started AND landed during the read: this read predates it.
          if (overtaken()) {
            rehydrate(mode);
            return;
          }
          if (raw === null) {
            if (mode === "load") {
              // No file yet: the doc's honest base IS the empty default (so a
              // later merge can tell a deletion from an absence), and memory
              // keeps whatever it holds — nothing on disk to merge in.
              cell.value = defaultValue;
              optsRef.current.load?.onLoaded?.();
              return;
            }
            // External removal → the empty default (the file existed, then
            // went away, so an explicit reset is correct).
            cell.value = null;
            apply(() => defaultValue);
            return;
          }
          const read = migrate ? migrate(raw) : (raw as S);
          const base = cell.value;
          cell.value = read;
          if (mode === "adopt") {
            apply(() => read);
            return;
          }
          // A LOAD merges too (task 1520): with no write yet the base is null
          // and memory the empty default, so the union IS disk; after a write
          // raced it, the base is that write's payload and the merge is exact.
          apply((prev) => mergeSidecarState<S>(filename, base, read, prev));
          if (mode === "load") optsRef.current.load?.onLoaded?.();
        })
        .catch((err) => {
          if (cancelled || baselineRef.current !== cell) return;
          // A failed LOAD is said, not swallowed (task 679's channel): what the
          // panel shows is the empty default, not the file. The base stays
          // null, so a write degrades to a union and cannot delete what it
          // never read.
          const load = optsRef.current.load;
          if (mode === "load" && load) {
            recordSidecarRefusal({
              docId,
              what: load.what,
              reason: "unreadable",
              detail: err instanceof Error ? err.message : undefined,
            });
          }
          // Transient read failure — leave memory and re-arm, so the next
          // drain retries. The watcher will not re-emit.
          owe(deferredRef, mode);
        });
    };
    rehydrateRef.current = rehydrate;
    if (optsRef.current.load) rehydrate("load");

    const onSidecarChanged = (e: Event) => {
      const detail = (e as CustomEvent<SidecarChangedDetail>).detail;
      if (!detail) return;
      if (detail.docId !== docId || detail.filename !== filename) return;
      if (optsRef.current.hasPendingWrite()) {
        owe(deferredRef, "merge");
        return;
      }
      rehydrate(deferredRef.current ?? "merge");
    };

    window.addEventListener(SIDECAR_CHANGED_EVENT, onSidecarChanged);
    return () => {
      cancelled = true;
      rehydrateRef.current = null;
      deferredRef.current = null;
      window.removeEventListener(SIDECAR_CHANGED_EVENT, onSidecarChanged);
    };
    // `filename` and `baselineRef` are stable per hook instance; a doc switch
    // re-subscribes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  return { replayDeferred, rereadNow, migrateInPlace };
}
