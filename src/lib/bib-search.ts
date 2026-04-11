/**
 * Client-side search over a user's general bibliography file.
 *
 * Replaces `POST /api/bib/search`. The cache is keyed by `(docId,
 * lastModified)` so we re-parse only when the underlying .bib file
 * actually changes on disk.
 */

import { parseBibFile } from "@/lib/bib-parser";
import { readGeneralBib } from "@/lib/storage";
import type { BibEntry } from "@/lib/types";

interface CacheEntry {
  entries: BibEntry[];
  lastModified: number;
}

const cache = new Map<string, CacheEntry>();

async function getEntries(docId: string): Promise<BibEntry[] | null> {
  const bib = await readGeneralBib(docId);
  if (!bib) return null;

  const cached = cache.get(docId);
  if (cached && cached.lastModified === bib.lastModified) return cached.entries;

  const entries = parseBibFile(bib.bibText);
  cache.set(docId, { entries, lastModified: bib.lastModified });
  return entries;
}

export interface BibSearchResult {
  results: BibEntry[];
}

/**
 * Search the general bib for entries whose key, author, title, or year
 * contains the query string. Returns up to `limit` results.
 *
 * Returns null if no general bib has been picked for this doc yet.
 */
export async function searchGeneralBib(
  docId: string,
  query: string,
  limit = 20,
): Promise<BibSearchResult | null> {
  const entries = await getEntries(docId);
  if (entries === null) return null;

  if (!query || !query.trim()) {
    return { results: entries.slice(0, limit) };
  }

  const q = query.toLowerCase().trim();
  const results: BibEntry[] = [];
  for (const entry of entries) {
    if (results.length >= limit) break;
    const haystack = [
      entry.key,
      entry.fields.author || "",
      entry.fields.title || "",
      entry.fields.year || "",
    ]
      .join(" ")
      .toLowerCase();
    if (haystack.includes(q)) results.push(entry);
  }
  return { results };
}

/** Drop the cache entry for a doc. Called when the user picks a new file. */
export function invalidateBibSearchCache(docId: string): void {
  cache.delete(docId);
}
