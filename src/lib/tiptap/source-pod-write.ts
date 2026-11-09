/**
 * THE door every write to a source pod's attrs goes through — task 1533.
 *
 * A source pod (`texBlock` / `forestBlock`) is a LEAF atom whose content is a
 * string attr (`code` / `source`) beside `parTitle` / `collapsed`. It has two
 * writers — the in-place `SourcePodNodeView` and the popped-out
 * `SourcePodFloatBody` — and they used to disagree about undo in a way that
 * silently reverted the user's code:
 *
 *  - every write was `setNodeMarkup`, which for a leaf is a whole-node
 *    `ReplaceStep` whose inverse snapshots EVERY attr; and
 *  - the float's code writes stay out of main's history (the float-write
 *    doctrine) while the in-place writes — and the float's title write, the
 *    one float door that forgot `addToHistory:false` — were recorded.
 *
 * So a main Cmd-Z replayed an old whole-node snapshot over code typed in the
 * float, with no redo path for the unrecorded float writes.
 *
 * The door fixes it by making the two step shapes MEAN something:
 *
 *  - **In-place (history-recorded)** writes are `AttrStep`s — one per changed
 *    attr — so an undo touches only the attr that edit changed (a title undo
 *    can never revert `code`).
 *  - **Float (unrecorded)** writes stay a whole-node replace, ON PURPOSE: an
 *    `AttrStep` history item maps to null through a later replace of its node
 *    (`deletedAfter`), so the float's write ENDS main's history for this pod.
 *    An older in-place snapshot is dropped instead of replayed over the
 *    float's code — the same outcome a textblock float already has (its
 *    `landFloatWrite` replaces the block's content, so earlier items inside it
 *    map `deletedAcross`). Undo there is LOST, never REVERTING.
 *
 * That pairing only holds if EVERY writer comes through here: a single stray
 * whole-node `setNodeMarkup` recorded in history would bring the snapshot
 * inverse back (and an `AttrStep` item would vanish under a stray replace).
 * `source-pod-write-door.test.ts` is the census.
 *
 * Grouping. An `AttrStep`'s step map is empty, so prosemirror-history's
 * adjacency test can never group two of them — typed in place, every
 * keystroke would become its own main undo step. The door restores the
 * grouping a whole-node replace used to get for free, narrowly: a recorded
 * write joins the previous one only when it is the SAME pod and attr set,
 * within the history's group delay, and NOTHING has happened in the editor
 * since (the state is the very one the previous write produced). It joins by
 * the `appendedTransaction` meta — the history plugin's own "same event"
 * signal for appended transactions.
 */
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { FLOAT_WRITE_META } from "@/lib/float-sync";

export type SourcePodWriteOrigin =
  /** The in-place NodeView — recorded in main's history, one AttrStep per attr. */
  | { kind: "in-place" }
  /** A popped-out float — unrecorded, tagged with the float's own-write id. */
  | { kind: "float"; floatId: string };

/** prosemirror-history / TipTap UndoRedo default `newGroupDelay`. */
export const SOURCE_POD_GROUP_DELAY_MS = 500;

interface LastRecordedWrite {
  /** The state the previous recorded write produced. */
  state: EditorState;
  tr: Transaction;
  pos: number;
  attrsKey: string;
  time: number;
}

const lastRecorded = new WeakMap<EditorView, LastRecordedWrite>();

/**
 * Write `attrs` onto the source pod at `pos` (whose node is `node`). Attrs
 * equal to what the node already holds are skipped; a write that changes
 * nothing dispatches nothing. Returns whether a transaction was dispatched.
 */
export function writeSourcePodAttrs(
  view: EditorView,
  pos: number,
  node: PMNode,
  attrs: Record<string, unknown>,
  origin: SourcePodWriteOrigin,
): boolean {
  const changed = Object.keys(attrs).filter(
    (k) => node.attrs[k] !== attrs[k],
  );
  if (changed.length === 0) return false;
  const tr = view.state.tr;

  if (origin.kind === "float") {
    // Whole-node replace — see the header: this is what drops main's older
    // history items for this pod instead of letting them revert the float.
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
    tr.setMeta("addToHistory", false);
    tr.setMeta(FLOAT_WRITE_META, origin.floatId);
    lastRecorded.delete(view);
    view.dispatch(tr);
    return true;
  }

  for (const k of changed) tr.setNodeAttribute(pos, k, attrs[k]);
  const attrsKey = changed.slice().sort().join("\u0000");
  const prev = lastRecorded.get(view);
  if (
    prev &&
    prev.state === view.state &&
    prev.pos === pos &&
    prev.attrsKey === attrsKey &&
    tr.time - prev.time <= SOURCE_POD_GROUP_DELAY_MS
  ) {
    tr.setMeta("appendedTransaction", prev.tr);
  }
  view.dispatch(tr);
  if (view.state.doc !== tr.before) {
    lastRecorded.set(view, {
      state: view.state,
      tr,
      pos,
      attrsKey,
      time: tr.time,
    });
  } else {
    // Filtered (read-only enforcer) — nothing to join next time.
    lastRecorded.delete(view);
  }
  return true;
}
