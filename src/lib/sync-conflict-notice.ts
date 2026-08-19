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
 * Session-scoped and per document: every scan re-derives, so nothing is
 * persisted and nothing can go stale.
 *
 * ## What a dismissal actually dismisses
 *
 * A dismissal is keyed on the report's SIGNATURE, not on the document. What the
 * user dismissed is a particular folder STATE — "I have seen these forks" — and
 * Virgil is a PWA that stays open for days while a daemon keeps minting them.
 * Keyed on the docId alone, dismissing the 197 forks that were there at 9am
 * would silence a fork of `notes.json` minted at 4pm, on the one file where
 * silence is the thing this whole surface exists to end. Keyed on the
 * signature, an unchanged folder stays quiet through any number of re-scans and
 * a genuinely NEW fork re-raises.
 */

import type { SyncConflictReport } from "@/lib/sync-conflict";

export interface SyncConflictNotice extends SyncConflictReport {
  docId: string;
  /** The folder state this report describes — see {@link dismissSyncConflictNotice}. */
  signature: string;
}

const byDoc = new Map<string, SyncConflictNotice>();
/** docId → the signature the user dismissed. */
const dismissed = new Map<string, string>();
const listeners = new Set<() => void>();

/**
 * What the user is dismissing: the exact set of sibling FILES the scan found.
 * Names rather than counts, so a fork replacing another (a daemon re-forking a
 * file it already forked) re-raises rather than reading as "same number, still
 * dismissed". Swap debris is included: it never raises a pill on its own, but a
 * report that is otherwise identical and has gained debris has still changed.
 */
function signatureOf(r: SyncConflictReport): string {
  const names = [
    ...r.groups.flatMap((g) => g.siblings.map((s) => s.name)),
    ...r.swapFiles,
  ];
  return names.sort().join("\u0000");
}

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
  if (!docId) return null;
  const notice = byDoc.get(docId);
  if (!notice) return null;
  return dismissed.get(docId) === notice.signature ? null : notice;
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
    // A folder the user cleaned: drop the notice AND the dismissal, so a fork
    // minted later is judged on its own signature rather than against a stale
    // one.
    const had = byDoc.delete(docId);
    const wasDismissed = dismissed.delete(docId);
    if (had || wasDismissed) emit();
    return;
  }
  const next = Object.freeze({ docId, ...report, signature: signatureOf(report) });
  const prev = byDoc.get(docId);
  if (prev && prev.signature === next.signature) return; // identical scan — no churn
  byDoc.set(docId, next);
  emit();
}

/** The user has seen THIS folder state. A later scan that finds the same files
 *  stays quiet; one that finds a different set re-raises. A reload re-raises
 *  everything (nothing is persisted). A no-op for a doc with no notice — there
 *  is no signature to record. */
export function dismissSyncConflictNotice(docId: string): void {
  const notice = byDoc.get(docId);
  if (!notice || dismissed.get(docId) === notice.signature) return;
  dismissed.set(docId, notice.signature);
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
