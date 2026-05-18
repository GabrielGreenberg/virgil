"use client";

import { useEffect, useMemo, useRef } from "react";
import type { BibEntry, CitationRef } from "@/lib/types";

/**
 * Auto-enrich a paper's `references.bib` from the central Virgil Library.
 *
 * For every citekey referenced by any citation in the paper, if the key is
 * present in the library's master.bib but missing from the paper's local
 * bib, silently append the library entry. Idempotent — `addBibEntry`
 * already dedupes by key, and we additionally track which keys we have
 * already requested so a steady-state render burst doesn't repeatedly
 * fire `addBibEntry(libEntry)` before the previous setState lands.
 *
 * Covers:
 *   - picker pick (the picker's own onPick also calls addBibEntry, but
 *     this catches the case where the picker fires before the citation
 *     has been written to state)
 *   - typed `\cite{libkey}` directly in the editor
 *   - drag-to-card merges
 *   - pasted citation commands
 *
 * Leaves alone: citekeys that exist in neither bib (the card surfaces a
 * "not in your bibliography" warning, which is correct).
 */
export function useAutoAddLibraryEntriesForCitations(args: {
  citations: CitationRef[];
  bibEntries: BibEntry[];
  libraryEntries: BibEntry[];
  addBibEntry: (entry: BibEntry) => void;
}) {
  const { citations, bibEntries, libraryEntries, addBibEntry } = args;

  // Refs let the effect read the freshest data without putting it in the
  // dep array, so we don't re-fire on every reference change.
  const bibEntriesRef = useRef(bibEntries);
  bibEntriesRef.current = bibEntries;
  const libraryEntriesRef = useRef(libraryEntries);
  libraryEntriesRef.current = libraryEntries;
  const addBibEntryRef = useRef(addBibEntry);
  addBibEntryRef.current = addBibEntry;

  // Stringified set of referenced keys — a stable primitive we can put in
  // the effect's dep array. Avoids the Set-by-reference instability that
  // would otherwise re-fire the effect on every render.
  const referencedKeysJoined = useMemo(() => {
    const out = new Set<string>();
    for (const cit of citations) {
      for (const k of cit.keys) if (k) out.add(k);
    }
    return Array.from(out).sort().join("|");
  }, [citations]);

  // Same trick for library coverage — we only care WHICH keys are
  // available in the library, not the full entry data.
  const libraryKeysJoined = useMemo(
    () => libraryEntries.map((e) => e.key).sort().join("|"),
    [libraryEntries],
  );

  // And for the paper bib — when a key appears here, the effect should
  // re-evaluate (in case it can now skip an earlier candidate).
  const paperKeysJoined = useMemo(
    () => bibEntries.map((e) => e.key).sort().join("|"),
    [bibEntries],
  );

  // In-process guard so we don't double-fire `addBibEntry` for the same
  // key inside a single React commit.
  const requestedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const refKeys = referencedKeysJoined ? referencedKeysJoined.split("|") : [];
    if (refKeys.length === 0) return;
    const paperKeys = new Set(paperKeysJoined.split("|").filter(Boolean));
    const libByKey = new Map<string, BibEntry>();
    for (const e of libraryEntriesRef.current) libByKey.set(e.key, e);
    for (const key of refKeys) {
      if (paperKeys.has(key)) {
        requestedRef.current.delete(key);
        continue;
      }
      if (requestedRef.current.has(key)) continue;
      const lib = libByKey.get(key);
      if (!lib) continue;
      requestedRef.current.add(key);
      addBibEntryRef.current(lib);
    }
  }, [referencedKeysJoined, libraryKeysJoined, paperKeysJoined]);
}
