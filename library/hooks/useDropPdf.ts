"use client";

import { useCallback } from "react";
import { dropUnsortedSource } from "@library/lib/queue";

/** The source extensions a Library drop ingests into `unsorted/`. */
export const DROPPABLE_SOURCE_RE = /\.(pdf|docx|tex|bib)$/i;

/** One dropped file's outcome. EVERY dropped file yields exactly one result —
 *  an unsupported type or a drop before the folder is ready is an
 *  `{ok:false, reason}`, never a silent filter (task 764), so the caller can
 *  put each failure on the same toast channel the row actions use. */
export type DropResult =
  | { ok: true; name: string; unsortedFilename: string; queueFilename: string }
  | { ok: false; name: string; reason: string };

export function useDropPdf(handle: FileSystemDirectoryHandle | null) {
  return useCallback(
    async (files: File[]): Promise<DropResult[]> => {
      if (!handle) {
        return files.map((f) => ({
          ok: false as const,
          name: f.name,
          reason: "the library folder isn't open yet — try again in a moment",
        }));
      }
      const results: DropResult[] = [];
      for (const f of files) {
        if (!DROPPABLE_SOURCE_RE.test(f.name)) {
          results.push({
            ok: false,
            name: f.name,
            reason: "not a supported source (drop a .pdf, .docx, .tex or .bib)",
          });
          continue;
        }
        try {
          const r = await dropUnsortedSource(handle, f);
          results.push({ ok: true, ...r, name: f.name });
        } catch (err) {
          results.push({
            ok: false,
            name: f.name,
            reason: `not imported — ${err instanceof Error && err.message ? err.message : String(err)}`,
          });
        }
      }
      return results;
    },
    [handle],
  );
}
