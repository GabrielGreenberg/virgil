"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listDir, readFile, SUBDIRS } from "@library/lib/library-storage";
import { faultEpisode } from "@library/lib/read-fault";

const POLL_MS = 6000;
const UNSORTED_PATH = SUBDIRS.unsorted;

export function useUnsortedPdfs(handle: FileSystemDirectoryHandle | null) {
  const [files, setFiles] = useState<string[]>([]);

  // Change-guard (chip A2): the 6 s poll always produced a FRESH array, even
  // when the unsorted inbox was unchanged — and that fresh identity churned
  // `mergedEntries` in LibraryView every tick, forcing BOTH catalog lists to
  // recompute for nothing. Keep the last committed name list and only push a
  // new array when the EFFECTIVE list (names in display order) actually
  // changed, mirroring the guard already in `useUnsortedBibEntries`.
  const lastNamesRef = useRef<string[]>([]);
  const faultRef = useRef(faultEpisode("useUnsortedPdfs: unsorted/"));
  const commitNames = useCallback((next: string[]) => {
    const prev = lastNamesRef.current;
    if (prev.length === next.length && prev.every((n, i) => n === next[i])) {
      return; // unchanged — preserve the array identity (no mergedEntries churn)
    }
    lastNamesRef.current = next;
    setFiles(next);
  }, []);

  const reload = useCallback(async () => {
    if (!handle) return;
    // A faulted listing (task 1210) is "unknown", not "empty": keep the
    // last-good names and say so once per episode — never an unhandled
    // rejection from the 6 s poll's `void reload()`.
    let entries: Awaited<ReturnType<typeof listDir>>;
    try {
      entries = await listDir(handle, UNSORTED_PATH);
    } catch (err) {
      faultRef.current.fail(err);
      return;
    }
    faultRef.current.ok();
    if (!entries) {
      commitNames([]);
      return;
    }
    const sourceNames = entries
      .filter((e) => {
        if (e.kind !== "file") return false;
        const lower = e.name.toLowerCase();
        return (
          lower.endsWith(".pdf") ||
          lower.endsWith(".docx") ||
          lower.endsWith(".tex") ||
          lower.endsWith(".bib")
        );
      })
      .map((e) => e.name);
    // Sort by mtime descending so freshly-dropped files float to the top
    // of the list — matches the user's intuition that "new = top".
    const withMtime = await Promise.all(
      sourceNames.map(async (name) => {
        // Per-entry catch (task 1115): the read door rejects on a real IO /
        // permission failure, and one unreadable file must not abort the
        // whole list — it is still listed, just unsorted (mtime 0).
        try {
          const f = await readFile(handle, `${UNSORTED_PATH}/${name}`);
          return { name, mtime: f?.lastModified ?? 0 };
        } catch {
          return { name, mtime: 0 };
        }
      }),
    );
    withMtime.sort((a, b) => b.mtime - a.mtime);
    commitNames(withMtime.map((e) => e.name));
  }, [handle, commitNames]);

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

  return { files, reload };
}
