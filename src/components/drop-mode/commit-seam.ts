/**
 * The COMMIT SEAM for a drop that mutates a document in more than one step.
 *
 * ## The bug class (task 648)
 *
 * `view.dispatch(tr)` is a **request, not a guarantee**. ProseMirror runs every
 * plugin's `filterTransaction` first, and a veto — Virgil's own
 * `readOnlyEnforcer` is one — drops the transaction on the floor: no throw, no
 * step, the state object unchanged. So any gesture that dispatches and then
 * performs a SECOND effect on the strength of the first has an unchecked
 * two-phase commit, and the second phase can land on a first phase that never
 * happened. Two shapes shipped that way:
 *
 *  • a cross-editor MOVE — insert into the target, then delete from the source.
 *    `readOnlyEnforcer` is mounted on MAIN only, so the filter is ASYMMETRIC:
 *    main as target ⇒ the insert is vetoed and the source delete still lands
 *    (the atom, and a footnote's body with it, is destroyed); main as source ⇒
 *    the insert lands and the delete is vetoed (a duplicate atom).
 *  • an insert followed by a SIDECAR write (`onAnchored`) — which never passes
 *    through ProseMirror at all, so nothing can filter it. The card sheds its
 *    `unanchored`/`archived` flags while no marker exists: it is then in
 *    neither panel list.
 *
 * ## The three obligations, in order
 *
 * 1. **Ask editability at the COMMIT, for every surface the compound touches.**
 *    Not at mousedown, not at hit-test: the collab pen can change hands while
 *    the ghost is in flight. Both ends, because a move that cannot finish must
 *    not start — refusing after the insert would leave the duplicate.
 *    The question is `surfaceEditableNow`'s, asked through that one door (task
 *    638 put it at the deepest point a deferred commit passes through; this is
 *    the same seam for the drop gestures, and task 733 widened the door from
 *    the pen alone to pen ∧ host).
 * 2. **Dispatch, then measure the EFFECT.** `insertLanded` (schema-adopt.ts) is
 *    the PRE-dispatch net: it asks whether the built `Transform` kept the
 *    payload. It cannot see a veto, which happens strictly later. `dispatchLanded`
 *    is its post-dispatch twin and asks the only question the second phase
 *    depends on: *did the document actually change?*
 * 3. **Refuse as a UNIT.** A refusal at either point leaves BOTH documents
 *    byte-untouched — the same direction as the capture/schema-symmetry law
 *    ("never delete what you cannot restore") and as task 328's rule that a
 *    cross-editor splice lands the payload or touches nothing.
 *
 * Pinned by `drop-commit-seam.test.ts`, which also holds the CENSUS: no drop
 * spec may dispatch a cross-editor move outside this door.
 */

import type { Editor } from "@tiptap/react";
import type { Transaction } from "@tiptap/pm/state";
import { surfaceEditableNow } from "@/lib/tiptap/surface-editable";

/**
 * May every surface this commit is about to mutate be mutated RIGHT NOW?
 *
 * `null`/`undefined` entries are skipped so a caller can pass an optional
 * source without branching (a create has no source editor). Asked through
 * `surfaceEditableNow` rather than re-deriving `view.editable`, so the question
 * keeps one door.
 *
 * TASK 733 — that door used to be `collabReadOnly`, which is `!view.editable`
 * and therefore the PEN axis alone. MAIN pins `view.editable = true` for the
 * view's whole life, so on the surface most of these commits target the gate
 * was a constant. The HOST axis (a Library Reader pane's React
 * `editable={false}`, mirrored in `editableRef`) is exactly what
 * `readOnlyEnforcer` filters on, so reading it here is what makes obligation 1
 * — "ask editability at the COMMIT, for every surface the compound touches" —
 * true of the axis that actually vetoes.
 */
export function commitSurfacesWritable(
  ...surfaces: ReadonlyArray<Editor | null | undefined>
): boolean {
  for (const editor of surfaces) {
    if (editor && !surfaceEditableNow(editor)) return false;
  }
  return true;
}

/**
 * Dispatch `tr` and report whether it LANDED — i.e. whether the editor's
 * document actually advanced.
 *
 * A filtered transaction leaves `EditorState.applyTransaction` returning the
 * SAME state object, so the document is identical by reference; an applied
 * doc-changing transaction always produces a new one. Reference identity is
 * therefore the exact question, and it costs nothing (no doc walk, no `eq`).
 *
 * Callers must treat `false` as "the rest of the compound is off".
 */
export function dispatchLanded(editor: Editor, tr: Transaction): boolean {
  const before = editor.state.doc;
  editor.view.dispatch(tr);
  return editor.state.doc !== before;
}

/**
 * THE GRAB-BAR COMMIT DOOR (task 735) — the one ordering for a compound that
 * changes the document AND card sidecars.
 *
 * 1. re-ask editability at the SEAM (the caller may have awaited a confirm or a
 *    settle prompt since its own gate, and the host can flip in between);
 * 2. dispatch, and MEASURE that it landed (`dispatchLanded`);
 * 3. only then run `cards` — the sidecar half, which never passes through
 *    ProseMirror and so has nothing to filter it.
 *
 * Returns `false` when the compound was refused as a unit: nothing dispatched
 * landed and `cards` never ran. The caller owns telling the user.
 */
export function commitDocThenCards(
  editor: Editor,
  tr: Transaction,
  cards?: () => void,
): boolean {
  if (!commitSurfacesWritable(editor)) return false;
  if (!dispatchLanded(editor, tr)) return false;
  cards?.();
  return true;
}

/** One cross-editor move: insert into `target`, then remove from `source`. */
export interface CrossEditorMove {
  /** The editor receiving the payload. */
  target: Editor;
  /** The insert transaction, already BUILT against `target.state`. */
  insertTr: Transaction;
  /** The editor losing the payload. */
  source: Editor;
  /** The source range to remove — only once the insert has landed. */
  remove: { from: number; to: number };
  /**
   * Runs on `source` immediately before the removal transaction is BUILT (so it
   * may dispatch a selection-only transaction of its own — the undo-jump caret
   * parking both callers do). Never called when the commit refuses.
   */
  beforeRemove?: (source: Editor, from: number) => void;
  /** Fold extra steps into the removal (e.g. dropping the emptied source shell). */
  extendRemoval?: (tr: Transaction, from: number) => void;
}

/**
 * Execute a cross-editor move as ONE all-or-nothing commit.
 *
 * Returns `true` when the payload moved. On `false` NOTHING was dispatched to
 * either document (a read-only surface) or only the insert was attempted and it
 * did not land (a veto) — in both cases the source keeps its content, which is
 * the only failure direction that cannot lose the user's work.
 */
export function commitCrossEditorMove(move: CrossEditorMove): boolean {
  const { target, source, insertTr, remove } = move;
  // BOTH ends, BEFORE the insert: a move whose source cannot be emptied must
  // not deposit a copy in the target.
  if (!commitSurfacesWritable(target, source)) return false;
  if (!dispatchLanded(target, insertTr)) return false;
  // Both callers focused the target here before 648; a refusal above now means
  // the focus never moves either, which is what a declined gesture should look
  // like. (No opt-out option: an unread knob is the drift the "a registry earns
  // its name by being read" law is about.)
  target.view.focus();
  move.beforeRemove?.(source, remove.from);
  const deleteTr = source.state.tr.delete(remove.from, remove.to);
  move.extendRemoval?.(deleteTr, remove.from);
  source.view.dispatch(deleteTr);
  return true;
}
