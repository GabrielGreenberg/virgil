"use client";

import { useSyncExternalStore } from "react";
import {
  useDiskWatcher,
  useDiskWatcherOrNull,
} from "@/components/editor-layout/contexts/disk-watcher";
import type {
  DiskWatcher,
  ExternalChangeState,
} from "@/lib/disk-watcher";

/**
 * React read of the current external-change state for the open doc — the
 * surface the external-change badge consumes (design:
 * docs/memos/external-change-badge/DESIGN.md §7).
 *
 * Subscribes to the per-doc `DiskWatcher`'s store via `useSyncExternalStore`.
 * The store's `getSnapshot` returns a STABLE object reference (the same frozen
 * snapshot until the state actually changes), so this never tears or loops.
 *
 * Returns the live `state` plus the `watcher` itself, so the badge can drive
 * the reconcile actions next chip:
 *  - Reload  → `watcher.clearChanges()` (optimistic) then the doc's `refetch()`
 *  - Dismiss → `watcher.acknowledge()` (re-baseline + clear)
 *  - read severity / changes / detectedAt / paused off `state`.
 *
 * Must be called inside a `DiskWatcherProvider` (i.e. with a doc open).
 */
export function useExternalChanges(): {
  state: ExternalChangeState;
  watcher: DiskWatcher;
} {
  const { watcher } = useDiskWatcher();
  const state = useSyncExternalStore(
    watcher.store.subscribe,
    watcher.store.getSnapshot,
    watcher.store.getSnapshot,
  );
  return { state, watcher };
}

/**
 * A stable, frozen "clean" snapshot for the no-provider case (no doc open /
 * bare test contexts). Module-level so its identity never changes — a
 * `useSyncExternalStore` snapshot getter must return a stable reference.
 */
const CLEAN_SNAPSHOT: ExternalChangeState = Object.freeze({
  changes: Object.freeze([]),
  severity: null,
  detectedAt: null,
  paused: false,
});
const NOOP_UNSUB = () => {};
const noopSubscribe = () => NOOP_UNSUB;
const getCleanSnapshot = () => CLEAN_SNAPSHOT;

/**
 * Nullable variant — for call sites that may render with NO doc open (so no
 * `DiskWatcherProvider`). Returns the live `state` when a watcher exists, or a
 * frozen clean snapshot (severity null) when it doesn't. Used by EditorLayout
 * to lift a "badge active" boolean into the divider-gate condition without
 * throwing when no doc is open.
 *
 * Calls `useSyncExternalStore` UNCONDITIONALLY (hooks rule) — with the watcher's
 * store when present, or a no-op subscribe + stable clean snapshot when absent.
 */
export function useExternalChangesOrNull(): {
  state: ExternalChangeState;
  watcher: DiskWatcher | null;
} {
  const ctx = useDiskWatcherOrNull();
  const watcher = ctx?.watcher ?? null;
  const state = useSyncExternalStore(
    watcher ? watcher.store.subscribe : noopSubscribe,
    watcher ? watcher.store.getSnapshot : getCleanSnapshot,
    watcher ? watcher.store.getSnapshot : getCleanSnapshot,
  );
  return { state, watcher };
}
