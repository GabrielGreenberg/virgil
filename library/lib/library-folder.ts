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

export type PickFolderResult =
  | { kind: "ok"; handle: FileSystemDirectoryHandle }
  | { kind: "cancelled" }
  | { kind: "locked"; message: string }
  | { kind: "error"; message: string };

/** Must be called from inside a user gesture (FSA spec). Returns a
 *  discriminated result so the caller can surface a "picker locked"
 *  state to the UI instead of silently no-op'ing on a stuck lock. */
export async function pickLibraryFolder(): Promise<PickFolderResult> {
  if (isDevStorage) {
    // No picker in dev mode — just hand back the synthetic root.
    return { kind: "ok", handle: devLibraryRootHandle() };
  }
  let handle: FileSystemDirectoryHandle;
  try {
    console.log("[library] pickLibraryFolder: calling showDirectoryPicker");
    handle = await window.showDirectoryPicker({ mode: "readwrite" });
    console.log("[library] pickLibraryFolder: picker resolved", { name: handle.name });
  } catch (err) {
    const name = (err as DOMException)?.name;
    const message = (err as Error)?.message ?? String(err);
    console.warn("[library] pickLibraryFolder: picker rejected", { name, message });
    if (name === "AbortError") return { kind: "cancelled" };
    if (name === "NotAllowedError") {
      return {
        kind: "locked",
        message:
          "The browser file picker is already active (or stuck from a previous attempt). " +
          "Dismiss any open file/save dialog, then try again. If nothing visible is open, fully quit and reopen the app window.",
      };
    }
    return { kind: "error", message };
  }
  await setLibraryHandle(handle);
  return { kind: "ok", handle };
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
