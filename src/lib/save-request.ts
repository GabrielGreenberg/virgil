/**
 * **"Save now" — the door, and where it goes when it can't** (task 392).
 *
 * Gabriel's ask after the 2026-08-19 data loss: *a save button that becomes
 * available whenever things haven't been auto-saved.* The surgical reading of
 * that is a button wired to `flushPending`, and it is the wrong one — it would
 * have reported success throughout that exact incident, because **a refused
 * write returns normally** (task 357 hole 4). So this module states the two
 * rules that make the button honest:
 *
 * > **1. The report is the CHANNEL, never the absence of a throw.** The door
 * > returns whether the write LANDED, read off `unsaved-work.ts` after the
 * > attempt — the same rule `keepMineOverDisk` and the reload door already
 * > follow.
 * >
 * > **2. A Save that cannot land ROUTES; it does not re-refuse.** A blocked
 * > write is blocked by a flow that belongs to some other surface — the 364
 * > conflict doors, the 357 acknowledge dialog — and answering it is a
 * > decision only the user can make. So the button asks that surface to open
 * > itself rather than either re-attempting into the same wall or, worse,
 * > forcing the write past the guard that stopped it. A Save that silently
 * > re-refuses is this incident's silence with a button on it.
 *
 * ## Why a registry rather than a prop
 *
 * The door lives inside `useDocument` (only it holds the model, the debounce
 * and the delimiter stash), and the callers are the topbar badge and an
 * app-level Cmd+S handler — neither of which is anywhere near that hook in the
 * tree. This is the same shape `registerPendingFlusher` / `registerDocActions`
 * / `registerRecoveryActions` already have, keyed per document for the same
 * reason they are: N `EditorPane`s are mounted at once under multi-doc
 * keep-alive, so "the current doc" is not a module-level fact
 * (AGENTS.md → "Per-doc services under multi-pane keep-alive"). Each entry
 * disposes identity-guarded, so an evicted pane can never null out a live one.
 */

import type { UnsavedBlockReason } from "./unsaved-work";
import { describeBlockReason, type BlockingFlow } from "./save-state";

/** What a manual save attempt did. `reason` is present iff it did not land. */
export type SaveAttemptOutcome =
  | { landed: true }
  | { landed: false; reason: UnsavedBlockReason | "no-door" };

/** The door a document's pipeline publishes. Returns the OUTCOME, so no
 *  caller has to infer landing from the absence of a throw. */
export type SaveDoor = () => Promise<SaveAttemptOutcome>;

const doors = new Map<string, SaveDoor>();

/**
 * Publish this document's manual-save door. Identity-guarded disposal: an
 * unmounting pane removes only its OWN entry, so evicting an LRU tail cannot
 * disarm a live pane's Save button.
 */
export function registerSaveDoor(docId: string, door: SaveDoor): () => void {
  doors.set(docId, door);
  return () => {
    if (doors.get(docId) === door) doors.delete(docId);
  };
}

/** Is there a door for this document? The button's own mount gate does NOT
 *  ask this — it asks the channel — but the census and the tests do. */
export function hasSaveDoor(docId: string | null | undefined): boolean {
  return !!docId && doors.has(docId);
}

/**
 * Ask this document to save NOW.
 *
 * With no door registered the answer is `no-door` rather than a thrown error
 * or a cheerful `landed: true`: a Cmd+S with no paper open, or fired at a
 * pipeline mid-teardown, must not report work safe that nobody wrote.
 */
export async function requestSaveNow(
  docId: string | null | undefined,
): Promise<SaveAttemptOutcome> {
  const door = docId ? doors.get(docId) : undefined;
  if (!door) return { landed: false, reason: "no-door" };
  return door();
}

// ── The blocking-flow channel ──────────────────────────────────────────────
//
// When the door reports a reason that NAMES a flow, the caller asks that
// flow's owning surface to open. The request is a monotonic token rather than
// a callback registry, deliberately: the surfaces are already mounted and
// already own their own menu state, so all they need is "you were asked" —
// and a token cannot leak a stale opener the way a registered callback can.

export interface BlockingFlowRequest {
  docId: string;
  flow: BlockingFlow;
  /** Monotonic. A surface opens when it sees a token it has not answered. */
  seq: number;
}

let latest: BlockingFlowRequest | null = null;
let seq = 0;
const listeners = new Set<() => void>();

export function subscribeBlockingFlow(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The standing request, or `null`. Identity-stable between requests. */
export function getBlockingFlowRequest(): BlockingFlowRequest | null {
  return latest;
}

/**
 * Ask the surface that owns `flow` to open itself for this document.
 * Returns `false` when the reason names no flow (an error tier has a next
 * attempt, not a dialog), so a caller can tell "routed" from "nothing to open".
 */
export function requestBlockingFlow(
  docId: string,
  reason: UnsavedBlockReason,
): boolean {
  const flow = describeBlockReason(reason).flow;
  if (!flow) return false;
  latest = { docId, flow, seq: ++seq };
  for (const fn of listeners) fn();
  return true;
}

/** Test seam — drop any standing request. Never called from production. */
export function resetBlockingFlowRequests(): void {
  latest = null;
  seq = 0;
  for (const fn of listeners) fn();
}
