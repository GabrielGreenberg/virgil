// FSA boundary for the library folder. Every disk read/write goes through
// this module — no other code touches `FileSystemDirectoryHandle` directly.
//
// Mirrors the boundary pattern in
// /Users/gabriel/Programming/virgil/src/lib/storage-fsa.ts but scoped to
// the library's directory shape (catalog.json + master.bib + papers/ + pdfs/
// + queue/ + notifications/ + logs/).

export const ROOT_FILES = {
  catalog: "catalog.json",
  catalogVersion: "catalog-version.txt",
  masterBib: "master.bib",
} as const;

export const SUBDIRS = {
  pdfs: "pdfs",
  unsorted: "unsorted", // under pdfs/
  papers: "papers",
  queue: "queue",
  notifications: "notifications",
  logs: "logs",
} as const;

// ---------------------------------------------------------------------------
// Directory helpers
// ---------------------------------------------------------------------------

async function getDir(
  root: FileSystemDirectoryHandle,
  name: string,
  create = false,
): Promise<FileSystemDirectoryHandle> {
  return root.getDirectoryHandle(name, { create });
}

/** Get a subdirectory, creating it if missing. Used on writes. */
async function ensureDir(
  root: FileSystemDirectoryHandle,
  name: string,
): Promise<FileSystemDirectoryHandle> {
  return root.getDirectoryHandle(name, { create: true });
}

async function tryGetFile(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<FileSystemFileHandle | undefined> {
  try {
    return await dir.getFileHandle(name);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function readTextFile(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<string | undefined> {
  const parts = path.split("/").filter(Boolean);
  let cur: FileSystemDirectoryHandle = root;
  for (let i = 0; i < parts.length - 1; i++) {
    try {
      cur = await getDir(cur, parts[i]);
    } catch {
      return undefined;
    }
  }
  const fh = await tryGetFile(cur, parts[parts.length - 1]);
  if (!fh) return undefined;
  const file = await fh.getFile();
  return file.text();
}

export async function readJsonFile<T>(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<T | undefined> {
  const text = await readTextFile(root, path);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/** Read a file as a `File` (Blob) — needed for binary content like PDFs
 *  where consumers want `URL.createObjectURL(file)`. Returns undefined if
 *  the file or any parent directory is missing. */
export async function readFile(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<File | undefined> {
  const parts = path.split("/").filter(Boolean);
  let cur: FileSystemDirectoryHandle = root;
  for (let i = 0; i < parts.length - 1; i++) {
    try {
      cur = await getDir(cur, parts[i]);
    } catch {
      return undefined;
    }
  }
  const fh = await tryGetFile(cur, parts[parts.length - 1]);
  if (!fh) return undefined;
  return fh.getFile();
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function writeFileAt(
  root: FileSystemDirectoryHandle,
  path: string,
  data: string | Blob,
): Promise<void> {
  const parts = path.split("/").filter(Boolean);
  let cur: FileSystemDirectoryHandle = root;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = await ensureDir(cur, parts[i]);
  }
  const fh = await cur.getFileHandle(parts[parts.length - 1], { create: true });
  const writable = await fh.createWritable();
  await writable.write(data);
  await writable.close();
}

export async function writeTextFile(
  root: FileSystemDirectoryHandle,
  path: string,
  text: string,
): Promise<void> {
  return writeFileAt(root, path, text);
}

export async function writeBinaryFile(
  root: FileSystemDirectoryHandle,
  path: string,
  data: Blob,
): Promise<void> {
  return writeFileAt(root, path, data);
}

export async function writeJsonFile(
  root: FileSystemDirectoryHandle,
  path: string,
  value: unknown,
): Promise<void> {
  return writeTextFile(root, path, JSON.stringify(value, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export async function listDir(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<{ name: string; kind: "file" | "directory" }[] | undefined> {
  const parts = path.split("/").filter(Boolean);
  let cur: FileSystemDirectoryHandle = root;
  for (const p of parts) {
    try {
      cur = await getDir(cur, p);
    } catch {
      return undefined;
    }
  }
  const out: { name: string; kind: "file" | "directory" }[] = [];
  for await (const [name, handle] of cur.entries()) {
    out.push({ name, kind: handle.kind });
  }
  return out;
}

/** Delete a file. No-op if it doesn't exist. Callers can invoke this
 *  idempotently — e.g. to cancel a queue entry that may have been
 *  drained between the user's first and second click. */
export async function deleteFile(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<void> {
  const parts = path.split("/").filter(Boolean);
  let cur: FileSystemDirectoryHandle = root;
  for (let i = 0; i < parts.length - 1; i++) {
    try {
      cur = await getDir(cur, parts[i]);
    } catch {
      return;
    }
  }
  try {
    await cur.removeEntry(parts[parts.length - 1]);
  } catch {
    // Missing or platform refused — treat as no-op.
  }
}

export async function fileExists(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<boolean> {
  const parts = path.split("/").filter(Boolean);
  let cur: FileSystemDirectoryHandle = root;
  for (let i = 0; i < parts.length - 1; i++) {
    try {
      cur = await getDir(cur, parts[i]);
    } catch {
      return false;
    }
  }
  return !!(await tryGetFile(cur, parts[parts.length - 1]));
}

// ---------------------------------------------------------------------------
// Bootstrapping a freshly-picked library folder
// ---------------------------------------------------------------------------

/** Create the standard subdirectories and seed empty catalog/master.bib if
 *  the folder is brand new. Idempotent. */
export async function ensureLibraryStructure(
  root: FileSystemDirectoryHandle,
): Promise<void> {
  await ensureDir(root, SUBDIRS.pdfs);
  const pdfs = await ensureDir(root, SUBDIRS.pdfs);
  await pdfs.getDirectoryHandle(SUBDIRS.unsorted, { create: true });
  await ensureDir(root, SUBDIRS.papers);
  await ensureDir(root, SUBDIRS.queue);
  await ensureDir(root, SUBDIRS.notifications);
  await ensureDir(root, SUBDIRS.logs);

  // Seed catalog.json if absent.
  if (!(await fileExists(root, ROOT_FILES.catalog))) {
    await writeJsonFile(root, ROOT_FILES.catalog, {
      version: 1,
      generatedAt: new Date().toISOString(),
      entries: [],
    });
  }
  // Seed catalog-version.txt if absent.
  if (!(await fileExists(root, ROOT_FILES.catalogVersion))) {
    await writeTextFile(root, ROOT_FILES.catalogVersion, "1");
  }
  // Seed master.bib if absent.
  if (!(await fileExists(root, ROOT_FILES.masterBib))) {
    await writeTextFile(
      root,
      ROOT_FILES.masterBib,
      "% Virgil Library — master bibliography\n",
    );
  }
  // Seed notifications/inbox.json if absent.
  if (!(await fileExists(root, "notifications/inbox.json"))) {
    await writeJsonFile(root, "notifications/inbox.json", { items: [] });
  }
}
