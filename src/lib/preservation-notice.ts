/**
 * **The refusal channel** — task 357, hole 4.
 *
 * Virgil has two preservation gates. 350-D's gate refuses the automatic
 * load-writeback; 357's gate ([write-preservation.ts](write-preservation.ts))
 * refuses any bundle write that lands before the user has genuinely edited.
 * Both were correct about the `.tex` and **inert about the user**: each
 * `console.error`d on a fire-and-forget promise, `readDocBundle` returned the
 * lossy content anyway, the editor mounted it, and the next gesture that
 * counted as a user edit persisted exactly what had just been refused.
 *
 * > **A refusal is a fact about the DOCUMENT, not a log line.** It is
 * > published once, to one store; the automatic-write step-aside is SUSPENDED
 * > while it stands; and it reaches the user, who is the only one who can
 * > decide what to do about it.
 *
 * ## Why a store rather than a return value
 *
 * The refusal is produced deep inside a storage backend, on a promise nobody
 * awaits (the load-writeback is deliberately fire-and-forget so the editor can
 * open), and it is consumed by a topbar pill and by the save path — two
 * readers with no call relationship to the producer. Threading a return value
 * would reach one of them at best. So the operation is PUBLISHED and the
 * readers ask; the same shape the `DiskWatcher`'s external-change store has,
 * and read by React through the same `useSyncExternalStore` door.
 *
 * ## The posture, and why it is write-gating rather than read-only
 *
 * While a notice stands unacknowledged the document is **write-protected**:
 * every automatic `.tex` + `virgil.json` write is measured and refused, and
 * the 350-D step-aside ("after a real user edit the model is theirs") does NOT
 * apply — that rationale assumes the model faithfully represents the file, and
 * a refusal is precisely the evidence that it does not.
 *
 * The editor stays EDITABLE. The danger is exclusively what reaches DISK, and
 * the file on disk is intact no matter what the user does in the editor; a
 * read-only posture would additionally take away the two things they most need
 * (copying text out, and reading the source in the code view) while claiming a
 * stronger diagnosis than the gate can support — the model is short of the
 * file, not meaningless.
 *
 * ## Acknowledgment
 *
 * `acknowledge()` is the user's informed choice: from then on the gate steps
 * aside for this document and their edits save normally. It cannot silently
 * cost them the missing bytes, because the FIRST refusal already took an
 * unconditional forensic snapshot of the intact bundle (the backends do that
 * on the `armed` return below, bypassing the autosave snapshot rate-limit) —
 * so the pre-refusal file is in `virgil/.history/` before any acknowledged
 * write can overwrite it.
 *
 * A notice is SESSION-scoped and per document: a fresh load re-derives it, so
 * nothing is persisted and nothing can go stale.
 */

/** Which gate refused. The FIRST refusal's source is the one recorded — it is
 *  the one that describes what went wrong (a load refusal means the parse
 *  could not represent the file; a write refusal means the model shrank). */
export type PreservationRefusalSource = "load" | "write";

/** The measured shape of a refusal, shared by both gates' verdicts. */
export interface PreservationRefusalDetail {
  source: PreservationRefusalSource;
  region: "body" | "preamble";
  /** Content words in that region BEFORE (the bytes the doc was loaded from). */
  before: number;
  /** Content words the refused write would have left. */
  after: number;
  lost: number;
  allowed: number;
}

export interface PreservationNotice extends PreservationRefusalDetail {
  docId: string;
  /** ms epoch of the FIRST refusal for this doc since it was loaded. */
  at: number;
  /** How many writes have been refused since — the autosave retries. */
  refusals: number;
  /** The user chose to save anyway; the gate steps aside from here on. */
  acknowledged: boolean;
}

const byDoc = new Map<string, PreservationNotice>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

/** Subscribe to any change in any doc's notice. `useSyncExternalStore` shape:
 *  the per-doc snapshot getter below returns a FROZEN object that changes
 *  identity only when that doc's notice actually changes, so a subscriber for
 *  doc A re-renders on a doc B change and then bails on an equal snapshot. */
export function subscribePreservationNotices(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The live notice for a doc, or `null` when it has none. Stable identity. */
export function getPreservationNotice(
  docId: string | null | undefined,
): PreservationNotice | null {
  if (!docId) return null;
  return byDoc.get(docId) ?? null;
}

/**
 * Publish a refusal. Returns `armed: true` only for the FIRST refusal since
 * this document was loaded — the caller takes its unconditional forensic
 * snapshot on that edge and not on the autosave's every-1500 ms retry, which
 * would otherwise re-snapshot identical bytes for as long as the notice stands.
 *
 * A refusal that arrives while the user has already ACKNOWLEDGED is dropped:
 * they made the call, and re-arming the posture behind them would make the
 * acknowledgment mean nothing.
 */
export function recordPreservationRefusal(
  docId: string,
  detail: PreservationRefusalDetail,
): { armed: boolean } {
  const prev = byDoc.get(docId);
  if (prev?.acknowledged) return { armed: false };
  if (prev) {
    byDoc.set(docId, Object.freeze({ ...prev, refusals: prev.refusals + 1 }));
    emit();
    return { armed: false };
  }
  byDoc.set(
    docId,
    Object.freeze({
      docId,
      ...detail,
      at: Date.now(),
      refusals: 1,
      acknowledged: false,
    }),
  );
  emit();
  return { armed: true };
}

/**
 * Is this document write-protected — i.e. does a refusal stand that the user
 * has not answered? While true, EVERY automatic write is measured, including
 * one issued after a real user edit.
 */
export function isWriteProtected(docId: string | null | undefined): boolean {
  const n = getPreservationNotice(docId);
  return n !== null && !n.acknowledged;
}

/** Has the user made the informed choice to write this document anyway? */
export function isPreservationAcknowledged(
  docId: string | null | undefined,
): boolean {
  return getPreservationNotice(docId)?.acknowledged === true;
}

/** The user's informed choice. Idempotent; a no-op for a doc with no notice. */
export function acknowledgePreservationNotice(docId: string): void {
  const n = byDoc.get(docId);
  if (!n || n.acknowledged) return;
  byDoc.set(docId, Object.freeze({ ...n, acknowledged: true }));
  emit();
}

/**
 * Drop a doc's notice. Called at every `readDocBundle` (through
 * `retainLoadedCounts`, the ONE door, so the two halves of this gate cannot
 * disagree about what a fresh load means) and available to tests. A fresh load
 * is a fresh document: the writeback that follows re-arms the notice if the
 * parse is still lossy.
 */
export function clearPreservationNotice(docId?: string): void {
  if (docId === undefined) {
    if (byDoc.size === 0) return;
    byDoc.clear();
  } else if (!byDoc.delete(docId)) {
    return;
  }
  emit();
}
