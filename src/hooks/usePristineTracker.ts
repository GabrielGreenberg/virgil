"use client";

import { useRef, useCallback } from "react";

/**
 * Tracks card IDs that were created but not yet edited. Card-list hooks
 * call `markNew(id)` when a card is created via the "+" button, and
 * `markDirty(id)` on any user-driven edit. On panel close (or when the
 * host component unmounts) the hook calls `takePristine()` and discards
 * those IDs, so a pristine new card never persists to disk.
 *
 * The tracker is deliberately in-memory and kept local to the hook that
 * owns the card list — pristine state has no reason to outlive the
 * panel/session that produced it.
 */
export interface PristineTracker {
  markNew(id: string): void;
  markDirty(id: string): void;
  isPristine(id: string): boolean;
  takePristine(): string[];
}

export function usePristineTracker(): PristineTracker {
  const ref = useRef<Set<string>>(new Set());

  const markNew = useCallback((id: string) => {
    ref.current.add(id);
  }, []);

  const markDirty = useCallback((id: string) => {
    ref.current.delete(id);
  }, []);

  const isPristine = useCallback((id: string) => ref.current.has(id), []);

  const takePristine = useCallback((): string[] => {
    const ids = Array.from(ref.current);
    ref.current.clear();
    return ids;
  }, []);

  return { markNew, markDirty, isPristine, takePristine };
}
