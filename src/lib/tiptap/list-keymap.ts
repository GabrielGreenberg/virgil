import { Extension } from "@tiptap/core";
import { listHelpers } from "@tiptap/extension-list";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";

/**
 * Task 2026-08-21-418 — the list keymap's boundary predicate.
 *
 * ## The law
 *
 * > **A question about a CONTAINER is answered from the container's own
 * > boundaries, never from an offset inside a LEAF.**
 *
 * TipTap's `ListKeymap` asks "is the caret at the boundary of this list item?"
 * twice, and its two halves answered from two different scopes:
 *
 * - `Delete` → `isAtEndOfNode(state, "listItem")`, which resolves the
 *   ENCLOSING ITEM and compares `$anchor.pos + 1` against **its** content end.
 *   Item-scoped. Correct.
 * - `Backspace` → `isAtStartOfNode(state)`, which compares `$from.parentOffset`
 *   — the offset inside the **TEXTBLOCK**. A caret at the start of *any* block
 *   in the item satisfies it.
 *
 * So Backspace at the start of an item's SECOND (or later) block took the
 * item-start branch and either joined the whole item into the previous one or
 * **lifted it out of the list**. Measured on Virgil's stack it is always the
 * lift, because the branch selector `hasListItemBefore` probes `$anchor.pos - 2`
 * — the same textblock-scoped mistake one helper over: from a later paragraph
 * that lands inside the PREVIOUS PARAGRAPH of the same item, whose `nodeBefore`
 * is never a `listItem`. (At a genuine item start it lands on the item boundary
 * and answers correctly, which is why gating the START question is sufficient
 * and `hasListItemBefore` needs no second fix.)
 *
 * ## Why Virgil is hit harder than upstream
 *
 * Virgil's `listItem` content model is `(paragraph | graphicsBlock) block*`, and
 * multi-block items arrive **from ordinary `.tex` with no user gesture** — task
 * 348's `tailSep` rule exists precisely for a second paragraph in an item, and a
 * stray anchor-only line parses into one (the task-367 husk class). And the
 * keystroke costs IDENTITY: a merged or lifted item's `uuid` dies, orphaning
 * every card, marginalia marker and sidecar `parTitle` keyed on it — from a
 * press the user believes deletes a blank line.
 *
 * ## The shape of the fix
 *
 * `atListItemStart` is the missing twin of upstream's `isAtEndOfNode(state,
 * name)` — the exact mirror of its arithmetic, resolved against the item.
 * `VirgilListKeymap` replaces `StarterKit`'s `listKeymap` (which is turned off at
 * the one configure site) and **gates** the key on it before DELEGATING to
 * upstream's own `listHelpers.handleBackspace` / `handleDelete`.
 *
 * Delegating rather than vendoring is the whole point: there is no copy of
 * upstream's branch logic here to track, and a declined press falls through to
 * TipTap's core `Keymap` chain (`undoInputRule` → `deleteSelection` →
 * `joinBackward` → `selectNodeBackward`) — i.e. plain ProseMirror, which merges
 * the block into the one above it *inside the same item*. That fall-through is
 * why the gate needs no `undoInputRule` of its own: the core chain runs it.
 *
 * ## Measured, not assumed
 *
 * Two things the filed diagnosis predicted do NOT happen on this schema, and
 * are recorded here rather than "fixed":
 *
 * - the reported case takes the **lift** branch, not `joinItemBackward` (above);
 * - **an empty paragraph directly after a list is already deleted correctly.**
 *   Upstream's `hasListBefore` branch cuts it into the last item and
 *   `joinForward()`s, and on Virgil's schema the net effect is exactly
 *   "the empty line goes away, the list is untouched". A non-empty paragraph
 *   still merges into the last item, which is the intended affordance. So this
 *   gate deliberately leaves the not-in-an-item branches to upstream, and the
 *   suite pins both as controls.
 */

/** The list item types this keymap governs. Virgil ships no task lists. */
export const VIRGIL_LIST_TYPES: ReadonlyArray<{
  itemName: string;
  wrapperNames: string[];
}> = [{ itemName: "listItem", wrapperNames: ["bulletList", "orderedList"] }];

/**
 * The INNERMOST list item containing the caret, or null.
 *
 * Innermost, deliberately: a nested item's own boundary is the one the user is
 * standing on, and it is the item upstream's `findListItemPos` /
 * `findParentNode` both resolve — so the gate and the delegate cannot disagree
 * about which item they are talking about.
 */
export function findEnclosingListItem(
  state: EditorState,
  itemName: string,
): { node: PMNode; pos: number; depth: number } | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === itemName) {
      return { node, pos: $from.before(depth), depth };
    }
  }
  return null;
}

/**
 * Is the collapsed caret at the very start of its enclosing list ITEM?
 *
 * The mirror of `isAtEndOfNode(state, name)`: that resolves the item and tests
 * `$anchor.pos + 1 === $itemPos.end()`; this tests `$anchor.pos === $itemPos.start() + 1`,
 * i.e. `itemPos + 2` — one position inside the item, one more inside its first
 * child. False for a caret in any later block of the item, which is the whole
 * point, and false for a non-collapsed selection (upstream declines those too).
 *
 * An item whose first child cannot hold a caret (a leading `graphicsBlock`)
 * answers false everywhere, which fails toward the SAFE side: the press falls
 * through to plain ProseMirror instead of lifting the item out of the list.
 */
export function atListItemStart(state: EditorState, itemName: string): boolean {
  const { $from, $to } = state.selection;
  if ($from.pos !== $to.pos) return false;
  const item = findEnclosingListItem(state, itemName);
  if (!item) return false;
  return $from.pos === item.pos + 2;
}

/**
 * May the list keymap own this Backspace?
 *
 * Inside an item: only at the item's own start — the join/lift branches are
 * about the ITEM, so they may only fire where the caret is on the item's
 * boundary. Outside an item: yes, unchanged — that is upstream's
 * paragraph-after-a-list branch, which measures correctly here (see the header).
 */
export function listKeymapOwnsBackspace(
  state: EditorState,
  itemName: string,
): boolean {
  if (!findEnclosingListItem(state, itemName)) return true;
  return atListItemStart(state, itemName);
}

/**
 * Virgil's replacement for `StarterKit`'s `listKeymap`.
 *
 * Registered immediately after the `StarterKit` entry in
 * `buildEditorExtensions` so its keymap plugin sits where upstream's did in the
 * plugin order (TipTap reverses the extension array before sorting by priority,
 * so an earlier array position means a LATER keymap plugin — after `TabIndent`,
 * the expex handlers and the latex-comment handlers, exactly as before).
 */
export const VirgilListKeymap = Extension.create({
  name: "virgilListKeymap",

  addKeyboardShortcuts() {
    const backspace = ({ editor }: { editor: import("@tiptap/core").Editor }) => {
      let handled = false;
      for (const { itemName, wrapperNames } of VIRGIL_LIST_TYPES) {
        if (editor.state.schema.nodes[itemName] === undefined) continue;
        // ── the gate — the whole of task 418 ──────────────────────────────
        if (!listKeymapOwnsBackspace(editor.state, itemName)) continue;
        if (listHelpers.handleBackspace(editor, itemName, wrapperNames)) {
          handled = true;
        }
      }
      return handled;
    };

    const del = ({ editor }: { editor: import("@tiptap/core").Editor }) => {
      let handled = false;
      for (const { itemName } of VIRGIL_LIST_TYPES) {
        if (editor.state.schema.nodes[itemName] === undefined) continue;
        // No gate: `handleDelete` asks `isAtEndOfNode(state, name)`, which is
        // already item-scoped. Delegated verbatim.
        if (listHelpers.handleDelete(editor, itemName)) handled = true;
      }
      return handled;
    };

    return {
      Backspace: backspace,
      "Mod-Backspace": backspace,
      Delete: del,
      "Mod-Delete": del,
    };
  },
});
