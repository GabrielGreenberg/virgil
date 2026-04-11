/**
 * Client-side storage layer built on the File System Access API.
 *
 * This module is the single boundary between Virgil's hooks and the user's
 * disk. Hooks should never reach into idb-keyval, FSA primitives, or the
 * write queue directly — they call functions here.
 *
 * Layout on disk (unchanged from the old fs-based layer):
 *
 *   <paperFolder>/                 ← user picked this once via showDirectoryPicker
 *   ├── <texFilename>              e.g. main.tex
 *   ├── references.bib             (or whatever the .tex declares; optional)
 *   └── virgil/
 *       ├── virgil.json            paragraph UUID sidecar
 *       ├── editor-state.json
 *       ├── revisions.json
 *       ├── citations.json
 *       ├── notes.json
 *       ├── footnotes.json
 *       ├── ... etc.
 *
 * Permissions: every read and write below assumes the caller has already
 * ensured `readwrite` permission on the doc handle (via DocPermissionGate).
 * If permission is missing the FSA call will throw `NotAllowedError`,
 * which the caller can surface.
 */

import { generateEntityId } from "@/lib/uuid";
import type { JSONContent } from "@tiptap/react";
import type { EditorStateData, VirgilSidecar } from "@/lib/types";
import { parseLatex } from "@/lib/latex-parser";
import {
  serializeToLatex,
  assignUuids,
  extractSidecarData,
  recoverOrphanedUuids,
} from "@/lib/latex-serializer";
import {
  readIndex,
  writeIndex,
  getDocHandle,
  setDocHandle,
  purgeDoc,
  getGeneralBibHandle,
  setGeneralBibHandle,
  type FsaDocMeta,
} from "@/lib/doc-index";
import { enqueueWrite, flushWrites } from "@/lib/write-queue";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VIRGIL_SUBDIR = "virgil";

const DEFAULT_LATEX = `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath}
\\usepackage{amssymb}

\\begin{document}

Start writing here...

\\end{document}
`;

const DEFAULT_EDITOR_STATE: EditorStateData = {
  cursorPosition: 0,
  selection: null,
  lastModified: new Date().toISOString(),
};

const DEFAULT_SIDECAR: VirgilSidecar = { paragraphs: {} };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Read a doc's directory handle, throwing a clear error if it isn't there. */
async function requireDocHandle(
  docId: string,
): Promise<FileSystemDirectoryHandle> {
  const h = await getDocHandle(docId);
  if (!h) throw new Error(`No folder handle stored for doc ${docId}`);
  return h;
}

/** Get/create the `virgil/` subdir under a doc folder. */
async function getVirgilSubdir(
  docHandle: FileSystemDirectoryHandle,
): Promise<FileSystemDirectoryHandle> {
  return docHandle.getDirectoryHandle(VIRGIL_SUBDIR, { create: true });
}

/** True if the directory contains an entry with this exact name. */
async function hasEntry(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<boolean> {
  for await (const entry of dir.values()) {
    if (entry.name === name) return true;
  }
  return false;
}

/** True if `e` looks like a "file/dir doesn't exist" error from FSA. */
function isNotFound(e: unknown): boolean {
  return e instanceof DOMException && e.name === "NotFoundError";
}

async function readTextFromHandle(
  fileHandle: FileSystemFileHandle,
): Promise<string> {
  const file = await fileHandle.getFile();
  return file.text();
}

async function writeTextToHandle(
  fileHandle: FileSystemFileHandle,
  content: string,
): Promise<void> {
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

// ---------------------------------------------------------------------------
// Sidecar JSON files (everything in `virgil/`)
// ---------------------------------------------------------------------------

export async function readSidecar<T>(
  docId: string,
  filename: string,
  defaultValue: T,
): Promise<T> {
  const docHandle = await requireDocHandle(docId);
  try {
    const virgil = await getVirgilSubdir(docHandle);
    const fileHandle = await virgil.getFileHandle(filename);
    const text = await readTextFromHandle(fileHandle);
    return JSON.parse(text) as T;
  } catch (e) {
    if (isNotFound(e)) return defaultValue;
    throw e;
  }
}

export async function writeSidecar<T>(
  docId: string,
  filename: string,
  data: T,
): Promise<void> {
  const key = `${docId}/virgil/${filename}`;
  return enqueueWrite(key, async () => {
    const docHandle = await requireDocHandle(docId);
    const virgil = await getVirgilSubdir(docHandle);
    const fileHandle = await virgil.getFileHandle(filename, { create: true });
    await writeTextToHandle(fileHandle, JSON.stringify(data, null, 2));
  });
}

// ---------------------------------------------------------------------------
// Raw .tex file
// ---------------------------------------------------------------------------

async function getTexFileHandle(
  docId: string,
  opts: { create?: boolean } = {},
): Promise<FileSystemFileHandle> {
  const meta = await getDocMetaOrThrow(docId);
  const docHandle = await requireDocHandle(docId);
  return docHandle.getFileHandle(meta.texFilename, opts);
}

export async function readTex(docId: string): Promise<string> {
  try {
    const fh = await getTexFileHandle(docId);
    return await readTextFromHandle(fh);
  } catch (e) {
    if (isNotFound(e)) return DEFAULT_LATEX;
    throw e;
  }
}

export async function writeTex(docId: string, latex: string): Promise<void> {
  const key = `${docId}/tex`;
  return enqueueWrite(key, async () => {
    const fh = await getTexFileHandle(docId, { create: true });
    await writeTextToHandle(fh, latex);
    await touchDocTimestamp(docId);
  });
}

// ---------------------------------------------------------------------------
// Document bundle (.tex + virgil.json + editor-state.json)
//
// This replaces the old `/api/document` route. The whole bundle is
// serialized through a single per-doc queue so the three files always
// move together.
// ---------------------------------------------------------------------------

export interface DocBundle {
  content: JSONContent;
  editorState: EditorStateData;
}

export async function readDocBundle(docId: string): Promise<DocBundle> {
  const docHandle = await requireDocHandle(docId);
  const meta = await getDocMetaOrThrow(docId);

  const latex = await safeReadText(docHandle, meta.texFilename, DEFAULT_LATEX);
  const virgil = await getVirgilSubdir(docHandle);
  const sidecar = await safeReadJson<VirgilSidecar>(
    virgil,
    "virgil.json",
    DEFAULT_SIDECAR,
  );
  const editorState = await safeReadJson<EditorStateData>(
    virgil,
    "editor-state.json",
    DEFAULT_EDITOR_STATE,
  );

  const content = parseLatex(latex, sidecar);
  return { content, editorState };
}

export async function writeDocBundle(
  docId: string,
  content: JSONContent,
  editorState: EditorStateData,
): Promise<void> {
  const key = `${docId}/bundle`;
  return enqueueWrite(key, async () => {
    const docHandle = await requireDocHandle(docId);
    const meta = await getDocMetaOrThrow(docId);
    const virgil = await getVirgilSubdir(docHandle);

    // Recover any UUIDs whose paragraph markers were stripped by an
    // external edit, then assign new UUIDs to fresh paragraphs.
    const existingSidecar = await safeReadJson<VirgilSidecar>(
      virgil,
      "virgil.json",
      DEFAULT_SIDECAR,
    );
    recoverOrphanedUuids(content, existingSidecar);
    assignUuids(content);

    const newSidecar = extractSidecarData(content);
    const latex = serializeToLatex(content);

    const texFh = await docHandle.getFileHandle(meta.texFilename, {
      create: true,
    });
    await writeTextToHandle(texFh, latex);

    const sidecarFh = await virgil.getFileHandle("virgil.json", {
      create: true,
    });
    await writeTextToHandle(sidecarFh, JSON.stringify(newSidecar, null, 2));

    const stateFh = await virgil.getFileHandle("editor-state.json", {
      create: true,
    });
    await writeTextToHandle(
      stateFh,
      JSON.stringify(
        { ...editorState, lastModified: new Date().toISOString() },
        null,
        2,
      ),
    );

    await touchDocTimestamp(docId);
  });
}

// ---------------------------------------------------------------------------
// Bibliography (sibling .bib file in the doc folder)
// ---------------------------------------------------------------------------

const BIB_DECL_RE = /\\(?:bibliography|addbibresource)\{([^}]+)\}/;

/**
 * Resolve which .bib filename inside the doc folder belongs to this doc:
 *  1. Whatever `\bibliography{}` or `\addbibresource{}` declares.
 *  2. If only one .bib exists in the folder, that one.
 *  3. If multiple, prefer one whose stem matches the .tex stem.
 *  4. Fall back to `references.bib`.
 */
async function resolveBibFilename(docId: string): Promise<string> {
  const docHandle = await requireDocHandle(docId);
  const meta = await getDocMetaOrThrow(docId);

  const tex = await safeReadText(docHandle, meta.texFilename, "");
  const m = tex.match(BIB_DECL_RE);
  if (m) {
    let name = m[1].trim();
    if (!name.endsWith(".bib")) name += ".bib";
    return name;
  }

  const bibFiles: string[] = [];
  for await (const entry of docHandle.values()) {
    if (entry.kind === "file" && entry.name.endsWith(".bib")) {
      bibFiles.push(entry.name);
    }
  }
  if (bibFiles.length === 1) return bibFiles[0];
  if (bibFiles.length > 1) {
    const stem = meta.texFilename.replace(/\.tex$/i, "");
    const matched = bibFiles.find((f) => f === `${stem}.bib`);
    if (matched) return matched;
    return bibFiles[0];
  }

  return "references.bib";
}

export type BibPackage = "natbib" | "biblatex";

/** Detect natbib vs biblatex from preamble + command usage in the .tex source. */
export function detectBibPackage(tex: string): BibPackage {
  if (/\\usepackage(\[.*?\])?\{biblatex\}/.test(tex)) return "biblatex";
  if (/\\usepackage(\[.*?\])?\{natbib\}/.test(tex)) return "natbib";
  if (/\\(textcite|parencite|autocite|footcite|textcites|parencites|cites)\b/.test(tex)) {
    return "biblatex";
  }
  if (/\\(citet|citep|citealt|citealp|citeyearpar)\b/.test(tex)) {
    return "natbib";
  }
  return "natbib";
}

export interface BibReadResult {
  bibText: string;
  bibFilename: string;
  detectedPackage: BibPackage;
}

export async function readBib(docId: string): Promise<BibReadResult> {
  const docHandle = await requireDocHandle(docId);
  const meta = await getDocMetaOrThrow(docId);
  const bibFilename = await resolveBibFilename(docId);
  const bibText = await safeReadText(docHandle, bibFilename, "");
  const tex = await safeReadText(docHandle, meta.texFilename, "");
  const detectedPackage = detectBibPackage(tex);
  return { bibText, bibFilename, detectedPackage };
}

export async function writeBib(docId: string, bibText: string): Promise<void> {
  const bibFilename = await resolveBibFilename(docId);
  const key = `${docId}/bib/${bibFilename}`;
  return enqueueWrite(key, async () => {
    const docHandle = await requireDocHandle(docId);
    const fh = await docHandle.getFileHandle(bibFilename, { create: true });
    await writeTextToHandle(fh, bibText);
  });
}

// ---------------------------------------------------------------------------
// General bibliography (a separate .bib file the user picked for searching)
// ---------------------------------------------------------------------------

/** Result of a successful general-bib pick. */
export interface GeneralBibPickResult {
  filename: string;
}

/**
 * Show a file picker for a .bib and store the resulting handle in idb,
 * keyed by docId. Must be called from inside a user gesture.
 */
export async function pickGeneralBib(
  docId: string,
): Promise<GeneralBibPickResult | null> {
  const [handle] = await window.showOpenFilePicker({
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
  await setGeneralBibHandle(docId, handle);
  return { filename: handle.name };
}

export interface GeneralBibContents {
  bibText: string;
  filename: string;
  lastModified: number;
}

/** Read the user's general bib file (if one was picked). */
export async function readGeneralBib(
  docId: string,
): Promise<GeneralBibContents | null> {
  const handle = await getGeneralBibHandle(docId);
  if (!handle) return null;
  try {
    const file = await handle.getFile();
    const bibText = await file.text();
    return { bibText, filename: handle.name, lastModified: file.lastModified };
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Document creation, opening, and index management
// ---------------------------------------------------------------------------

/**
 * Sanitize a user-typed paper name into something safe to use as a folder
 * name. We're permissive — anything that's not a path separator or a
 * disallowed Windows char is fine, since the user picked the name and
 * the picker will reject anything truly broken.
 */
function sanitizeFolderName(name: string): string {
  return name
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

/**
 * Create a new paper.
 *
 * Flow (must be invoked from a user gesture):
 *   1. User has already typed a name (caller provides it).
 *   2. We open the parent-folder picker.
 *   3. We create `<parent>/<name>/document.tex` and `<parent>/<name>/virgil/`.
 *   4. We register the new doc in idb and store its folder handle.
 */
export async function createDocFromPicker(
  rawName: string,
): Promise<FsaDocMeta> {
  const name = rawName.trim();
  if (!name) throw new Error("Paper name is required");
  const folderName = sanitizeFolderName(name);
  if (!folderName) throw new Error("Paper name produces an empty folder name");

  const parent = await window.showDirectoryPicker({ mode: "readwrite" });

  // Reject if a folder with this name already exists, to avoid silently
  // adopting an unrelated directory.
  if (await hasEntry(parent, folderName)) {
    throw new Error(
      `A folder named "${folderName}" already exists in the chosen location.`,
    );
  }

  const docHandle = await parent.getDirectoryHandle(folderName, {
    create: true,
  });

  const texFilename = "document.tex";
  const texFh = await docHandle.getFileHandle(texFilename, { create: true });
  await writeTextToHandle(texFh, DEFAULT_LATEX);

  // Pre-create virgil/ so the gate sees a valid layout immediately.
  await docHandle.getDirectoryHandle(VIRGIL_SUBDIR, { create: true });

  const now = new Date().toISOString();
  const meta: FsaDocMeta = {
    id: generateEntityId().slice(0, 8),
    name,
    texFilename,
    folderName,
    createdAt: now,
    lastModifiedAt: now,
  };

  await setDocHandle(meta.id, docHandle);
  const idx = await readIndex();
  idx.docs.push(meta);
  await writeIndex(idx);

  return meta;
}

/**
 * Open an existing paper folder.
 *
 * Flow (must be invoked from a user gesture):
 *   1. User picks an existing folder via showDirectoryPicker.
 *   2. We scan it for a .tex file.
 *   3. We register the doc in idb and store its folder handle.
 *
 * If the same folder has already been opened (by display name + .tex
 * filename), we silently reuse the existing entry instead of creating
 * a duplicate.
 */
export async function openExistingDocFromPicker(): Promise<FsaDocMeta> {
  const docHandle = await window.showDirectoryPicker({ mode: "readwrite" });

  // Find a .tex file inside the picked folder.
  const texFiles: string[] = [];
  for await (const entry of docHandle.values()) {
    if (entry.kind === "file" && entry.name.endsWith(".tex")) {
      texFiles.push(entry.name);
    }
  }
  if (texFiles.length === 0) {
    throw new Error(
      `No .tex file found in "${docHandle.name}". Pick a folder that already contains a paper.`,
    );
  }

  // Pick the best candidate when multiple exist.
  let texFilename: string;
  if (texFiles.length === 1) {
    texFilename = texFiles[0];
  } else {
    const folderStem = docHandle.name;
    texFilename =
      texFiles.find((f) => f === `${folderStem}.tex`) ??
      texFiles.find((f) => f === "main.tex") ??
      texFiles.find((f) => f === "document.tex") ??
      texFiles[0];
  }

  // Ensure virgil/ exists for sidecar metadata.
  await docHandle.getDirectoryHandle(VIRGIL_SUBDIR, { create: true });

  const idx = await readIndex();
  const existing = idx.docs.find(
    (d) => d.folderName === docHandle.name && d.texFilename === texFilename,
  );
  if (existing) {
    // Re-bind the handle in case it expired in idb.
    await setDocHandle(existing.id, docHandle);
    return existing;
  }

  const now = new Date().toISOString();
  const meta: FsaDocMeta = {
    id: generateEntityId().slice(0, 8),
    name: docHandle.name,
    texFilename,
    folderName: docHandle.name,
    createdAt: now,
    lastModifiedAt: now,
  };

  await setDocHandle(meta.id, docHandle);
  idx.docs.push(meta);
  await writeIndex(idx);
  return meta;
}

export async function listDocs(): Promise<FsaDocMeta[]> {
  const idx = await readIndex();
  return idx.docs;
}

async function getDocMetaOrThrow(docId: string): Promise<FsaDocMeta> {
  const idx = await readIndex();
  const doc = idx.docs.find((d) => d.id === docId);
  if (!doc) throw new Error(`Doc ${docId} not in index`);
  return doc;
}

export async function renameDoc(id: string, newName: string): Promise<void> {
  const idx = await readIndex();
  const doc = idx.docs.find((d) => d.id === id);
  if (!doc) return;
  doc.name = newName;
  doc.lastModifiedAt = new Date().toISOString();
  await writeIndex(idx);
}

/**
 * Drop a doc from the index. We deliberately do NOT delete the folder
 * on disk — the user's files stay where they put them.
 */
export async function deleteDocFromIndex(id: string): Promise<void> {
  const idx = await readIndex();
  idx.docs = idx.docs.filter((d) => d.id !== id);
  await writeIndex(idx);
  await purgeDoc(id);
}

async function touchDocTimestamp(id: string): Promise<void> {
  const idx = await readIndex();
  const doc = idx.docs.find((d) => d.id === id);
  if (!doc) return;
  doc.lastModifiedAt = new Date().toISOString();
  await writeIndex(idx);
}

// ---------------------------------------------------------------------------
// Drain helpers
// ---------------------------------------------------------------------------

/** Wait for all pending writes for a doc to finish. */
export async function flushDoc(docId: string): Promise<void> {
  await Promise.all([
    flushWrites(`${docId}/bundle`),
    flushWrites(`${docId}/tex`),
  ]);
}

// ---------------------------------------------------------------------------
// Internal: tolerant readers used by readDocBundle / readBib
// ---------------------------------------------------------------------------

async function safeReadText(
  dir: FileSystemDirectoryHandle,
  filename: string,
  fallback: string,
): Promise<string> {
  try {
    const fh = await dir.getFileHandle(filename);
    return await readTextFromHandle(fh);
  } catch (e) {
    if (isNotFound(e)) return fallback;
    throw e;
  }
}

async function safeReadJson<T>(
  dir: FileSystemDirectoryHandle,
  filename: string,
  fallback: T,
): Promise<T> {
  try {
    const fh = await dir.getFileHandle(filename);
    const text = await readTextFromHandle(fh);
    return JSON.parse(text) as T;
  } catch (e) {
    if (isNotFound(e)) return fallback;
    throw e;
  }
}
