/**
 * "A live marker wins over declared intent" — applied at the SOURCE (task 704).
 *
 * An inline-atom card (footnote / citation) declares its absence from the prose
 * with sidecar flags: `archived` (set aside) and `unanchored` (parked, no atom).
 * Archiving sets both JOINTLY and splices the atom out with an ordinary,
 * undoable transaction — so the atom can come BACK without anything rewriting
 * the sidecar: Cmd+Z of the archive, a `\footnote` / `\cite` re-typed in the
 * code view, a paste. The flag then outlives the fact it declared, and every
 * flag-keyed consumer (`archivedIds` → the Omni filter, the margin markers, the
 * archive glyph + toggle; the Citations panel's Archives split; the citation
 * `syncFromEditor` merge) treats a LIVE atom as archived.
 *
 * The drop path already clears the flags when IT restores an atom
 * (`markAnchored`, task 233). This is the same clear for every other route,
 * derived rather than per-route: given the kind's refs and the ids of its atoms
 * that are live in the main document, return the refs whose intent is stale.
 * The caller hands each id to the kind's idempotent `markAnchored`.
 *
 * Pure and O(refs). The caller gates it on the STRUCTURAL counters
 * (`rev.footnotes` / `rev.citations`), which are silent on a plain keystroke —
 * never on the refs collection itself: archiving writes the flag in the same
 * handler that splices the atom, but the counter bump that removes the atom
 * from the live set is RAF-coalesced, so a refs-keyed reconcile would see the
 * flag before the atom left and un-archive the card it just archived.
 */

/** The fields of a footnote/citation ref this rule reads. */
export interface AtomIntentRef {
  id: string;
  archived?: boolean;
  unanchored?: boolean;
}

/** Ids of refs flagged archived/unanchored whose atom is live. */
export function staleAtomIntentIds(
  refs: readonly AtomIntentRef[],
  liveIds: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (const r of refs) {
    if ((r.archived || r.unanchored) && liveIds.has(r.id)) out.push(r.id);
  }
  return out;
}
