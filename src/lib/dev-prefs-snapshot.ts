/**
 * The personal-prefs snapshot's OWNERSHIP + MERGE rule (task 1487) — the pure
 * half of `/api/dev/sync-prefs`, kept out of the route so a test can drive it.
 *
 * `tools/personal-snapshot.json` is what `tools/promote-defaults.mjs` bakes
 * into SHIPPED defaults. It used to be written VERBATIM by whichever dev-server
 * browser POSTed last — an agent's preview pane included, with its own fresh
 * localStorage profile — so an agent's verification toggles could ship to
 * every user, and a POST missing a blob deleted that blob (editor-defaults
 * promotion silently stopped). The rule now:
 *
 *  - **One declared writer.** Every POST carries the posting browser's source
 *    id (minted by the mirror only in a profile that opted in through
 *    `virgil:prefs-mirror-source`). The first source to write an absent — or
 *    legacy, source-less — file CLAIMS it; a POST from any other source is
 *    REFUSED and the file is untouched. Transfer ownership by deleting the file.
 *  - **Per-blob merge, never replace.** A posted blob replaces only its own
 *    key and is stamped in `blobSavedAt`; a blob absent from the POST is KEPT
 *    with its older stamp. A claim starts fresh: a legacy file's blobs have no
 *    provenance, so none of them survive into the owner's snapshot.
 *  - Only registry keys (`MIRRORABLE_STORAGE_KEYS`) are accepted.
 *
 * File shape: the blobs stay at the TOP level keyed by storage key (what the
 * promoter reads), beside three meta keys — {@link SNAPSHOT_META_KEYS}.
 */

import { MIRRORABLE_STORAGE_KEYS } from "./dev-prefs-registry";

/** Top-level snapshot keys that are bookkeeping, not prefs blobs. */
export const SNAPSHOT_META_KEYS = ["source", "savedAt", "blobSavedAt"] as const;

/** The body the mirror POSTs. */
export interface SnapshotPost {
  source: string;
  blobs: Record<string, unknown>;
}

export type SnapshotPostResult =
  | { kind: "written"; next: Record<string, unknown>; claimed: boolean }
  | { kind: "refused"; status: 400 | 409; error: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Decide what a POST does to the snapshot. `existing` is the parsed file, or
 * `null` when there is none. Never throws.
 */
export function applySnapshotPost(
  existing: unknown,
  body: unknown,
  now: string,
): SnapshotPostResult {
  if (!isPlainObject(body)) {
    return { kind: "refused", status: 400, error: "expected object body" };
  }
  const { source, blobs } = body;
  if (typeof source !== "string" || source.trim() === "") {
    return {
      kind: "refused",
      status: 400,
      error: "missing source id — only a browser opted in via virgil:prefs-mirror-source may write the snapshot",
    };
  }
  if (!isPlainObject(blobs)) {
    return { kind: "refused", status: 400, error: "expected a `blobs` object" };
  }

  const owner = isPlainObject(existing) && typeof existing.source === "string"
    ? existing.source
    : null;
  if (owner !== null && owner !== source) {
    return {
      kind: "refused",
      status: 409,
      error:
        `snapshot is owned by source ${owner}; this browser is ${source}. ` +
        "Delete tools/personal-snapshot.json to transfer ownership.",
    };
  }

  const claimed = owner === null;
  const base: Record<string, unknown> = claimed ? {} : { ...(existing as Record<string, unknown>) };
  const stamps: Record<string, unknown> =
    !claimed && isPlainObject(base.blobSavedAt) ? { ...base.blobSavedAt } : {};
  for (const key of MIRRORABLE_STORAGE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(blobs, key)) continue;
    base[key] = blobs[key];
    stamps[key] = now;
  }
  return {
    kind: "written",
    claimed,
    next: { ...base, source, savedAt: now, blobSavedAt: stamps },
  };
}
