// .virgil/queue/ writers. The frontend writes here to enqueue work for
// Claude skills. The skill drains the queue, processes, then rewrites
// .virgil/catalog.json.

import { readJsonFile, writeJsonFile, writeBinaryFile, SUBDIRS } from "./library-storage";

export type QueueKind =
  | "triage"
  | "index"
  | "authenticate"
  | "reindex"
  | "bib-edit"
  | "paper-review"
  | "deepIndex"
  | "delete";

/** Legacy on-disk kind from before the rich-index → deep-index rename.
 *  Read paths normalize this to "deepIndex"; new writes never use it. */
export type LegacyQueueKind = "richIndex";

export type QueueStatus =
  | "requested"
  | "running"
  | "done"
  | "failed"
  | "poisoned";

export interface QueueEntry {
  kind: QueueKind;
  status: QueueStatus;
  citekey?: string;          // present for index/authenticate/reindex/bib-edit/paper-review
  filename?: string;         // present for triage (unsorted/<filename>)
  requestedAt: string;
  attempts: number;
  lastError?: string;
  // bib-edit only: the new entry type + field map the skill should write
  // into master.bib for `citekey`. The skill replaces the existing block
  // verbatim with this content.
  bibEdit?: BibEditPayload;
  // User-authored note for AI requests. Present on `authenticate` (bib AI
  // request) and `paper-review` (paper-text AI request) entries when the
  // user opened the note panel before submitting. The /ai-requests skill
  // surfaces these prominently and acts on them specifically.
  note?: string;
}

export interface BibEditPayload {
  type: string;                       // "article", "book", ...
  fields: Record<string, string>;     // title, author, year, ...
}

/** Write a queue entry. Path naming:
 *   queue/<citekey>.json            for index/authenticate/reindex
 *   queue/<citekey>-bibedit.json    for bib-edit (separate file so it can
 *                                   coexist with an in-flight index)
 *   queue/_triage-<slug>.json       for triage entries
 */
export async function writeQueueEntry(
  root: FileSystemDirectoryHandle,
  entry: QueueEntry,
): Promise<string> {
  const filename = queueFilename(entry);
  await writeJsonFile(root, `${SUBDIRS.queue}/${filename}`, entry);
  return filename;
}

export function queueFilename(entry: QueueEntry): string {
  if (entry.kind === "triage") {
    const slug = (entry.filename ?? "unknown")
      .replace(/\.(pdf|docx)$/i, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .slice(0, 80);
    return `_triage-${slug}.json`;
  }
  if (!entry.citekey) {
    throw new Error("citekey required for non-triage queue entry");
  }
  if (entry.kind === "bib-edit") {
    return `${entry.citekey}-bibedit.json`;
  }
  if (entry.kind === "paper-review") {
    return `${entry.citekey}-paperreview.json`;
  }
  if (entry.kind === "deepIndex") {
    return `${entry.citekey}-deepindex.json`;
  }
  if (entry.kind === "delete") {
    return `${entry.citekey}-delete.json`;
  }
  return `${entry.citekey}.json`;
}

/** Sanitize a user-provided filename so the File System Access API will
 *  accept it. FSA forbids `< > : " / \ | ? *` plus control characters,
 *  trailing dots/spaces, and reserved Windows names (CON, PRN, etc).
 *  Anything illegal becomes `_`. */
export function sanitizeFilename(name: string): string {
  // Strip any path separators first so we don't accidentally nest into
  // subdirectories.
  let s = name.replace(/[\\/]/g, "_");
  // Replace remaining FSA-disallowed characters and ASCII control chars.
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[<>:"|?*\x00-\x1f]/g, "_");
  // Collapse runs of underscores so `gallistel "x".pdf` doesn't become
  // `gallistel __x__.pdf` — keep it readable.
  s = s.replace(/_{2,}/g, "_");
  // Strip trailing spaces and dots (Windows + FSA both reject those).
  s = s.replace(/[ .]+$/g, "");
  // Trim leading whitespace too.
  s = s.replace(/^\s+/, "");
  if (s.length === 0) s = "file";
  // Reserved Windows basenames (case-insensitive). If the stem matches,
  // prefix with `_` to dodge the rule.
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
  if (reserved.test(s)) s = "_" + s;
  return s;
}

/** Drop a source file (.pdf or .docx) into unsorted/ then enqueue triage
 *  for it. Returns the unsorted filename and the queue filename. */
export async function dropUnsortedSource(
  root: FileSystemDirectoryHandle,
  file: File,
): Promise<{ unsortedFilename: string; queueFilename: string }> {
  const safe = sanitizeFilename(file.name);
  const unsortedFilename = await writeUnique(root, SUBDIRS.unsorted, safe, file);
  const entry: QueueEntry = {
    kind: "triage",
    status: "requested",
    filename: unsortedFilename,
    requestedAt: new Date().toISOString(),
    attempts: 0,
  };
  const qf = await writeQueueEntry(root, entry);
  return { unsortedFilename, queueFilename: qf };
}

/** Write the file under dir, suffixing with -1 / -2 / ... if the name
 *  already exists. Returns the final filename used. */
async function writeUnique(
  root: FileSystemDirectoryHandle,
  dirPath: string,
  desiredName: string,
  file: File,
): Promise<string> {
  const parts = dirPath.split("/").filter(Boolean);
  let cur: FileSystemDirectoryHandle = root;
  for (const p of parts) {
    cur = await cur.getDirectoryHandle(p, { create: true });
  }
  const dotIdx = desiredName.lastIndexOf(".");
  const stem = dotIdx >= 0 ? desiredName.slice(0, dotIdx) : desiredName;
  const ext = dotIdx >= 0 ? desiredName.slice(dotIdx) : "";
  let attempt = 0;
  let name = desiredName;
  while (await exists(cur, name)) {
    attempt += 1;
    name = `${stem}-${attempt}${ext}`;
  }
  await writeBinaryFile(root, `${dirPath}/${name}`, file);
  return name;
}

async function exists(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

export interface NotificationItem {
  kind: "indexed" | "authenticated" | "failed" | "triaged" | "setup-needed";
  citekey?: string;
  at: string;
  summary: string;
}

export interface NotificationInbox {
  items: NotificationItem[];
}

// ---------------------------------------------------------------------------
// Pending-reviews aggregate — a flat manifest of all queued authenticate
// requests so the AI reviewer can find them without scanning individual
// queue files.
// ---------------------------------------------------------------------------

export interface PendingReviewEntry {
  citekey: string;
  requestedAt: string;
}

export interface PendingReviewsFile {
  pendingReviews: PendingReviewEntry[];
  updatedAt: string;
}

const PENDING_REVIEWS_PATH = `${SUBDIRS.queue}/pending-reviews.json`;

export async function addPendingReview(
  root: FileSystemDirectoryHandle,
  citekey: string,
  requestedAt: string,
): Promise<void> {
  const cur = await readJsonFile<PendingReviewsFile>(root, PENDING_REVIEWS_PATH);
  const reviews = cur?.pendingReviews?.filter((r) => r.citekey !== citekey) ?? [];
  reviews.push({ citekey, requestedAt });
  await writeJsonFile(root, PENDING_REVIEWS_PATH, {
    pendingReviews: reviews,
    updatedAt: new Date().toISOString(),
  } satisfies PendingReviewsFile);
}

/** Normalize a freshly-read queue entry — translates legacy kind names
 *  ("richIndex" → "deepIndex") so callers downstream see only the
 *  current vocabulary. Returns null for null/undefined input. */
export function normalizeQueueEntry(raw: QueueEntry | null | undefined): QueueEntry | null {
  if (!raw) return null;
  const legacyKind = (raw as { kind?: string }).kind;
  if (legacyKind === "richIndex") {
    return { ...raw, kind: "deepIndex" };
  }
  return raw;
}

export async function removePendingReview(
  root: FileSystemDirectoryHandle,
  citekey: string,
): Promise<void> {
  const cur = await readJsonFile<PendingReviewsFile>(root, PENDING_REVIEWS_PATH);
  if (!cur) return;
  const reviews = cur.pendingReviews.filter((r) => r.citekey !== citekey);
  await writeJsonFile(root, PENDING_REVIEWS_PATH, {
    pendingReviews: reviews,
    updatedAt: new Date().toISOString(),
  } satisfies PendingReviewsFile);
}
