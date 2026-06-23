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
import { readSidecarIfExists, writeSidecar } from "@/lib/storage";
import {
  getActiveHandle,
  isStalePipelineError,
} from "@/lib/multi-window/doc-pipeline";
import { useEditorChrome } from "@/components/editor-layout/chrome-context";
import { isSidecarWriteAllowed } from "@/components/editor-layout/chrome-config";

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
  /**
   * True once the initial sidecar read for the current `docId` has
   * resolved (found-and-loaded, absent, or errored — any terminal state).
   * Mirrors `useEditorUIState.loaded`. A load-only reconcile MUST gate on
   * this: firing before the read resolves would run over an empty card
   * array (the pre-load default) and then never re-run, silently skipping
   * the heal. Reset to false on every `docId` change. Additive — existing
   * consumers can ignore it.
   */
  loaded: boolean;
  /**
   * True when the initial read for the current `docId` THREW (corrupt/truncated
   * sidecar JSON, or a transient FSA error). DISTINCT from `loaded`: an errored
   * read still flips `loaded` (the read terminated) but leaves `state` at the
   * EMPTY default, so the in-memory collection is NOT authoritative. Any
   * DESTRUCTIVE consumer that infers "this anchor has no owning card" from an
   * empty collection (the linkedAnchor orphan reaper) MUST gate on `!loadError`
   * — otherwise a single sidecar read error would reap every live `\vlid` mark
   * of that kind and autosave the loss. Constructive consumers (Mode-B re-apply
   * / Mode-A reconcile) are safe on partial data and keep gating on `loaded`
   * alone. Reset to false on every `docId` change. Additive.
   */
  loadError: boolean;
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

  // Reader-mode write guard. The active chrome's `editableCardKinds` whitelist
  // (e.g. the Library Reader's `["note"]`) restricts which CARD sidecars this
  // host may write — `isSidecarWriteAllowed` refuses a write to any card
  // sidecar whose kind the chrome doesn't expose an editor for, so a read-only
  // host can only ever persist the note annotation sidecar even if some other
  // card kind later gains a live editor. Defaults to FULL_CHROME (everything
  // writable) outside an `EditorChromeProvider`, so the main app + any non-
  // editor caller are unaffected. Read into a ref so `persist` (a stable
  // callback) sees the latest chrome without re-creating the closure.
  const chrome = useEditorChrome();
  const writeAllowedRef = useRef(true);
  writeAllowedRef.current = isSidecarWriteAllowed(chrome, filename);

  // True after the initial read for the current docId resolves (loaded,
  // absent, or errored). The Mode-A reconcile gate depends on this so it
  // never fires over the pre-load default. Reset on docId change below.
  const [loaded, setLoaded] = useState(false);

  // True when the initial read THREW (corrupt/truncated sidecar JSON, or a
  // transient FSA read error — `readSidecarIfExists` returns null only for a
  // genuinely-absent file and re-throws everything else). DISTINCT from
  // `loaded`: an errored read still flips `loaded` (the read terminated) but
  // leaves `state` at the EMPTY default, so the in-memory cards are NOT
  // authoritative. Any DESTRUCTIVE consumer that infers "this anchor has no
  // owning card" from an empty collection (the linkedAnchor orphan reaper) MUST
  // gate on `!loadError` — otherwise a sidecar read error would make it reap
  // every live `\vlid` mark of that kind and autosave the loss. Constructive
  // consumers (the Mode-B re-apply / Mode-A reconcile) are safe on partial data
  // and keep gating on `loaded` alone. Reset on docId change below.
  const [loadError, setLoadError] = useState(false);

  // Debounce machinery: track the latest pending write so we can flush
  // it (synchronously where needed) on doc switch / unmount. `pendingRef`
  // is non-null iff a debounced write is scheduled; the timer id is
  // stored separately so we can cancel without losing the payload.
  const pendingRef = useRef<S | null>(null);
  const pendingTimerRef = useRef<number | null>(null);

  // Tracks whether the user has mutated state via `update()` since the
  // mount-effect loader was last started. Prevents the loader's async
  // `.then()` from stomping a user's change with the (now-stale) on-disk
  // value when the user interacts before the load completes. Reset on
  // `docId`/`handle` change so the new doc's load is allowed to populate
  // state on switch.
  const hasMutatedRef = useRef(false);

  // The write handle is pinned to the docId's currently-active
  // pipeline. We resolve it live on every write rather than via
  // `useMemo` — at hook-construction time the parent component runs
  // *before* its <DocPipeline> child registers in the active registry,
  // so a memoized handle captured during the first render is stuck at
  // null even after the pipeline becomes available. Reading it fresh
  // in `persist` (and the loader's write-back branch) sidesteps that
  // ordering issue without changing the rest of the lifecycle.
  const resolveHandle = useCallback(
    () => (docId ? getActiveHandle(docId) : null),
    [docId],
  );

  useEffect(() => {
    hasMutatedRef.current = false;
    setLoaded(false);
    setLoadError(false);
    let cancelled = false;
    if (!docId) {
      setState(defaultValue);
      setLoaded(true);
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
        if (cancelled) return;
        // `loaded` flips even on an absent sidecar or a mid-flight user
        // mutation — the read is terminally resolved either way; we just
        // skip the state overwrite. Set BEFORE the early returns so the
        // reconcile gate releases.
        setLoaded(true);
        if (raw === null) return;
        if (hasMutatedRef.current) return;
        const migrated = migrate ? migrate(raw) : raw;
        setState(migrated);
        // Same Reader-mode guard as `persist`: never write a disallowed card
        // sidecar back to disk, even for a migration upgrade.
        if (persistMigrationOnLoad && writeAllowedRef.current) {
          const h = resolveHandle();
          if (h) writeSidecar(h, filename, migrated).catch(() => {});
        }
      })
      .catch(() => {
        if (cancelled) return;
        // The read terminated (so release the reconcile gate) but FAILED, so the
        // empty default is NOT authoritative — flag it so the destructive orphan
        // reaper stands down for this kind (no mass-reap of live marks).
        setLoadError(true);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
    // `defaultValue`, `filename`, and the option functions are expected to
    // be module-level constants. We intentionally only track `docId` so a
    // document switch reloads but a re-render does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, resolveHandle]);

  const persist = useCallback(
    async (s: S) => {
      // Reader-mode safety guard: refuse a write the active chrome disallows
      // (read-only host writing a non-note card sidecar). The note annotation
      // sidecar passes; everything else is dropped silently — the in-memory
      // state still updated, only the disk write is suppressed.
      if (!writeAllowedRef.current) return;
      const h = resolveHandle();
      if (!h) return;
      try {
        await writeSidecar(h, filename, s);
      } catch (err) {
        if (isStalePipelineError(err)) return;
        console.error(`Failed to save ${errorLabel ?? filename}:`, err);
      }
    },
    [resolveHandle, filename, errorLabel],
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
        // No-op update (referentially-equal `next`) → don't mark mutated and
        // don't arm a redundant byte-identical write. This matters now that the
        // orphan-listener kind gates are dropped: ALL panels call
        // `clearCardAnchor()` on every `virgil-anchor-orphaned` event, and the
        // four NON-owning panels self-filter to a state no-op (`return prev`).
        // Without this guard each would still schedule an identical `writeSidecar`
        // and stamp `hasMutatedRef` (spuriously arming the loader-stomp guard).
        if (next === prev) return prev;
        hasMutatedRef.current = true;
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

  return { state, setState, update, persist, stateRef, loaded, loadError };
}
