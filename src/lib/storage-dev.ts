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
import { DEFAULT_STYLE_ID } from "@/lib/document-styles";
import { resolveStyle } from "@/lib/style-library";
import { migrateDocumentSettings } from "@/lib/document-settings";
import type { FsaDocMeta } from "@/lib/doc-index";
import type { FolderPickResult, PickedFigureFile } from "@/lib/storage-fsa";

import {
  detectBibPackage,
  type BibReadResult,
} from "@/lib/storage-fsa";
import {
  DOCUMENT_TEMPLATES,
  DEFAULT_TEMPLATE_ID,
} from "@/lib/document-templates";
import {
  assertActive,
  assertNotSuperseded,
  getActiveHandle,
  isActive,
  type DocWriteHandle,
} from "@/lib/multi-window/doc-pipeline";
import { stampDiskFingerprint, fingerprintOf } from "@/lib/disk-ledger";

// Re-export types that consumers import alongside functions.
export type { FsaDocMeta } from "@/lib/doc-index";
export type { DocBundle, BibReadResult, BibPackage } from "@/lib/storage-fsa";
// Re-export the pure function that doesn't touch FSA.
export { detectBibPackage };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const API = "/api/dev";
const LIBRARY_API = "/api/dev-library";

/**
 * Library Reader docId convention: `library-paper:<citekey>` resolves
 * to a paper folder under `~/Virgil-Library/papers/<citekey>/`. In
 * the dev preview, the corresponding HTTP route is
 * `/api/dev-library/papers/<citekey>/...` (handled by the
 * `dev-library` API). The synthetic `library-paper:` IDs are NOT in
 * the dev index — they're created on the fly by the Reader's mount
 * layer. Mirrors the synthetic-meta path in `storage-fsa.ts`.
 */
const LIBRARY_PAPER_PREFIX = "library-paper:";

function isLibraryPaper(docId: string): boolean {
  return docId.startsWith(LIBRARY_PAPER_PREFIX);
}

function libraryPaperCitekey(docId: string): string {
  return docId.slice(LIBRARY_PAPER_PREFIX.length);
}

/**
 * Build the API URL for a doc's file. Library papers route through
 * the dev-library endpoint; main-app docs use the regular dev API.
 * `path` is the file path relative to the doc folder (e.g.
 * "main.tex", "virgil/notes.json", "references.bib").
 */
function docFileUrl(docId: string, path: string): string {
  if (isLibraryPaper(docId)) {
    return `${LIBRARY_API}/papers/${libraryPaperCitekey(docId)}/${path}`;
  }
  return `${API}/doc/${docId}/${path}`;
}

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

async function fetchJsonIfExists<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function putText(url: string, body: string): Promise<void> {
  await fetch(url, { method: "PUT", body }).catch(() => {});
}

/**
 * Best-effort disk-ledger stamp (dev mirror of storage-fsa's `stampLedger`).
 * Re-stats `relPath` via the HEAD-backed `statFiles` AFTER the write/read so
 * the recorded `mtimeMs` is the dev server's real post-write value, combines
 * it with the known `content` bytes' hash, and stamps the ledger — so the
 * external-change watcher never misreads Virgil's own write as an external
 * change (design: docs/memos/external-change-badge/DESIGN.md §3).
 *
 * NEVER throws: a stat failure during stamping must not break a save or load.
 */
async function stampLedger(
  docId: string,
  relPath: string,
  content: string,
): Promise<void> {
  try {
    const stats = await statFiles(docId, [relPath]);
    const stat = stats[relPath];
    if (!stat) return; // absent on re-stat — nothing authoritative to record
    stampDiskFingerprint(docId, relPath, fingerprintOf(stat, content));
  } catch (e) {
    console.warn(`[storage-dev] disk-ledger stamp failed for ${relPath}:`, e);
  }
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
  lastParagraphId: null,
  foldedSections: [],
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
  return fetchJson<T>(docFileUrl(docId, `virgil/${filename}`), defaultValue);
}

export async function readSidecarIfExists<T>(
  docId: string,
  filename: string,
): Promise<T | null> {
  return fetchJsonIfExists<T>(docFileUrl(docId, `virgil/${filename}`));
}

export async function writeSidecar<T>(
  h: DocWriteHandle,
  filename: string,
  data: T,
): Promise<void> {
  // Parity with storage-fsa: library-paper docs are read-only and must never
  // persist sidecars. Without this, the dev backend silently PUTs to
  // /api/dev-library, corrupting the read-only source (and masking the FSA
  // "No folder handle stored" throw the Reader hits in production).
  if (isLibraryPaper(h.docId)) return;
  assertActive(h);
  await putText(docFileUrl(h.docId, `virgil/${filename}`), JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// Raw .tex file
// ---------------------------------------------------------------------------

export async function readTex(docId: string): Promise<string> {
  // Library papers always use main.tex; main-app docs look up their
  // texFilename in the dev index.
  if (isLibraryPaper(docId)) {
    return (await fetchText(docFileUrl(docId, "main.tex"))) ?? DEFAULT_LATEX;
  }
  const docs = await getDevIndex();
  const entry = findEntry(docs, docId);
  const filename = entry ? texFilenameFromPath(entry.sourcePath) : "document.tex";
  return (await fetchText(`${API}/doc/${docId}/${filename}`)) ?? DEFAULT_LATEX;
}

export async function writeTex(h: DocWriteHandle, latex: string): Promise<void> {
  // Read-only library-paper docs never persist (parity with storage-fsa's
  // enqueueDocWrite funnel guard). The load-writeback / minted-UUID writeback
  // would otherwise PUT to the read-only source.
  if (isLibraryPaper(h.docId)) return;
  assertActive(h);
  const docs = await getDevIndex();
  const entry = findEntry(docs, h.docId);
  const filename = entry ? texFilenameFromPath(entry.sourcePath) : "document.tex";
  await putText(`${API}/doc/${h.docId}/${filename}`, latex);
  // Stamp the ledger with the authoritative post-write fingerprint.
  await stampLedger(h.docId, filename, latex);
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

  // Baseline the disk ledger from what we just read. Superseded below by the
  // load-writeback stamp if the writeback fires — that's correct, the
  // writeback is the newer authoritative on-disk state.
  await stampLedger(docId, texFilename, latex);

  const content = parseLatex(latex, sidecar);
  // Assign UUIDs immediately on load so every paragraph is addressable
  // from the moment the editor opens (no waiting for the first save).
  // Persist back to disk so the .tex file stays in sync — but only
  // when (a) we're inside an active pipeline for this docId and (b)
  // that pipeline is still the active one when the writeback fires.
  // Without those guards, a read kicked off during a doc switch could
  // race a newer pipeline's load and write stale-derived content to
  // the wrong file (the pipeline guard is normally what catches this).
  assignUuids(content);
  const newSidecar = extractSidecarData(content);
  const delimiters = extractPreambleAndPostamble(latex);
  const newLatex = serializeToLatex(content, delimiters ?? undefined);
  const writebackHandle = getActiveHandle(docId);
  // Read-only library-paper docs never persist — skip the opportunistic
  // load-writeback (the tex + virgil.json PUTs observed in the live smoke).
  // Parity with the storage-fsa enqueueDocWrite funnel guard.
  if (writebackHandle && !isLibraryPaper(docId)) {
    // Fire-and-forget — don't block the editor from opening. The
    // `isActive` re-check inside the closure rejects the writeback if
    // the pipeline was superseded between read and write.
    void (async () => {
      try {
        if (!isActive(writebackHandle)) return;
        await Promise.all([
          putText(`${API}/doc/${docId}/${texFilename}`, newLatex),
          putText(`${API}/doc/${docId}/virgil/virgil.json`, JSON.stringify(newSidecar, null, 2)),
        ]);
        // CRITICAL false-positive guard (parity with storage-fsa): the load-
        // writeback rewrites the .tex seconds after load. Stamp with the bytes
        // we just wrote so the watcher recognizes it as Virgil's own write.
        await stampLedger(docId, texFilename, newLatex);
      } catch {
        // Silent — this is an opportunistic UUID-stamp, not a save.
      }
    })();
  }
  return { content, editorState };
}

export async function writeDocBundle(
  h: DocWriteHandle,
  content: JSONContent,
): Promise<void> {
  // Read-only library-paper docs never persist (parity with storage-fsa).
  if (isLibraryPaper(h.docId)) return;
  assertActive(h);
  const docs = await getDevIndex();
  const entry = findEntry(docs, h.docId);
  const texFilename = entry ? texFilenameFromPath(entry.sourcePath) : "document.tex";

  // Same sidecar/uuid logic as the FSA version.
  const existingSidecar = await fetchJson<VirgilSidecar>(
    `${API}/doc/${h.docId}/virgil/virgil.json`,
    DEFAULT_SIDECAR,
  );
  // recoverOrphanedUuids disabled — fingerprint matching causes UUID collisions.
  // Lost UUIDs get fresh ones via assignUuids instead.
  assignUuids(content);

  // Preserve the user's preamble/postamble by re-reading the existing
  // .tex file. The editor never sees these chunks, so the disk is the
  // only source of truth for them.
  const existingLatex = (await fetchText(`${API}/doc/${h.docId}/${texFilename}`)) ?? "";
  const delimiters = extractPreambleAndPostamble(existingLatex);

  const newSidecar = extractSidecarData(content);
  // Brand-new docs (no \begin{document}) seed their preamble from the
  // doc's selected style; existing docs keep their verbatim preamble.
  let serializeOpts: { preamble?: string } | undefined = delimiters ?? undefined;
  if (!delimiters) {
    const rawSettings = await fetchJson<unknown>(
      `${API}/doc/${h.docId}/virgil/document-settings.json`,
      { styleId: DEFAULT_STYLE_ID },
    );
    const settings = migrateDocumentSettings(rawSettings);
    serializeOpts = { preamble: resolveStyle(settings.styleId).preamble };
  }
  const latex = serializeToLatex(content, serializeOpts);

  // Re-check before the actual writes — a doc switch could have
  // landed between the awaits above. Lenient: an ended-cleanly pipeline
  // is still safe to write to, only a SUPERSEDED one would corrupt.
  assertNotSuperseded(h);
  // editor-state.json is owned by useEditorUIState, not the bundle save.
  await Promise.all([
    putText(`${API}/doc/${h.docId}/${texFilename}`, latex),
    putText(`${API}/doc/${h.docId}/virgil/virgil.json`, JSON.stringify(newSidecar, null, 2)),
  ]);
  // Stamp the ledger with the FINAL serialized .tex that hit disk (preamble
  // preserved), not the JSONContent — so the next poll matches exactly.
  await stampLedger(h.docId, texFilename, latex);
}

// ---------------------------------------------------------------------------
// Bibliography
// ---------------------------------------------------------------------------

const BIB_DECL_RE = /\\(?:bibliography|addbibresource)\{([^}]+)\}/;

/**
 * Resolve the .bib filename for a doc WITHOUT touching the ledger or reading
 * the .bib content (dev parity with storage-fsa's `getBibFilename`). The
 * watcher uses this for watched-set name resolution; a plain name lookup must
 * never re-baseline the ledger (the anti-flicker invariant: only load +
 * writes stamp). It reads the .tex (non-stamping `readTex`) to find
 * `\bibliography{}`/`\addbibresource{}`, falling back to `references.bib`.
 */
export async function getBibFilename(docId: string): Promise<string> {
  const tex = await readTex(docId);
  const m = tex.match(BIB_DECL_RE);
  let bibFilename = "references.bib";
  if (m) {
    bibFilename = m[1].trim();
    if (!bibFilename.endsWith(".bib")) bibFilename += ".bib";
  }
  return bibFilename;
}

export async function readBib(docId: string): Promise<BibReadResult> {
  const tex = await readTex(docId);
  const m = tex.match(BIB_DECL_RE);
  let bibFilename = "references.bib";
  if (m) {
    bibFilename = m[1].trim();
    if (!bibFilename.endsWith(".bib")) bibFilename += ".bib";
  }
  const bibText = (await fetchText(docFileUrl(docId, bibFilename))) ?? "";
  // NOTE: readBib is a PURE reader — it does NOT stamp the disk ledger. The
  // .bib baseline is established by the watcher's PRIME pass + by writeBib.
  // Baselining here would let the watcher's own confirm-read re-baseline the
  // very external edit it is trying to surface (the flicker bug). See
  // docs/memos/external-change-badge/DESIGN.md §3.
  const detectedPackage = detectBibPackage(tex);
  return { bibText, bibFilename, detectedPackage };
}

export async function writeBib(h: DocWriteHandle, bibText: string): Promise<void> {
  // Read-only library-paper docs never persist (parity with storage-fsa).
  if (isLibraryPaper(h.docId)) return;
  assertActive(h);
  const tex = await readTex(h.docId);
  const m = tex.match(BIB_DECL_RE);
  let bibFilename = "references.bib";
  if (m) {
    bibFilename = m[1].trim();
    if (!bibFilename.endsWith(".bib")) bibFilename += ".bib";
  }
  assertNotSuperseded(h);
  await putText(docFileUrl(h.docId, bibFilename), bibText);
  // Stamp the ledger with the authoritative post-write .bib fingerprint.
  await stampLedger(h.docId, bibFilename, bibText);
}

// ---------------------------------------------------------------------------
// Compiled PDF
// ---------------------------------------------------------------------------

export function pdfFilenameFromTex(texFilename: string): string {
  return texFilename.replace(/\.tex$/i, "") + ".pdf";
}

export async function getPdfFilename(docId: string): Promise<string> {
  const docs = await getDevIndex();
  const entry = findEntry(docs, docId);
  const texFilename = entry ? texFilenameFromPath(entry.sourcePath) : "document.tex";
  return pdfFilenameFromTex(texFilename);
}

export async function writePdf(h: DocWriteHandle, pdfBytes: Uint8Array): Promise<void> {
  // Read-only library-paper docs never persist (parity with storage-fsa).
  if (isLibraryPaper(h.docId)) return;
  assertActive(h);
  const filename = await getPdfFilename(h.docId);
  assertNotSuperseded(h);
  await fetch(`${API}/doc/${h.docId}/${filename}`, {
    method: "PUT",
    body: pdfBytes.buffer as ArrayBuffer,
    headers: { "Content-Type": "application/octet-stream" },
  });
}

export async function readPdf(docId: string): Promise<Uint8Array | null> {
  try {
    const filename = await getPdfFilename(docId);
    const resp = await fetch(`${API}/doc/${docId}/${filename}`);
    if (!resp.ok) return null;
    return new Uint8Array(await resp.arrayBuffer());
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Figure raster cache (`<paper>/virgil/figures-cache/`) — dev-mode
// implementation. Mirrors the storage-fsa surface but routes through the
// dev HTTP endpoints. The cache is real files on disk so multiple windows
// see the same cached webp.
// ---------------------------------------------------------------------------

const FIGURE_PROBE_EXTS = ["pdf", "png", "jpg", "jpeg", "webp"];

export interface FigureSourceFile {
  bytes: ArrayBuffer;
  ext: string;
  fingerprint: string;
}

export async function readFigureSource(
  docId: string,
  source: string,
): Promise<FigureSourceFile | null> {
  if (!source) return null;
  const parts = source.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  const filename = parts[parts.length - 1];
  const subdir = parts.slice(0, -1).join("/");
  const prefix = subdir ? `${subdir}/` : "";
  const dotIdx = filename.lastIndexOf(".");
  const candidates =
    dotIdx > 0
      ? [{ name: filename, ext: filename.slice(dotIdx + 1).toLowerCase() }]
      : FIGURE_PROBE_EXTS.map((ext) => ({ name: `${filename}.${ext}`, ext }));
  for (const c of candidates) {
    const url = docFileUrl(docId, `${prefix}${c.name}`);
    const resp = await fetch(url);
    if (!resp.ok) continue;
    const bytes = await resp.arrayBuffer();
    // Server should send Last-Modified + Content-Length but we degrade to
    // size+url if it doesn't (cache key will still be unique per URL).
    const lastMod = resp.headers.get("last-modified") || "";
    const len = resp.headers.get("content-length") || String(bytes.byteLength);
    return { bytes, ext: c.ext, fingerprint: `${lastMod}:${len}` };
  }
  return null;
}

export async function readFigureRaster(
  docId: string,
  cacheKey: string,
): Promise<Blob | null> {
  const url = docFileUrl(docId, `virgil/figures-cache/${cacheKey}.webp`);
  const resp = await fetch(url);
  if (!resp.ok) return null;
  return resp.blob();
}

export async function writeFigureRaster(
  h: DocWriteHandle,
  cacheKey: string,
  blob: Blob,
): Promise<void> {
  // Read-only library-paper docs never persist (parity with storage-fsa).
  if (isLibraryPaper(h.docId)) return;
  assertActive(h);
  assertNotSuperseded(h);
  await fetch(docFileUrl(h.docId, `virgil/figures-cache/${cacheKey}.webp`), {
    method: "PUT",
    body: await blob.arrayBuffer(),
    headers: { "Content-Type": "image/webp" },
  });
}

export async function deleteFigureRaster(
  h: DocWriteHandle,
  cacheKey: string,
): Promise<void> {
  // Read-only library-paper docs never mutate the source (parity with
  // storage-fsa, where deleteFigureRaster routes through enqueueDocWrite).
  if (isLibraryPaper(h.docId)) return;
  assertActive(h);
  assertNotSuperseded(h);
  await fetch(docFileUrl(h.docId, `virgil/figures-cache/${cacheKey}.webp`), {
    method: "DELETE",
  });
}

export async function readFigureIndex(
  docId: string,
): Promise<Record<string, { source: string; mtimeMs: number; size: number }>> {
  const url = docFileUrl(docId, "virgil/figures-cache/index.json");
  const text = await fetchText(url);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export async function writeFigureIndex(
  h: DocWriteHandle,
  index: Record<string, { source: string; mtimeMs: number; size: number }>,
): Promise<void> {
  // Read-only library-paper docs never persist (parity with storage-fsa).
  if (isLibraryPaper(h.docId)) return;
  assertActive(h);
  assertNotSuperseded(h);
  await putText(
    docFileUrl(h.docId, "virgil/figures-cache/index.json"),
    JSON.stringify(index, null, 2),
  );
}

// Stub so the storage facade compiles — dev callers walk via HTTP.
export async function requireDocHandleForRead(): Promise<never> {
  throw new Error("requireDocHandleForRead is not available in dev storage mode");
}

// ---------------------------------------------------------------------------
// File-stat capability — cheap {mtimeMs, size} fingerprints for the
// external-change watcher (design: docs/memos/external-change-badge/DESIGN.md
// §8). Issues a HEAD per file so a poll tick doesn't download the whole .tex.
// The dev route's HEAD branch returns Last-Modified + Content-Length only.
// ---------------------------------------------------------------------------

/** Cheap on-disk fingerprint of a single file (the poll trigger). */
export type FileStat = { mtimeMs: number; size: number };

/**
 * Stat a set of files relative to the doc folder. Returns a map keyed by the
 * SAME `relPaths` passed in; a `null` value means the file is absent (404).
 *
 * For each path we HEAD `docFileUrl(docId, relPath)` and parse the two
 * headers: `Last-Modified` → ms-since-epoch for `mtimeMs`, `Content-Length` →
 * `size`. A non-OK response (404) → `null`. A network/fetch error also → null
 * (the watcher treats a transient failure as "no observation this tick"
 * rather than a delete; only the FSA permission-loss path throws).
 */
export async function statFiles(
  docId: string,
  relPaths: string[],
): Promise<Record<string, FileStat | null>> {
  const out: Record<string, FileStat | null> = {};
  await Promise.all(
    relPaths.map(async (relPath) => {
      out[relPath] = await statOneFile(docId, relPath);
    }),
  );
  return out;
}

async function statOneFile(
  docId: string,
  relPath: string,
): Promise<FileStat | null> {
  try {
    const res = await fetch(docFileUrl(docId, relPath), { method: "HEAD" });
    if (!res.ok) return null;
    const lastMod = res.headers.get("last-modified");
    const len = res.headers.get("content-length");
    const mtimeMs = lastMod ? new Date(lastMod).getTime() : 0;
    const size = len ? Number(len) : 0;
    return {
      mtimeMs: Number.isFinite(mtimeMs) ? mtimeMs : 0,
      size: Number.isFinite(size) ? size : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Read the text content of the EXACT `relPath` under the doc folder —
 * NON-STAMPING, NO name re-resolution (dev mirror of storage-fsa's
 * `readTextFile`). GET `docFileUrl(docId, relPath)`; a non-OK response (404) or
 * a network error → `null`. This is the generic reader the external-change
 * watcher uses for both its prime baseline and confirm-by-hash read, so the
 * bytes it hashes are the same file it just stat'd. NEVER touches the ledger.
 */
export async function readTextFile(
  docId: string,
  relPath: string,
): Promise<string | null> {
  return fetchText(docFileUrl(docId, relPath));
}

// Re-export the same active-handle helper so the storage facade has it
// regardless of backend.
export { getActiveHandle as getDocWriteHandle } from "@/lib/multi-window/doc-pipeline";

/** Dev-backend mirror of `storage-fsa.ts`'s `importFigureFile`.
 *
 *  The dev backend can't replicate FSA's `docHandle.resolve(fileHandle)`
 *  same-folder short-circuit — there are no `FileSystemFileHandle`s here
 *  (the picker fell back to `<input type="file">`, which yields a bare
 *  `File`). We always copy into `<paper>/<subdir>/<basename>` via the
 *  existing PUT route, which already handles binary uploads and creates
 *  parent dirs (see `src/app/api/dev/[...path]/route.dev.ts`'s PUT).
 *
 *  Honors the same signature as the FSA version so the storage facade
 *  re-export works without per-backend branching at call sites.
 */
export async function importFigureFile(
  h: DocWriteHandle,
  picked: PickedFigureFile,
  subdir: string = "figures",
): Promise<string> {
  const basename = picked.file.name;
  const destPath = `${subdir}/${basename}`;
  // Read-only library-paper docs never persist — skip the copy-in PUT and
  // just return the would-be relative path (parity with storage-fsa, whose
  // byte write funnels through the guarded enqueueDocWrite).
  if (isLibraryPaper(h.docId)) return destPath;
  assertActive(h);
  assertNotSuperseded(h);
  const url = docFileUrl(h.docId, destPath);
  // Reuse the figure-raster MIME conventions — the PUT route inspects
  // Content-Type to decide whether to read the body as binary or text.
  const contentType = picked.file.type || "application/octet-stream";
  const buf = await picked.file.arrayBuffer();
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: buf,
  });
  if (!res.ok) {
    throw new Error(
      `[storage-dev] importFigureFile PUT ${url} failed: ${res.status}`,
    );
  }
  return destPath;
}

// ---------------------------------------------------------------------------
// Document creation, opening, and index management
// ---------------------------------------------------------------------------

export async function createDocFromPicker(
  rawName: string,
  templateId?: string,
): Promise<FsaDocMeta> {
  const name = rawName.trim();
  if (!name) throw new Error("Paper name is required");
  const tid = templateId ?? DEFAULT_TEMPLATE_ID;
  if (!DOCUMENT_TEMPLATES.some((t) => t.id === tid)) {
    throw new Error(`Unknown template: ${tid}`);
  }
  const res = await fetch(`${API}/_create-doc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, templateId: tid }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to create doc: ${res.status} ${text}`);
  }
  const meta = (await res.json()) as FsaDocMeta;
  _cachedIndex = null;
  return meta;
}

export async function createDocInFolder(
  _handle: FileSystemDirectoryHandle,
  _rawName: string,
  _templateId?: string,
): Promise<FsaDocMeta> {
  throw new Error(
    "createDocInFolder is not available in dev storage mode — use createDocFromPicker",
  );
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
      lastAccessedAt: d.lastModifiedAt,
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
// Paper folder enumeration (for the compile pipeline)
// ---------------------------------------------------------------------------

export interface PaperFile {
  path: string;
  bytes: Uint8Array;
}

export async function readPaperFolder(docId: string): Promise<PaperFile[]> {
  const resp = await fetch(`${API}/doc/${docId}/_all-files`);
  if (!resp.ok) {
    throw new Error(`readPaperFolder failed: ${resp.status}`);
  }
  const { files } = (await resp.json()) as {
    files: { path: string; base64: string }[];
  };
  return files.map((f) => ({ path: f.path, bytes: base64ToBytes(f.base64) }));
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function getTexFilename(docId: string): Promise<string> {
  const docs = await getDevIndex();
  const entry = findEntry(docs, docId);
  return entry ? texFilenameFromPath(entry.sourcePath) : "document.tex";
}

// ---------------------------------------------------------------------------
// Drain helpers — no-op in dev mode (no write queue)
// ---------------------------------------------------------------------------

export async function flushDoc(_docId: string): Promise<void> {}
