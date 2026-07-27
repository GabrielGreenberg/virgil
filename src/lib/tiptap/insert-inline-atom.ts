/**
 * `insertInlineAtom` — the ONE no-scroll inline-atom insert helper.
 *
 * # Why this exists
 *
 * Inline atoms (footnote / citation / inline-math / ref) carry a HARD invariant:
 * inserting one must NEVER force a viewport scroll. This insert-scroll invariant is
 * ORTHOGONAL to the `selectable` facet — it holds for all four kinds, and this
 * helper is what roots it (focus WITHOUT scroll; never `scrollIntoView`). Three of
 * the kinds ALSO opt out of `NodeSelection` (`selectable: false`), but for a
 * DIFFERENT reason (a *resting* selection, not the insert); inline-math does NOT:
 *
 *   - `footnote.ts` / `citation.ts` / `label.ts` (ref): `selectable: false`. A
 *     NodeSelection resting on the atom dispatches a selection transaction
 *     defaulting to `scrollIntoView: true`, which "scrolls the row by ~70–100px"
 *     before our click handlers can route to the omni-card alignment.
 *     `selectable:false` suppresses exactly that. (SSOT: `ATOM_REGISTRY.selectable`.)
 *   - `math.ts` (inline-math): `selectable: true` — its NodeView legitimately needs
 *     the NodeSelection to paint `.selected` chrome and drive the single-node float,
 *     so it does NOT opt out (the registry's `selectable` JSDoc warns against
 *     blanketing it to false). It is still scroll-safe on INSERT via the
 *     no-`scrollIntoView` focus path this helper roots — the insert invariant does
 *     not depend on `selectable`.
 *   - `drop-mode/util/inline-atom-move.ts`: the drop-mode insert/move helpers
 *     document "NEVER `.scrollIntoView()`" and even park a caret so undo can't
 *     re-trigger the jump.
 *
 * But every React-side create helper used to hand-roll
 * `editor.chain().focus().insertContent({…}).run()`, and TipTap's `focus()`
 * defaults to `scrollIntoView: true` — it schedules a deferred
 * `editor.commands.scrollIntoView()` (inside a `requestAnimationFrame`) on the
 * post-insert caret. With no chrome-aware `scrollMargin` on the editor, that scroll
 * parked the brand-new atom at the very top of the scroll container, beneath the
 * sticky reading-mask + MenuBar — i.e. the "the new footnote lands just out of view
 * at the top" bug. The clean typed/slash paths never had this because they dispatch
 * a raw `view.dispatch(tr)` with no `scrollIntoView`.
 *
 * `insertInlineAtom` is the single canonical primitive those React paths now share —
 * the inline-atom sibling of `smartInsertBlock` (which owns block-atom inserts). It
 * roots the "inline atoms never scroll" rule in ONE place: focus WITHOUT scroll,
 * optionally replace the selection, insert the atom, and never `scrollIntoView`.
 *
 * Runs on a user gesture (a menu pick / grab-bar action), never per keystroke.
 */

import type { Editor } from "@tiptap/core";

export interface InsertInlineAtomArgs {
  /** The live editor. The insert runs through its command chain. */
  editor: Editor;
  /** The inline-atom node type name (e.g. `"footnote"`, `"citation"`,
   *  `"inlineMath"`). Resolved against the live schema by `insertContent`. */
  type: string;
  /** The node attrs (e.g. `{ footnoteId, content, number, title }`). Passed
   *  through to `insertContent` unchanged — including any nested-doc attr. */
  attrs: Record<string, unknown>;
  /**
   * Optional doc position to insert AT — the **captured-position contract** the
   * deferred creation popover needs. When given, the selection is moved here
   * (still no-scroll, inside the same chain) BEFORE inserting, so the atom lands
   * at a position captured at TRIGGER time even though the live PM selection may
   * have drifted while a modal-ish popover was open (the user picked citekeys in
   * a portal `<input>`, never touching the doc). Clamped to the live doc so a
   * collab-shifted / stale pos can't throw — it just lands at the nearest valid
   * spot. Omitted ⇒ insert at the current selection (the original behavior, used
   * by every in-place create helper). `setTextSelection` adds NO `scrollIntoView`
   * of its own, so the no-scroll invariant holds with or without this.
   */
  at?: number;
}

export interface InsertInlineAtomResult {
  /** Document position of the inserted atom in the post-dispatch doc (the node
   *  immediately before the resulting caret), so a caller can locate it. -1 if
   *  it could not be resolved (defensive — should not happen). */
  pos: number;
}

/**
 * Insert an inline-atom node at the selection WITHOUT scrolling the viewport
 * (the documented inline-atom invariant). A non-empty selection is replaced —
 * `insertContent` inserts at `[selection.from, selection.to]`, so it consumes a
 * range automatically (the "wrap the selected text into the atom" path:
 * footnote-from-selection, inline-math-wrap) and is a plain insert at a caret.
 *
 * No `.scrollIntoView()` is dispatched anywhere: `insertContent` never scrolls;
 * `focus()`'s default deferred scroll is suppressed via `{ scrollIntoView: false }`;
 * and we deliberately do NOT chain `.deleteSelection()` — TipTap's `deleteSelection`
 * wraps prosemirror-commands' version, which appends `.scrollIntoView()` to the tr.
 */
export function insertInlineAtom(args: InsertInlineAtomArgs): InsertInlineAtomResult {
  const { editor, type, attrs, at } = args;

  // focus(null, { scrollIntoView: false }): focus the doc (the grab-bar /
  // action-menu item is a button, so focus may be off the doc) but suppress the
  // deferred scrollIntoView that `focus()` schedules by default — the whole point.
  const chain = editor.chain().focus(null, { scrollIntoView: false });
  // Captured-position contract (deferred popover commit): land the atom at the
  // trigger-time `at` even if the live selection drifted. Clamp to the live doc
  // so a stale/collab-shifted pos can't throw — `setTextSelection` carries no
  // scrollIntoView, so the no-scroll invariant is preserved.
  if (typeof at === "number") {
    const max = editor.state.doc.content.size;
    chain.setTextSelection(Math.max(0, Math.min(at, max)));
  }
  chain.insertContent({ type, attrs }).run();

  // Locate the inserted atom: insertContent rests the caret just past it, so the
  // node immediately before the caret IS the atom. Generic over nodeSize so it
  // holds for any inline atom, not just the nodeSize-1 leaves of today.
  const caret = editor.state.selection.from;
  const before = editor.state.doc.resolve(caret).nodeBefore;
  return { pos: before ? caret - before.nodeSize : -1 };
}
