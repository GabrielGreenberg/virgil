/**
 * Shared low-level storage types (leaf module — no imports, so both the FSA
 * and dev backends can depend on it without a cycle through the `storage`
 * barrel).
 */

/**
 * The outcome of a best-effort compiled-PDF persistence (P6). `writePdf` used
 * to be `Promise<void>`, which conflated three cases: a real write, an
 * intentional library/read-only skip, and a swallowed IO failure. The result
 * makes them distinguishable so the compile hook can:
 *   - `written` — persisted to disk; nothing to surface.
 *   - `skipped` — a library/read-only paper that intentionally never persists;
 *     NOT an error. The in-memory viewer still shows the compiled PDF.
 *   - `failed`  — the write was attempted and rejected (dev PUT `!resp.ok`, or
 *     a real FSA IO error). The hook surfaces a NON-BLOCKING notice — the
 *     compile itself succeeded and the in-memory PDF is fully usable.
 */
export type WritePdfResult =
  | { status: "written" }
  | { status: "skipped" }
  | { status: "failed"; error?: unknown };

/**
 * The receipt of a CONFLICT NET (task 364) — one `virgil/.history/<timestamp>/`
 * slot holding BOTH sides of an external-change conflict, taken before either
 * side is applied.
 *
 * `null` from `snapshotConflictSides` means **no net was taken** (no history
 * layer, a permission loss, an IO failure). That is a fact the affordance has
 * to be able to READ, because a door that promises "the other version is kept
 * in history" and silently takes no copy is the false-affordance shape this
 * whole cluster legislates against — so the resolution reports it rather than
 * inferring success from the absence of a throw.
 */
export interface ConflictArchive {
  /** The `virgil/.history/` slot name (an ISO-derived timestamp). */
  slot: string;
  /** The DISK side's filenames copied into the slot. */
  disk: readonly string[];
  /**
   * The filename the editor's unsaved side landed under, or `null` when there
   * was nothing to archive. `.tex` when the model serialized; `.json` when it
   * could not (an `UnserializableNodeError` — the model is still the user's
   * work, so the raw model is archived rather than nothing).
   */
  mine: string | null;
}

/**
 * **The bundle write's RECEIPT** (task 557) — what `writeDocBundle` actually
 * did, returned rather than left for the caller to re-derive.
 *
 * `writeDocBundle` used to be `Promise<void>`, and a REFUSAL returns normally
 * (the 357 gates leave the `.tex` and the sidecar byte-identical rather than
 * throwing), so its one caller had to guess the verdict from a second source:
 * `isWriteProtected(docId)`. That predicate answers a different question — *is
 * a notice standing that the user has not answered?* — and the two come apart
 * the moment a user ACKNOWLEDGES one: `recordPreservationRefusal` then drops a
 * later refusal without arming a notice, `isWriteProtected` stays false, and
 * the caller reports a LANDED write for a write that never happened. It then
 * advances its last-saved marker, clears the dirty state and DELETES the
 * emergency mirror — the durable copy of work that is now nowhere on disk.
 *
 * > **THE REPORT IS THE PERMISSION.** A door that can decline says so; a
 * > caller may not infer the verdict from the absence of a throw, and may not
 * > infer it from the absence of a FLAG either — that is the same mistake one
 * > predicate over.
 *
 * The same shape `WritePdfResult` above already has, and that
 * `captureFloatToStack`, `deleteSidecarSiblings` and the conflict doors have:
 * the bundle write was the last door in this cluster still making its caller
 * guess.
 */
export type DocWriteReceipt =
  | { landed: true }
  | { landed: false; reason: DocWriteRefusalReason };

/**
 * Why a bundle write did not land.
 *
 * - `preservation` — a 357 gate refused: either the write-side words gate
 *   (`checkWriteAgainstRetained`) or the SERIALIZER (`UnserializableNodeError`).
 *   They are ONE reason because they are ONE channel — both publish through
 *   `recordPreservationRefusal`, which is the "one refusal channel for every
 *   preservation failure" doctrine `serialize-refusal.ts` states. The work is
 *   in memory and at risk; the caller must say so on the unsaved-work channel.
 * - `read-only` — this document does not persist AT ALL (a `library-paper:`
 *   doc in the Reader). Nothing was attempted and nothing is at risk: the
 *   channel is armed only by an UNDOABLE user edit, which a read-only surface
 *   cannot produce. Distinguished from `preservation` for the same reason
 *   `WritePdfResult` distinguishes `skipped` from `failed` — "intentionally not
 *   persisted" is not a failure, and reporting it as blocked work would arm a
 *   badge, a `beforeunload` prompt and a mirror on a surface whose whole
 *   contract is that it never saves.
 */
export type DocWriteRefusalReason = "preservation" | "read-only";

/** The one landed receipt, so no call site spells the object literal. */
export const DOC_WRITE_LANDED: DocWriteReceipt = Object.freeze({
  landed: true,
});
