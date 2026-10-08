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
  derivePen,
  ensureParticipant,
  touchPresence,
  type CollabIdentity,
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
 * The leave-the-paper mutator: clear MY pen if I hold it and drop MY presence
 * key — nothing else. Applied to the fresh disk read, so a partner's pen
 * request, presence or claim that landed since our last poll survives.
 * Returns `null` when there is nothing of mine to remove.
 */
export function releaseSelf(me: string): CollabMutator {
  return (prev) => {
    if (!prev.enabled) return null;
    let next = prev;
    if (prev.pen.holder === me) {
      next = {
        ...next,
        pen: {
          ...next.pen,
          holder: null,
          since: null,
          lastHeartbeat: null,
          lastActivity: null,
        },
      };
    }
    if (next.presence[me]) {
      const { [me]: _gone, ...rest } = next.presence;
      next = { ...next, presence: rest };
    }
    return next === prev ? null : next;
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

/** Who may take the pen how: `take` only when it is free (or already
 *  mine — a re-take refreshes); `take-over` also when the holder's
 *  heartbeat is stale per {@link derivePen}, the same clock the pill reads. */
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

/** Take (or take over) the pen for `me`: enable collab, join the roster and
 *  presence, become holder, drop my own pending request. `null` when the
 *  pen on disk is not takable in `mode`. */
export function takePenMutator(
  me: CollabIdentity,
  mode: PenTakeMode,
  clock: () => number = Date.now,
): CollabMutator {
  return (prev) => {
    const t = clock();
    if (!canTakePen(prev, me.name, mode, t)) return null;
    const now = new Date(t).toISOString();
    let next = ensureParticipant(prev, me);
    next = touchPresence(next, me.name, {});
    return {
      ...next,
      enabled: true,
      pen: {
        holder: me.name,
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

/** Pass (put down) the pen — only MY pen. `null` when someone else holds
 *  it on disk (it was taken over since the UI last polled) or it is free. */
export function passPenMutator(me: string): CollabMutator {
  return (prev) => {
    if (prev.pen.holder !== me) return null;
    return {
      ...prev,
      pen: {
        holder: null,
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
 * Where `to` already has a slot (a stale entry from an earlier rename back),
 * the fresher presence heartbeat wins and the request queue keeps one entry.
 */
export function renameParticipant(
  prev: CollabSidecar,
  from: string,
  to: CollabIdentity,
): CollabSidecar {
  if (from === to.name) return prev;
  let next = prev;

  const pen = prev.pen;
  const requests = pen.requestedBy ?? [];
  if (pen.holder === from || requests.some((r) => r.name === from)) {
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

  const mine = prev.presence[from];
  if (mine) {
    const { [from]: _old, ...rest } = prev.presence;
    const theirs = rest[to.name];
    const keep =
      theirs && Date.parse(theirs.lastHeartbeat) > Date.parse(mine.lastHeartbeat)
        ? theirs
        : mine;
    next = { ...next, presence: { ...rest, [to.name]: keep } };
  }

  const old = prev.participants.find((p) => p.name === from);
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

/** {@link renameParticipant} as a write-queue mutator: `null` when nothing
 *  of `from`'s is on disk (no write). */
export function renameSelf(from: string, to: CollabIdentity): CollabMutator {
  return (prev) => {
    const next = renameParticipant(prev, from, to);
    return next === prev ? null : next;
  };
}
