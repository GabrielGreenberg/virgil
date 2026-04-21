"use client";

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
  type MutableRefObject,
} from "react";
import { readSidecar, writeSidecar } from "@/lib/storage";

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
 * Collapses the duplicated load/migrate/persist pattern that used to
 * live inline in every card hook (useNotes, useCutter, useArchive, …).
 *
 * Behavioral contract:
 *  - Mount / `docId` change → read `filename`, optionally migrate, set state.
 *  - `docId` becomes null → reset to `defaultValue` without writing to disk.
 *  - A stale docId that completes after a switch is ignored.
 *  - `persist` and `update` write synchronously through `writeSidecar`,
 *    which already serializes per-file via `enqueueWrite`.
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
  const docIdRef = useRef(docId);

  useEffect(() => {
    docIdRef.current = docId;
    if (!docId) {
      setState(defaultValue);
      return;
    }
    readSidecar<S>(docId, filename, defaultValue)
      .then((raw) => {
        if (docIdRef.current !== docId) return;
        const migrated = migrate ? migrate(raw) : raw;
        setState(migrated);
        if (persistMigrationOnLoad) {
          writeSidecar(docId, filename, migrated).catch(() => {});
        }
      })
      .catch(() => {});
    // `defaultValue`, `filename`, and the option functions are expected to
    // be module-level constants. We intentionally only track `docId` so a
    // document switch reloads but a re-render does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  const persist = useCallback(
    async (s: S) => {
      const id = docIdRef.current;
      if (!id) return;
      try {
        await writeSidecar(id, filename, s);
      } catch (err) {
        console.error(`Failed to save ${errorLabel ?? filename}:`, err);
      }
    },
    [filename, errorLabel],
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
