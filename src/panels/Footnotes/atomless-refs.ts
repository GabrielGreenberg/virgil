/**
 * Which `footnotes.json` refs are genuinely ATOMLESS — the SSOT behind the
 * Footnotes panel's third card kind (`UnanchoredFootnoteCard`, docked + omni).
 *
 * Task 233. This used to be an inline `refs.filter(f => f.archived || f.unanchored)`
 * in `EditorPane`, i.e. a pure read of the sidecar's *declared intent*. That is
 * exactly the mistake `resolveAnchorState` exists to prevent:
 *
 *   > A live position wins unconditionally: a card with a marker IS anchored,
 *   > even if it also (stale-y) carries `unanchored: true`.
 *
 * A footnote is unusual in that its anchored and atomless views come from
 * DIFFERENT sources — anchored from the live editor (`getFootnotes()`), atomless
 * from the sidecar — so intent-only filtering doesn't merely mislabel a card, it
 * renders the same footnote TWICE: live in the prose and again as a parked
 * duplicate. (The citation twin iterates one list and resolves a position per
 * entry, so it can't produce a duplicate; that asymmetry is why only this side
 * needed the law spelled out.)
 *
 * The flag outlives the atom's return in several ordinary ways: re-placing an
 * unanchored card with the drop button, undoing an archive (Cmd+Z restores the
 * spliced-out atom; nothing rewrites the sidecar), a `\footnote` re-typed in the
 * code view, a paste. The drop path also clears the flag at its source
 * (`useFootnotes.markAnchored`); this derivation is the one that cannot be
 * bypassed.
 *
 * **It suppresses the duplicate render; it does not rewrite the sidecar.** The
 * sidecar is healed at the source by the live-atom intent reconcile
 * (`staleAtomIntentIds` in `src/links/_shared/live-atom-intent.ts`, run by
 * `EditorPane` on the structural counters, task 704), which clears the stale
 * flag through `markAnchored` so `archivedIds` and every other flag-keyed
 * consumer agree. This selector stays as the belt for the window between the
 * atom's return and that reconcile's write.
 */

import type { FootnoteRef } from "@/lib/types";

/** A live footnote atom, as `EditorHandle.getFootnotes()` reports it. */
export interface LiveFootnoteAtom {
  footnoteId: string;
}

/**
 * The atomless refs: flagged `archived` or `unanchored` AND absent from the
 * live atom list. Order-preserving; allocates one Set per call, so callers
 * should memoize on their structural inputs (never on a keystroke counter).
 */
export function selectAtomlessFootnoteRefs(
  refs: readonly FootnoteRef[],
  liveAtoms: readonly LiveFootnoteAtom[],
): FootnoteRef[] {
  const liveIds = new Set(liveAtoms.map((f) => f.footnoteId));
  return refs.filter((f) => (f.archived || f.unanchored) && !liveIds.has(f.id));
}
