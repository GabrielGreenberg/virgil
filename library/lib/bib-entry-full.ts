// On-demand fetch of a SINGLE full library bib entry (all fields + raw BibTeX).
//
// The browse path reads slim records from bib-index.json (no raw, browse
// fields only — see bib-index.ts). The EDIT and FORMAT paths (BibEditModal,
// formatBibliography, copy-BibTeX) need the full entry. Rather than parse the
// whole 34k-entry master.bib with citation-js (~2.6s) to get one entry, this
// reads master.bib, slices out just the requested entry's block with the TS
// twin of the Python pipeline's one locator (`locateMasterEntryBlock`, task
// 795 — last line-anchored match, value-embedded openers skipped, so `raw` is
// the copy every writer acts on), and parses only that block (~1ms).
//
// `type`/`fields` here are the CSL projection — fine for DISPLAY. The EDIT
// surface re-reads them from `raw` via `bibEditBase` (bib-raw-entry.ts).
//
// Always reads fresh (an explicit edit/format is a deliberate user action, and
// ~30-40ms for the FSA read is imperceptible there). Callers should resolve
// once on selection/mount and hold the result, not call per render.

import { readTextFile, ROOT_FILES } from "./library-storage";
import { parseBibFile } from "./bib-parser";
import { locateMasterEntryBlock } from "./bib-raw-entry";
import type { BibEntry } from "./types";

/**
 * Fetch the full library BibEntry for `citekey` from master.bib, or `null` if
 * not found / no master.bib. Parses only the single entry, never the whole file.
 */
export async function getFullLibraryBibEntry(
  handle: FileSystemDirectoryHandle,
  citekey: string,
): Promise<BibEntry | null> {
  const text = await readTextFile(handle, ROOT_FILES.masterBib);
  if (text === undefined) return null;
  const block = locateMasterEntryBlock(text, citekey);
  if (!block) return null;
  const parsed = parseBibFile(block);
  return parsed.find((e) => e.key === citekey) ?? parsed[0] ?? null;
}
