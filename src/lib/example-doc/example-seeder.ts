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
 * Re-seed policy (data-loss-safe): files are written ONLY when no seed
 * marker is present (cold start / wiped OPFS). On a `seedVersion` BUMP over
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
  purgeDoc,
  readIndex,
  setDocHandle,
  writeIndex,
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
    return null; // absent / unreadable → treat as "not seeded"
  }
}

// In-window dedupe: two empty-state clicks (or a StrictMode double-invoke)
// share one seed pass rather than racing two writers into the same dir.
let inflight: Promise<FsaDocMeta> | null = null;

/**
 * Ensure the example exists in OPFS and is registered in the index, healing
 * either store if it was cleared. Idempotent; safe to call on every open.
 * Returns the `FsaDocMeta` (now) in the index, ready for `activateDoc`.
 */
export async function ensureExampleSeeded(): Promise<FsaDocMeta> {
  if (isDevStorage || !opfsAvailable()) throw new ExampleUnavailableError();
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      return await seedImpl();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

async function seedImpl(): Promise<FsaDocMeta> {
  const dir = await getOpfsDocDir(EXAMPLE_FOLDER_NAME, { create: true });
  const manifest = await fetchManifest();
  const marker = await readSeedMarker(dir);

  if (marker === null) {
    // Cold start or wiped OPFS: write the full tree, marker LAST as the
    // commit point (a crash mid-seed leaves no marker → next call re-seeds).
    const files: SeedFile[] = [];
    for (const entry of manifest.files) {
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
  const idx = await readIndex();
  let meta = idx.docs.find((d) => d.id === EXAMPLE_DOC_ID);
  if (!meta) {
    const now = new Date().toISOString();
    meta = {
      id: EXAMPLE_DOC_ID,
      name: EXAMPLE_DOC_NAME,
      texFilename: texFilename || EXAMPLE_TEX_FILENAME,
      folderName: EXAMPLE_FOLDER_NAME,
      createdAt: now,
      lastModifiedAt: now,
      lastAccessedAt: now,
    };
    idx.docs.push(meta);
    await writeIndex(idx);
  }
  // Always (re)store the handle: heals the "IndexedDB cleared / dead handle"
  // cases and is cheap when unchanged.
  await setDocHandle(EXAMPLE_DOC_ID, dir);
  return meta;
}

/**
 * Hard reset: drain pending writes, recursively wipe the OPFS dir, drop the
 * index row + handle, then re-seed pristine. Restores the original example,
 * discarding the user's edits + AI annotations. Keeps the same fixed id so
 * it never duplicates in recents.
 */
export async function resetExample(): Promise<FsaDocMeta> {
  if (isDevStorage || !opfsAvailable()) throw new ExampleUnavailableError();
  // Orphan any in-flight seed so the re-seed at the end starts FRESH AFTER the
  // wipe. Otherwise the trailing `ensureExampleSeeded()` would return a stale
  // mid-flight promise that could write into the just-deleted OPFS dir.
  inflight = null;
  await drainDoc(EXAMPLE_DOC_ID);
  await removeOpfsDocDir(EXAMPLE_FOLDER_NAME);
  const idx = await readIndex();
  idx.docs = idx.docs.filter((d) => d.id !== EXAMPLE_DOC_ID);
  await writeIndex(idx);
  await purgeDoc(EXAMPLE_DOC_ID);
  return ensureExampleSeeded();
}
