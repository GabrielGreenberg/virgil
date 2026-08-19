"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import {
  statFiles,
  readTextFile,
  getTexFilename,
  getBibFilename,
  invalidateSidecarBundle,
} from "@/lib/storage";
import { clearDiskLedger } from "@/lib/disk-ledger";
import { dispatchTexDelimitersChanged } from "@/lib/tex-delimiters-event";
import { createDiskWatcher, type DiskWatcher } from "@/lib/disk-watcher";
import {
  resolveExternalConflict,
  type ConflictChoice,
  type ConflictOutcome,
} from "@/lib/conflict-resolution";
import type { ConflictArchive } from "@/lib/storage-types";
import {
  createSidecarWatcher,
  type SidecarWatcher,
} from "@/lib/sidecar-watcher";
import { ALL_SIDECAR_FILENAMES } from "@/lib/sidecar-files";

/**
 * Per-doc lifecycle owner for the external-change `DiskWatcher` (design:
 * docs/memos/external-change-badge/DESIGN.md §2/§4/§11). Mounts ONE watcher per
 * `docId` and exposes it to the layout (topbar badge slot + `useDocument`'s
 * autosave-pause guard) via context.
 *
 * Placement: this provider wraps the WHOLE editor layout (topbar + panes) so
 * both the topbar status-cluster slot and EditorPane's `useDocument` call site
 * are descendants. The watcher is keyed per-doc via `useMemo([docId])`, so a
 * doc switch produces a fresh, stable watcher even though this provider sits
 * ABOVE the `<DocPipeline key={docId}>` boundary (the topbar — the badge's home
 * — is a sibling of DocPipeline, not a descendant, so the provider cannot live
 * under DocPipeline and still cover the topbar). The single start/stop effect
 * is keyed on the watcher identity, so a doc switch is exactly one stop (old
 * doc) + one start (new doc) — no extra start/stop churn.
 *
 * KEYSTROKE SANCTITY: the watcher is a wall-clock poller, NOT an editor
 * subscriber. It adds no `editor.on('update'|'transaction')` handler. Its only
 * editor touch is the O(1) `unsavedRef.current()` getter, PULLED at poll time
 * (wired by `useDocument` via `registerUnsavedGetter`). Typing N plain chars
 * runs zero watcher code.
 */

export interface DiskWatcherContextValue {
  watcher: DiskWatcher;
  /**
   * The docId this provider is currently watching (= the active doc). Multi-doc
   * keep-alive mounts N `useDocument` instances at once (1 active + warm), all
   * descendants of THIS single provider. Each compares its own docId to
   * `activeDocId` to decide whether to honor the autosave-pause guard — only the
   * active doc (the one whose external-change badge is visible) may pause; a warm
   * doc must never pause on the active doc's conflict state.
   */
  activeDocId: string;
  /**
   * Inject a doc's canonical "are there unsaved in-editor edits?" getter (the
   * `saveTimerRef.current !== null` SSOT), keyed by its docId. Called ONCE per
   * `useDocument` mount, never per keystroke. The watcher reads ONLY the active
   * doc's entry (`get(activeDocId)`), so N warm docs registering concurrently no
   * longer clobber each other (the pre-keep-alive last-writer-wins hazard).
   * Returns an unregister that drops this doc's entry (iff still ours).
   */
  registerUnsavedGetter: (docId: string, fn: () => boolean) => () => void;
  /**
   * Inject THIS doc's conflict-side actions, keyed by docId. Called ONCE per
   * `useDocument` mount, never per keystroke. MIRRORS `registerUnsavedGetter` —
   * every consumer below reads `get(activeDocId)`, so a badge gesture can never
   * target a warm doc.
   *
   * ONE registration rather than three (task 364). The three operations belong
   * to one obligation — a conflict has two sides and a net — and three
   * registrations is three chances to wire two of them: a `keepMine` that never
   * registered is a button that silently does nothing, which is precisely the
   * silence this task exists to end. The type makes all three required, so a
   * doc either offers the whole resolution or none of it.
   */
  registerDocActions: (docId: string, actions: DocConflictActions) => () => void;
  /**
   * "Reload from disk": optimistically clear the watcher's change ledger, THEN
   * run the registered `refetch()`. The load path re-baselines the disk ledger
   * so the next poll reads clean. Resolves once `refetch()` settles. No-op (just
   * the optimistic clear) if no doc has registered a reload yet.
   */
  reloadFromDisk: () => Promise<void>;
  /**
   * Resolve an external-change CONFLICT by keeping one side (task 364). Both
   * choices archive BOTH sides into one `virgil/.history/` slot first — the
   * order lives in [conflict-resolution.ts](@/lib/conflict-resolution), not
   * here — and the outcome reports what the net actually holds so the surface
   * can say so instead of promising it.
   *
   * No registered actions (no doc mounted yet) → a `null` outcome, and the
   * badge declines rather than reporting a resolution that never happened.
   */
  resolveConflict: (choice: ConflictChoice) => Promise<ConflictOutcome | null>;
}

/** The per-doc half of a conflict resolution — see `registerDocActions`. */
export interface DocConflictActions {
  /** readDocBundle → setContent → re-baseline the ledger (the disk side). */
  reload: () => void | Promise<void>;
  /** Write the LIVE editor model over disk now, as the user's explicit
   *  decision (the write gate steps aside; the net is already taken). */
  /** Apply the user's side. Resolves whether the write ACTUALLY LANDED
   *  (task 391) — a refused write returns normally, so the resolution SSOT
   *  reads this report rather than the absence of a throw. */
  keepMine: () => Promise<boolean>;
  /** Archive both sides — the doc side supplies the editor's model, which is
   *  the half the storage backend cannot see. */
  archiveSides: () => Promise<ConflictArchive | null>;
}

const DiskWatcherCtx = createContext<DiskWatcherContextValue | null>(null);

export function DiskWatcherProvider({
  docId,
  liveDocIds,
  children,
}: {
  docId: string;
  /**
   * The docIds currently kept alive (the active doc + warm keep-alive slots).
   * Defaults to `[docId]` (single-doc / no keep-alive). A doc's watcher lives —
   * and keeps polling, preserving its conflict store + ledger baseline across an
   * A→B→A round-trip — as long as it's in this set; it is disposed (stop +
   * clear ledger) only when it LEAVES the set (LRU eviction / tab close), so a
   * mere visibility round-trip never re-primes the badge away. (Pre-F2 the
   * watcher was re-created on every active-doc change and re-primed clean, which
   * silently dropped an unacknowledged external-change badge on switch-back.)
   */
  liveDocIds?: string[];
  children: ReactNode;
}) {
  // Per-docId dirty-getters + refetches, injected by each descendant
  // useDocument. Multi-doc keep-alive mounts N useDocument instances (1 active +
  // warm) under this single provider; keying by docId (mirrors
  // multi-window/pending-saves.ts) means the watcher reads the ACTIVE doc's
  // entry (`get(docId)`) instead of whichever instance registered last. The
  // maps live in refs — read only at poll time / on the Reload gesture, never
  // during render or per keystroke.
  const unsavedGetters = useRef(new Map<string, () => boolean>());
  const docActions = useRef(new Map<string, DocConflictActions>());

  // Stable register fns (identity never changes), so a descendant useDocument's
  // register effect does NOT re-run when the ACTIVE doc switches. Each takes the
  // registering doc's id; the unregister drops the entry iff it's still ours
  // (guards a stale late-unregister from clobbering a re-registration under
  // StrictMode's double-invoke).
  const registerUnsavedGetter = useCallback(
    (regDocId: string, fn: () => boolean) => {
      unsavedGetters.current.set(regDocId, fn);
      return () => {
        if (unsavedGetters.current.get(regDocId) === fn) {
          unsavedGetters.current.delete(regDocId);
        }
      };
    },
    [],
  );
  const registerDocActions = useCallback(
    (regDocId: string, actions: DocConflictActions) => {
      docActions.current.set(regDocId, actions);
      return () => {
        if (docActions.current.get(regDocId) === actions) {
          docActions.current.delete(regDocId);
        }
      };
    },
    [],
  );

  // ONE warm-stable watcher per docId, cached so a doc keeps the SAME watcher
  // (and its conflict store) across an A→B→A round-trip. The cache lives in a
  // ref; a watcher is created lazily the first time its doc becomes active and
  // survives until the doc leaves the keep-alive set (the dispose effect below).
  //
  // Each watcher's `hasUnsavedEdits` reads ONLY its own doc's dirty-getter
  // (`get(wDocId)`) — N warm docs register their own entry, so reading by docId
  // avoids the pre-keep-alive last-writer-wins clobber. The deferred ref read at
  // poll time is the false positive React Compiler's `react-hooks/refs` rule
  // flags; we opt out per the repo convention (see LiftHost.tsx).
  const watchersByDoc = useRef(new Map<string, DiskWatcher>());
  const startedWatchers = useRef(new WeakSet<DiskWatcher>());
  const getOrCreateWatcher = (wDocId: string): DiskWatcher => {
    const existing = watchersByDoc.current.get(wDocId);
    if (existing) return existing;
    // eslint-disable-next-line react-hooks/refs
    const created = createDiskWatcher({
      docId: wDocId,
      statFiles,
      readTextFile,
      getTexFilename,
      getBibFilename,
      hasUnsavedEdits: () => unsavedGetters.current.get(wDocId)?.() ?? false,
      isHidden: () =>
        typeof document !== "undefined" &&
        document.visibilityState === "hidden",
    });
    watchersByDoc.current.set(wDocId, created);
    return created;
  };
  const watcher = useMemo(() => getOrCreateWatcher(docId), [docId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── The SIDECAR watcher — a SIBLING of the DiskWatcher ────────────────────
  // Same per-doc keep-alive lifecycle (created lazily on first activation,
  // survives an A→B→A round-trip, disposed only when the doc leaves the
  // keep-alive set), so `virgil/*.json` panel sidecars become LIVE-reactive to
  // out-of-band writes (an AI agent drafting a card onto disk while the paper is
  // open). It shares the DiskWatcher poll MECHANISM but emits a plain
  // `virgil-sidecar-changed` event rather than a badge store — see
  // sidecar-watcher.ts for the sibling-vs-extend rationale. Covers EVERY sidecar
  // in ALL_SIDECAR_FILENAMES, so all panels (revisions/cutter/notes/todos/
  // footnotes/citations/reports/archive/…) get the reactivity for free.
  const sidecarWatchersByDoc = useRef(new Map<string, SidecarWatcher>());
  const startedSidecarWatchers = useRef(new WeakSet<SidecarWatcher>());
  const getOrCreateSidecarWatcher = (wDocId: string): SidecarWatcher => {
    const existing = sidecarWatchersByDoc.current.get(wDocId);
    if (existing) return existing;
    const created = createSidecarWatcher({
      docId: wDocId,
      filenames: ALL_SIDECAR_FILENAMES,
      statFiles,
      readTextFile,
      invalidateSidecarBundle,
      isHidden: () =>
        typeof document !== "undefined" &&
        document.visibilityState === "hidden",
    });
    sidecarWatchersByDoc.current.set(wDocId, created);
    return created;
  };
  const sidecarWatcher = useMemo(
    () => getOrCreateSidecarWatcher(docId),
    [docId], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Start each watcher EXACTLY ONCE (on first activation) and NEVER stop it on a
  // switch — a warm doc's watcher keeps polling, so returning to it shows its
  // already-detected change with no re-prime (the F2 fix). `start()` re-primes
  // (re-baselines to current disk bytes), so re-starting a cached watcher would
  // re-clobber an unacknowledged conflict; the started-set prevents that.
  useEffect(() => {
    if (!startedWatchers.current.has(watcher)) {
      watcher.start();
      startedWatchers.current.add(watcher);
    }
    // No stop-on-cleanup: disposal is owned by the dispose effect below (true
    // unload only), not by an active-doc switch.
  }, [watcher]);

  // Start the sidecar watcher on first activation, exactly once, mirroring the
  // DiskWatcher above. Never stopped on a switch — a warm doc keeps polling its
  // sidecars, so an out-of-band card written to a warm doc surfaces on return.
  useEffect(() => {
    if (!startedSidecarWatchers.current.has(sidecarWatcher)) {
      sidecarWatcher.start();
      startedSidecarWatchers.current.add(sidecarWatcher);
    }
  }, [sidecarWatcher]);

  // Dispose watchers whose doc has LEFT the keep-alive set (LRU eviction / tab
  // close) — the ONLY place a watcher stops + its ledger is cleared. A mere
  // active⇄warm switch leaves the set unchanged, so it never disposes. Keyed on
  // the set's CONTENT (join) so it doesn't thrash on unrelated re-renders.
  const live = liveDocIds ?? [docId];
  const liveKey = live.join(" ");
  useEffect(() => {
    const alive = new Set(liveKey ? liveKey.split(" ") : []);
    for (const [id, w] of [...watchersByDoc.current]) {
      // Never dispose the active doc (defensive — it's always in `alive`).
      if (id !== docId && !alive.has(id)) {
        w.stop();
        clearDiskLedger(id);
        watchersByDoc.current.delete(id);
        startedWatchers.current.delete(w);
      }
    }
    // Dispose the SIDECAR watcher for the same evicted docs. `clearDiskLedger`
    // above already wiped the whole-doc ledger (the .tex/.bib AND sidecar
    // fingerprints share it), so here we only stop the timer + drop the entry.
    for (const [id, sw] of [...sidecarWatchersByDoc.current]) {
      if (id !== docId && !alive.has(id)) {
        sw.stop();
        sidecarWatchersByDoc.current.delete(id);
        startedSidecarWatchers.current.delete(sw);
      }
    }
  }, [liveKey, docId]);

  // Provider unmount (no doc open / app teardown): dispose everything still
  // cached so no watcher timer or ledger baseline leaks across the session.
  useEffect(() => {
    const cache = watchersByDoc.current;
    const sidecarCache = sidecarWatchersByDoc.current;
    return () => {
      for (const [id, w] of cache) {
        w.stop();
        clearDiskLedger(id);
      }
      cache.clear();
      for (const [, sw] of sidecarCache) sw.stop();
      sidecarCache.clear();
    };
  }, []);

  const value = useMemo<DiskWatcherContextValue>(
    () => ({
      watcher,
      activeDocId: docId,
      registerUnsavedGetter,
      registerDocActions,
      // Optimistic clear THEN the ACTIVE doc's registered refetch: clearing
      // first hides the badge immediately; the refetch re-baselines the disk
      // ledger on load so the next poll reads clean. `watcher.clearChanges()` is
      // sync; we await the refetch so callers can disable UI until the reload
      // settles. Reading `get(docId)` (not last-writer-wins) guarantees the
      // badge's Reload drives the active doc, never a warm one.
      reloadFromDisk: async () => {
        watcher.clearChanges();
        await (docActions.current.get(docId)?.reload ?? (() => {}))();
        // The reload replaced in-memory content from disk; an open code
        // pane's delimiter closure is now stale — tell it to re-read the
        // disk preamble/postamble and resync (no code pane → free no-op).
        dispatchTexDelimitersChanged(docId);
      },
      // The CONFLICT doors (task 364). Both sides are archived first and the
      // ORDER lives in the resolution SSOT, never here — this closure only
      // supplies the ports, resolved for the ACTIVE doc exactly as
      // `reloadFromDisk` does. A doc with no registered actions declines
      // (`null`) rather than reporting a resolution that never happened.
      resolveConflict: async (choice) => {
        const actions = docActions.current.get(docId);
        if (!actions) return null;
        return resolveExternalConflict(choice, {
          archive: actions.archiveSides,
          acknowledge: () => watcher.acknowledge(),
          keepMine: actions.keepMine,
          // The disk side reuses the SAME reload path the 'change' severity
          // takes — optimistic clear, refetch, delimiters event — so the two
          // severities can never come to disagree about what "load the disk
          // version" does.
          takeDisk: async () => {
            watcher.clearChanges();
            await actions.reload();
            dispatchTexDelimitersChanged(docId);
          },
        });
      },
    }),
    [watcher, docId, registerUnsavedGetter, registerDocActions],
  );

  return (
    <DiskWatcherCtx.Provider value={value}>{children}</DiskWatcherCtx.Provider>
  );
}

/**
 * Convenience wrapper for the layout: mount the provider ONLY when a doc is
 * open. When `docId` is null/empty (no document), it renders children directly
 * (no provider) — topbar consumers use `useDiskWatcherOrNull`, so the badge
 * simply shows nothing. Keeps the EditorLayout JSX clean while guaranteeing the
 * provider never gets a null docId.
 */
export function DiskWatcherProviderGate({
  docId,
  liveDocIds,
  children,
}: {
  docId: string | null | undefined;
  /** The kept-alive docIds (active + warm). Forwarded to the provider so a warm
   *  doc's watcher survives an A→B→A round-trip; see DiskWatcherProvider. */
  liveDocIds?: string[];
  children: ReactNode;
}) {
  if (!docId) return <>{children}</>;
  return (
    <DiskWatcherProvider docId={docId} liveDocIds={liveDocIds}>
      {children}
    </DiskWatcherProvider>
  );
}

/** Throws if used outside a DiskWatcherProvider. */
export function useDiskWatcher(): DiskWatcherContextValue {
  const v = useContext(DiskWatcherCtx);
  if (!v) {
    throw new Error("useDiskWatcher must be used inside DiskWatcherProvider");
  }
  return v;
}

/**
 * Nullable variant — for call sites that mount BOTH inside the live app (where
 * the provider exists) and in bare test contexts (where it doesn't). `useDocument`
 * uses this so the editor still works when no provider is present.
 */
export function useDiskWatcherOrNull(): DiskWatcherContextValue | null {
  return useContext(DiskWatcherCtx);
}
