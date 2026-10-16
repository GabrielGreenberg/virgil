/**
 * Disk ledger — the "expected on-disk fingerprint" of every watched file
 * Virgil reads or writes.
 *
 * This is the lynchpin of the external-change badge (design:
 * docs/memos/external-change-badge/DESIGN.md §3). A naive "poll the mtime,
 * compare to the load-time mtime" scheme produces constant false positives
 * in Virgil, because Virgil writes its own files all the time:
 *
 *   1. the load-time UUID writeback (`writeReStampedTexOnLoad`) rewrites the
 *      `.tex` seconds after every load — before the user touches anything;
 *   2. the 1500 ms autosave rewrites the bundle while editing;
 *   3. sidecar writes touch `virgil/*.json` constantly.
 *
 * The ledger records, per `(docId, relPath)`, the fingerprint Virgil itself
 * last put on (or read from) disk. The watcher only flags a change when the
 * live disk content hash differs from the ledger's hash — so Virgil's own
 * writes (and a bare `touch`, which bumps mtime but not bytes) never look
 * like an external edit.
 *
 * It is plain module state — no React, no persistence. A page reload starts
 * with an empty ledger; the load path re-stamps the baseline immediately.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DiskFingerprint = {
  /** File modification time in ms since the epoch (the poll trigger). */
  mtimeMs: number;
  /** Byte length (the cheap first-pass tiebreaker). */
  // size is byte-count (FSA File.size / dev Content-Length), never string .length
  size: number;
  /** A fast, non-crypto content hash (the authoritative tiebreaker). */
  hash: string;
};

// ---------------------------------------------------------------------------
// Storage — per-doc map of relPath → fingerprint
// ---------------------------------------------------------------------------

const ledger = new Map<string, Map<string, DiskFingerprint>>();

/**
 * Record the expected on-disk fingerprint for one watched file. Called from
 * the storage read/write paths after Virgil establishes ground truth. Always
 * best-effort at the call site (wrapped in try/catch there) so a stamp can
 * never break a save or load.
 */
export function stampDiskFingerprint(
  docId: string,
  relPath: string,
  fp: DiskFingerprint,
): void {
  let perDoc = ledger.get(docId);
  if (!perDoc) {
    perDoc = new Map<string, DiskFingerprint>();
    ledger.set(docId, perDoc);
  }
  perDoc.set(relPath, fp);
}

/** Read the expected on-disk fingerprint for a watched file, or undefined. */
export function getDiskFingerprint(
  docId: string,
  relPath: string,
): DiskFingerprint | undefined {
  return ledger.get(docId)?.get(relPath);
}

/**
 * Drop the baseline for ONE watched file. Used when acknowledging an external
 * REMOVAL: with no fingerprint, the next poll sees absent + no fp → ignored,
 * so an acknowledged "removed" stays clean (instead of re-flagging every
 * poll because a stale fingerprint persists). The per-path granularity is why
 * `clearDiskLedger` (whole-doc) is too coarse here.
 */
export function clearDiskFingerprint(docId: string, relPath: string): void {
  ledger.get(docId)?.delete(relPath);
}

/** Drop all ledger state for a doc — call when the doc fully unloads. */
export function clearDiskLedger(docId: string): void {
  ledger.delete(docId);
  inFlight.delete(docId);
}

// ---------------------------------------------------------------------------
// In-flight own writes (task 1130)
//
// A write door does `write bytes → re-stat → stamp`, and the re-stat is several
// async FSA calls (slow in a Dropbox/CloudStorage folder). Between the bytes
// landing and the stamp landing, the file on disk already holds Virgil's bytes
// while the ledger still describes the PREVIOUS ones — so a poll that confirms
// a drift by hash in that window would compare Virgil's own bytes against a
// stale stamp and report an external "modified" (a false "Keep mine / Use
// disk" conflict, because a save is in flight).
//
// The ledger is therefore the ONE authority over "bytes Virgil put there", and
// it answers that for a write that has not finished stamping too: a write door
// registers the hash it is about to write BEFORE the bytes move and clears it
// only AFTER its stamp lands (`beginOwnWrite`). `isOwnContent` is the question
// every watcher asks after its confirm read — current stamp OR in-flight own
// write — and it is asked AFTER the read's await, never against a fingerprint
// captured before it (the stale-baseline-across-an-await class).
// ---------------------------------------------------------------------------

/** docId → relPath → hash → number of in-flight writes of those bytes. */
const inFlight = new Map<string, Map<string, Map<string, number>>>();

/**
 * Register an own write of `content` to `relPath` that is about to land.
 * Returns the release thunk, which the write door calls (in a `finally`) only
 * after its ledger stamp has landed — so at every instant either the in-flight
 * entry or the stamp vouches for these bytes. Idempotent release.
 */
export function beginOwnWrite(
  docId: string,
  relPath: string,
  content: string,
): () => void {
  const hash = hashContent(content);
  let perDoc = inFlight.get(docId);
  if (!perDoc) {
    perDoc = new Map();
    inFlight.set(docId, perDoc);
  }
  let perPath = perDoc.get(relPath);
  if (!perPath) {
    perPath = new Map();
    perDoc.set(relPath, perPath);
  }
  perPath.set(hash, (perPath.get(hash) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const doc = inFlight.get(docId);
    const path = doc?.get(relPath);
    if (!doc || !path) return;
    const n = (path.get(hash) ?? 0) - 1;
    if (n > 0) path.set(hash, n);
    else path.delete(hash);
    if (path.size === 0) doc.delete(relPath);
    if (doc.size === 0) inFlight.delete(docId);
  };
}

/**
 * Did Virgil itself put bytes hashing to `hash` at `relPath`? True when the
 * ledger's CURRENT stamp has that hash, or an own write of those bytes is in
 * flight (landed or landing, not yet stamped). Read it at the moment of the
 * comparison — never a value captured before an await.
 */
export function isOwnContent(
  docId: string,
  relPath: string,
  hash: string,
): boolean {
  if (getDiskFingerprint(docId, relPath)?.hash === hash) return true;
  return (inFlight.get(docId)?.get(relPath)?.get(hash) ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Fingerprint construction
// ---------------------------------------------------------------------------

/**
 * Build a `DiskFingerprint` from a stat (`{mtimeMs, size}`) plus the known
 * content bytes. Use this right after a write (we already hold the bytes we
 * wrote) or right after a confirming read (we just read the bytes off disk),
 * combined with a fresh stat so the recorded mtime is the OS's real value.
 */
export function fingerprintOf(
  stat: { mtimeMs: number; size: number },
  content: string,
): DiskFingerprint {
  return {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    hash: hashContent(content),
  };
}

// ---------------------------------------------------------------------------
// Content hash — cyrb53
//
// A fast, well-distributed, NON-crypto 53-bit string hash. This is for
// equality (did the bytes change?), never for security. SHA via
// `crypto.subtle` would be async + overkill; cyrb53 is sync, dependency-free,
// and has a vanishingly small collision rate for the file sizes in play.
//
// No existing reusable hash util exists to reuse — the djb2 fallbacks in
// useResolvedFigureUrl.ts and latex-errors.ts are inlined inside unrelated
// functions, not exported. cyrb53 is stronger than either and is the right
// home for a shared content hash.
// ---------------------------------------------------------------------------

/**
 * cyrb53 — a fast non-crypto hash returning a hex string. Stable for a given
 * input; differs (with overwhelming probability) for any content change.
 */
export function hashContent(rawText: string, seed = 0): string {
  // Hash the text as it will READ BACK from disk, not as the JS string was
  // handed to the writer: a write encodes UTF-8 (a lone surrogate becomes
  // U+FFFD) and `File.text()` decodes it with BOM-stripping. Without this a
  // file Virgil wrote with a leading BOM (or a lone surrogate) would hash one
  // way at the stamp and another way at every confirm read — a permanent false
  // "modified" after any mtime drift (task 1130). One canonical form, so a
  // write-side hash and a read-side hash of the same bytes always agree.
  const text = canonicalForHash(rawText);
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const out = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  // 53-bit value → fixed-width hex so equal inputs always stringify equally.
  return out.toString(16).padStart(14, "0");
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;

/**
 * The text a UTF-8 write of `text` reads back as through `File.text()`: no
 * leading BOM, every lone surrogate replaced by U+FFFD. Identity (and no copy)
 * for the ordinary well-formed, BOM-less file.
 */
function canonicalForHash(text: string): string {
  let out = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (LONE_SURROGATE.test(out)) {
    out = new TextDecoder("utf-8", { ignoreBOM: true }).decode(
      new TextEncoder().encode(out),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Test-only reset
// ---------------------------------------------------------------------------

/** @internal Wipe the entire ledger. Tests only. */
export function __resetDiskLedgerForTests(): void {
  ledger.clear();
  inFlight.clear();
}
