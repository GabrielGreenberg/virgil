// .virgil/queue/ writers. The frontend writes here to enqueue work for
// Claude skills. The skill drains the queue, processes, then rewrites
// .virgil/catalog.json.

import {
  deleteFile,
  readJsonFile,
  readTextFile,
  writeBinaryFile,
  writeJsonFile,
  writeTextFile,
  SUBDIRS,
} from "./library-storage";

export type QueueKind =
  | "triage"
  | "index"
  | "authenticate"
  | "reindex"
  | "bib-edit"
  | "paper-review"
  | "deepIndex"
  | "import-bib"
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
  // Set on an `index` entry that `queueDeepIndex` planted for an un-indexed
  // paper, so cancelling the deep index removes ONLY that companion — never
  // an index the user queued on its own (task 618).
  companionOf?: "deepIndex";
}

/** A manual bib edit, as the Library's "Edit entry" modal queues it.
 *
 *  It is a field-level DIFF against a named base, never a whole entry (task
 *  763). A whole entry trusted its omissions: every field the modal did not
 *  carry — one `/library/authenticate-bib` added while the modal was open or the
 *  edit sat queued — was deleted on apply. So the payload names exactly what the
 *  user changed (`set`) and removed (`remove`), plus the entry as it was when the
 *  modal opened (`baseRaw`, `baseType`); `/library/apply-bib-edit` splices only
 *  those fields into the CURRENT block and refuses any of them that changed on
 *  disk since the base, rather than overwriting the newer value. */
export interface BibEditDiffPayload {
  type: string;                       // the entry type to end up with
  baseType: string;                   // the type when the modal opened
  set: Record<string, string>;        // fields the user added or changed
  remove: string[];                   // fields the user removed
  baseRaw?: string;                   // the block as the modal read it
}

/** The pre-763 shape: a complete entry. Still readable so an edit queued
 *  before the change drains — but applied as a MERGE (no field is dropped by
 *  omission), since its omissions are exactly what cannot be trusted. */
export interface LegacyBibEditPayload {
  type: string;
  fields: Record<string, string>;
}

export type BibEditPayload = BibEditDiffPayload | LegacyBibEditPayload;

/** Thrown when a slot refuses a write: the request already there is being
 *  worked (`status: "running"`), or a legacy occupant of another kind holds
 *  the bare slot and could not be moved aside. The message is user-facing
 *  (PaperHeader flashes it). */
export class QueueSlotBusyError extends Error {
  constructor(
    readonly filename: string,
    readonly reason: "in-flight" | "occupied",
  ) {
    super(
      reason === "in-flight"
        ? "this request is already being processed — try again when it finishes"
        : "another request for this paper is still queued in the old shared slot",
    );
    this.name = "QueueSlotBusyError";
  }
}

/** Write a queue entry under the SLOT LIFECYCLE contract (task 618) — the TS
 *  half of `library/scripts/queue_slot.py`, which states it in full:
 *
 *   1. one slot per kind (`queueFilename`);
 *   2. retire-on-write: a `<slot>.done` left by an earlier run is rotated to
 *      `<slot>.<kind>.<stamp>.done` first, so the drain can never mistake a
 *      new request for finished work;
 *   3. a `running` entry is never overwritten (`QueueSlotBusyError`);
 *   4. a legacy `authenticate` request in the bare `<citekey>.json` slot is
 *      moved to its own slot before anything else is written there.
 *
 *  A pending request of the same kind IS replaced — that is a re-request
 *  from the app (e.g. with an edited note). */
export async function writeQueueEntry(
  root: FileSystemDirectoryHandle,
  entry: QueueEntry,
): Promise<string> {
  const filename = queueFilename(entry);
  const path = `${SUBDIRS.queue}/${filename}`;
  if (entry.kind !== "triage" && filename === `${entry.citekey}.json`) {
    if (!(await migrateLegacyOccupant(root, entry.citekey!, entry.kind))) {
      throw new QueueSlotBusyError(filename, "occupied");
    }
  }
  const cur = normalizeQueueEntry(await readJsonFile<QueueEntry>(root, path));
  if (cur?.status === "running") {
    throw new QueueSlotBusyError(filename, "in-flight");
  }
  await retireDone(root, slotStem(filename));
  await writeJsonFile(root, path, entry);
  return filename;
}

/** Kinds whose requests lived in the bare `<citekey>.json` slot before each
 *  kind got its own (task 618). Mirrors `LEGACY_BARE_SLOT_KINDS`. */
export const LEGACY_BARE_SLOT_KINDS: readonly QueueKind[] = ["authenticate"];

function slotStem(filename: string): string {
  return filename.replace(/\.json$/, "");
}

/** Rotate `<stem>.done` out of its slot. A refused delete leaves the old
 *  marker in place; the drain's belt (`done_retires`: same kind AND same
 *  `requestedAt`) still tells it apart from the new request. */
export async function retireDone(
  root: FileSystemDirectoryHandle,
  stem: string,
): Promise<void> {
  const donePath = `${SUBDIRS.queue}/${stem}.done`;
  const text = await readTextFile(root, donePath);
  if (text === undefined) return;
  let kind = "unknown";
  try {
    const parsed = JSON.parse(text) as { kind?: unknown };
    if (typeof parsed?.kind === "string" && parsed.kind) kind = parsed.kind;
  } catch {
    // An empty / unparseable marker (the drain's fallback) rotates as unknown.
  }
  const stamp = new Date().toISOString().replace(/[-:.]/g, "");
  await writeTextFile(root, `${SUBDIRS.queue}/${stem}.${kind}.${stamp}.done`, text);
  await deleteFile(root, donePath);
}

/** Move a legacy occupant of the bare slot to its own per-kind slot. Returns
 *  false when it could not be moved without losing a request. */
async function migrateLegacyOccupant(
  root: FileSystemDirectoryHandle,
  citekey: string,
  targetKind: QueueKind,
): Promise<boolean> {
  const barePath = `${SUBDIRS.queue}/${citekey}.json`;
  const cur = normalizeQueueEntry(await readJsonFile<QueueEntry>(root, barePath));
  if (!cur || cur.kind === targetKind || !LEGACY_BARE_SLOT_KINDS.includes(cur.kind)) {
    return true;
  }
  const destName = queueFilename({ ...cur, citekey });
  const destPath = `${SUBDIRS.queue}/${destName}`;
  const dest = await readJsonFile<QueueEntry>(root, destPath);
  if (dest) {
    if (dest.status !== "requested") return false;
    // The per-kind slot already carries the pending request; drop the copy.
    await deleteFile(root, barePath);
    return true;
  }
  if (cur.status === "running") return false;
  await retireDone(root, slotStem(destName));
  await writeJsonFile(root, destPath, cur);
  await deleteFile(root, barePath);
  return true;
}

/** The file that holds a live (`requested`/`running`) request of `kind` for
 *  `citekey`, looking in its own slot and — for legacy kinds — the bare slot.
 *  The CANCEL half's reader, so a cancel finds a pre-618 request too. */
export async function findQueuedRequest(
  root: FileSystemDirectoryHandle,
  citekey: string,
  kind: QueueKind,
): Promise<{ path: string; entry: QueueEntry } | null> {
  const names = [queueFilename({ kind, citekey, status: "requested", requestedAt: "", attempts: 0 })];
  if (LEGACY_BARE_SLOT_KINDS.includes(kind)) names.push(`${citekey}.json`);
  if (kind === "deepIndex") names.push(`${citekey}-richindex.json`);
  for (const name of names) {
    const path = `${SUBDIRS.queue}/${name}`;
    const entry = normalizeQueueEntry(await readJsonFile<QueueEntry>(root, path));
    if (entry && entry.kind === kind) return { path, entry };
  }
  return null;
}

/** The queue filename for an entry — ONE SLOT PER KIND (task 618). `index`
 *  and `reindex` share `<citekey>.json` (the same work); every other kind
 *  has its own file, so two requests for one paper can never overwrite each
 *  other. Mirrors `SLOT_SUFFIX` in `library/scripts/queue_slot.py`, pinned by
 *  `queue-slot-parity.test.ts`. Triage entries live at
 *  `_triage-<slug>.json`. */
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
  const suffix = QUEUE_SLOT_SUFFIX[entry.kind];
  return `${entry.citekey}${suffix}.json`;
}

/** kind → filename suffix after the citekey ("" = the bare slot). */
export const QUEUE_SLOT_SUFFIX: Record<Exclude<QueueKind, "triage">, string> = {
  index: "",
  reindex: "",
  authenticate: "-auth",
  "bib-edit": "-bibedit",
  "paper-review": "-paperreview",
  deepIndex: "-deepindex",
  "import-bib": "-importbib",
  delete: "-delete",
};

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

/** Visual severity of a toast — drives its auto-dismiss TTL (and its accent
 *  in the Toaster). `info` = a routine "done" message that can vanish
 *  quickly; `attention` = a warning / action-needed message the user should
 *  have time to read and act on. F#6. */
export type NotificationSeverity = "info" | "attention";

const NOTIFICATION_SEVERITY: Record<NotificationItem["kind"], NotificationSeverity> = {
  indexed: "info",
  authenticated: "info",
  triaged: "info",
  failed: "attention",
  "setup-needed": "attention",
};

/** Per-severity auto-dismiss duration (ms). Info toasts vanish quickly;
 *  attention/warning toasts linger so they're readable + actionable before
 *  disappearing. Dismissal is session-scoped — a toast re-surfaces on reload
 *  if its condition still holds (no persisted suppression). */
export const NOTIFICATION_TTL_MS: Record<NotificationSeverity, number> = {
  info: 5000,
  attention: 11000,
};

export function notificationSeverity(
  kind: NotificationItem["kind"],
): NotificationSeverity {
  return NOTIFICATION_SEVERITY[kind] ?? "info";
}

export function notificationTtlMs(kind: NotificationItem["kind"]): number {
  return NOTIFICATION_TTL_MS[notificationSeverity(kind)];
}

export interface NotificationInbox {
  items: NotificationItem[];
}

function isNotificationItem(v: unknown): v is NotificationItem {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.at === "string" && typeof o.summary === "string" && typeof o.kind === "string";
}

/** The ONE reader for `notifications/inbox.json` (task 764). Returns the
 *  well-formed items, `[]` for a missing/empty/malformed inbox (`{}`, a
 *  non-array `items`, junk rows) — never throws on shape, so a poller built
 *  on it cannot die in its interval tick. Shared by the toast stream and the
 *  row-dot scanner. */
export async function readNotificationItems(
  root: FileSystemDirectoryHandle,
): Promise<NotificationItem[]> {
  let inbox: NotificationInbox | null | undefined;
  try {
    inbox = await readJsonFile<NotificationInbox>(root, `${SUBDIRS.notifications}/inbox.json`);
  } catch {
    return [];
  }
  const items = (inbox as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? items.filter(isNotificationItem) : [];
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
