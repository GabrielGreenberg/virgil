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
  const { migrate, persistMigrationOnLoad, errorLabel } = opts;
  const [state, setState] = useState<S>(defaultValue);
  const stateRef = useRef(state);
  stateRef.current = state;

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

  const update = useCallback(
    (fn: (prev: S) => S) => {
      setState((prev) => {
        const next = fn(prev);
        void persist(next);
        return next;
      });
    },
    [persist],
  );

  return { state, setState, update, persist, stateRef };
}
