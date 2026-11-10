/**
 * "Export cited.bib" — the cited entries' blocks, author-sorted, as one file.
 *
 * Shared by the Bibliography panel and the tool gutter's bibliography list, so
 * the two can't export different files for the same paper.
 */

import type { BibEntry } from "@/lib/types";
import { bibFieldDisplay, serializeBibForExport } from "@/lib/bib-parser";

/**
 * Author sort, on PROJECTED text (task 409, decision 3). Sorting the raw `.bib`
 * bytes filed every accented surname under its escape — `L{\'o}pez` sorts on
 * `L{` and lands above "Adams" — so the list order was simply wrong. ONE
 * comparator, read by the panel list AND by the cited-export, because the two
 * disagreeing about order is how the export's byte order drifts from what the
 * user was looking at.
 */
export function byProjectedAuthor(a: BibEntry, b: BibEntry): number {
  const keyOf = (e: BibEntry) =>
    (bibFieldDisplay(e, "author") || e.key).toLowerCase();
  return keyOf(a).localeCompare(keyOf(b));
}

/** The cited.bib text, or null when nothing is cited. */
export function citedBibText(
  entries: readonly BibEntry[],
  citedKeys: ReadonlySet<string>,
  source = "",
): string | null {
  const seen = new Set<string>();
  const cited = entries.filter((e) => {
    if (!citedKeys.has(e.key) || seen.has(e.key)) return false;
    seen.add(e.key);
    return true;
  });
  if (cited.length === 0) return null;
  cited.sort(byProjectedAuthor);
  // Reconstruct every entry through the serializer — NEVER the raw-passthrough
  // that `.filter(Boolean)`-drops an in-memory entry with empty `raw`
  // (BIB-F7-01, DATA-LOSS). `serializeBibForExport` rebuilds from fields when
  // `raw === ""`, so a "Save under new citekey"/library-added/AI-found entry
  // exports its reconstructed block instead of silently vanishing.
  // …and from the SOURCE, so the file carries what those entries depend on
  // (their `@string` macros, `@preamble`, crossref parents — task 949).
  return serializeBibForExport(cited, source);
}

/** Save the cited entries as `cited.bib` through a download link. */
export function downloadCitedBib(
  entries: readonly BibEntry[],
  citedKeys: ReadonlySet<string>,
  source = "",
): void {
  const content = citedBibText(entries, citedKeys, source);
  if (content === null) return;
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "cited.bib";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
