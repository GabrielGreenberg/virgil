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

/**
 * Declared per-surface compressed-line counts (A5 / R8). Both surfaces now
 * DECLARE their value via a `CardDisplayProvider` rather than leaning on the
 * silent default-1 — so a regression to the default is visible and a test
 * (`compression-symmetry-contract.test.ts`) can pin both numbers.
 *
 * - Omni view shows two lines: cards float free in the margin with room.
 * - The docked card panels show one line: the narrow dock column is tighter.
 */
export const OMNI_COMPRESSED_LINES = 2;
export const DOCKED_COMPRESSED_LINES = 1;

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
