/**
 * THE serialized write authority for `collab.json` (task 872).
 *
 * The sidecar has more than one writer: this window's `useCollab` (pen
 * heartbeat, claims, presence, the unload release), a peer window on the same
 * paper, and — through the synced folder — the collaborator's own tab. The
 * *Cross-window store stability* law's sidecar half therefore applies: every
 * mutation is a PURE function of the file as it is ON DISK at the moment of the
 * write, computed inside the doc write queue (`mutateSidecar`), never a whole
 * snapshot computed earlier from the last poll.
 *
 * Before this module `useCollab` read OUTSIDE the queue and then wrote (a
 * concurrent write could land in between and be overwritten), and its unload
 * release wrote the last-POLLED snapshot with no read at all — so a partner's
 * pen request or presence that arrived since that poll was erased from disk
 * the moment this tab closed.
 *
 * Every collab.json write door is here; `ai-requests-authority.test.ts`'s
 * census pins that nothing else calls `mutateSidecar`/`writeSidecar` for it.
 */

import { mutateSidecar } from "@/lib/storage";
import {
  beginDocPipeline,
  getActiveHandle,
  isStalePipelineError,
} from "@/lib/multi-window/doc-pipeline";
import {
  COLLAB_SIDECAR_FILE,
  EMPTY_COLLAB_SIDECAR,
  COLLAB_TIMINGS,
  derivePen,
  ensureParticipant,
  holdsPen,
  touchPresence,
  type CollabIdentity,
  type CollabPresenceEntry,
  type CollabSelf,
  type CollabSidecar,
} from "@/lib/collab";

/** A mutation of the sidecar: a pure function from the on-disk value to the
 *  next one, or `null` for "nothing to change" (no write). It may run twice —
 *  once optimistically against local state, once inside the queue against
 *  the fresh disk read — so it must not touch storage itself. */
export type CollabMutator = (current: CollabSidecar) => CollabSidecar | null;

/**
 * Apply `fn` to the freshly-read on-disk sidecar inside the doc write queue
 * and persist the result. Resolves the authoritative post-write sidecar, or
 * `null` when nothing was written (a no-op mutator, a non-writable library
 * paper, a stale pipeline, or a storage error — the next poll re-converges).
 *
 * The write handle is resolved lazily at call time so a StrictMode / Fast
 * Refresh remount that rotated the pipeline id can't leave callers writing
 * through a stale handle; `beginDocPipeline` is idempotent and is the
 * fallback when no `<DocPipeline>` has registered this doc.
 */
export async function mutateCollab(
  docId: string,
  fn: CollabMutator,
): Promise<CollabSidecar | null> {
  const handle = getActiveHandle(docId) ?? beginDocPipeline(docId);
  try {
    return await mutateSidecar<CollabSidecar>(
      handle,
      COLLAB_SIDECAR_FILE,
      EMPTY_COLLAB_SIDECAR,
      fn,
    );
  } catch (err) {
    if (isStalePipelineError(err)) return null;
    /* swallow other errors — the poll re-converges on the disk truth */
    return null;
  }
}

/**
 * The leave-the-paper mutator: clear the pen if THIS SESSION holds it and
 * drop this session's presence — nothing else. Applied to the fresh disk
 * read, so a partner's pen request, presence or claim that landed since our
 * last poll survives.
 *
 * Task 1213 — "mine" is the SESSION (one pane of one window), not the name:
 * the name is per-browser, so before this window A's `pagehide` cleared the
 * pen window B was writing under and deleted B's presence. Now the pen goes
 * only when `self` holds it ({@link holdsPen}), and the presence entry only
 * when no OTHER fresh session of the name is left in it.
 * Returns `null` when there is nothing of mine to remove.
 */
export function releaseSelf(
  self: CollabSelf,
  now: number = Date.now(),
): CollabMutator {
  return (prev) => {
    if (!prev.enabled) return null;
    let next = prev;
    if (holdsPen(prev.pen, self)) {
      next = {
        ...next,
        pen: {
          ...next.pen,
          holder: null,
          holderSession: null,
          since: null,
          lastHeartbeat: null,
          lastActivity: null,
        },
      };
    }
    const entry = next.presence[self.name];
    if (entry) {
      const others = otherFreshSessions(entry, self.session, now);
      if (others) {
        if (entry.sessions && self.session in entry.sessions) {
          next = {
            ...next,
            presence: {
              ...next.presence,
              [self.name]: { ...entry, sessions: others },
            },
          };
        }
      } else {
        const { [self.name]: _gone, ...rest } = next.presence;
        next = { ...next, presence: rest };
      }
    }
    return next === prev ? null : next;
  };
}

/** The sessions of `entry` other than `session` whose heartbeat is still
 *  fresh (inside `penStaleMs` — the clock presence is swept on), or `null`
 *  when none is left. A crashed sibling that never released is not "left":
 *  its heartbeat ages out. */
function otherFreshSessions(
  entry: CollabPresenceEntry,
  session: string,
  now: number,
): Record<string, string> | null {
  if (!entry.sessions) return null;
  const out: Record<string, string> = {};
  let any = false;
  for (const [id, at] of Object.entries(entry.sessions)) {
    if (id === session) continue;
    const t = Date.parse(at);
    if (Number.isFinite(t) && now - t < COLLAB_TIMINGS.penStaleMs) {
      out[id] = at;
      any = true;
    }
  }
  return any ? out : null;
}

/**
 * The periodic heartbeat (task 1213): refresh the pen's heartbeat iff THIS
 * session holds it — stamping `holderSession`, which migrates a legacy
 * session-less record to its first heartbeating session — and refresh this
 * session's presence (and focus claim) if it has one. A session that does
 * not hold the pen never touches it, so a sibling pane or window of the same
 * name cannot keep a pen fresh that it is not writing under.
 */
export function heartbeatMutator(
  self: CollabSelf,
  clock: () => number = Date.now,
): CollabMutator {
  return (prev) => {
    if (!prev.enabled) return null;
    let next = prev;
    const now = new Date(clock()).toISOString();
    if (holdsPen(prev.pen, self)) {
      next = {
        ...next,
        pen: { ...next.pen, holderSession: self.session, lastHeartbeat: now },
      };
    }
    const myEntry = next.presence[self.name];
    if (myEntry?.focusedCard) {
      next = touchPresence(
        next,
        self.name,
        { focusedCard: { ...myEntry.focusedCard, lastHeartbeat: now } },
        self.session,
      );
    } else if (myEntry) {
      next = touchPresence(next, self.name, {}, self.session);
    }
    return next === prev ? null : next;
  };
}

/** Stamp real input on the pen — only when THIS session holds it. */
export function activityMutator(
  self: CollabSelf,
  at: number,
): CollabMutator {
  return (prev) => {
    if (!holdsPen(prev.pen, self)) return null;
    const iso = new Date(at).toISOString();
    return {
      ...prev,
      pen: {
        ...prev.pen,
        holderSession: self.session,
        lastActivity: iso,
        lastHeartbeat: iso,
      },
    };
  };
}

/* ── The pen state machine (task 1015) ─────────────────────────────
 *
 * Each pen transition states its PRECONDITION against the fresh disk value
 * and returns `null` (no write) when it fails. The pill offers each button
 * from a state up to one poll old, so "the pen looked free / mine / stale"
 * is a claim about the PAST — the mutator re-asks it of the present, inside
 * the queue, where a partner's take-over or a near-simultaneous take has
 * already landed. Without the check, a stale-UI Pass erased the partner's
 * freshly-held pen and the second of two Takes silently stole the first. */

/** Who may take the pen how: `take` only when it is free (or already held
 *  under my NAME — a re-take refreshes, and a take from a sibling pane or
 *  window of mine MOVES the pen to this session: one person, so no
 *  partner's pen is stolen, and the sibling stops holding it); `take-over`
 *  also when the holder's heartbeat is stale per {@link derivePen}, the
 *  same clock the pill reads. */
export type PenTakeMode = "take" | "take-over";

export function canTakePen(
  prev: CollabSidecar,
  me: string,
  mode: PenTakeMode,
  now = Date.now(),
): boolean {
  const holder = prev.pen.holder;
  if (!holder || holder === me) return true;
  return mode === "take-over" && derivePen(prev.pen, now).status === "stale";
}

/** Take (or take over) the pen for `me` in `session`: enable collab, join
 *  the roster and presence, become holder, drop my own pending request.
 *  `null` when the pen on disk is not takable in `mode`. */
export function takePenMutator(
  me: CollabIdentity,
  session: string,
  mode: PenTakeMode,
  clock: () => number = Date.now,
): CollabMutator {
  return (prev) => {
    const t = clock();
    if (!canTakePen(prev, me.name, mode, t)) return null;
    const now = new Date(t).toISOString();
    let next = ensureParticipant(prev, me);
    next = touchPresence(next, me.name, {}, session);
    return {
      ...next,
      enabled: true,
      pen: {
        holder: me.name,
        holderSession: session,
        since: now,
        lastHeartbeat: now,
        lastActivity: now,
        requestedBy: (prev.pen.requestedBy ?? []).filter(
          (r) => r.name !== me.name,
        ),
      },
    };
  };
}

/** Pass (put down) the pen — only the pen THIS session holds. `null` when
 *  someone else holds it on disk (it was taken over since the UI last
 *  polled, or moved to a sibling session of mine) or it is free. */
export function passPenMutator(self: CollabSelf): CollabMutator {
  return (prev) => {
    if (!holdsPen(prev.pen, self)) return null;
    return {
      ...prev,
      pen: {
        holder: null,
        holderSession: null,
        since: null,
        lastHeartbeat: null,
        lastActivity: null,
        requestedBy: [],
      },
    };
  };
}

/**
 * Move every trace of participant `from` onto identity `to` (task 1014) — the
 * pen holder, the pen's request queue, the presence entry (which carries the
 * focus claim and selections) and the participants roster. Pure; returns
 * `prev` itself when `from` appears nowhere (and the roster already carries
 * `to`'s colour), so a second application is a no-op — N panes on one paper
 * and N windows racing through {@link mutateCollab} converge.
 *
 * A COLOUR-ONLY change (`from === to.name`, task 1106) is the same door with
 * nothing to re-key: the pen and presence stay put and only the roster's
 * colour is rewritten — `prev` when it already carries `to.color`.
 *
 * Where `to` already has a slot (a stale entry from an earlier rename back),
 * the fresher presence heartbeat wins and the request queue keeps one entry.
 */
export function renameParticipant(
  prev: CollabSidecar,
  from: string,
  to: CollabIdentity,
): CollabSidecar {
  const renamed = from !== to.name;
  let next = prev;

  const pen = prev.pen;
  const requests = pen.requestedBy ?? [];
  if (renamed && (pen.holder === from || requests.some((r) => r.name === from))) {
    const seen = new Set<string>();
    const requestedBy = requests
      .map((r) => (r.name === from ? { ...r, name: to.name } : r))
      .filter((r) => (seen.has(r.name) ? false : (seen.add(r.name), true)));
    next = {
      ...next,
      pen: {
        ...pen,
        holder: pen.holder === from ? to.name : pen.holder,
        requestedBy,
      },
    };
  }

  const mine = renamed ? prev.presence[from] : undefined;
  if (mine) {
    const { [from]: _old, ...rest } = prev.presence;
    const theirs = rest[to.name];
    const keep =
      theirs && Date.parse(theirs.lastHeartbeat) > Date.parse(mine.lastHeartbeat)
        ? theirs
        : mine;
    next = { ...next, presence: { ...rest, [to.name]: keep } };
  }

  const old = renamed ? prev.participants.find((p) => p.name === from) : undefined;
  const existing = prev.participants.find((p) => p.name === to.name);
  if (old || (existing && existing.color !== to.color)) {
    // In place, keeping the roster's order: the old slot becomes the new
    // name (dropping a separate stale `to` slot, if any).
    const target = old ? from : to.name;
    next = {
      ...next,
      participants: prev.participants
        .filter((p) => !(old && p.name === to.name))
        .map((p) => (p.name === target ? { ...p, name: to.name, color: to.color } : p)),
    };
  }

  return next;
}


/** How long past a rename-ledger entry's `until` a trace of the released
 *  name is still taken to be this browser's: a write already in the queue
 *  when the rename landed stamps a moment just after it (task 1281). */
export const COLLAB_RENAME_GRACE_MS = 30_000;

/** Does any trace of `name` on the sidecar postdate `cutoff` (epoch ms)? */
function hasTraceAfter(
  sidecar: CollabSidecar,
  name: string,
  cutoff: number,
): boolean {
  const after = (iso: string | null | undefined) =>
    !!iso && Date.parse(iso) > cutoff;
  const pen = sidecar.pen;
  if (
    pen.holder === name &&
    (after(pen.since) || after(pen.lastHeartbeat) || after(pen.lastActivity))
  ) {
    return true;
  }
  if ((pen.requestedBy ?? []).some((r) => r.name === name && after(r.requestedAt))) {
    return true;
  }
  const entry = sidecar.presence[name];
  if (
    entry &&
    (after(entry.lastHeartbeat) ||
      after(entry.focusedCard?.lastHeartbeat) ||
      Object.values(entry.sessions ?? {}).some(after))
  ) {
    return true;
  }
  return sidecar.participants.some((p) => p.name === name && after(p.firstSeen));
}

/**
 * Bring a paper's sidecar up to date with this browser's identity `me`
 * (task 1281) — THE one door both migrations go through: the rename of a
 * MOUNTED paper (the identity subscription, which knows the outgoing name
 * for certain and passes it as `knownFrom`) and the repair of a paper that
 * was CLOSED during the rename (its next load, which has only the ledger).
 *
 * Every rename-ledger name is folded onto `me` through
 * {@link renameParticipant} (idempotent and merge-safe), then `me`'s own
 * roster colour is corrected. A ledger name is folded only when nothing of
 * it on disk postdates its release (+ {@link COLLAB_RENAME_GRACE_MS}): a
 * newer trace is someone else who has since taken that name on a shared
 * paper, and it stays theirs. Residual risk, accepted: a collaborator whose
 * clock runs behind ours by more than the gap since our rename could still
 * read as "old" — names are the sidecar's key, so this is the same
 * conflation two same-named people already have.
 *
 * Returns `prev` itself when there is nothing to change.
 */
export function adoptIdentity(
  prev: CollabSidecar,
  me: CollabIdentity,
  knownFrom?: string,
): CollabSidecar {
  let next = prev;
  if (knownFrom !== undefined && knownFrom !== me.name) {
    next = renameParticipant(next, knownFrom, me);
  }
  for (const released of me.previousNames ?? []) {
    if (released.name === me.name || released.name === knownFrom) continue;
    const until = Date.parse(released.until);
    if (!Number.isFinite(until)) continue;
    if (hasTraceAfter(next, released.name, until + COLLAB_RENAME_GRACE_MS)) continue;
    next = renameParticipant(next, released.name, me);
  }
  // The colour half (task 1106): a no-op unless my roster slot is off-colour.
  return renameParticipant(next, me.name, me);
}

/** {@link adoptIdentity} as a write-queue mutator: `null` when the sidecar on
 *  disk already reflects `me` (no write). */
export function adoptSelf(me: CollabIdentity, knownFrom?: string): CollabMutator {
  return (prev) => {
    const next = adoptIdentity(prev, me, knownFrom);
    return next === prev ? null : next;
  };
}
