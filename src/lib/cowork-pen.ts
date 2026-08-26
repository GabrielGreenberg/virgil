/**
 * **The cowork-pen AUTHORITY** — task 489.
 *
 * Gabriel: *"When Virgil is editing from cowork, can it flip a switch that
 * makes the doc read only (with some loud indicator to show what is
 * happening?). i feel like this might help with conflicted copies too — i think
 * they may be creeping in when cowork edits."*
 *
 * The mechanism existed and the app could only see half of it. `/editor/*`
 * skills already commit **under the pen** — `_common.commit_under_pen` is
 * acquire → atomic write → release — and that acquire writes the pen in TWO
 * places:
 *
 * - `.virgil/pen-context.json` — **always**, holder `"claude"`, carrying an
 *   `expires_at` ≈ +30 s so a crashed skill cannot wedge the lock; and
 * - `virgil/collab.json`'s `pen` — **only if that file already exists**,
 *   holder `"Claude"`, with `enabled` flipped true for the duration.
 *
 * The app read only the second, and only while `sidecar.enabled` — i.e. only
 * on a paper the user had already turned collaborator mode on for. On the
 * ordinary SOLO paper (the one Gabriel is describing) the skill's pen meant
 * nothing to the UI at all: the user kept typing while the skill spliced the
 * `.tex` on disk, and the 1500 ms autosave then raced the skill's write. Two
 * writers, one folder, a sync daemon watching — which is the conflicted-copy
 * seed the 363/415 cluster narrowed from the Virgil side and could not close
 * from the cowork side.
 *
 * > **"Who holds this document's pen right now?" is ONE question with ONE
 * > answer, resolved here from every record that can carry it.** The two
 * > on-disk records are two RUNGS of one ladder, not two facts: the
 * > pen-context record (always written, self-expiring) first, the collab
 * > sidecar's pen second. Every consumer — the read-only gate, the autosave
 * > pause, the topbar banner, the save-state reason — reads the answer here.
 * > A second derivation of "is the AI editing?" is how the two records came to
 * > disagree in the first place.
 *
 * ## Why no new file, and no skill-side change
 *
 * The obvious alternative was to make `acquire_pen` CREATE `collab.json` when
 * a solo paper has none, so the one record the app already polled would always
 * carry the answer. It was declined for the reason this whole report is about:
 * that is a file created and then rewritten in the user's synced folder on
 * every commit — new write traffic in exactly the folder whose write traffic
 * task 363 and task 415 spent two passes reducing. Reading a record the skill
 * ALREADY writes unconditionally costs nothing, and it is the record that
 * carries the TTL.
 *
 * ## Fail toward RELEASING
 *
 * Every unreadable, unparseable, foreign-holder or over-aged record resolves to
 * `null` — no pen held. The asymmetry is deliberate and it is the opposite of
 * the preservation gate's: a document wedged read-only with a banner nobody can
 * dismiss is worse than a brief window in which the user could have typed over
 * a skill's commit, because the commit itself is atomic and sub-second and the
 * disk-side gates (the doc lock, the byte-equality gate, the clobber guard)
 * still stand behind it. So an expiry we cannot believe is treated as expired.
 *
 * ## Poll latency, stated rather than engineered around
 *
 * The signal is polled on `useCollab`'s existing 5 s clock. A fast skill commit
 * can begin and end between two polls and the UI will never notice — accepted,
 * and the banner copy is written accordingly. The window this closes is not the
 * sub-second commit; it is the SESSION, where a skill drafts, splices, drafts
 * again, and a user typing through it never learns that anything else is
 * holding the file.
 *
 * Pure and React-free, `useSyncExternalStore`-shaped — the same module shape as
 * `unsaved-work.ts` and `preservation-notice.ts`, and for the same reason: the
 * fact is produced by a poller and consumed by surfaces with no call
 * relationship to it.
 */

/* ── The vocabulary, mirrored from editor/scripts/_common.py ─────────── */

/**
 * The pen-context record's path, relative to the PAPER ROOT (not `virgil/`).
 * `_common.dot_virgil_dir` → `.virgil/`, `_common.pen_context_path`.
 */
export const COWORK_PEN_CONTEXT_PATH = ".virgil/pen-context.json";

/** `_common.PEN_CONTEXT_HOLDER` — the id stamped into the pen-context file. */
export const COWORK_PEN_CONTEXT_HOLDER = "claude";

/**
 * `_common.COLLAB_PEN_HOLDER` — the DISPLAY name stamped into `collab.json`'s
 * `pen.holder`. It differs from the pen-context id in case only, deliberately
 * (the browser resolves a participant entry by display name); both spellings
 * are members of this vocabulary so neither reader has to know which record it
 * came from.
 */
export const COWORK_COLLAB_PEN_HOLDER = "Claude";

/** `_common.PEN_TTL_SECONDS = 30`, in ms. */
export const COWORK_PEN_TTL_MS = 30_000;

/**
 * The ceiling on how long a cowork pen may be believed, whatever the record
 * says.
 *
 * A skill's hold is `acquire → atomic_write → release`, so a live hold is
 * sub-second; anything longer is a crashed or killed process. The TTL the skill
 * itself writes is 30 s; this is double that, so an honest clock skew of a few
 * seconds cannot release a live pen, while a crash clears in a minute rather
 * than in the 5 minutes `COLLAB_TIMINGS.penStaleMs` gives a HUMAN holder — who,
 * unlike the AI, heartbeats and can be asked to hand it over.
 */
export const COWORK_PEN_MAX_AGE_MS = 60_000;

/** Is this `pen.holder` / pen-context `holder` an AI cowork identity? */
export function isCoworkPenHolder(name: unknown): boolean {
  if (typeof name !== "string") return false;
  const n = name.trim().toLowerCase();
  return (
    n === COWORK_PEN_CONTEXT_HOLDER.toLowerCase() ||
    n === COWORK_COLLAB_PEN_HOLDER.toLowerCase()
  );
}

/* ── The answer ───────────────────────────────────────────────────────── */

/** Which on-disk record carried the answer. Surfaced for diagnosis only —
 *  every consumer treats the two identically. */
export type CoworkPenSource = "pen-context" | "collab";

export interface CoworkPenState {
  /** The holder as written on disk (`"claude"` / `"Claude"`). */
  holder: string;
  /** ms epoch the hold began, or `null` when the record did not say. */
  since: number | null;
  /** ms epoch this hold stops being believed. Always finite: an absent or
   *  unbelievable expiry is clamped to `since + COWORK_PEN_MAX_AGE_MS`. */
  expiresAt: number;
  source: CoworkPenSource;
}

function parseIso(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * Rung 1 — `.virgil/pen-context.json`, the record the skill writes on EVERY
 * commit whether or not the paper has a `collab.json`.
 *
 * `raw` is the parsed JSON (or `null` when the file is absent / unparseable).
 */
export function coworkPenFromContext(
  raw: unknown,
  now: number = Date.now(),
): CoworkPenState | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  if (!isCoworkPenHolder(rec.holder)) return null;
  const since = parseIso(rec.acquired_at);
  const stated = parseIso(rec.expires_at);
  // The ceiling is the app's, not the record's: a far-future `expires_at`
  // (clock skew, a hand-edited file, a future skill that lengthens its TTL)
  // must not be able to wedge the document read-only. Fail toward releasing.
  const ceiling = (since ?? now) + COWORK_PEN_MAX_AGE_MS;
  const expiresAt = Math.min(stated ?? ceiling, ceiling);
  if (now >= expiresAt) return null;
  return {
    holder: String(rec.holder),
    since,
    expiresAt,
    source: "pen-context",
  };
}

/**
 * Rung 2 — `virgil/collab.json`'s `pen`, which the skill flips only on a paper
 * that already has that file.
 *
 * This rung exists so a COLLAB-ENABLED paper reads the same answer as a solo
 * one: without it, an AI hold on such a paper would surface through the generic
 * partner chrome ("someone else has the pen") rather than as the thing that is
 * actually happening. The staleness ceiling is the AI's short one, not
 * `COLLAB_TIMINGS.penStaleMs` — the AI never heartbeats, so its `lastHeartbeat`
 * is frozen at the acquire and a 5-minute window would leave a crashed skill
 * holding the document for 5 minutes.
 */
export function coworkPenFromCollab(
  pen: { holder?: unknown; since?: unknown; lastHeartbeat?: unknown } | null | undefined,
  now: number = Date.now(),
): CoworkPenState | null {
  if (!pen || !isCoworkPenHolder(pen.holder)) return null;
  const since = parseIso(pen.since);
  const beat = parseIso(pen.lastHeartbeat) ?? since;
  if (beat === null) return null;
  const expiresAt = beat + COWORK_PEN_MAX_AGE_MS;
  if (now >= expiresAt) return null;
  return { holder: String(pen.holder), since, expiresAt, source: "collab" };
}

/**
 * **THE LADDER.** One answer, resolved from both records, pen-context first.
 *
 * Order matters only for which `source` is reported: the two records are
 * written inside one atomic `acquire_pen`, so when both are present they say
 * the same thing. Pen-context leads because it is the one that is ALWAYS
 * written and the one carrying a real expiry.
 */
export function resolveCoworkPen(
  input: {
    penContext?: unknown;
    collabPen?: { holder?: unknown; since?: unknown; lastHeartbeat?: unknown } | null;
  },
  now: number = Date.now(),
): CoworkPenState | null {
  return (
    coworkPenFromContext(input.penContext, now) ??
    coworkPenFromCollab(input.collabPen ?? null, now)
  );
}

/* ── The store ────────────────────────────────────────────────────────── */

const byDoc = new Map<string, CoworkPenState>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

/** `useSyncExternalStore` shape. Snapshots are frozen and identity-stable, so
 *  a subscriber for doc A re-renders on a doc B change and then bails. */
export function subscribeCoworkPen(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** This document's live cowork-pen state, or `null` when nothing holds it. */
export function getCoworkPen(
  docId: string | null | undefined,
): CoworkPenState | null {
  if (!docId) return null;
  return byDoc.get(docId) ?? null;
}

/**
 * Does a cowork skill hold this document right now? **The ONE predicate** —
 * every gate asks it rather than keeping its own copy of the ladder.
 *
 * Re-checks the expiry at read time as well as at publish time, so a hold that
 * ages out between two polls stops biting immediately rather than at the next
 * tick. This is what keeps the autosave pause honest: the pause is read at
 * debounce-fire, which is far more often than the poll.
 */
export function coworkPenHeld(
  docId: string | null | undefined,
  now: number = Date.now(),
): boolean {
  const s = getCoworkPen(docId);
  return s !== null && now < s.expiresAt;
}

/**
 * Publish this document's answer. The ONE writer is the poller in `useCollab`
 * — `noteCoworkPen(docId, null)` on every tick that finds no hold, so a
 * released pen clears on the next poll without a separate expiry sweep.
 *
 * Idempotent: an unchanged answer notifies nobody, so the 5 s poll costs zero
 * re-renders while nothing is happening.
 */
export function noteCoworkPen(
  docId: string,
  state: CoworkPenState | null,
): void {
  const prev = byDoc.get(docId) ?? null;
  if (state === null) {
    if (!byDoc.delete(docId)) return;
    emit();
    return;
  }
  if (
    prev &&
    prev.holder === state.holder &&
    prev.since === state.since &&
    prev.expiresAt === state.expiresAt &&
    prev.source === state.source
  ) {
    return;
  }
  byDoc.set(docId, Object.freeze({ ...state }));
  emit();
}

/** Forget a document entirely — its pane unmounted, so nothing is polling it
 *  any more and a retained answer could only go stale. */
export function clearCoworkPen(docId?: string): void {
  if (docId === undefined) {
    if (byDoc.size === 0) return;
    byDoc.clear();
  } else if (!byDoc.delete(docId)) {
    return;
  }
  emit();
}
