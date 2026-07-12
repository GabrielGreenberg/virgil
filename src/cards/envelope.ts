/**
 * `carryCardEnvelope` — the ONE place that preserves a card's record-level
 * "envelope" across any structural transform that rebuilds the card as a
 * hand-enumerated literal: a MORPH (via `applyCardMorph`, `cards/morphs/`) or a
 * CLONE (via the per-doc hooks' `clone*` functions in `useNotes`/`useRevisions`/
 * `useCutter`/`useReports`).
 *
 * Every such literal curates the exact field subset it carries, so any
 * record-level field the target shape CAN hold but the literal forgets is
 * silently dropped. `archived?: boolean` is the cross-cutting envelope field
 * none of these transforms MEANS to drop — every morphable/clonable card
 * interface carries it — yet an omitted `archived` reads as active, silently
 * un-archiving the card. That class was fixed piecemeal before:
 *   - morph path — task 072, at the `applyCardMorph` chokepoint;
 *   - clone path — task 076 (Notes, inline) then task 099 (revisions/cutter/
 *     reports, which surfaced that the clone path had NO chokepoint at all).
 * Carrying it here, at ONE shared chokepoint shared by morph AND clone, means
 * no present-or-future literal — nor any future record-level envelope field
 * added to this helper — can lose it.
 *
 * TARGETED merge, NOT a blanket `...source` spread: a full spread would leak
 * the stale wrong-shape fields the transform deliberately drops (a morph flips
 * the data kind; a clone resets `aiRequest`/`links`/suggestion `status`).
 */
export function carryCardEnvelope<T>(
  source: { archived?: boolean } | null | undefined,
  target: T,
): T {
  const archived = source?.archived;
  return archived ? ({ ...(target as object), archived } as T) : target;
}
