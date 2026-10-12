/**
 * The serialized read-modify-MERGE write door for a record-collection sidecar
 * (task 719).
 *
 * Split from [sidecar-merge.ts](sidecar-merge.ts) — which states the merge RULE
 * and imports nothing — because this half reaches the storage barrel, and a
 * pure rule must not drag that behind it.
 */
import { mutateSidecar } from "@/lib/storage";
import type { DocWriteHandle } from "@/lib/multi-window/doc-pipeline";
import { deepEqual, mergeSidecarState } from "@/lib/sidecar-merge";

/**
 * THE MERGE BASE, as a cell the write door advances (task 849).
 *
 * `value` is what this instance last knew the file to hold — its load, its last
 * adopted external re-read, or its own last written payload. It is a CELL, not
 * a value passed by the caller, because WHEN it is read decides the verdict.
 * Read at submit time (task 719's shape) it is stale whenever a write is still
 * queued: persist(s1) adds card Y and is in flight, persist(s2) deletes Y, and
 * s2 — still merging against the pre-s1 base — finds Y "not in base, on disk"
 * and keeps it as an EXTERNAL INSERT. The deleted card is back on disk, and a
 * revert of a field s1 changed reads as "untouched" and is lost the same way.
 *
 * So the door reads the cell INSIDE the doc lock, where writes run one at a
 * time in submission order, and advances it there to the payload it is about
 * to write — the next queued write then merges against exactly what the
 * previous one wrote. A write that then FAILS rolls the cell back (unless a
 * later write has already moved it on).
 *
 * One cell per DOCUMENT: a hook mints a fresh one on every doc switch
 * ({@link newMergeBase}), and a write captures its cell at submit — so doc A's
 * cleanup flush, landing after doc B's load, advances A's dead cell and never
 * poisons B's base.
 */
export interface MergeBase<S> {
  value: S | null;
  /**
   * THE WRITE GENERATION (task 1078): bumped SYNCHRONOUSLY each time a write is
   * submitted to {@link writeSidecarMerged}, before it queues. Two questions
   * read it, and neither can be answered from `value` alone, because `value`
   * only moves once a write is INSIDE the lock:
   *
   * - "is my write still the newest?" — {@link convergeOnWrite} adopts what a
   *   write absorbed only for the LAST submitted write; an older one leaves it
   *   to the newer, which merged against its disk and will adopt the union;
   * - "did a write start while my read was in flight?" — an external re-read
   *   that began before a write and resolves after it holds pre-write disk, and
   *   merging it would read the user's just-saved insert as an external delete.
   */
  submits: number;
}

export function newMergeBase<S>(): MergeBase<S> {
  return { value: null, submits: 0 };
}

/** What {@link writeSidecarMerged} landed, and which submission it was. */
export interface MergedWrite<S> {
  /** The merged value now on disk; null when the layer below wrote nothing. */
  wrote: S | null;
  /** This write's {@link MergeBase.submits} generation. */
  ticket: number;
}

/**
 * THE WRITE DOOR for a record-collection sidecar: a serialized
 * read-modify-MERGE, never a whole-snapshot rebuild.
 *
 * `mutateSidecar` runs the read INSIDE the same queued, doc-locked task as the
 * write, so the base the merge is computed against cannot be superseded between
 * the two halves — the guarantee `writeSidecar` never had. The base itself is
 * read there too, from `base` (see {@link MergeBase}).
 *
 * `migrate` matters more than it looks: the in-lock read is RAW, and the local
 * snapshot is migrated, so without it a raw on-disk record and its migrated
 * twin compare as an EDIT and the merge would adopt the raw one — silently
 * undoing the normalization a `persistMigrationOnLoad` had just written.
 *
 * A `null` current means the file is absent: there is nothing external to
 * preserve, so `next` is written as-is.
 *
 * The base advances to `next` — the SUBMITTED payload — inside the lock, and
 * the write RETURNS what it wrote (task 1078). Disk then holds the union and
 * memory still holds `next`; the caller hands both to {@link convergeOnWrite},
 * which re-bases to the union only together with putting the union in memory.
 * (Re-basing alone would make the following write read an external record as
 * "in base, absent from local" — a DELETE.) Until 1078 nothing did: the write
 * stamped the disk ledger, so the SidecarWatcher never reported what the merge
 * had absorbed, and an agent's card sat on disk invisible until reopen — and
 * an agent's EDIT to a record was reverted by the user's next edit of it.
 */
export async function writeSidecarMerged<S>(
  h: DocWriteHandle,
  filename: string,
  base: MergeBase<S>,
  next: S,
  migrate?: (raw: unknown) => S,
): Promise<MergedWrite<S>> {
  const ticket = ++base.submits;
  let advanced = false;
  let prior: S | null = null;
  try {
    const wrote = await mutateSidecar<S | null>(h, filename, null, (current) => {
      // FIRST run only: `mutateSidecar` re-runs this on a fresh base when a
      // foreign writer moved the file (task 979), and by then the cell already
      // holds `next` — re-capturing would make `next` its own base and the
      // merge could no longer tell a local delete from an external append.
      if (!advanced) {
        prior = base.value;
        base.value = next;
        advanced = true;
      }
      return mergeSidecarState<S>(
        filename,
        prior,
        current === null ? null : migrate ? migrate(current) : (current as S),
        next,
      );
    });
    return { wrote, ticket };
  } catch (err) {
    // Nothing landed: disk still holds what `prior` described. Roll back only
    // if no later write has moved the cell on — that write merged against our
    // payload, and its own landing (or rollback) now owns the cell.
    if (advanced && base.value === next) base.value = prior;
    throw err;
  }
}

/**
 * THE CONVERGENCE DOOR (task 1078) — "make memory agree with what a write just
 * put on disk", stated once beside the one write door.
 *
 * A merged write can land MORE than memory holds: whatever an out-of-process
 * writer (a skill) committed since this instance's base is folded in by the
 * merge. Both I/Os stamp the disk ledger, so the SidecarWatcher will never
 * report it — this is the only moment anyone knows it happened. So: where the
 * write landed something other than what memory was showing (`shown`), adopt
 * it the way the watcher re-read does — the written value becomes the BASE and
 * is MERGED into memory (base = `shown`, disk = `wrote`, local = whatever
 * memory holds now), so an edit the user made meanwhile survives and the
 * absorbed records appear.
 *
 * Re-basing to the union is correct HERE, and was not before, because memory
 * gets the union in the same step: the next write's local snapshot then
 * carries the external records, so "in base, absent from local" again means
 * what it says — a local delete.
 *
 * Only when this cell still describes `shown`, and only for the NEWEST
 * submission: a later write (`submits` moved) merged against this one's disk
 * and will converge to its own union; an external re-read or a doc switch
 * (a fresh cell, `value` moved) owns the base from then on. The CALLER checks
 * what this function cannot see — that `cell` is still its live cell and that
 * no write is ARMED but unsubmitted (an armed payload predates the adoption,
 * would lack the absorbed records, and would delete them — it will converge
 * itself once submitted).
 *
 * Callers: every sidecar hook's persist ({@link writeSidecarMerged}'s return)
 * and `usePersistentState`'s open-time write-back (task 979).
 */
export function convergeOnWrite<S>(
  filename: string,
  cell: MergeBase<S>,
  ticket: number,
  shown: S,
  wrote: S | null,
  apply: (fn: (prev: S) => S) => void,
): boolean {
  if (wrote === null) return false;
  if (cell.submits !== ticket || cell.value !== shown) return false;
  if (deepEqual(wrote, shown)) return false;
  cell.value = wrote;
  apply((prev) => mergeSidecarState<S>(filename, shown, wrote, prev));
  return true;
}
