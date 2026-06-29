/**
 * OPFS-backed document-location primitive.
 *
 * Virgil documents are normally folders the user picked through the File
 * System Access API. This module instead mints / locates / wipes a
 * paper-folder-shaped directory inside the Origin Private File System
 * (OPFS) — a same-origin, permission-free, persistent store that needs no
 * picker and no `requestPermission` grant. The `FileSystemDirectoryHandle`
 * it returns is API-identical to a picker-derived one on the storage
 * layer's read/write hot path (`getFileHandle` / `getDirectoryHandle` /
 * `createWritable` / `removeEntry`), so once such a handle is registered
 * via `setDocHandle`, the storage core (`src/lib/storage-fsa.ts`) treats an
 * OPFS-backed doc exactly like any other — no special-casing.
 *
 * The example document is the first consumer; the seam generalizes to any
 * future client-only sandbox doc (and to browsers that lack
 * `showDirectoryPicker` but do support OPFS).
 */

/** Single OPFS subdirectory that holds every Virgil-managed sandbox doc. */
const OPFS_DOCS_ROOT = "virgil-docs";

/** True when OPFS is reachable in this browser/context. */
export function opfsAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.storage &&
    typeof navigator.storage.getDirectory === "function"
  );
}

async function opfsDocsRoot(create: boolean): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(OPFS_DOCS_ROOT, { create });
}

/**
 * Get the OPFS directory handle for a sandbox doc by folder name. With
 * `{ create: true }` it (and the shared `virgil-docs` root) are created if
 * absent. The returned handle is suitable for `setDocHandle`.
 */
export async function getOpfsDocDir(
  folderName: string,
  opts: { create?: boolean } = {},
): Promise<FileSystemDirectoryHandle> {
  const create = opts.create ?? false;
  const docsRoot = await opfsDocsRoot(create);
  return docsRoot.getDirectoryHandle(folderName, { create });
}

/** Recursively wipe a sandbox doc's OPFS directory. Tolerant of an already
 *  missing root/child (a wipe of nothing is success). */
export async function removeOpfsDocDir(folderName: string): Promise<void> {
  let docsRoot: FileSystemDirectoryHandle;
  try {
    docsRoot = await opfsDocsRoot(false);
  } catch {
    return; // no root → nothing to remove
  }
  try {
    await docsRoot.removeEntry(folderName, { recursive: true });
  } catch (e) {
    if (e instanceof DOMException && e.name === "NotFoundError") return;
    throw e;
  }
}

export interface SeedFile {
  /** Path relative to the doc dir root, e.g. "figures/x.png" or "virgil/notes.json". */
  path: string;
  /** UTF-8 text payload (for `.tex`/`.bib`/`.json`). */
  text?: string;
  /** Binary payload (for figures). Takes precedence over `text` when both set. */
  bytes?: ArrayBuffer;
}

/**
 * Write a tree of files into an OPFS directory handle, creating any
 * intermediate subdirectories per path segment. Uses the same
 * `createWritable → write → close` idiom as `writeTextToHandle`
 * (storage-fsa.ts:168-175); deliberately re-implemented here so the
 * dependency arrow points INTO storage, never out of it.
 */
export async function writeTreeIntoDir(
  dir: FileSystemDirectoryHandle,
  files: SeedFile[],
): Promise<void> {
  for (const file of files) {
    const segments = file.path.split("/").filter(Boolean);
    const filename = segments.pop();
    if (!filename) continue;
    let cursor = dir;
    for (const seg of segments) {
      cursor = await cursor.getDirectoryHandle(seg, { create: true });
    }
    const fh = await cursor.getFileHandle(filename, { create: true });
    const writable = await fh.createWritable();
    try {
      await writable.write(file.bytes ?? file.text ?? "");
    } finally {
      await writable.close();
    }
  }
}
