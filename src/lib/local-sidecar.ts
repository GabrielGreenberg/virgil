/**
 * **The LOCAL sidecar store** — where a `store: "local"` sidecar lives
 * (task 417). This browser's IndexedDB, keyed by doc id and filename, never the
 * paper's `virgil/` folder.
 *
 * ## Why this exists
 *
 * Tasks 363 / 411 / 415 each shrank the rate at which Virgil writes the synced
 * folder; none of them could touch the remaining premise, which is that
 * per-MACHINE state was living in a folder whose whole job is to be identical
 * on every machine. Where THIS window was scrolled to, which paragraph THIS
 * caret was in — two machines legitimately disagree about those, so every sync
 * of the file that holds them is a conflict the daemon has to mint. That file
 * (`editor-state.json`) was the single loudest fork base in the measured
 * folder and holds nothing a second machine wants. The honest fix is not a
 * slower write; it is a different home.
 *
 * ## The contract
 *
 * - Which files live here is DECLARED once, on [sidecar-value.ts](sidecar-value.ts)
 *   (`store: "local"`), and this module is reached only by the sidecar doors
 *   in the two storage backends, which consult that declaration. A hook that
 *   owns a local-store file (`useEditorUIState`) calls the same
 *   `readSidecarIfExists` / `writeSidecar` it always did and does not know
 *   where its bytes went. That is the point: no writer anywhere can put a
 *   local-store file on disk, because no writer decides.
 * - **ONE-TIME MIGRATION, read-only on the folder.** A pre-417 build wrote the
 *   file to `virgil/`. The first read on each (machine, doc) that finds nothing
 *   here asks the backend's DISK reader once; a value found there is copied in
 *   and becomes the local copy. The disk file is NOT deleted — a delete is
 *   itself sync traffic in the folder whose problem is sync traffic (task 415's
 *   rule), the badge's cleanup already knows how to drain a view-tier fork, and
 *   the stale original is inert: nothing reads it after the first open and
 *   nothing writes it ever again. It is also what lets a second machine
 *   migrate from the same seed.
 * - Writes are serialized per key, so a `mutate` read-modify-write and a plain
 *   write for one file cannot interleave (the task-220 shape, in miniature).
 * - Rides the SAME `virgil`/`kv` IndexedDB store the doc-index, tex-assets and
 *   emergency mirror use, so the privacy footprint is unchanged.
 *
 * This module imports nothing from the storage backends; they import it.
 */

import { createStore, del, get, set } from "idb-keyval";

import { sidecarStore } from "@/lib/sidecar-value";

// Reuse the SAME origin store doc-index / tex-assets / emergency-mirror use.
const store = createStore("virgil", "kv");

const KEY_PREFIX = "local-sidecar/";

/** Exported for the suites, so a test can assert the KEY SHAPE rather than
 *  re-deriving it. */
export function localSidecarKey(docId: string, filename: string): string {
  return `${KEY_PREFIX}${docId}/${filename}`;
}

/** The routing question every sidecar door asks first. */
export function isLocalSidecar(filename: string): boolean {
  return sidecarStore(filename) === "local";
}

/** Per-key serial queue — a write landing between a mutate's read and its
 *  write would be the lost-update shape task 220 closed on disk. */
const chains = new Map<string, Promise<unknown>>();
function serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.then(task, task);
  chains.set(key, next);
  void next.finally(() => {
    if (chains.get(key) === next) chains.delete(key);
  });
  return next;
}

/**
 * Read a local-store sidecar. `null` when this browser holds nothing for it
 * AND the one-time migration source had nothing either.
 *
 * `migrateFrom` is the backend's DIRECT disk reader for the same file (`null`
 * on absent). It is consulted only on a local miss, and its answer — when
 * non-null — is copied in so the next read is local. A migration source that
 * THROWS (permission loss, a detached handle) is treated as "nothing to
 * migrate": the read fails open to `null`, which is what a fresh doc reads
 * too, and the next open asks again.
 */
export async function readLocalSidecar<T>(
  docId: string,
  filename: string,
  migrateFrom?: () => Promise<T | null>,
): Promise<T | null> {
  const key = localSidecarKey(docId, filename);
  const local = (await get<T>(key, store)) ?? null;
  if (local !== null) return local;
  if (!migrateFrom) return null;
  let seed: T | null = null;
  try {
    seed = await migrateFrom();
  } catch {
    seed = null;
  }
  if (seed === null) return null;
  await serialize(key, async () => {
    // A write may have landed while the disk read was in flight; the LOCAL
    // copy is the newer one by construction, so never overwrite it with the
    // seed.
    const raced = (await get<T>(key, store)) ?? null;
    if (raced === null) await set(key, seed, store);
  });
  return (await get<T>(key, store)) ?? seed;
}

/** Write (replace) a local-store sidecar. */
export async function writeLocalSidecar<T>(
  docId: string,
  filename: string,
  data: T,
): Promise<void> {
  const key = localSidecarKey(docId, filename);
  await serialize(key, () => set(key, data, store));
}

/**
 * Serialized read-modify-write of a local-store sidecar — the local twin of
 * `mutateSidecar`'s contract: `null` from the mutator means nothing to change
 * (no write, resolves `null`).
 */
export async function mutateLocalSidecar<T>(
  docId: string,
  filename: string,
  defaultValue: T,
  mutate: (current: T) => T | null,
  migrateFrom?: () => Promise<T | null>,
): Promise<T | null> {
  const key = localSidecarKey(docId, filename);
  return serialize(key, async () => {
    const current =
      (await get<T>(key, store)) ??
      (migrateFrom ? await migrateFrom().catch(() => null) : null) ??
      defaultValue;
    const next = mutate(current);
    if (next === null) return null;
    await set(key, next, store);
    return next;
  });
}

/** Drop a doc's local-store sidecar (a doc removed from the index). */
export async function deleteLocalSidecar(
  docId: string,
  filename: string,
): Promise<void> {
  const key = localSidecarKey(docId, filename);
  await serialize(key, () => del(key, store));
}
