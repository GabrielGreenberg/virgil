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
 *   - `skipped` — a library paper, which intentionally never persists a PDF
 *     (only the Reader's note sidecar lands — task 556); NOT an error. The
 *     in-memory viewer still shows the compiled PDF.
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
 * - `read-only` — this document does not persist its BUNDLE (a
 *   `library-paper:` doc in the Reader, which lands only the note sidecar its
 *   chrome lets the user edit — task 556). Nothing was attempted and nothing
 *   is at risk: the
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

/**
 * The option bag every bundle write accepts — spelled ONCE (task 567). Both
 * backends and `useDocument.save` used to declare it inline, three copies of
 * one shape, and the third claim below is what made a fourth copy one too many.
 *
 * Two of the fields are CLAIMS the user has made, and both are read at the
 * write-side preservation gate. A claim steps the gate aside for THIS write
 * only; what it records DURABLY is decided by the receipt, never by the
 * gesture that made it.
 */
export interface DocWriteOptions {
  /** Code-pane delimiters riding this write — the ONLY copy of a preamble
   *  edit until a write lands (`useDocument.pendingDelimitersRef`). */
  delimiters?: { preamble: string; postamble: string };
  /**
   * **This write IS the user's conflict decision** (task 364). Set only by
   * the external-change conflict's "keep my version" door, which has already
   * archived BOTH sides through `snapshotConflictSides` — so the automatic-
   * write gate steps aside rather than silently declining to do the one thing
   * the user just asked for.
   *
   * Stated as a claim rather than a convenience: the 357 gate exists because
   * an AUTOMATIC write must not lose content, and a conflict resolution is
   * the opposite of automatic. Refusing it would leave the badge's promise
   * ("your version is kept") unkept with nothing on screen to say so — this
   * cluster's own silence failure mode. The net is what makes the exemption
   * safe, and it is unconditional at the call site, never rate-limited. It
   * also FORCES past the per-file byte-equality gate (task 415).
   */
  userResolvedConflict?: boolean;
  /**
   * **This write IS the user's "Save anyway"** (task 567). Set only by the
   * preservation badge's danger confirm, through the manual-save door. The
   * write-side words gate steps aside for this ONE write exactly as it does
   * for `userResolvedConflict`; the ACKNOWLEDGMENT is recorded on the LANDED
   * receipt (`useDocument.save`), never at the gesture. So a claim whose
   * write did not land — a conflict pause, a throw, a stale pipeline — leaves
   * the notice standing rather than hiding it behind an acknowledgment the
   * write could not honour, and the gesture that said "saving will write the
   * version you see" cannot resolve without a write having been attempted.
   * Pre-567 the badge flipped the flag and wrote NOTHING: the debounce had
   * already been disarmed by the refusal, so the file stayed stale until the
   * next keystroke, while the save badge went on saying "Review…" over a
   * document whose next Save would silently overwrite the file.
   *
   * The SERIALIZER gate is NOT stepped aside (it produces no bytes, so there
   * is nothing to save anyway), and the byte-equality gate is untouched.
   */
  acknowledgePreservation?: boolean;
}
