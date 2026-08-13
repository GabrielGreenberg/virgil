/**
 * THE serialized authority for `ai-requests.json` (task 220).
 *
 * The inbox has two in-app writers — the live hook (`useAiRequests`: drafts,
 * style-merges, manual requests) and the card-flag bridge
 * (`bridgeCardAiRequestFlag`, fired from the per-panel hooks) — plus a THIRD,
 * out-of-app writer: the `/editor/*` skills, which read-modify-write the file
 * straight on disk while the paper is open.
 *
 * Before this module those writers had structurally INCOMPATIBLE persistence
 * models, and the mismatch was silent in both directions:
 *
 *   - the hook persisted its WHOLE in-memory snapshot, derived from React
 *     `prev` state with no read-merge against disk — so it overwrote anything
 *     written since its own last read, and it never published, so nothing else
 *     learned about the write;
 *   - the bridge read-modify-wrote, but its `readSidecar` ran OUTSIDE the
 *     serialized write critical section, so a write landing between its read
 *     and its own write was merged away from a base that no longer existed.
 *
 * Neither is a type error, neither throws, and no round-trip suite catches
 * either: each writer is internally consistent and only ever wrong about what
 * the OTHER one did.
 *
 * > **Every mutation of `ai-requests.json` is a pure function of the list as it
 * > is ON DISK at the moment of the write, computed inside the serialized write
 * > critical section, and every writer PUBLISHES the authoritative post-write
 * > list.** Nothing persists a whole snapshot it computed earlier from state it
 * > merely hopes is current.
 *
 * Two halves, and the second is what makes the first hold for more than one
 * window. `mutateAiRequests` is the write authority (serialization +
 * merge-from-disk + publish); the in-process `publishAiRequests` bus reaches
 * only THIS window, so `useAiRequests` also re-hydrates from disk on the
 * `SidecarWatcher`'s external-change signal — the same channel
 * `usePersistentState` rides, and the reason a peer window's write (or a
 * skill's) converges rather than being clobbered by the next local mutation.
 *
 * Every write door is here. Nothing else in `src/` may name the filename —
 * pinned by `ai-requests-authority.test.ts`, the guard that catches the shape
 * this module exists to retire: not a broken writer, but a call site that never
 * asked the authority.
 */

import { mutateSidecar, readSidecar } from "@/lib/storage";
import type { AiRequest, AiRequestsState } from "@/lib/types";
import {
  getActiveHandle,
  isStalePipelineError,
} from "@/lib/multi-window/doc-pipeline";
import { publishAiRequests } from "@/lib/ai-request-events";

/**
 * The one spelling of the sidecar filename — deliberately module-PRIVATE.
 *
 * It was exported in this task's first cut, and that quietly reopened the hole
 * the census below exists to close: with the name importable, a call site can
 * write `mutateSidecar(handle, AI_REQUESTS_FILE, …)`, spell no literal, and pass
 * every leg of the census while bypassing `mutateAiRequests` entirely — so it
 * never publishes, which is the whole drop-D3 half of the original defect. The
 * census asks "who spells the filename"; the law is "who WRITES the file", and
 * those two coincide only while the name cannot travel.
 *
 * Its one legitimate consumer outside this module (the hook's sidecar-changed
 * filter) does not need the NAME, only the QUESTION — so it gets
 * {@link isAiRequestsFile} instead. Publish whole operations, never the pieces.
 */
const AI_REQUESTS_FILE = "ai-requests.json";

/**
 * Is this `SidecarWatcher` event about the inbox? The predicate form of the
 * private filename above: it answers the only question a reader outside this
 * module has, without handing out a name a writer could address the file with.
 */
export function isAiRequestsFile(filename: string): boolean {
  return filename === AI_REQUESTS_FILE;
}

const EMPTY: AiRequestsState = { requests: [] };

/**
 * A mutation of the inbox: a PURE function from the current list to the next
 * one, or `null` for "nothing to change" (no write, no publish).
 *
 * Purity is load-bearing rather than stylistic. The function runs while the
 * doc lock is held, and a caller that also applies it optimistically to React
 * state runs it a SECOND time against a different base — so it must close over
 * everything it needs (a pre-built request object, a pre-built id map) and
 * must not mint ids, read the clock, or touch storage itself.
 */
export type AiRequestsMutator = (requests: AiRequest[]) => AiRequest[] | null;

/** Tolerate a backend that resolves a missing sidecar to null/undefined, or a
 *  file whose `requests` key is not an array (hand-edited / older shape). */
function requestsOf(state: AiRequestsState | null | undefined): AiRequest[] {
  return Array.isArray(state?.requests) ? state.requests : [];
}

/**
 * Read the inbox from disk. A DIRECT read (bypasses the sidecar bundle cache),
 * so both the mount load and the external-change re-hydrate see the file as it
 * actually is. Resolves `[]` for an absent file; re-throws a real read error so
 * a caller can leave its state untouched rather than blanking the inbox.
 */
export async function readAiRequests(docId: string): Promise<AiRequest[]> {
  return requestsOf(
    await readSidecar<AiRequestsState>(docId, AI_REQUESTS_FILE, EMPTY),
  );
}

/**
 * Apply `mutate` to the inbox through the serialized read-modify-write door and
 * announce the result.
 *
 * Resolves the authoritative post-write list, or `null` when nothing was
 * persisted — a declined mutation (`mutate` returned `null`), no doc, no active
 * write handle, a read-only library paper, or a failed write. Best-effort by
 * contract: this never throws (its callers are UI event handlers and a
 * fire-and-forget bridge), and it publishes ONLY after a write that actually
 * landed, so the in-memory inbox can never diverge from the on-disk queue in
 * the direction that matters.
 */
export async function mutateAiRequests(
  docId: string | null,
  mutate: AiRequestsMutator,
): Promise<AiRequest[] | null> {
  if (!docId) return null;
  const handle = getActiveHandle(docId);
  if (!handle) return null;

  let next: AiRequestsState | null;
  try {
    next = await mutateSidecar<AiRequestsState>(
      handle,
      AI_REQUESTS_FILE,
      EMPTY,
      (current) => {
        const updated = mutate(requestsOf(current));
        return updated === null ? null : { requests: updated };
      },
    );
  } catch (err) {
    if (isStalePipelineError(err)) return null;
    console.error("Failed to persist ai requests:", err);
    return null;
  }
  if (next === null) return null;

  // Announce the authoritative post-write list so every live reader in THIS
  // window (the inbox hook) adopts it without a disk round-trip. Only after a
  // successful persist — a failed write leaves the on-disk queue unchanged, so
  // the in-memory inbox must not diverge from it.
  publishAiRequests(docId, next.requests);
  return next.requests;
}
