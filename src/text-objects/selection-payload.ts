/**
 * What does the LIVE SELECTION stand for?
 *
 * > **A TEXT-LIFT gesture is a PARTIAL range. A selection that covers exactly
 * > one textblock's whole content is a statement about that BLOCK, and the
 * > affordance for it is the block's own grab handle — not a text slice with the
 * > block's shell left behind.**
 *
 * Both selection ladders in this directory (`TextObjectGrabHandle`'s
 * `resolveActiveRefs` and `active-text-object-context`'s `resolveFromSelection`)
 * open with the same ancestor walk: from `sel.from`, outward, to the nearest
 * uuid-bearing `TextObjectKind` — the `DEFERRING_PARENTS` fact that a
 * `listItem`'s inner paragraph carries no uuid while the `listItem` does. That
 * walk was written twice; it is `selectionOwner` here, read by both.
 *
 * The WHOLE-BLOCK question on top of it is the grab handle's alone, and the
 * asymmetry is deliberate rather than an oversight — stated here so nobody
 * "unifies" it later without deciding:
 *
 *   • The grab handle resolves a DRAG PAYLOAD. Dragging a whole-block selection
 *     as a text slice is destructive by construction: the inline-cursor branch
 *     of `text-range-move` splices the run into the target block mid-word and
 *     deliberately sheds no shell (see its :192-199), so the source survives as
 *     an EMPTY uuid-bearing husk that every anchored card and marker still
 *     points at. Dragging it as the BLOCK is what the user meant and what the
 *     baseline (no selection) already does.
 *   • The menus resolve an ANCHOR TARGET. Whether a triple-click over a whole
 *     paragraph should mint a Mode-B `linkedRange` or a Mode-A paragraph anchor
 *     is a product question about card anchoring with no reported symptom, so
 *     `resolveFromSelection` keeps its pre-482 answer.
 *
 * Task 482. The reported class is the SEQUENCE trap — a block-move commit used
 * to leave a content TextSelection over what it moved, so the second drag at the
 * same pixel silently had a different payload KIND from the first. That exit
 * state is fixed at its source (`mapped-insert.ts` → `placeCaretAtLanding`);
 * this predicate is the NET, and it covers every OTHER producer of a
 * whole-block selection — a triple-click, a `Cmd+A` inside one block, a
 * text-range move that landed as exactly one new block.
 */

import type { Editor } from "@tiptap/react";
import { NodeSelection, type Selection } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { isTextObjectKind } from "./text-object-registry";
import type { SelectionRef, TextObjectKind, TextObjectRef } from "./types";

/** The uuid-bearing TextObject that OWNS a resolved position, plus where it sits. */
export interface SelectionOwner {
  ref: TextObjectRef;
  /** Position immediately BEFORE the owning node — `view.nodeDOM()` takes this. */
  pos: number;
}

/**
 * Walk outward from `pos` to the nearest uuid-bearing `TextObjectKind`.
 * `linkedRange` is excluded: it is a MARK-backed range, never a node ancestor.
 */
export function selectionOwner(doc: PMNode, pos: number): SelectionOwner | null {
  const $pos = doc.resolve(pos);
  for (let d = $pos.depth; d >= 0; d--) {
    const node = $pos.node(d);
    const name = node.type.name;
    if (!isTextObjectKind(name) || name === "linkedRange") continue;
    const uuid = node.attrs?.uuid as string | null | undefined;
    if (!uuid) continue;
    return {
      ref: { kind: name as TextObjectKind, id: uuid },
      // d === 0 is the doc itself, which has no `before` — but the doc is not a
      // TextObjectKind, so the loop can never return from there.
      pos: $pos.before(d),
    };
  }
  return null;
}

/** The `paragraphId` half of the walk — what a `SelectionRef` carries. */
export function selectionOwnerId(doc: PMNode, pos: number): string | null {
  return selectionOwner(doc, pos)?.ref.id ?? null;
}

/**
 * Is this selection exactly ONE textblock's whole content?
 *
 * Both endpoints in the same textblock (`sameParent`), at offset 0 and at the
 * block's full content size. An EMPTY block cannot qualify — `sel.empty` is
 * excluded, and a zero-size textblock would have from === to anyway.
 *
 * Returns the uuid-bearing owner of that textblock (the `listItem`, not its
 * inner paragraph), or null.
 */
export function wholeBlockSelection(sel: Selection, doc: PMNode): SelectionOwner | null {
  // `from === to`, not `sel.empty` — the same spelling both ladders used before
  // this module existed. They are the identical claim on a real `Selection`
  // (`empty` is a getter over exactly that comparison), and the explicit form is
  // what a hand-built fixture can satisfy.
  if (sel.from === sel.to || sel instanceof NodeSelection) return null;
  const $from = doc.resolve(sel.from);
  const $to = doc.resolve(sel.to);
  if (!$from.parent.isTextblock) return null;
  if (!$from.sameParent($to)) return null;
  if ($from.parentOffset !== 0) return null;
  if ($to.parentOffset !== $to.parent.content.size) return null;
  return selectionOwner(doc, sel.from);
}

/** Convenience for a live editor. */
export function wholeBlockSelectionIn(editor: Editor): SelectionOwner | null {
  return wholeBlockSelection(editor.state.selection, editor.state.doc);
}


/**
 * What the grab handle's rule 1 answers — the whole of it, stated ONCE here so a
 * suite can drive it against a real post-commit editor state without mounting
 * the component (the part that could misbehave was never the predicate; it is a
 * ladder that never asks it).
 *
 *   • `"block"` — the selection covers exactly one textblock's content, so the
 *     handle is that block's own and the drag payload is the BLOCK.
 *   • `"range"` — a genuine PARTIAL/multi-block range: a text lift.
 *   • `null`   — collapsed, a node selection, or no uuid-bearing owner; rule 1
 *     declines and the ladder falls through to its later branches.
 *
 * The DOM resolution (`view.nodeDOM(pos)`) stays at the call site: this module
 * is deliberately view-free.
 */
export type SelectionGrab =
  | { payload: "block"; ref: TextObjectRef; pos: number }
  | { payload: "range"; ref: SelectionRef }
  | null;

export function resolveSelectionGrab(sel: Selection, doc: PMNode): SelectionGrab {
  if (sel.from === sel.to || sel instanceof NodeSelection) return null;
  const whole = wholeBlockSelection(sel, doc);
  if (whole) return { payload: "block", ref: whole.ref, pos: whole.pos };
  const paragraphId = selectionOwnerId(doc, sel.from);
  if (!paragraphId) return null;
  return {
    payload: "range",
    ref: { kind: "selection", from: sel.from, to: sel.to, paragraphId },
  };
}
