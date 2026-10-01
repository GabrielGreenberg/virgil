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
