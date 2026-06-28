// Reader for `.virgil/bib-index.json` — the slim, skill-emitted projection of
// master.bib that the BROWSE path (library list, catalog search, citation
// picker) reads instead of parsing the multi-MB master.bib with citation-js.
//
// Why this exists: citation-js parsing the real 34k-entry master.bib blocks
// the main thread ~2.6s (~6s at 100k). JSON.parse of this slim index is ~15ms.
// The index is emitted by library/scripts/build_bib_index.py and refreshed
// automatically by the Python pipeline whenever master.bib changes. See
// MEMO_LIBRARY_SCALE_RESEARCH.md.
//
// Edit/format paths (BibEditModal, formatBibliography, copy-BibTeX) need full
// fields + the raw BibTeX block, which the slim index does NOT carry — those
// fetch the full entry on demand via getFullLibraryBibEntry (bib-entry-full.ts).

import { readTextFile, ROOT_FILES } from "./library-storage";
import type { BibEntry } from "./types";
import type { BibAuthState } from "./catalog";

/** One slim record in bib-index.json. Compact keys; these are exactly the
 *  fields the browse path renders (list/sort, search, picker expanded details).
 *  k=citekey t=title a=author e=editor y=year d=doi
 *  j=journal b=booktitle v=volume n=number p=pages q=publisher s=series.
 *  bs=bib.state (projected from the master.bib "% bib.state" comment — F#4
 *  layered model: the reference universe's auth state lives here, NOT on a
 *  per-reference catalog row). */
interface BibIndexRecord {
  k: string;
  t?: string;
  a?: string;
  e?: string;
  y?: string;
  d?: string;
  j?: string;
  b?: string;
  v?: string;
  n?: string;
  p?: string;
  q?: string;
  s?: string;
  bs?: string;
}

interface BibIndexFile {
  v: number;
  stamp: string;
  entries: BibIndexRecord[];
}

export interface BibIndexResult {
  /** master.bib change-signal the index was built from. */
  stamp: string;
  /** Slim records widened to the BibEntry shape (raw="" — browse fields only). */
  entries: BibEntry[];
  /** citekey → bib.state, projected from the master.bib "% bib.state"
   *  comment. The authoritative auth state for the whole reference universe
   *  (F#4). Absent entries (no comment yet) are simply not in the map →
   *  readers default to "none". */
  stateByKey: Map<string, BibAuthState>;
}

/** Valid bib-auth states — guards the projected `bs` field against a stray
 *  on-disk value. */
const VALID_BIB_STATES: ReadonlySet<string> = new Set<BibAuthState>([
  "none",
  "unverified",
  "authenticated",
  "manuscript",
  "canonical",
  "failed",
  // Mirrors the canonical Python set in
  // library/scripts/_tools.py CANONICAL_BIB_STATES. Without this entry the
  // `needs-reauth` state written by apply_metadata_mismatch_policy.py would
  // be silently dropped to "none" on read (the F#4 round-trip bug).
  "needs-reauth",
]);

/** Map a slim record to the BibEntry shape the browse path already consumes.
 *  `raw` is intentionally empty — slim records never serialize/format. */
function recordToBibEntry(r: BibIndexRecord): BibEntry {
  const fields: Record<string, string> = {};
  if (r.t) fields.title = r.t;
  if (r.a) fields.author = r.a;
  if (r.e) fields.editor = r.e;
  if (r.y) fields.year = r.y;
  if (r.d) fields.doi = r.d;
  if (r.j) fields.journal = r.j;
  if (r.b) fields.booktitle = r.b;
  if (r.v) fields.volume = r.v;
  if (r.n) fields.number = r.n;
  if (r.p) fields.pages = r.p;
  if (r.q) fields.publisher = r.q;
  if (r.s) fields.series = r.s;
  return { key: r.k, type: "misc", fields, raw: "" };
}

/** Read the tiny `.virgil/bib-index.stamp` change-signal. `null` when the
 *  library has no bib-index yet (old library → caller falls back to parsing
 *  master.bib). Cheap enough to call on every catalog poll. */
export async function readBibIndexStamp(
  handle: FileSystemDirectoryHandle,
): Promise<string | null> {
  const text = await readTextFile(handle, ROOT_FILES.bibIndexStamp);
  return text === undefined ? null : text.trim();
}

/** Read + widen `.virgil/bib-index.json`. Returns `null` when absent OR
 *  unreadable/malformed (e.g. a torn write) — both cases route the caller
 *  (useMasterBib) to its master.bib fallback, never to an empty list. */
export async function readBibIndex(
  handle: FileSystemDirectoryHandle,
): Promise<BibIndexResult | null> {
  const text = await readTextFile(handle, ROOT_FILES.bibIndex);
  if (text === undefined) return null;
  let parsed: BibIndexFile;
  try {
    parsed = JSON.parse(text) as BibIndexFile;
  } catch {
    return null; // truncated / corrupt index → fall back to master.bib
  }
  if (!parsed || !Array.isArray(parsed.entries)) return null;
  const stateByKey = new Map<string, BibAuthState>();
  for (const r of parsed.entries) {
    if (r.bs && VALID_BIB_STATES.has(r.bs)) {
      stateByKey.set(r.k, r.bs as BibAuthState);
    }
  }
  return {
    stamp: parsed.stamp ?? "",
    entries: parsed.entries.map(recordToBibEntry),
    stateByKey,
  };
}
