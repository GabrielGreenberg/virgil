/**
 * Compute how a library item lines up with a document's references.bib.
 *
 * The library is global, so this alignment is purely a view concern —
 * never persisted. Given the current doc's BibTeX keys and a library
 * item's Cowork-assigned citekey, decide which badge to show.
 */

import type {
  CitationAlignment,
  LibraryIndexItem,
} from "./library-types";

export function alignItemToBib(
  item: LibraryIndexItem,
  bibKeys: ReadonlySet<string>,
): CitationAlignment {
  if (!item.citekey) return "unresolved";
  return bibKeys.has(item.citekey) ? "cited-here" : "not-in-bib";
}

/** Build a fast lookup set from an array of BibEntry-shaped objects. */
export function bibKeySet(entries: readonly { key: string }[]): Set<string> {
  return new Set(entries.map((e) => e.key));
}

/** Inverse: which bib keys have no matching library item? */
export function unmatchedBibKeys(
  bibKeys: readonly string[],
  items: readonly LibraryIndexItem[],
): string[] {
  const haveCitekey = new Set(
    items.map((i) => i.citekey).filter((k): k is string => Boolean(k)),
  );
  return bibKeys.filter((k) => !haveCitekey.has(k));
}
