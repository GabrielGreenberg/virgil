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

import { useEffect, useMemo, useState } from "react";
import type { CatalogEntry, IndexedState } from "@library/lib/catalog";
import { useCatalogItems } from "@library/lib/catalog-store";
import { getLibraryHandle } from "@library/lib/library-folder";
import { useMasterBib } from "@library/hooks/useMasterBib";
import { useDiskLibraries } from "@library/hooks/useDiskLibraries";
import type { BibEntry } from "@/lib/types";
import { mintBibUid } from "@/lib/bib-uid";
import type {
  LibraryIndexItem,
  LibraryItemStatus,
} from "@/lib/library/library-types";
import { indexStateTier } from "@/lib/library/status-tone";

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
    bibState: e.bib?.state,
    indexTier: indexStateTier(e.indexed.state),
  };
}

export function useLibraryItems(): {
  items: LibraryIndexItem[];
  revision: number;
  hasFolder: boolean;
} {
  const { entries, revision, hasFolder } = useCatalogItems();
  const items: LibraryIndexItem[] = [];
  for (const e of entries) {
    const item = entryToItem(e);
    if (item) items.push(item);
  }
  return { items, revision, hasFolder };
}

/**
 * Shared per-citekey library resolver. Returns a stable `(citekey) =>
 * LibraryIndexItem | undefined` lookup over the live catalog, so any card
 * (bibliography, citation, …) can ask "is this reference in the library, and
 * what's its index tier / bib-state?" without rebuilding the map itself.
 */
export function useLibraryEntryLookup(): (
  citekey: string,
) => LibraryIndexItem | undefined {
  const { items } = useLibraryItems();
  const byCitekey = useMemo(() => {
    const map = new Map<string, LibraryIndexItem>();
    for (const it of items) {
      if (it.citekey) map.set(it.citekey, it);
    }
    return map;
  }, [items]);
  return useMemo(() => (citekey: string) => byCitekey.get(citekey), [byCitekey]);
}

/**
 * Editor-side accessor for `master.bib` in the central Virgil Library.
 * Returns the parsed entries, or an empty list when no library is
 * connected. The handle is resolved lazily via `getLibraryHandle()` —
 * mirrors what the Library tab does, no extra permission flow.
 *
 * The handle is also watched against `useLibraryItems().hasFolder` so
 * the entries refresh when the user (re)connects a library mid-session.
 *
 * Pass `enabled: false` (default `true`) to fully skip the master.bib
 * parse — the hook still mounts (so the conditional-hook rule isn't
 * violated) but resolves to an empty entries list. Callers that
 * unconditionally mount but only need the entries on demand (e.g. the
 * citation auto-add path, which only matters when the doc has citations
 * referencing unresolved keys) use this to keep the editor session free
 * of citation-js work until it's earned.
 */
export function useLibraryMasterBib(enabled: boolean = true): {
  entries: BibEntry[];
  error: Error | null;
} {
  const { hasFolder, revision } = useLibraryItems();
  const [handle, setHandle] = useState<FileSystemDirectoryHandle | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!enabled || !hasFolder) {
      setHandle(null);
      return;
    }
    void getLibraryHandle().then((h) => {
      if (cancelled) return;
      setHandle(h ?? null);
    });
    return () => {
      cancelled = true;
    };
    // `revision` participates so a catalog version bump re-resolves the
    // handle (covers the rare case of the underlying handle being
    // replaced while a session is open).
  }, [enabled, hasFolder, revision]);

  // When disabled, pass `null` to the parser hook so it short-circuits
  // (it already returns `[]` for a null handle). Mounts unconditionally
  // either way, so hook order stays stable.
  const { entries, error } = useMasterBib(enabled ? handle : null);
  // The library subsystem's `BibEntry` predates the paper-side `uid`
  // surrogate (T1 Stage 0). Mint a uid as entries cross the library→paper
  // seam. Memoized on the source array identity so the result is stable
  // across renders (downstream memos key on identity, and the parser cache
  // already returns a stable array reference).
  const withUids = useMemo<BibEntry[]>(
    () => entries.map((e) => ({ ...e, uid: mintBibUid() })),
    [entries],
  );
  return { entries: withUids, error };
}

/** One membership slot — references a custom library (a manifest at
 *  `.virgil/libraries/<slug>.json`) by stable id + user-facing label. */
export interface LibraryMembership {
  id: string;
  label: string;
}

/**
 * Map of `citekey → custom-library memberships`. "Central" is implicit
 * (every entry in master.bib belongs to Central) and is NOT included
 * here — callers decide whether to surface a Central chip themselves.
 *
 * Reuses the same FSA handle resolution as `useLibraryMasterBib`, so
 * one handle resolve serves both reads. The underlying `useDiskLibraries`
 * polls catalog-version.txt every 6s, same cadence as the catalog store.
 */
export function useLibraryMemberships(): {
  membershipMap: Map<string, LibraryMembership[]>;
} {
  const { hasFolder, revision } = useLibraryItems();
  const [handle, setHandle] = useState<FileSystemDirectoryHandle | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!hasFolder) {
      setHandle(null);
      return;
    }
    void getLibraryHandle().then((h) => {
      if (cancelled) return;
      setHandle(h ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [hasFolder, revision]);

  const { libraries } = useDiskLibraries(handle);

  const membershipMap = useMemo(() => {
    const out = new Map<string, LibraryMembership[]>();
    for (const lib of libraries) {
      if (lib.kind !== "custom") continue;
      const slot: LibraryMembership = { id: lib.id, label: lib.label };
      for (const ck of lib.entryKeys ?? []) {
        if (!ck) continue;
        const list = out.get(ck);
        if (list) list.push(slot);
        else out.set(ck, [slot]);
      }
    }
    return out;
  }, [libraries]);

  return { membershipMap };
}
