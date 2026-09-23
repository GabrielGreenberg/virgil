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
 * THE WRITE DOOR for a record-collection sidecar: a serialized
 * read-modify-MERGE, never a whole-snapshot rebuild.
 *
 * `mutateSidecar` runs the read INSIDE the same queued, doc-locked task as the
 * write, so the base the merge is computed against cannot be superseded between
 * the two halves — the guarantee `writeSidecar` never had.
 *
 * `migrate` matters more than it looks: the in-lock read is RAW, and the local
 * snapshot is migrated, so without it a raw on-disk record and its migrated
 * twin compare as an EDIT and the merge would adopt the raw one — silently
 * undoing the normalization a `persistMigrationOnLoad` had just written.
 *
 * A `null` current means the file is absent: there is nothing external to
 * preserve, so `next` is written as-is.
 */
export async function writeSidecarMerged<S>(
  h: DocWriteHandle,
  filename: string,
  base: S | null,
  next: S,
  migrate?: (raw: unknown) => S,
): Promise<void> {
  await mutateSidecar<S | null>(h, filename, null, (current) =>
    mergeSidecarState<S>(
      filename,
      base,
      current === null ? null : migrate ? migrate(current) : (current as S),
      next,
    ),
  );
}
