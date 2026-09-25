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
 * `tex-asset/<cacheKey>` key prefix. Every read-decide-write against the store
 * runs as ONE task on the serial `enqueueWrite(TEX_ASSET_QUEUE, …)` queue from
 * src/lib/write-queue.ts, so concurrent streams and compiles never race the
 * dedup or the size cap (task 577). Integrity/dedup uses the shared cyrb53
 * `hashContent` from src/lib/disk-ledger.ts.
 *
 * This layer touches ONLY the engine-internal `/tex` kpse cache — never the
 * document `/work` bytes and never the `.tex` source — so the byte-stable
 * round-trip and the requirements-injection order the drift-gate depends on
 * are entirely unaffected.
 */

import { get, set, keys, del, createStore } from "idb-keyval";
import { readStoredValue, type StoredVerdict } from "@/lib/stored-state";

import { hashContent } from "@/lib/disk-ledger";
import { enqueueWrite } from "@/lib/write-queue";
import { CORE_MANIFEST, PLACEHOLDER_FMT_CACHEKEY } from "@/lib/tex-core-manifest";
import { publicAssetUrl } from "@/lib/public-asset-url";
import type { TexCacheDumpEntry } from "@/types/swiftlatex";

// Reuse the SAME origin store as doc-index.ts (do NOT open a second DB).
const store = createStore("virgil", "kv");

const KEY_PREFIX = "tex-asset/";

/** The ONE serial queue every store read-decide-write enters (task 577). */
const TEX_ASSET_QUEUE = "tex-asset";

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
  /**
   * Task 454 — the STREAMING durability channel. Optional on this interface
   * (never on the shipped engine) so a re-vendored worker without the patch,
   * or a test fake, degrades to the end-of-compile `dumpNewCache` batch.
   */
  onAsset?(cb: (entry: TexCacheDumpEntry) => void): void;
  /** Task 454 — the streaming PROGRESS channel; see `onAsset`. */
  onFetchProgress?(cb: (name: string) => void): void;
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

    // Tier B — persisted write-through cache. The same scan primes the size
    // index, so a session pays ONE full read of the store, not one per asset.
    const records = await loadPersistedRecords();
    for (const rec of records) {
      engine.seedCache(rec.cacheKey, rec.fileid, rec.bytes);
    }
  } catch (err) {
    console.warn("[tex-assets] provisionEngine seeding failed (falling back to mirror):", err);
  }

  // Task 454 — arm the STREAMING write-through before the first compile, so a
  // compile that times out keeps every package it downloaded. Idempotent (the
  // engine installs its message listener once) and best-effort.
  try {
    attachAssetStream(engine);
  } catch (err) {
    console.warn("[tex-assets] could not attach the asset stream:", err);
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

/**
 * TASK 454 — STREAMING WRITE-THROUGH.
 *
 * `captureNewAssets` below is a request/response round trip, so it can only run
 * when the worker is IDLE. A compile that TIMES OUT leaves the worker blocked
 * inside its synchronous pass forever, and the recovery then `closeWorker()`s
 * it — destroying an in-memory kpse cache holding every package that compile
 * downloaded. So a cold compile too slow to finish in one budget re-fetched
 * from zero on every retry and could NEVER converge.
 *
 * Streaming makes each download durable the instant it lands: the worker posts
 * the bytes as it caches them (see `swiftlatexpdftex.js` -> `__virgilStreamAsset`),
 * and this sink writes them through immediately. A timed-out compile therefore
 * keeps 100% of what it fetched, and the next attempt is that much shorter.
 *
 * Best-effort at every step — a cache write must never disturb a compile.
 */
export function attachAssetStream(engine: ProvisionableEngine): void {
  if (typeof engine.onAsset !== "function") return;
  engine.onAsset((entry) => {
    void persistAsset(entry).catch((err) => {
      console.warn("[tex-assets] streamed write-through failed:", err);
    });
  });
}

/**
 * TASK 577 — THE SIZE INDEX.
 *
 * The cap needs the cache's total size, and idb-keyval has no size-only read:
 * summing `rec.bytes.byteLength` means structured-cloning every record's BYTES
 * onto the main thread. Doing that per new asset made a cold compile
 * O(assets × cache) in deserialization — tens of MB re-read for every package
 * streamed. So the total is computed ONCE per session (lazily, or for free off
 * the provisioning scan) and then maintained by the same queued task that
 * writes or deletes a record.
 *
 * `null` = not yet built. Only ever read or written INSIDE a
 * `TEX_ASSET_QUEUE` task, which is what makes the cap check and the write one
 * atomic decision: pre-577 the check ran outside the queue, so K concurrent
 * streams all read the same pre-write total, all passed, and all wrote.
 *
 * Staleness, stated: a second window writing the shared store is invisible
 * here. Its record is then either re-counted on overwrite (overcount — the
 * cap trips early, the safe direction) or simply not counted until the next
 * session's scan. The cap is a quota guard, not an invariant.
 */
interface SizeIndex {
  sizes: Map<string, number>;
  total: number;
}
let sizeIndex: SizeIndex | null = null;

function indexFrom(records: readonly TexAssetRecord[]): SizeIndex {
  const sizes = new Map<string, number>();
  let total = 0;
  for (const rec of records) {
    const n = rec.bytes.byteLength;
    total += n - (sizes.get(rec.cacheKey) ?? 0);
    sizes.set(rec.cacheKey, n);
  }
  return { sizes, total };
}

/**
 * Task 757 — a persisted record is untrusted input. One that is not a record
 * (a pre-cap build's leftovers, a torn write, a record whose bytes alone exceed
 * the whole cache's cap) is refused and cleared by the stored-state door.
 */
export function validateTexAssetRecord(value: unknown): StoredVerdict {
  if (typeof value !== "object" || value === null) {
    return { why: "invalid", detail: "not an object" };
  }
  const r = value as Partial<TexAssetRecord>;
  if (typeof r.cacheKey !== "string" || typeof r.fileid !== "string") {
    return { why: "invalid", detail: "no cacheKey/fileid" };
  }
  if (!(r.bytes instanceof Uint8Array)) {
    return { why: "invalid", detail: "bytes are not a Uint8Array" };
  }
  if (r.bytes.byteLength > CACHE_SIZE_CAP_BYTES) {
    return { why: "oversized", detail: `${r.bytes.byteLength}B record` };
  }
  return true;
}

/**
 * Full scan of the persisted records. Call ONLY inside a queue task.
 *
 * Task 757 — the READ re-enforces the write-time cap. Records are read one at a
 * time through the stored-state door; if the survivors still total more than
 * {@link CACHE_SIZE_CAP_BYTES} (a store filled by a build that predates the
 * cap, or by a second window racing this one's index), the newest are kept up
 * to the cap and the rest are deleted — so provisioning can never hand the
 * worker more than the cap, however the store came to hold it.
 */
async function scanPersistedRecords(): Promise<TexAssetRecord[]> {
  const storeKeys = await persistedStoreKeys();
  const recs: TexAssetRecord[] = [];
  let total = 0;
  for (const k of storeKeys) {
    const rec = await readStoredValue<TexAssetRecord>(k, {
      store,
      validate: validateTexAssetRecord,
    });
    if (!rec) continue;
    recs.push(rec);
    total += rec.bytes.byteLength;
  }
  if (total <= CACHE_SIZE_CAP_BYTES) return recs;
  recs.sort((a, b) => (b.fetchedAt ?? 0) - (a.fetchedAt ?? 0));
  const kept: TexAssetRecord[] = [];
  let keptBytes = 0;
  for (const rec of recs) {
    if (keptBytes + rec.bytes.byteLength <= CACHE_SIZE_CAP_BYTES) {
      kept.push(rec);
      keptBytes += rec.bytes.byteLength;
    } else {
      await del(cacheKeyToStoreKey(rec.cacheKey), store).catch(() => {});
    }
  }
  console.warn(
    `[tex-assets] persisted cache held ${total}B (cap ${CACHE_SIZE_CAP_BYTES}B); evicted ${
      recs.length - kept.length
    } oldest record(s)`,
  );
  return kept;
}

/** Every persisted record, read under the queue; primes the size index. */
function loadPersistedRecords(): Promise<TexAssetRecord[]> {
  return enqueueWrite(TEX_ASSET_QUEUE, async () => {
    const records = await scanPersistedRecords();
    if (!sizeIndex) sizeIndex = indexFrom(records);
    return records;
  });
}

/** The size index, building it on first use. Call ONLY inside a queue task. */
async function ensureSizeIndex(): Promise<SizeIndex> {
  if (!sizeIndex) sizeIndex = indexFrom(await scanPersistedRecords());
  return sizeIndex;
}

/** Test-only: forget the index, as a fresh session would. */
export function __resetTexAssetSizeIndexForTest(): void {
  sizeIndex = null;
}

/**
 * Write ONE asset through to the persistent cache. Shared by the streaming sink
 * and the end-of-compile batch, so an asset arriving on both channels is
 * written once (dedup by cacheKey + byte hash) and the size cap is honoured
 * identically on both.
 *
 * The WHOLE decision — prior-record lookup, hash compare, cap check, write,
 * index update — is one serial queue task (task 577). The hash is computed
 * before entering: it is pure CPU and needs no ordering.
 *
 * Returns true when bytes were written.
 */
async function persistAsset(entry: TexCacheDumpEntry): Promise<boolean> {
  if (!entry?.cacheKey || !entry.bytes) return false;
  const bytes = new Uint8Array(entry.bytes);
  const hash = hashBytes(bytes);
  const cacheKey = entry.cacheKey;
  const storeKey = cacheKeyToStoreKey(cacheKey);

  return enqueueWrite(TEX_ASSET_QUEUE, async () => {
    const prev = (await get(storeKey, store)) as TexAssetRecord | undefined;
    if (prev && prev.hash === hash) return false;

    const index = await ensureSizeIndex();
    const prevSize = index.sizes.get(cacheKey) ?? 0;
    if (!prev) {
      // Only a NEW key can grow the cache past the cap; a changed existing
      // key replaces its own bytes.
      if (index.total - prevSize + bytes.byteLength > CACHE_SIZE_CAP_BYTES) {
        console.warn(
          `[tex-assets] cache size cap (${CACHE_SIZE_CAP_BYTES} bytes) reached; dropped ${cacheKey} (${bytes.byteLength}B)`,
        );
        return false;
      }
    }

    const rec: TexAssetRecord = {
      cacheKey,
      fileid: entry.fileid,
      bytes,
      hash,
      fetchedAt: Date.now(),
    };
    await set(storeKey, rec, store);
    index.total += bytes.byteLength - prevSize;
    index.sizes.set(cacheKey, bytes.byteLength);
    return true;
  });
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

  for (const entry of entries) {
    try {
      await persistAsset(entry);
    } catch (err) {
      console.warn("[tex-assets] write-through failed:", entry?.cacheKey, err);
    }
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
  await enqueueWrite(TEX_ASSET_QUEUE, async () => {
    const storeKeys = await persistedStoreKeys();
    await Promise.all(storeKeys.map((k) => del(k, store)));
    // Known-empty, not unknown: the next write needs no scan.
    sizeIndex = { sizes: new Map(), total: 0 };
  });
}
