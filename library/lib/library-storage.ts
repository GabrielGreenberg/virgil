// FSA boundary for the library folder. Every disk read/write goes through
// this module — no other code touches `FileSystemDirectoryHandle` directly.
//
// Layout (user-facing tidiness):
//   master.bib                        — bibliography (visible at root)
//   unsorted/                         — pre-triage inbox (visible at root)
//   papers/<citekey>/                 — one folder per paper (visible at root)
//   .claude/CLAUDE.md                 — workspace guide (auto-loaded by Claude Code)
//   .claude/commands/library/*.md     — slash commands
//   .virgil/                          — all other runtime/infra state, hidden:
//     catalog.json, catalog-version.txt, queue/, notifications/, logs/,
//     scripts/, memos/, .skill-bundle-version.json
//
// The user only sees `master.bib`, `papers/`, `unsorted/` when browsing the
// library folder in Finder. Everything else is tucked away in dot-folders.

export const VIRGIL_DIR = ".virgil";
export const CLAUDE_DIR = ".claude";

export const ROOT_FILES = {
  catalog: `${VIRGIL_DIR}/catalog.json`,
  catalogVersion: `${VIRGIL_DIR}/catalog-version.txt`,
  masterBib: "master.bib",
  // Slim, skill-emitted projection of master.bib for the browse path — read
  // INSTEAD of parsing master.bib with citation-js (see library/lib/bib-index.ts
  // and library/scripts/build_bib_index.py). The `.stamp` is a tiny
  // change-signal file polled cheaply so we re-read the big index only when
  // master.bib actually changed.
  bibIndex: `${VIRGIL_DIR}/bib-index.json`,
  bibIndexStamp: `${VIRGIL_DIR}/bib-index.stamp`,
} as const;

export const SUBDIRS = {
  unsorted: "unsorted", // top-level inbox for files awaiting a citekey
  papers: "papers",
  queue: `${VIRGIL_DIR}/queue`,
  notifications: `${VIRGIL_DIR}/notifications`,
  logs: `${VIRGIL_DIR}/logs`,
  memos: `${VIRGIL_DIR}/memos`,
  scripts: `${VIRGIL_DIR}/scripts`,
  libraries: `${VIRGIL_DIR}/libraries`,
} as const;

/**
 * On-disk manifest for a custom library. Stored at
 * `.virgil/libraries/<slug>.json`, with `<slug>` derived from `label`
 * (and dedupe-suffixed on collision). The frontend is the sole writer;
 * skills may read these files but never mutate them. `master.bib`
 * remains the canonical source of entry data — `citekeys` here just
 * names the membership.
 */
export interface LibraryManifest {
  schemaVersion: 1;
  /** Stable id, kept across renames. localStorage panel-tabs state and
   *  every in-memory consumer key off this id, not the filename. */
  id: string;
  label: string;
  /** Epoch ms. Set on creation; never overwritten thereafter. */
  createdAt: number;
  /** Epoch ms. Bumped on every write so cross-window pollers can
   *  detect a stale local cache. */
  updatedAt: number;
  /** Membership. Each value is either a citekey (resolves against
   *  master.bib) or `__triage__<filename>` for unsorted-file refs. */
  citekeys: string[];
  pinned?: boolean;
  /** Filename of the source `.bib` in `unsorted/` when this library
   *  was created via "+ Add from .bib". Cleared once the source file
   *  is gone (the triage skill deletes it after merging entries into
   *  master.bib). */
  sourceBibFile?: string;
}

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
// File picker (system "Open File" dialog)
// ---------------------------------------------------------------------------

/**
 * Show the system file-open dialog for a single `.bib` file and return its
 * filename + text contents. Returns `null` if the user cancels, the
 * environment lacks `showOpenFilePicker` (non-Chromium browsers, SSR), or
 * Chrome's per-origin picker lock is stuck (a stranded picker from a
 * prior page state). The caller treats null as "no-op" — never crash.
 *
 * Must be called from inside a user gesture (click handler).
 */
export async function pickBibFile(): Promise<{ filename: string; text: string } | null> {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    showOpenFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle[]>;
  };
  if (typeof w.showOpenFilePicker !== "function") return null;
  try {
    const [handle] = await w.showOpenFilePicker({
      multiple: false,
      types: [
        {
          description: "BibTeX file",
          accept: { "text/x-bibtex": [".bib"], "application/x-bibtex": [".bib"] },
        },
      ],
      excludeAcceptAllOption: false,
    });
    if (!handle) return null;
    const file = await handle.getFile();
    return { filename: handle.name, text: await file.text() };
  } catch (err) {
    const name = (err as DOMException)?.name;
    // AbortError — user cancelled. NotAllowedError — Chrome's "file
    // picker already active" lock; surfacing it as an unhandled
    // rejection would crash the React tree, so we log + return null
    // and let the caller no-op. The user can usually recover by
    // dismissing the orphaned picker (or reloading).
    if (name === "AbortError" || name === "NotAllowedError") {
      if (name === "NotAllowedError") {
        console.warn(
          "[library] pickBibFile: file picker already active — dismiss any open browser file dialog (or reload) and try again",
        );
      }
      return null;
    }
    throw err;
  }
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
// Custom library manifests (.virgil/libraries/<slug>.json)
// ---------------------------------------------------------------------------

/** Create the libraries directory if missing. Called from
 *  `ensureLibraryStructure`; safe to call repeatedly. */
export async function ensureLibrariesDir(
  root: FileSystemDirectoryHandle,
): Promise<FileSystemDirectoryHandle> {
  return ensureNestedDir(root, SUBDIRS.libraries);
}

/** List every `<slug>.json` manifest in `.virgil/libraries/` along
 *  with its parsed contents. Hidden files (starting with `.`) are
 *  skipped — that's how the migration sentinel `.migrated` is
 *  excluded. Files that fail to parse are reported via console.warn
 *  and skipped (so a single corrupt file doesn't block the rest). */
export async function listLibraryManifests(
  root: FileSystemDirectoryHandle,
): Promise<{ filename: string; manifest: LibraryManifest }[]> {
  const entries = await listDir(root, SUBDIRS.libraries);
  if (!entries) return [];
  const out: { filename: string; manifest: LibraryManifest }[] = [];
  for (const e of entries) {
    if (e.kind !== "file") continue;
    if (e.name.startsWith(".")) continue;
    if (!e.name.toLowerCase().endsWith(".json")) continue;
    const manifest = await readLibraryManifest(root, e.name);
    if (!manifest) continue;
    out.push({ filename: e.name, manifest });
  }
  return out;
}

export async function readLibraryManifest(
  root: FileSystemDirectoryHandle,
  filename: string,
): Promise<LibraryManifest | undefined> {
  const text = await readTextFile(root, `${SUBDIRS.libraries}/${filename}`);
  if (text === undefined) return undefined;
  try {
    const parsed = JSON.parse(text) as Partial<LibraryManifest>;
    if (
      typeof parsed?.id !== "string" ||
      typeof parsed?.label !== "string" ||
      !Array.isArray(parsed?.citekeys)
    ) {
      console.warn(
        `[library] readLibraryManifest: malformed manifest at ${SUBDIRS.libraries}/${filename}`,
      );
      return undefined;
    }
    // Normalise the few optional fields so consumers don't have to.
    return {
      schemaVersion: 1,
      id: parsed.id,
      label: parsed.label,
      createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : 0,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
      citekeys: parsed.citekeys.filter(
        (k): k is string => typeof k === "string",
      ),
      pinned: parsed.pinned === true ? true : undefined,
      sourceBibFile:
        typeof parsed.sourceBibFile === "string"
          ? parsed.sourceBibFile
          : undefined,
    };
  } catch (err) {
    console.warn(
      `[library] readLibraryManifest: parse failed for ${SUBDIRS.libraries}/${filename}`,
      err,
    );
    return undefined;
  }
}

/** Write a manifest at `.virgil/libraries/<filename>`. The platform's
 *  `createWritable` → `write` → `close` semantics make this atomic on
 *  Chromium FSA; consumers can rely on never seeing a partial write. */
export async function writeLibraryManifest(
  root: FileSystemDirectoryHandle,
  filename: string,
  manifest: LibraryManifest,
): Promise<void> {
  await writeJsonFile(root, `${SUBDIRS.libraries}/${filename}`, manifest);
}

export async function deleteLibraryManifest(
  root: FileSystemDirectoryHandle,
  filename: string,
): Promise<void> {
  await deleteFile(root, `${SUBDIRS.libraries}/${filename}`);
}

/** Rename a manifest file. FSA has no native rename, so this is a
 *  read → write-new → delete-old sequence. Returns silently if
 *  `oldFilename` is missing or `oldFilename === newFilename`. */
export async function renameLibraryManifest(
  root: FileSystemDirectoryHandle,
  oldFilename: string,
  newFilename: string,
): Promise<void> {
  if (!oldFilename || !newFilename || oldFilename === newFilename) return;
  const manifest = await readLibraryManifest(root, oldFilename);
  if (!manifest) return;
  await writeLibraryManifest(root, newFilename, manifest);
  await deleteLibraryManifest(root, oldFilename);
}

// ---------------------------------------------------------------------------
// Bootstrapping a freshly-picked library folder
// ---------------------------------------------------------------------------

/** Create the standard subdirectories and seed empty catalog/master.bib if
 *  the folder is brand new. Idempotent. Also runs migrations to consolidate
 *  source files into papers/<citekey>/ and tuck infra into .virgil/ + .claude/. */
export async function ensureLibraryStructure(
  root: FileSystemDirectoryHandle,
): Promise<void> {
  try {
    await migrateLayoutIfNeeded(root);
  } catch (err) {
    // A migration failure must not gate library load. Log and continue —
    // unmigrated entries stay readable from their old locations until the
    // next attempt clears the blocker.
    // eslint-disable-next-line no-console
    console.warn("[library] layout migration failed; continuing", err);
  }
  await ensureDir(root, SUBDIRS.papers);
  await ensureDir(root, SUBDIRS.unsorted);
  // Bootstrap .virgil/ and its children.
  await ensureDir(root, VIRGIL_DIR);
  await ensureNestedDir(root, SUBDIRS.queue);
  await ensureNestedDir(root, SUBDIRS.notifications);
  await ensureNestedDir(root, SUBDIRS.logs);
  await ensureNestedDir(root, SUBDIRS.memos);
  await ensureNestedDir(root, SUBDIRS.libraries);
  // Bootstrap .claude/ for skill commands. The workspace CLAUDE.md is
  // written by skill-sync; we just create the parent.
  await ensureDir(root, CLAUDE_DIR);

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
  const inboxPath = `${SUBDIRS.notifications}/inbox.json`;
  if (!(await fileExists(root, inboxPath))) {
    await writeJsonFile(root, inboxPath, { items: [] });
  }
}

/** Create a multi-segment subdirectory like ".virgil/queue", recursing
 *  through every parent. Idempotent. */
async function ensureNestedDir(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<FileSystemDirectoryHandle> {
  const parts = path.split("/").filter(Boolean);
  let cur: FileSystemDirectoryHandle = root;
  for (const p of parts) {
    cur = await cur.getDirectoryHandle(p, { create: true });
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Layout migration: pdfs/ → papers/<citekey>/<citekey>.<ext> + unsorted/
// ---------------------------------------------------------------------------

async function moveFile(
  src: FileSystemDirectoryHandle,
  srcName: string,
  dst: FileSystemDirectoryHandle,
  dstName: string,
): Promise<void> {
  const fh = await src.getFileHandle(srcName);
  const file = await fh.getFile();
  const outFh = await dst.getFileHandle(dstName, { create: true });
  const writable = await outFh.createWritable();
  await writable.write(file);
  await writable.close();
  try {
    await src.removeEntry(srcName);
  } catch {
    // Best effort — the copy succeeded; leave the original if removal fails.
  }
}

/** Two idempotent migrations, run in order:
 *  1. `pdfs/<citekey>.{pdf,docx}` + `pdfs/unsorted/` → `papers/<citekey>/<citekey>.<ext>` + top-level `unsorted/`
 *  2. Root infra files/folders → `.virgil/` (and `CLAUDE.md` → `.claude/CLAUDE.md`)
 *  Either step is a no-op if its source state isn't present. */
export async function migrateLayoutIfNeeded(
  root: FileSystemDirectoryHandle,
): Promise<void> {
  await migratePdfsIntoPapersIfNeeded(root);
  await migrateRootIntoVirgilIfNeeded(root);
}

async function migratePdfsIntoPapersIfNeeded(
  root: FileSystemDirectoryHandle,
): Promise<void> {
  let pdfsDir: FileSystemDirectoryHandle;
  try {
    pdfsDir = await root.getDirectoryHandle("pdfs");
  } catch {
    return; // Already migrated or never existed.
  }

  const papersDir = await ensureDir(root, SUBDIRS.papers);
  const unsortedDir = await ensureDir(root, SUBDIRS.unsorted);

  // Snapshot entries first; mutating during async iteration is unreliable.
  const entries: { name: string; kind: "file" | "directory" }[] = [];
  for await (const [name, h] of pdfsDir.entries()) {
    entries.push({ name, kind: h.kind });
  }

  for (const e of entries) {
    try {
      if (e.kind === "file") {
        const m = /^(.+)\.(pdf|docx)$/i.exec(e.name);
        if (!m) continue;
        const citekey = m[1];
        const ext = m[2].toLowerCase();
        const paperDir = await papersDir.getDirectoryHandle(citekey, { create: true });
        await moveFile(pdfsDir, e.name, paperDir, `${citekey}.${ext}`);
      } else if (e.kind === "directory" && e.name === "unsorted") {
        const oldUnsorted = await pdfsDir.getDirectoryHandle("unsorted");
        const childEntries: { name: string; kind: "file" | "directory" }[] = [];
        for await (const [n, h] of oldUnsorted.entries()) {
          childEntries.push({ name: n, kind: h.kind });
        }
        for (const c of childEntries) {
          try {
            if (c.kind === "file") {
              await moveFile(oldUnsorted, c.name, unsortedDir, c.name);
            } else if (c.kind === "directory" && c.name === "_pending") {
              const oldPending = await oldUnsorted.getDirectoryHandle("_pending");
              const dstPending = await unsortedDir.getDirectoryHandle("_pending", {
                create: true,
              });
              const pendingEntries: { name: string; kind: "file" | "directory" }[] = [];
              for await (const [n, h] of oldPending.entries()) {
                pendingEntries.push({ name: n, kind: h.kind });
              }
              for (const p of pendingEntries) {
                if (p.kind === "file") {
                  try {
                    await moveFile(oldPending, p.name, dstPending, p.name);
                  } catch (err) {
                    // eslint-disable-next-line no-console
                    console.warn(`[library] migrate: failed to move pdfs/unsorted/_pending/${p.name}`, err);
                  }
                }
              }
              try {
                await oldUnsorted.removeEntry("_pending");
              } catch {
                // Leave behind if non-empty or platform refuses.
              }
            }
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(`[library] migrate: failed to move pdfs/unsorted/${c.name}`, err);
          }
        }
        try {
          await pdfsDir.removeEntry("unsorted");
        } catch {
          // Leave behind if non-empty or platform refuses.
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[library] migrate: failed on pdfs/${e.name}`, err);
    }
  }

  // Try to remove the now-empty pdfs/ folder. Some FSA implementations don't
  // support `recursive: true`; if removal fails, the empty directory is
  // harmless — no read paths point at it post-migration.
  try {
    await root.removeEntry("pdfs", { recursive: true });
  } catch {
    try {
      await root.removeEntry("pdfs");
    } catch {
      // Leave behind.
    }
  }

  // Bump catalog-version.txt so the UI re-reads after migration.
  // Use the legacy path here because catalog-version.txt may not yet have
  // been moved to .virgil/ — the root-tidy migration runs separately.
  const legacyCatalogVersion = "catalog-version.txt";
  const newCatalogVersion = ROOT_FILES.catalogVersion;
  const cur =
    (await readTextFile(root, legacyCatalogVersion))?.trim() ??
    (await readTextFile(root, newCatalogVersion))?.trim();
  const next = String((parseInt(cur ?? "0", 10) || 0) + 1);
  // Write to whichever location currently exists; the root-tidy pass below
  // will move it to .virgil/ if it's still at the root.
  if (await fileExists(root, legacyCatalogVersion)) {
    await writeTextFile(root, legacyCatalogVersion, next);
  } else {
    await writeTextFile(root, newCatalogVersion, next);
  }
}

// ---------------------------------------------------------------------------
// Root-cleanup migration: tuck infra files/folders into .virgil/ + .claude/
// ---------------------------------------------------------------------------

/** Recursively copy the contents of `src` into `dst`, then remove `src`.
 *  Best-effort: if any single child fails, the failure is logged but other
 *  children continue. Idempotent: re-running over a partially-moved dir
 *  resumes where it left off. */
async function moveDir(
  parentSrc: FileSystemDirectoryHandle,
  srcName: string,
  parentDst: FileSystemDirectoryHandle,
  dstName: string,
): Promise<void> {
  let src: FileSystemDirectoryHandle;
  try {
    src = await parentSrc.getDirectoryHandle(srcName);
  } catch {
    return; // Source doesn't exist — nothing to move.
  }
  const dst = await parentDst.getDirectoryHandle(dstName, { create: true });
  const entries: { name: string; kind: "file" | "directory" }[] = [];
  for await (const [name, h] of src.entries()) {
    entries.push({ name, kind: h.kind });
  }
  for (const e of entries) {
    try {
      if (e.kind === "file") {
        await moveFile(src, e.name, dst, e.name);
      } else {
        await moveDir(src, e.name, dst, e.name);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[library] moveDir: failed on ${srcName}/${e.name}`, err);
    }
  }
  // Remove the now-empty source. Try recursive first in case macOS left a
  // .DS_Store behind that we don't want to surface again.
  try {
    await parentSrc.removeEntry(srcName, { recursive: true });
  } catch {
    try {
      await parentSrc.removeEntry(srcName);
    } catch {
      // Leave behind if non-empty or platform refuses.
    }
  }
}

/** Tuck all non-user-facing files and folders at the library root into
 *  `.virgil/` (or `.claude/` for CLAUDE.md). Runs idempotently — any source
 *  that's already absent is a no-op. */
async function migrateRootIntoVirgilIfNeeded(
  root: FileSystemDirectoryHandle,
): Promise<void> {
  const virgilDir = await ensureNestedDir(root, VIRGIL_DIR);
  const claudeDir = await ensureNestedDir(root, CLAUDE_DIR);

  // Files that move into .virgil/ at the root.
  const fileMoves: { src: string; dst: FileSystemDirectoryHandle; dstName: string }[] = [
    { src: "catalog.json", dst: virgilDir, dstName: "catalog.json" },
    { src: "catalog-version.txt", dst: virgilDir, dstName: "catalog-version.txt" },
    { src: ".skill-bundle-version.json", dst: virgilDir, dstName: ".skill-bundle-version.json" },
    { src: "CLAUDE.md", dst: claudeDir, dstName: "CLAUDE.md" },
  ];
  for (const m of fileMoves) {
    try {
      // Only move if the source exists at the root.
      let exists = false;
      try {
        await root.getFileHandle(m.src);
        exists = true;
      } catch {
        // Not present.
      }
      if (!exists) continue;
      await moveFile(root, m.src, m.dst, m.dstName);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[library] migrate-root: failed on file ${m.src}`, err);
    }
  }

  // Directories that move wholesale into .virgil/.
  const dirMoves: { src: string; dstName: string }[] = [
    { src: "queue", dstName: "queue" },
    { src: "notifications", dstName: "notifications" },
    { src: "logs", dstName: "logs" },
    { src: "scripts", dstName: "scripts" },
  ];
  for (const m of dirMoves) {
    try {
      await moveDir(root, m.src, virgilDir, m.dstName);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[library] migrate-root: failed on dir ${m.src}`, err);
    }
  }
}
