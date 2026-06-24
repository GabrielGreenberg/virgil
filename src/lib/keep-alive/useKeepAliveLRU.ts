"use client";

import { useEffect, useMemo, useState } from "react";

export interface KeepAliveEntry {
  /** Canonical dedup key. For Library readers: `library-paper:${citekey}`. */
  id: string;
  /** True for exactly the active id; the rest are kept-alive-but-hidden. */
  isVisible: boolean;
}

/**
 * Access-order keep-alive list. The active id is promoted to the front; the
 * list is sliced to `capacity` (most-recently-active first); the dropped tail
 * unmounts (a true React unmount ⇒ DocPipeline cleanup ⇒ pending-write flush).
 *
 * DEDUP CONTRACT (load-bearing): `id` is the identity. An id already present is
 * MOVED to the front, never duplicated — this is the guard against a same-docId
 * dual-pipeline (assertNotSuperseded). Callers MUST derive `id` canonically.
 *
 * Survivor stability: re-visiting a kept-alive id changes only the promoted id's
 * position and (at most) evicts the tail; survivors keep their entries' object
 * identity is irrelevant — what matters is React keys (the `id` strings) stay
 * the same set minus evictions, so survivors never remount.
 */
export function useKeepAliveLRU(
  activeId: string | null,
  capacity: number,
): KeepAliveEntry[] {
  const [order, setOrder] = useState<string[]>([]); // most-recent first

  useEffect(() => {
    if (activeId == null) return; // no active paper → leave the list intact (all hidden)
    setOrder((prev) => {
      if (prev[0] === activeId && prev.length <= capacity) return prev; // already front + within cap → stable
      const without = prev.filter((id) => id !== activeId); // DEDUP: drop any prior copy
      return [activeId, ...without].slice(0, capacity); // promote + evict the tail
    });
  }, [activeId, capacity]);

  return useMemo(
    () => order.map((id) => ({ id, isVisible: id === activeId })),
    [order, activeId],
  );
}
