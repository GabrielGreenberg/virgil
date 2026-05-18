/**
 * Client-side search across a paper's local bib and the central Virgil
 * Library. Both scopes delegate to one fuzzy ranked-search primitive
 * (`searchBibFuzzy` in `bib-searcher.ts`), so the bar feels consistent
 * regardless of which scope is active.
 *
 * (The old `searchGeneralBib` over a user-picked external `.bib` file
 * is gone — its concept is now covered by "search the central library,"
 * which IS the global bib.)
 */

import { searchBibFuzzy } from "@/lib/bib-searcher";
import type { BibEntry } from "@/lib/types";

/**
 * Search a list of already-loaded BibEntry objects (the local paper bib).
 * Synchronous — operates on the in-memory list passed by the caller.
 */
export function searchLocalBib(
  entries: BibEntry[],
  query: string,
  limit = Infinity,
): BibEntry[] {
  return searchBibFuzzy(entries, query, limit);
}

/**
 * Search the central Virgil Library's master.bib (already parsed into a
 * BibEntry[] by the caller via useMasterBib). Same engine as the local
 * search; the wrapper exists so the call site at the BibliographyPanel
 * reads semantically.
 *
 * Synchronous — operates on the in-memory list passed by the caller.
 */
export function searchCentralLibrary(
  entries: BibEntry[],
  query: string,
  limit = 50,
): BibEntry[] {
  return searchBibFuzzy(entries, query, limit);
}
