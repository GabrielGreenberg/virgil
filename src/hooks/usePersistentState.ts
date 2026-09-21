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
import { recordSidecarRefusal } from "@/lib/sidecar-refusal";
import {
  SIDECAR_CHANGED_EVENT,
  type SidecarChangedDetail,
} from "@/lib/sidecar-watcher";
import {
  getActiveHandle,
  isStalePipelineError,
} from "@/lib/multi-window/doc-pipeline";
import {
  registerPendingFlusher,
  unregisterPendingFlusher,
} from "@/lib/multi-window/pending-saves";
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
   * when the tab goes hidden, and by the per-doc pending-flusher registry
   * (`drainDoc` on a doc switch, the reload door before a page tears down —
   * task 559), so no data is lost. Pass `0` to disable debouncing (matches
   * the pre-debounce write-on-every-update behavior).
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
  /**
   * THE LOAD-TIME RECONCILE DOOR (task 570). `update()` for a derivation whose
   * inputs come from somewhere OTHER than this sidecar — the editor's live
   * atoms, a doc walk — and which must therefore run over the sidecar AS
   * LOADED, never over the pre-load default. Called before the initial read
   * for the current `docId` has resolved, the derivation is HELD (the latest
   * call wins; nothing is written and `hasMutatedRef` is NOT stamped, so the
   * loader still populates state from disk) and applied once `loaded` flips;
   * called after, it is exactly `update()`.
   *
   * Why a door and not a caller-side `if (!loaded) return`: the caller that
   * most needed the gate (`useCitations.syncFromEditor`, run from an
   * `EditorPane` effect keyed on the editor alone) never asked, and a
   * `syncFromEditor` that always produces a new object stamped `hasMutatedRef`
   * through `update()` — so when the ~20-file sidecar batch resolved AFTER the
   * editor mounted, the loader bailed on the stamp, every unanchored/archived
   * citation and the user's `bibPackage` / `citationStyle` / `bibPath` were
   * dropped, and 300 ms later that state was WRITTEN over `citations.json`. A
   * caller-side gate also has to remember to RE-RUN once `loaded` flips; the
   * door holds the derivation and applies it, so a caller cannot run early
   * and cannot forget to run late.
   *
   * On a read that THREW (`loadError`) the derivation is applied to MEMORY
   * only — the panel reflects the editor — and nothing is written: an
   * automatic write over a sidecar this session could not read would destroy
   * whatever it holds (the write path's law). Reset on every `docId` change:
   * a derivation held for one document is never applied to another.
   */
  updateWhenLoaded: (fn: (prev: S) => S) => void;
  /** Live mirror of `state` for callers that need synchronous access. */
  stateRef: MutableRefObject<S>;
  /**
   * True once the initial sidecar read for the current `docId` has
   * resolved (found-and-loaded, absent, or errored — any terminal state).
   * Mirrors `useEditorUIState.loaded`. A load-only reconcile MUST gate on
   * this: firing before the read resolves would run over an empty card
   * array (the pre-load default) and then never re-run, silently skipping
   * the heal. A READ-ONLY consumer gates on the flag; a reconcile that
   * WRITES this sidecar (the editor-derived `syncFromEditor` family) enters
   * `updateWhenLoaded` instead, which holds the gate for it (task 570 — the
   * one writer that most needed this rule never asked it). Reset to false on
   * every `docId` change. Additive — existing consumers can ignore it.
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
  // (the Library Reader's `READER_EDITABLE_CARD_KINDS`, `["note"]`) decides
  // which sidecars this host may write — `isSidecarWriteAllowed` reads the ONE
  // derivation in `@/lib/host-writability` (task 556), the same one the
  // storage funnels read for a `library-paper:` doc, so a read-mostly host
  // persists exactly the note annotation sidecar and this permit can no
  // longer disagree with the layer below it (pre-556 it granted `notes.json`
  // and the funnel refused it: the note looked saved and was never written).
  // Defaults to FULL_CHROME (everything writable) outside an
  // `EditorChromeProvider`, so the main app + any non-editor caller are
  // unaffected. Read into a ref so `persist` (a stable callback) sees the
  // latest chrome without re-creating the closure.
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
  // Synchronous mirrors of the two flags above, for the load-time reconcile
  // door: `updateWhenLoaded` may be called from an effect that runs in the
  // same commit the read resolved in, before React has re-rendered the state
  // flag, and it must answer from the READ's outcome rather than from a
  // possibly-stale render value. Written in the loader's terminal branches
  // beside the `set*` calls, reset with them on `docId` change.
  const loadedRef = useRef(false);
  const loadErrorRef = useRef(false);
  // A derivation handed to `updateWhenLoaded` before the read resolved — the
  // latest call wins, and the `loaded` effect below applies it exactly once.
  const heldReconcileRef = useRef<((prev: S) => S) | null>(null);

  // Debounce machinery: track the latest pending write so we can flush
  // it (synchronously where needed) on doc switch / unmount. `pendingRef`
  // is non-null iff a debounced write is scheduled; the timer id is
  // stored separately so we can cancel without losing the payload.
  const pendingRef = useRef<S | null>(null);
  const pendingTimerRef = useRef<number | null>(null);
  // Writes this instance has handed to `writeSidecar` that have not yet
  // SETTLED (landed, refused, or thrown). Incremented in `persist` immediately
  // before its `await`, decremented in its `finally` — so between the debounce
  // callback nulling the timer handle and the bytes reaching disk, the
  // instance still reads as holding work (task 569, below).
  const inFlightRef = useRef(0);

  // THE ONE PLACE the armed timer handle is compared and cleared. `persist`,
  // `flushPending` and the debounce re-arm all cancel through this door, so
  // the null-handle comparison appears in exactly two declarations — here and
  // in `hasPendingWrite` — and a census can say so. Touches ONLY the handle:
  // whether the parked PAYLOAD survives is each caller's own decision.
  const cancelArmedTimer = useCallback((): void => {
    if (pendingTimerRef.current !== null) {
      window.clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
  }, []);

  // ── THE ONE DIRTY PREDICATE (task 569) ─────────────────────────────────────
  // "Does this instance hold a write that has not yet LANDED?" — a debounced
  // write is ARMED, or a write is IN FLIGHT. Task 392 retired exactly this
  // mistake from `useDocument` (`saveTimerRef.current !== null` as the dirty
  // test — "the debounce callback nulls the handle BEFORE calling save"), and
  // this hook carried its twin: the debounce callback, `flushPending` and
  // `persist` all null `pendingTimerRef` BEFORE `await writeSidecar`, so for
  // the whole in-flight window — the per-file queue, the cross-window doc
  // lock, the FSA `createWritable` + rename — a guard reading the timer alone
  // answered CLEAN. An external change to the same file polled in that window
  // passed both guard reads, disk (the external bytes) was `setState`d over
  // the local edit in memory, and our write then landed the LOCAL payload:
  // memory said external, disk said local, and the next `update()` wrote
  // memory back over the local edit. Silent. Every reader of "is this
  // instance dirty?" asks HERE, never the timer handle.
  //
  // Deliberately NOT a member: a write the layer below REFUSES (read-only
  // chrome, no pipeline handle) is not a write this instance OWES — `persist`
  // returns before the counter moves, exactly as it returns before stamping
  // `hasMutatedRef` — so in a read-mostly host disk stays the truth and an
  // external change still re-hydrates. Stated rather than implied: memory
  // there holds an edit disk will never see, and that is the host's design.
  const hasPendingWrite = useCallback((): boolean => {
    return pendingTimerRef.current !== null || inFlightRef.current > 0;
  }, []);

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
    loadedRef.current = false;
    loadErrorRef.current = false;
    heldReconcileRef.current = null;
    setLoaded(false);
    setLoadError(false);
    let cancelled = false;
    if (!docId) {
      setState(defaultValue);
      loadedRef.current = true;
      setLoaded(true);
      return;
    }
    // `readSidecarIfExists` returns null when the file doesn't exist on
    // disk; we skip `setState` in that case so editor-derived state
    // (e.g. citations populated via `syncFromEditor`) isn't clobbered by
    // a late-arriving default. In the Library Reader every sidecar but the
    // note annotations is never written (task 556), so this branch is the
    // steady state for those. Persisted-EMPTY values still overwrite — disk
    // remains the source of truth whenever a sidecar exists.
    readSidecarIfExists<S>(docId, filename)
      .then((raw) => {
        if (cancelled) return;
        // `loaded` flips even on an absent sidecar or a mid-flight user
        // mutation — the read is terminally resolved either way; we just
        // skip the state overwrite. Set BEFORE the early returns so the
        // reconcile gate releases.
        loadedRef.current = true;
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
      .catch((err) => {
        if (cancelled) return;
        // The read terminated (so release the reconcile gate) but FAILED, so the
        // empty default is NOT authoritative — flag it so the destructive orphan
        // reaper stands down for this kind (no mass-reap of live marks).
        loadErrorRef.current = true;
        loadedRef.current = true;
        setLoadError(true);
        setLoaded(true);
        // … and SAY so (task 679), on the same one channel the WRITE side of
        // this hook already speaks from. `loadError` tells the app's own gates
        // to stand down; it tells the USER nothing, and the surface they are
        // looking at renders the empty default as "nothing here" — inviting
        // them to re-make what the file already holds. The read half of the
        // swallow `sidecar-refusal.ts` was built for. Same noun as the write
        // path (`errorLabel`), never the filename.
        recordSidecarRefusal({
          docId,
          what: errorLabel ?? "document annotation",
          reason: "unreadable",
          detail: err instanceof Error ? err.message : undefined,
        });
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
      cancelArmedTimer();
      pendingRef.current = null;
      // Reader-mode safety guard: refuse a write the active chrome disallows
      // (a read-mostly host writing anything but its editable card sidecars).
      // The note annotation sidecar passes — and LANDS, since the storage
      // funnel reads the same derivation (task 556); everything else is
      // dropped here — the in-memory state still updated, only the disk write
      // is suppressed — which is what keeps the `hasMutatedRef` stamp below
      // honest: it is never set for a write the layer below would refuse.
      //
      // NOT published to the refusal channel, deliberately (task 637): under a
      // read-mostly host this branch is reached by ORDINARY, DESIGNED churn —
      // `focus.json`, `document-settings.json`, `editor-state.json` are
      // session-only in the Reader BY DECISION (`library/READER_INHERITANCE.md`),
      // so a band raised here would be permanently lit by the user simply
      // reading. The card-mutation half of this defect is answered where it can
      // be answered honestly: BEFORE the gesture, by withholding the affordance
      // (`useCardDeleteAllowed`, `panel-primitives.tsx`) — a standing host
      // property needs no runtime discovery. What is published below is the
      // `failed` case, which is not designed and not knowable in advance.
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
      // IN FLIGHT from here until the write SETTLES — the `hasPendingWrite`
      // half the timer handle cannot carry. Incremented synchronously, in the
      // same turn the caller nulled the handle, so there is no interleaving
      // point between the two; decremented in `finally`, so a refusal or a
      // throw releases it exactly as a landing does.
      inFlightRef.current += 1;
      try {
        await writeSidecar(h, filename, s);
      } catch (err) {
        if (isStalePipelineError(err)) return;
        console.error(`Failed to save ${errorLabel ?? filename}:`, err);
        // … and SAY so (task 637, over task 630's channel). A `console.error`
        // is not a report: this primitive owns fifteen sidecars, thirteen of
        // them CONTENT tier, and a throw here means the user's writing is in
        // memory only — gone at the next reload, with the panel still showing
        // it as saved. That is precisely the swallow `sidecar-refusal.ts` was
        // built for; it just had no publisher on the panel path.
        //
        // The noun is the hook's own `errorLabel` ("notes", "revisions", …),
        // which every content consumer already declares for the log line. NEVER
        // the filename — the channel deliberately does not carry one, and a
        // consumer with no label gets the generic phrase rather than a leaked
        // one.
        recordSidecarRefusal({
          docId: h.docId,
          what: errorLabel ?? "document annotation",
          reason: "failed",
          detail: err instanceof Error ? err.message : undefined,
        });
      } finally {
        inFlightRef.current -= 1;
      }
    },
    [resolveHandle, filename, errorLabel, cancelArmedTimer],
  );

  // Fire the pending write synchronously (the persist itself stays
  // async; we just stop deferring it). Safe to call when nothing is
  // pending. THE SETTLE DOOR: the unmount / docId-change cleanup, the
  // tab-hidden edge, and — through the pending-flusher registry below — the
  // per-doc drain and the app-wide reload door. It RETURNS the write promise
  // so a door that must know the write is on the queue before it proceeds
  // (the reload door's step 1, task 391) can await it; the edge callers
  // ignore the return value.
  const flushPending = useCallback((): Promise<void> => {
    cancelArmedTimer();
    const payload = pendingRef.current;
    pendingRef.current = null;
    return payload !== null ? persist(payload) : Promise.resolve();
  }, [persist, cancelArmedTimer]);

  // Register the settle door with the ONE pending-flusher registry (task 559),
  // under this document, beside `useDocument`'s bundle debounce. A document's
  // writes are coalesced in ~20 places, and an app-wide door — the reload door
  // before a page tears down, `drainDoc` before a doc switch — can only flush
  // what is registered: pre-559 nothing here was, so a note body typed in the
  // 300 ms before a reload sat outside the door, outside the unsaved-work
  // channel and outside the mirror at once. Token-matched unregister, so a
  // stale cleanup never evicts a sibling sidecar's registration.
  useEffect(() => {
    if (!docId) return;
    registerPendingFlusher(docId, flushPending);
    return () => unregisterPendingFlusher(docId, flushPending);
  }, [docId, flushPending]);

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
          cancelArmedTimer();
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
    [persist, debounceMs, cancelArmedTimer],
  );

  // ── THE LOAD-TIME RECONCILE DOOR (task 570) ────────────────────────────────
  // See `PersistentStateApi.updateWhenLoaded`. Two halves: the CALL, which
  // either holds the derivation (read not yet resolved) or applies it; and the
  // `loaded` EFFECT below, which applies a held derivation exactly once, in the
  // commit AFTER the loader's own `setState` landed — so the derivation's
  // `prev` is the sidecar as loaded, never the pre-load default. The apply
  // path is `update()` (persisted, `hasMutatedRef` stamped — the read is over,
  // so the stamp can no longer hide the sidecar from the loader) EXCEPT on a
  // read that THREW, where it is memory-only: the default in memory is not
  // the file, and an automatic write of it would destroy the file's contents.
  const applyReconcile = useCallback(
    (fn: (prev: S) => S) => {
      if (loadErrorRef.current) {
        setState((prev) => fn(prev));
        return;
      }
      update(fn);
    },
    [update],
  );
  const updateWhenLoaded = useCallback(
    (fn: (prev: S) => S) => {
      if (!loadedRef.current) {
        heldReconcileRef.current = fn;
        return;
      }
      applyReconcile(fn);
    },
    [applyReconcile],
  );
  useEffect(() => {
    if (!loaded) return;
    const held = heldReconcileRef.current;
    if (held === null) return;
    heldReconcileRef.current = null;
    applyReconcile(held);
  }, [loaded, applyReconcile]);

  // Flush any pending write whenever the doc id changes (the new doc's
  // handle is different — writing then would either race or be dropped
  // by the stale-pipeline guard). Same on unmount: hand the last value
  // to the storage layer rather than dropping it. `enqueueWrite` inside
  // writeSidecar serializes against the queue so order is preserved
  // even if a switch happens mid-debounce.
  useEffect(() => {
    return () => {
      void flushPending();
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
  // clean, i.e. `hasPendingWrite()` is false — no debounced write ARMED and no
  // write IN FLIGHT (task 569; the timer handle alone reads clean for the whole
  // in-flight window, which is the window the defect lived in). If a local
  // edit is pending we DEFER — skip this round — so an in-progress local edit is
  // never overwritten by the on-disk value. The guard is per-instance
  // (docId+filename), so a dirty notes.json never blocks a clean revisions.json
  // re-read.
  //
  // WHAT A DEFERRAL MEANS, stated honestly: LOCAL WINS for this file. This hook
  // writes WHOLE SNAPSHOTS, so the pending write lands the local state over the
  // external bytes, and `writeTrackedText` then re-baselines the disk ledger to
  // OUR bytes — so the watcher's next poll takes the cheap mtime/size path and
  // emits NOTHING. The external change is not "re-checked once the write has
  // flushed" (an earlier draft of this comment claimed that, and it is false —
  // the watcher re-baselines to the external bytes BEFORE it emits, and has no
  // way to know a listener declined); it is overwritten, which is the
  // 220/558 "two writers means ONE serialized read-modify-merge authority"
  // class, owed by every sidecar that is not `ai-requests.json` or the bib and
  // recorded for a design pass of its own. `useAiRequests` REPLAYS a deferred
  // re-read once its in-flight mutations drain, and that is right THERE because
  // it merges: disk after the drain holds the union. Here a replay after a
  // landed write would read back our own snapshot (a no-op), and after a
  // refused or thrown write would adopt disk over unlanded memory — the stomp
  // this guard exists to prevent, one turn later. So: defer, and only defer.
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
      // DIRTY GUARD: an armed or in-flight write means local state has an
      // unsaved edit — defer rather than clobber it (see above for what the
      // deferral costs).
      if (hasPendingWrite()) return;
      // Re-read from disk (the bundle was invalidated by the watcher, so this
      // hits disk). Update state on success; on absence (file removed) fall back
      // to the default so the panel empties. A read error leaves state as-is.
      readSidecarIfExists<S>(docId, filename)
        .then((raw) => {
          if (cancelled) return;
          // Re-check the dirty guard AFTER the async read: the user may have
          // started editing — or a `persist()` may have started writing — while
          // the read was in flight. Never stomp either.
          if (hasPendingWrite()) return;
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

  return {
    state,
    setState,
    update,
    persist,
    updateWhenLoaded,
    stateRef,
    loaded,
    loadError,
  };
}
