"use client";

import { useCallback, useEffect, useState } from "react";
import { listDir, readTextFile, SUBDIRS } from "@library/lib/library-storage";
import { parseBibFile } from "@library/lib/bib-parser";
import type { BibEntry } from "@library/lib/types";

const POLL_MS = 6000;
const UNSORTED_PATH = SUBDIRS.unsorted;

/**
 * Scan `unsorted/` for `.bib` files and return their parsed entries keyed
 * by source filename. Mirrors `useUnsortedPdfs` polling cadence.
 *
 * Used by `LibraryView` to synthesize catalog rows for `.bib` files that
 * have been imported by the user but not yet merged into `master.bib` by
 * the triage skill. The synthesis lets a "+ Add from .bib" custom library
 * render its rows immediately, before the cowork skills run.
 */
export function useUnsortedBibEntries(handle: FileSystemDirectoryHandle | null) {
  const [byFile, setByFile] = useState<Map<string, BibEntry[]>>(new Map());

  const reload = useCallback(async () => {
    if (!handle) {
      setByFile((prev) => (prev.size === 0 ? prev : new Map()));
      return;
    }
    const entries = await listDir(handle, UNSORTED_PATH);
    if (!entries) {
      setByFile((prev) => (prev.size === 0 ? prev : new Map()));
      return;
    }
    const bibNames = entries
      .filter((e) => e.kind === "file" && e.name.toLowerCase().endsWith(".bib"))
      .map((e) => e.name);

    const next = new Map<string, BibEntry[]>();
    for (const name of bibNames) {
      try {
        const text = await readTextFile(handle, `${UNSORTED_PATH}/${name}`);
        if (!text) continue;
        const parsed = parseBibFile(text);
        if (parsed.length > 0) next.set(name, parsed);
      } catch (err) {
        // A single broken file shouldn't block the others.
        console.warn(`[library] useUnsortedBibEntries: failed to parse unsorted/${name}`, err);
      }
    }

    setByFile((prev) => {
      // Skip the state update if nothing changed (cheap stable check by
      // comparing the per-file entry-count signature). Avoids feedback
      // loops on the polling timer.
      if (prev.size === next.size) {
        let same = true;
        for (const [k, v] of next) {
          const pv = prev.get(k);
          if (!pv || pv.length !== v.length) { same = false; break; }
        }
        if (same) return prev;
      }
      return next;
    });
  }, [handle]);

  useEffect(() => {
    if (!handle) return;
    let stopped = false;
    void reload();

    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);

    const tick = () => {
      if (stopped) return;
      void reload();
    };
    const interval = window.setInterval(tick, POLL_MS);

    return () => {
      stopped = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [handle, reload]);

  return { byFile, reload };
}
