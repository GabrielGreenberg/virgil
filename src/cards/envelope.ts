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

/**
 * `carryCapturedPassage` — the second record-level fact no structural transform
 * MEANS to drop: a captured passage's TWO FORMS travel together.
 *
 * Task 488 gave every Mode-B capture a PAIR: `selectedText` (the plain
 * `doc.textBetween` string) and `selectedContent` (the RICH capture taken at
 * the same instant). They are not two fields — they are one capture in two
 * dialects, and `captured-passage.tsx` states why only the rich one can survive
 * a round trip: the plain string "drops marks and drops every inline ATOM
 * outright, so no render-time parse can recover them".
 *
 * The morph converters say this in prose at four sites ("a morph is not a
 * re-capture"). The four CLONE literals — `useCutter`/`useRevisions`
 * `cloneComment`/`cloneSuggestion` — carried `selectedText` and silently
 * dropped its twin, so a duplicated cut rendered its "Original" flat: italics,
 * math and citations demoted to raw source or gone, permanently, since nothing
 * downstream re-captures a clone (`bindAnchor` re-attaches the LINK, never the
 * card's capture). Task 694.
 *
 * So the pair is carried HERE, as a unit, and the clone literals no longer
 * name either half — carrying one without the other is not a thing they can
 * spell. Present-only, like `carryCardEnvelope`: an absent half stays absent
 * (a pre-488 record must not grow a `selectedContent: undefined` key its
 * sidecar shape never held).
 *
 * FILL, NEVER OVERRIDE: a literal that speaks for itself wins. The morph
 * converter `cutterSuggestionToComment` deliberately derives
 * `selectedText: s.selectedText ?? s.original_text`, and that fallback is the
 * transform's own salvage decision — this helper only supplies a half the
 * target left undefined.
 *
 * Generic over `T` like its sibling (same targeted-merge discipline, never a
 * blanket `...source` spread). A transform whose TARGET kind cannot hold a
 * capture (note / highlight / report / report-request) is safe by DATA rather
 * than by type: its source kind holds no capture either, so both halves are
 * undefined and nothing is written. `capture-pair-census.test.ts` derives that
 * correspondence from `types.ts` rather than trusting it.
 */
export function carryCapturedPassage<T>(
  source: { selectedText?: string; selectedContent?: unknown } | null | undefined,
  target: T,
): T {
  const t = target as { selectedText?: string; selectedContent?: unknown };
  const text = t?.selectedText === undefined ? source?.selectedText : undefined;
  const content = t?.selectedContent === undefined ? source?.selectedContent : undefined;
  if (text === undefined && content === undefined) return target;
  return {
    ...(target as object),
    ...(text === undefined ? {} : { selectedText: text }),
    ...(content === undefined ? {} : { selectedContent: content }),
  } as T;
}
