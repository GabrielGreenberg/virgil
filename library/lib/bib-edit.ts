// Frontend helpers for queueing bib edits and AI reviews.
//
// The frontend never writes master.bib directly (cowork constraint). Edits
// land in queue/ as JSON intent files; the matching skill drains them and
// applies the changes to master.bib + .virgil/catalog.json + bumps the version
// counter so other clients reload.

import {
  writeQueueEntry,
  addPendingReview,
  removePendingReview,
  normalizeQueueEntry,
  type QueueEntry,
  type BibEditPayload,
} from "./queue";
import { deleteFile, readJsonFile, SUBDIRS } from "./library-storage";

// READS live in `queue-state-store.ts`, not here. This module owns the WRITE
// half (enqueue / cancel); "is X queued?" is answered for every surface from
// the store's one polled directory scan, because a per-kind read helper called
// from a component is exactly how the header ended up frozen on a snapshot of
// the queue taken at mount time (task 132).

/** Enqueue a manual bib edit. The skill `/apply-bib-edit` consumes this. */
export async function queueBibEdit(
  root: FileSystemDirectoryHandle,
  citekey: string,
  payload: BibEditPayload,
): Promise<string> {
  const entry: QueueEntry = {
    kind: "bib-edit",
    status: "requested",
    citekey,
    requestedAt: new Date().toISOString(),
    attempts: 0,
    bibEdit: payload,
  };
  return writeQueueEntry(root, entry);
}

/** Enqueue an AI review of the bib entry. Reuses `/authenticate-bib`,
 *  which now does the three-tier progressive web search.
 *
 *  When `note` is supplied the skill should treat the request as a
 *  user-authored AI request (handled by /ai-requests) — i.e. follow the
 *  note rather than running a stock authenticate pass. */
export async function queueBibReview(
  root: FileSystemDirectoryHandle,
  citekey: string,
  note?: string,
): Promise<string> {
  const requestedAt = new Date().toISOString();
  const entry: QueueEntry = {
    kind: "authenticate",
    status: "requested",
    citekey,
    requestedAt,
    attempts: 0,
    ...(note && note.trim().length > 0 ? { note: note.trim() } : {}),
  };
  const filename = await writeQueueEntry(root, entry);
  await addPendingReview(root, citekey, requestedAt);
  return filename;
}

/** Enqueue a user-authored AI request scoped to the paper text
 *  (papers/<citekey>/main.tex linearization). Drained by /ai-requests. */
export async function queuePaperReview(
  root: FileSystemDirectoryHandle,
  citekey: string,
  note?: string,
): Promise<string> {
  const trimmed = note?.trim() ?? "";
  const entry: QueueEntry = {
    kind: "paper-review",
    status: "requested",
    citekey,
    requestedAt: new Date().toISOString(),
    attempts: 0,
    ...(trimmed.length > 0 ? { note: trimmed } : {}),
  };
  return writeQueueEntry(root, entry);
}

/** Enqueue a standard index request. Shares `queue/<citekey>.json` with
 *  `authenticate` (the bib review), so whichever was written last owns the
 *  slot — which is why every writer re-reads the queue afterwards instead of
 *  assuming its own write is the whole truth. */
export async function queueIndex(
  root: FileSystemDirectoryHandle,
  citekey: string,
  note?: string,
): Promise<string> {
  const trimmed = note?.trim() ?? "";
  const entry: QueueEntry = {
    kind: "index",
    status: "requested",
    citekey,
    requestedAt: new Date().toISOString(),
    attempts: 0,
    ...(trimmed.length > 0 ? { note: trimmed } : {}),
  };
  return writeQueueEntry(root, entry);
}

/** Cancel a queued index request by deleting its queue file — but only while
 *  the shared slot still holds a pending `index`. Refuses to touch an
 *  in-flight entry or an `authenticate` that took the slot (the mirror of
 *  `cancelBibReview`'s guard). */
export async function cancelIndex(
  root: FileSystemDirectoryHandle,
  citekey: string,
): Promise<boolean> {
  const path = `${SUBDIRS.queue}/${citekey}.json`;
  const cur = await readJsonFile<QueueEntry>(root, path);
  if (!cur) return false;
  if (cur.kind !== "index") return false;
  if (cur.status !== "requested") return false;
  await deleteFile(root, path);
  return true;
}

/** Enqueue a delete request. The handling skill is expected to remove the
 *  paper folder (papers/<citekey>/, which now contains both the source
 *  file and the derived artifacts), the bib block in master.bib, and the
 *  catalog row — then bump .virgil/catalog-version.txt. The frontend never
 *  deletes those itself (cowork constraint). */
export async function queueDelete(
  root: FileSystemDirectoryHandle,
  citekey: string,
): Promise<string> {
  const entry: QueueEntry = {
    kind: "delete",
    status: "requested",
    citekey,
    requestedAt: new Date().toISOString(),
    attempts: 0,
  };
  return writeQueueEntry(root, entry);
}

/** Cancel a queued paper-review request by deleting its queue file. */
export async function cancelPaperReview(
  root: FileSystemDirectoryHandle,
  citekey: string,
): Promise<boolean> {
  const path = `${SUBDIRS.queue}/${citekey}-paperreview.json`;
  const cur = await readJsonFile<QueueEntry>(root, path);
  if (!cur) return false;
  if (cur.kind !== "paper-review") return false;
  if (cur.status !== "requested") return false;
  await deleteFile(root, path);
  return true;
}

/** Enqueue an "import bibliography" request — fold this paper's
 *  references.bib into the central master.bib. Drained by
 *  `/library/import-bib` (single-paper slice of `/library/merge-bibs`).
 *  An optional `note` lets the user attach instructions; surfaced by
 *  `/library/ai-requests`. */
export async function queueImportBib(
  root: FileSystemDirectoryHandle,
  citekey: string,
  note?: string,
): Promise<string> {
  const trimmed = note?.trim() ?? "";
  const entry: QueueEntry = {
    kind: "import-bib",
    status: "requested",
    citekey,
    requestedAt: new Date().toISOString(),
    attempts: 0,
    ...(trimmed.length > 0 ? { note: trimmed } : {}),
  };
  return writeQueueEntry(root, entry);
}

/** Cancel a queued import-bib request by deleting its queue file. */
export async function cancelImportBib(
  root: FileSystemDirectoryHandle,
  citekey: string,
): Promise<boolean> {
  const path = `${SUBDIRS.queue}/${citekey}-importbib.json`;
  const cur = await readJsonFile<QueueEntry>(root, path);
  if (!cur) return false;
  if (cur.kind !== "import-bib") return false;
  if (cur.status !== "requested") return false;
  await deleteFile(root, path);
  return true;
}

/** Cancel a previously queued AI review by deleting its queue file —
 *  but only if the file is still a pending `authenticate` request.
 *  Refuses to delete an in-flight or unrelated entry (e.g. a queued
 *  `index` for the same citekey). Returns true if a request was actually
 *  removed, false otherwise. */
export async function cancelBibReview(
  root: FileSystemDirectoryHandle,
  citekey: string,
): Promise<boolean> {
  const path = `${SUBDIRS.queue}/${citekey}.json`;
  const cur = await readJsonFile<QueueEntry>(root, path);
  if (!cur) return false;
  if (cur.kind !== "authenticate") return false;
  if (cur.status !== "requested") return false;
  await deleteFile(root, path);
  await removePendingReview(root, citekey);
  return true;
}

/** Enqueue a deep-index request. If the paper isn't indexed yet,
 *  set `alsoIndex` to queue a vanilla index first.
 *
 *  (Was `queueRichIndex` before the rename — disk format is now
 *  `<citekey>-deepindex.json` with `kind: "deepIndex"`.) */
export async function queueDeepIndex(
  root: FileSystemDirectoryHandle,
  citekey: string,
  note?: string,
  alsoIndex?: boolean,
): Promise<string> {
  if (alsoIndex) {
    const indexEntry: QueueEntry = {
      kind: "index",
      status: "requested",
      citekey,
      requestedAt: new Date().toISOString(),
      attempts: 0,
    };
    await writeQueueEntry(root, indexEntry);
  }
  const entry: QueueEntry = {
    kind: "deepIndex",
    status: "requested",
    citekey,
    requestedAt: new Date().toISOString(),
    attempts: 0,
    ...(note && note.trim().length > 0 ? { note: note.trim() } : {}),
  };
  return writeQueueEntry(root, entry);
}

/** Cancel a queued deep-index request. Also cancels a companion index
 *  entry if it was queued alongside (for un-indexed papers). Removes
 *  whichever filename variant is present (legacy `-richindex.json` or
 *  current `-deepindex.json`). */
export async function cancelDeepIndex(
  root: FileSystemDirectoryHandle,
  citekey: string,
): Promise<boolean> {
  const candidates = [
    `${SUBDIRS.queue}/${citekey}-deepindex.json`,
    `${SUBDIRS.queue}/${citekey}-richindex.json`,
  ];
  let removed = false;
  for (const path of candidates) {
    const cur = normalizeQueueEntry(await readJsonFile<QueueEntry>(root, path));
    if (!cur || cur.kind !== "deepIndex" || cur.status !== "requested") continue;
    await deleteFile(root, path);
    removed = true;
  }
  if (removed) {
    const companionPath = `${SUBDIRS.queue}/${citekey}.json`;
    const companion = await readJsonFile<QueueEntry>(root, companionPath);
    if (companion && companion.kind === "index" && companion.status === "requested") {
      await deleteFile(root, companionPath);
    }
  }
  return removed;
}

/** Standard BibTeX entry types we offer in the type dropdown. */
export const BIB_ENTRY_TYPES = [
  "article",
  "book",
  "inbook",
  "incollection",
  "inproceedings",
  "techreport",
  "phdthesis",
  "mastersthesis",
  "unpublished",
  "misc",
] as const;

export type BibEntryType = (typeof BIB_ENTRY_TYPES)[number];

/** Fields shown in the "Publication" section, conditional on entry type.
 *  Order matters — that's the order they render in the form. */
export const PUBLICATION_FIELDS_BY_TYPE: Record<string, string[]> = {
  article: ["journal", "volume", "number", "pages", "publisher"],
  book: ["publisher", "address", "edition", "series", "volume", "isbn", "editor"],
  inbook: ["booktitle", "publisher", "address", "editor", "chapter", "pages", "edition", "series"],
  incollection: ["booktitle", "publisher", "address", "editor", "chapter", "pages", "edition", "series"],
  inproceedings: ["booktitle", "publisher", "address", "editor", "organization", "series", "pages"],
  techreport: ["institution", "type", "number", "address"],
  phdthesis: ["school", "type", "address"],
  mastersthesis: ["school", "type", "address"],
  unpublished: ["howpublished", "publisher"],
  misc: ["howpublished", "publisher"],
};

/** Fields shown in every section, regardless of type. */
export const CORE_FIELDS = ["author", "title", "year", "month"] as const;
export const IDENTIFIER_FIELDS = ["doi", "isbn", "issn", "url"] as const;
export const ANNOTATION_FIELDS = ["abstract", "note", "keywords"] as const;

/** All "known" fields — used to decide which entries land in the
 *  catch-all "Other fields" section in the editor. */
export function knownFieldsForType(type: string): Set<string> {
  return new Set<string>([
    ...CORE_FIELDS,
    ...(PUBLICATION_FIELDS_BY_TYPE[type] ?? []),
    ...IDENTIFIER_FIELDS,
    ...ANNOTATION_FIELDS,
  ]);
}

/** Re-emit a single entry as a BibTeX block. Mirrors the Python
 *  `_emit_bib_entry` in scripts/index_paper.py so frontend and skill
 *  produce byte-identical output. Empty fields are omitted. */
export function emitBibEntry(
  type: string,
  citekey: string,
  fields: Record<string, string>,
): string {
  const lines = Object.entries(fields)
    .filter(([, v]) => v && v.trim().length > 0)
    .map(([k, v]) => `  ${k} = {${v.trim()}}`)
    .join(",\n");
  return `@${type}{${citekey},\n${lines}\n}\n`;
}

/** Count fields that the AI review would attempt to fill — i.e. standard
 *  BibTeX fields that are currently empty. Used for the
 *  "N fields empty · review" link in the bib card. */
export function countEmptyTargetFields(
  type: string,
  fields: Record<string, string>,
): number {
  const target = [
    ...CORE_FIELDS,
    ...(PUBLICATION_FIELDS_BY_TYPE[type] ?? []),
    ...IDENTIFIER_FIELDS,
    "abstract",
  ];
  let n = 0;
  for (const f of target) {
    // bib-display-exempt: non-display — an emptiness COUNT over stored bytes.
    const v = fields[f];
    if (v == null) {
      n++;
      continue;
    }
    if (typeof v === "string" && v.trim().length === 0) n++;
  }
  return n;
}
