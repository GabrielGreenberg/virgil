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
import { sidecarWriteDebounceMs } from "@/lib/sidecar-value";
import { onTabHidden } from "@/lib/tab-hidden";
import {
  SIDECAR_CHANGED_EVENT,
  type SidecarChangedDetail,
} from "@/lib/sidecar-watcher";
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
   * fires after this many milliseconds of idle. The functional update
   * still applies to React state immediately — only the disk write
   * debounces, so the UI stays responsive while a typing burst no
   * longer triggers a write storm.
   *
   * **Defaults to the file's own cadence** — `sidecarWriteDebounceMs(filename)`
   * (task 363), which is derived from what the sidecar is worth rather than
   * picked per hook: 300 ms for CONTENT (the pre-363 default, unchanged for
   * every card sidecar), 2500 ms for VIEW state, whose only cost of waiting is
   * what an abrupt kill would lose. Pass a number only where a caller genuinely
   * knows better than the tier — CI forbids a bare literal at a write site.
   *
   * Pending writes are flushed synchronously on unmount, on `docId` change,
   * and when the tab goes hidden, so no data is lost. Pass `0` to disable
   * debouncing (matches the pre-debounce write-on-every-update behavior).
   */
  debounceMs?: number;
}

export interface PersistentStateApi<S> {
  state: S;
  setState: Dispatch<SetStateAction<S>>;
  /** Functional update that also persists the result to disk. */
  update: (fn: (prev: S) => S) => void;
  /**
   * Write a specific state to disk NOW; used for read-then-write flows that
   * need the computed `next` synchronously (to return it to their caller).
   *
   * An immediate write SUPERSEDES any write `update()` has scheduled — see the
   * "two doors, one queue" note on the implementation. Callers that don't need
   * the value back should still prefer `update()`: it coalesces.
   */
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
  const {
    migrate,
    persistMigrationOnLoad,
    errorLabel,
    debounceMs = sidecarWriteDebounceMs(filename),
  } = opts;
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
      // ── TWO DOORS, ONE QUEUE ────────────────────────────────────────────
      // `update()` and `persist()` are both write doors, and only `update()`
      // used to own the debounce queue — so an immediate write could be
      // OUTLIVED by an older payload and silently undone ON DISK:
      //
      //   updateSnippetTitle(X)  → arms the 300 ms timer with state that
      //                            still CONTAINS X
      //   persist(stateWithoutX) → writes X-removed immediately
      //   …timer fires…          → flushes the pre-removal payload and
      //                            RESURRECTS X in the sidecar
      //
      // In-memory state says X is gone, disk says it's there, and nothing
      // reconciles until the next `update()` — so with no further edit the
      // divergence is permanent and X reappears on reload. That was task 106's
      // `useArchive.restoreSnippet` bug, but the hazard belongs to the
      // PRIMITIVE rather than to that caller: it is inherent to having two
      // write doors where only one owns the queue, and it is waiting for the
      // next read-then-write flow written against this API. (Scope, stated
      // honestly: the sidecar hooks with their OWN bespoke `persist` —
      // useFootnotes, useExamples, useAiRequests, useBibReview, useStack,
      // useEditorUIState — do NOT go through this door and are unaffected.
      // Among this hook's consumers only `useSuggestions.clearSuggestions`
      // still calls it directly.) An immediate write is by definition the
      // newest intent, so it SUPERSEDES anything scheduled — cancel the timer
      // and drop the stale payload, once, for every caller.
      //
      // Precondition on the caller, since this cancels rather than merges: the
      // payload must already reflect any `update()` issued before it.
      // `stateRef` refreshes on RENDER, so `update(f); persist({...stateRef
      // .current})` inside ONE handler would drop `f` — derive the payload from
      // the same state `update` did, or just use `update`.
      if (pendingTimerRef.current !== null) {
        window.clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
      pendingRef.current = null;
      // Reader-mode safety guard: refuse a write the active chrome disallows
      // (read-only host writing a non-note card sidecar). The note annotation
      // sidecar passes; everything else is dropped silently — the in-memory
      // state still updated, only the disk write is suppressed.
      if (!writeAllowedRef.current) return;
      const h = resolveHandle();
      if (!h) return;
      // AFTER both guards, never before. `hasMutatedRef` means "a newer value
      // is on disk", and its only consumer is the mount-loader's bail — so
      // stamping it for a write that was suppressed (read-only chrome) or
      // dropped (pipeline not yet registered) would permanently hide the
      // sidecar for that doc, leaving every load-gated reconcile running over
      // the empty default.
      hasMutatedRef.current = true;
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

  // Settle at the boundary that matters (task 363). Coalescing is only honest
  // if it never delays a value past the moment it stops being live: the tab
  // going hidden is the app-switch / tab-switch / window-close edge, and it is
  // the LAST edge at which an async FSA write still reliably completes
  // (`pagehide` is too late for a promise chain). Cheap by construction — the
  // subscriber is one shared document listener, and a hook with nothing pending
  // does nothing. This matters most for the VIEW tier's 2.5 s window, and costs
  // the 300 ms content tier nothing.
  useEffect(() => onTabHidden(flushPending), [flushPending]);

  // ── LIVE external-sidecar reactivity ──────────────────────────────────────
  // Subscribe to the `SidecarWatcher`'s per-file change signal so a card an AI
  // agent drafts straight onto disk (into `virgil/<filename>`) surfaces in the
  // LIVE app without a manual reload. The watcher only fires on a GENUINE
  // external change (Virgil's own debounced writes stamp the disk ledger via
  // `writeSidecar`, so they are filtered upstream — the own-write guard), and it
  // has already `invalidateSidecarBundle`'d before dispatching, so the re-read
  // below hits disk rather than the stale cached snapshot.
  //
  // DATA SAFETY — DIRTY GUARD (no clobber): re-read ONLY when THIS instance is
  // clean, i.e. it has no pending debounced write (`pendingTimerRef.current ===
  // null`). If a local card edit is mid-debounce we DEFER — skip this round and
  // let the next poll re-check once the write has flushed — so an in-progress
  // local edit is never overwritten by the on-disk value. The guard is
  // per-instance (docId+filename), so a dirty notes.json never blocks a clean
  // revisions.json re-read.
  //
  // KEYSTROKE SANCTITY: this is an event listener on `window`, NOT an
  // `editor.on(...)` subscriber. It fires only on an external sidecar change
  // (wall-clock-driven), never per keystroke. Typing runs zero code here.
  useEffect(() => {
    if (!docId) return;
    let cancelled = false;

    const onSidecarChanged = (e: Event) => {
      const detail = (e as CustomEvent<SidecarChangedDetail>).detail;
      if (!detail) return;
      if (detail.docId !== docId || detail.filename !== filename) return;
      // DIRTY GUARD: a pending debounced write means local state has an unsaved
      // edit — defer rather than clobber it. The next poll re-emits once clean.
      if (pendingTimerRef.current !== null) return;
      // Re-read from disk (the bundle was invalidated by the watcher, so this
      // hits disk). Update state on success; on absence (file removed) fall back
      // to the default so the panel empties. A read error leaves state as-is.
      readSidecarIfExists<S>(docId, filename)
        .then((raw) => {
          if (cancelled) return;
          // Re-check the dirty guard AFTER the async read: the user may have
          // started editing while the read was in flight — never stomp that.
          if (pendingTimerRef.current !== null) return;
          if (raw === null) {
            // External removal → reset to the empty default (matches the load
            // path's "absent" handling, but here the sidecar existed then went
            // away, so an explicit reset is correct).
            setState(defaultValue);
            return;
          }
          const migrated = migrate ? migrate(raw) : raw;
          setState(migrated);
        })
        .catch(() => {
          // Transient read failure — leave state untouched; the next poll retries.
        });
    };

    window.addEventListener(SIDECAR_CHANGED_EVENT, onSidecarChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(SIDECAR_CHANGED_EVENT, onSidecarChanged);
    };
    // Same rationale as the loader effect: `filename`/`defaultValue`/`migrate`
    // are module-level constants; we track only `docId` so a switch re-subscribes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  return { state, setState, update, persist, stateRef, loaded, loadError };
}
