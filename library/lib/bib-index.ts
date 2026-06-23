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

/** One slim record in bib-index.json. Compact keys keep the file ~6MB at 34k.
 *  k=citekey t=title a=author y=year d=doi j=journal b=booktitle. */
interface BibIndexRecord {
  k: string;
  t?: string;
  a?: string;
  y?: string;
  d?: string;
  j?: string;
  b?: string;
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
}

/** Map a slim record to the BibEntry shape the browse path already consumes.
 *  `raw` is intentionally empty — slim records never serialize/format. */
function recordToBibEntry(r: BibIndexRecord): BibEntry {
  const fields: Record<string, string> = {};
  if (r.t) fields.title = r.t;
  if (r.a) fields.author = r.a;
  if (r.y) fields.year = r.y;
  if (r.d) fields.doi = r.d;
  if (r.j) fields.journal = r.j;
  if (r.b) fields.booktitle = r.b;
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

/** Read + widen `.virgil/bib-index.json`. Returns `null` when absent (caller
 *  falls back to citation-js parsing master.bib). Throws only on genuinely
 *  malformed JSON, which the caller treats as "fall back." */
export async function readBibIndex(
  handle: FileSystemDirectoryHandle,
): Promise<BibIndexResult | null> {
  const text = await readTextFile(handle, ROOT_FILES.bibIndex);
  if (text === undefined) return null;
  const parsed = JSON.parse(text) as BibIndexFile;
  if (!parsed || !Array.isArray(parsed.entries)) return null;
  return {
    stamp: parsed.stamp ?? "",
    entries: parsed.entries.map(recordToBibEntry),
  };
}
