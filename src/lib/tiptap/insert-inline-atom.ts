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
 * # It roots a SECOND rule (task 396): the container gate
 *
 * Being the one door, it is also the one place that can ask whether the landing
 * position can HOST an inline atom at all — `posHostsInlineAtom`, the SSOT task
 * 150 built. It matters here rather than only at the menu gates because the
 * deferred create-popover commit (`handleInsertRef` / `commitCitationCreate`)
 * lands at a position captured at TRIGGER time, which no `applies()` can see.
 * A refusal leaves the document completely untouched and reports
 * `{ refused: true }`.
 *
 * Runs on a user gesture (a menu pick / grab-bar action), never per keystroke.
 */

import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

import { posHostsInlineAtom } from "@/text-objects/text-object-registry";

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
   *  it could not be resolved (defensive — should not happen), and -1 when the
   *  container gate REFUSED (see `refused`). */
  pos: number;
  /**
   * True when the CONTAINER GATE declined the insert and the document was left
   * **completely untouched** (task 396). A caller that mints an id / registers a
   * card before calling can read this to know its atom never landed. `false` on
   * every insert that ran — including the pre-396 shape, so no existing caller
   * changes behaviour by ignoring it.
   */
  refused: boolean;
}

/**
 * TipTap's own `setTextSelection` clamp, spelled once so the CONTAINER GATE and
 * the insert agree on the landing position (task 396). `setTextSelection` bounds
 * its argument by `TextSelection.atStart(doc).from` / `atEnd(doc).to` — the first
 * and last TEXT positions — never by `doc.content.size`.
 */
function clampToTextRange(editor: Editor, at: number): number {
  const { doc } = editor.state;
  try {
    const min = TextSelection.atStart(doc).from;
    const max = TextSelection.atEnd(doc).to;
    return Math.max(min, Math.min(at, max));
  } catch {
    // A doc with no text position at all (an empty/atom-only doc). Fall back to
    // the raw clamp; the gate then answers about the position we will use.
    return Math.max(0, Math.min(at, doc.content.size));
  }
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

  // ── CONTAINER GATE (task 396) — the DEEPEST point, and the only one the
  // deferred create-popover commit passes through. `handleInsertRef` /
  // `commitCitationCreate` land at a captured `at` no menu gate can see, so a
  // gate on the two `applies()` alone would leave that path (and every future
  // inline atom) open. Ask the ONE SSOT: can this landing position host the
  // atom? The MARKLESS verbatim blocks (`codeBlock` / `latexComment`) declare
  // `content: "text*"` — literal text, no inline nodes — so ProseMirror's fitter
  // wraps the atom in a fresh paragraph and SPLITS the block around it, and a
  // commented-out line's tail is promoted into the typeset document. A
  // `titleField` (`content: "inline*"`) legitimately hosts one and stays allowed,
  // which is precisely why this reads `posHostsInlineAtom` and not the block gate.
  //
  // Refusing is the right failure direction: an atom that cannot land without
  // corrupting its container is one the user cannot want. The doc is left
  // COMPLETELY untouched (the capture/schema-symmetry rule — never delete what
  // you cannot restore, here: never splice what the container can't hold).
  //
  // The gate must ask about the position the insert will ACTUALLY use, not the
  // caller's raw `at`: `setTextSelection` below clamps into TipTap's own
  // `[TextSelection.atStart, TextSelection.atEnd]` TEXT range, so a stale
  // past-the-end `at` resolves to the last text position, NOT to
  // `doc.content.size` (which resolves to the doc itself — a non-textblock, and
  // a refusal for a caller that is landing in prose). Mirroring that clamp here
  // is what keeps "what the gate judged" and "where the atom lands" the same
  // position.
  const landing =
    typeof at === "number" ? clampToTextRange(editor, at) : editor.state.selection.from;
  const atomType = editor.state.schema.nodes[type];
  // No such node in THIS editor's schema (a card body built without
  // `includeLabelRefFootnote`): the question cannot be asked and no atom can be
  // built either, so degrade to the historic path rather than inventing a
  // verdict — the `blockInsertApplies` / `cardActionAllowedForCtx` fallback rule.
  if (atomType && !posHostsInlineAtom(editor.state.doc, landing, atomType)) {
    return { pos: -1, refused: true };
  }

  // focus(null, { scrollIntoView: false }): focus the doc (the grab-bar /
  // action-menu item is a button, so focus may be off the doc) but suppress the
  // deferred scrollIntoView that `focus()` schedules by default — the whole point.
  const chain = editor.chain().focus(null, { scrollIntoView: false });
  // Captured-position contract (deferred popover commit): land the atom at the
  // trigger-time `at` even if the live selection drifted. Clamp to the live doc
  // so a stale/collab-shifted pos can't throw — `setTextSelection` carries no
  // scrollIntoView, so the no-scroll invariant is preserved.
  if (typeof at === "number") {
    chain.setTextSelection(landing);
  }
  chain.insertContent({ type, attrs }).run();

  // Locate the inserted atom: insertContent rests the caret just past it, so the
  // node immediately before the caret IS the atom. Generic over nodeSize so it
  // holds for any inline atom, not just the nodeSize-1 leaves of today.
  const caret = editor.state.selection.from;
  const before = editor.state.doc.resolve(caret).nodeBefore;
  return { pos: before ? caret - before.nodeSize : -1, refused: false };
}
