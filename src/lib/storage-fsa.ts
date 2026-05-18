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
import { parseLatex, extractPreambleAndPostamble } from "@/lib/latex-parser";
import {
  serializeToLatex,
  assignUuids,
  extractSidecarData,
} from "@/lib/latex-serializer";
import { DEFAULT_STYLE_ID } from "@/lib/document-styles";
import { resolveStyle } from "@/lib/style-library";
import { migrateDocumentSettings } from "@/lib/document-settings";
import {
  readIndex,
  writeIndex,
  getDocHandle,
  setDocHandle,
  purgeDoc,
  type FsaDocMeta,
} from "@/lib/doc-index";
import { enqueueWrite, flushPrefix } from "@/lib/write-queue";
import { withDocLock } from "@/lib/multi-window/doc-ownership";
import {
  assertActive,
  assertNotSuperseded,
  type DocWriteHandle,
} from "@/lib/multi-window/doc-pipeline";
import {
  DOCUMENT_TEMPLATES,
  DEFAULT_TEMPLATE_ID,
  type DocumentTemplate,
} from "@/lib/document-templates";

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

/**
 * Combine the in-window write queue with the cross-window doc lock and
 * the per-doc pipeline check. `enqueueWrite` serializes writes to the
 * same `${docId}/${subkey}` within this window; `withDocLock` enforces
 * cross-window exclusion. The pipeline is checked twice — strictly at
 * enqueue time (fast-fail for stale closures), and leniently inside the
 * queued task: a write whose pipeline ended cleanly (no replacement) is
 * still safe to land, but one whose pipeline has been *superseded* by a
 * new one for the same docId would corrupt the new pipeline's content.
 */
function enqueueDocWrite<T>(
  h: DocWriteHandle,
  subkey: string,
  task: () => Promise<T>,
): Promise<T> {
  assertActive(h);
  return enqueueWrite(`${h.docId}/${subkey}`, () =>
    withDocLock(h.docId, async () => {
      assertNotSuperseded(h);
      return task();
    }),
  );
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

/**
 * Variant of `readSidecar` that returns `null` when the sidecar file
 * doesn't exist, so callers can distinguish "no file on disk" from
 * "file exists with an empty/default value". Used by `usePersistentState`
 * to avoid clobbering editor-derived state (e.g. citations populated
 * via `syncFromEditor`) when the sidecar has never been written —
 * the Library Reader case, where `library-paper:<citekey>` docs never
 * persist sidecars.
 */
export async function readSidecarIfExists<T>(
  docId: string,
  filename: string,
): Promise<T | null> {
  const docHandle = await requireDocHandle(docId);
  try {
    const virgil = await getVirgilSubdir(docHandle);
    const fileHandle = await virgil.getFileHandle(filename);
    const text = await readTextFromHandle(fileHandle);
    return JSON.parse(text) as T;
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

export async function writeSidecar<T>(
  h: DocWriteHandle,
  filename: string,
  data: T,
): Promise<void> {
  return enqueueDocWrite(h, `virgil/${filename}`, async () => {
    const docHandle = await requireDocHandle(h.docId);
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

export async function writeTex(h: DocWriteHandle, latex: string): Promise<void> {
  return enqueueDocWrite(h, "tex", async () => {
    const fh = await getTexFileHandle(h.docId, { create: true });
    await writeTextToHandle(fh, latex);
    await touchDocTimestamp(h.docId);
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
  // Assign UUIDs immediately on load so every paragraph is addressable
  // from the moment the editor opens (no waiting for the first save).
  assignUuids(content);
  return { content, editorState };
}

export async function writeDocBundle(
  h: DocWriteHandle,
  content: JSONContent,
  editorState: EditorStateData,
): Promise<void> {
  return enqueueDocWrite(h, "bundle", async () => {
    const docHandle = await requireDocHandle(h.docId);
    const meta = await getDocMetaOrThrow(h.docId);
    const virgil = await getVirgilSubdir(docHandle);

    // Recover any UUIDs whose paragraph markers were stripped by an
    // external edit, then assign new UUIDs to fresh paragraphs.
    const existingSidecar = await safeReadJson<VirgilSidecar>(
      virgil,
      "virgil.json",
      DEFAULT_SIDECAR,
    );
    // recoverOrphanedUuids disabled — fingerprint matching causes UUID collisions.
    // Lost UUIDs get fresh ones via assignUuids instead.
    assignUuids(content);

    // Preserve the user's preamble/postamble verbatim across the
    // parse/serialize round-trip. The editor never sees them, so we
    // read them straight off the existing .tex file on every save.
    const existingLatex = await safeReadText(docHandle, meta.texFilename, "");
    const delimiters = extractPreambleAndPostamble(existingLatex);

    const newSidecar = extractSidecarData(content);
    // For brand-new / empty docs with no \begin{document} marker yet,
    // seed the preamble from the doc's currently-selected style instead
    // of the historical hardcoded fallback. Existing docs keep their
    // verbatim preamble.
    let serializeOpts: { preamble?: string } | undefined = delimiters ?? undefined;
    if (!delimiters) {
      const rawSettings = await safeReadJson<unknown>(
        virgil,
        "document-settings.json",
        { styleId: DEFAULT_STYLE_ID },
      );
      const settings = migrateDocumentSettings(rawSettings);
      serializeOpts = { preamble: resolveStyle(settings.styleId).preamble };
    }
    const latex = serializeToLatex(content, serializeOpts);

    // Shadow snapshot the prior bundle BEFORE overwriting. This is the
    // forensic safety net: if a regression ever slipped past the
    // pipeline check, the user can recover from virgil/.history/.
    await snapshotPriorBundle(docHandle, virgil, meta.texFilename);

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

    await touchDocTimestamp(h.docId);
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

export async function writeBib(h: DocWriteHandle, bibText: string): Promise<void> {
  const bibFilename = await resolveBibFilename(h.docId);
  return enqueueDocWrite(h, `bib/${bibFilename}`, async () => {
    const docHandle = await requireDocHandle(h.docId);
    const virgil = await getVirgilSubdir(docHandle);
    await snapshotPriorBib(docHandle, virgil, bibFilename);
    const fh = await docHandle.getFileHandle(bibFilename, { create: true });
    await writeTextToHandle(fh, bibText);
  });
}

// ---------------------------------------------------------------------------
// Compiled PDF
// ---------------------------------------------------------------------------

export function pdfFilenameFromTex(texFilename: string): string {
  return texFilename.replace(/\.tex$/i, "") + ".pdf";
}

export async function getPdfFilename(docId: string): Promise<string> {
  const meta = await getDocMetaOrThrow(docId);
  return pdfFilenameFromTex(meta.texFilename);
}

export async function writePdf(h: DocWriteHandle, pdfBytes: Uint8Array): Promise<void> {
  return enqueueDocWrite(h, "pdf", async () => {
    const docHandle = await requireDocHandle(h.docId);
    const filename = await getPdfFilename(h.docId);
    const fh = await docHandle.getFileHandle(filename, { create: true });
    const writable = await fh.createWritable();
    await writable.write(pdfBytes.buffer as ArrayBuffer);
    await writable.close();
  });
}

export async function readPdf(docId: string): Promise<Uint8Array | null> {
  try {
    const docHandle = await requireDocHandle(docId);
    const filename = await getPdfFilename(docId);
    const fh = await docHandle.getFileHandle(filename);
    const file = await fh.getFile();
    return new Uint8Array(await file.arrayBuffer());
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

function resolveTemplate(id?: string): DocumentTemplate {
  const chosen =
    (id && DOCUMENT_TEMPLATES.find((t) => t.id === id)) ||
    DOCUMENT_TEMPLATES.find((t) => t.id === DEFAULT_TEMPLATE_ID) ||
    DOCUMENT_TEMPLATES[0];
  if (!chosen) throw new Error("No document templates available");
  return chosen;
}

async function writeTemplateFiles(
  docHandle: FileSystemDirectoryHandle,
  template: DocumentTemplate,
): Promise<void> {
  for (const [filename, content] of Object.entries(template.files)) {
    const fh = await docHandle.getFileHandle(filename, { create: true });
    await writeTextToHandle(fh, content);
  }
  // Pre-create virgil/ so the gate sees a valid layout immediately.
  await docHandle.getDirectoryHandle(VIRGIL_SUBDIR, { create: true });
}

/**
 * Create a new paper, prompting the user to pick a parent folder.
 *
 * Flow (must be invoked from a user gesture):
 *   1. User has already typed a name (caller provides it).
 *   2. We open the parent-folder picker.
 *   3. We create `<parent>/<name>/` with the template's files.
 *   4. We register the new doc in idb and store its folder handle.
 */
export async function createDocFromPicker(
  rawName: string,
  templateId?: string,
): Promise<FsaDocMeta> {
  const name = rawName.trim();
  if (!name) throw new Error("Paper name is required");
  const folderName = sanitizeFolderName(name);
  if (!folderName) throw new Error("Paper name produces an empty folder name");

  const template = resolveTemplate(templateId);

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

  await writeTemplateFiles(docHandle, template);

  const now = new Date().toISOString();
  const meta: FsaDocMeta = {
    id: generateEntityId().slice(0, 8),
    name,
    texFilename: template.mainTexFilename,
    folderName,
    createdAt: now,
    lastModifiedAt: now,
    lastAccessedAt: now,
  };

  await setDocHandle(meta.id, docHandle);
  const idx = await readIndex();
  idx.docs.push(meta);
  await writeIndex(idx);

  return meta;
}

/**
 * Create a new doc inside an already-picked folder handle. Used by the
 * "Create new document here" path in the folder-picker modal — the user
 * has already chosen the project folder, so we just write the template
 * files into it (no subfolder). If the template's main .tex already
 * exists in the folder, we fail rather than overwrite.
 */
export async function createDocInFolder(
  handle: FileSystemDirectoryHandle,
  rawName: string,
  templateId?: string,
): Promise<FsaDocMeta> {
  const name = rawName.trim();
  if (!name) throw new Error("Paper name is required");

  const template = resolveTemplate(templateId);

  for (const filename of Object.keys(template.files)) {
    if (await hasEntry(handle, filename)) {
      throw new Error(
        `A file named "${filename}" already exists in "${handle.name}".`,
      );
    }
  }

  await writeTemplateFiles(handle, template);

  const now = new Date().toISOString();
  const meta: FsaDocMeta = {
    id: generateEntityId().slice(0, 8),
    name,
    texFilename: template.mainTexFilename,
    folderName: handle.name,
    createdAt: now,
    lastModifiedAt: now,
    lastAccessedAt: now,
  };

  await setDocHandle(meta.id, handle);
  const idx = await readIndex();
  idx.docs.push(meta);
  await writeIndex(idx);

  return meta;
}

// ---------------------------------------------------------------------------
// Two-phase document opening
// ---------------------------------------------------------------------------

/** Result of the first phase: the user picked a folder. */
export interface FolderPickResult {
  handle: FileSystemDirectoryHandle;
  texFiles: string[];
  folderName: string;
}

/**
 * Phase 1 — pick a project folder and discover its .tex files.
 * Must be called from a user gesture (showDirectoryPicker requires it).
 *
 * Returning an empty `texFiles` array is valid — the caller can route
 * the user into the "Create new document" flow when the picked folder
 * has no .tex yet.
 */
export async function pickProjectFolder(): Promise<FolderPickResult> {
  const handle = await window.showDirectoryPicker({ mode: "readwrite" });

  const texFiles: string[] = [];
  for await (const entry of handle.values()) {
    if (entry.kind === "file" && entry.name.endsWith(".tex")) {
      texFiles.push(entry.name);
    }
  }

  return { handle, texFiles, folderName: handle.name };
}

/**
 * Phase 2 — register a specific .tex file from an already-picked folder.
 * Does NOT require a user gesture.
 */
export async function registerDocInFolder(
  handle: FileSystemDirectoryHandle,
  texFilename: string,
): Promise<FsaDocMeta> {
  await handle.getDirectoryHandle(VIRGIL_SUBDIR, { create: true });

  const idx = await readIndex();
  const existing = idx.docs.find(
    (d) => d.folderName === handle.name && d.texFilename === texFilename,
  );
  if (existing) {
    await setDocHandle(existing.id, handle);
    return existing;
  }

  const now = new Date().toISOString();
  const meta: FsaDocMeta = {
    id: generateEntityId().slice(0, 8),
    name: handle.name,
    texFilename,
    folderName: handle.name,
    createdAt: now,
    lastModifiedAt: now,
    lastAccessedAt: now,
  };

  await setDocHandle(meta.id, handle);
  idx.docs.push(meta);
  await writeIndex(idx);
  return meta;
}

/**
 * Open an existing paper folder (convenience wrapper).
 * Auto-selects the best .tex file when multiple exist.
 */
export async function openExistingDocFromPicker(): Promise<FsaDocMeta> {
  const { handle, texFiles, folderName } = await pickProjectFolder();

  if (texFiles.length === 0) {
    throw new Error(
      `No .tex file found in "${folderName}". Pick a folder that already contains a paper, or use "Create new document".`,
    );
  }

  let texFilename: string;
  if (texFiles.length === 1) {
    texFilename = texFiles[0];
  } else {
    texFilename =
      texFiles.find((f) => f === `${folderName}.tex`) ??
      texFiles.find((f) => f === "main.tex") ??
      texFiles.find((f) => f === "document.tex") ??
      texFiles[0];
  }

  return registerDocInFolder(handle, texFilename);
}

export async function listDocs(): Promise<FsaDocMeta[]> {
  const idx = await readIndex();
  return idx.docs;
}

/**
 * Library Reader docId convention: `library-paper:<citekey>` resolves
 * to a paper folder under `~/Virgil-Library/papers/<citekey>/`. These
 * IDs are registered via `setDocHandle` by the Reader's mount layer
 * but are intentionally NOT in the `FsaDocIndex` (so they don't
 * pollute the main app's recents). The metadata they need to
 * round-trip through the storage layer (texFilename, folderName,
 * timestamps) is synthesized on the fly here — Library papers always
 * use the canonical `main.tex` filename, and the timestamps are
 * cosmetic (sidecar reads don't consult them).
 */
const LIBRARY_PAPER_PREFIX = "library-paper:";
function syntheticLibraryPaperMeta(docId: string): FsaDocMeta {
  const citekey = docId.slice(LIBRARY_PAPER_PREFIX.length);
  const stamp = "1970-01-01T00:00:00.000Z";
  return {
    id: docId,
    name: citekey,
    texFilename: "main.tex",
    folderName: citekey,
    createdAt: stamp,
    lastModifiedAt: stamp,
    lastAccessedAt: stamp,
  };
}

async function getDocMetaOrThrow(docId: string): Promise<FsaDocMeta> {
  if (docId.startsWith(LIBRARY_PAPER_PREFIX)) {
    return syntheticLibraryPaperMeta(docId);
  }
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
// Paper folder enumeration (for the compile pipeline)
// ---------------------------------------------------------------------------

export interface PaperFile {
  /** Path relative to the paper folder root, e.g. "main.tex", "figs/plot.png". */
  path: string;
  /** File contents as bytes. */
  bytes: Uint8Array;
}

/**
 * Read every file in the doc's paper folder (recursively), skipping the
 * `virgil/` sidecar subdir. Used by the compile pipeline to feed the
 * SwiftLaTeX engine's memfs.
 */
export async function readPaperFolder(docId: string): Promise<PaperFile[]> {
  const docHandle = await requireDocHandle(docId);
  const out: PaperFile[] = [];
  await collectFiles(docHandle, "", out);
  return out;
}

async function collectFiles(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  out: PaperFile[],
): Promise<void> {
  for await (const entry of dir.values()) {
    if (prefix === "" && entry.name === VIRGIL_SUBDIR) continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === "file") {
      const file = await (entry as FileSystemFileHandle).getFile();
      const bytes = new Uint8Array(await file.arrayBuffer());
      out.push({ path, bytes });
    } else if (entry.kind === "directory") {
      await collectFiles(entry as FileSystemDirectoryHandle, path, out);
    }
  }
}

/** The main .tex filename for a doc (e.g. "main.tex" or "paper.tex"). */
export async function getTexFilename(docId: string): Promise<string> {
  const meta = await getDocMetaOrThrow(docId);
  return meta.texFilename;
}

// ---------------------------------------------------------------------------
// Drain helpers
// ---------------------------------------------------------------------------

/** Wait for ALL pending writes for a doc to drain — bundle, tex, bib,
 *  every sidecar, pdf. Used by the doc-switch barrier so the outgoing
 *  pipeline finishes its work before the new pipeline takes over. */
export async function flushDoc(docId: string): Promise<void> {
  await flushPrefix(docId);
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

// ---------------------------------------------------------------------------
// Shadow snapshots — virgil/.history/<timestamp>/
//
// Forensic recovery layer. Every successful writeDocBundle / writeBib
// snapshots the prior version under virgil/.history/<ISO-timestamp>/
// before overwriting. Last 20 snapshots are kept. If anything ever
// slips past the pipeline check (Layer 1) and overwrites a doc with
// the wrong content, prior versions are recoverable from the doc's
// own folder without restoring from a backup elsewhere.
// ---------------------------------------------------------------------------

const HISTORY_DIR = ".history";
const HISTORY_LIMIT = 20;

function historyTimestamp(): string {
  // Filesystem-safe ISO timestamp (no colons or dots).
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function copyFileIfPresent(
  source: FileSystemDirectoryHandle,
  filename: string,
  dest: FileSystemDirectoryHandle,
): Promise<void> {
  try {
    const sourceFh = await source.getFileHandle(filename);
    const file = await sourceFh.getFile();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const destFh = await dest.getFileHandle(filename, { create: true });
    const w = await destFh.createWritable();
    await w.write(bytes.buffer as ArrayBuffer);
    await w.close();
  } catch (e) {
    if (isNotFound(e)) return; // nothing to snapshot yet
    // Don't let snapshot failures block the actual write — log and
    // continue. The write itself is the thing the user cares about.
    console.warn(`[storage] history snapshot failed for ${filename}:`, e);
  }
}

async function pruneHistory(
  history: FileSystemDirectoryHandle,
  limit: number,
): Promise<void> {
  const slots: string[] = [];
  try {
    for await (const entry of history.values()) {
      if (entry.kind === "directory") slots.push(entry.name);
    }
  } catch {
    return;
  }
  if (slots.length <= limit) return;
  // Names are ISO-derived, so lexicographic sort matches chronological.
  slots.sort();
  const toRemove = slots.slice(0, slots.length - limit);
  for (const name of toRemove) {
    try {
      await history.removeEntry(name, { recursive: true });
    } catch (e) {
      console.warn(`[storage] history prune failed for ${name}:`, e);
    }
  }
}

async function snapshotPriorBundle(
  docHandle: FileSystemDirectoryHandle,
  virgil: FileSystemDirectoryHandle,
  texFilename: string,
): Promise<void> {
  try {
    const history = await virgil.getDirectoryHandle(HISTORY_DIR, {
      create: true,
    });
    const slot = await history.getDirectoryHandle(historyTimestamp(), {
      create: true,
    });
    await copyFileIfPresent(docHandle, texFilename, slot);
    await copyFileIfPresent(virgil, "virgil.json", slot);
    await copyFileIfPresent(virgil, "editor-state.json", slot);
    await pruneHistory(history, HISTORY_LIMIT);
  } catch (e) {
    console.warn("[storage] failed to snapshot prior bundle:", e);
  }
}

async function snapshotPriorBib(
  docHandle: FileSystemDirectoryHandle,
  virgil: FileSystemDirectoryHandle,
  bibFilename: string,
): Promise<void> {
  try {
    const history = await virgil.getDirectoryHandle(HISTORY_DIR, {
      create: true,
    });
    const slot = await history.getDirectoryHandle(historyTimestamp(), {
      create: true,
    });
    await copyFileIfPresent(docHandle, bibFilename, slot);
    await pruneHistory(history, HISTORY_LIMIT);
  } catch (e) {
    console.warn("[storage] failed to snapshot prior bib:", e);
  }
}
