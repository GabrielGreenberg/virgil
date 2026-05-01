// Library folder: FSA picker + IndexedDB persistence.
// Uses Virgil's shared "virgil" IDB store so the handle is consolidated
// with the rest of the app's persistence (and inherits any v1 handle).
//
// Dev mode: when isDevStorage is true (e.g. in the Claude Preview iframe
// where showDirectoryPicker is unavailable), getLibraryHandle returns a
// synthetic handle backed by /api/dev-library/, which serves files from
// `library-data/` on disk. The picker UI is bypassed and permission
// checks always succeed — see useLibraryHandle.ts for the wiring.

import { get, set, del, createStore } from "idb-keyval";
import { isDevStorage } from "@/lib/storage-mode";
import { devLibraryRootHandle } from "./dev-fsa";

const store = createStore("virgil", "kv");
const HANDLE_KEY = "library-folder-handle";

export async function getLibraryHandle(): Promise<
  FileSystemDirectoryHandle | undefined
> {
  if (isDevStorage) return devLibraryRootHandle();
  return get<FileSystemDirectoryHandle>(HANDLE_KEY, store);
}

export async function setLibraryHandle(
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  await set(HANDLE_KEY, handle, store);
}

export async function clearLibraryHandle(): Promise<void> {
  await del(HANDLE_KEY, store);
}

/** Must be called from inside a user gesture (FSA spec). */
export async function pickLibraryFolder(): Promise<FileSystemDirectoryHandle> {
  if (isDevStorage) {
    // No picker in dev mode — just hand back the synthetic root.
    return devLibraryRootHandle();
  }
  const handle = await window.showDirectoryPicker({ mode: "readwrite" });
  await setLibraryHandle(handle);
  return handle;
}

/** Query and request FSA permission for a stored handle. */
export async function ensureReadWritePermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState> {
  if (isDevStorage) return "granted";
  const opts = { mode: "readwrite" as const };
  let state = await handle.queryPermission(opts);
  if (state === "granted") return state;
  state = await handle.requestPermission(opts);
  return state;
}

export async function queryReadWritePermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState> {
  if (isDevStorage) return "granted";
  return handle.queryPermission({ mode: "readwrite" });
}
