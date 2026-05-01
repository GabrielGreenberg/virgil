"use client";

import { useCallback } from "react";
import { dropUnsortedSource } from "@library/lib/queue";

export function useDropPdf(handle: FileSystemDirectoryHandle | null) {
  return useCallback(
    async (files: File[]) => {
      if (!handle) return [];
      const sources = files.filter((f) => /\.(pdf|docx)$/i.test(f.name));
      const results = [];
      for (const f of sources) {
        try {
          const r = await dropUnsortedSource(handle, f);
          results.push({ ok: true as const, ...r, name: f.name });
        } catch (err) {
          results.push({ ok: false as const, name: f.name, error: err as Error });
        }
      }
      return results;
    },
    [handle],
  );
}
