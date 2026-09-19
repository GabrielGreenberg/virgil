/**
 * owning-editor — "which TipTap `Editor` does THIS `EditorView` belong to?"
 *
 * One question, one owner (task 642). A ProseMirror plugin runs with an
 * `EditorView` and nothing else; a React-land consumer wants the `Editor`
 * wrapper. Before this module the only way across was the actions-bridge
 * registry — which keys ONLY the `EditorPane`s, so every NESTED editor (a card
 * body, a float, an excerpt) resolved to "whichever pane is active" and the
 * caller silently read a FOREIGN document's selection.
 *
 * TipTap itself already publishes the back-pointer: `Editor.createView()` ends
 * with `view.dom.editor = this`, unconditionally, for every editor it creates —
 * nested ones included ([@tiptap/core] `Editor.createView`). So the owning
 * editor is a property of the view's own DOM node, not of any registry, and it
 * cannot go stale or name a different document.
 *
 * Returns `null` for a view TipTap did not create (a bare ProseMirror
 * `EditorView`, which is what several unit-test harnesses build). A caller must
 * therefore treat this as nullable and keep whatever it would have used before
 * — but it must NOT substitute a different document's editor for the POSITION
 * half of its work: positions belong to `view.state`, which is always right.
 */

import type { Editor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";

/** The DOM node TipTap stamps its back-pointer onto. */
type EditorBearingElement = HTMLElement & { editor?: Editor };

/**
 * The TipTap `Editor` that owns `view`, or `null` when the view was not created
 * by TipTap (a raw ProseMirror view — test harnesses, foreign embeds).
 */
export function owningEditor(view: EditorView | null | undefined): Editor | null {
  if (!view) return null;
  // `view.dom` throws on a destroyed view in some PM versions; a destroyed view
  // has no owner worth naming either way.
  let dom: EditorBearingElement | null = null;
  try {
    dom = view.dom as EditorBearingElement;
  } catch {
    return null;
  }
  return dom?.editor ?? null;
}
