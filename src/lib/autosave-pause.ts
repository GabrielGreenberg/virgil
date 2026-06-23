/**
 * Autosave-clobber guard predicate (design:
 * docs/memos/external-change-badge/DESIGN.md §4 — "the deep safety move").
 *
 * While an UNRESOLVED external change exists on disk, Virgil's BACKGROUND
 * autosave must not silently overwrite the disk — that would destroy the
 * external edit with no trace. This predicate is the single gate every
 * background write path consults before calling `writeDocBundle`.
 *
 * The watcher may be absent (no provider in bare test contexts, or no doc open)
 * — in that case autosave proceeds normally (returns false).
 *
 * IMPORTANT: this gates ONLY the background debounced autosave +
 * flushNow/anchor-commit. The TERMINAL flushes (pagehide / unmount cleanup /
 * beforeunload) deliberately do NOT consult this — a tab-close during an
 * unresolved conflict must still save the user's in-editor work (resolves in
 * the user's favor, equivalent to "Keep mine"), so the user never loses work.
 *
 * KEYSTROKE SANCTITY: this is a single O(1) store read, evaluated only at
 * debounce-fire (already off the hot path), never per keystroke.
 */
export function shouldPauseAutosave(
  watcher: { hasUnresolvedChange(): boolean } | null | undefined,
): boolean {
  return watcher != null && watcher.hasUnresolvedChange();
}
