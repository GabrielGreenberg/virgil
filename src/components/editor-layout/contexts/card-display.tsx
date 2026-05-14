"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * CardDisplayContext — knobs that vary the compressed-card presentation
 * per surface. Cards consult these via hooks so the same component can
 * render slightly differently in omni-view, native pods, or future
 * surfaces (search results, recent activity, etc.) without prop drilling.
 *
 * Default (no provider): `compressedLines = 1`, matching the legacy
 * single-line truncate behaviour.
 */
export interface CardDisplayContextValue {
  /** Max number of lines shown in a compressed card's body. */
  compressedLines: number;
}

const CardDisplayCtx = createContext<CardDisplayContextValue | null>(null);

export function CardDisplayProvider({
  value,
  children,
}: {
  value: CardDisplayContextValue;
  children: ReactNode;
}) {
  return <CardDisplayCtx.Provider value={value}>{children}</CardDisplayCtx.Provider>;
}

/** Resolved compressed-line count for the current surface (default 1). */
export function useCompressedLines(): number {
  return useContext(CardDisplayCtx)?.compressedLines ?? 1;
}
