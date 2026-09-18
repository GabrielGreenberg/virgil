/**
 * **The SIDECAR refusal channel** — task 630.
 *
 * The write-path law governs the `.tex` (the user's only copy) and gives every
 * gate that refuses it ONE channel to the user
 * ([preservation-notice.ts](preservation-notice.ts)). The paper's `virgil/`
 * sidecars — the AI-request inbox, the bib-review queue, the card panels — had
 * no such channel. Their writers were optimistic (React state moves first, the
 * disk write is fire-and-forget) and every path on which the write did NOT
 * happen ended at a `console.error` or at nothing at all:
 *
 *   - no active write handle (a pipeline swap, a paper not open for writing);
 *   - a host that refuses the file (a `library-paper:` doc in the Reader may
 *     persist only its derived writable set — `host-writability.ts`);
 *   - a real write failure (permission revoked, quota, an FSA throw).
 *
 * On all three the row appeared in the panel, lit its dot, and was simply GONE
 * on the next reload, with nothing said. The audit found the same swallow in
 * three places across two hooks.
 *
 * > **A sidecar write that did not land is a fact about the DOCUMENT, not a log
 * > line.** It is published once, to one store, and it reaches the user —
 * > through the same band every other interrupted-document state speaks from
 * > (`document-interruption.ts`, kind `sidecar-refused`).
 *
 * ## Why a store rather than a return value
 *
 * The same reason `preservation-notice.ts` is one: the fact is produced on a
 * promise nobody awaits (an optimistic mutation, a fire-and-forget bridge call)
 * and consumed by a band that has no call relationship to the producer.
 * Threading a return value would reach one caller at best — and it is exactly
 * the callers that swallowed it.
 *
 * ## What a publisher supplies, and what it does not
 *
 * It supplies the NOUN (`what`: "AI request", "bibliography review") and the
 * REASON, because only the writer knows those. It does not supply SENTENCES:
 * the copy is composed once, in `document-interruption.ts`, beside every other
 * interruption's copy — the same split `describePreservation` makes, where the
 * gate contributes its measurement and the presenter contributes the words.
 *
 * It also does not supply the FILENAME. The one sidecar with a serialized
 * authority keeps its filename module-private on purpose
 * (`ai-requests-store.ts`, pinned by `ai-requests-authority.test.ts`: a name
 * that can travel is a name a writer can address the file with), so a channel
 * keyed on filenames would hand that name back out for nothing — the user does
 * not need it, and neither does the band.
 *
 * A refusal is SESSION-scoped and per document: nothing is persisted, so
 * nothing can go stale. It clears when the user acknowledges it, or when the
 * doc is closed.
 */

/** Why a sidecar write did not land. */
export type SidecarRefusalReason =
  /** No active write handle for this doc — nothing to write through. */
  | "no-handle"
  /** The host refuses this file for this doc (a Reader/library paper). */
  | "read-only"
  /** The write was attempted and threw. */
  | "failed";

export interface SidecarRefusal {
  docId: string;
  /**
   * What the user was doing, as a short noun phrase in their words ("AI
   * request", "bibliography review"). The band builds its sentences around it.
   */
  what: string;
  reason: SidecarRefusalReason;
  /** The thrown error's message, for `failed` only — the one thing the app
   *  knows that the reason alone cannot say. */
  detail?: string;
  /** ms epoch of the FIRST refusal for this doc since it was last cleared. */
  at: number;
  /** How many refusals have been recorded for this doc since. */
  refusals: number;
}

const byDoc = new Map<string, SidecarRefusal>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

/** Subscribe to any change in any doc's refusal. `useSyncExternalStore` shape:
 *  the per-doc snapshot getter below returns a FROZEN object whose identity
 *  changes only when that doc's refusal does, so a subscriber for doc A
 *  re-renders on a doc B refusal and then bails on an equal snapshot. */
export function subscribeSidecarRefusals(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The standing refusal for a doc, or `null`. Stable identity. */
export function getSidecarRefusal(
  docId: string | null | undefined,
): SidecarRefusal | null {
  if (!docId) return null;
  return byDoc.get(docId) ?? null;
}

/**
 * Publish a refusal. The FIRST one for a doc is the one that describes what
 * went wrong and keeps its `at`; later ones bump the count and adopt the newest
 * reason/noun, so a user who files three requests against a read-only paper
 * sees one band, not three — the same "first refusal wins the story, the count
 * says how often" shape `preservation-notice.ts` has.
 *
 * Returns the live refusal so a caller can log or assert on it.
 */
export function recordSidecarRefusal(args: {
  docId: string | null | undefined;
  what: string;
  reason: SidecarRefusalReason;
  detail?: string;
  now?: number;
}): SidecarRefusal | null {
  const { docId, what, reason, detail } = args;
  if (!docId) return null;
  const prev = byDoc.get(docId);
  const next: SidecarRefusal = Object.freeze({
    docId,
    what,
    reason,
    ...(detail ? { detail } : {}),
    at: prev?.at ?? (args.now ?? Date.now()),
    refusals: (prev?.refusals ?? 0) + 1,
  });
  byDoc.set(docId, next);
  emit();
  return next;
}

/**
 * The user has seen it. There is deliberately no "retry": the mutation that was
 * refused is gone — it lived in a closure over state that has since been
 * reconciled from disk — so the only honest offer is "understood", and the next
 * attempt is the user making the edit again.
 */
export function clearSidecarRefusal(docId: string | null | undefined): void {
  if (!docId) return;
  if (!byDoc.delete(docId)) return;
  emit();
}

/** Drop every refusal — doc teardown and test isolation. */
export function resetSidecarRefusals(): void {
  if (byDoc.size === 0) return;
  byDoc.clear();
  emit();
}
