"use client";

import { useCallback, useEffect, useRef } from "react";
import { readSidecarIfExists } from "@/lib/storage";
import { mergeSidecarState } from "@/lib/sidecar-merge";
import type { MergeBase } from "@/lib/sidecar-merged-write";
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
 *   generation at its start, and a read that a write overtook is discarded and
 *   re-issued rather than merged.
 *
 * KEYSTROKE SANCTITY: a `window` listener for a wall-clock watcher event, not
 * an `editor.on(...)` subscriber. Typing runs zero code here.
 */
export interface SidecarReread {
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
  rereadNow: () => void;
}

export function useSidecarReread<S>(opts: SidecarRereadOptions<S>): SidecarReread {
  const { docId, filename, baselineRef } = opts;
  // Latest callbacks/values in a ref, so the listener effect keys on `docId`
  // alone (a re-render must not re-subscribe).
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const deferredRef = useRef(false);
  const rehydrateRef = useRef<(() => void) | null>(null);

  const replayDeferred = useCallback((): void => {
    if (!deferredRef.current) return;
    if (optsRef.current.hasPendingWrite()) return;
    deferredRef.current = false;
    rehydrateRef.current?.();
  }, []);

  const rereadNow = useCallback((): void => {
    if (!rehydrateRef.current) return;
    if (optsRef.current.hasPendingWrite()) {
      deferredRef.current = true;
      return;
    }
    rehydrateRef.current();
  }, []);

  useEffect(() => {
    if (!docId) return;
    let cancelled = false;

    const rehydrate = () => {
      deferredRef.current = false;
      const cell = baselineRef.current;
      const generation = cell.submits;
      readSidecarIfExists<S>(docId, filename)
        .then((raw) => {
          if (cancelled || baselineRef.current !== cell) return;
          const { hasPendingWrite, migrate, defaultValue, apply } = optsRef.current;
          // The user may have started editing — or a write may have started —
          // while the read was in flight. Never stomp either; re-arm the debt
          // so the drain replays.
          if (hasPendingWrite()) {
            deferredRef.current = true;
            return;
          }
          // A write started AND landed during the read: this read predates it.
          if (cell.submits !== generation) {
            rehydrate();
            return;
          }
          if (raw === null) {
            // External removal → the empty default (the file existed, then
            // went away, so an explicit reset is correct).
            cell.value = null;
            apply(() => defaultValue);
            return;
          }
          const read = migrate ? migrate(raw) : (raw as S);
          const base = cell.value;
          cell.value = read;
          apply((prev) => mergeSidecarState<S>(filename, base, read, prev));
        })
        .catch(() => {
          // Transient read failure — leave memory and re-arm, so the next
          // drain retries. The watcher will not re-emit.
          deferredRef.current = true;
        });
    };
    rehydrateRef.current = rehydrate;

    const onSidecarChanged = (e: Event) => {
      const detail = (e as CustomEvent<SidecarChangedDetail>).detail;
      if (!detail) return;
      if (detail.docId !== docId || detail.filename !== filename) return;
      if (optsRef.current.hasPendingWrite()) {
        deferredRef.current = true;
        return;
      }
      rehydrate();
    };

    window.addEventListener(SIDECAR_CHANGED_EVENT, onSidecarChanged);
    return () => {
      cancelled = true;
      rehydrateRef.current = null;
      deferredRef.current = false;
      window.removeEventListener(SIDECAR_CHANGED_EVENT, onSidecarChanged);
    };
    // `filename` and `baselineRef` are stable per hook instance; a doc switch
    // re-subscribes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  return { replayDeferred, rereadNow };
}
