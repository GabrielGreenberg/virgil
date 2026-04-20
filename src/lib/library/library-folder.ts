/**
 * Global library folder: picker + IndexedDB persistence.
 *
 * One folder, shared across every document in Virgil. The handle is stored
 * once under a single key (no per-doc suffix). Mirrors the per-doc folder
 * pattern in src/lib/storage-fsa.ts but at global scope.
 */

import { get, set, del, createStore } from "idb-keyval";

// Reuse the same IndexedDB database/store as doc-index.ts so everything
// Virgil persists lives in one place ("virgil" DB, "kv" object store).
const store = createStore("virgil", "kv");

const LIBRARY_HANDLE_KEY = "library-folder-handle";

export async function getLibraryHandle(): Promise<
  FileSystemDirectoryHandle | undefined
> {
  return get<FileSystemDirectoryHandle>(LIBRARY_HANDLE_KEY, store);
}

export async function setLibraryHandle(
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  await set(LIBRARY_HANDLE_KEY, handle, store);
}

export async function clearLibraryHandle(): Promise<void> {
  await del(LIBRARY_HANDLE_KEY, store);
}

/**
 * Prompt the user to pick a library folder and persist the handle.
 * Must be called from inside a user gesture (FSA requires it).
 */
export async function pickLibraryFolder(): Promise<FileSystemDirectoryHandle> {
  const handle = await window.showDirectoryPicker({ mode: "readwrite" });
  await setLibraryHandle(handle);
  return handle;
}
