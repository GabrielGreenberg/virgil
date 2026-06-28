// Pure, defensive statistics over a Library catalog. Drives the Central
// dashboard's stats grid (ASK 7). Every count is derived from the real field
// semantics in catalog.ts:
//
//   entry.indexed.state : IndexedState  — "none"|"queued"|"running"|"indexed"
//                                          |"deepIndexed"|"failed"
//   entry.bib.state     : BibAuthState  — "none"|"unverified"|"authenticated"
//                                          |"manuscript"|"canonical"|"failed"
//   entry.citekey       : string | null — null while an unsorted file triages
//
// All counts are computed in a single O(n) pass. The function is pure (no
// hooks, no I/O) so it's trivially testable and safe to memoize on the
// `entries` array identity.

import type { CatalogEntry } from "./catalog";
import type { BibEntry } from "./types";

export interface CatalogStats {
  /** Total catalog rows tracked (papers + triaging files). `entries.length`. */
  totalSources: number;
  /** Catalog rows with a citekey (i.e. sorted/named papers, not triage rows). */
  papers: number;
  /** "Sources" in the honest, F#1 sense: rows that are a real document on
   *  disk — a citekey AND `pdf.present`. Excludes citation-only / bib-only
   *  reference rows (the mass of fileless master.bib entries) and the
   *  untriaged unsorted files. This is "documents I actually have". */
  sourcesWithFile: number;
  /** Distinct master.bib entries. Size of the bibByKey map at the call site. */
  bibEntries: number;
  /** indexed OR deepIndexed — papers whose text Virgil can render. */
  indexed: number;
  /** deepIndexed only — papers that got the structural cleanup pass. */
  deepIndexed: number;
  /** queued OR running — papers currently in the indexing pipeline. */
  queuedOrRunning: number;
  /** Indexing failed — needs a retry. */
  failedIndex: number;
  /** bib.state === "authenticated", counted over the reference universe (the
   *  caller passes the merged universe rows, whose fileless entries carry the
   *  bib-index-projected state — F#4). */
  authenticated: number;
  /** bib.state ∈ {unverified, failed} — entries that want a human/skill pass. */
  bibNeedsAction: number;
  /** The strict complement of `authenticated` over the bibliography total:
   *  `bibEntries − authenticated` (folds unverified / failed / manuscript /
   *  canonical / none together). F#1's middle-line "Non-authenticated". */
  nonAuthenticated: number;
  /** Catalog rows with no citekey — unsorted files awaiting triage. If the
   *  caller's `entries` array excludes unsorted rows, this is simply 0. */
  unsorted: number;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

/** Read `entry.indexed.state` defensively (catalogs from disk can be partial). */
function indexedState(e: CatalogEntry): string {
  const ix = (e as { indexed?: unknown }).indexed;
  return isObj(ix) && typeof ix.state === "string" ? ix.state : "none";
}

/** Read `entry.bib.state` defensively. */
function bibState(e: CatalogEntry): string {
  const b = (e as { bib?: unknown }).bib;
  return isObj(b) && typeof b.state === "string" ? b.state : "none";
}

/**
 * Compute Central-dashboard statistics from the in-memory catalog. Single O(n)
 * pass; no allocation per entry beyond two string reads. `bibByKey` may be a
 * Map (the live call-site shape) or any object with a numeric `.size` — its
 * size is the master.bib entry count.
 */
export function computeCatalogStats(
  entries: readonly CatalogEntry[] | null | undefined,
  bibByKey: { size: number } | null | undefined,
): CatalogStats {
  const list = Array.isArray(entries) ? entries : [];
  const stats: CatalogStats = {
    totalSources: list.length,
    papers: 0,
    sourcesWithFile: 0,
    bibEntries: typeof bibByKey?.size === "number" ? bibByKey.size : 0,
    indexed: 0,
    deepIndexed: 0,
    queuedOrRunning: 0,
    failedIndex: 0,
    authenticated: 0,
    bibNeedsAction: 0,
    nonAuthenticated: 0,
    unsorted: 0,
  };

  for (const e of list) {
    if (!e) continue;

    // citekey presence: a sorted paper vs. an unsorted/triaging file.
    if (e.citekey) {
      stats.papers++;
      // A real document on disk (F#1 "Sources"): citekey + a present file.
      const pdf = (e as { pdf?: unknown }).pdf;
      if (isObj(pdf) && pdf.present === true) stats.sourcesWithFile++;
    } else {
      stats.unsorted++;
    }

    // Indexing pipeline state.
    const ix = indexedState(e);
    if (ix === "indexed" || ix === "deepIndexed") stats.indexed++;
    if (ix === "deepIndexed") stats.deepIndexed++;
    if (ix === "queued" || ix === "running") stats.queuedOrRunning++;
    if (ix === "failed") stats.failedIndex++;

    // Bibliography authentication state (counted over the reference universe
    // when the caller passes the merged universe rows).
    const bib = bibState(e);
    if (bib === "authenticated") stats.authenticated++;
    if (bib === "unverified" || bib === "failed") stats.bibNeedsAction++;
  }

  // Strict binary complement over the bibliography total (F#1). Clamp so a
  // stray holding whose citekey isn't in master.bib can't push it negative.
  stats.nonAuthenticated = Math.max(0, stats.bibEntries - stats.authenticated);

  return stats;
}

// Re-export the BibEntry type local alias so a future caller can `import type`
// the exact bib map element shape without reaching into ./types directly.
export type { BibEntry };
