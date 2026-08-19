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
  needsUuidWork,
  extractSidecarData,
} from "@/lib/latex-serializer";
import {
  checkTexPreservation,
  preservationRefusalDetail,
  describePreservationRefusal,
} from "@/lib/tex-preservation";
import {
  retainLoadedCounts,
  checkWriteAgainstRetained,
  describeWriteRefusal,
  writeRefusalDetail,
} from "@/lib/write-preservation";
import { recordPreservationRefusal } from "@/lib/preservation-notice";
import { reportSerializeRefusal } from "@/lib/serialize-refusal";
import { DEFAULT_STYLE_ID } from "@/lib/document-styles";
import { resolveStyle } from "@/lib/style-library";
import { migrateDocumentSettings } from "@/lib/document-settings";
import { asBibFamily, type BibFamily } from "@/lib/bib-family";
import type { FsaDocMeta } from "@/lib/doc-index";
import type { FolderPickResult, PickedFigureFile } from "@/lib/storage-fsa";
import type { ConflictArchive, WritePdfResult } from "@/lib/storage-types";
import { ALL_SIDECAR_FILENAMES } from "@/lib/sidecar-files";

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
import { enqueueWrite, flushPrefix } from "@/lib/write-queue";

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
 * Read the authoritative per-doc bib family off the citations sidecar (dev
 * mirror of storage-fsa's `readDocBibFamily`). Missing sidecar / no valid
 * family → null → the serializer falls back to the body-derived family.
 */
async function readDevDocBibFamily(docId: string): Promise<BibFamily | null> {
  const raw = await fetchJsonIfExists<{ bibPackage?: unknown }>(
    `${API}/doc/${docId}/virgil/citations.json`,
  );
  return asBibFamily(raw?.bibPackage);
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

// Sidecar bundle cache — dev mirror of storage-fsa's. The first read for a
// docId fetches ALL_SIDECAR_FILENAMES in PARALLEL (NOT a 17-deep waterfall),
// caches the result, and the other ~16 mount hooks hit memory.
interface SidecarBundle {
  files: Map<string, unknown | null>;
  inflight: Promise<void> | null;
}
const sidecarCache = new Map<string, SidecarBundle>();

function ensureSidecarBundle(docId: string): SidecarBundle {
  let bundle = sidecarCache.get(docId);
  if (bundle) return bundle;
  bundle = { files: new Map(), inflight: null };
  sidecarCache.set(docId, bundle);
  const run = (async () => {
    await Promise.all(
      ALL_SIDECAR_FILENAMES.map(async (f) => {
        const v = await fetchJsonIfExists<unknown>(docFileUrl(docId, `virgil/${f}`));
        bundle!.files.set(f, v);
      }),
    );
  })();
  bundle.inflight = run.finally(() => {
    const cur = sidecarCache.get(docId);
    if (cur === bundle && cur.inflight === run) cur.inflight = null;
  });
  return bundle;
}

export async function readSidecarBundle(docId: string): Promise<void> {
  const bundle = ensureSidecarBundle(docId);
  if (bundle.inflight) await bundle.inflight;
}

export function invalidateSidecarBundle(docId: string): void {
  sidecarCache.delete(docId);
}

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
  const bundle = ensureSidecarBundle(docId);
  if (bundle.inflight) await bundle.inflight;
  if (bundle.files.has(filename)) return (bundle.files.get(filename) ?? null) as T | null;
  return fetchJsonIfExists<T>(docFileUrl(docId, `virgil/${filename}`));
}

/** Dev mirror of storage-fsa's `persistSidecarInLock` — the write half, run
 *  inside the per-file serial queue. No queueing/guards of its own.
 *
 *  tex-write-exempt: writes a `virgil/*.json` sidecar, never the `.tex` — see the
 *  FSA twin for the full reason (its authority is `mutateSidecar`'s serialized
 *  read-modify-merge, not a word-mass gate). */
async function persistSidecarInLock<T>(
  docId: string,
  filename: string,
  data: T,
): Promise<void> {
  const serialized = JSON.stringify(data, null, 2);
  await putText(docFileUrl(docId, `virgil/${filename}`), serialized);
  const bundle = sidecarCache.get(docId);
  if (bundle) bundle.files.set(filename, data);
  // Stamp the disk ledger so the SidecarWatcher never misreads Virgil's own
  // debounced sidecar autosave as an external change (own-write guard; dev
  // mirror of storage-fsa). Keyed on the `virgil/<filename>` relPath the watcher
  // stats. Best-effort: `stampLedger` never throws.
  await stampLedger(docId, `virgil/${filename}`, serialized);
}

/** The per-file serial-queue key, shared by BOTH sidecar write doors so a
 *  snapshot write and a read-modify-write can never interleave (task 220). */
const sidecarWriteKey = (docId: string, filename: string) =>
  `${docId}/virgil/${filename}`;

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
  // Serialize per file, matching storage-fsa's `enqueueDocWrite` funnel. Before
  // task 220 the dev backend PUT straight through, so two writers for one
  // sidecar raced here in a way they never could under FSA — and the
  // read-modify-write door below would have had nothing to serialize against.
  return enqueueWrite(sidecarWriteKey(h.docId, filename), () =>
    persistSidecarInLock(h.docId, filename, data),
  );
}

/** Dev mirror of storage-fsa's `mutateSidecar` — see there for the contract.
 *  Same queue key as `writeSidecar`, so the read half is inside the critical
 *  section no snapshot write can interleave with. */
export async function mutateSidecar<T>(
  h: DocWriteHandle,
  filename: string,
  defaultValue: T,
  mutate: (current: T) => T | null,
): Promise<T | null> {
  if (isLibraryPaper(h.docId)) return null;
  assertActive(h);
  return enqueueWrite(sidecarWriteKey(h.docId, filename), async () => {
    const current = await readSidecar<T>(h.docId, filename, defaultValue);
    const next = mutate(current);
    if (next === null) return null;
    await persistSidecarInLock(h.docId, filename, next);
    return next;
  });
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
  // Same per-doc "bundle" serial queue as writeDocBundle (parity with
  // storage-fsa, where writeTex shares the bundle subkey): raw .tex rewrites
  // (style switch, compile documentclass-switch) and bundle autosaves target
  // the same file and must land in enqueue order.
  //
  // tex-write-exempt: user-intent write (style switch / documentclass swap), so
  // no preservation GATE by design — the FSA twin takes the same view. Its
  // forensic `snapshotPriorBundle` has no counterpart here at all: this backend
  // keeps no `virgil/.history/` folder, which is the same absence the refusal
  // path's armed-edge snapshot states at its own two sites (task 357).
  return enqueueWrite(`${h.docId}/bundle`, async () => {
    assertNotSuperseded(h);
    const docs = await getDevIndex();
    const entry = findEntry(docs, h.docId);
    const filename = entry ? texFilenameFromPath(entry.sourcePath) : "document.tex";
    await putText(`${API}/doc/${h.docId}/${filename}`, latex);
    // Stamp the ledger with the authoritative post-write fingerprint.
    await stampLedger(h.docId, filename, latex);
  });
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
  // Task 357 (parity with storage-fsa): retain the loaded bytes' word counts so
  // an automatic write landing before the user's first real edit is measured
  // against them.
  retainLoadedCounts(docId, latex);

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
  // Parity with storage-fsa's writeReStampedTexOnLoad: an existing doc keeps
  // its verbatim delimiters; only a brand-new / empty doc (no
  // \begin{document}) seeds a preamble, from the doc's selected style.
  const bibFamily = await readDevDocBibFamily(docId);
  const serializeOpts: {
    preamble?: string;
    postamble?: string;
    bibFamily?: BibFamily | null;
  } = { ...(delimiters ?? {}), bibFamily };
  if (!delimiters) {
    const rawSettings = await fetchJson<unknown>(
      `${API}/doc/${docId}/virgil/document-settings.json`,
      { styleId: DEFAULT_STYLE_ID },
    );
    const settings = migrateDocumentSettings(rawSettings);
    serializeOpts.preamble = resolveStyle(settings.styleId).preamble;
  }
  // THE SERIALIZER GATE (task 357) — parity with storage-fsa. Unlike its twin
  // this serialize runs on the READ path (outside the writeback's queued
  // closure), so an escaping throw would stop the document OPENING rather than
  // merely skipping a write. Refusing here opens the paper against the intact
  // file, publishes the refusal, and skips the writeback — which is exactly
  // what the refusal means.
  let serialized: string;
  try {
    serialized = serializeToLatex(content, serializeOpts);
  } catch (err) {
    // The dev backend keeps no `virgil/.history/`, so the armed edge has no
    // forensic snapshot to force — the same real asymmetry the word gates below
    // state at their own sites. Returning here opens the paper against the
    // INTACT file and skips only the writeback, which is what a refusal means.
    if (!reportSerializeRefusal(err, docId)) throw err;
    return { content, editorState };
  }
  const newLatex = serialized;
  const writebackHandle = getActiveHandle(docId);
  // Read-only library-paper docs never persist — skip the opportunistic
  // load-writeback (the tex + virgil.json PUTs observed in the live smoke).
  // Parity with the storage-fsa enqueueDocWrite funnel guard.
  if (writebackHandle && !isLibraryPaper(docId)) {
    // Fire-and-forget — don't block the editor from opening. The
    // `isActive` re-check inside the closure rejects the writeback if
    // the pipeline was superseded between read and write. Routed through
    // the per-doc "bundle" queue (parity with storage-fsa's
    // writeReStampedTexOnLoad) so it serializes against real bundle writes.
    void enqueueWrite(`${docId}/bundle`, async () => {
      try {
        if (!isActive(writebackHandle)) return;
        // THE PRESERVATION GATE (task 350 defect D) — parity with
        // storage-fsa's `writeReStampedTexOnLoad`. This write is automatic, so
        // it must not be able to lose content; a re-serialization that holds
        // materially fewer content words than the bytes just read is REFUSED
        // and the `.tex` left byte-identical. The ledger is deliberately not
        // stamped on a refusal — nothing was written, so stamping would make
        // the watcher report an untaken write as an external change.
        const verdict = checkTexPreservation(latex, newLatex);
        if (!verdict.ok) {
          console.error(describePreservationRefusal(verdict, docId));
          // Task 357 hole 4 (parity with storage-fsa): publish the refusal so
          // the doc enters the write-protected posture and the banner rises.
          // The dev backend keeps no `virgil/.history/` snapshots, so there is
          // no forensic write to force here — the `armed` edge is simply
          // unused, and that asymmetry is real rather than an omission.
          recordPreservationRefusal(docId, preservationRefusalDetail(verdict));
          return;
        }
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
    });
  }
  return { content, editorState };
}

export async function writeDocBundle(
  h: DocWriteHandle,
  content: JSONContent,
  opts?: {
    delimiters?: { preamble: string; postamble: string };
    /** This write IS the user's decision — the conflict's "keep my version"
     *  door, which has already archived both sides. Parity with storage-fsa;
     *  the full reasoning lives at that declaration (task 364). */
    userResolvedConflict?: boolean;
  },
): Promise<void> {
  // Read-only library-paper docs never persist (parity with storage-fsa).
  if (isLibraryPaper(h.docId)) return;
  assertActive(h);
  // Per-doc serial queue (parity with storage-fsa's enqueueDocWrite
  // "bundle" subkey): without it, bundle writes race — an in-flight
  // autosave that already re-read the OLD .tex preamble can PUT after a
  // delimiters-override commit and resurrect the stale preamble
  // permanently (the masked-loss signature, dev backend only). The disk
  // re-read for the preamble happens INSIDE the chained task, so every
  // queued write sees its predecessor's bytes.
  return enqueueWrite(`${h.docId}/bundle`, async () => {
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
    //
    // Parity with storage-fsa (S3): `content` here is the caller's object, and
    // under the DocProducts pipeline that is the SHARED docJson — whose cached
    // per-node entries must never be mutated. With `BlockUuidBackfill` live
    // this is a steady-state no-op, so gate on the read-only twin and deep-copy
    // when work IS needed. The dev backend is the one the perf work is
    // previewed on, and since task 337 the shared JSON is composed from
    // per-CHILD cache entries — so an in-place `node.attrs = {}` here would
    // reach back into every prior generation's snapshot, not just this one.
    if (needsUuidWork(content)) {
      content = JSON.parse(JSON.stringify(content)) as JSONContent;
      assignUuids(content);
    }

    // Preserve the user's preamble/postamble by re-reading the existing
    // .tex file. The editor never sees these chunks, so the disk is the
    // only source of truth for them — unless the caller supplies fresher
    // delimiters (the code pane's preamble-edit commit; parity with
    // storage-fsa), in which case the disk copy is the stale one.
    const delimiters =
      opts?.delimiters ??
      extractPreambleAndPostamble(
        (await fetchText(`${API}/doc/${h.docId}/${texFilename}`)) ?? "",
      );

    const newSidecar = extractSidecarData(content);
    // Authoritative per-doc bib family from the citations sidecar; missing →
    // null → body-derived fallback. For a brand-new doc (no \begin{document})
    // also seed the preamble from the selected style.
    const bibFamily = await readDevDocBibFamily(h.docId);
    const serializeOpts: {
      preamble?: string;
      postamble?: string;
      bibFamily?: BibFamily | null;
    } = { ...(delimiters ?? {}), bibFamily };
    if (!delimiters) {
      const rawSettings = await fetchJson<unknown>(
        `${API}/doc/${h.docId}/virgil/document-settings.json`,
        { styleId: DEFAULT_STYLE_ID },
      );
      const settings = migrateDocumentSettings(rawSettings);
      serializeOpts.preamble = resolveStyle(settings.styleId).preamble;
    }
    // THE SERIALIZER GATE (task 357) — parity with storage-fsa. A refusal
    // leaves both the `.tex` and `virgil.json` untouched; the dev backend takes
    // no forensic snapshot on the armed edge because it keeps no history folder.
    let latex: string;
    try {
      latex = serializeToLatex(content, serializeOpts);
    } catch (err) {
      if (!reportSerializeRefusal(err, h.docId)) throw err;
      return;
    }

    // THE WRITE-SIDE PRESERVATION GATE (task 357) — parity with storage-fsa.
    // Refuses BEFORE either PUT and before the ledger stamp, so both the .tex
    // and `virgil.json` are left untouched and the watcher does not read an
    // untaken write as an external change.
    const writeVerdict = opts?.userResolvedConflict
      ? null
      : checkWriteAgainstRetained(h.docId, latex);
    if (writeVerdict) {
      console.error(describeWriteRefusal(writeVerdict, h.docId));
      // Publish the refusal (task 357 hole 4) — see the load gate above for
      // why the dev backend takes no forensic snapshot on the armed edge.
      recordPreservationRefusal(h.docId, writeRefusalDetail(writeVerdict));
      return;
    }

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
  });
}

/**
 * **The conflict net** (task 364) — the dev twin of storage-fsa's
 * `snapshotConflictSides`; the contract and the reasoning live at that
 * declaration.
 *
 * The dev backend keeps no `virgil/.history/` for ORDINARY writes, and this
 * does not change that: the two word gates and the serializer refusal still
 * state their missing forensic edge at their own sites. What is different here
 * is that the affordance PROMISES a net — a "keep my version" button that says
 * the disk copy is kept in history must not be a lie in the backend the app is
 * previewed on — so the one net a user is explicitly told about is taken in
 * both backends. Scoped to the resolution, which is a rare discrete gesture.
 *
 * tex-write-exempt: every PUT here targets `virgil/.history/<slot>/` — the
 * forensic net itself, never a paper file. Gating the net against the document
 * it exists to preserve would be a category error, which is the same reason the
 * FSA twin's slot writes sit beside `copyFileIfPresent` rather than on the
 * shared text-write primitive.
 *
 * Stated limit: no pruning. The FSA twin caps a doc at HISTORY_LIMIT slots by
 * listing the folder; the dev API has no directory listing, so a dev history
 * grows one slot per conflict resolved. That is a fixture cost, not a user one.
 */
export async function snapshotConflictSides(
  h: DocWriteHandle,
  mine: JSONContent | null,
): Promise<ConflictArchive | null> {
  try {
    const docs = await getDevIndex();
    const entry = findEntry(docs, h.docId);
    const texFilename = entry
      ? texFilenameFromPath(entry.sourcePath)
      : "document.tex";
    const slot = `.history/${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const base = `${API}/doc/${h.docId}`;

    const disk: string[] = [];
    for (const [from, name] of [
      [`${base}/${texFilename}`, texFilename],
      [`${base}/virgil/virgil.json`, "virgil.json"],
      [`${base}/virgil/editor-state.json`, "editor-state.json"],
    ] as const) {
      const body = await fetchText(from);
      if (body === null) continue;
      await putText(`${base}/virgil/${slot}/${name}`, body);
      disk.push(name);
    }

    let mineName: string | null = null;
    if (mine) {
      const delimiters = extractPreambleAndPostamble(
        (await fetchText(`${base}/${texFilename}`)) ?? "",
      );
      const bibFamily = await readDevDocBibFamily(h.docId);
      let body: string;
      try {
        body = serializeToLatex(mine, { ...(delimiters ?? {}), bibFamily });
        mineName = `unsaved-${texFilename}`;
      } catch {
        body = JSON.stringify(mine, null, 2);
        mineName = "unsaved-model.json";
      }
      await putText(`${base}/virgil/${slot}/${mineName}`, body);
    }

    return { slot, disk, mine: mineName };
  } catch (e) {
    console.warn("[storage] conflict snapshot failed:", e);
    return null;
  }
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

// tex-write-exempt: writes the `.bib`, never the `.tex`, and a bibliography edit
// is user-intent. The FSA twin still takes `snapshotPriorBib`; this backend keeps
// no `virgil/.history/` folder, so it has no forensic net to take (task 357).
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

export async function writePdf(
  h: DocWriteHandle,
  pdfBytes: Uint8Array,
): Promise<WritePdfResult> {
  // Read-only library-paper docs never persist (parity with storage-fsa).
  if (isLibraryPaper(h.docId)) return { status: "skipped" };
  assertActive(h);
  const filename = await getPdfFilename(h.docId);
  assertNotSuperseded(h);
  try {
    const resp = await fetch(`${API}/doc/${h.docId}/${filename}`, {
      method: "PUT",
      body: pdfBytes.buffer as ArrayBuffer,
      headers: { "Content-Type": "application/octet-stream" },
    });
    // Previously fire-and-forget: a rejected PUT silently reported success.
    // Now we inspect resp.ok so a server-side failure surfaces as `failed`.
    if (!resp.ok) {
      return {
        status: "failed",
        error: new Error(`PUT ${filename} → ${resp.status}`),
      };
    }
    return { status: "written" };
  } catch (err) {
    return { status: "failed", error: err };
  }
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

// tex-write-exempt: a DERIVED cache index, not user content (parity with the FSA
// twin) — regenerated from the figures on the next scan.
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

// tex-write-exempt: the dev doc REGISTRY (`index.json`), not a paper file — it
// records which folders exist, and it is read-modify-written from the file it
// is about to replace, so it cannot carry a document's words away.
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

// tex-write-exempt: the dev doc REGISTRY (`index.json`), not a paper file — see
// `renameDoc` above. Removing a row leaves every byte on disk untouched.
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

/** List the file names directly inside `virgil/` — the dev twin of the FSA
 *  `listSidecarNames` (task 363). Answers `[]` when the endpoint is missing or
 *  the folder has no `virgil/` yet: the scan is a diagnostic, so an unavailable
 *  listing means "nothing to report", never an error the user sees. */
export async function listSidecarNames(docId: string): Promise<string[]> {
  try {
    const resp = await fetch(`${API}/doc/${docId}/_sidecar-names`);
    if (!resp.ok) return [];
    const { names } = (await resp.json()) as { names?: string[] };
    return Array.isArray(names) ? names : [];
  } catch {
    return [];
  }
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
// Drain helpers — the dev backend now serializes .tex/bundle writes through
// the shared write-queue (see writeTex / writeDocBundle / the load-writeback
// above), so flushDoc drains every `${docId}/…` queue key, mirroring the
// FSA backend's semantics for drainDoc/compile/style-switch callers.
// ---------------------------------------------------------------------------

export async function flushDoc(docId: string): Promise<void> {
  await flushPrefix(docId);
}
