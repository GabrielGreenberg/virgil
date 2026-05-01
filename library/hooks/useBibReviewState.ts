"use client";

import { useCallback, useEffect, useState } from "react";
import { readBibReviewState } from "@library/lib/bib-edit";

/** Track whether a pending AI-review queue entry exists for a citekey.
 *  Re-reads on citekey change, on window focus, and whenever
 *  `refreshKey` changes (e.g. after the catalog version bumps and the
 *  parent wants to re-check). */
export function useBibReviewState(
  handle: FileSystemDirectoryHandle | null,
  citekey: string | null,
  refreshKey?: number,
) {
  const [queued, setQueued] = useState(false);

  const reload = useCallback(async () => {
    if (!handle || !citekey) {
      setQueued(false);
      return;
    }
    setQueued(await readBibReviewState(handle, citekey));
  }, [handle, citekey]);

  useEffect(() => {
    void reload();
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reload, refreshKey]);

  return { queued, reload, setQueued };
}
