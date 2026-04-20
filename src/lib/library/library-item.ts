/**
 * On-demand readers for per-item files inside a library folder.
 *
 * Each library item lives at `<libraryFolder>/<uuid>/` with:
 *   - source.pdf   (raw PDF; Virgil may eventually stream it)
 *   - meta.json    (richer metadata than the manifest row)
 *   - text.json    (paragraph-granular linearization)
 *   - status.json  (optional progress/error detail)
 *
 * Virgil reads these only when the detail pane is opened for an item.
 */

import type {
  LibraryItemMeta,
  LibraryItemStatusDetail,
  LibraryText,
} from "./library-types";

function isNotFound(e: unknown): boolean {
  return e instanceof DOMException && e.name === "NotFoundError";
}

async function getItemDir(
  library: FileSystemDirectoryHandle,
  itemId: string,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await library.getDirectoryHandle(itemId);
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

async function readJsonFile<T>(
  dir: FileSystemDirectoryHandle,
  filename: string,
): Promise<T | null> {
  try {
    const fh = await dir.getFileHandle(filename);
    const file = await fh.getFile();
    return JSON.parse(await file.text()) as T;
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

export async function readItemMeta(
  library: FileSystemDirectoryHandle,
  itemId: string,
): Promise<LibraryItemMeta | null> {
  const dir = await getItemDir(library, itemId);
  if (!dir) return null;
  return readJsonFile<LibraryItemMeta>(dir, "meta.json");
}

export async function readItemText(
  library: FileSystemDirectoryHandle,
  itemId: string,
): Promise<LibraryText | null> {
  const dir = await getItemDir(library, itemId);
  if (!dir) return null;
  return readJsonFile<LibraryText>(dir, "text.json");
}

export async function readItemStatusDetail(
  library: FileSystemDirectoryHandle,
  itemId: string,
): Promise<LibraryItemStatusDetail | null> {
  const dir = await getItemDir(library, itemId);
  if (!dir) return null;
  return readJsonFile<LibraryItemStatusDetail>(dir, "status.json");
}
