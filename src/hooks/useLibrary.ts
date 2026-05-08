"use client";

/**
 * Façade over the new library catalog store. Preserves the
 * `useLibraryItems()` API the BibliographyPanel depends on, but feeds it
 * from the transplanted catalog instead of the v1 manifest hook.
 *
 * The full v1 hook (with pickFolder/forgetFolder/permissionGranted/manifest)
 * is gone — its only consumer was the v1 LibraryTabView, which has been
 * replaced by a shim around `<LibraryApp />` (under /library/).
 */

import type { CatalogEntry, IndexedState } from "@library/lib/catalog";
import { useCatalogItems } from "@library/lib/catalog-store";
import type {
  LibraryIndexItem,
  LibraryItemStatus,
} from "@/lib/library/library-types";

function mapStatus(s: IndexedState): LibraryItemStatus {
  switch (s) {
    case "indexed":
    case "deepIndexed":
      return "ready";
    case "running":
      return "extracting";
    case "failed":
      return "failed";
    case "none":
    case "queued":
    default:
      return "pending";
  }
}

function entryToItem(e: CatalogEntry): LibraryIndexItem | null {
  // BibliographyPanel keys by citekey; entries without one (mid-triage
  // unsorted PDFs) have nothing to match against in a doc's bib.
  if (!e.citekey) return null;
  return {
    id: e.citekey,
    citekey: e.citekey,
    status: mapStatus(e.indexed.state),
    title: e.title,
    authors: e.authors,
    year: e.year,
    doi: e.doi,
    pageCount: e.pdf.pageCount,
    updatedAt: e.updatedAt,
  };
}

export function useLibraryItems(): {
  items: LibraryIndexItem[];
  revision: number;
} {
  const { entries, revision } = useCatalogItems();
  const items: LibraryIndexItem[] = [];
  for (const e of entries) {
    const item = entryToItem(e);
    if (item) items.push(item);
  }
  return { items, revision };
}
