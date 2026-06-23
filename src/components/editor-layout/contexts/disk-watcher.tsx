"use client";

import {
  createContext,
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
} from "@/lib/storage";
import { clearDiskLedger } from "@/lib/disk-ledger";
import { createDiskWatcher, type DiskWatcher } from "@/lib/disk-watcher";

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
   * Inject the canonical "are there unsaved in-editor edits?" getter (the
   * `saveTimerRef.current !== null` SSOT). Called ONCE per `useDocument` mount,
   * never per keystroke. Returns an unregister that restores the default
   * `() => false`.
   */
  registerUnsavedGetter: (fn: () => boolean) => () => void;
  /**
   * Inject the doc's `refetch()` (readDocBundle → setContent → re-baseline the
   * ledger). Called ONCE per `useDocument` mount, never per keystroke. Returns
   * an unregister that restores the default no-op. MIRRORS
   * `registerUnsavedGetter` — same ref-swap lifecycle — so the badge can drive
   * "Reload from disk" without coupling to EditorPane.
   */
  registerReload: (fn: () => void | Promise<void>) => () => void;
  /**
   * "Reload from disk": optimistically clear the watcher's change ledger, THEN
   * run the registered `refetch()`. The load path re-baselines the disk ledger
   * so the next poll reads clean. Resolves once `refetch()` settles. No-op (just
   * the optimistic clear) if no doc has registered a reload yet.
   */
  reloadFromDisk: () => Promise<void>;
}

const DiskWatcherCtx = createContext<DiskWatcherContextValue | null>(null);

export function DiskWatcherProvider({
  docId,
  children,
}: {
  docId: string;
  children: ReactNode;
}) {
  // The dirty-getter, injected by useDocument. Default `() => false` so the
  // watcher reports "no unsaved edits" until useDocument wires the real flag.
  const unsavedRef = useRef<() => boolean>(() => false);

  // The doc's `refetch()`, injected by useDocument (mirrors `unsavedRef`).
  // Default no-op so `reloadFromDisk` is harmless until useDocument wires the
  // real refetch. Read only inside `reloadFromDisk` (a user gesture), never
  // during render or per keystroke.
  const reloadRef = useRef<() => void | Promise<void>>(() => {});

  // ONE watcher per doc. Keying the memo on `docId` gives a stable-per-doc
  // watcher without depending on a React remount, so this provider can sit
  // above DocPipeline and still hand a fresh watcher to every doc.
  //
  // The `hasUnsavedEdits` thunk reads `unsavedRef.current()` — but ONLY at poll
  // time (wall-clock), never during render. That deferred read is exactly the
  // false positive React Compiler's `react-hooks/refs` rule flags ("passing a
  // ref to a function may read its value during render"). We opt this one memo
  // out, following the repo convention (see LiftHost.tsx's documented coupling).
  const watcher = useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs
      createDiskWatcher({
        docId,
        statFiles,
        readTextFile,
        getTexFilename,
        getBibFilename,
        hasUnsavedEdits: () => unsavedRef.current(),
        // `now` defaults to Date.now() inside createDiskWatcher; we rely on that
        // default rather than passing a thunk here (keeps this useMemo body
        // free of an impure call per react-hooks/purity).
        isHidden: () =>
          typeof document !== "undefined" &&
          document.visibilityState === "hidden",
      }),
    [docId],
  );

  // Start the watcher on mount / doc switch; stop + clear the ledger on
  // teardown. We clear the ledger here because NOTHING else owns doc-unload
  // ledger cleanup (verified: no other clearDiskLedger caller in the tree), and
  // a stale per-doc ledger would otherwise leak across the session. `stop()`
  // alone only tears down timers (it deliberately leaves the ledger to the
  // unload owner — which is this effect's cleanup).
  useEffect(() => {
    watcher.start();
    return () => {
      watcher.stop();
      clearDiskLedger(docId);
    };
  }, [watcher, docId]);

  const value = useMemo<DiskWatcherContextValue>(
    () => ({
      watcher,
      registerUnsavedGetter: (fn: () => boolean) => {
        unsavedRef.current = fn;
        return () => {
          unsavedRef.current = () => false;
        };
      },
      registerReload: (fn: () => void | Promise<void>) => {
        reloadRef.current = fn;
        return () => {
          reloadRef.current = () => {};
        };
      },
      // Optimistic clear THEN the registered refetch: clearing first hides the
      // badge immediately; the refetch re-baselines the disk ledger on load so
      // the next poll reads clean. `watcher.clearChanges()` is sync; we await
      // the refetch so callers can disable UI until the reload settles.
      reloadFromDisk: async () => {
        watcher.clearChanges();
        await reloadRef.current();
      },
    }),
    [watcher],
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
  children,
}: {
  docId: string | null | undefined;
  children: ReactNode;
}) {
  if (!docId) return <>{children}</>;
  return <DiskWatcherProvider docId={docId}>{children}</DiskWatcherProvider>;
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
