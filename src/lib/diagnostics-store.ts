/**
 * Pure helpers for the per-doc diagnostics store (P5).
 *
 * Extracted so dismissal pruning is unit-testable and shared by
 * both the lint hook and the compile path without duplicating logic across
 * EditorPane / EditorLayout. Everything here is a pure function — no React, no
 * storage.
 */

// The per-pass ordinal minter that lived here is gone (task 761): lint ids are
// now CONTENT ids (`assignContentIds`, src/lib/latex-errors.ts) and compile
// ids thread their own ordinal + per-run salt into `makeErrorId` directly.

/**
 * Drop any dismissed id that is no longer present in the live diagnostic set.
 *
 * Compile ids change across runs (per-run salt), and a lint id changes when
 * the error's own line is edited or fixed (task 761), so a stale dismissal
 * would otherwise linger forever and could accidentally hide a DIFFERENT card if an id were ever reused. Pruning against the live set both
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
