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
