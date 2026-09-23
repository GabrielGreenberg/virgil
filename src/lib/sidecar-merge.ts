/**
 * **The sidecar MERGE authority** (task 719) — "a write is a SPLICE, never a
 * rebuild", stated once for every record-collection sidecar.
 *
 * ## The class this closes
 *
 * A `virgil/*.json` sidecar has TWO writers: the app (whole-snapshot, debounced)
 * and the out-of-process `/editor/*` skills (read-modify-write, straight on
 * disk). Task 220 gave `ai-requests.json` a serialized read-modify-merge
 * authority; task 558 gave `references.bib` one. Every OTHER sidecar kept the
 * whole-snapshot write — and its live consequence was not "the app wins a race",
 * it was silent DELETION:
 *
 * 1. The user has an unsaved edit in `reports.json` (one keystroke arms the
 *    300 ms debounce).
 * 2. A skill appends the AI's answer card to the same file.
 * 3. The watcher emits; `usePersistentState`'s dirty guard defers (correctly —
 *    it must not stomp the unsaved edit).
 * 4. The debounced write lands the local snapshot, which does not contain the
 *    agent's card, OVER the file — and re-baselines the disk ledger to our
 *    bytes, so the watcher's next poll emits nothing.
 *
 * The agent's report is gone from disk, and the `ai-requests.json` row still
 * reads `complete`, so the work is unrepeatable. What the user sees is a report
 * they asked for that simply never appeared.
 *
 * ## The rule: a THREE-WAY merge, not a union
 *
 * A two-way union (keep everything either side has) gets exactly one case
 * wrong, and it is the common one: a record the user DELETED is on disk and
 * absent from memory, so a union resurrects it on the next write. Deletion is
 * therefore not inferred from absence — it is derived from a **base**, the last
 * content this instance knows the file held (its load, its last adopted
 * external read, or its own last submitted payload). With a base, "absent from
 * local" splits into the two things it actually means:
 *
 * | in base | on disk | in local | verdict                                   |
 * |---------|---------|----------|-------------------------------------------|
 * |    ·    |    ·    |    ✓     | local insert → keep                       |
 * |    ·    |    ✓    |    ·     | EXTERNAL insert → keep (the traced bug)   |
 * |    ✓    |    ✓    |    ·     | local DELETE → honour, drop               |
 * |    ✓    |    ·    |    ✓     | external delete → honour iff local == base|
 * |    ✓    |    ✓    |    ✓     | local == base → adopt disk; else local    |
 *
 * The last row is the one that makes an external EDIT survive as well as an
 * external insert: a record the user has not touched since the base adopts
 * whatever disk now says, and only a record they HAVE touched takes the local
 * version (their unsaved edit is the newer intent).
 *
 * ## Where the base comes from, and why it is the SUBMITTED payload
 *
 * After a merged write, disk holds the UNION and memory still holds the local
 * snapshot. The base is set to what we SUBMITTED, never to the merged result —
 * otherwise the next write would read the external record as "in base, absent
 * from local" and delete it, and the fix would hold for exactly one write.
 * Memory converges separately, through the watcher re-read (which merges the
 * same way).
 *
 * ## What is declared and what is derived
 *
 * Only the RECORD COLLECTIONS are declared ({@link SIDECAR_COLLECTIONS}): which
 * top-level key holds an array of records, and which field identifies one. A
 * shape heuristic ("an array of objects with an `id`") was rejected for the
 * reason task 718 demoted its own: it is provably ambiguous, and this table is
 * cheap and total. Everything else is derived structurally — nested objects
 * merge key-wise (so `annotations.json`'s uid→html map and
 * `document-settings.json`'s arbitrary agent-written keys merge per key), and a
 * scalar takes the local value unless local is unchanged from base, in which
 * case it adopts disk.
 *
 * ## One door, four callers
 *
 * `writeSidecarMerged` ([sidecar-merged-write.ts](sidecar-merged-write.ts)) is
 * the only way a sidecar hook writes a record collection: `usePersistentState`
 * (fourteen files) plus the three hooks with their own bespoke persist —
 * `useFootnotes`, `useExamples`, `useBibReview`. Each supplies the base it has
 * been tracking; nothing else about the merge is re-derived per hook, which is
 * the difference between this and a third one-file fix beside 220 and 558.
 *
 * The RULE lives here and imports NOTHING, for the same reason
 * `sidecar-value.ts` does not: it is read by the hooks, by the door and by the
 * tests, and a leaf cannot be refused by any of them. The DOOR is a separate
 * module because it reaches the storage barrel, which a pure rule must not drag
 * behind it.
 */


/**
 * One record collection inside a sidecar's top-level object.
 *
 * `idFields` is a COMPOSITE key (joined in order), because not every record
 * carries an `id`: `orphaned-footnotes.json` identifies by `footnoteId`, and
 * `bib-review-requests.json` by `(bibKey, type)` — `bibKey` is kept as a mirror
 * even when `entryUid` is set, so the pair is total over the population. An
 * EMPTY `idFields` means the record IS its own identity (a bare string list,
 * which is what `dictionary.json` holds).
 */
export interface SidecarCollectionSpec {
  /** Top-level key holding the array of records. */
  readonly key: string;
  /** Fields whose joined values identify a record; empty = value identity. */
  readonly idFields: readonly string[];
}

/**
 * Every CONTENT-tier sidecar's record collections.
 *
 * Total over the content tier of `sidecar-value.ts` — CI pins it
 * ([sidecar-merge.test.ts](__tests__/sidecar-merge.test.ts)), so a new content
 * sidecar cannot be added without deciding what one of its records IS. An empty
 * array is a real answer, not an omission: `annotations.json` and
 * `document-settings.json` are key→value maps with no record list, and they
 * merge key-wise by the structural rule.
 *
 * `ai-requests.json` is the one content sidecar deliberately ABSENT: its
 * serialized authority has been `ai-requests-store.ts` since task 220, and that
 * task's own census forbids any other production file from even spelling the
 * filename. `virgil.json` is present with no collection because it is written
 * by the doc BUNDLE rather than by a sidecar hook.
 *
 * A `legacy` row (`sidecar-value.ts`) is absent by DERIVATION, not by hand:
 * nothing writes the file, so there is no write to merge. The totality leg
 * subtracts those rows itself, so retiring a sidecar never means remembering
 * to delete a merge rule (task 726).
 */
export const SIDECAR_COLLECTIONS: Readonly<
  Record<string, readonly SidecarCollectionSpec[]>
> = Object.freeze({
  // uid → html and citekey → html maps; no record list. Merged key-wise.
  "annotations.json": [],
  "archive.json": [{ key: "snippets", idFields: ["id"] }],
  "bib-review-requests.json": [
    { key: "requests", idFields: ["bibKey", "type"] },
  ],
  "bib-settings.json": [{ key: "entryRequests", idFields: ["id"] }],
  "citations.json": [{ key: "citations", idFields: ["id"] }],
  "cutter.json": [{ key: "cards", idFields: ["id"] }],
  // A bare list of accepted terms: the term is its own identity.
  "dictionary.json": [{ key: "words", idFields: [] }],
  // `{ styleId }` plus whatever `apply_response.py`'s `settingsEdit` parks
  // beside it (task 715). No record list; the structural key merge is the whole
  // answer, and it is why an agent-written key now survives a concurrent save.
  "document-settings.json": [],
  "footnotes.json": [{ key: "footnotes", idFields: ["id"] }],
  "notes.json": [{ key: "cards", idFields: ["id"] }],
  "orphaned-footnotes.json": [{ key: "orphans", idFields: ["footnoteId"] }],
  "reports.json": [{ key: "cards", idFields: ["id"] }],
  "revisions.json": [{ key: "cards", idFields: ["id"] }],
  "suggestions.json": [{ key: "suggestions", idFields: ["id"] }],
  "todos.json": [{ key: "items", idFields: ["id"] }],
  // Paragraph UUIDs + per-block titles. Written by `writeDocBundle` (one write
  // per bundle write), not by a sidecar hook, so no collection is claimed here.
  "virgil.json": [],
});

/** The collections declared for a file; `[]` for an undeclared one, which
 *  means the structural key merge still runs but no array is identity-merged
 *  (it takes the local-vs-base scalar rule instead — the safe fallback). */
export function sidecarCollections(
  filename: string,
): readonly SidecarCollectionSpec[] {
  return SIDECAR_COLLECTIONS[filename] ?? [];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Structural equality over JSON values. Key ORDER is not identity here (a
 *  `JSON.stringify` comparison would call a re-keyed but identical record an
 *  edit and take the local copy over a genuine external change). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a !== "object") return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => k in bo && deepEqual(ao[k], bo[k]));
}

/** The composite identity of one record, or null when it cannot be identified
 *  (a missing/non-scalar key field). An unidentifiable record is never matched
 *  across sides — it is carried, not merged. */
function recordId(
  record: unknown,
  idFields: readonly string[],
): string | null {
  if (idFields.length === 0) {
    return typeof record === "string" || typeof record === "number"
      ? `v:${String(record)}`
      : null;
  }
  if (!isPlainObject(record)) return null;
  const parts: string[] = [];
  for (const f of idFields) {
    const v = record[f];
    if (typeof v !== "string" && typeof v !== "number") return null;
    parts.push(String(v));
  }
  return parts.join("\u0000");
}

function indexById(
  list: readonly unknown[] | null,
  idFields: readonly string[],
): Map<string, unknown> | null {
  if (list === null) return null;
  const map = new Map<string, unknown>();
  for (const rec of list) {
    const id = recordId(rec, idFields);
    if (id !== null && !map.has(id)) map.set(id, rec);
  }
  return map;
}

/**
 * Three-way merge of one record collection. Order is LOCAL's, with external
 * inserts appended in disk order — which is where an agent's append already
 * sits, and it keeps the user's own ordering untouched.
 *
 * A record neither side can identify (no id field, or a non-scalar one) is
 * carried from BOTH sides, de-duplicated by value: duplication is recoverable
 * and loss is not, and the alternative — dropping what cannot be matched — is
 * the defect this module exists to close.
 */
export function mergeRecordList(
  base: readonly unknown[] | null,
  disk: readonly unknown[],
  local: readonly unknown[],
  idFields: readonly string[],
): unknown[] {
  const baseById = indexById(base, idFields);
  const diskById = indexById(disk, idFields)!;
  const out: unknown[] = [];
  const emitted = new Set<string>();
  const unidentifiedLocal: unknown[] = [];

  for (const rec of local) {
    const id = recordId(rec, idFields);
    if (id === null) {
      unidentifiedLocal.push(rec);
      out.push(rec);
      continue;
    }
    if (emitted.has(id)) continue;
    emitted.add(id);
    const baseRec = baseById?.get(id);
    const untouched = baseById?.has(id) === true && deepEqual(rec, baseRec);
    if (!diskById.has(id)) {
      // Gone from disk. An external DELETE, unless the user has an unsaved edit
      // to it — an edit outlives a remote delete, because re-deleting is one
      // gesture and re-typing the edit is not.
      if (untouched) continue;
      out.push(rec);
      continue;
    }
    out.push(untouched ? diskById.get(id) : rec);
  }

  for (const rec of disk) {
    const id = recordId(rec, idFields);
    if (id === null) {
      if (!unidentifiedLocal.some((l) => deepEqual(l, rec))) out.push(rec);
      continue;
    }
    if (emitted.has(id)) continue;
    emitted.add(id);
    // On disk, absent from local. In the base → the user DELETED it, honour
    // that. Not in the base → an EXTERNAL INSERT, which is the agent's card.
    if (baseById?.has(id) === true) continue;
    out.push(rec);
  }

  return out;
}

/** Key-wise three-way merge of two plain objects (a uid→html map, a nested
 *  settings object). Same verdict table as the record merge, with the object
 *  key as the identity. */
function mergeObject(
  base: Record<string, unknown> | null,
  disk: Record<string, unknown>,
  local: Record<string, unknown>,
  collections: readonly SidecarCollectionSpec[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const byKey = new Map(collections.map((c) => [c.key, c]));
  const keys = new Set([...Object.keys(disk), ...Object.keys(local)]);
  for (const key of keys) {
    const hasBase = base !== null && key in base;
    const baseVal = hasBase ? base![key] : undefined;
    if (!(key in local)) {
      // Absent from local: a deliberate removal iff the base had it.
      if (hasBase) continue;
      out[key] = disk[key];
      continue;
    }
    const localVal = local[key];
    if (!(key in disk)) {
      out[key] = localVal;
      continue;
    }
    const diskVal = disk[key];
    const spec = byKey.get(key);
    if (spec && Array.isArray(localVal) && Array.isArray(diskVal)) {
      out[key] = mergeRecordList(
        Array.isArray(baseVal) ? baseVal : null,
        diskVal,
        localVal,
        spec.idFields,
      );
      continue;
    }
    if (isPlainObject(localVal) && isPlainObject(diskVal)) {
      // Nested maps merge key-wise; no collection is declared below the top
      // level, so the recursion carries none.
      out[key] = mergeObject(
        isPlainObject(baseVal) ? baseVal : null,
        diskVal,
        localVal,
        [],
      );
      continue;
    }
    // Scalar (or an array with no declared identity): the local value wins
    // unless local is unchanged from the base, in which case disk's newer
    // value is adopted.
    out[key] = hasBase && deepEqual(localVal, baseVal) ? diskVal : localVal;
  }
  return out;
}

/**
 * THE DOOR. Merge the local snapshot with what is on disk, against the base
 * this instance last knew disk to hold.
 *
 * - `disk === null` — the file is absent. Nothing external exists, so the local
 *   snapshot is written as-is.
 * - `base === null` — this instance never learned what disk held (a read that
 *   THREW). No deletion can be derived, so the merge degrades to a UNION with
 *   local winning every collision: still strictly better than the whole-snapshot
 *   overwrite it replaces, and it cannot delete what it cannot account for.
 * - A non-object top level (a hand-written bare array) is not merged: local wins.
 */
export function mergeSidecarState<S>(
  filename: string,
  base: S | null | undefined,
  disk: S | null | undefined,
  local: S,
): S {
  if (disk === null || disk === undefined) return local;
  if (!isPlainObject(disk) || !isPlainObject(local)) return local;
  const baseObj =
    base === null || base === undefined || !isPlainObject(base) ? null : base;
  return mergeObject(
    baseObj,
    disk,
    local,
    sidecarCollections(filename),
  ) as unknown as S;
}
