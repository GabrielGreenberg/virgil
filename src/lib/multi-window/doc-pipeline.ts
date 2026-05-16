/**
 * Per-doc write-pipeline registry.
 *
 * Every doc that's currently mounted in this window has exactly one
 * active *pipeline* — the lifecycle bracket between "we loaded this doc"
 * and "we're done with this doc". A pipeline issues a `DocWriteHandle`
 * that the doc's React subtree carries through Context. Every storage
 * writer demands the handle and rejects writes whose pipelineId no
 * longer matches the one currently registered for that docId.
 *
 * Why: a debounced or in-flight write that lands AFTER the user switched
 * away can otherwise pick up the wrong destination from a stale ref and
 * corrupt the new doc with the old doc's content. Pinning the destination
 * to the pipelineId the closure was authored under makes the storage
 * layer mathematically refuse cross-doc overwrite.
 *
 * Pipelines and `withDocLock` (Web Locks) are orthogonal:
 *  - The lock is the cross-window writer-exclusion primitive.
 *  - The pipeline is the in-window staleness guard for closures and
 *    queued tasks that survive a doc switch.
 */

/**
 * Pipelines pending end. React StrictMode (dev) and Fast Refresh (HMR)
 * synchronously unmount then remount the same component — if we deleted
 * the pipeline immediately on `endDocPipeline`, the remount would create
 * a NEW pipeline, and any closure captured between unmount-cleanup and
 * remount would write under a stale handle.
 *
 * Instead we DEFER the delete to a microtask. If the same pipelineId is
 * begun again within that window (the common StrictMode/HMR case), we
 * cancel the deferred delete and the pipeline survives — same handle,
 * same pipelineId, no closure invalidation. When the microtask actually
 * fires (real unmount, no remount), we drop the entry. The microtask
 * also re-checks the current active value before deleting, so a real
 * doc switch (different docId → new pipeline → original pipeline ends)
 * still cleans up correctly.
 *
 * The deferred-delete also makes the unmount-flush-on-doc-switch path
 * robust: when EditorLayout's old `useDocument` fires its pending save
 * via `[save]` cleanup with the OLD handle, the OLD pipeline is still
 * in `active` (delete is scheduled, not yet fired) so `assertActive`
 * passes and the user's pending edit lands in the right doc's file.
 *
 * Registry storage is parked on `globalThis` so that Next.js HMR module
 * re-evaluation (a routine event when working in the dev preview)
 * preserves the same `Map`/`Set` instances. Without this, an HMR cycle
 * would silently re-mint the module's `active` Map, leaving React's
 * already-captured `DocWriteHandle`s stranded under a stale pipelineId
 * and turning every subsequent save into a `StalePipelineError` that
 * `useDocument` swallows — i.e. the data-loss bug we're fixing.
 */
interface VirgilPipelineRegistry {
  active: Map<string, string>;
  pendingEnd: Set<string>;
}
const g = globalThis as unknown as { __virgilDocPipelines?: VirgilPipelineRegistry };
const registry: VirgilPipelineRegistry = (g.__virgilDocPipelines ??= {
  active: new Map(),
  pendingEnd: new Set(),
});
const { active, pendingEnd } = registry;

/**
 * An opaque token bundling the destination doc with the pipeline it was
 * authored under. Storage writers accept this in place of a bare docId.
 * Treat as immutable; pass through props/Context, never reconstruct.
 */
export interface DocWriteHandle {
  readonly docId: string;
  readonly pipelineId: string;
}

/**
 * Why the captured handle is no longer the active pipeline.
 *  - "ended": no pipeline is registered for this docId at all. After the
 *    globalThis-stable registry change, this should only happen at a
 *    genuine unmount whose flush ran first — i.e. it's a regression
 *    signal if it surfaces in normal editing.
 *  - "superseded": a *different* pipelineId is now registered for the
 *    same docId. Expected on a real doc reopen; dropping the write is
 *    correct (the newer pipeline has loaded fresh content).
 */
export type StaleReason = "ended" | "superseded";

export class StalePipelineError extends Error {
  constructor(
    public readonly docId: string,
    public readonly pipelineId: string,
    public readonly reason: StaleReason,
    public readonly currentPipelineId: string | null,
  ) {
    super(
      `Stale doc pipeline for ${docId}: write was authored under pipeline ` +
        `${pipelineId.slice(0, 8)} but that pipeline has ${
          reason === "ended" ? "ended" : "been superseded"
        }.`,
    );
    this.name = "StalePipelineError";
  }
}

export function isStalePipelineError(err: unknown): err is StalePipelineError {
  return err instanceof Error && err.name === "StalePipelineError";
}

function newPipelineId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Open (or join) a pipeline for `docId`. Idempotent: if an active
 * pipeline already exists for the same docId, the existing pipelineId
 * is returned. Multiple sites in the same window can therefore call
 * `beginDocPipeline` for the same doc without superseding each other —
 * pipeline supersession is reserved for the explicit reopen case
 * (`endDocPipeline` followed by another `beginDocPipeline`).
 *
 * Idempotency matters because the standard React pattern
 * `useMemo(() => beginDocPipeline(docId), [docId])` runs during render,
 * before any sibling `useEffect` that also begins the pipeline. With a
 * non-idempotent `beginDocPipeline`, the effect would supersede the
 * useMemo handle and silently invalidate every closure that captured
 * it — exactly the data-loss bug we're guarding against.
 */
export function beginDocPipeline(docId: string): DocWriteHandle {
  const existing = active.get(docId);
  if (existing !== undefined) {
    // Same docId already has an active pipeline. Idempotent: return its
    // handle. If a deferred end was scheduled (StrictMode unmount about
    // to remount), cancel it so the pipeline keeps living.
    pendingEnd.delete(docId + "::" + existing);
    return { docId, pipelineId: existing };
  }
  const pipelineId = newPipelineId();
  active.set(docId, pipelineId);
  return { docId, pipelineId };
}

/**
 * End a pipeline. Defers the actual delete to a microtask so a same-
 * tick remount (React StrictMode dev double-invoke, Fast Refresh /
 * HMR component remount, doc-switch flush firing under an OLD handle
 * after the matching DocPipeline already unmounted) can either revive
 * the pipeline (`beginDocPipeline` for the same docId) or land its
 * pending write before the entry is actually removed from `active`.
 *
 * Idempotent and tolerant of races: only deletes the registration if
 * it still matches our pipelineId at the time the microtask fires, so
 * a newer pipeline for the same docId isn't accidentally cleared.
 */
export function endDocPipeline(h: DocWriteHandle): void {
  if (active.get(h.docId) !== h.pipelineId) return;
  const token = h.docId + "::" + h.pipelineId;
  pendingEnd.add(token);
  queueMicrotask(() => {
    if (!pendingEnd.has(token)) return; // cancelled by a same-tick begin
    pendingEnd.delete(token);
    if (active.get(h.docId) === h.pipelineId) active.delete(h.docId);
  });
}

/** Throws StalePipelineError if `h` is no longer the active pipeline. */
export function assertActive(h: DocWriteHandle): void {
  const current = active.get(h.docId);
  if (current !== h.pipelineId) {
    const reason: StaleReason = current === undefined ? "ended" : "superseded";
    throw new StalePipelineError(h.docId, h.pipelineId, reason, current ?? null);
  }
}

/**
 * Throws StalePipelineError only if a NEWER pipeline has taken over for
 * the same docId. A pipeline that ended cleanly (with no replacement)
 * passes — the write is safe because no competing writer exists.
 *
 * This is the right check for the *second* assertion inside the write
 * queue: a pending write enqueued under the active pipeline may execute
 * after that pipeline ended (e.g. unmount cleanup fired the save, then
 * EditorLayout's pipeline-end effect ran in the same synchronous phase).
 * Such a write must be allowed through; the strict `assertActive` would
 * reject it and silently lose the user's edit.
 */
export function assertNotSuperseded(h: DocWriteHandle): void {
  const current = active.get(h.docId);
  if (current !== undefined && current !== h.pipelineId) {
    throw new StalePipelineError(h.docId, h.pipelineId, "superseded", current);
  }
}

export function isActive(h: DocWriteHandle): boolean {
  return active.get(h.docId) === h.pipelineId;
}

/**
 * Look up the currently-active handle for a docId. Returns null if no
 * pipeline is open. Use sparingly — non-React callers (e.g. drag-drop
 * helpers in src/lib/) that don't have direct access to the pipeline
 * Context are the intended consumers; React code should always read
 * the handle from `useDocWriteHandle()` instead so closure capture
 * remains explicit.
 */
export function getActiveHandle(docId: string): DocWriteHandle | null {
  const pipelineId = active.get(docId);
  return pipelineId ? { docId, pipelineId } : null;
}

/**
 * Test helper — wipe all pipeline state. Not exported from the public
 * storage facade; tests import this module directly.
 */
export function __resetForTests(): void {
  active.clear();
  pendingEnd.clear();
}
