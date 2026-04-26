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

import { get, set, del, keys, createStore } from "idb-keyval";

import { isDevStorage } from "@/lib/storage-mode";

const store = createStore("virgil", "kv");

const INDEX_KEY = "index";
const TABS_KEY = "tabs";
const DOC_HANDLE_PREFIX = "doc-handle/";
const GENERAL_BIB_HANDLE_PREFIX = "general-bib-handle/";

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
}

export interface FsaDocIndex {
  docs: FsaDocMeta[];
}

export type ActivePaneKind = "doc" | "library";

export interface TabsState {
  openTabIds: string[];
  currentDocId: string | null;
  /** Doc ids whose sibling library "shadow tab" is currently open in the
   *  tab strip. Persisted so reloads restore the paired pill. */
  libraryOpenFor?: string[];
  /** Which half of the current doc's pair is active: the doc itself or
   *  its library. Only meaningful when `currentDocId` has its library
   *  open (otherwise implicitly "doc"). */
  activePane?: ActivePaneKind;
}

const EMPTY_INDEX: FsaDocIndex = { docs: [] };
const EMPTY_TABS: TabsState = {
  openTabIds: [],
  currentDocId: null,
  libraryOpenFor: [],
  activePane: "doc",
};

// --- Index ---------------------------------------------------------------

export async function readIndex(): Promise<FsaDocIndex> {
  const idx = await get<FsaDocIndex>(INDEX_KEY, store);
  return idx ?? EMPTY_INDEX;
}

export async function writeIndex(idx: FsaDocIndex): Promise<void> {
  await set(INDEX_KEY, idx, store);
}

// --- Tabs ----------------------------------------------------------------

export async function readTabs(): Promise<TabsState> {
  // In dev-storage mode, auto-open the most recent local doc so the
  // editor renders without any user interaction.
  if (isDevStorage) {
    try {
      const res = await fetch("/api/dev/index.json");
      const data = (await res.json()) as {
        docs: { id: string; lastModifiedAt: string; sourcePath: string }[];
      };
      // Only consider docs that live inside virgil-data/
      const local = data.docs.filter((d) =>
        d.sourcePath.includes("virgil-data/"),
      );
      local.sort(
        (a, b) =>
          new Date(b.lastModifiedAt).getTime() -
          new Date(a.lastModifiedAt).getTime(),
      );
      // Pick the first doc whose .tex file actually exists on disk.
      for (const doc of local) {
        const texFile = doc.sourcePath.split("/").pop() ?? "document.tex";
        const folder = doc.sourcePath
          .slice(doc.sourcePath.indexOf("virgil-data/") + "virgil-data/".length)
          .split("/")[0];
        const probe = await fetch(`/api/dev/doc/${doc.id}/${texFile}`);
        if (probe.ok) {
          return { openTabIds: [doc.id], currentDocId: doc.id };
        }
      }
    } catch {
      // fall through to empty
    }
    return EMPTY_TABS;
  }
  const t = await get<TabsState>(TABS_KEY, store);
  return t ?? EMPTY_TABS;
}

export async function writeTabs(t: TabsState): Promise<void> {
  await set(TABS_KEY, t, store);
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

// --- Per-doc general-bibliography file handle ----------------------------

export async function getGeneralBibHandle(
  id: string,
): Promise<FileSystemFileHandle | undefined> {
  return get<FileSystemFileHandle>(GENERAL_BIB_HANDLE_PREFIX + id, store);
}

export async function setGeneralBibHandle(
  id: string,
  handle: FileSystemFileHandle,
): Promise<void> {
  await set(GENERAL_BIB_HANDLE_PREFIX + id, handle, store);
}

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
