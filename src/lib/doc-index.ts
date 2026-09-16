/**
 * IndexedDB persistence for the FSA storage layer.
 *
 * What lives in here:
 *   - The list of papers the user has opened (just metadata, no file data).
 *   - One `FileSystemDirectoryHandle` per paper, keyed by doc id. The user
 *     picked this folder once; the handle is structured-cloneable, so the
 *     browser persists it for us across reloads. We just need to re-check
 *     permission on each session.
 *   - An optional `FileSystemFileHandle` per paper for the user's "general
 *     bibliography" (.bib file used as a search source for citations).
 *   - The set of currently open tabs and the active one, so reloading
 *     restores the same workspace.
 *
 * What does NOT live in here:
 *   - File contents. The .tex file, sidecar JSON, and .bib live on the
 *     user's real disk via the FSA handles. OPFS is intentionally unused.
 *   - Anything that should be portable. IndexedDB is per-origin and per-
 *     basePath, so handles do not survive a deploy URL change.
 */

import { get, set, del, keys, update, createStore } from "idb-keyval";

import { isDevStorage } from "@/lib/storage-mode";

const store = createStore("virgil", "kv");

const INDEX_KEY = "index";
const TABS_KEY = "tabs";
const TABS_WINDOW_PREFIX = "tabs/";
const WINDOWS_REGISTRY_KEY = "windows-registry";
const DOC_HANDLE_PREFIX = "doc-handle/";
const GENERAL_BIB_HANDLE_PREFIX = "general-bib-handle/";
const MY_PAPERS_KEY = "my-papers";

/**
 * The metadata we keep per paper. Intentionally minimal: anything that
 * can be derived by reading the folder is read on demand instead.
 */
export interface FsaDocMeta {
  id: string;
  /** Human-readable title shown in the tab strip; user-editable. */
  name: string;
  /**
   * The actual filename of the .tex inside the doc folder, e.g.
   * "main.tex" or "paper.tex". We store this so we don't have to
   * scan the folder on every read.
   */
  texFilename: string;
  /** Display label for the picked folder (its `.name`), for the path bar. */
  folderName: string;
  createdAt: string;
  lastModifiedAt: string;
  /** ISO timestamp of the last user-driven activation of this paper.
   *  Bumped by `openFile`/`activateDoc`, NOT by hydration on page load. */
  lastAccessedAt: string;
}

export interface FsaDocIndex {
  docs: FsaDocMeta[];
}

export type ActivePaneKind = "doc" | "paper" | "library-outer";

/** Prefix used for paper outer-tab ids in `outerOrder` — the tail is
 *  the citekey. Kept verbatim in sync with `paperLibraryId()` in the
 *  library subsystem so a single string flows from the inner library
 *  drag-source through the outer bar without re-encoding. */
export const OUTER_PAPER_PREFIX = "paper:";
/** Prefix used for library outer-tab ids in `outerOrder` — the tail is
 *  the inner library's id (custom or `project`). Tab state lives under
 *  the scoped key `virgil-library-tabs-outer:<libId>-<panelKey>`. */
export const OUTER_LIBRARY_PREFIX = "library:";
/** Sentinel id for the singleton, pinned-to-far-left Library outer tab.
 *  Always present in `outerOrder` at index 0; non-closable; uses the
 *  legacy unscoped panel-state keys (so it inherits whatever the user's
 *  inline Library tab state was before the pin). */
export const OUTER_LIBRARY_ROOT_ID = OUTER_LIBRARY_PREFIX + "__root__";

export interface TabsState {
  openTabIds: string[];
  currentDocId: string | null;
  /** Which pane is active. "doc" → `currentDocId`; "paper" →
   *  `currentPaperCitekey`; "library-outer" → `currentLibraryOuterId`
   *  (which is `OUTER_LIBRARY_ROOT_ID` for the pinned singleton). */
  activePane?: ActivePaneKind;
  /**
   * Ordered list of outer tab entries — interleaves docs and paper
   * outer tabs. Each entry is either a doc id (bare) or `paper:<citekey>`.
   * When undefined (legacy registries), the bar falls back to
   * `openTabIds` ordering with no paper tabs.
   */
  outerOrder?: string[];
  /** Citekey of the currently active paper outer tab, when
   *  `activePane === "paper"`. */
  currentPaperCitekey?: string | null;
  /** Library id of the currently active library outer tab, when
   *  `activePane === "library-outer"`. */
  currentLibraryOuterId?: string | null;
}

// Defaults are FACTORIES, never shared constants: callers mutate what a
// reader hands them (`idx.docs.push(…)`), so a module-level default would be
// silently edited in place and handed to the next caller.
const emptyIndex = (): FsaDocIndex => ({ docs: [] });
const emptyTabs = (): TabsState => ({
  openTabIds: [],
  currentDocId: null,
  activePane: "doc",
});

// --- Index ---------------------------------------------------------------

/** Fill in fields older rows predate. Mutates and returns `idx`. */
function normalizeIndex(idx: FsaDocIndex | undefined): FsaDocIndex {
  if (!idx) return emptyIndex();
  // Backfill lastAccessedAt for entries created before the field existed,
  // defaulting to lastModifiedAt so old papers still sort sensibly.
  for (const doc of idx.docs) {
    if (!doc.lastAccessedAt) doc.lastAccessedAt = doc.lastModifiedAt;
  }
  return idx;
}

/** A fresh snapshot of the index. Editing it changes nothing on disk —
 *  every change goes through `mutateIndex`. */
export async function readIndex(): Promise<FsaDocIndex> {
  return normalizeIndex(await get<FsaDocIndex>(INDEX_KEY, store));
}

/**
 * THE ONE MUTATION DOOR for the paper index (task 601).
 *
 * The index is a single IndexedDB value edited from many places — every
 * landed save bumps a timestamp, every open bumps an access time, and
 * create / register / rename / remove / the example seeder add or drop
 * rows. A hand-written `readIndex()` … `await` … `write` lets two of those
 * interleave (in one window or across windows) so the later write erases
 * the earlier one — a just-registered paper's row vanishes and every save
 * of it then throws "not in index".
 *
 * Here the read and the write run inside ONE readwrite IndexedDB
 * transaction (idb-keyval `update`), which IndexedDB serializes against
 * every other readwrite transaction on the store, in every tab. `fn`
 * therefore MUST be synchronous and must not await: it edits the index it
 * is handed in place and may return a value, which `mutateIndex` resolves
 * with. Async work (storing a folder handle, purging keys) goes OUTSIDE.
 *
 * `writeIndex` no longer exists; `doc-index-mutation-door.test.ts` holds
 * the census.
 */
export async function mutateIndex<R>(
  fn: (idx: FsaDocIndex) => R,
): Promise<R> {
  let result: R | undefined;
  await update<FsaDocIndex>(
    INDEX_KEY,
    (old) => {
      const idx = normalizeIndex(old);
      result = fn(idx);
      return idx;
    },
    store,
  );
  return result as R;
}

/** Bump `lastAccessedAt` to now for the given doc, if it exists in the index. */
export async function touchDocAccessed(id: string): Promise<void> {
  await mutateIndex((idx) => {
    const doc = idx.docs.find((d) => d.id === id);
    if (doc) doc.lastAccessedAt = new Date().toISOString();
  });
}

// --- My Papers (global curated list) ------------------------------------

/** User-curated list of papers added to the Library's "My Papers" pod.
 *  Global (shared across windows). Insertion order; set semantics on add. */
export interface MyPapersState {
  ids: string[];
}

export async function readMyPapers(): Promise<MyPapersState> {
  return (await get<MyPapersState>(MY_PAPERS_KEY, store)) ?? { ids: [] };
}

export async function writeMyPapers(state: MyPapersState): Promise<void> {
  await set(MY_PAPERS_KEY, state, store);
}

// --- Tabs ----------------------------------------------------------------

/** Per-window record of open tabs and the active pane. Keyed by the
 *  window's sessionStorage UUID (see `multi-window/window-id.ts`). */
export interface WindowsRegistry {
  [windowId: string]: {
    lastSeen: number;
    openTabIds: string[];
  };
}

export async function readTabs(windowId: string): Promise<TabsState> {
  // In dev-storage mode, auto-open the most recent local doc so the
  // editor renders without any user interaction. Per-window keys still
  // apply, but on first load we have nothing to read yet so the dev
  // bootstrap runs.
  if (isDevStorage) {
    const existing = await get<TabsState>(TABS_WINDOW_PREFIX + windowId, store);
    if (existing) return existing;
    try {
      const res = await fetch("/api/dev/index.json");
      const data = (await res.json()) as {
        docs: { id: string; lastModifiedAt: string; sourcePath: string }[];
      };
      const local = data.docs.filter((d) =>
        d.sourcePath.includes("virgil-data/"),
      );
      local.sort(
        (a, b) =>
          new Date(b.lastModifiedAt).getTime() -
          new Date(a.lastModifiedAt).getTime(),
      );
      for (const doc of local) {
        const texFile = doc.sourcePath.split("/").pop() ?? "document.tex";
        const probe = await fetch(`/api/dev/doc/${doc.id}/${texFile}`);
        if (probe.ok) {
          return { openTabIds: [doc.id], currentDocId: doc.id };
        }
      }
    } catch {
      // fall through to empty
    }
    return emptyTabs();
  }

  // Migration: if this window has no per-window record but the legacy
  // single-window `"tabs"` key exists, claim it for this window and
  // delete the legacy key. First-ever window after upgrade keeps its
  // tabs; subsequent new windows start empty as expected.
  const existing = await get<TabsState>(TABS_WINDOW_PREFIX + windowId, store);
  if (existing) return existing;
  const legacy = await get<TabsState>(TABS_KEY, store);
  if (legacy) {
    await set(TABS_WINDOW_PREFIX + windowId, legacy, store);
    await del(TABS_KEY, store);
    return legacy;
  }
  return emptyTabs();
}

export async function writeTabs(
  windowId: string,
  t: TabsState,
): Promise<void> {
  await set(TABS_WINDOW_PREFIX + windowId, t, store);
}

// --- Windows registry ---------------------------------------------------

export async function readWindowsRegistry(): Promise<WindowsRegistry> {
  return (await get<WindowsRegistry>(WINDOWS_REGISTRY_KEY, store)) ?? {};
}

// Shared by every window, so — like the paper index — each change is ONE
// readwrite transaction (`update`), never a read … await … write.

/** Stamp this window as alive in the registry with `now` and the
 *  current open tab ids. Called on mount and on a heartbeat. */
export async function touchWindow(
  windowId: string,
  openTabIds: string[],
): Promise<void> {
  await update<WindowsRegistry>(
    WINDOWS_REGISTRY_KEY,
    (reg = {}) => ({ ...reg, [windowId]: { lastSeen: Date.now(), openTabIds } }),
    store,
  );
}

/** Remove a window from the registry and drop its tabs record. Called
 *  on `pagehide` so a clean close doesn't leave orphan state. */
export async function forgetWindow(windowId: string): Promise<void> {
  await update<WindowsRegistry>(
    WINDOWS_REGISTRY_KEY,
    (reg = {}) => {
      const next = { ...reg };
      delete next[windowId];
      return next;
    },
    store,
  );
  await del(TABS_WINDOW_PREFIX + windowId, store);
}

// --- Per-doc folder handle ----------------------------------------------

export async function getDocHandle(
  id: string,
): Promise<FileSystemDirectoryHandle | undefined> {
  return get<FileSystemDirectoryHandle>(DOC_HANDLE_PREFIX + id, store);
}

export async function setDocHandle(
  id: string,
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  await set(DOC_HANDLE_PREFIX + id, handle, store);
}

export async function deleteDocHandle(id: string): Promise<void> {
  await del(DOC_HANDLE_PREFIX + id, store);
}

// --- Per-doc general-bibliography file handle (legacy) -------------------
// The "general bibliography" feature was a user-picked external .bib file
// per doc — superseded by the central Virgil Library (which IS the global
// bib). We keep `deleteGeneralBibHandle` so `purgeDoc` can still tidy up
// legacy IndexedDB rows from documents that pre-date the migration.

export async function deleteGeneralBibHandle(id: string): Promise<void> {
  await del(GENERAL_BIB_HANDLE_PREFIX + id, store);
}

// --- Cleanup -------------------------------------------------------------

/**
 * Remove every key associated with a doc id (handle, general-bib handle).
 * Called from `deleteDocFromIndex` in storage-fsa.
 */
export async function purgeDoc(id: string): Promise<void> {
  await Promise.all([deleteDocHandle(id), deleteGeneralBibHandle(id)]);
}

/**
 * For diagnostics / dev tools only — list every key in the store.
 */
export async function listAllKeys(): Promise<IDBValidKey[]> {
  return keys(store);
}
