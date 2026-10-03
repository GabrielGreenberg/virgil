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

import { inlineRangeAllowsAtom } from "@/text-objects/text-object-registry";
import { cardAtomMetaForNodeName } from "@/lib/tiptap/atom-registry";
import { surfaceEditableNow } from "@/lib/tiptap/surface-editable";

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
  /** Document position of the inserted atom in the post-dispatch doc, found by
   *  IDENTITY (its node type, plus its id attr for a Card-bearing kind — task
   *  911), never by "whatever sits before the caret". `-1` whenever `refused`. */
  pos: number;
  /**
   * True whenever the atom is NOT in the document — for ANY reason:
   *
   *   - a DOOR GATE declined before building anything (the CONTAINER gate,
   *     task 396: this position cannot host this atom; the EDITABILITY gate,
   *     task 638/911: the partner holds the pen or the host mounted the surface
   *     read-only) — the document is then completely untouched;
   *   - or the insert ran and did not LAND (task 911): a `filterTransaction`
   *     veto (`readOnlyEnforcer`, or any future filter), a schema refusal, or a
   *     transform that dropped the atom. Measured after the fact, so no gate
   *     list has to be complete for the report to be honest.
   *
   * A caller that mints an id / registers a card before calling reads this to
   * know its atom never landed. The reasons share one flag on purpose: the
   * caller's obligation is identical either way — do not register the card
   * whose atom is not in the document — and a caller that had to enumerate the
   * REASONS would be one reason behind the next gate.
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
  // No try/catch: these are the inherited `Selection.atStart`/`atEnd` statics,
  // which do `findSelectionIn(…) || new AllSelection(doc)` and cannot throw — a
  // doc with no text position at all yields `[0, doc.content.size]`, i.e. the
  // raw clamp. A catch here would describe a failure mode that does not exist.
  const min = TextSelection.atStart(doc).from;
  const max = TextSelection.atEnd(doc).to;
  return Math.max(min, Math.min(at, max));
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

  // ── EDITABILITY GATE (task 638, honest since task 911) — at the same seam,
  // for the same reason the CONTAINER gate below is here: this is the DEEPEST
  // point, and the only one the DEFERRED create-popover commit passes through.
  // `refRun` / `citationRun` gate the popover's OPEN; the atom lands on COMMIT,
  // which can be many seconds later — long enough for the collab pen to change
  // hands while the user is picking citekeys in a portal `<input>`.
  //
  // Asked through `surfaceEditableNow` (pen ∧ host), NOT `collabReadOnly`: on
  // MAIN `view.editable` is pinned `true` and the real answer lives in
  // `editableRef`, so the pen-only gate was a CONSTANT `false` there and let a
  // read-only commit through to a transaction `readOnlyEnforcer` then dropped
  // (task 911). Per-EDITOR, deliberately: a card body publishes no
  // `editableRef` and is answered by its own `view.editable`.
  //
  // This is the early, side-effect-free refusal. The GUARANTEE is the landing
  // measurement at the bottom of this function, which no future filter can
  // slip past.
  if (!surfaceEditableNow(editor)) {
    return { pos: -1, refused: true };
  }

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
  // which is precisely why this reads the inline-atom SSOT and not the block gate.
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
  //
  // RANGE form (task 428): with no `at`, `insertContent` REPLACES the live
  // selection `[from, to]`, so every textblock that range reaches must host the
  // atom — a selection running from prose INTO a `codeBlock` is refused whole
  // rather than judged at `from` alone. With an explicit `at`, `setTextSelection`
  // first COLLAPSES the selection to that caret, so nothing is replaced and the
  // single-position (caret) form is the exact question.
  const [landingFrom, landingTo] =
    typeof at === "number"
      ? (() => {
          const p = clampToTextRange(editor, at);
          return [p, p] as const;
        })()
      : ([editor.state.selection.from, editor.state.selection.to] as const);
  const landing = landingFrom;
  const atomType = editor.state.schema.nodes[type];
  // No such node in THIS editor's schema (a card body built without
  // `includeLabelRefFootnote`): the question cannot be asked and no atom can be
  // built either, so degrade to the historic path rather than inventing a
  // verdict — the `blockInsertApplies` / `cardActionAllowedForCtx` fallback rule.
  if (atomType && !inlineRangeAllowsAtom(editor.state.doc, landingFrom, landingTo, atomType)) {
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
  const docBefore = editor.state.doc;
  chain.insertContent({ type, attrs }).run();

  // ── LANDING MEASUREMENT (task 911) — the report is the EFFECT, not the
  // attempt. A filtered transaction leaves the editor's doc identical by
  // reference (`dispatchLanded`'s question, drop-mode/commit-seam.ts — task
  // 648's twin of this defect at the drop door); an applied one always yields
  // a new doc. Then the atom itself must be found by identity: a doc that
  // changed without carrying the atom (a transform that dropped it) is not a
  // landed insert either.
  if (editor.state.doc === docBefore) return { pos: -1, refused: true };
  const pos = locateInsertedAtom(editor, type, attrs);
  return { pos, refused: pos < 0 };
}

/**
 * Where the just-inserted atom sits, by IDENTITY. `insertContent` rests the
 * caret just past it, so the node before the caret is the fast answer — but it
 * is only accepted when it IS the atom: same node type and, for a Card-bearing
 * kind, the caller's id (`ATOM_REGISTRY`'s `idAttr`, task 645). Otherwise a
 * Card-bearing atom is looked up by its id across the doc (a user gesture, not a
 * keystroke — the O(doc) fallback runs only when the caret answer disagrees);
 * an id-less atom has no identity beyond the caret, so it reports `-1`.
 */
function locateInsertedAtom(
  editor: Editor,
  type: string,
  attrs: Record<string, unknown>,
): number {
  const { doc, selection } = editor.state;
  const idAttr = cardAtomMetaForNodeName(type)?.idAttr ?? null;
  const id = idAttr ? attrs[idAttr] : undefined;
  const isAtom = (node: { type: { name: string }; attrs: Record<string, unknown> }) =>
    node.type.name === type && (!idAttr || id == null || node.attrs[idAttr] === id);

  const caret = selection.from;
  const before = doc.resolve(caret).nodeBefore;
  if (before && isAtom(before)) return caret - before.nodeSize;
  if (!idAttr || id == null) return -1;

  let found = -1;
  doc.descendants((node, p) => {
    if (found >= 0) return false;
    if (isAtom(node)) {
      found = p;
      return false;
    }
    return true;
  });
  return found;
}
