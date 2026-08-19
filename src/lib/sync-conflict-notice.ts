/**
 * **The sync-conflict notice channel** (task 363) — the store the scan
 * publishes to and the topbar reads.
 *
 * Same shape and the same reasons as `preservation-notice.ts`: the fact is
 * produced deep in a storage-backed scan on a fire-and-forget promise at
 * doc-open, and consumed by a topbar pill with no call relationship to the
 * producer, so it is PUBLISHED and the reader asks — through the same
 * `useSyncExternalStore` door.
 *
 * Two things it deliberately does NOT share with the preservation notice:
 *
 * - It is **not write-gating**. A conflicted sibling says something about the
 *   FOLDER, not about the fidelity of the model Virgil holds — the file Virgil
 *   owns is intact and its own writes are correct. Refusing to save on this
 *   evidence would take the user's work hostage over a sync service's
 *   bookkeeping.
 * - It is **dismissible**, and it has to be. The folder this was filed from
 *   holds 197 forks accumulated over four months, and cleaning them up is a
 *   Finder job Virgil cannot do for the user (see the note on cleanup in
 *   [sync-conflict.ts](sync-conflict.ts)). A notice that cannot be dismissed
 *   would be a permanent banner, which is how a real signal becomes furniture.
 *
 * Session-scoped and per document: a fresh activation re-scans, so nothing is
 * persisted and nothing can go stale. A dismissal lasts for the session — it is
 * the user saying "I have seen this folder's forks", and a re-scan on every tab
 * switch would otherwise re-raise the same 197.
 */

import type { SyncConflictReport } from "@/lib/sync-conflict";

export interface SyncConflictNotice extends SyncConflictReport {
  docId: string;
}

const byDoc = new Map<string, SyncConflictNotice>();
const dismissed = new Set<string>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

export function subscribeSyncConflictNotices(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The live notice for a doc, or `null` when it has none (or it was dismissed).
 *  Stable identity — the stored object is frozen and replaced, never mutated. */
export function getSyncConflictNotice(
  docId: string | null | undefined,
): SyncConflictNotice | null {
  if (!docId || dismissed.has(docId)) return null;
  return byDoc.get(docId) ?? null;
}

/**
 * Publish a scan result. A report with nothing to say CLEARS any standing
 * notice rather than leaving a stale one — the user may have cleaned the folder
 * between two activations, and the notice must be able to go away by itself.
 */
export function recordSyncConflictReport(
  docId: string,
  report: SyncConflictReport,
): void {
  if (report.total === 0 && report.swapFiles.length === 0) {
    if (byDoc.delete(docId)) emit();
    return;
  }
  byDoc.set(docId, Object.freeze({ docId, ...report }));
  emit();
}

/** The user has seen it. Lasts for the session; a reload re-raises. */
export function dismissSyncConflictNotice(docId: string): void {
  if (dismissed.has(docId)) return;
  dismissed.add(docId);
  emit();
}

/** Test/teardown door. Clears both the notices and the dismissals. */
export function clearSyncConflictNotices(docId?: string): void {
  if (docId === undefined) {
    if (byDoc.size === 0 && dismissed.size === 0) return;
    byDoc.clear();
    dismissed.clear();
  } else {
    const had = byDoc.delete(docId);
    const wasDismissed = dismissed.delete(docId);
    if (!had && !wasDismissed) return;
  }
  emit();
}
