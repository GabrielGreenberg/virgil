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
import { ALL_SIDECAR_FILENAMES } from "@/lib/sidecar-files";
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
  getActiveHandle,
  isActive,
  type DocWriteHandle,
} from "@/lib/multi-window/doc-pipeline";
import {
  DOCUMENT_TEMPLATES,
  DEFAULT_TEMPLATE_ID,
  type DocumentTemplate,
} from "@/lib/document-templates";
import { getLibraryHandle } from "@library/lib/library-folder";
import { stampDiskFingerprint, fingerprintOf } from "@/lib/disk-ledger";

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
  lastParagraphId: null,
  foldedSections: [],
  lastModified: new Date().toISOString(),
};

const DEFAULT_SIDECAR: VirgilSidecar = { paragraphs: {} };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Read a doc's directory handle, throwing a clear error if it isn't there.
 *
 * Fast-path: the per-doc registry (`getDocHandle`) — populated by the picker
 * for normal docs, and one-shot by `PaperRender` for the active library
 * Reader. When that's absent for a `library-paper:<citekey>` doc — a Reader
 * teardown/remount race, or a non-Reader read (view-session auto-open, façade
 * reads) — fall back to resolving the handle on demand from the mounted
 * library folder. This keeps READS working without relying on PaperRender's
 * racy registration; it does NOT re-enable writes, which short-circuit earlier
 * at the `enqueueDocWrite` library-paper guard (before any `requireDocHandle`
 * call in the task body). A normal doc with no registered handle still throws
 * the same diagnostic — the fallback is gated on the `library-paper:` prefix. */
async function requireDocHandle(
  docId: string,
): Promise<FileSystemDirectoryHandle> {
  const h = await getDocHandle(docId);
  if (h) return h; // registered fast-path — unchanged, still wins
  if (docId.startsWith(LIBRARY_PAPER_PREFIX)) {
    const dir = await resolveLibraryPaperDir(docId);
    if (dir) return dir;
  }
  throw new Error(`No folder handle stored for doc ${docId}`);
}

/** On-demand resolve of a `library-paper:<citekey>` doc's directory handle
 *  from the mounted library folder (`<library>/papers/<citekey>/`). Returns
 *  null when the library isn't mounted or the paper dir is missing mid-index,
 *  so the caller falls through to the same "No folder handle stored" throw. */
async function resolveLibraryPaperDir(
  docId: string,
): Promise<FileSystemDirectoryHandle | null> {
  const citekey = docId.slice(LIBRARY_PAPER_PREFIX.length);
  const lib = await getLibraryHandle();
  if (!lib) return null;
  try {
    const papers = await lib.getDirectoryHandle("papers");
    return await papers.getDirectoryHandle(citekey);
  } catch {
    return null; // NotFound mid-index → null → same diagnostic throw
  }
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
  // Read-only library-paper docs never persist — enforce the documented
  // invariant at the single write funnel. Every card-hook sidecar write, the
  // load-writeback (tex + bundle), bib, pdf, and the figure writers all pass
  // through here, so this one guard covers the entire write class. Reads
  // (`readSidecar`/`readTex`/`getTexFileHandle`/`requireDocHandleForRead`) call
  // `requireDocHandle` directly and bypass this funnel, so library-paper reads
  // keep working. The skipped writes resolve to `undefined`; every caller is a
  // void write (`Promise<void>` / `Promise<string>` figure-import), none relies
  // on a meaningful resolved value.
  if (h.docId.startsWith(LIBRARY_PAPER_PREFIX))
    return Promise.resolve(undefined as T);
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

// On mount ~17 hooks each independently re-acquire the doc handle, re-enter
// `virgil/`, and read one file. We coalesce them: the first read for a docId
// reads ALL `ALL_SIDECAR_FILENAMES` in ONE directory acquire + a parallel
// batch, cached per docId, so the other 16 hooks (and any same-session re-read)
// hit memory.
interface SidecarBundle {
  // filename → parsed JSON, or null = CONFIRMED absent (a NotFoundError on
  // read). A filename is ABSENT from this map when its read threw a NON-
  // NotFound error (corrupt/truncated JSON, transient IO) — so the cache-first
  // `readSidecarIfExists` falls through to a direct disk read that re-throws,
  // preserving `usePersistentState`'s `loadError` data-loss guard.
  files: Map<string, unknown | null>;
  inflight: Promise<void> | null;
}
const sidecarCache = new Map<string, SidecarBundle>();

async function readOneSidecarInto(
  virgil: FileSystemDirectoryHandle,
  filename: string,
  files: Map<string, unknown | null>,
): Promise<void> {
  try {
    const fileHandle = await virgil.getFileHandle(filename);
    const text = await readTextFromHandle(fileHandle);
    files.set(filename, JSON.parse(text));
  } catch (e) {
    if (isNotFound(e)) files.set(filename, null); // confirmed absent
    // Non-NotFound: leave UNSET so the per-file fallback re-throws (loadError).
  }
}

/** The bundle for `docId`, creating + kicking off its one-shot whole-`virgil/`
 *  read on first touch. Subsequent callers share the same `inflight`. */
function ensureSidecarBundle(docId: string): SidecarBundle {
  let bundle = sidecarCache.get(docId);
  if (bundle) return bundle;
  bundle = { files: new Map(), inflight: null };
  sidecarCache.set(docId, bundle);
  const run = (async () => {
    let virgil: FileSystemDirectoryHandle;
    try {
      const docHandle = await requireDocHandle(docId);
      virgil = await getVirgilSubdir(docHandle);
    } catch {
      // Unresolvable handle (e.g. a library paper with no granted folder) —
      // leave the bundle empty; the per-file fallback reproduces today's error.
      return;
    }
    await Promise.all(
      ALL_SIDECAR_FILENAMES.map((f) => readOneSidecarInto(virgil, f, bundle!.files)),
    );
  })();
  bundle.inflight = run.finally(() => {
    const cur = sidecarCache.get(docId);
    if (cur === bundle && cur.inflight === run) cur.inflight = null;
  });
  return bundle;
}

/** Pre-warm the sidecar bundle for a doc (optional — `readSidecarIfExists`
 *  self-primes too). Returns when the one directory read has settled. */
export async function readSidecarBundle(docId: string): Promise<void> {
  const bundle = ensureSidecarBundle(docId);
  if (bundle.inflight) await bundle.inflight;
}

/** Drop the cached sidecar snapshot for a doc so the next read re-hits disk.
 *  Called on pipeline end (cold remount → fresh read) and on a confirmed
 *  external change (a skill rewriting the paper folder). */
export function invalidateSidecarBundle(docId: string): void {
  sidecarCache.delete(docId);
}

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
  // Cache-first: the bundle coalesces all of a mount's sidecar reads into one
  // directory walk. `has(filename)` distinguishes "bundled (value or confirmed
  // null)" from "not bundled" (outside ALL_SIDECAR_FILENAMES, or left UNSET by a
  // non-NotFound read error). Not-bundled falls through to the direct read,
  // which re-throws real errors → preserves the `loadError` data-loss guard.
  const bundle = ensureSidecarBundle(docId);
  if (bundle.inflight) await bundle.inflight;
  if (bundle.files.has(filename)) {
    return (bundle.files.get(filename) ?? null) as T | null;
  }
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
  // Read-only library-paper docs never persist — the guard lives at the
  // `enqueueDocWrite` funnel below, which this (and every other writer) routes
  // through.
  return enqueueDocWrite(h, `virgil/${filename}`, async () => {
    const docHandle = await requireDocHandle(h.docId);
    const virgil = await getVirgilSubdir(docHandle);
    const fileHandle = await virgil.getFileHandle(filename, { create: true });
    await writeTextToHandle(fileHandle, JSON.stringify(data, null, 2));
    // Keep the bundle coherent: the value we just wrote IS the freshest, so
    // update it in place rather than invalidating (a read-after-write sees it).
    const bundle = sidecarCache.get(h.docId);
    if (bundle) bundle.files.set(filename, data);
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
    const meta = await getDocMetaOrThrow(h.docId);
    const fh = await getTexFileHandle(h.docId, { create: true });
    await writeTextToHandle(fh, latex);
    await touchDocTimestamp(h.docId);
    // Stamp the ledger with the authoritative post-write fingerprint so the
    // watcher never misreads this write as an external change.
    await stampLedger(h.docId, meta.texFilename, latex);
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
  // Baseline the disk ledger from what we just read. If the load-writeback
  // fires below it supersedes this stamp with the re-stamped bytes — correct,
  // since the writeback is the newer authoritative on-disk state. `stampLedger`
  // re-stats, so a missing .tex (latex === DEFAULT_LATEX fallback) is skipped.
  await stampLedger(docId, meta.texFilename, latex);
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

  // Persist the re-stamped .tex (+ sidecar) back to disk on load, so a
  // UUID minted here for a paragraph that lacked a `%!v:` marker is
  // durable BEFORE the editor mounts — not volatile until the next
  // 1500 ms autosave. Without this, a card anchored to a load-minted
  // UUID orphans on the next reload (the production-only window the dev
  // backend never exposes, because storage-dev already writes back here).
  // Parity with storage-dev.readDocBundle; reuses writeDocBundle's
  // preamble-preserving serialize so we never clobber the user's
  // preamble/postamble.
  //
  // Guarded by the active-handle / pipeline check: a read kicked off
  // during a doc switch must not write stale-derived content to the
  // newer doc's file. `getActiveHandle` pins the destination to the
  // pipeline currently registered for this docId, and routing through
  // `enqueueDocWrite` re-checks staleness twice — strictly at enqueue
  // (assertActive) and leniently inside the queued task
  // (assertNotSuperseded) — so a superseded read can't overwrite the
  // wrong .tex. Sharing the "bundle" subkey serializes this writeback
  // against any concurrent real writeDocBundle for the same doc.
  const writebackHandle = getActiveHandle(docId);
  if (writebackHandle && isActive(writebackHandle)) {
    // Fire-and-forget — don't block the editor from opening. A failed
    // UUID-stamp writeback is opportunistic, not a save error.
    void writeReStampedTexOnLoad(writebackHandle, content, latex).catch(() => {
      // Silent — staleness rejections and FSA errors are non-fatal here.
    });
  }

  return { content, editorState };
}

/**
 * Opportunistic load-writeback: serialize the just-re-stamped `content`
 * (preserving the user's preamble/postamble verbatim, exactly as
 * `writeDocBundle` does) and write the `.tex` + `virgil.json` sidecar
 * back to disk. Routed through `enqueueDocWrite` so it inherits the
 * pipeline staleness guard (so a read during a doc switch can't write to
 * the wrong file) and serializes against real bundle writes for this doc.
 *
 * `existingLatex` is the raw `.tex` we already read in `readDocBundle`,
 * reused as the preamble source — no second disk read on the load path.
 */
async function writeReStampedTexOnLoad(
  h: DocWriteHandle,
  content: JSONContent,
  existingLatex: string,
): Promise<void> {
  // The caller already ran assignUuids on `content`. recoverOrphanedUuids
  // stays disabled (same rationale as writeDocBundle — fingerprint
  // matching causes UUID collisions).
  //
  // Preserve the user's preamble/postamble verbatim. Mirror writeDocBundle:
  // for an existing doc the delimiters come straight off the .tex; only a
  // brand-new / empty doc (no \begin{document}) seeds a preamble, here from
  // the doc's selected style.
  const delimiters = extractPreambleAndPostamble(existingLatex);
  const newSidecar = extractSidecarData(content);

  await enqueueDocWrite(h, "bundle", async () => {
    const docHandle = await requireDocHandle(h.docId);
    const meta = await getDocMetaOrThrow(h.docId);
    const virgil = await getVirgilSubdir(docHandle);

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

    // Snapshot the prior bundle before overwriting — same forensic safety
    // net writeDocBundle uses.
    await snapshotPriorBundle(docHandle, virgil, meta.texFilename);

    const texFh = await docHandle.getFileHandle(meta.texFilename, {
      create: true,
    });
    await writeTextToHandle(texFh, latex);

    const sidecarFh = await virgil.getFileHandle("virgil.json", {
      create: true,
    });
    await writeTextToHandle(sidecarFh, JSON.stringify(newSidecar, null, 2));

    await touchDocTimestamp(h.docId);
    // CRITICAL false-positive guard: the load-writeback is the #1 source of
    // spurious "changed on disk" — it rewrites the .tex seconds after load
    // (minted-UUID markers). Stamp the ledger with the bytes we just wrote so
    // the watcher recognizes this as Virgil's own write, not an external edit.
    await stampLedger(h.docId, meta.texFilename, latex);
  });
}

export async function writeDocBundle(
  h: DocWriteHandle,
  content: JSONContent,
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

    // editor-state.json is owned by useEditorUIState, not the bundle save.

    await touchDocTimestamp(h.docId);
    // Stamp the ledger with the FINAL serialized .tex that hit disk (preamble
    // preserved), not the JSONContent — so the next poll matches exactly.
    await stampLedger(h.docId, meta.texFilename, latex);
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

/**
 * Resolve the .bib filename for a doc WITHOUT touching the ledger or reading
 * the .bib content. The watcher uses this for watched-set name resolution so
 * a plain name lookup never re-baselines anything (the anti-flicker
 * invariant: only load + writes stamp the ledger, never reads). It reads the
 * .tex via the non-stamping `safeReadText` inside `resolveBibFilename`.
 */
export async function getBibFilename(docId: string): Promise<string> {
  return resolveBibFilename(docId);
}

export async function readBib(docId: string): Promise<BibReadResult> {
  const docHandle = await requireDocHandle(docId);
  const meta = await getDocMetaOrThrow(docId);
  const bibFilename = await resolveBibFilename(docId);
  const bibText = await safeReadText(docHandle, bibFilename, "");
  // NOTE: readBib is a PURE reader — it does NOT stamp the disk ledger. The
  // .bib baseline is established by the watcher's PRIME pass + by writeBib;
  // baselining here would let the watcher's own confirm-read re-baseline the
  // very external edit it is trying to surface (the flicker bug). See
  // docs/memos/external-change-badge/DESIGN.md §3.
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
    // Stamp the ledger with the authoritative post-write .bib fingerprint.
    await stampLedger(h.docId, bibFilename, bibText);
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
// Figure raster cache (`<paper>/virgil/figures-cache/`)
//
// One WebP per source file, keyed by SHA-1(source + mtime + size). The
// raster is the on-screen-resolution version of the original — we never
// load full-res PDFs / images into the editor view. An `index.json`
// sidecar lets us cheaply prune orphans and surface debug info.
//
// All writes go through `enqueueDocWrite` with key prefix `figures/` for
// per-key serialization; reads bypass the queue (they can race with
// writes safely since FSA reads return a stable file snapshot).
// ---------------------------------------------------------------------------

const FIGURES_CACHE_DIR = "figures-cache";
const FIGURE_INDEX_FILE = "index.json";

async function getFiguresCacheDir(
  docHandle: FileSystemDirectoryHandle,
  opts: { create?: boolean } = {},
): Promise<FileSystemDirectoryHandle> {
  const virgil = await getVirgilSubdir(docHandle);
  return virgil.getDirectoryHandle(FIGURES_CACHE_DIR, { create: opts.create ?? false });
}

/** Read a cached figure raster, or null if the entry hasn't been written. */
export async function readFigureRaster(
  docId: string,
  cacheKey: string,
): Promise<Blob | null> {
  try {
    const docHandle = await requireDocHandle(docId);
    const cacheDir = await getFiguresCacheDir(docHandle);
    const fh = await cacheDir.getFileHandle(`${cacheKey}.webp`);
    return await fh.getFile();
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

export async function writeFigureRaster(
  h: DocWriteHandle,
  cacheKey: string,
  blob: Blob,
): Promise<void> {
  return enqueueDocWrite(h, `figures/${cacheKey}`, async () => {
    const docHandle = await requireDocHandle(h.docId);
    const cacheDir = await getFiguresCacheDir(docHandle, { create: true });
    const fh = await cacheDir.getFileHandle(`${cacheKey}.webp`, { create: true });
    const writable = await fh.createWritable();
    await writable.write(await blob.arrayBuffer());
    await writable.close();
  });
}

export async function deleteFigureRaster(
  h: DocWriteHandle,
  cacheKey: string,
): Promise<void> {
  return enqueueDocWrite(h, `figures/${cacheKey}`, async () => {
    try {
      const docHandle = await requireDocHandle(h.docId);
      const cacheDir = await getFiguresCacheDir(docHandle);
      await cacheDir.removeEntry(`${cacheKey}.webp`);
    } catch (e) {
      if (isNotFound(e)) return;
      throw e;
    }
  });
}

export async function readFigureIndex(
  docId: string,
): Promise<Record<string, { source: string; mtimeMs: number; size: number }>> {
  try {
    const docHandle = await requireDocHandle(docId);
    const cacheDir = await getFiguresCacheDir(docHandle);
    const fh = await cacheDir.getFileHandle(FIGURE_INDEX_FILE);
    const text = await readTextFromHandle(fh);
    return JSON.parse(text);
  } catch (e) {
    if (isNotFound(e)) return {};
    throw e;
  }
}

export async function writeFigureIndex(
  h: DocWriteHandle,
  index: Record<string, { source: string; mtimeMs: number; size: number }>,
): Promise<void> {
  return enqueueDocWrite(h, "figures/index", async () => {
    const docHandle = await requireDocHandle(h.docId);
    const cacheDir = await getFiguresCacheDir(docHandle, { create: true });
    const fh = await cacheDir.getFileHandle(FIGURE_INDEX_FILE, { create: true });
    await writeTextToHandle(fh, JSON.stringify(index, null, 2));
  });
}

/** Read-only directory handle for a doc, for callers that need to walk
 *  arbitrary files (e.g. `\includegraphics` path resolution). Public
 *  variant of the module-private `requireDocHandle`. */
export async function requireDocHandleForRead(
  docId: string,
): Promise<FileSystemDirectoryHandle> {
  return requireDocHandle(docId);
}

// ---------------------------------------------------------------------------
// File-stat capability — cheap {mtimeMs, size} fingerprints for the
// external-change watcher (design: docs/memos/external-change-badge/DESIGN.md
// §8). Reuses the figure-source fingerprint idiom (getFile() → lastModified +
// size). getFile() does NOT take the write lock, so this is safe to call
// concurrently with writes; it returns a stable snapshot.
// ---------------------------------------------------------------------------

/** Cheap on-disk fingerprint of a single file (the poll trigger). */
export type FileStat = { mtimeMs: number; size: number };

/**
 * Stat a set of files relative to the paper root. Returns a map keyed by the
 * SAME `relPaths` passed in; a `null` value means the file is absent on disk.
 *
 * `relPaths` may be nested (e.g. "virgil/citations.json"): each is resolved
 * by walking `getDirectoryHandle` for every segment but the last, then
 * `getFileHandle` + `getFile()` for the final segment.
 *
 * On a missing file (`NotFoundError`) the entry is `null`. On a permission
 * loss (`NotAllowedError`) the original DOMException is RE-THROWN so the
 * caller (the watcher) can pause rather than misread it as a delete.
 */
export async function statFiles(
  docId: string,
  relPaths: string[],
): Promise<Record<string, FileStat | null>> {
  const docHandle = await requireDocHandleForRead(docId);
  const out: Record<string, FileStat | null> = {};
  await Promise.all(
    relPaths.map(async (relPath) => {
      out[relPath] = await statOneFile(docHandle, relPath);
    }),
  );
  return out;
}

/**
 * Best-effort ledger stamp: re-stat `relPath` AFTER a write/read settles so
 * the recorded `mtimeMs` is the OS's real post-write value, combine it with
 * the known `content` bytes' hash, and stamp the disk ledger. This is the
 * false-positive killer — it records "this is exactly what Virgil put on (or
 * read from) disk" so the watcher never misreads Virgil's own write as an
 * external change (design: docs/memos/external-change-badge/DESIGN.md §3).
 *
 * NEVER throws: a stat failure during stamping must not break a save or load.
 * On a stat miss (file vanished between write and re-stat — should not happen
 * but is harmless) we simply skip the stamp.
 */
async function stampLedger(
  docId: string,
  relPath: string,
  content: string,
): Promise<void> {
  try {
    const docHandle = await requireDocHandleForRead(docId);
    const stat = await statOneFile(docHandle, relPath);
    if (!stat) return; // absent on re-stat — nothing authoritative to record
    stampDiskFingerprint(docId, relPath, fingerprintOf(stat, content));
  } catch (e) {
    console.warn(`[storage] disk-ledger stamp failed for ${relPath}:`, e);
  }
}

/** Resolve+stat one possibly-nested relPath under a paper dir handle. */
async function statOneFile(
  docHandle: FileSystemDirectoryHandle,
  relPath: string,
): Promise<FileStat | null> {
  const parts = relPath.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  const filename = parts[parts.length - 1];
  const dirParts = parts.slice(0, -1);
  let dir = docHandle;
  try {
    for (const part of dirParts) {
      dir = await dir.getDirectoryHandle(part);
    }
    const fh = await dir.getFileHandle(filename);
    const file = await fh.getFile();
    return { mtimeMs: file.lastModified, size: file.size };
  } catch (e) {
    if (isNotFound(e)) return null;
    // NotAllowedError (permission lost) — re-throw so the watcher pauses
    // instead of reading a permission loss as a delete. Defer to
    // DocPermissionGate for re-grant.
    throw e;
  }
}

/**
 * Read the text content of the EXACT `relPath` under the paper root —
 * NON-STAMPING, NO name re-resolution. This is the generic reader the
 * external-change watcher uses for both its prime baseline and its
 * confirm-by-hash read, so the bytes it hashes are guaranteed to be the same
 * file it just stat'd (no mid-poll `.tex`-repoint race — `readTex`/`readBib`
 * re-resolve the filename and could read a different file than the one stat'd).
 *
 * Returns `null` if the file is absent (NotFoundError); RE-THROWS on permission
 * loss (NotAllowedError) so the watcher pauses rather than misreading it. The
 * resolution walk mirrors `statOneFile` exactly so stat and read see the same
 * path. This NEVER touches the disk ledger.
 */
export async function readTextFile(
  docId: string,
  relPath: string,
): Promise<string | null> {
  const docHandle = await requireDocHandleForRead(docId);
  const parts = relPath.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  const filename = parts[parts.length - 1];
  const dirParts = parts.slice(0, -1);
  let dir = docHandle;
  try {
    for (const part of dirParts) {
      dir = await dir.getDirectoryHandle(part);
    }
    const fh = await dir.getFileHandle(filename);
    return await readTextFromHandle(fh);
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

/** Backend-agnostic figure source reader.
 *
 * Used by the figure-rendering pipeline to read an `\includegraphics`
 * target file. Tries extensions in the standard graphicx order when the
 * source has none. Returns null on miss.
 *
 * `fingerprint` is the cache-key seed — for FSA we use mtime+size; the
 * dev backend uses the Last-Modified header.
 */
export interface FigureSourceFile {
  bytes: ArrayBuffer;
  ext: string;
  fingerprint: string;
}

const FIGURE_PROBE_EXTS = ["pdf", "png", "jpg", "jpeg", "webp"];

export async function readFigureSource(
  docId: string,
  source: string,
): Promise<FigureSourceFile | null> {
  if (!source) return null;
  const docHandle = await requireDocHandle(docId);
  const parts = source.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  const filename = parts[parts.length - 1];
  const dirParts = parts.slice(0, -1);
  let dir = docHandle;
  for (const part of dirParts) {
    try {
      dir = await dir.getDirectoryHandle(part);
    } catch {
      return null;
    }
  }
  const dotIdx = filename.lastIndexOf(".");
  const candidates =
    dotIdx > 0
      ? [{ name: filename, ext: filename.slice(dotIdx + 1).toLowerCase() }]
      : FIGURE_PROBE_EXTS.map((ext) => ({ name: `${filename}.${ext}`, ext }));
  for (const c of candidates) {
    try {
      const fh = await dir.getFileHandle(c.name);
      const file = await fh.getFile();
      return {
        bytes: await file.arrayBuffer(),
        ext: c.ext,
        fingerprint: `${file.lastModified}:${file.size}`,
      };
    } catch {
      // try next
    }
  }
  return null;
}

/** Backend-agnostic picked-figure descriptor.
 *
 *  Wraps the picked `File` (always present) and the optional
 *  `FileSystemFileHandle` (only when the FSA picker was used). The handle
 *  enables the FSA backend's "file is already inside the paper folder"
 *  short-circuit; without it, the backend always copies bytes in.
 *
 *  Produced by `pickFigureFile()` in `src/lib/figures/pick-file.ts`.
 */
export interface PickedFigureFile {
  file: File;
  handle: FileSystemFileHandle | null;
}

/** Import a figure file that the user picked (via `showOpenFilePicker` or
 *  the `<input type="file">` fallback).
 *
 *  FSA backend:
 *  - If a `handle` is present AND the file lives inside the paper folder,
 *    returns the relative path joined with `/` (no copy needed).
 *  - Otherwise copies the file bytes into `<paper>/<subdir>/<basename>`
 *    (creating `<subdir>` on demand) and returns `<subdir>/<basename>`.
 *
 *  The dev backend has its own implementation in `storage-dev.ts` that
 *  always copies via the dev API's PUT route; pick from the facade.
 *
 *  The write goes through `enqueueDocWrite` with a `figures/import/` key
 *  prefix so concurrent imports of the same destination serialize.
 */
export async function importFigureFile(
  h: DocWriteHandle,
  picked: PickedFigureFile,
  subdir: string = "figures",
): Promise<string> {
  const docHandle = await requireDocHandle(h.docId);
  // FSA-only short-circuit: if the picker handed us a real handle and the
  // file already lives inside the paper folder, just record the relative
  // path. `resolve()` returns the path components (or null if outside).
  if (picked.handle) {
    const relative = await docHandle.resolve(picked.handle);
    if (relative && relative.length > 0) {
      return relative.join("/");
    }
  }
  // Outside the paper folder, or no handle (e.g. <input type="file">) — copy
  // bytes in. The destination follows the same convention either way:
  // `<paper>/<subdir>/<basename>`.
  const basename = picked.file.name;
  const destPath = `${subdir}/${basename}`;
  await enqueueDocWrite(h, `figures/import/${destPath}`, async () => {
    const dh = await requireDocHandle(h.docId);
    const subdirHandle = await dh.getDirectoryHandle(subdir, { create: true });
    const destFh = await subdirHandle.getFileHandle(basename, { create: true });
    const writable = await destFh.createWritable();
    await writable.write(await picked.file.arrayBuffer());
    await writable.close();
  });
  return destPath;
}

/** Helper for callers outside the React tree that need a DocWriteHandle —
 *  e.g. the figure raster cache writes from a non-component hook context.
 *  Returns null when no pipeline is active (read-only viewer, etc). */
export { getActiveHandle as getDocWriteHandle } from "@/lib/multi-window/doc-pipeline";

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
