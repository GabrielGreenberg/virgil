/**
 * Pure helpers for the per-doc diagnostics store (P5).
 *
 * Extracted so id minting + dismissal pruning are unit-testable and shared by
 * both the lint hook and the compile path without duplicating logic across
 * EditorPane / EditorLayout. Everything here is a pure function — no React, no
 * storage.
 */

import { makeErrorId, type LatexError } from "@/lib/latex-errors";

/**
 * A monotonically-incrementing ordinal minter for one parse/lint pass.
 *
 * Each call to `next()` returns the next integer starting at 0. Feed the
 * returned value into `makeErrorId({ ..., ordinal })` so two records that share
 * an identical (source, line, col, message) tuple in the same pass still get
 * distinct ids (the line-0 collision class). A fresh minter per pass keeps ids
 * stable within a run.
 */
export interface OrdinalMinter {
  next(): number;
}

export function createOrdinalMinter(): OrdinalMinter {
  let n = 0;
  return {
    next() {
      return n++;
    },
  };
}

/**
 * Mint a diagnostic id with a per-parse ordinal (and optional per-run salt),
 * bumping the minter. A thin convenience over `makeErrorId` so callers don't
 * hand-thread the ordinal.
 */
export function mintDiagnosticId(
  minter: OrdinalMinter,
  parts: {
    source: LatexError["source"];
    line: number;
    column?: number;
    message: string;
    salt?: string;
  },
): string {
  return makeErrorId({ ...parts, ordinal: minter.next() });
}

/**
 * Drop any dismissed id that is no longer present in the live diagnostic set.
 *
 * Because ids now change across runs (per-run salt), a dismissal from an
 * earlier run would otherwise linger forever and could accidentally hide a
 * DIFFERENT card if an id were ever reused. Pruning against the live set both
 * bounds the set and re-surfaces a genuinely re-occurring error (its new id
 * isn't in the stale dismissed set). Returns the SAME reference when nothing
 * changed so callers can bail a state update (avoids a needless re-render).
 */
export function pruneDismissed(
  dismissed: Set<string>,
  liveIds: Iterable<string>,
): Set<string> {
  if (dismissed.size === 0) return dismissed;
  const live = liveIds instanceof Set ? liveIds : new Set(liveIds);
  let changed = false;
  const next = new Set<string>();
  for (const id of dismissed) {
    if (live.has(id)) next.add(id);
    else changed = true;
  }
  return changed ? next : dismissed;
}
