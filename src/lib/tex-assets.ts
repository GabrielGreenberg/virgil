/**
 * TeX asset provisioning layer (P1 offline-assets).
 *
 * Sits between `getPdfTeXEngine`/the CompileService and the vendored worker.
 * Its job: make TeX packages — including the base `.fmt` — available OFFLINE,
 * so a mirror outage (or a genuinely offline user) no longer means zero
 * compiles. It does this in two cooperating tiers, both replayed into the
 * worker BEFORE the first compile via the additive `seedcache` message:
 *
 *   Tier A — CURATED LOCAL SEED: the same-origin bundled manifest
 *     (`CORE_MANIFEST` from tex-core-manifest.ts): the base `.fmt` plus, once
 *     the manager captures them, the core packages Virgil emits. Byte-for-byte
 *     identical to a real mirror fetch.
 *   Tier B — PERSISTENT WRITE-THROUGH CACHE: every asset the worker fetches
 *     online is dumped back (`dumpnewcache`) and written through to IndexedDB
 *     (`captureNewAssets`), then replayed on the next session — so once fetched,
 *     a package works offline forever.
 *
 * Storage: the SAME idb-keyval store Virgil already uses
 * (`createStore("virgil","kv")`, exactly as src/lib/doc-index.ts), under a
 * `tex-asset/<cacheKey>` key prefix. Write-through goes through the per-key
 * serial `enqueueWrite` from src/lib/write-queue.ts so concurrent compiles
 * never race the cache. Integrity/dedup uses the shared cyrb53 `hashContent`
 * from src/lib/disk-ledger.ts.
 *
 * This layer touches ONLY the engine-internal `/tex` kpse cache — never the
 * document `/work` bytes and never the `.tex` source — so the byte-stable
 * round-trip and the requirements-injection order the drift-gate depends on
 * are entirely unaffected.
 */

import { get, set, keys, del, createStore } from "idb-keyval";

import { hashContent } from "@/lib/disk-ledger";
import { enqueueWrite } from "@/lib/write-queue";
import { CORE_MANIFEST, PLACEHOLDER_FMT_CACHEKEY } from "@/lib/tex-core-manifest";
import { publicAssetUrl } from "@/lib/public-asset-url";
import type { TexCacheDumpEntry } from "@/types/swiftlatex";

// Reuse the SAME origin store as doc-index.ts (do NOT open a second DB).
const store = createStore("virgil", "kv");

const KEY_PREFIX = "tex-asset/";

/**
 * Total-size cap for the persistent TeX cache. TeXLive's cacheKey namespace is
 * finite, but a pathological run could still pile up; past this we stop
 * write-through (and log what we dropped) rather than pressure the IndexedDB
 * quota. Tunable.
 */
const CACHE_SIZE_CAP_BYTES = 64 * 1024 * 1024; // 64 MB

/** Persisted cache record. `bytes` structured-clones fine as a Uint8Array. */
export interface TexAssetRecord {
  cacheKey: string;
  fileid: string;
  bytes: Uint8Array;
  /** cyrb53 fingerprint of the bytes, for dedup / integrity. */
  hash: string;
  fetchedAt: number;
}

/** The minimal engine surface this layer needs (real engine OR a test fake). */
export interface ProvisionableEngine {
  seedCache(cacheKey: string, fileid: string, src: Uint8Array | ArrayBuffer): void;
  dumpNewCache(): Promise<TexCacheDumpEntry[]>;
  setOffline(value: boolean): void;
}

const cacheKeyToStoreKey = (cacheKey: string): string => KEY_PREFIX + cacheKey;
const storeKeyToCacheKey = (storeKey: string): string =>
  storeKey.slice(KEY_PREFIX.length);

/** Hash raw bytes via the shared cyrb53 helper (which takes a string). We map
 *  bytes → a latin1 string so equal bytes always hash equally and cheaply. */
function hashBytes(bytes: Uint8Array): string {
  // Chunk to avoid a huge apply() arg list on multi-MB assets.
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return hashContent(s);
}

/** All persisted tex-asset store keys (full `tex-asset/<cacheKey>` form). */
async function persistedStoreKeys(): Promise<string[]> {
  const all = (await keys(store)) as unknown[];
  return all
    .filter((k): k is string => typeof k === "string" && k.startsWith(KEY_PREFIX));
}

/** Fetch a bundled same-origin asset's bytes. `CORE_MANIFEST` holds ROOT-relative
 *  paths (a DATA table — see its header); this is the CONSUMER, so it is where
 *  the deploy prefix is applied, through the one public-asset door (task 365),
 *  and subdirectory deploys (GitHub Pages at /virgil/) resolve. Returns null on
 *  any failure so a missing/placeholder manifest entry is tolerated. */
async function fetchBundledBytes(path: string): Promise<Uint8Array | null> {
  const url = publicAssetUrl(path);
  try {
    // The service worker serves these offline once cached (SW precache). We
    // still hit the network path first so a re-vendored asset refreshes.
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const buf = await resp.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

/**
 * Seed the worker's kpse cache BEFORE the first compile:
 *   (1) the bundled curated-core manifest (Tier A) — fetch each entry's bytes
 *       same-origin and `seedCache` them;
 *   (2) every persisted IndexedDB `tex-asset/*` entry (Tier B) — `seedCache`
 *       them from the store.
 * Then push `navigator.onLine` into the worker (`setOffline(!onLine)`).
 *
 * Idempotent and best-effort: a missing/placeholder manifest, a failed fetch,
 * or an empty store all degrade to a no-op (the worker just falls back to the
 * mirror path, exactly as today). Never throws.
 */
export async function provisionEngine(engine: ProvisionableEngine): Promise<void> {
  try {
    // Tier A — bundled curated core. Skip the placeholder .fmt cacheKey: it is
    // deliberately wrong until the manager captures the real one, so seeding it
    // would register bytes under a key no real lookup ever asks for (harmless,
    // but pointless — and it would fetch a 10MB .fmt for nothing).
    await Promise.all(
      CORE_MANIFEST.map(async (entry) => {
        if (entry.cacheKey === PLACEHOLDER_FMT_CACHEKEY) return;
        const bytes = await fetchBundledBytes(entry.path);
        if (!bytes) return;
        engine.seedCache(entry.cacheKey, entry.fileid, bytes);
      }),
    );

    // Tier B — persisted write-through cache.
    const storeKeys = await persistedStoreKeys();
    await Promise.all(
      storeKeys.map(async (storeKey) => {
        const rec = (await get(storeKey, store)) as TexAssetRecord | undefined;
        if (!rec || !rec.bytes) return;
        engine.seedCache(rec.cacheKey, rec.fileid, rec.bytes);
      }),
    );
  } catch (err) {
    console.warn("[tex-assets] provisionEngine seeding failed (falling back to mirror):", err);
  }

  // Push connectivity into the worker so uncached lookups fail fast offline.
  try {
    const online =
      typeof navigator !== "undefined" ? navigator.onLine !== false : true;
    engine.setOffline(!online);
  } catch {
    // no navigator (SSR/tests) — leave the worker in its default online mode.
  }
}

/** Current total bytes of the persisted cache (for the size cap). */
async function currentCacheSize(): Promise<number> {
  let total = 0;
  const storeKeys = await persistedStoreKeys();
  for (const storeKey of storeKeys) {
    const rec = (await get(storeKey, store)) as TexAssetRecord | undefined;
    if (rec?.bytes) total += rec.bytes.byteLength;
  }
  return total;
}

/**
 * After a compile, drain the worker's freshly-cached entries
 * (`dumpNewCache`) and WRITE THROUGH each NEW one to IndexedDB via the serial
 * `enqueueWrite` queue. Dedups against what's already stored (by cacheKey +
 * byte hash) and enforces a total-size cap (skips + logs what's dropped).
 *
 * Best-effort: never throws, so a compile is never failed by a cache write.
 */
export async function captureNewAssets(engine: ProvisionableEngine): Promise<void> {
  let entries: TexCacheDumpEntry[];
  try {
    entries = await engine.dumpNewCache();
  } catch (err) {
    console.warn("[tex-assets] dumpNewCache failed:", err);
    return;
  }
  if (!entries || entries.length === 0) return;

  // Which cacheKeys are already persisted (skip re-writing identical bytes).
  const existing = new Set(
    (await persistedStoreKeys()).map(storeKeyToCacheKey),
  );

  let runningSize = await currentCacheSize();
  const dropped: string[] = [];

  for (const entry of entries) {
    if (!entry?.cacheKey || !entry.bytes) continue;
    const bytes = new Uint8Array(entry.bytes);

    if (existing.has(entry.cacheKey)) {
      // Already stored — dedup by hash. If bytes changed (re-vendor), fall
      // through and overwrite; otherwise skip.
      const prev = (await get(cacheKeyToStoreKey(entry.cacheKey), store)) as
        | TexAssetRecord
        | undefined;
      if (prev && prev.hash === hashBytes(bytes)) continue;
    }

    if (runningSize + bytes.byteLength > CACHE_SIZE_CAP_BYTES) {
      dropped.push(`${entry.cacheKey} (${bytes.byteLength}B)`);
      continue;
    }

    const rec: TexAssetRecord = {
      cacheKey: entry.cacheKey,
      fileid: entry.fileid,
      bytes,
      hash: hashBytes(bytes),
      fetchedAt: Date.now(),
    };
    // Serial write-through, keyed so concurrent compiles never race the store.
    await enqueueWrite("tex-asset", () =>
      set(cacheKeyToStoreKey(entry.cacheKey), rec, store),
    );
    existing.add(entry.cacheKey);
    runningSize += bytes.byteLength;
  }

  if (dropped.length > 0) {
    console.warn(
      `[tex-assets] cache size cap (${CACHE_SIZE_CAP_BYTES} bytes) reached; dropped ${dropped.length} asset(s): ${dropped.join(", ")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Dev tools
// ---------------------------------------------------------------------------

/** List the cacheKeys currently persisted in the TeX asset cache. */
export async function listCachedKeys(): Promise<string[]> {
  return (await persistedStoreKeys()).map(storeKeyToCacheKey);
}

/** Wipe the entire persistent TeX asset cache (dev action). */
export async function clearTexCache(): Promise<void> {
  const storeKeys = await persistedStoreKeys();
  await Promise.all(storeKeys.map((k) => del(k, store)));
}
