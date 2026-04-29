"use client";

import { createContext, useContext, type ReactNode } from "react";
import type {
  RecentlyAddedKind,
  RecentlyAddedTracker,
} from "@/hooks/useRecentlyAddedTracker";

/**
 * Provides the app-level recently-added tracker. Card creation flows call
 * `markAdded(kind, id)` next to setting selection; panel sorts read
 * `getId(kind)` to pin the new card at index 0 until the auto-clear
 * coordinator releases it.
 */
const RecentlyAddedCtx = createContext<RecentlyAddedTracker | null>(null);

export function RecentlyAddedProvider({
  value,
  children,
}: {
  value: RecentlyAddedTracker;
  children: ReactNode;
}) {
  return (
    <RecentlyAddedCtx.Provider value={value}>
      {children}
    </RecentlyAddedCtx.Provider>
  );
}

export function useRecentlyAddedContext(): RecentlyAddedTracker | null {
  return useContext(RecentlyAddedCtx);
}

export function useRecentlyAddedId(kind: RecentlyAddedKind): string | null {
  const tracker = useContext(RecentlyAddedCtx);
  return tracker?.getId(kind) ?? null;
}
