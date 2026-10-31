/**
 * Reload continuity for collab sessions (task 1392).
 *
 * Collab ownership is the SESSION — one `useCollab`, one pane of one window,
 * one page load (task 1213). A reload therefore mints a new session, and
 * without this module the pen the pane held a moment ago belonged to a
 * session that no longer exists: the pill said "held in another pane" (there
 * was none) and the text stayed read-only until "Take here".
 *
 * The window remembers which sessions it ran on each paper, in
 * `sessionStorage` (per tab, survives a reload) under the window's CHECKED id
 * (`claimWindowIdentity`, task 871). That key is the whole duplicate-tab
 * answer: "Duplicate tab" copies sessionStorage, but the duplicate's claim
 * finds its inherited id held by the live original and re-mints, so it reads
 * a record under an id that has none — a duplicate inherits no session and
 * cannot adopt the original's pen. No second liveness protocol: the window
 * id's lock is the one.
 *
 * A remembered session that is not live in this page is a dead predecessor
 * (the page before the reload); `adoptSessionsMutator` moves what it held
 * onto the new session.
 */

import { claimWindowIdentity } from "@/lib/multi-window/window-liveness";
import { getWindowId } from "@/lib/multi-window/window-id";

const RECORD_PREFIX = "virgil:collab-sessions:";
/** A paper's remembered sessions per window — more than any pane count. */
const MAX_PER_DOC = 8;

type SessionRecord = Record<string, string[]>;

/** Sessions mounted in THIS page, refcounted (StrictMode mounts twice). */
const live = new Map<string, number>();

/** Mark `session` live in this page until the returned release runs. */
export function holdLiveSession(session: string): () => void {
  live.set(session, (live.get(session) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const n = (live.get(session) ?? 1) - 1;
    if (n <= 0) live.delete(session);
    else live.set(session, n);
  };
}

function readRecord(windowId: string): SessionRecord {
  try {
    const raw = sessionStorage.getItem(RECORD_PREFIX + windowId);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: SessionRecord = {};
    for (const [doc, ids] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(ids)) {
        out[doc] = ids.filter((s): s is string => typeof s === "string");
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeRecord(windowId: string, record: SessionRecord): void {
  try {
    const key = RECORD_PREFIX + windowId;
    if (Object.keys(record).length === 0) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(record));
  } catch {
    /* storage unavailable — continuity is best-effort */
  }
}

/**
 * Register `session` as this window's on `docId` and return the DEAD sessions
 * the window ran on it before (a reload's predecessors), which the caller
 * adopts. Live sessions (a sibling pane on the same paper) are kept and not
 * returned; the dead ones leave the record, since `session` now carries what
 * they held. Awaits the checked window id, so a duplicated tab reads its own
 * (empty) record, never its source window's.
 *
 * `isCurrent` is asked after the await: a hook that unmounted (or moved to
 * another paper) meanwhile registers nothing.
 */
export async function inheritCollabSessions(
  docId: string,
  session: string,
  isCurrent: () => boolean = () => true,
): Promise<string[]> {
  if (typeof window === "undefined") return [];
  const { id } = await claimWindowIdentity();
  if (!isCurrent()) return [];
  const record = readRecord(id);
  const prior = record[docId] ?? [];
  const dead = prior.filter((s) => s !== session && !live.has(s));
  const kept = prior.filter((s) => s !== session && live.has(s));
  record[docId] = [...kept, session].slice(-MAX_PER_DOC);
  writeRecord(id, record);
  return dead;
}

/** Drop `session` from the window's record for `docId` — a clean leave (the
 *  pane closed or switched papers), whose release already ran. Not called on
 *  `pagehide`: a reload must still find it. */
export function forgetCollabSession(docId: string, session: string): void {
  if (typeof window === "undefined") return;
  const id = getWindowId();
  const record = readRecord(id);
  const prior = record[docId];
  if (!prior?.includes(session)) return;
  const rest = prior.filter((s) => s !== session);
  if (rest.length) record[docId] = rest;
  else delete record[docId];
  writeRecord(id, record);
}

/** Test seam. */
export function __resetCollabSessionsForTest(): void {
  live.clear();
}
