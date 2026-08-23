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
import {
  isLocalSidecar,
  mutateLocalSidecar,
  readLocalSidecar,
  writeLocalSidecar,
} from "@/lib/local-sidecar";
import {
  planSidecarCleanup,
  type SidecarCleanupReceipt,
} from "@/lib/sync-conflict-cleanup";
import type { JSONContent } from "@tiptap/react";
import type { VirgilSidecar } from "@/lib/types";
import { parseLatex, resolveWriteDelimiters } from "@/lib/latex-parser";
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
  isStalePipelineError,
  type DocWriteHandle,
} from "@/lib/multi-window/doc-pipeline";
import type { ConflictArchive, WritePdfResult } from "@/lib/storage-types";
import {
  DOCUMENT_TEMPLATES,
  DEFAULT_TEMPLATE_ID,
  type DocumentTemplate,
} from "@/lib/document-templates";
import { getLibraryHandle } from "@library/lib/library-folder";
import {
  stampDiskFingerprint,
  fingerprintOf,
  getDiskFingerprint,
  hashContent,
} from "@/lib/disk-ledger";
import {
  detectBibFamily,
  asBibFamily,
  type BibFamily,
} from "@/lib/bib-family";

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

// ---------------------------------------------------------------------------
// The gated write funnel (task 415)
//
// > **No FSA write of a file whose bytes are already on disk.**
//
// Chrome's FSA has no in-place write mode: `createWritable()` mints a
// `<name>.crswap` sibling and renames it over the target, so EVERY write is two
// filesystem events a sync daemon watches — and every one of them is a fresh
// chance to mint a conflicted copy. A write of bytes that are already there has
// zero information content and 100% of that risk.
//
// Task 363 shrank the race window by CADENCE (a per-tier debounce). This is the
// cheaper question one layer down, and the one with a proof behind it rather
// than a heuristic: SHOULD THIS WRITE HAPPEN AT ALL?
//
// ── Why the gate STATS, instead of trusting the ledger hash alone ───────────
//
// The pre-415 `writeDocBundle` gate compared its serialized `.tex` against the
// ledger fingerprint and returned. That rests on a claim the ledger cannot
// make: the ledger records what Virgil last PUT ON (or READ FROM) disk, which
// is a belief about disk, not disk. The `.tex`/`.bib` half is never
// re-baselined on a genuine external change — the `DiskWatcher` deliberately
// keeps the STALE fingerprint and flags (that is how the badge stays lit across
// polls) — and the sidecar half is re-baselined only by the `SidecarWatcher`'s
// ~3 s poll (mounted per doc by `DiskWatcherProvider`; task 432 corrected an
// earlier claim here that it was unmounted), which leaves a window between the
// external write and the next poll. So a hash-only gate can decline to write
// over an external edit, silently, which is the one failure this whole
// subsystem exists to prevent.
//
// So a skip is only taken when the file is PROVABLY the one we stamped: the
// content hash matches AND the live `{mtimeMs, size}` still match the
// fingerprint. That is the DiskWatcher's own cheap-path predicate, read off the
// SAME handle we would have written through — so the gate and the watcher can
// never disagree about whether a file moved. Anything we cannot prove (no
// fingerprint, a stat we cannot take, any drift) FAILS OPEN and writes: a
// needless write is the pre-415 behaviour, where a wrongly-skipped write leaves
// the user's state unpersisted.
//
// The stat costs one metadata read on the SKIP path and replaces an entire
// `createWritable` + rename + post-write stat. A skip is strictly cheaper than
// the write it declines.
// ---------------------------------------------------------------------------

/**
 * Is `content` PROVABLY already the content of `relPath` on disk?
 *
 * Three rungs, all of which must hold: a fingerprint exists (we have stamped
 * this file), its hash matches these bytes, and the live stat still matches the
 * fingerprint's `{mtimeMs, size}`. Never throws — an unreadable stat is "cannot
 * prove", which is `false`.
 */
async function diskAlreadyHas(
  docId: string,
  relPath: string,
  fileHandle: FileSystemFileHandle,
  content: string,
): Promise<boolean> {
  const fp = getDiskFingerprint(docId, relPath);
  if (!fp) return false; // never stamped — no claim to make
  if (fp.hash !== hashContent(content)) return false;
  try {
    const file = await fileHandle.getFile();
    return file.lastModified === fp.mtimeMs && file.size === fp.size;
  } catch {
    return false; // cannot confirm → write
  }
}

/**
 * THE write door for every ledgered text file: gate, write, stamp.
 *
 * Returns whether bytes actually landed, so a caller can make the rest of its
 * tail conditional (the doc-index timestamp touch, a forensic snapshot). The
 * ledger stamp is INSIDE this door rather than beside each call site, because
 * "what is on disk" and "who is allowed to skip writing it" are one fact: a
 * writer that could stamp without writing (or write without stamping) is how
 * the gate would come to believe something the disk does not say.
 *
 * `beforeWrite` runs only when a write is going to happen, immediately before
 * it — that is where a forensic snapshot belongs, so a declined write cannot
 * mint a `.history/` slot holding bytes nothing is about to overwrite.
 *
 * `force` is for a write that IS the user's decision (task 364's keep-mine
 * door). It is not an optimization escape hatch: the gate's whole justification
 * is that the bytes are already there, and a caller that disagrees with that
 * must say why at its own site.
 */
async function writeTrackedText(
  docId: string,
  relPath: string,
  fileHandle: FileSystemFileHandle,
  content: string,
  opts?: { force?: boolean; beforeWrite?: () => Promise<void> },
): Promise<boolean> {
  if (
    !opts?.force &&
    (await diskAlreadyHas(docId, relPath, fileHandle, content))
  ) {
    return false;
  }
  if (opts?.beforeWrite) await opts.beforeWrite();
  // tex-write-exempt: this IS the door. Accountability is asked of the CALLERS
  // — the funnel writes whatever bytes it is handed and cannot know whether a
  // gate or a snapshot was owed; asking the question here would let every
  // caller inherit one blanket answer.
  // write-gate-exempt: this IS the byte-equality gate — `diskAlreadyHas` ran
  // four lines up. A site cannot be asked to enter the door it is (task 415).
  await writeTextToHandle(fileHandle, content);
  await stampLedger(docId, relPath, content);
  return true;
}

/**
 * Wrap a `beforeWrite` obligation so it runs AT MOST ONCE across the several
 * files a bundle write hands to the funnel.
 *
 * A bundle's forensic snapshot archives the whole prior bundle, so it must be
 * taken before the FIRST file moves and never again — and which file moves
 * first is now a per-file verdict rather than something the caller knows in
 * advance. Sharing one latched thunk between the two calls states that as
 * structure instead of as a flag the second call site has to remember.
 */
function onceBeforeWrite(run: () => Promise<void>): () => Promise<void> {
  let done = false;
  return async () => {
    if (done) return;
    done = true;
    await run();
  };
}

/**
 * Read a tracked text file THROUGH the ledger: one `getFile()` serves both the
 * bytes and the fingerprint, so the stamp is free and is guaranteed to describe
 * the same file revision the caller just read.
 *
 * This is what makes the write gate effective from a session's FIRST save. The
 * ledger's own contract has always been "what Virgil last put on **or read
 * from** disk" (and the two watchers' PRIME passes stamp exactly this way), but
 * only the `.tex` load path was read-stamping — so every sidecar's first write
 * of a session had no fingerprint to compare against and always landed, however
 * unchanged its bytes. Inside `mutateSidecar` it is stronger still: the read
 * runs in the same critical section as the write, so a mutation that produces
 * structurally-equal JSON is proven to be a no-op microseconds later. That
 * closes `usePersistentState`'s referential-equality hole from underneath,
 * rather than auditing ~20 hooks for structural equality.
 */
async function readTrackedText(
  docId: string,
  relPath: string,
  fileHandle: FileSystemFileHandle,
): Promise<string> {
  const file = await fileHandle.getFile();
  const text = await file.text();
  try {
    stampDiskFingerprint(
      docId,
      relPath,
      fingerprintOf({ mtimeMs: file.lastModified, size: file.size }, text),
    );
  } catch {
    // A stamp can never break a read.
  }
  return text;
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
  docId: string,
  virgil: FileSystemDirectoryHandle,
  filename: string,
  files: Map<string, unknown | null>,
): Promise<void> {
  try {
    const fileHandle = await virgil.getFileHandle(filename);
    const text = await readTrackedText(docId, `virgil/${filename}`, fileHandle);
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
      ALL_SIDECAR_FILENAMES.map((f) =>
        readOneSidecarInto(docId, virgil, f, bundle!.files),
      ),
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

/**
 * The DIRECT disk read of one sidecar — no bundle cache, `null` on absent,
 * re-throws everything else. The base read of `readSidecar` / the cache-miss
 * read of `readSidecarIfExists`, and the ONE-TIME MIGRATION source for a
 * `store: "local"` file (task 417): a pre-417 build wrote `editor-state.json`
 * to `virgil/`, and the first local miss on each machine reads it from here.
 */
async function readSidecarFromDisk<T>(
  docId: string,
  filename: string,
): Promise<T | null> {
  const docHandle = await requireDocHandle(docId);
  try {
    const virgil = await getVirgilSubdir(docHandle);
    const fileHandle = await virgil.getFileHandle(filename);
    // Read THROUGH the ledger: this is `mutateSidecar`'s in-lock base read, so
    // the fingerprint it stamps is the one the matching write is gated on.
    const text = await readTrackedText(docId, `virgil/${filename}`, fileHandle);
    return JSON.parse(text) as T;
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

export async function readSidecar<T>(
  docId: string,
  filename: string,
  defaultValue: T,
): Promise<T> {
  // ROUTE (task 417): a `store: "local"` file lives in IndexedDB, never in
  // `virgil/`. The declaration decides; no caller does.
  if (isLocalSidecar(filename)) {
    const local = await readLocalSidecar<T>(docId, filename, () =>
      readSidecarFromDisk<T>(docId, filename),
    );
    return local ?? defaultValue;
  }
  return (await readSidecarFromDisk<T>(docId, filename)) ?? defaultValue;
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
  // ROUTE (task 417): local-store files are never in the mount bundle (a
  // directory read cannot see IndexedDB), so ask the local store first and
  // let a local miss migrate from the disk file a pre-417 build wrote.
  if (isLocalSidecar(filename)) {
    return readLocalSidecar<T>(docId, filename, () =>
      readSidecarFromDisk<T>(docId, filename),
    );
  }
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
  return readSidecarFromDisk<T>(docId, filename);
}

/**
 * The WRITE half of a sidecar persist, run INSIDE the caller's already-held
 * critical section (`enqueueDocWrite`'s queued task). Factored so `writeSidecar`
 * (whole-snapshot) and `mutateSidecar` (serialized read-modify-write) state the
 * two post-write obligations — bundle coherence and the disk-ledger stamp —
 * exactly once. NEVER call this outside the funnel: it does no queueing, no
 * pipeline check and no library-paper guard of its own.
 *
 * tex-write-exempt: writes a `virgil/*.json` sidecar, never the `.tex`. Its own
 * preservation authority is `mutateSidecar` — a read-modify-MERGE computed
 * inside this same critical section (AGENTS.md "The sidecar half") — which is a
 * different guarantee from a word-mass gate and the right one for a JSON
 * document with several writers. The bundle path's `snapshotPriorBundle` copies
 * `virgil.json` alongside the `.tex`, so the forensic net does reach here.
 */
async function persistSidecarInLock<T>(
  docId: string,
  filename: string,
  data: T,
): Promise<void> {
  const docHandle = await requireDocHandle(docId);
  const virgil = await getVirgilSubdir(docHandle);
  const fileHandle = await virgil.getFileHandle(filename, { create: true });
  const serialized = JSON.stringify(data, null, 2);
  // Through the gated funnel (task 415): a sidecar whose bytes are already on
  // disk is not rewritten. `usePersistentState.update` bails only on
  // REFERENTIAL equality, so any hook that rebuilds a structurally-equal array
  // or map used to re-write the identical bytes — one `.crswap` + rename per
  // rebuild, each a fresh chance for the sync daemon to fork the file. The
  // funnel also owns the disk-ledger stamp, which is the own-write guard that
  // keeps the `SidecarWatcher` from misreading Virgil's own debounced autosave
  // as an external change.
  await writeTrackedText(docId, `virgil/${filename}`, fileHandle, serialized);
  // Keep the bundle coherent: the value we just wrote IS the freshest, so
  // update it in place rather than invalidating (a read-after-write sees it).
  // Unconditional on the funnel's verdict — a DECLINED write means those exact
  // bytes are already on disk, so the cache is just as correct either way.
  const bundle = sidecarCache.get(docId);
  if (bundle) bundle.files.set(filename, data);
}

export async function writeSidecar<T>(
  h: DocWriteHandle,
  filename: string,
  data: T,
): Promise<void> {
  // ROUTE (task 417): a `store: "local"` file goes to IndexedDB and never
  // enters the disk funnel — no swap file, no ledger stamp, nothing for a
  // sync daemon to see. The two guards the funnel would have applied are
  // kept: a read-only library-paper doc persists nothing (parity with disk —
  // the Reader's view state is deliberately not remembered either way), and
  // a superseded pipeline's write is dropped.
  if (isLocalSidecar(filename)) {
    if (h.docId.startsWith(LIBRARY_PAPER_PREFIX)) return;
    assertActive(h);
    return writeLocalSidecar(h.docId, filename, data);
  }
  // Read-only library-paper docs never persist — the guard lives at the
  // `enqueueDocWrite` funnel below, which this (and every other writer) routes
  // through.
  return enqueueDocWrite(h, `virgil/${filename}`, () =>
    persistSidecarInLock(h.docId, filename, data),
  );
}

/**
 * Serialized READ-MODIFY-WRITE of one sidecar (task 220).
 *
 * The difference from `writeSidecar` is WHERE the read happens. A caller that
 * does `readSidecar(...)` and then `writeSidecar(...)` reads OUTSIDE the write
 * queue and the cross-window doc lock, so between its read and its write any
 * other writer for the same file can land — and the read-modify-write then
 * persists a merge computed from a base that no longer exists, silently
 * dropping the interleaved change. Here the read runs INSIDE the same queued,
 * doc-locked task as the write, so `mutate` always sees the freshest on-disk
 * value and no writer can interleave between the two halves.
 *
 * The read deliberately goes through `readSidecar` (a DIRECT disk read that
 * bypasses the bundle cache), never `readSidecarIfExists` — a cached snapshot
 * is exactly the stale base this exists to eliminate.
 *
 * `mutate` must be PURE and cheap: it runs while the doc lock is held, and a
 * caller that also applies it to in-memory state runs it a second time on a
 * different base. Returning `null` means "nothing to change" — no write, no
 * ledger stamp, and the call resolves `null`, so a caller can tell a no-op
 * apart from a landed write. A library-paper (read-only) doc also resolves
 * `null`: nothing was persisted, which is the honest report.
 */
export async function mutateSidecar<T>(
  h: DocWriteHandle,
  filename: string,
  defaultValue: T,
  mutate: (current: T) => T | null,
): Promise<T | null> {
  // ROUTE (task 417): the local twin serializes per key and migrates once.
  if (isLocalSidecar(filename)) {
    if (h.docId.startsWith(LIBRARY_PAPER_PREFIX)) return null;
    assertActive(h);
    return mutateLocalSidecar(h.docId, filename, defaultValue, mutate, () =>
      readSidecarFromDisk<T>(h.docId, filename),
    );
  }
  const result = await enqueueDocWrite<T | null>(
    h,
    `virgil/${filename}`,
    async () => {
      const current = await readSidecar<T>(h.docId, filename, defaultValue);
      const next = mutate(current);
      if (next === null) return null;
      await persistSidecarInLock(h.docId, filename, next);
      return next;
    },
  );
  // `enqueueDocWrite` short-circuits a library-paper doc to `undefined` without
  // running the task — normalize to the same "nothing persisted" report.
  return result ?? null;
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
  // "bundle" (not a separate "tex") subkey: writeTex rewrites the SAME .tex
  // file the bundle writes own (style switch, compile documentclass-switch),
  // so it must be totally ordered against writeDocBundle / the load-writeback.
  // On separate subkeys the two serial queues interleave at every await —
  // withDocLock is a passthrough in the lock-owning window — and a queued
  // bundle write carrying a delimiters override could land AFTER a style
  // rewrite and silently undo it.
  return enqueueDocWrite(h, "bundle", async () => {
    const meta = await getDocMetaOrThrow(h.docId);
    // FORENSIC SNAPSHOT (task 357). This write is USER-INTENT — a style switch
    // or a documentclass swap deliberately replaces the preamble — so it takes
    // no preservation GATE: refusing it would refuse what the user asked for.
    // It is still the most destructive single write Virgil makes, and it was
    // the one `.tex` writer with no net under it at all. Unconditional rather
    // than rate-limited, for the same reason a delimiters commit is: this fires
    // only on a discrete gesture, never on a timer, so "at most one snapshot a
    // minute" would be a limit with nothing to limit. Stamping the shared
    // rate-limit clock means the gesture costs ONE snapshot, not two nearly
    // identical ones when the autosave follows it.
    const docHandle = await requireDocHandle(h.docId);
    const virgil = await getVirgilSubdir(docHandle);
    const fh = await getTexFileHandle(h.docId, { create: true });
    // Through the gated funnel (task 415). The snapshot rides `beforeWrite`
    // rather than running ahead of it: it is unconditional with respect to the
    // RATE LIMIT (this fires on a discrete gesture, never a timer) but there is
    // nothing forensic about archiving bytes no write is about to replace, and
    // a `.history/` slot is itself sync traffic.
    const takeSnapshot = onceBeforeWrite(async () => {
      await snapshotPriorBundle(docHandle, virgil, meta.texFilename);
      lastSnapshotAtByDoc.set(h.docId, Date.now());
    });
    const wrote = await writeTrackedText(h.docId, meta.texFilename, fh, latex, {
      beforeWrite: takeSnapshot,
    });
    if (wrote) await touchDocTimestamp(h.docId);
  });
}

// ---------------------------------------------------------------------------
// Document bundle (.tex + virgil.json)
//
// This replaces the old `/api/document` route. The whole bundle is
// serialized through a single per-doc queue so the three files always
// move together.
// ---------------------------------------------------------------------------

export interface DocBundle {
  content: JSONContent;
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
  // Task 357: retain what this document was LOADED with, so an automatic write
  // that lands before the user has genuinely edited can be measured against the
  // bytes rather than against Virgil's own re-stamped output.
  retainLoadedCounts(docId, latex);
  const virgil = await getVirgilSubdir(docHandle);
  const sidecar = await safeReadJson<VirgilSidecar>(
    virgil,
    "virgil.json",
    DEFAULT_SIDECAR,
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

  return { content };
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
interface SerializeOpts {
  preamble?: string;
  postamble?: string;
  bibFamily?: BibFamily | null;
}

/**
 * The serialize options every `.tex`-producing path shares: the user's verbatim
 * delimiters when we have them, the authoritative per-doc bib family off the
 * citations sidecar, and — only for a genuinely EMPTY file — the selected
 * style's preamble as a seed.
 *
 * `delimiters` MUST come from `resolveWriteDelimiters` (task 375): `null` there
 * means "the file is empty", which is the only condition under which inventing
 * a preamble is honest. Reading it as "no `\begin{document}` was found" is what
 * put a style seed above a real paper's own `\documentclass`.
 *
 * Factored because three callers now need it (the load writeback, the bundle
 * write, and task 364's conflict net), and two hand copies of "how does this
 * document serialize?" are exactly how the archived copy of a side would come
 * to differ from the bytes that side would actually write.
 */
async function buildSerializeOpts(
  virgil: FileSystemDirectoryHandle,
  delimiters: { preamble: string; postamble: string } | null | undefined,
): Promise<SerializeOpts> {
  const bibFamily = await readDocBibFamily(virgil);
  const opts: SerializeOpts = { ...(delimiters ?? {}), bibFamily };
  if (!delimiters) {
    const rawSettings = await safeReadJson<unknown>(
      virgil,
      "document-settings.json",
      { styleId: DEFAULT_STYLE_ID },
    );
    const settings = migrateDocumentSettings(rawSettings);
    opts.preamble = resolveStyle(settings.styleId).preamble;
  }
  return opts;
}

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
  // genuinely EMPTY file seeds a preamble, here from the doc's selected style
  // (`resolveWriteDelimiters` — task 375 M5: a file with BYTES but no locatable
  // boundary is written back as body with nothing prepended, never re-seeded).
  const delimiters = resolveWriteDelimiters(existingLatex);
  const newSidecar = extractSidecarData(content);

  await enqueueDocWrite(h, "bundle", async () => {
    const docHandle = await requireDocHandle(h.docId);
    const meta = await getDocMetaOrThrow(h.docId);
    const virgil = await getVirgilSubdir(docHandle);

    // Authoritative per-doc bib family: read from the citations sidecar (the
    // existing user-settable SSOT, seeded from detection on load). A missing
    // sidecar → null → the serializer falls back to the body-derived family
    // (today's behavior). Never overrides the user's stored choice.
    const serializeOpts = await buildSerializeOpts(virgil, delimiters);
    // THE SERIALIZER GATE (task 357). A model holding a node this build cannot
    // express in LaTeX no longer serializes to a SHORTER document — the
    // serializer refuses (`UnserializableNodeError`), and the refusal is
    // published to the same channel the two word-measure gates below use. It
    // is caught HERE rather than left to escape because a throw out of this
    // fire-and-forget writeback would be a third inert refusal: nothing awaits
    // this promise, so the user would be told nothing at all.
    let latex: string;
    try {
      latex = serializeToLatex(content, serializeOpts);
    } catch (err) {
      const refusal = reportSerializeRefusal(err, h.docId);
      if (!refusal) throw err;
      if (refusal.armed) {
        await snapshotPriorBundle(docHandle, virgil, meta.texFilename).catch(
          () => {},
        );
      }
      return;
    }

    // THE PRESERVATION GATE (task 350 defect D). This write is automatic — the
    // user did not ask for it — so it must not be able to lose content. If the
    // re-serialized document holds materially fewer content words than the
    // bytes we just read, a parse could not represent this document and the
    // right answer is to REFUSE and say so, not to write the loss to disk.
    //
    // Neither the sidecar nor the ledger is stamped on a refusal: the `.tex`
    // stays byte-identical, so claiming otherwise would make the DiskWatcher
    // report Virgil's own untaken write as an external change.
    const verdict = checkTexPreservation(existingLatex, latex);
    if (!verdict.ok) {
      console.error(describePreservationRefusal(verdict, h.docId));
      // Task 357 hole 4: the refusal is a fact about the DOCUMENT, not a log
      // line. Publishing it puts this doc into the write-protected posture (so
      // the user's first keystroke can no longer let the model this gate just
      // refused reach disk) and raises the banner that tells them so. On the
      // FIRST refusal we also take an UNCONDITIONAL forensic snapshot, bypassing
      // the autosave rate-limit: the bytes on disk are still the intact ones,
      // and this is the last moment we are certain of that.
      const { armed } = recordPreservationRefusal(
        h.docId,
        preservationRefusalDetail(verdict),
      );
      if (armed) {
        await snapshotPriorBundle(docHandle, virgil, meta.texFilename).catch(
          () => {},
        );
      }
      return;
    }

    // Snapshot the prior bundle before overwriting — same forensic safety net
    // writeDocBundle uses, and on the same terms (task 415): it rides the
    // funnel's `beforeWrite`, so it is taken at most ONCE and only if one of
    // the two files is actually going to move.
    const takeSnapshot = onceBeforeWrite(() =>
      snapshotPriorBundle(docHandle, virgil, meta.texFilename),
    );

    const texFh = await docHandle.getFileHandle(meta.texFilename, {
      create: true,
    });
    // CRITICAL false-positive guard: the load-writeback is the #1 source of
    // spurious "changed on disk" — it rewrites the .tex seconds after load
    // (minted-UUID markers). The funnel stamps the ledger with the bytes it
    // writes so the watcher recognizes this as Virgil's own write; when it
    // DECLINES, the stamp it is comparing against is already that fact.
    const wroteTex = await writeTrackedText(
      h.docId,
      meta.texFilename,
      texFh,
      latex,
      { beforeWrite: takeSnapshot },
    );

    const sidecarFh = await virgil.getFileHandle("virgil.json", {
      create: true,
    });
    const wroteSidecar = await writeTrackedText(
      h.docId,
      "virgil/virgil.json",
      sidecarFh,
      JSON.stringify(newSidecar, null, 2),
      { beforeWrite: takeSnapshot },
    );

    if (wroteTex || wroteSidecar) await touchDocTimestamp(h.docId);
  });
}

/** Per-doc save-path caches (perf Wave 1 / S3). Module-level, in-memory:
 *  - delimiters keyed on the .tex content hash the ledger already tracks,
 *    so a steady-state autosave skips the full-file disk read;
 *  - the last forensic-snapshot time, rate-limiting plain autosaves.
 *
 *  (The former `lastSidecarHashByDoc` — the other half of the pre-415
 *  all-or-nothing byte-equality skip — is retired: the disk ledger holds the
 *  same fact per relPath, is confirmed against a live stat by the write funnel,
 *  and is re-baselined by the watchers' acknowledge path. A module map is none
 *  of those things.) */
const delimiterCacheByDoc = new Map<
  string,
  { texHash: string; delimiters: { preamble: string; postamble: string } }
>();
const lastSnapshotAtByDoc = new Map<string, number>();
const SNAPSHOT_MIN_INTERVAL_MS = 60_000;

export async function writeDocBundle(
  h: DocWriteHandle,
  content: JSONContent,
  opts?: {
    delimiters?: { preamble: string; postamble: string };
    /**
     * **This write IS the user's decision** (task 364). Set only by the
     * external-change conflict's "keep my version" door, which has already
     * archived BOTH sides through `snapshotConflictSides` — so the automatic-
     * write gate below steps aside rather than silently declining to do the
     * one thing the user just asked for.
     *
     * Stated as a claim rather than a convenience: the 357 gate exists because
     * an AUTOMATIC write must not lose content, and a conflict resolution is
     * the opposite of automatic. Refusing it would leave the badge's promise
     * ("your version is kept") unkept with nothing on screen to say so — this
     * cluster's own silence failure mode. The net is what makes the exemption
     * safe, and it is unconditional at the call site, never rate-limited.
     */
    userResolvedConflict?: boolean;
  },
): Promise<void> {
  return enqueueDocWrite(h, "bundle", async () => {
    const docHandle = await requireDocHandle(h.docId);
    const meta = await getDocMetaOrThrow(h.docId);
    const virgil = await getVirgilSubdir(docHandle);

    // (S3) assignUuids demoted behind its read-only twin: with the editor's
    // BlockUuidBackfill live this is a steady-state no-op, and skipping the
    // mutation makes it safe for callers to hand us the DocProducts
    // pipeline's SHARED docJson (whose cached entries must never mutate).
    // When work IS needed, deep-copy and mutate the copy.
    // (recoverOrphanedUuids stays disabled — fingerprint matching caused
    // UUID collisions; its unused sidecar pre-read is gone with it.)
    if (needsUuidWork(content)) {
      content = JSON.parse(JSON.stringify(content)) as JSONContent;
      assignUuids(content);
    }

    // Preserve the user's preamble/postamble verbatim across the
    // parse/serialize round-trip. The editor never sees them, so we
    // read them off the existing .tex on save — UNLESS the caller supplies
    // fresher delimiters (the code pane's preamble-edit commit), in which
    // case the disk copy is exactly what's stale — with an in-memory cache
    // keyed on the ledger's .tex content hash (S3): when the file on disk
    // is byte-identical to what we last stamped, the cached extraction is
    // exact and the full-file read is skipped.
    let delimiters = opts?.delimiters;
    if (!delimiters) {
      const ledgerHash = getDiskFingerprint(h.docId, meta.texFilename)?.hash;
      const cached = delimiterCacheByDoc.get(h.docId);
      if (ledgerHash && cached && cached.texHash === ledgerHash) {
        delimiters = cached.delimiters;
      } else {
        delimiters =
          resolveWriteDelimiters(
            await safeReadText(docHandle, meta.texFilename, ""),
          ) ?? undefined;
      }
    }

    const newSidecar = extractSidecarData(content);
    // For brand-new / empty docs with no \begin{document} marker yet,
    // seed the preamble from the doc's currently-selected style instead
    // of the historical hardcoded fallback. Existing docs keep their
    // verbatim preamble.
    // Authoritative per-doc bib family from the citations sidecar (the
    // user-settable SSOT). Missing → null → body-derived fallback. Never
    // overrides the user's stored choice.
    const serializeOpts = await buildSerializeOpts(virgil, delimiters);
    // THE SERIALIZER GATE (task 357) — see `writeReStampedTexOnLoad` above.
    // Refusing here leaves the `.tex` AND `virgil.json` untouched, which is the
    // half a `.tex`-only gate could never cover: this path replaces the sidecar
    // wholesale.
    let latex: string;
    try {
      latex = serializeToLatex(content, serializeOpts);
    } catch (err) {
      const refusal = reportSerializeRefusal(err, h.docId);
      if (!refusal) throw err;
      if (refusal.armed) {
        await snapshotPriorBundle(docHandle, virgil, meta.texFilename).catch(
          () => {},
        );
      }
      return;
    }

    // THE WRITE-SIDE PRESERVATION GATE (task 357). 350-D gated the LOAD
    // writeback and deliberately exempted the autosave — once the user has
    // edited, the model is their document. That rationale does not cover
    // `flushNow`, which writes this whole bundle on an anchor-UUID MINT: one
    // card gesture on a uuid-less paragraph persists immediately, with no
    // typing at all. So a write is measured against the loaded bytes until a
    // REAL (undoable) user edit lands; after that the gate steps aside.
    //
    // Refusing before `snapshotPriorBundle` and before either file write means
    // the `.tex` AND `virgil.json` are both left alone — the sidecar matters
    // here because this path replaces it wholesale, carrying damage no .tex
    // gate could see.
    const writeVerdict = opts?.userResolvedConflict
      ? null
      : checkWriteAgainstRetained(h.docId, latex);
    if (writeVerdict) {
      console.error(describeWriteRefusal(writeVerdict, h.docId));
      // Publish the refusal (task 357 hole 4) — see the load gate above for
      // why the FIRST one snapshots unconditionally. The autosave retries this
      // write every 1500 ms while the notice stands, so only the armed EDGE
      // snapshots; the rest merely bump the notice's refusal count.
      const { armed } = recordPreservationRefusal(
        h.docId,
        writeRefusalDetail(writeVerdict),
      );
      if (armed) {
        await snapshotPriorBundle(docHandle, virgil, meta.texFilename).catch(
          () => {},
        );
      }
      return;
    }
    const latexHash = hashContent(latex);
    const sidecarJson = JSON.stringify(newSidecar, null, 2);

    // PER-FILE byte-equality (task 415). The pre-415 gate was ALL-OR-NOTHING:
    // it skipped the whole tail only when BOTH outputs matched, so the moment
    // the `.tex` moved by one character — every ordinary autosave — the
    // byte-identical `virgil.json` was rewritten alongside it. `virgil.json`
    // holds paragraph titles and collapsed state, which change almost never
    // during a writing session, and it was nonetheless the LOUDEST base in the
    // measured conflicted-copy census. Handing each file to the funnel writes
    // the `.tex` and declines the sidecar.
    //
    // This is not a decoupling: the two files are still computed together and
    // committed inside ONE serialized critical section making ONE coherent
    // decision. Declining to rewrite a file with the bytes it already has is
    // not the same thing as letting it drift out of the bundle.
    //
    // The `lastSidecarHashByDoc` module cache is RETIRED with it — the ledger
    // holds the same fact authoritatively, keyed on the relPath the watchers
    // stat, and the funnel confirms it against a live stat. A module map could
    // do neither.

    // Shadow snapshot the prior bundle BEFORE overwriting. This is the
    // forensic safety net: if a regression ever slipped past the
    // pipeline check, the user can recover from virgil/.history/.
    // (S3) Rate-limited for plain autosaves — at most one snapshot per
    // minute of continuous work — but ALWAYS taken for a discrete
    // delimiters commit (a code-pane preamble edit is exactly the risky
    // kind of save the forensic net exists for). It rides the funnel's
    // `beforeWrite`, so a save where NEITHER file moves takes no snapshot at
    // all — the pre-415 early return's behaviour, now per-file.
    const takeSnapshot = onceBeforeWrite(async () => {
      const now = Date.now();
      const lastSnap = lastSnapshotAtByDoc.get(h.docId) ?? 0;
      if (opts?.delimiters || now - lastSnap > SNAPSHOT_MIN_INTERVAL_MS) {
        await snapshotPriorBundle(docHandle, virgil, meta.texFilename);
        lastSnapshotAtByDoc.set(h.docId, now);
      }
    });

    // A conflict resolution IS the user's decision (task 364), so it writes
    // whatever the gate thinks: the door has already archived both sides, and
    // silently declining to do the one thing the user just asked for is this
    // cluster's own silence failure mode.
    const force = opts?.userResolvedConflict === true;

    const texFh = await docHandle.getFileHandle(meta.texFilename, {
      create: true,
    });
    // The funnel stamps the ledger with the FINAL serialized `.tex` that hit
    // disk (preamble preserved), not the JSONContent — so the next poll matches
    // exactly.
    const wroteTex = await writeTrackedText(
      h.docId,
      meta.texFilename,
      texFh,
      latex,
      { force, beforeWrite: takeSnapshot },
    );

    const sidecarFh = await virgil.getFileHandle("virgil.json", {
      create: true,
    });
    const wroteSidecar = await writeTrackedText(
      h.docId,
      "virgil/virgil.json",
      sidecarFh,
      sidecarJson,
      { force, beforeWrite: takeSnapshot },
    );

    // editor-state.json is owned by useEditorUIState — and since task 417 it
    // is a LOCAL-store sidecar that never reaches this folder at all.

    if (wroteTex || wroteSidecar) await touchDocTimestamp(h.docId);
    // Cache the delimiters as they exist in the FILE ON DISK (the serializer
    // may have injected requirements into the preamble), keyed on its hash —
    // the next steady-state autosave skips the full-file read. Unconditional on
    // the funnel's verdict: a declined `.tex` write means these bytes ARE the
    // file, so the cache is equally exact either way.
    const writtenDelimiters = resolveWriteDelimiters(latex);
    if (writtenDelimiters) {
      delimiterCacheByDoc.set(h.docId, {
        texHash: latexHash,
        delimiters: writtenDelimiters,
      });
    } else {
      delimiterCacheByDoc.delete(h.docId);
    }
  });
}

/**
 * **The conflict net** (task 364).
 *
 * An external-change CONFLICT has two sides — the bytes on disk and the
 * unsaved model in the editor — and every resolution applies one of them over
 * the other. The forensic layer 357 established already nets the DISK side of
 * an ordinary write; what it never covered is the side that lives only in
 * memory. So a resolution archives BOTH sides into ONE
 * `virgil/.history/<timestamp>/` slot before either is applied, and the two
 * doors then differ only in which side they APPLY.
 *
 * > A resolution that discards one side puts that side in the net FIRST, and
 * > which door was chosen may not change what the net holds.
 *
 * The disk side is copied under its own names (`main.tex`, `virgil.json`;
 * `editor-state.json` left the folder in task 417) — the same slot shape `snapshotPriorBundle` writes, so
 * recovery from a conflict slot is recovery from any other slot. The editor's
 * side lands beside it as `unsaved-<tex>`, serialized through the SAME
 * `buildSerializeOpts` door the save path uses, so the archived copy is the
 * bytes a "keep mine" write would actually have produced. A model the
 * serializer refuses (`UnserializableNodeError`) is still the user's work, so
 * the raw model is archived as `unsaved-model.json` rather than nothing.
 *
 * Returns `null` when NO net could be taken. The caller must be able to read
 * that: a door promising "the other version is kept in history" while silently
 * copying nothing is the false-affordance shape (AGENTS.md, "The feedback
 * half").
 *
 * NOT queued through `enqueueDocWrite`: it writes only inside `.history/`,
 * never a document file, and it must land BEFORE the resolution's own queued
 * write rather than behind it in the same serial queue.
 */
export async function snapshotConflictSides(
  h: DocWriteHandle,
  mine: JSONContent | null,
): Promise<ConflictArchive | null> {
  try {
    const docHandle = await requireDocHandle(h.docId);
    const meta = await getDocMetaOrThrow(h.docId);
    const virgil = await getVirgilSubdir(docHandle);
    const history = await virgil.getDirectoryHandle(HISTORY_DIR, {
      create: true,
    });
    const slotName = historyTimestamp();
    const slot = await history.getDirectoryHandle(slotName, { create: true });

    const texName = meta.texFilename;
    const disk: string[] = [];
    for (const [dir, name] of [
      [docHandle, texName],
      [virgil, "virgil.json"],
    ] as const) {
      if (await copyFileIfPresent(dir, name, slot)) disk.push(name);
    }

    let mineName: string | null = null;
    if (mine) {
      const delimiters =
        resolveWriteDelimiters(
          await safeReadText(docHandle, texName, ""),
        ) ?? undefined;
      let body: string;
      let name: string;
      try {
        body = serializeToLatex(
          mine,
          await buildSerializeOpts(virgil, delimiters),
        );
        name = `unsaved-${texName}`;
      } catch {
        // The serializer refuses a model it cannot express (task 357). The
        // model is still the user's writing, so archive it raw rather than
        // let the one side that exists nowhere else go unnetted.
        body = JSON.stringify(mine, null, 2);
        name = "unsaved-model.json";
      }
      if (await writeTextIntoSlot(slot, name, body)) mineName = name;
    }

    await pruneHistory(history, HISTORY_LIMIT);
    return { slot: slotName, disk, mine: mineName };
  } catch (e) {
    console.warn("[storage] conflict snapshot failed:", e);
    return null;
  }
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

/**
 * The backend's name for `bib-family.detectBibFamily` — the ONE detector.
 * Kept as a backend export because it is part of the storage API surface
 * (`storage.detectBibPackage`, mirrored by storage-dev); the logic itself
 * lives in the family SSOT, where the inertness projection and the
 * preamble/body split are stated (task 344).
 */
export function detectBibPackage(tex: string): BibPackage {
  return detectBibFamily(tex);
}

/**
 * Read the authoritative per-doc bib family off the citations sidecar
 * (`virgil/citations.json`) — the user-settable SSOT. The key is present ONLY
 * when the user has chosen a family in the Citations panel: detection is a
 * seed for the in-memory view and writes to no sidecar (task 344 — before
 * that, `refreshBib` stomped the stored choice into state on every load, and
 * the next unrelated citations write made the mis-detection durable).
 *
 * Returns `null` when the sidecar is absent or carries no valid family — so a
 * document the user has never spoken for falls back to the serializer's
 * body-derived family, never forcing the wrong package.
 */
async function readDocBibFamily(
  virgil: FileSystemDirectoryHandle,
): Promise<BibFamily | null> {
  const raw = await safeReadJson<{ bibPackage?: unknown }>(
    virgil,
    "citations.json",
    {},
  );
  return asBibFamily(raw?.bibPackage);
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
    const fh = await docHandle.getFileHandle(bibFilename, { create: true });
    // Through the gated funnel (task 415), which also stamps the ledger with
    // the authoritative post-write `.bib` fingerprint. The forensic snapshot
    // rides `beforeWrite` for the same reason the bundle's does — a declined
    // write mints no `.history/` slot.
    const takeSnapshot = onceBeforeWrite(() =>
      snapshotPriorBib(docHandle, virgil, bibFilename),
    );
    await writeTrackedText(h.docId, bibFilename, fh, bibText, {
      beforeWrite: takeSnapshot,
    });
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

export async function writePdf(
  h: DocWriteHandle,
  pdfBytes: Uint8Array,
): Promise<WritePdfResult> {
  // Library/read-only papers never persist. `enqueueDocWrite` also guards this
  // (it resolves `undefined` for library docs), but we return an EXPLICIT
  // `skipped` so the caller can distinguish "intentionally not persisted" from
  // a success — the viewer still shows the in-memory bytes either way.
  if (h.docId.startsWith(LIBRARY_PAPER_PREFIX)) return { status: "skipped" };
  return enqueueDocWrite(h, "pdf", async () => {
    try {
      const docHandle = await requireDocHandle(h.docId);
      const filename = await getPdfFilename(h.docId);
      const fh = await docHandle.getFileHandle(filename, { create: true });
      const writable = await fh.createWritable();
      await writable.write(pdfBytes.buffer as ArrayBuffer);
      await writable.close();
      return { status: "written" } as WritePdfResult;
    } catch (err) {
      // A stale/superseded pipeline still throws so the compile hook's
      // `isStalePipelineError` catch can drop it silently. A genuine IO
      // failure resolves to `failed` so it never throws past the caller —
      // the compile succeeded; only persistence didn't.
      if (isStalePipelineError(err)) throw err;
      return { status: "failed", error: err } as WritePdfResult;
    }
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

// tex-write-exempt: a DERIVED cache index (figure raster fingerprints), not
// user content — regenerated from the figures on the next scan. Nothing here
// can lose a word of the document.
export async function writeFigureIndex(
  h: DocWriteHandle,
  index: Record<string, { source: string; mtimeMs: number; size: number }>,
): Promise<void> {
  return enqueueDocWrite(h, "figures/index", async () => {
    const docHandle = await requireDocHandle(h.docId);
    const cacheDir = await getFiguresCacheDir(docHandle, { create: true });
    const fh = await cacheDir.getFileHandle(FIGURE_INDEX_FILE, { create: true });
    // Derived, but it lives INSIDE the paper folder, so a rewrite of identical
    // bytes is sync traffic exactly like any other (task 415). Nothing watches
    // this relPath, so the ledger entry here exists only to serve the gate.
    await writeTrackedText(
      h.docId,
      `virgil/${FIGURES_CACHE_DIR}/${FIGURE_INDEX_FILE}`,
      fh,
      JSON.stringify(index, null, 2),
    );
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

// tex-write-exempt: CREATION only. Both callers (`createDoc`,
// `createDocInFolder`) refuse when any of the template's filenames already
// exists, so this can never overwrite a byte of anyone's document — there is
// no prior state for a gate to compare against or for a snapshot to keep.
// write-gate-exempt: same fact, the other question (task 415) — a file that
// does not exist yet cannot already hold these bytes, so the byte-equality
// gate has nothing to answer and the ledger has nothing to stamp. The doc's
// first real write stamps every one of these paths.
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
 * List the FILE names directly inside `virgil/` (task 363) — the input to the
 * sync-conflict scan. Read-only: it does NOT create the directory (a paper that
 * has never had a sidecar written has nothing to scan and answers `[]`), and it
 * does not descend into `.history/`.
 *
 * One directory enumeration, once per doc activation. Not on any hot path.
 */
export async function listSidecarNames(docId: string): Promise<string[]> {
  const docHandle = await requireDocHandle(docId);
  let virgil: FileSystemDirectoryHandle;
  try {
    virgil = await docHandle.getDirectoryHandle(VIRGIL_SUBDIR);
  } catch (e) {
    if (isNotFound(e)) return [];
    throw e;
  }
  const out: string[] = [];
  for await (const entry of virgil.values()) {
    if (entry.kind === "file") out.push(entry.name);
  }
  return out;
}

/**
 * Delete the sync-conflict debris a run PROVES carries nothing (task 411).
 *
 * **The door decides, not the caller.** It re-lists `virgil/` INSIDE the write
 * critical section and re-derives the sanctioned set through
 * `planSidecarCleanup` — the one place that answer is computed. `names` is a
 * FILTER, never an instruction: a file is removed only when it is in BOTH the
 * caller's list (so nothing is deleted that the user was not shown) and the
 * freshly-derived plan (so no call site can name a content fork into the set).
 * A name present on disk but outside the plan comes back as `refused`; a name
 * that is no longer on disk at all is in no bucket, because there was nothing to
 * delete and nothing was kept.
 *
 * **What the serialization actually buys, stated precisely.** A conflict fork is
 * a name Virgil never writes, so it races nothing. A `.crswap` is different: it
 * is Chrome's own in-flight write buffer for a file Virgil DOES write, created
 * by `createWritable()` and renamed over the target by `close()`. Deleting one
 * mid-write makes that `close()` reject.
 *
 * The obvious claim — "`enqueueDocWrite` takes `withDocLock`, so every Virgil
 * write is excluded" — is FALSE in the ordinary case, and saying it would be the
 * gate-not-callback shape this repo legislates against: a window that has
 * `claimDoc`ed the paper already HOLDS that Web Lock, so `withDocLock`
 * short-circuits and in-window exclusion falls to `enqueueWrite`'s per-SUBKEY
 * queue, which does not serialize a cleanup against a sidecar write. What holds
 * instead is: (1) only the OWNING window writes a doc, so cross-window is
 * covered by the ownership claim; (2) this door DRAINS that window's pending
 * writes before it enqueues, so nothing queued is mid-write when it enumerates;
 * and (3) the listing is read INSIDE the queued task rather than handed in, so
 * the plan describes the folder as it is at delete time.
 *
 * The residual is a write DISPATCHED during the delete itself, and it is
 * accepted with its cost named: the loser is a `close()` that rejects, i.e. one
 * write that does not land. Its bytes were in the swap and never in the live
 * file, which is untouched — so the failure is a retry (the autosave's next
 * debounce, and task 392's channel reports it), never a lost byte.
 *
 * No `.history/` net, deliberately — see the header of
 * [sync-conflict-cleanup.ts](sync-conflict-cleanup.ts).
 */
export async function deleteSidecarSiblings(
  h: DocWriteHandle,
  names: readonly string[],
): Promise<SidecarCleanupReceipt> {
  const empty: SidecarCleanupReceipt = { deleted: [], refused: [], failed: [] };
  // Drain this window's pending writes BEFORE enqueueing — from inside the
  // queue this would wait on itself. See the note above on what this buys.
  await flushPrefix(h.docId);
  const result = await enqueueDocWrite<SidecarCleanupReceipt>(
    h,
    "virgil/_cleanup",
    async () => {
      const receipt: SidecarCleanupReceipt = {
        deleted: [],
        refused: [],
        failed: [],
      };
      const docHandle = await requireDocHandle(h.docId);
      let virgil: FileSystemDirectoryHandle;
      try {
        virgil = await docHandle.getDirectoryHandle(VIRGIL_SUBDIR);
      } catch (e) {
        if (isNotFound(e)) return receipt;
        throw e;
      }
      const onDisk: string[] = [];
      for await (const entry of virgil.values()) {
        if (entry.kind === "file") onDisk.push(entry.name);
      }
      const present = new Set(onDisk);
      const sanctioned = new Set(
        planSidecarCleanup(onDisk).map((e) => e.name),
      );
      for (const name of names) {
        if (!present.has(name)) continue; // already gone — nothing kept
        if (!sanctioned.has(name)) {
          receipt.refused.push(name);
          continue;
        }
        try {
          await virgil.removeEntry(name);
          receipt.deleted.push(name);
        } catch (e) {
          if (isNotFound(e)) continue;
          receipt.failed.push(name);
        }
      }
      return receipt;
    },
  );
  // `enqueueDocWrite` short-circuits a library-paper doc to `undefined` without
  // running the task — normalize to "nothing happened" rather than crash.
  return result ?? empty;
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

/** Copy one file into a history slot. Returns whether a copy actually landed,
 *  which is what lets a caller REPORT what its net holds rather than claim it
 *  (task 364) — the two snapshot callers below ignore it, as they always have. */
async function copyFileIfPresent(
  source: FileSystemDirectoryHandle,
  filename: string,
  dest: FileSystemDirectoryHandle,
): Promise<boolean> {
  try {
    const sourceFh = await source.getFileHandle(filename);
    const file = await sourceFh.getFile();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const destFh = await dest.getFileHandle(filename, { create: true });
    const w = await destFh.createWritable();
    await w.write(bytes.buffer as ArrayBuffer);
    await w.close();
    return true;
  } catch (e) {
    if (isNotFound(e)) return false; // nothing to snapshot yet
    // Don't let snapshot failures block the actual write — log and
    // continue. The write itself is the thing the user cares about.
    console.warn(`[storage] history snapshot failed for ${filename}:`, e);
    return false;
  }
}

/**
 * Write in-memory text INTO a history slot (task 364's editor side).
 *
 * Deliberately the same raw-writable idiom `copyFileIfPresent` uses rather than
 * the shared `writeTextToHandle`: this is the forensic NET writing its own
 * contents, which `tex-write-accountability`'s census states as out of scope
 * for exactly this reason — gating the net against the document it exists to
 * preserve would be a category error. Keeping it here, beside the copier, is
 * what keeps that classification true by construction instead of by a marker.
 */
async function writeTextIntoSlot(
  slot: FileSystemDirectoryHandle,
  filename: string,
  text: string,
): Promise<boolean> {
  try {
    const fh = await slot.getFileHandle(filename, { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
    return true;
  } catch (e) {
    console.warn(`[storage] history slot write failed for ${filename}:`, e);
    return false;
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
