/**
 * **The recovery offer** — the half of task 391 without which the mirror is a
 * write-only diary.
 *
 * A mirror is cleared by exactly one thing: a write that landed. So a mirror
 * that survives to the next open of a paper is, by construction, work that
 * never reached disk — a paused conflict the user reloaded through, a standing
 * preservation refusal, a crash, a closed laptop. This module is where that
 * fact is published and where the two things the user can do with it are
 * registered.
 *
 * ## Why an offer rather than an automatic restore
 *
 * Restoring writes the recovered model over the file on disk, and the file on
 * disk may be the newer copy — in the incident's own shape, a sync daemon had
 * just put a DIFFERENT version there. Choosing between two versions of the
 * user's writing is precisely the decision Virgil declines to make for them
 * (`sidecar-value.ts`'s rule for conflicted copies, one medium over). So the
 * offer states both sides and both are archived whichever way they answer.
 *
 * ## Fail-OPEN, deliberately
 *
 * The offer is raised whenever a mirror survives and its content differs from
 * what was loaded. The comparison is a fingerprint over the two models, and a
 * model that round-tripped through `.tex` and back is not guaranteed to be
 * byte-identical to the one the editor held — so a needless offer is possible.
 * That is the right direction: a needless offer costs one click, a withheld
 * one costs the writing. Same asymmetry every gate in this codebase takes.
 *
 * Same store shape as `preservation-notice.ts`, and the same reason: the fact
 * is produced deep in the load path and consumed by a topbar badge with no
 * call relationship to it.
 */

import type { EmergencyMirrorEntry } from "@/lib/emergency-mirror";

export interface MirrorRecoveryOffer {
  docId: string;
  /** The mirrored model, ready to restore. */
  entry: EmergencyMirrorEntry;
}

/** What a doc's badge can do. Registered by `useDocument`, which owns both the
 *  write handle and the editor — the `registerDocActions` shape. */
export interface MirrorRecoveryActions {
  /**
   * Write the recovered model over the file on disk and reload the editor from
   * it. Archives BOTH sides to `virgil/.history/` first, so the answer is
   * reversible either way. Resolves `true` when the restore actually landed.
   */
  restore(): Promise<boolean>;
  /** Keep what is on disk and drop the mirror. */
  discard(): Promise<void>;
}

const offers = new Map<string, MirrorRecoveryOffer>();
const actions = new Map<string, MirrorRecoveryActions>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

export function subscribeMirrorRecovery(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getRecoveryOffer(
  docId: string | null | undefined,
): MirrorRecoveryOffer | null {
  if (!docId) return null;
  return offers.get(docId) ?? null;
}

export function offerMirrorRecovery(entry: EmergencyMirrorEntry): void {
  const prev = offers.get(entry.docId);
  if (prev && prev.entry.hash === entry.hash) return;
  offers.set(entry.docId, Object.freeze({ docId: entry.docId, entry }));
  emit();
}

export function clearRecoveryOffer(docId?: string): void {
  if (docId === undefined) {
    if (offers.size === 0) return;
    offers.clear();
  } else if (!offers.delete(docId)) {
    return;
  }
  emit();
}

/** Token-matched register/unregister — a stale registration must not evict the
 *  live one (the `pending-saves` / `doc-pipeline` shape). */
export function registerRecoveryActions(
  docId: string,
  a: MirrorRecoveryActions,
): () => void {
  actions.set(docId, a);
  return () => {
    if (actions.get(docId) === a) actions.delete(docId);
  };
}

export function getRecoveryActions(
  docId: string | null | undefined,
): MirrorRecoveryActions | null {
  if (!docId) return null;
  return actions.get(docId) ?? null;
}

/** Test helper. */
export function __resetMirrorRecoveryForTests(): void {
  offers.clear();
  actions.clear();
  listeners.clear();
}
