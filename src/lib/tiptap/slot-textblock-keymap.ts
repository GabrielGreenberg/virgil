import { Extension, defaultBlockAt, type Editor } from "@tiptap/core";
import { TextSelection, type EditorState } from "@tiptap/pm/state";
import { canSplit } from "@tiptap/pm/transform";

// The keyboard half of ONE rule for every SLOT textblock (task 1042): a
// textblock its parent can hold only one of — today `figureCaption`
// (`figureBlock.content = "figureCaption?"`). The schema half is the slot's
// missing `group` plus its container's `isolating` (figure-caption.tsx,
// figure-block.ts); what is left are the two core-keymap commands that act on
// the textblock ITSELF rather than across its container's sides:
//
//   • ENTER. A slot cannot be split, so TipTap's whole Enter chain
//     (`newlineInCode` → `createParagraphNear` → `liftEmptyBlock` →
//     `splitBlock`) declines the key — and a declined Enter is NOT a no-op:
//     ProseMirror lets the browser run its NATIVE `insertParagraph`, which
//     splits the nearest DOM block (for a caption, the figure NodeView's own
//     `.figure-caption` chrome, outside the contentDOM) and leaves PM to re-read
//     a selection in DOM it does not own. The caret resurfaced wherever that
//     resolved — between back-to-back figures, the NEXT figure's caption.
//   • DELETE / BACKSPACE IN AN EMPTY SLOT. `deleteCurrentNode` (Delete) removed
//     the empty caption node outright — the caret then mapped forward into the
//     next figure's caption, the reported symptom verbatim — and `clearNodes`
//     (Backspace) tried to re-type it. A slot is removed with its container,
//     never by a keystroke inside it; Enter cannot bring it back.
//
// Both answers are asked of the SCHEMA (`canSplit`, with the same two default-
// block attempts `splitBlock` makes), never of a node-name list, so the next
// slot textblock inherits the rule without being registered here.

/** Could TipTap's `splitBlock` split the textblock the selection sits in? */
export function selectionTextblockCanSplit(state: EditorState): boolean {
  const { $from } = state.selection;
  if ($from.depth === 0) return true;
  const deflt = defaultBlockAt($from.node(-1).contentMatchAt($from.indexAfter(-1)));
  return (
    canSplit(state.doc, $from.pos, 1) ||
    (deflt !== null && canSplit(state.doc, $from.pos, 1, [{ type: deflt }]))
  );
}

/** Is the selection inside ONE slot textblock (one that cannot be split)? */
export function selectionInSlotTextblock(state: EditorState): boolean {
  const sel = state.selection;
  if (!(sel instanceof TextSelection)) return false;
  if (!sel.$from.sameParent(sel.$to)) return false;
  if (!sel.$from.parent.isTextblock) return false;
  return !selectionTextblockCanSplit(state);
}

/** A collapsed caret in an EMPTY slot — where the core Delete/Backspace
 *  chains would remove or re-type the slot node itself. */
export function caretInEmptySlotTextblock(state: EditorState): boolean {
  return (
    state.selection.empty &&
    state.selection.$from.parent.content.size === 0 &&
    selectionInSlotTextblock(state)
  );
}

// Every alias the core keymap binds to its Backspace / Delete chains
// (@tiptap/core extensions/keymap.ts, base + mac maps). A key the platform
// doesn't bind is simply never pressed.
const DELETE_CHAIN_KEYS = [
  "Backspace",
  "Mod-Backspace",
  "Shift-Backspace",
  "Ctrl-h",
  "Alt-Backspace",
  "Delete",
  "Mod-Delete",
  "Ctrl-d",
  "Ctrl-Alt-Backspace",
  "Alt-Delete",
  "Alt-d",
] as const;

/** Empty-slot Delete/Backspace: consumed BEFORE the core keymap (same
 *  priority, registered later, so TipTap runs it first). */
export const SlotTextblockDeleteGuard = Extension.create({
  name: "slotTextblockDeleteGuard",

  addKeyboardShortcuts() {
    const guard = ({ editor }: { editor: Editor }) =>
      caretInEmptySlotTextblock(editor.state);
    return Object.fromEntries(DELETE_CHAIN_KEYS.map((k) => [k, guard]));
  },
});

/** Unsplittable Enter: consumed AFTER everything else declined it. */
export const SlotTextblockEnterGuard = Extension.create({
  name: "slotTextblockEnterGuard",
  // Below the core keymap (100): every other Enter handler — popups, the
  // example/comment escapes, the core chain — has already had its turn.
  priority: 1,

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => selectionInSlotTextblock(editor.state),
    };
  },
});
