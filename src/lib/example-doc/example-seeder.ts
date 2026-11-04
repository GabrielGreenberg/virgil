/**
 * The bundled, editable EXAMPLE document.
 *
 * New users land with no picked folder and (in production) no server, so we
 * ship the example as a static asset under `public/examples/<id>/` (built
 * from `samples/annotation-history/` by `scripts/build-example-bundle.mjs`)
 * and seed it into OPFS on first open. The seeded directory is then
 * registered as an ORDINARY indexed document whose handle happens to come
 * from OPFS — so it flows through the unchanged storage core (listDocs,
 * openFile, permission gate, the write funnel) like any user folder, and is
 * fully editable + AI-coworkable.
 *
 * `ensureExampleSeeded()` is the single idempotent, self-healing entry
 * point. It is robust to the two ways the two persistence stores (the OPFS
 * bytes and the IndexedDB index/handle) can desync:
 *   - IndexedDB cleared, OPFS intact → re-add the index row + re-`setDocHandle`,
 *     do NOT touch the user's files.
 *   - OPFS cleared, IndexedDB intact (dead handle) → re-seed files +
 *     re-`setDocHandle`.
 *
 * Re-seed policy (data-loss-safe): files are written ONLY when no readable
 * seed marker is present (cold start / wiped OPFS / failed marker write), and
 * then ONLY the files that are absent — an existing file is never
 * overwritten outside `resetExample()`. On a `seedVersion` BUMP over
 * an existing sandbox we adopt the new version marker WITHOUT clobbering the
 * user's edits / AI sidecars — updated shipped content reaches an existing
 * sandbox only through the explicit `resetExample()` path.
 *
 * Production-only: in dev-backend mode (the Claude-preview iframe) the OPFS
 * path is unreachable, so the entry points throw `ExampleUnavailableError`
 * and the UI hides the affordances.
 */

import {
  type FsaDocMeta,
  mutateIndex,
  purgeDoc,
  setDocHandle,
} from "@/lib/doc-index";
import { drainDoc } from "@/lib/storage";
import { publicAssetUrl } from "@/lib/public-asset-url";
import { isDevStorage } from "@/lib/storage-mode";
import {
  getOpfsDocDir,
  opfsAvailable,
  removeOpfsDocDir,
  writeTreeIntoDir,
  type SeedFile,
} from "./opfs-doc-location";
import {
  EXAMPLE_DOC_ID,
  EXAMPLE_DOC_NAME,
  EXAMPLE_FOLDER_NAME,
  EXAMPLE_TEX_FILENAME,
} from "./example-identity";

// Re-export the identity constants so existing consumers can keep importing
// them from the seeder; the canonical (dependency-free) home is ./example-identity.
export {
  EXAMPLE_DOC_ID,
  EXAMPLE_DOC_NAME,
  EXAMPLE_FOLDER_NAME,
  EXAMPLE_TEX_FILENAME,
};

/** Seed-version marker, kept inside `virgil/` so `collectFiles`'s `virgil/`
 *  skip (storage-fsa.ts:1426) keeps it out of compiles and it's not a real
 *  sidecar filename. */
const SEED_MARKER_PATH = "virgil/.example-seed.json";

/** Thrown when the example is requested where OPFS can't run (dev backend /
 *  ancient browser). Callers treat it as "hide the affordance", not an error. */
export class ExampleUnavailableError extends Error {
  constructor() {
    super("The example document requires OPFS, which isn't available here.");
    this.name = "ExampleUnavailableError";
  }
}

interface ExampleManifest {
  seedVersion: string;
  docId: string;
  folderName: string;
  texFilename: string;
  files: { path: string; encoding: "utf8" | "binary" }[];
}

/** Build a same-origin asset URL for this example's bundle, honoring a
 *  subdirectory deploy's prefix through the ONE public-asset door (task 365 —
 *  it replaced the hand-rolled copy this and skill-sync each carried). */
function bundleUrl(relPath: string): string {
  return publicAssetUrl(`/examples/${EXAMPLE_DOC_ID}/${relPath}`);
}

async function fetchManifest(): Promise<ExampleManifest> {
  // `no-store` bypasses any stale service-worker copy on the network path
  // (the SW still serves cache when offline). Same trick skill-sync uses.
  const resp = await fetch(bundleUrl("manifest.json"), { cache: "no-store" });
  if (!resp.ok) {
    throw new Error(`example manifest fetch failed: ${resp.status}`);
  }
  return (await resp.json()) as ExampleManifest;
}

async function readSeedMarker(
  dir: FileSystemDirectoryHandle,
): Promise<string | null> {
  try {
    const virgil = await dir.getDirectoryHandle("virgil");
    const fh = await virgil.getFileHandle(".example-seed.json");
    const text = await (await fh.getFile()).text();
    return (JSON.parse(text) as { seedVersion?: string }).seedVersion ?? null;
  } catch {
    // Absent OR unreadable (corrupt JSON, transient read failure) — the two
    // need no telling apart, because the remedy below is non-destructive:
    // it fills only the files that are missing, never overwrites one.
    return null;
  }
}

/** Whether `path` (relative to `dir`) is DEFINITELY absent. Only a
 *  NotFoundError says so; any other failure answers "not absent", so an
 *  unreadable file is left alone rather than overwritten. */
async function isAbsent(
  dir: FileSystemDirectoryHandle,
  path: string,
): Promise<boolean> {
  const segments = path.split("/").filter(Boolean);
  const filename = segments.pop();
  if (!filename) return false;
  try {
    let cursor = dir;
    for (const seg of segments) cursor = await cursor.getDirectoryHandle(seg);
    await cursor.getFileHandle(filename);
    return false;
  } catch (e) {
    return e instanceof DOMException && e.name === "NotFoundError";
  }
}

// The ONE in-window slot for work on the example's directory — a seed or a
// reset. Two empty-state clicks (or a StrictMode double-invoke) share one
// seed pass; an open during a reset waits for the reset's pristine seed; a
// second reset joins the first. Cleared COMPARE-AND-CLEAR, so a pass that
// settles after it was superseded can never clear its successor's entry.
let inflight: { promise: Promise<FsaDocMeta>; isReset: boolean } | null = null;

function occupy(
  isReset: boolean,
  run: () => Promise<FsaDocMeta>,
): Promise<FsaDocMeta> {
  const entry = { isReset, promise: null as unknown as Promise<FsaDocMeta> };
  entry.promise = (async () => {
    try {
      return await run();
    } finally {
      if (inflight === entry) inflight = null;
    }
  })();
  inflight = entry;
  return entry.promise;
}

/**
 * Ensure the example exists in OPFS and is registered in the index, healing
 * either store if it was cleared. Idempotent; safe to call on every open.
 * Returns the `FsaDocMeta` (now) in the index, ready for `activateDoc`.
 */
export async function ensureExampleSeeded(): Promise<FsaDocMeta> {
  if (isDevStorage || !opfsAvailable()) throw new ExampleUnavailableError();
  if (inflight) return inflight.promise;
  return occupy(false, seedImpl);
}

async function seedImpl(): Promise<FsaDocMeta> {
  const dir = await getOpfsDocDir(EXAMPLE_FOLDER_NAME, { create: true });
  const manifest = await fetchManifest();
  const marker = await readSeedMarker(dir);

  if (marker === null) {
    // No readable marker: a cold start, a wiped OPFS, an interrupted seed —
    // or a sandbox whose marker write failed (quota) after its files landed
    // and the user then edited. So write ONLY the files that are absent,
    // marker LAST as the commit point (a crash mid-seed leaves no marker →
    // the next call fills the rest). An empty dir gets the full tree; an
    // edited one keeps every edit.
    const files: SeedFile[] = [];
    for (const entry of manifest.files) {
      if (!(await isAbsent(dir, entry.path))) continue;
      const resp = await fetch(bundleUrl(entry.path), { cache: "no-store" });
      if (!resp.ok) {
        throw new Error(`example asset fetch failed: ${entry.path} ${resp.status}`);
      }
      files.push(
        entry.encoding === "binary"
          ? { path: entry.path, bytes: await resp.arrayBuffer() }
          : { path: entry.path, text: await resp.text() },
      );
    }
    await writeTreeIntoDir(dir, files);
    await writeMarker(dir, manifest.seedVersion);
  } else if (marker !== manifest.seedVersion) {
    // Version bump over an EXISTING (possibly user-edited) sandbox: adopt the
    // new marker but DO NOT clobber the user's edits / AI sidecars. Updated
    // shipped content reaches this sandbox only via explicit resetExample().
    await writeMarker(dir, manifest.seedVersion);
  }
  // else: marker current → bytes untouched.

  return ensureIndexRowAndHandle(dir, manifest.texFilename);
}

async function writeMarker(
  dir: FileSystemDirectoryHandle,
  seedVersion: string,
): Promise<void> {
  await writeTreeIntoDir(dir, [
    { path: SEED_MARKER_PATH, text: JSON.stringify({ seedVersion }) },
  ]);
}

/** Heal the index row + stored handle independently of the byte seed. */
async function ensureIndexRowAndHandle(
  dir: FileSystemDirectoryHandle,
  texFilename: string,
): Promise<FsaDocMeta> {
  // Always (re)store the handle — before the row, so no reader finds a row
  // without one. Heals the "IndexedDB cleared / dead handle" cases and is
  // cheap when unchanged.
  await setDocHandle(EXAMPLE_DOC_ID, dir);
  return mutateIndex((idx) => {
    const existing = idx.docs.find((d) => d.id === EXAMPLE_DOC_ID);
    if (existing) return existing;
    const now = new Date().toISOString();
    const meta: FsaDocMeta = {
      id: EXAMPLE_DOC_ID,
      name: EXAMPLE_DOC_NAME,
      texFilename: texFilename || EXAMPLE_TEX_FILENAME,
      folderName: EXAMPLE_FOLDER_NAME,
      createdAt: now,
      lastModifiedAt: now,
      lastAccessedAt: now,
    };
    idx.docs.push(meta);
    return meta;
  });
}

/**
 * Hard reset: drain pending writes, recursively wipe the OPFS dir, drop the
 * index row + handle, then re-seed pristine. Restores the original example,
 * discarding the user's edits + AI annotations. Keeps the same fixed id so
 * it never duplicates in recents.
 */
export async function resetExample(): Promise<FsaDocMeta> {
  if (isDevStorage || !opfsAvailable()) throw new ExampleUnavailableError();
  if (inflight?.isReset) return inflight.promise;
  // Take the slot (so an open during the reset waits for its pristine seed),
  // then let any seed already running SETTLE before the wipe: a seed that
  // outlived the wipe would write into the deleted dir through its stale
  // handle and push its index row across the purge below.
  const prior = inflight?.promise;
  return occupy(true, async () => {
    await prior?.catch(() => {});
    await drainDoc(EXAMPLE_DOC_ID);
    await removeOpfsDocDir(EXAMPLE_FOLDER_NAME);
    await mutateIndex((idx) => {
      idx.docs = idx.docs.filter((d) => d.id !== EXAMPLE_DOC_ID);
    });
    // A RESET, not a removal: the fixed id is re-seeded below, so it keeps
    // its place in the user's "My Papers" list (purgeDoc's census).
    await purgeDoc(EXAMPLE_DOC_ID, "reset");
    return seedImpl();
  });
}
