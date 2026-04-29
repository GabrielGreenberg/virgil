"use client";

import { useCallback, useMemo, useState } from "react";

/**
 * One-slot-per-kind tracker for the most-recently-added card. The id stays
 * pinned until the auto-clear coordinator notices selection has moved away.
 * Kept reactive (useState, not useRef) so panel sorts re-run when it changes.
 */
export type RecentlyAddedKind =
  | "note"
  | "cutter"
  | "revision"
  | "todo"
  | "footnote"
  | "quotation"
  | "citation";

export interface RecentlyAddedTracker {
  map: Partial<Record<RecentlyAddedKind, string>>;
  markAdded: (kind: RecentlyAddedKind, id: string) => void;
  clear: (kind: RecentlyAddedKind) => void;
  getId: (kind: RecentlyAddedKind) => string | null;
}

export function useRecentlyAddedTracker(): RecentlyAddedTracker {
  const [map, setMap] = useState<Partial<Record<RecentlyAddedKind, string>>>({});

  const markAdded = useCallback((kind: RecentlyAddedKind, id: string) => {
    setMap((prev) => (prev[kind] === id ? prev : { ...prev, [kind]: id }));
  }, []);

  const clear = useCallback((kind: RecentlyAddedKind) => {
    setMap((prev) => {
      if (prev[kind] === undefined) return prev;
      const next = { ...prev };
      delete next[kind];
      return next;
    });
  }, []);

  const getId = useCallback(
    (kind: RecentlyAddedKind) => map[kind] ?? null,
    [map],
  );

  return useMemo(
    () => ({ map, markAdded, clear, getId }),
    [map, markAdded, clear, getId],
  );
}

/**
 * Lift the card whose id matches `recentlyAddedId` to position 0 of the
 * already-sorted `items` array. No-op when the id is null or absent. Returns
 * a new array; does not mutate input.
 */
export function withRecentlyAddedFirst<T>(
  items: T[],
  recentlyAddedId: string | null | undefined,
  getId: (item: T) => string,
): T[] {
  if (!recentlyAddedId) return items;
  const idx = items.findIndex((item) => getId(item) === recentlyAddedId);
  if (idx <= 0) return items;
  const next = items.slice();
  const [pinned] = next.splice(idx, 1);
  next.unshift(pinned);
  return next;
}
