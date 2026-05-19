"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { readTextFile, ROOT_FILES } from "@library/lib/library-storage";
import { parseBibFile } from "@library/lib/bib-parser";
import type { BibEntry } from "@library/lib/types";

export function useMasterBib(handle: FileSystemDirectoryHandle | null) {
  const [entries, setEntries] = useState<BibEntry[]>([]);
  const [error, setError] = useState<Error | null>(null);
  // Content cache: if the file text is byte-for-byte unchanged from the
  // last successful parse, skip re-parsing. Keeps `parseBibFile`'s
  // "Skipping unparseable bib entry" warnings (and the resulting new
  // BibEntry[] reference) bounded to actual file changes — important for
  // downstream consumers like BibliographyPanel's `displayedEntries`
  // useMemo and the Fuse WeakMap in `bib-searcher.ts`, which both key on
  // array reference identity. Defense-in-depth alongside the
  // `state.handle === handle` gate removal in `catalog-store.ts`.
  const lastTextRef = useRef<string | null>(null);

  const reload = useCallback(async () => {
    if (!handle) return;
    try {
      const text = await readTextFile(handle, ROOT_FILES.masterBib);
      if (text === undefined) {
        lastTextRef.current = null;
        setEntries([]);
        return;
      }
      if (text === lastTextRef.current) return;
      lastTextRef.current = text;
      setEntries(parseBibFile(text));
      setError(null);
    } catch (e) {
      setError(e as Error);
    }
  }, [handle]);

  useEffect(() => {
    if (!handle) return;
    void reload();
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [handle, reload]);

  return { entries, error, reload };
}
