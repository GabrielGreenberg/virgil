"use client";

/**
 * Global library state hook.
 *
 * Owns the single library-folder handle + the current manifest. Exposed as
 * a module-level singleton via subscription so multiple Library tabs (one
 * per open doc) share the same underlying data and refresh cadence.
 *
 * Refresh policy:
 *   - On first mount (when a Library tab comes alive anywhere).
 *   - On window focus.
 *   - While at least one subscriber is mounted, re-read every POLL_MS.
 *   - Manually via the returned `refresh()`.
 *
 * Permission: the hook does NOT request permission. It exposes the
 * folderState so the tab can render the picker or permission gate when
 * needed. Those components re-trigger the hook via setHandle/refresh.
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  getLibraryHandle,
  setLibraryHandle as persistHandle,
  clearLibraryHandle as clearHandle,
} from "@/lib/library/library-folder";
import { readManifest } from "@/lib/library/library-manifest";
import { queryRW } from "@/lib/fsa-permissions";
import type { LibraryManifest } from "@/lib/library/library-types";

const POLL_MS = 8000;

export type LibraryFolderState =
  /** Hook hasn't finished its initial IndexedDB lookup. */
  | { kind: "loading" }
  /** No library folder picked yet. */
  | { kind: "none" }
  /** Handle stored, but permission is `prompt` or `denied`. */
  | { kind: "needs-permission"; handle: FileSystemDirectoryHandle }
  /** Handle stored and `readwrite` permission granted. */
  | { kind: "ready"; handle: FileSystemDirectoryHandle };

interface LibraryStore {
  folderState: LibraryFolderState;
  manifest: LibraryManifest;
  /** Incremented on each successful re-read; useful as a cache-bust key. */
  revision: number;
  /** ISO timestamp of the last successful manifest read. */
  lastReadAt: string | null;
}

// ---------------------------------------------------------------------------
// Module-level store (single source of truth shared across subscribers).
// ---------------------------------------------------------------------------

const EMPTY_MANIFEST: LibraryManifest = { version: 1, items: [] };

let storeState: LibraryStore = {
  folderState: { kind: "loading" },
  manifest: EMPTY_MANIFEST,
  revision: 0,
  lastReadAt: null,
};

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function setState(next: LibraryStore) {
  storeState = next;
  emit();
}

function getState(): LibraryStore {
  return storeState;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

// ---------------------------------------------------------------------------
// Core load / refresh
// ---------------------------------------------------------------------------

/** Resolve the stored handle + its permission state. */
async function resolveFolderState(): Promise<LibraryFolderState> {
  const handle = await getLibraryHandle();
  if (!handle) return { kind: "none" };
  const perm = await queryRW(handle);
  return perm === "granted"
    ? { kind: "ready", handle }
    : { kind: "needs-permission", handle };
}

async function loadFromDisk(): Promise<void> {
  const folderState = await resolveFolderState();
  if (folderState.kind !== "ready") {
    setState({
      ...getState(),
      folderState,
      manifest: EMPTY_MANIFEST,
      lastReadAt: null,
    });
    return;
  }
  const manifest = await readManifest(folderState.handle);
  setState({
    folderState,
    manifest,
    revision: getState().revision + 1,
    lastReadAt: new Date().toISOString(),
  });
}

/** True once at least one subscriber has ever mounted, so we know the
 *  initial load has been attempted. */
let initialized = false;
function ensureInitialized() {
  if (initialized) return;
  initialized = true;
  loadFromDisk().catch(() => {
    // Leave state as-is; the consumer will show a reasonable empty view.
  });
}

// ---------------------------------------------------------------------------
// Public imperative API (can be called outside React)
// ---------------------------------------------------------------------------

/** Force a re-read of the manifest. Safe to call any time. */
export async function refreshLibrary(): Promise<void> {
  await loadFromDisk();
}

/** Record a freshly-picked handle and immediately load its manifest. */
export async function adoptLibraryHandle(
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  await persistHandle(handle);
  setState({
    ...getState(),
    folderState: { kind: "ready", handle },
  });
  await loadFromDisk();
}

/** Drop the stored handle. Used by "Change library folder…". */
export async function forgetLibraryHandle(): Promise<void> {
  await clearHandle();
  setState({
    folderState: { kind: "none" },
    manifest: EMPTY_MANIFEST,
    revision: getState().revision + 1,
    lastReadAt: null,
  });
}

/** Called by the permission gate once the user has clicked Allow. */
export async function notifyPermissionGranted(): Promise<void> {
  await loadFromDisk();
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

export interface UseLibraryResult {
  folderState: LibraryFolderState;
  manifest: LibraryManifest;
  revision: number;
  lastReadAt: string | null;
  refresh: () => Promise<void>;
  pickFolder: (handle: FileSystemDirectoryHandle) => Promise<void>;
  forgetFolder: () => Promise<void>;
  permissionGranted: () => Promise<void>;
}

export function useLibrary(): UseLibraryResult {
  const snapshot = useSyncExternalStore(subscribe, getState, getState);

  // Kick off the initial load, and mount focus + interval refresh while
  // at least one component is using the hook.
  useEffect(() => {
    ensureInitialized();
    const onFocus = () => {
      refreshLibrary().catch(() => {});
    };
    window.addEventListener("focus", onFocus);
    const interval = window.setInterval(() => {
      refreshLibrary().catch(() => {});
    }, POLL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(interval);
    };
  }, []);

  const refresh = useCallback(() => refreshLibrary(), []);
  const pickFolder = useCallback(
    (handle: FileSystemDirectoryHandle) => adoptLibraryHandle(handle),
    [],
  );
  const forgetFolder = useCallback(() => forgetLibraryHandle(), []);
  const permissionGranted = useCallback(() => notifyPermissionGranted(), []);

  return {
    folderState: snapshot.folderState,
    manifest: snapshot.manifest,
    revision: snapshot.revision,
    lastReadAt: snapshot.lastReadAt,
    refresh,
    pickFolder,
    forgetFolder,
    permissionGranted,
  };
}

/**
 * Lighter variant for consumers outside the Library tab (e.g., the
 * Bibliography panel) that just want to observe manifest items and don't
 * need folder-management APIs. Same underlying store.
 */
export function useLibraryItems(): {
  items: LibraryManifest["items"];
  folderState: LibraryFolderState;
  revision: number;
} {
  const snapshot = useSyncExternalStore(subscribe, getState, getState);
  useEffect(() => {
    ensureInitialized();
  }, []);
  return {
    items: snapshot.manifest.items,
    folderState: snapshot.folderState,
    revision: snapshot.revision,
  };
}
