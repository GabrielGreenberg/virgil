/**
 * The autosave PAUSE door (design:
 * docs/memos/external-change-badge/DESIGN.md §4 — "the deep safety move";
 * widened by task 489).
 *
 * Virgil's background autosave must not overwrite a write it did not make.
 * Two things can be true of a document at debounce-fire:
 *
 * - an **external change** to it is unresolved on disk (the 364 clobber
 *   guard — another app or a sync daemon wrote the file and the user has not
 *   yet said which side wins), or
 * - a **cowork skill holds its pen** (task 489 — an `/editor/*` skill is
 *   mid-commit against this paper's folder; it is the ONLY other writer Virgil
 *   knows about ahead of the fact rather than after it).
 *
 * > **One pause door, and it returns the REASON.** Before task 489 every call
 * > site asked `shouldPauseAutosave(watcher)` and then hard-coded
 * > `noteSaveBlocked(docId, "conflict")` on the next line — four copies of one
 * > mapping, and the shape in which a second pause SOURCE gets a wrong (or no)
 * > voice on the save-state channel. The predicate that decides to pause is the
 * > thing that knows why, so it says so, and the caller quotes it.
 *
 * The watcher may be absent (no provider in bare test contexts, or no doc open,
 * or a WARM keep-alive doc whose conflicts belong to the ACTIVE doc) — in that
 * case the conflict rung is simply not consulted. The cowork rung is keyed on
 * `docId` and therefore correct for a warm doc too: a skill can be committing
 * against a paper the user is not looking at, and its autosave must pause just
 * the same.
 *
 * IMPORTANT: this gates ONLY the background debounced autosave +
 * flushNow/anchor-commit + the manual "Save now" door. The TERMINAL flushes
 * (pagehide / unmount cleanup / beforeunload) deliberately do NOT consult it —
 * a tab-close during an unresolved conflict must still save the user's
 * in-editor work (resolves in the user's favor, equivalent to "Keep mine"), so
 * the user never loses work. That holds for the cowork rung too: a skill's
 * commit is atomic and sub-second, and losing the user's session to protect a
 * write that has almost certainly already landed is the worse trade.
 *
 * KEYSTROKE SANCTITY: two O(1) store reads, evaluated only at debounce-fire
 * (already off the hot path), never per keystroke.
 */

import { coworkPenHeld } from "./cowork-pen";
import type { UnsavedBlockReason } from "./unsaved-work";

/** The pause reasons, a subset of the save-state channel's vocabulary — so a
 *  caller quotes this straight into `noteSaveBlocked` with nothing to map. */
export type AutosavePauseReason = Extract<
  UnsavedBlockReason,
  "conflict" | "cowork"
>;

/**
 * Why this document's background write must not land right now, or `null`.
 *
 * **`cowork` outranks `conflict`, and the order is the honest one rather than
 * a preference.** A skill mid-commit is the more specific and more transient
 * statement — it explains what is happening and that it clears itself — where
 * an unresolved external change is a standing state with a flow the user has to
 * answer. They routinely coincide, because a skill's own write is exactly the
 * kind of external change the watcher detects: while the pen is held, "Virgil
 * is editing this paper" is the truer thing to say, and once it releases the
 * conflict (if the user has unsaved work of their own) is still there to say.
 */
export function autosavePauseReason(
  watcher: { hasUnresolvedChange(): boolean } | null | undefined,
  docId: string | null | undefined,
): AutosavePauseReason | null {
  if (coworkPenHeld(docId)) return "cowork";
  if (watcher != null && watcher.hasUnresolvedChange()) return "conflict";
  return null;
}
