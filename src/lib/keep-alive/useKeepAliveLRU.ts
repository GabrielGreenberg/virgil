"use client";

import { useMemo, useState } from "react";

export interface KeepAliveEntry {
  /** Canonical dedup key. For Library readers: `library-paper:${citekey}`. */
  id: string;
  /** True for exactly the active id; the rest are kept-alive-but-hidden. */
  isVisible: boolean;
}

/**
 * "Is this id still a renderable member of the warm set?" — the LRU's LIVE
 * population (task 1456). Its IDENTITY is the change signal: a caller memoizes
 * it on whatever the live set derives from, so a new predicate means the live
 * set changed and the order is re-pruned.
 */
export type KeepAliveLivePredicate = (id: string) => boolean;

const ALWAYS_LIVE: KeepAliveLivePredicate = () => true;

/**
 * The one order transition: drop dead ids (never the active one), promote the
 * active id to the front (DEDUP), slice to capacity. Pruning happens BEFORE the
 * slice, so capacity counts only live ids — a closed tab or a failed load can
 * never hold a slot a live warm paper is evicted to keep. Returns `prev` when
 * nothing changed, so an unchanged order costs no state update.
 */
export function nextKeepAliveOrder(
  prev: readonly string[],
  activeId: string | null,
  capacity: number,
  isLive: KeepAliveLivePredicate,
): readonly string[] {
  const live = prev.filter((id) => id === activeId || isLive(id));
  const promoted =
    activeId == null
      ? live // null leaves the (live) order intact — kept warm, all hidden
      : [activeId, ...live.filter((id) => id !== activeId)]; // DEDUP: drop any prior copy
  const next = promoted.slice(0, capacity); // evict the tail
  return next.length === prev.length && next.every((id, i) => id === prev[i])
    ? prev
    : next;
}

/**
 * Access-order keep-alive list. The active id is promoted to the front; the
 * list is sliced to `capacity` (most-recently-active first); the dropped tail
 * unmounts (a true React unmount ⇒ DocPipeline cleanup ⇒ pending-write flush).
 *
 * LIVE POPULATION (task 1456): `isLive` names which ids may still occupy a slot
 * (for authored docs: open tab ∧ not failed-to-load). Dead ids are pruned from
 * the ORDER — not merely filtered at render — whenever the active id or the
 * predicate changes, so the warm set is the N most-recently-active LIVE ids.
 * The active id itself is never pruned (it is the one being shown).
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
  isLive: KeepAliveLivePredicate = ALWAYS_LIVE,
): KeepAliveEntry[] {
  const [order, setOrder] = useState<readonly string[]>(
    activeId != null ? [activeId] : [],
  );
  // "Adjust state during render" (React's documented pattern for deriving from a
  // changed input without an effect): when the active id OR the live set
  // changes, prune + promote + dedup + evict, synchronously, before paint.
  const [seenActiveId, setSeenActiveId] = useState<string | null>(activeId);
  const [seenIsLive, setSeenIsLive] = useState<KeepAliveLivePredicate>(
    () => isLive,
  );
  if (activeId !== seenActiveId || isLive !== seenIsLive) {
    setSeenActiveId(activeId);
    setSeenIsLive(() => isLive);
    setOrder((prev) => nextKeepAliveOrder(prev, activeId, capacity, isLive));
  }

  return useMemo(
    () => order.map((id) => ({ id, isVisible: id === activeId })),
    [order, activeId],
  );
}
