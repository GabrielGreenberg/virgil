/**
 * Reader for `library-index.json` — the single manifest file that Cowork
 * maintains in the library folder root and that Virgil polls.
 */

import type { LibraryManifest } from "./library-types";

const MANIFEST_FILENAME = "library-index.json";

function isNotFound(e: unknown): boolean {
  return e instanceof DOMException && e.name === "NotFoundError";
}

/** Empty-but-valid manifest returned when the file doesn't exist yet. */
const EMPTY_MANIFEST: LibraryManifest = { version: 1, items: [] };

/**
 * Read the manifest from the library folder. Returns an empty manifest if
 * Cowork hasn't written one yet or the file is unreadable.
 */
export async function readManifest(
  handle: FileSystemDirectoryHandle,
): Promise<LibraryManifest> {
  try {
    const fh = await handle.getFileHandle(MANIFEST_FILENAME);
    const file = await fh.getFile();
    const text = await file.text();
    const parsed = JSON.parse(text) as LibraryManifest;
    if (parsed && parsed.version === 1 && Array.isArray(parsed.items)) {
      return parsed;
    }
    return EMPTY_MANIFEST;
  } catch (e) {
    if (isNotFound(e)) return EMPTY_MANIFEST;
    // Any other error (parse failure, permission surprise) — return empty
    // rather than crashing the whole Library tab. The caller's status UI
    // can surface that the manifest is invalid.
    return EMPTY_MANIFEST;
  }
}
