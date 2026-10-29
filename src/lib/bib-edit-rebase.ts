/**
 * A bib editor's Save is a DELTA against what the editor opened on, rebased
 * onto the entry as it is NOW (task 1359).
 *
 * The bib card's "Edit entry" seeds its fields, `@type` and citekey ONCE, when
 * the editor opens, and nothing re-seeds it while it is open. It used to hand
 * that whole map back as a set-all save — so anything another writer did to
 * the entry in the meantime (an `/editor/answer-bib-review` field fill, the
 * code pane, a peer window) was REVERTED: a field the agent added was absent
 * from the editor's map and therefore DELETED, a corrected `@type` went back,
 * a rename was renamed back. The file-level write was serialized and correct;
 * the ENTRY-level write persisted a snapshot computed earlier from state it
 * merely hoped was current — the very thing `project-bib.ts`'s header forbids.
 *
 * So the save is a three-way merge, per field and per head part:
 *
 *   - mine == seed  ⇒ the user did not touch it: the LIVE value stands
 *                     (including a field added since the seed, and a field
 *                     removed since the seed).
 *   - mine != seed  ⇒ the user changed it: their value lands — a field they
 *                     removed is DELETED (BIB-A3-02 still holds) — unless the
 *                     live value ALSO moved away from the seed to something
 *                     else. That is a true CONFLICT, and it is REFUSED with a
 *                     reason naming the parts, rather than either side
 *                     silently winning.
 *
 * Pure: it runs inside both runs of a bib mutation (the optimistic view and the
 * serialized disk run), so it closes over nothing and reads nothing.
 *
 * bib-display-exempt-file: non-display. These are RAW field bytes on the WRITE
 * path; nothing here reaches a pixel, and projecting a value would put the
 * projection on disk.
 */

/** The parts of an entry the bib editor edits. */
export interface BibEditState {
  key: string;
  type: string;
  fields: Record<string, string>;
}

export type BibEditRebase =
  | ({ ok: true } & BibEditState)
  | { ok: false; conflicts: string[]; reason: string };

/** Three-way pick for one value; `CONFLICT` when both sides moved apart. */
const CONFLICT = Symbol("conflict");
function pick<T>(seed: T, mine: T, live: T): T | typeof CONFLICT {
  if (mine === seed) return live;
  if (live === seed || live === mine) return mine;
  return CONFLICT;
}

/** The sentence a refused save gives the person who pressed it. */
export function bibEditConflictReason(conflicts: readonly string[]): string {
  const named = conflicts.map((c) => `“${c}”`).join(", ");
  const noun = conflicts.length === 1 ? "was" : "were";
  return (
    `${named} ${noun} also changed outside this editor while you were editing ` +
    `(by an agent, the code view or another window), so nothing was saved. ` +
    `Your edits are still here — compare them with the entry and save again.`
  );
}

/**
 * Rebase the editor's state (`mine`, edited from `seed`) onto `live`.
 * Conflicts are named `@type`, `citekey`, or the field name.
 */
export function rebaseBibEdit(
  seed: BibEditState,
  mine: BibEditState,
  live: BibEditState,
): BibEditRebase {
  const conflicts: string[] = [];

  const type = pick(seed.type, mine.type, live.type);
  if (type === CONFLICT) conflicts.push("@type");
  const key = pick(seed.key, mine.key, live.key);
  if (key === CONFLICT) conflicts.push("citekey");

  const fields: Record<string, string> = {};
  // Live order first, so an untouched entry keeps its field order; then any
  // field only the user (or only the seed) names.
  const names = new Set([
    ...Object.keys(live.fields),
    ...Object.keys(mine.fields),
    ...Object.keys(seed.fields),
  ]);
  for (const name of names) {
    const v = pick<string | undefined>(
      own(seed.fields, name),
      own(mine.fields, name),
      own(live.fields, name),
    );
    if (v === CONFLICT) conflicts.push(name);
    else if (v !== undefined) fields[name] = v;
  }

  if (conflicts.length > 0) {
    return { ok: false, conflicts, reason: bibEditConflictReason(conflicts) };
  }
  return { ok: true, key: key as string, type: type as string, fields };
}

function own(map: Record<string, string>, name: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(map, name) ? map[name] : undefined;
}
