/**
 * Lightweight PDF listing/copying at the root of the library folder.
 *
 * v1 sidesteps the Cowork manifest flow: PDFs land directly in
 * `<libraryFolder>/*.pdf` and the list view just iterates them. When
 * Cowork comes online later, its UUID subfolders coexist with these.
 */

export interface LibraryFile {
  name: string;
  handle: FileSystemFileHandle;
}

async function hasEntry(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<boolean> {
  for await (const entry of dir.values()) {
    if (entry.name === name) return true;
  }
  return false;
}

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

/** List every `.pdf` file at the root of the library folder, sorted by name. */
export async function listLibraryPdfs(
  library: FileSystemDirectoryHandle,
): Promise<LibraryFile[]> {
  const out: LibraryFile[] = [];
  for await (const entry of library.values()) {
    if (entry.kind !== "file") continue;
    if (!entry.name.toLowerCase().endsWith(".pdf")) continue;
    out.push({ name: entry.name, handle: entry as FileSystemFileHandle });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** Copy one File into the library folder root. Returns the final filename used. */
export async function copyPdfToLibrary(
  library: FileSystemDirectoryHandle,
  file: File,
): Promise<string> {
  const name = await uniquifyName(library, file.name);
  const fh = await library.getFileHandle(name, { create: true });
  const writable = await fh.createWritable();
  try {
    await writable.write(file);
  } finally {
    await writable.close();
  }
  return name;
}

/** Copy multiple files in sequence. Non-PDFs are silently skipped. */
export async function copyPdfsToLibrary(
  library: FileSystemDirectoryHandle,
  files: readonly File[],
): Promise<string[]> {
  const results: string[] = [];
  for (const f of files) {
    if (!f.name.toLowerCase().endsWith(".pdf")) continue;
    results.push(await copyPdfToLibrary(library, f));
  }
  return results;
}
