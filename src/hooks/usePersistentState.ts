"use client";

import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type Dispatch,
  type SetStateAction,
  type MutableRefObject,
} from "react";
import { readSidecarIfExists, writeSidecar } from "@/lib/storage";
import {
  getActiveHandle,
  isStalePipelineError,
} from "@/lib/multi-window/doc-pipeline";

export interface PersistentStateOptions<S> {
  /**
   * Normalize the raw sidecar read. Default: identity (assume on-disk
   * shape matches `S`). Hooks that accept legacy formats wire their
   * migrator here; it runs once per `docId` load.
   */
  migrate?: (raw: unknown) => S;
  /**
   * If true, write the migrated state back to disk right after load so
   * older sidecar shapes are upgraded on first read. Defaults to false.
   */
  persistMigrationOnLoad?: boolean;
  /** Label used in console errors; defaults to `filename`. */
  errorLabel?: string;
  /**
   * Coalesce consecutive `update()` calls into a single write that
   * fires after this many milliseconds of idle. Defaults to 300ms.
   * The functional update still applies to React state immediately —
   * only the disk write debounces, so the UI stays responsive while
   * a typing burst no longer triggers a write storm.
   *
   * Pending writes are flushed synchronously on unmount and on
   * `docId` change so no data is lost. Pass `0` to disable debouncing
   * (matches the pre-debounce write-on-every-update behavior).
   */
  debounceMs?: number;
}

export interface PersistentStateApi<S> {
  state: S;
  setState: Dispatch<SetStateAction<S>>;
  /** Functional update that also persists the result to disk. */
  update: (fn: (prev: S) => S) => void;
  /** Write a specific state to disk; used for read-then-write flows. */
  persist: (s: S) => Promise<void>;
  /** Live mirror of `state` for callers that need synchronous access. */
  stateRef: MutableRefObject<S>;
}

/**
 * Factory for `docId`-scoped state persisted to a sidecar JSON file.
 *
 * The handle that pins all writes comes from the active pipeline
 * registry (see src/lib/multi-window/doc-pipeline.ts). Writes that
 * land after the pipeline ends — e.g. a debounced persist that fires
 * after the user switched docs — are rejected by the storage layer
 * with StalePipelineError, which we swallow silently. This is the
 * structural fix for the cross-doc autosave overwrite bug.
 *
 * Behavioral contract:
 *  - Mount / `docId` change → read `filename`, optionally migrate, set state.
 *  - `docId` becomes null → reset to `defaultValue` without writing to disk.
 *  - A stale docId that completes after a switch is ignored.
 *  - `persist` and `update` write through `writeSidecar`, which both
 *    serializes per-file via `enqueueWrite` AND rejects on stale handle.
 */
export function usePersistentState<S>(
  docId: string | null,
  filename: string,
  defaultValue: S,
  opts: PersistentStateOptions<S> = {},
): PersistentStateApi<S> {
  const { migrate, persistMigrationOnLoad, errorLabel, debounceMs = 300 } = opts;
  const [state, setState] = useState<S>(defaultValue);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Debounce machinery: track the latest pending write so we can flush
  // it (synchronously where needed) on doc switch / unmount. `pendingRef`
  // is non-null iff a debounced write is scheduled; the timer id is
  // stored separately so we can cancel without losing the payload.
  const pendingRef = useRef<S | null>(null);
  const pendingTimerRef = useRef<number | null>(null);

  // The write handle is pinned to the docId's currently-active
  // pipeline. If the user switches docs, the pipeline ends and this
  // handle becomes stale; subsequent writes throw StalePipelineError
  // and are dropped. Fresh handle per render that sees a new docId.
  const handle = useMemo(
    () => (docId ? getActiveHandle(docId) : null),
    [docId],
  );

  useEffect(() => {
    let cancelled = false;
    if (!docId) {
      setState(defaultValue);
      return;
    }
    // `readSidecarIfExists` returns null when the file doesn't exist on
    // disk; we skip `setState` in that case so editor-derived state
    // (e.g. citations populated via `syncFromEditor`) isn't clobbered by
    // a late-arriving default. Read-only docs like the Library Reader
    // never persist sidecars, so this branch is the steady state for
    // them. Persisted-EMPTY values still overwrite — disk remains the
    // source of truth whenever a sidecar exists.
    readSidecarIfExists<S>(docId, filename)
      .then((raw) => {
        if (cancelled || raw === null) return;
        const migrated = migrate ? migrate(raw) : raw;
        setState(migrated);
        if (persistMigrationOnLoad && handle) {
          writeSidecar(handle, filename, migrated).catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // `defaultValue`, `filename`, and the option functions are expected to
    // be module-level constants. We intentionally only track `docId` so a
    // document switch reloads but a re-render does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, handle]);

  const persist = useCallback(
    async (s: S) => {
      if (!handle) return;
      try {
        await writeSidecar(handle, filename, s);
      } catch (err) {
        if (isStalePipelineError(err)) return;
        console.error(`Failed to save ${errorLabel ?? filename}:`, err);
      }
    },
    [handle, filename, errorLabel],
  );

  // Fire the pending write synchronously (the persist itself stays
  // async; we just stop deferring it). Safe to call when nothing is
  // pending. Used by the unmount/docId-change paths and could be
  // exposed publicly later if a caller needs an explicit flush.
  const flushPending = useCallback(() => {
    if (pendingTimerRef.current !== null) {
      window.clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    const payload = pendingRef.current;
    pendingRef.current = null;
    if (payload !== null) void persist(payload);
  }, [persist]);

  const update = useCallback(
    (fn: (prev: S) => S) => {
      setState((prev) => {
        const next = fn(prev);
        if (debounceMs <= 0) {
          void persist(next);
        } else {
          pendingRef.current = next;
          if (pendingTimerRef.current !== null) {
            window.clearTimeout(pendingTimerRef.current);
          }
          pendingTimerRef.current = window.setTimeout(() => {
            pendingTimerRef.current = null;
            const payload = pendingRef.current;
            pendingRef.current = null;
            if (payload !== null) void persist(payload);
          }, debounceMs);
        }
        return next;
      });
    },
    [persist, debounceMs],
  );

  // Flush any pending write whenever the doc id changes (the new doc's
  // handle is different — writing then would either race or be dropped
  // by the stale-pipeline guard). Same on unmount: hand the last value
  // to the storage layer rather than dropping it. `enqueueWrite` inside
  // writeSidecar serializes against the queue so order is preserved
  // even if a switch happens mid-debounce.
  useEffect(() => {
    return () => {
      flushPending();
    };
  }, [docId, flushPending]);

  return { state, setState, update, persist, stateRef };
}
