/**
 * "Add PDF" → copy user-selected PDF(s) into the library's inbox/ subdir.
 *
 * Virgil doesn't process the PDF — Cowork watches the inbox, moves the
 * file under its UUID, runs extraction, and updates the manifest.
 */

const INBOX_DIRNAME = "inbox";

/** Create (or get) the inbox subdirectory under the library folder. */
async function getInboxDir(
  library: FileSystemDirectoryHandle,
): Promise<FileSystemDirectoryHandle> {
  return library.getDirectoryHandle(INBOX_DIRNAME, { create: true });
}

/** True if `dir` already contains an entry with this exact name. */
async function hasEntry(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<boolean> {
  for await (const entry of dir.values()) {
    if (entry.name === name) return true;
  }
  return false;
}

/** Return a filename that doesn't yet exist in `dir`. Collisions get a
 *  short timestamp suffix so we never silently overwrite a file. */
async function uniquifyName(
  dir: FileSystemDirectoryHandle,
  desired: string,
): Promise<string> {
  if (!(await hasEntry(dir, desired))) return desired;
  const dot = desired.lastIndexOf(".");
  const stem = dot > 0 ? desired.slice(0, dot) : desired;
  const ext = dot > 0 ? desired.slice(dot) : "";
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  return `${stem}-${stamp}${ext}`;
}

/** Copy one File into the library's inbox. Returns the final filename used. */
export async function copyToInbox(
  library: FileSystemDirectoryHandle,
  file: File,
): Promise<string> {
  const inbox = await getInboxDir(library);
  const name = await uniquifyName(inbox, file.name);
  const fh = await inbox.getFileHandle(name, { create: true });
  const writable = await fh.createWritable();
  try {
    await writable.write(file);
  } finally {
    await writable.close();
  }
  return name;
}

/** Copy multiple files in sequence. */
export async function copyAllToInbox(
  library: FileSystemDirectoryHandle,
  files: readonly File[],
): Promise<string[]> {
  const results: string[] = [];
  for (const f of files) {
    results.push(await copyToInbox(library, f));
  }
  return results;
}
