"use client";

import { useEffect, useState, useCallback } from "react";
import { readTextFile, ROOT_FILES } from "@library/lib/library-storage";
import { parseBibFile } from "@library/lib/bib-parser";
import type { BibEntry } from "@library/lib/types";

export function useMasterBib(handle: FileSystemDirectoryHandle | null) {
  const [entries, setEntries] = useState<BibEntry[]>([]);
  const [error, setError] = useState<Error | null>(null);

  const reload = useCallback(async () => {
    if (!handle) return;
    try {
      const text = await readTextFile(handle, ROOT_FILES.masterBib);
      if (text === undefined) {
        setEntries([]);
        return;
      }
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
