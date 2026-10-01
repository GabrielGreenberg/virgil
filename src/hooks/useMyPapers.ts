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
 *
 * Task 868 — storage is the truth, React state is its latest READING:
 *   - every change goes through `mutateMyPapers`, which computes from the
 *     STORED list inside one IndexedDB transaction (never from this
 *     window's state, which may predate the initial read or a peer's add);
 *   - the window paints the change optimistically (a PURE state updater),
 *     then adopts the list the door actually wrote;
 *   - a peer's `my-papers-changed` is an invalidation: re-read storage;
 *   - every read/write result carries a generation, and only the NEWEST
 *     settles into state — so a slow initial read can't overwrite a later
 *     add, nor an older write's result a newer one's.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { mutateMyPapers, readMyPapers } from "@/lib/doc-index";
import { publish, useBus, type BusEvent } from "@/lib/multi-window/bus";
import { getWindowId } from "@/lib/multi-window/window-id";

export function useMyPapers() {
  const [ids, setIds] = useState<string[]>([]);
  // Bumped by every read/write this window starts (and by unmount); a result
  // settles into state only if no newer one has started since.
  const generation = useRef(0);

  const settle = useCallback((pending: Promise<string[]>) => {
    const gen = ++generation.current;
    void pending.then(
      (next) => {
        if (gen === generation.current) setIds(next);
      },
      (err: unknown) => {
        // A failed write leaves the optimistic paint unconfirmed — re-read
        // so the window shows what storage actually holds.
        console.warn("[my-papers] storage op failed", err);
        if (gen === generation.current) {
          const again = ++generation.current;
          void readMyPapers().then(
            (s) => again === generation.current && setIds(s.ids),
            () => {},
          );
        }
      },
    );
  }, []);

  const refresh = useCallback(() => {
    settle(readMyPapers().then((s) => s.ids));
  }, [settle]);

  useEffect(() => {
    refresh();
    return () => {
      generation.current++;
    };
  }, [refresh]);

  const onBus = useCallback(
    (e: BusEvent) => {
      if (e.type !== "my-papers-changed") return;
      if (e.windowId === getWindowId()) return;
      refresh();
    },
    [refresh],
  );
  useBus(onBus);

  const change = useCallback(
    (edit: (ids: readonly string[]) => string[]) => {
      setIds((prev) => edit(prev));
      settle(
        mutateMyPapers(edit).then((written) => {
          publish({ type: "my-papers-changed", windowId: getWindowId() });
          return written;
        }),
      );
    },
    [settle],
  );

  const addMyPaper = useCallback(
    (id: string) =>
      change((cur) => (cur.includes(id) ? [...cur] : [...cur, id])),
    [change],
  );

  const removeMyPaper = useCallback(
    (id: string) => change((cur) => cur.filter((x) => x !== id)),
    [change],
  );

  return { myPaperIds: ids, addMyPaper, removeMyPaper };
}
