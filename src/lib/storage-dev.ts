/**
 * Dev-mode storage backend that reads/writes via the /api/dev/ route.
 *
 * Mirrors the public API of storage-fsa.ts so the facade module can
 * swap them based on NEXT_PUBLIC_DEV_STORAGE.  FSA handles, idb, and
 * the write queue are completely bypassed — everything goes through
 * plain fetch calls to the Next.js dev server.
 */

import type { JSONContent } from "@tiptap/react";
import type { EditorStateData, VirgilSidecar } from "@/lib/types";
import { parseLatex, extractPreambleAndPostamble } from "@/lib/latex-parser";
import {
  serializeToLatex,
  assignUuids,
  extractSidecarData,
} from "@/lib/latex-serializer";
import type { FsaDocMeta } from "@/lib/doc-index";
import type { FolderPickResult } from "@/lib/storage-fsa";

import {
  detectBibPackage,
  type BibReadResult,
  type GeneralBibPickResult,
  type GeneralBibContents,
} from "@/lib/storage-fsa";

// Re-export types that consumers import alongside functions.
export type { FsaDocMeta } from "@/lib/doc-index";
export type { DocBundle, BibReadResult, BibPackage, GeneralBibPickResult, GeneralBibContents } from "@/lib/storage-fsa";
// Re-export the pure function that doesn't touch FSA.
export { detectBibPackage };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const API = "/api/dev";

interface DevIndexEntry {
  id: string;
  name: string;
  createdAt: string;
  lastModifiedAt: string;
  sourcePath: string;
}

/** Extract the tex filename from a sourcePath like .../doc_xxx/document.tex */
function texFilenameFromPath(sourcePath: string): string {
  const parts = sourcePath.split("/");
  return parts[parts.length - 1];
}

/** Extract folder display name from sourcePath. */
function folderNameFromPath(sourcePath: string): string {
  const parts = sourcePath.split("/");
  // The folder is the second-to-last segment
  return parts[parts.length - 2];
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function fetchJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url);
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

async function putText(url: string, body: string): Promise<void> {
  await fetch(url, { method: "PUT", body }).catch(() => {});
}

// Keep an in-memory cache of the dev index to avoid re-fetching on every call.
let _cachedIndex: DevIndexEntry[] | null = null;

async function getDevIndex(): Promise<DevIndexEntry[]> {
  if (_cachedIndex) return _cachedIndex;
  const data = await fetchJson<{ docs: DevIndexEntry[] }>(`${API}/index.json`, { docs: [] });
  _cachedIndex = data.docs;
  return _cachedIndex;
}

function findEntry(docs: DevIndexEntry[], docId: string): DevIndexEntry | undefined {
  return docs.find((d) => d.id === docId);
}

// ---------------------------------------------------------------------------
// Sidecar JSON files (everything in `virgil/`)
// ---------------------------------------------------------------------------

const DEFAULT_EDITOR_STATE: EditorStateData = {
  cursorPosition: 0,
  selection: null,
  lastModified: new Date().toISOString(),
};

const DEFAULT_SIDECAR: VirgilSidecar = { paragraphs: {} };

const DEFAULT_LATEX = `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath}
\\usepackage{amssymb}

\\begin{document}

Start writing here...

\\end{document}
`;

export async function readSidecar<T>(
  docId: string,
  filename: string,
  defaultValue: T,
): Promise<T> {
  return fetchJson<T>(`${API}/doc/${docId}/virgil/${filename}`, defaultValue);
}

export async function writeSidecar<T>(
  docId: string,
  filename: string,
  data: T,
): Promise<void> {
  await putText(`${API}/doc/${docId}/virgil/${filename}`, JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// Raw .tex file
// ---------------------------------------------------------------------------

export async function readTex(docId: string): Promise<string> {
  const docs = await getDevIndex();
  const entry = findEntry(docs, docId);
  const filename = entry ? texFilenameFromPath(entry.sourcePath) : "document.tex";
  return (await fetchText(`${API}/doc/${docId}/${filename}`)) ?? DEFAULT_LATEX;
}

export async function writeTex(docId: string, latex: string): Promise<void> {
  const docs = await getDevIndex();
  const entry = findEntry(docs, docId);
  const filename = entry ? texFilenameFromPath(entry.sourcePath) : "document.tex";
  await putText(`${API}/doc/${docId}/${filename}`, latex);
}

// ---------------------------------------------------------------------------
// Document bundle
// ---------------------------------------------------------------------------

export async function readDocBundle(docId: string): Promise<{ content: JSONContent; editorState: EditorStateData }> {
  const docs = await getDevIndex();
  const entry = findEntry(docs, docId);
  const texFilename = entry ? texFilenameFromPath(entry.sourcePath) : "document.tex";

  const [latex, sidecar, editorState] = await Promise.all([
    fetchText(`${API}/doc/${docId}/${texFilename}`).then((t) => t ?? DEFAULT_LATEX),
    fetchJson<VirgilSidecar>(`${API}/doc/${docId}/virgil/virgil.json`, DEFAULT_SIDECAR),
    fetchJson<EditorStateData>(`${API}/doc/${docId}/virgil/editor-state.json`, DEFAULT_EDITOR_STATE),
  ]);

  const content = parseLatex(latex, sidecar);
  // Assign UUIDs immediately on load so every paragraph is addressable
  // from the moment the editor opens (no waiting for the first save).
  // Also persist back to disk so the .tex file stays in sync.
  assignUuids(content);
  const newSidecar = extractSidecarData(content);
  // Preserve the user's preamble/postamble — the parser strips them, so
  // without this the fire-and-forget write below would overwrite the
  // user's .tex header with the default preamble.
  const delimiters = extractPreambleAndPostamble(latex);
  const newLatex = serializeToLatex(content, delimiters ?? undefined);
  // Fire-and-forget write — don't block the editor from opening.
  Promise.all([
    putText(`${API}/doc/${docId}/${texFilename}`, newLatex),
    putText(`${API}/doc/${docId}/virgil/virgil.json`, JSON.stringify(newSidecar, null, 2)),
  ]).catch(() => {});
  return { content, editorState };
}

export async function writeDocBundle(
  docId: string,
  content: JSONContent,
  editorState: EditorStateData,
): Promise<void> {
  const docs = await getDevIndex();
  const entry = findEntry(docs, docId);
  const texFilename = entry ? texFilenameFromPath(entry.sourcePath) : "document.tex";

  // Same sidecar/uuid logic as the FSA version.
  const existingSidecar = await fetchJson<VirgilSidecar>(
    `${API}/doc/${docId}/virgil/virgil.json`,
    DEFAULT_SIDECAR,
  );
  // recoverOrphanedUuids disabled — fingerprint matching causes UUID collisions.
  // Lost UUIDs get fresh ones via assignUuids instead.
  assignUuids(content);

  // Preserve the user's preamble/postamble by re-reading the existing
  // .tex file. The editor never sees these chunks, so the disk is the
  // only source of truth for them.
  const existingLatex = (await fetchText(`${API}/doc/${docId}/${texFilename}`)) ?? "";
  const delimiters = extractPreambleAndPostamble(existingLatex);

  const newSidecar = extractSidecarData(content);
  const latex = serializeToLatex(content, delimiters ?? undefined);

  await Promise.all([
    putText(`${API}/doc/${docId}/${texFilename}`, latex),
    putText(`${API}/doc/${docId}/virgil/virgil.json`, JSON.stringify(newSidecar, null, 2)),
    putText(
      `${API}/doc/${docId}/virgil/editor-state.json`,
      JSON.stringify({ ...editorState, lastModified: new Date().toISOString() }, null, 2),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Bibliography
// ---------------------------------------------------------------------------

const BIB_DECL_RE = /\\(?:bibliography|addbibresource)\{([^}]+)\}/;

export async function readBib(docId: string): Promise<BibReadResult> {
  const tex = await readTex(docId);
  const m = tex.match(BIB_DECL_RE);
  let bibFilename = "references.bib";
  if (m) {
    bibFilename = m[1].trim();
    if (!bibFilename.endsWith(".bib")) bibFilename += ".bib";
  }
  const bibText = (await fetchText(`${API}/doc/${docId}/${bibFilename}`)) ?? "";
  const detectedPackage = detectBibPackage(tex);
  return { bibText, bibFilename, detectedPackage };
}

export async function writeBib(docId: string, bibText: string): Promise<void> {
  const tex = await readTex(docId);
  const m = tex.match(BIB_DECL_RE);
  let bibFilename = "references.bib";
  if (m) {
    bibFilename = m[1].trim();
    if (!bibFilename.endsWith(".bib")) bibFilename += ".bib";
  }
  await putText(`${API}/doc/${docId}/${bibFilename}`, bibText);
}

// ---------------------------------------------------------------------------
// General bibliography — no-op in dev mode (requires picker)
// ---------------------------------------------------------------------------

export async function pickGeneralBib(
  _docId: string,
): Promise<GeneralBibPickResult | null> {
  console.warn("[dev-storage] pickGeneralBib is a no-op in dev mode");
  return null;
}

export async function readGeneralBib(
  _docId: string,
): Promise<GeneralBibContents | null> {
  return null;
}

// ---------------------------------------------------------------------------
// Document creation, opening, and index management
// ---------------------------------------------------------------------------

export async function createDocFromPicker(
  _rawName: string,
): Promise<FsaDocMeta> {
  throw new Error("createDocFromPicker is not available in dev storage mode");
}

export async function pickProjectFolder(): Promise<FolderPickResult> {
  throw new Error("pickProjectFolder is not available in dev storage mode");
}

export async function registerDocInFolder(
  _handle: FileSystemDirectoryHandle,
  _texFilename: string,
): Promise<FsaDocMeta> {
  throw new Error("registerDocInFolder is not available in dev storage mode");
}

export async function openExistingDocFromPicker(): Promise<FsaDocMeta> {
  throw new Error("openExistingDocFromPicker is not available in dev storage mode");
}

export async function listDocs(): Promise<FsaDocMeta[]> {
  const docs = await getDevIndex();
  // Filter to docs that live inside virgil-data (skip Dropbox paths etc.)
  return docs
    .filter((d) => d.sourcePath.includes("virgil-data/"))
    .map((d) => ({
      id: d.id,
      name: d.name,
      texFilename: texFilenameFromPath(d.sourcePath),
      folderName: folderNameFromPath(d.sourcePath),
      createdAt: d.createdAt,
      lastModifiedAt: d.lastModifiedAt,
    }));
}

export async function renameDoc(id: string, newName: string): Promise<void> {
  const raw = await fetchText(`${API}/index.json`);
  if (!raw) return;
  const index = JSON.parse(raw) as { docs: DevIndexEntry[] };
  const doc = index.docs.find((d) => d.id === id);
  if (!doc) return;
  doc.name = newName;
  doc.lastModifiedAt = new Date().toISOString();
  _cachedIndex = null;
  await putText(`${API}/index.json`, JSON.stringify(index, null, 2));
}

export async function deleteDocFromIndex(id: string): Promise<void> {
  const raw = await fetchText(`${API}/index.json`);
  if (!raw) return;
  const index = JSON.parse(raw) as { docs: DevIndexEntry[] };
  index.docs = index.docs.filter((d) => d.id !== id);
  _cachedIndex = null;
  await putText(`${API}/index.json`, JSON.stringify(index, null, 2));
}

// ---------------------------------------------------------------------------
// Drain helpers — no-op in dev mode (no write queue)
// ---------------------------------------------------------------------------

export async function flushDoc(_docId: string): Promise<void> {}
