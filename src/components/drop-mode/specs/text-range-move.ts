/**
 * Drop spec for a plain text SELECTION lifted as a `linkedRange` (L3f-2).
 *
 * A plain selection grab hydrates a transient `linkedAnchor` over the range
 * and drives the lifted overlay (TextObjectGrabHandle). On a ghost-mode
 * release over text this spec MOVES the marked run to the inline caret —
 * the range analogue of `textobject.ts`'s block move, but the payload is a
 * text SLICE (possibly partial-paragraph), not a whole node, and it inserts
 * at an inline-cursor position rather than between blocks.
 *
 * SCOPE (L3f-2): within-text only — `allowedPlacements: ["inline-cursor"]`.
 * The hit-test yields a caret over text and NOTHING in block gaps, so block
 * gaps are inert. The between-paragraphs (block-gap) drop + its wrapping
 * policy is L3f-3, out of scope here.
 *
 * The moved slice has every `linkedAnchor` mark STRIPPED
 * (`stripLinkedAnchorMarks`, mirroring `LinkedAnchorGuard.transformPasted`):
 * the relocated text carries no anchor identity — no transient handle litter,
 * consistent with paste semantics. The source-side transient mark is removed
 * separately by the grab handle's `removeTransientAnchor` after commit.
 *
 * The range's home is the main editor (the plain grab is on the main doc), so
 * the source is resolved from `ctx.mainEditor`. Same-editor drops delete +
 * adjusted-insert in one transaction (like block-move); a drop into a card
 * body inserts there then deletes from the source.
 */

import { TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { parseTextObjectPopoutKey } from "@/text-objects/text-object-registry";
import {
  findLinkedAnchorRange,
  stripLinkedAnchorMarks,
} from "@/lib/linked-anchor-range";
import type { DropSpec } from "../types";

interface RangeSource {
  editor: Editor;
  from: number;
  to: number;
}

/** Resolve the marked range in the main doc (where the plain grab stamps it). */
function locateRange(cardKey: string, mainEditor: Editor | null): RangeSource | null {
  if (!mainEditor) return null;
  const ref = parseTextObjectPopoutKey(cardKey);
  if (!ref || ref.kind !== "linkedRange") return null;
  const range = findLinkedAnchorRange(mainEditor.state.doc, ref.id);
  if (!range) return null;
  return { editor: mainEditor, from: range.from, to: range.to };
}

export const textRangeMoveDropSpec: DropSpec = {
  allowedPlacements: ["inline-cursor"],
  targetScope: "any-editor",
  classifyDrop(placement, cardKey, ctx) {
    if (placement.kind !== "inline-cursor") return { kind: "no-op" };
    const src = locateRange(cardKey, ctx.mainEditor);
    if (!src) return { kind: "no-op" };
    // Self-drop: releasing inside the source range leaves the text where it
    // was (no move).
    if (
      placement.editor === src.editor &&
      placement.pos >= src.from &&
      placement.pos <= src.to
    ) {
      return { kind: "no-op" };
    }
    return { kind: "apply" };
  },
  applyDrop(placement, cardKey, ctx) {
    if (placement.kind !== "inline-cursor") return;
    const src = locateRange(cardKey, ctx.mainEditor);
    if (!src) return;
    const { editor: targetEditor, pos: insertPos } = placement;
    const { editor: sourceEditor, from, to } = src;

    // The payload: the marked slice with every linkedAnchor mark stripped, so
    // the relocated text sheds the transient (or any) anchor identity.
    const slice = stripLinkedAnchorMarks(sourceEditor.state.doc.slice(from, to));
    if (slice.size === 0) return;

    if (targetEditor === sourceEditor) {
      // Single transaction: delete the source, then insert at the position
      // adjusted for the delete (mirrors block-move / inline-atom-move).
      const adjustedInsert = insertPos > to ? insertPos - (to - from) : insertPos;
      const tr = targetEditor.state.tr.delete(from, to);
      tr.replace(adjustedInsert, adjustedInsert, slice);
      selectInserted(tr, adjustedInsert, slice.size);
      targetEditor.view.dispatch(tr);
      targetEditor.view.focus();
      return;
    }

    // Cross-editor: insert into the target first, then delete from the source.
    const insertTr = targetEditor.state.tr.replace(insertPos, insertPos, slice);
    selectInserted(insertTr, insertPos, slice.size);
    targetEditor.view.dispatch(insertTr);
    targetEditor.view.focus();
    const deleteTr = sourceEditor.state.tr.delete(from, to);
    sourceEditor.view.dispatch(deleteTr);
  },
  postDrop: "close",
};

/** Select the inserted run so the user sees where the text landed. Guarded —
 *  a near-boundary position that can't host a text selection is skipped. */
function selectInserted(
  tr: import("@tiptap/pm/state").Transaction,
  pos: number,
  size: number,
): void {
  try {
    const end = Math.min(tr.doc.content.size, pos + size);
    tr.setSelection(
      TextSelection.between(tr.doc.resolve(pos), tr.doc.resolve(end)),
    );
  } catch {
    /* position couldn't host a text selection — leave the doc's selection */
  }
}
