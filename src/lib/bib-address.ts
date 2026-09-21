/**
 * Addressing a bibliography entry across the two runs of a bib mutation
 * (task 690).
 *
 * ## The problem this module exists for
 *
 * Every `.bib` mutation in `useCitations` runs **twice** (`runBibMutation`):
 * once over the hook's in-memory view, so the UI never waits on a disk
 * round-trip, and once — the run that actually LANDS — over a fresh parse of
 * the file inside `mutateProjectBib`'s serialized write section. A mutator is
 * therefore a pure function that has to name the SAME entry in two separately
 * parsed lists.
 *
 * Until this module, all three mutators named it by its **citekey**:
 *
 * ```js
 * prev.map((e) => (e.key === key ? edited : e))
 * ```
 *
 * A citekey is neither unique nor durable, and both halves of that bite:
 *
 * - **Not unique.** `parseBibFile` deliberately yields two ordered entries for
 *   two blocks that share a citekey (its header: *"the basis for
 *   distinct-uid-per-block"*). A hand-merged or imported `references.bib`
 *   really does carry them. `prev.map` then rewrote **every** matching entry,
 *   so editing the one card the panel showed overwrote a second block the user
 *   could not see — its fields destroyed, silently, in the file the `.tex`
 *   cites.
 * - **Not durable.** It is the one field the rename door changes.
 *
 * ## Why the fix is not simply "match on `uid`"
 *
 * `BibEntry.uid` is the durable surrogate identity, round-tripped through
 * `\vbid{}` markers — but it is durable only once the file CARRIES the marker.
 * A markerless block (the normal state of a `references.bib` Virgil has never
 * written) is minted a brand-new uid by **every parse**, so a uid-matched
 * mutator matches the view and matches NOTHING on the disk run: the edit
 * silently does not land. That is exactly the defect task 689 found sitting
 * unreached behind a default-off flag, and it is the reason this module is a
 * LADDER rather than a field.
 *
 * ## The ladder
 *
 * A {@link BibEntryAddress} is taken from the list the user was looking at and
 * resolved against whatever list the mutator is handed. Each rung wins only
 * when it identifies EXACTLY ONE entry; otherwise the next rung answers:
 *
 * 1. **`uid`** — the durable address, right whenever the file carries the
 *    entry's marker, and right across a rename.
 * 2. **`source.start` + key** — the block's byte offset in the text it was
 *    parsed from. Two parses of the same bytes agree on it, which is precisely
 *    the case a bib mutation's two runs are in. The key is required to match
 *    too, so an offset that has SHIFTED (a peer write landed between the two
 *    runs) is rejected rather than silently addressing a neighbour.
 * 3. **key + ordinal** — the n-th entry carrying this citekey, in source
 *    order. This is what keeps two same-key blocks apart when neither a marker
 *    nor a stable offset is available.
 * 4. **key, when unique** — the legacy address, kept as the floor so a
 *    hand-built `BibEntry` with no uid and no source still resolves.
 *
 * Nothing here ever returns more than one index. That is the whole point: a
 * mutation addresses the entry the user edited, and only that entry.
 *
 * bib-display-exempt-file: non-display. This module handles identity
 * coordinates (uid, citekey, byte offset) on the WRITE path; no value here
 * reaches a pixel, and projecting one would put the projection on disk.
 */

import type { BibEntry } from "@/lib/types";

/**
 * A durable-as-possible coordinate for one entry, taken from the list it was
 * displayed in and resolvable against any later parse of the same file.
 */
export interface BibEntryAddress {
  /** The entry's `\vbid{}` uid. Durable across a rename; absent/volatile on a
   *  markerless block, which is why it is a rung and not the address. */
  uid?: string;
  /** The citekey AS IT STANDS at address time (for a rename: the OLD key). */
  key: string;
  /** 0-based ordinal among the entries sharing `key`, in source order. */
  keyOrdinal: number;
  /** Byte offset of the block head in the text the entry was parsed from. */
  sourceStart?: number;
}

/**
 * Take an address for `entry` from the list it belongs to.
 *
 * The list is needed only for the ordinal. `entry` is located by object
 * identity first (the common case — the card holds the very object the hook
 * published), then by uid, then by source offset, so an entry that has been
 * shallow-copied on its way through a prop still addresses its own block.
 */
export function bibAddressOf(entries: BibEntry[], entry: BibEntry): BibEntryAddress {
  let idx = entries.indexOf(entry);
  if (idx === -1 && entry.uid) idx = entries.findIndex((e) => e.uid === entry.uid);
  if (idx === -1 && entry.source) {
    idx = entries.findIndex((e) => e.source?.start === entry.source!.start);
  }
  // Count same-key entries that precede it. With no index to count up to
  // (a hand-built entry that is not in this list at all) the ordinal is 0 —
  // the floor rung then answers, exactly as the legacy key match did.
  let keyOrdinal = 0;
  if (idx > 0) {
    for (let i = 0; i < idx; i++) if (entries[i].key === entry.key) keyOrdinal++;
  }
  return {
    ...(entry.uid ? { uid: entry.uid } : {}),
    key: entry.key,
    keyOrdinal,
    ...(entry.source ? { sourceStart: entry.source.start } : {}),
  };
}

/** The index `address` names in `entries`, or `-1` when it names none. */
export function resolveBibEntryIndex(
  entries: BibEntry[],
  address: BibEntryAddress,
): number {
  // Rung 1 — the durable uid, when it is unambiguous in this list.
  if (address.uid) {
    const hits = indicesWhere(entries, (e) => e.uid === address.uid);
    if (hits.length === 1) return hits[0];
  }
  // Rung 2 — the block's own byte offset, guarded by the key so a SHIFTED
  // offset cannot address a neighbour.
  if (address.sourceStart !== undefined) {
    const hits = indicesWhere(
      entries,
      (e) => e.source?.start === address.sourceStart && e.key === address.key,
    );
    if (hits.length === 1) return hits[0];
  }
  // Rung 3 — the n-th block carrying this citekey, in source order.
  const sameKey = indicesWhere(entries, (e) => e.key === address.key);
  if (address.keyOrdinal < sameKey.length) return sameKey[address.keyOrdinal];
  // Rung 4 — the legacy floor: the only block with this key.
  if (sameKey.length === 1) return sameKey[0];
  return -1;
}

/** The entry `address` names, or `undefined`. */
export function resolveBibEntry(
  entries: BibEntry[],
  address: BibEntryAddress,
): BibEntry | undefined {
  const i = resolveBibEntryIndex(entries, address);
  return i === -1 ? undefined : entries[i];
}

/**
 * A mutator's answer for "the address names NO entry in this list" — told
 * apart from the mutator's own `null` = "nothing to change" (task 691).
 *
 * The two were one `null`, and the door reported both as `declined`: a silent,
 * unreconciled outcome, correct for "the disk already says what you asked for"
 * and wrong for "the entry you edited is not in the file". In the second case
 * the optimistic in-memory list keeps showing an edit that never landed — the
 * phantom task 685 exists to kill — and nothing ever corrects it, because only
 * `failed` re-reads. A mutator that MATCHED NOTHING is a write that did not
 * land on the user's content, so it is reported and reconciled like one.
 */
export const BIB_NO_MATCH = Symbol("bib-no-match");
export type BibNoMatch = typeof BIB_NO_MATCH;

/**
 * Apply `edit` to EXACTLY the entry `address` names, returning a new list —
 * or {@link BIB_NO_MATCH} when the address names none.
 *
 * This is the shape every bib mutator now takes: one index resolved, one
 * element replaced. The `prev.map(predicate)` it replaces could — and did —
 * rewrite several.
 */
export function mapAddressedBibEntry(
  entries: BibEntry[],
  address: BibEntryAddress,
  edit: (entry: BibEntry) => BibEntry,
): BibEntry[] | BibNoMatch {
  const i = resolveBibEntryIndex(entries, address);
  if (i === -1) return BIB_NO_MATCH;
  const next = entries.slice();
  next[i] = edit(entries[i]);
  return next;
}

function indicesWhere(entries: BibEntry[], pred: (e: BibEntry) => boolean): number[] {
  const out: number[] = [];
  for (let i = 0; i < entries.length; i++) if (pred(entries[i])) out.push(i);
  return out;
}
