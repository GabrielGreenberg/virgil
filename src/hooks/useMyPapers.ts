"use client";

/**
 * Global "My Papers" list — the user-curated set of papers displayed in
 * the Library's "My Papers" pod. Stored in IndexedDB under
 * `MY_PAPERS_KEY` (single shared record across all windows). Cross-window
 * sync via the BroadcastChannel bus.
 *
 * The list is decoupled from open document tabs: opening a doc anywhere
 * does NOT auto-add to My Papers. The only entry points that add are the
 * Library pod's "+ Add paper" menu paths (Recent click, Open folder…,
 * Create new document…). Likewise, removing a row never closes a tab.
 *
 * Set semantics: `addMyPaper` dedups by id (insertion order preserved).
 * Stale ids whose doc has been deleted are tolerated — `MyPapersPod`
 * filters them at render.
 */

import { useCallback, useEffect, useState } from "react";

import { readMyPapers, writeMyPapers } from "@/lib/doc-index";
import { publish, useBus, type BusEvent } from "@/lib/multi-window/bus";
import { getWindowId } from "@/lib/multi-window/window-id";

export function useMyPapers() {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    void readMyPapers().then((state) => {
      if (cancelled) return;
      setIds(state.ids);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onBus = useCallback((e: BusEvent) => {
    if (e.type !== "my-papers-changed") return;
    if (e.windowId === getWindowId()) return;
    setIds(e.ids);
  }, []);
  useBus(onBus);

  const addMyPaper = useCallback((id: string) => {
    setIds((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      void writeMyPapers({ ids: next });
      publish({
        type: "my-papers-changed",
        windowId: getWindowId(),
        ids: next,
      });
      return next;
    });
  }, []);

  const removeMyPaper = useCallback((id: string) => {
    setIds((prev) => {
      if (!prev.includes(id)) return prev;
      const next = prev.filter((x) => x !== id);
      void writeMyPapers({ ids: next });
      publish({
        type: "my-papers-changed",
        windowId: getWindowId(),
        ids: next,
      });
      return next;
    });
  }, []);

  return { myPaperIds: ids, addMyPaper, removeMyPaper };
}
