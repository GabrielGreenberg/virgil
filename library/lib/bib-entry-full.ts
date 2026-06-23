// On-demand fetch of a SINGLE full library bib entry (all fields + raw BibTeX).
//
// The browse path reads slim records from bib-index.json (no raw, browse
// fields only — see bib-index.ts). The EDIT and FORMAT paths (BibEditModal,
// formatBibliography, copy-BibTeX) need the full entry. Rather than parse the
// whole 34k-entry master.bib with citation-js (~2.6s) to get one entry, this
// reads master.bib, slices out just the requested entry's block by its
// line-anchored `@type{key,` opener, and parses only that block (~1ms).
//
// Always reads fresh (an explicit edit/format is a deliberate user action, and
// ~30-40ms for the FSA read is imperceptible there). Callers should resolve
// once on selection/mount and hold the result, not call per render.

import { readTextFile, ROOT_FILES } from "./library-storage";
import { parseBibFile } from "./bib-parser";
import type { BibEntry } from "./types";

/** Entry starts: `@type{key,`. Robust to malformed (brace-unbalanced) entries —
 *  boundaries come from the next opener, not brace-matching (which can overrun a
 *  bad entry and swallow the rest).
 *
 *  Deliberately matches the SAME lenient opener convention every OTHER parser in
 *  the library uses — `bib-parser.ts`'s `extractRawEntries` (`/@\w+\s*\{([^,]+),/`)
 *  and the Python pipeline's `rename_master_bib_entry` (`@\w+\s*\{\s*<key>\s*,`).
 *  An earlier `^@…[ \t]*,`-anchored form was an OUTLIER: it (a) required the
 *  opener at COLUMN 0 (missing indented entries) and (b) forbade a newline
 *  between the citekey and its comma, so a valid entry the rest of the system
 *  matched could come back `null` here — the "bib edit does nothing" production
 *  bug, since RightDetail then never gets a real full entry to enable edit. So:
 *  no `^` anchor, and `\s*` (newline-tolerant) around the brace and before the
 *  comma. The key is `[^,\s]+` (trimmed-equivalent — `\s*` eats surrounding
 *  whitespace), compared exactly to the requested citekey. */
const ENTRY_START_RE = /@(\w+)\s*\{\s*([^,\s]+)\s*,/g;

/** Slice out the raw BibTeX block for `citekey` (opener → next opener/EOF). */
function extractEntryBlock(text: string, citekey: string): string | null {
  ENTRY_START_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  let blockStart = -1;
  while ((m = ENTRY_START_RE.exec(text)) !== null) {
    if (blockStart >= 0) return text.slice(blockStart, m.index);
    if (m[2] === citekey) blockStart = m.index;
  }
  return blockStart >= 0 ? text.slice(blockStart) : null;
}

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
  const block = extractEntryBlock(text, citekey);
  if (!block) return null;
  const parsed = parseBibFile(block);
  return parsed.find((e) => e.key === citekey) ?? parsed[0] ?? null;
}
