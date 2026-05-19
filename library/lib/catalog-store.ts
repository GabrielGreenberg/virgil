"use client";

/**
 * Module-level singleton for the library catalog. Two purposes:
 *
 *   1. Backs `useLibrary()` consumers (currently just BibliographyPanel),
 *      providing the same observe-only API the v1 manifest hook had —
 *      shared across all subscribers, no per-tab refresh duplication.
 *   2. Lets the Library tab read the same store rather than spawning a
 *      second polling loop. (`useCatalog` inside the LibraryView still
 *      maintains its own focus/visibility-aware reload; that's fine
 *      since both end up pulling from `.virgil/catalog.json` on disk.)
 *
 * Polling: every 6s we re-read `.virgil/catalog-version.txt` (1 byte). When
 * the version changes, we re-read `.virgil/catalog.json`. Same tactic the LibraryView
 * uses — keeps cost near-zero in the steady state.
 */

import { useEffect, useSyncExternalStore } from "react";
import { readCatalog, readCatalogVersion, type Catalog, type CatalogEntry } from "./catalog";
import { getLibraryHandle } from "./library-folder";

const POLL_MS = 6000;

interface StoreState {
  /** The folder handle, once resolved. `null` means "no library picked" or "permission not granted". */
  handle: FileSystemDirectoryHandle | null;
  catalog: Catalog | null;
  version: string;
  /** Bumps every time we re-read the catalog. Useful as a cache-bust key. */
  revision: number;
  lastReadAt: string | null;
}

let state: StoreState = {
  handle: null,
  catalog: null,
  version: "0",
  revision: 0,
  lastReadAt: null,
};

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function setState(next: StoreState) {
  state = next;
  emit();
}

function getState(): StoreState {
  return state;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

async function resolveHandle(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await getLibraryHandle();
  if (!handle) return null;
  try {
    const perm = await handle.queryPermission({ mode: "readwrite" });
    if (perm !== "granted") return null;
  } catch {
    return null;
  }
  return handle;
}

async function reloadFromDisk(): Promise<void> {
  const handle = await resolveHandle();
  if (!handle) {
    if (state.handle !== null || state.catalog !== null) {
      setState({
        handle: null,
        catalog: null,
        version: "0",
        revision: state.revision + 1,
        lastReadAt: null,
      });
    }
    return;
  }
  try {
    const version = await readCatalogVersion(handle);
    // `catalog-version.txt` is the canonical change signal — every Python
    // skill that touches master.bib / catalog.json / inbox.json bumps it
    // under `lock_catalog`. Don't gate on `state.handle === handle`: in
    // dev-storage mode `devLibraryRootHandle()` returns a fresh synthetic
    // handle on every call, so identity comparison there is always false
    // and the short-circuit would never engage — driving a 6s re-parse
    // cascade through `useLibraryMasterBib`. In production FSA the handle
    // is stable via IDB-keyval, but the version check is sufficient.
    if (version === state.version && state.catalog !== null) {
      // No change. Adopt the new handle reference in case the previous
      // resolve returned null or returned a fresh synthetic in dev mode.
      if (state.handle !== handle) {
        setState({ ...state, handle });
      }
      return;
    }
    const catalog = await readCatalog(handle);
    setState({
      handle,
      catalog,
      version,
      revision: state.revision + 1,
      lastReadAt: new Date().toISOString(),
    });
  } catch {
    // Read failures are non-fatal; subscribers continue to see the
    // last-good snapshot until a future poll succeeds.
  }
}

let initialized = false;
function ensureInitialized() {
  if (initialized) return;
  initialized = true;
  void reloadFromDisk();
}

/** Force a re-read. Safe to call any time. */
export function refreshCatalogStore(): void {
  void reloadFromDisk();
}

export interface UseCatalogItemsResult {
  entries: CatalogEntry[];
  /** Helpful for cache-bust keys / effect deps. */
  revision: number;
  /** True once a folder + permission resolved successfully. */
  hasFolder: boolean;
}

export function useCatalogItems(): UseCatalogItemsResult {
  const snapshot = useSyncExternalStore(subscribe, getState, getState);
  useEffect(() => {
    ensureInitialized();
    const onFocus = () => refreshCatalogStore();
    window.addEventListener("focus", onFocus);
    const id = window.setInterval(() => refreshCatalogStore(), POLL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(id);
    };
  }, []);
  return {
    entries: snapshot.catalog?.entries ?? [],
    revision: snapshot.revision,
    hasFolder: snapshot.handle !== null,
  };
}
