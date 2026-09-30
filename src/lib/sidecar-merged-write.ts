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
import { mergeSidecarState } from "@/lib/sidecar-merge";

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
}

export function newMergeBase<S>(): MergeBase<S> {
  return { value: null };
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
 * The base advances to `next` — the SUBMITTED payload, never the merged result.
 * Disk then holds the union; memory still holds `next`. Re-basing to the union
 * would make the following write read an external record as "in base, absent
 * from local" — a DELETE — and the preservation would hold for one write.
 */
export async function writeSidecarMerged<S>(
  h: DocWriteHandle,
  filename: string,
  base: MergeBase<S>,
  next: S,
  migrate?: (raw: unknown) => S,
): Promise<void> {
  let advanced = false;
  let prior: S | null = null;
  try {
    await mutateSidecar<S | null>(h, filename, null, (current) => {
      prior = base.value;
      base.value = next;
      advanced = true;
      return mergeSidecarState<S>(
        filename,
        prior,
        current === null ? null : migrate ? migrate(current) : (current as S),
        next,
      );
    });
  } catch (err) {
    // Nothing landed: disk still holds what `prior` described. Roll back only
    // if no later write has moved the cell on — that write merged against our
    // payload, and its own landing (or rollback) now owns the cell.
    if (advanced && base.value === next) base.value = prior;
    throw err;
  }
}
