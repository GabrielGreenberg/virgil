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
    // under `lock_catalog`. The handle OBJECT, by contrast, has a FRESH
    // identity on every resolve in BOTH environments: production idb-keyval
    // deserializes a new FileSystemDirectoryHandle from the structured clone
    // on each `get`, and dev-storage `devLibraryRootHandle()` mints a new
    // synthetic per call. So handle identity must never drive an emit — the
    // pre-fix "adopt the new handle reference" branch here setState'd on
    // EVERY idle 6s tick, re-rendering the whole Library tree (R6). When the
    // version is unchanged, keep the EXISTING state object untouched (same
    // snapshot identity → zero notify): the previously-stored handle stays
    // valid because FSA handles reference the directory entry itself, and in
    // this branch `state.catalog !== null` guarantees a prior successful
    // resolve stored one.
    if (version === state.version && state.catalog !== null) {
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

// Single shared polling loop with refcounted consumers. Each
// `useCatalogItems()` mount used to install its own 6-second interval
// and focus listener; in a session with N library-aware components
// (Bibliography, CitekeyPicker, LibraryEntryMenu, etc.) that meant N
// duplicate version-file reads per cycle. With refcounting the disk
// read fires once per cycle regardless of how many components are
// listening, and the interval shuts down entirely when no one is
// subscribed (editor-only sessions never poll).
let activeConsumerCount = 0;
let sharedPollIntervalId: number | null = null;
let sharedFocusListener: (() => void) | null = null;

function startSharedPolling() {
  if (sharedPollIntervalId !== null) return;
  sharedFocusListener = () => refreshCatalogStore();
  window.addEventListener("focus", sharedFocusListener);
  sharedPollIntervalId = window.setInterval(
    () => refreshCatalogStore(),
    POLL_MS,
  );
}

function stopSharedPolling() {
  if (sharedPollIntervalId !== null) {
    window.clearInterval(sharedPollIntervalId);
    sharedPollIntervalId = null;
  }
  if (sharedFocusListener) {
    window.removeEventListener("focus", sharedFocusListener);
    sharedFocusListener = null;
  }
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
    activeConsumerCount += 1;
    if (activeConsumerCount === 1) startSharedPolling();
    return () => {
      activeConsumerCount = Math.max(0, activeConsumerCount - 1);
      if (activeConsumerCount === 0) stopSharedPolling();
    };
  }, []);
  return {
    entries: snapshot.catalog?.entries ?? [],
    revision: snapshot.revision,
    hasFolder: snapshot.handle !== null,
  };
}
