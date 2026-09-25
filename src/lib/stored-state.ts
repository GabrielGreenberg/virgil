/**
 * **Stored state is untrusted input** — task 757.
 *
 * 2026-09-24: on one machine the installed PWA crashed its renderer ~5 s after
 * EVERY paper opened. Reinstalling did not help; removing the site's stored
 * data did. So something this origin had PERSISTED (IndexedDB, localStorage)
 * was bringing the renderer down — and each store had its own reader with its
 * own failure behaviour, so no one place could say which, or survive it.
 *
 * > **A stored blob is untrusted input with a size bound. Every slot of the
 * > shared `virgil`/`kv` IndexedDB store is DECLARED here with its bound, the
 * > stores that can grow with use are capped at WRITE time, and a read of one
 * > of them goes through {@link readStoredValue}: a value that fails to read,
 * > fails its shape check, or exceeds its sanity bound is ABSENT — the paper
 * > still opens, the slot is reported (and, where safe, cleared) — never a
 * > throw and never an unbounded allocation.**
 *
 * localStorage is bounded by the browser's own per-origin quota (~5–10 MB) and
 * already has its own owners (`usePersistentState`, `cross-window-storage`);
 * it appears here only in the diagnostic.
 *
 * ## The diagnostic
 *
 * `window.__storageStats()` (installed at boot by {@link installStorageStatsProbe})
 * walks the kv store with ONE cursor — one value alive at a time — and reports
 * every declared slot family's entry count and approximate bytes, any key no
 * family declares, localStorage per key, the origin's quota estimate, and every
 * slot this session refused. The next report of the 757 shape is answerable
 * from the affected machine in one console call.
 */

import { del, get } from "idb-keyval";

/** How a slot family's size is held down. */
export type StoredBound =
  /** A handful of small records whose count does not grow with use. */
  | "fixed"
  /** Grows with use; a WRITE-time cap exists and is named in `cap`. */
  | "capped";

export interface StoredSlotFamily {
  /** Key, or key prefix when it ends in `/` or `:`. */
  key: string;
  /** The module that owns the slot (repo-relative). */
  owner: string;
  bound: StoredBound;
  /** For `capped`: the write-time cap, in words. */
  cap?: string;
}

/**
 * THE census of the shared `virgil`/`kv` store. A module that opens that store
 * must be an `owner` here and every key literal it writes must be declared
 * (`stored-state-census.test.ts`).
 */
export const STORED_STATE_REGISTRY: readonly StoredSlotFamily[] = [
  { key: "index", owner: "src/lib/doc-index.ts", bound: "fixed" },
  { key: "tabs", owner: "src/lib/doc-index.ts", bound: "fixed" },
  {
    key: "tabs/",
    owner: "src/lib/doc-index.ts",
    bound: "capped",
    cap: "one record per window; swept past TAB_RECORD_MAX_AGE_MS",
  },
  { key: "windows-registry", owner: "src/lib/doc-index.ts", bound: "fixed" },
  {
    key: "doc-handle/",
    owner: "src/lib/doc-index.ts",
    bound: "capped",
    cap: "one handle per paper; deleted with the paper",
  },
  {
    key: "general-bib-handle/",
    owner: "src/lib/doc-index.ts",
    bound: "capped",
    cap: "one handle per paper",
  },
  { key: "my-papers", owner: "src/lib/doc-index.ts", bound: "fixed" },
  {
    key: "tex-asset/",
    owner: "src/lib/tex-assets.ts",
    bound: "capped",
    cap: "CACHE_SIZE_CAP_BYTES total, enforced at write AND re-enforced on the provisioning read",
  },
  {
    key: "emergency-mirror/",
    owner: "src/lib/emergency-mirror.ts",
    bound: "capped",
    cap: "MIRROR_MAX_CHARS per slot at write; MIRROR_MAX_SLOTS newest slots + MIRROR_MAX_AGE_MS on the session sweep",
  },
  {
    key: "local-sidecar/",
    owner: "src/lib/local-sidecar.ts",
    bound: "capped",
    cap: "one small view-state record per (paper, local sidecar)",
  },
  { key: "bugreport-folder-handle", owner: "src/lib/bug-report.ts", bound: "fixed" },
  {
    key: "doc-owner/",
    owner: "src/lib/multi-window/doc-ownership.ts",
    bound: "capped",
    cap: "one record per open paper; released on close",
  },
];

/** The family a key belongs to, or null for an undeclared key. */
export function familyOf(key: string): StoredSlotFamily | null {
  let best: StoredSlotFamily | null = null;
  for (const f of STORED_STATE_REGISTRY) {
    const isPrefix = f.key.endsWith("/") || f.key.endsWith(":");
    const hit = isPrefix ? key.startsWith(f.key) : key === f.key;
    if (hit && (!best || f.key.length > best.key.length)) best = f;
  }
  return best;
}

// ── The refusal report ──────────────────────────────────────────────────

export interface StoredStateRefusal {
  key: string;
  why: "read-failed" | "invalid" | "oversized";
  detail?: string;
  cleared: boolean;
  at: number;
}

const REFUSALS_KEPT = 50;
const refusals: StoredStateRefusal[] = [];

function report(r: StoredStateRefusal): void {
  refusals.push(r);
  if (refusals.length > REFUSALS_KEPT) refusals.shift();
  console.warn(
    `[stored-state] refused ${r.key} (${r.why}${r.detail ? `: ${r.detail}` : ""})${
      r.cleared ? " — slot cleared" : ""
    }`,
  );
}

/** Every slot this session refused, oldest first. */
export function getStoredStateRefusals(): readonly StoredStateRefusal[] {
  return refusals;
}

/** Test helper. */
export function __resetStoredStateRefusalsForTests(): void {
  refusals.length = 0;
}

// ── The door ────────────────────────────────────────────────────────────

/** A shape check's verdict: `true`, or the reason the value is refused. */
export type StoredVerdict = true | { why: "invalid" | "oversized"; detail: string };

export interface ReadStoredOptions<T> {
  /** The idb-keyval store handle (`createStore("virgil","kv")`). */
  store: Parameters<typeof get>[1];
  /** Shape AND sanity-size check. Must be O(1) or O(value) without copying. */
  validate: (value: unknown) => StoredVerdict;
  /**
   * Delete a refused slot. Default `true`: a slot that cannot be read into a
   * valid value is debris, and leaving it means the next open pays for it
   * again (the crash → reopen → re-read loop). Pass `false` for a slot whose
   * bytes might be the user's only copy of something.
   */
  clearOnRefusal?: boolean;
  /** Narrow the validated value (defaults to a cast). */
  cast?: (value: unknown) => T;
}

/**
 * Read one slot of the kv store as UNTRUSTED input. Resolves to the value, or
 * `null` when the slot is missing, unreadable, malformed or over its bound.
 * Never throws.
 */
export async function readStoredValue<T>(
  key: string,
  opts: ReadStoredOptions<T>,
): Promise<T | null> {
  let raw: unknown;
  try {
    raw = await get(key, opts.store);
  } catch (err) {
    report({
      key,
      why: "read-failed",
      detail: err instanceof Error ? err.message : String(err),
      cleared: false,
      at: Date.now(),
    });
    return null;
  }
  if (raw === undefined || raw === null) return null;
  let verdict: StoredVerdict;
  try {
    verdict = opts.validate(raw);
  } catch (err) {
    verdict = {
      why: "invalid",
      detail: `validator threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (verdict === true) return opts.cast ? opts.cast(raw) : (raw as T);
  const clear = opts.clearOnRefusal !== false;
  if (clear) {
    try {
      await del(key, opts.store);
    } catch {
      /* the refusal stands even if the clear fails */
    }
  }
  report({ key, why: verdict.why, detail: verdict.detail, cleared: clear, at: Date.now() });
  return null;
}

// ── Size estimate (diagnostic + sanity bounds) ──────────────────────────

/**
 * Approximate the in-memory footprint of a structured-clone value WITHOUT
 * serializing it: byte arrays by length, strings at two bytes a char, objects
 * walked with a node budget so a pathological value cannot make the estimate
 * itself the allocation. Returns `Infinity` once `limit` is passed.
 */
export function estimateStoredBytes(value: unknown, limit = Number.MAX_SAFE_INTEGER): number {
  let total = 0;
  let nodes = 0;
  const NODE_BUDGET = 2_000_000;
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const v = stack.pop();
    if (++nodes > NODE_BUDGET) return Infinity;
    if (v === null || v === undefined) continue;
    const t = typeof v;
    if (t === "string") total += (v as string).length * 2;
    else if (t === "number" || t === "boolean") total += 8;
    else if (ArrayBuffer.isView(v)) total += (v as ArrayBufferView).byteLength;
    else if (v instanceof ArrayBuffer) total += v.byteLength;
    else if (v instanceof Blob) total += v.size;
    else if (t === "object") {
      if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) stack.push(v[i]);
      } else if (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null) {
        for (const k in v as Record<string, unknown>) {
          total += k.length * 2;
          stack.push((v as Record<string, unknown>)[k]);
        }
      } else {
        // A FileSystemHandle and friends — host objects, small.
        total += 64;
      }
    }
    if (total > limit) return Infinity;
  }
  return total;
}

// ── window.__storageStats() ─────────────────────────────────────────────

export interface StorageStats {
  kv: {
    family: string;
    bound: StoredBound | "UNDECLARED";
    entries: number;
    approxBytes: number;
    largestKey: string | null;
    largestBytes: number;
  }[];
  localStorage: { key: string; chars: number }[];
  estimate: { usage?: number; quota?: number } | null;
  refusals: readonly StoredStateRefusal[];
  error?: string;
}

/** Walk the kv store with ONE cursor (one value alive at a time). */
function walkKv(
  onEntry: (key: string, value: unknown) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("virgil");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("kv")) {
        db.close();
        resolve();
        return;
      }
      const tx = db.transaction("kv", "readonly");
      const req = tx.objectStore("kv").openCursor();
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return;
        onEntry(String(cur.key), cur.value);
        cur.continue();
      };
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}

export async function collectStorageStats(): Promise<StorageStats> {
  const byFamily = new Map<string, StorageStats["kv"][number]>();
  let error: string | undefined;
  try {
    await walkKv((key, value) => {
      const fam = familyOf(key);
      const name = fam?.key ?? `UNDECLARED:${key}`;
      let row = byFamily.get(name);
      if (!row) {
        row = {
          family: name,
          bound: fam?.bound ?? "UNDECLARED",
          entries: 0,
          approxBytes: 0,
          largestKey: null,
          largestBytes: 0,
        };
        byFamily.set(name, row);
      }
      const n = estimateStoredBytes(value);
      row.entries++;
      row.approxBytes += n;
      if (n > row.largestBytes) {
        row.largestBytes = n;
        row.largestKey = key;
      }
    });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const ls: StorageStats["localStorage"] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k === null) continue;
      ls.push({ key: k, chars: localStorage.getItem(k)?.length ?? 0 });
    }
    ls.sort((a, b) => b.chars - a.chars);
  } catch {
    /* blocked storage */
  }
  let estimate: StorageStats["estimate"] = null;
  try {
    estimate = (await navigator.storage?.estimate?.()) ?? null;
  } catch {
    /* unsupported */
  }
  return {
    kv: [...byFamily.values()].sort((a, b) => b.approxBytes - a.approxBytes),
    localStorage: ls,
    estimate,
    refusals: getStoredStateRefusals(),
    ...(error ? { error } : {}),
  };
}

/** Install `window.__storageStats` (idempotent; browser only). */
export function installStorageStatsProbe(): void {
  if (typeof window === "undefined") return;
  (window as unknown as { __storageStats?: () => Promise<StorageStats> }).__storageStats =
    collectStorageStats;
}

// Installed at module load: every paper open reaches this module (the
// emergency mirror reads through the door), so the probe is present from the
// first open onward — the window the 757 report is about.
installStorageStatsProbe();
