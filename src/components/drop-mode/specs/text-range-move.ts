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
 * SCOPE: two targets, mirroring the user's "within-text caret + between-
 * paragraphs line" framing. `allowedPlacements: ["inline-cursor",
 * "between-blocks"]`. Over text the hit-test yields an inline caret and the
 * run MOVES to it (L3f-2). In a block gap it yields a between-blocks
 * placement and the run drops as BLOCK content, fit to the gap's context
 * (L3f-3): a top-level gap → a new paragraph, a list gap → a list item, a
 * blockquote → a paragraph inside the quote. A within-one-paragraph fragment
 * becomes its OWN paragraph (NOT merged into a neighbour — that is the
 * inline-cursor move's job); a multi-block range preserves its blocks.
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
  rangeSliceToBlocks,
  stripLinkedAnchorMarks,
} from "@/lib/linked-anchor-range";
import { classifyParentAt } from "./drop-context";
import type { DropCtx, DropSpec, Placement } from "../types";

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
  allowedPlacements: ["inline-cursor", "between-blocks"],
  targetScope: "any-editor",
  classifyDrop(placement, cardKey, ctx) {
    if (placement.kind !== "inline-cursor" && placement.kind !== "between-blocks") {
      return { kind: "no-op" };
    }
    const src = locateRange(cardKey, ctx.mainEditor);
    if (!src) return { kind: "no-op" };
    // Self-drop: releasing inside the source range leaves the text where it
    // was (no move). Both placements carry a doc position — the inline caret
    // (`pos`) or the block gap (`insertPos`).
    const dropPos =
      placement.kind === "inline-cursor" ? placement.pos : placement.insertPos;
    if (placement.editor === src.editor && dropPos >= src.from && dropPos <= src.to) {
      return { kind: "no-op" };
    }
    return { kind: "apply" };
  },
  applyDrop(placement, cardKey, ctx) {
    // Between-paragraphs (block-gap) drop — the run becomes block content,
    // fit to the gap's context. Kept in a sibling function so the L3f-2
    // inline-cursor move below stays byte-for-byte unchanged.
    if (placement.kind === "between-blocks") {
      applyRangeBetweenBlocks(placement, cardKey, ctx);
      return;
    }
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

/**
 * Between-paragraphs move: drop the marked run into a block gap as BLOCK
 * content, fit to the gap's context. Mirrors `textobject.ts`'s element
 * block-move — `classifyParentAt` decides the context, then delete-source +
 * adjusted-insert in one transaction (same-editor) / insert-then-delete
 * (cross-editor), advancing a cursor by each node's size. The difference: the
 * payload is the range's slice converted to blocks (`rangeSliceToBlocks` — an
 * inline run → one paragraph, a multi-block range → its blocks), not a whole
 * node, with the `linkedAnchor` mark stripped so the run sheds the transient
 * handle (consistent with the inline move + paste).
 */
function applyRangeBetweenBlocks(
  placement: Placement,
  cardKey: string,
  ctx: DropCtx,
): void {
  if (placement.kind !== "between-blocks") return;
  const src = locateRange(cardKey, ctx.mainEditor);
  if (!src) return;
  const { editor: sourceEditor, from, to } = src;
  const targetEditor = placement.editor;
  const insertPos = placement.insertPos;

  const slice = stripLinkedAnchorMarks(sourceEditor.state.doc.slice(from, to));
  if (slice.size === 0) return;
  const schema = sourceEditor.state.schema;
  let nodes = rangeSliceToBlocks(slice, schema);
  if (nodes.length === 0) return;

  // Fit the drop context (mirror `buildWrap`): a gap inside a list wraps each
  // block in a list item so the run JOINS the list (a bare paragraph would
  // split it); a blockquote / top-level gap takes the paragraph(s) directly
  // (ProseMirror places a paragraph inside the quote at a quote-internal
  // position, and at top level as a sibling block).
  const parentKind = classifyParentAt(targetEditor, insertPos);
  if (parentKind === "bulletList" || parentKind === "orderedList") {
    const listItem = schema.nodes.listItem;
    if (listItem) nodes = nodes.map((n) => listItem.create(null, [n]));
  }

  if (targetEditor === sourceEditor) {
    const adjustedInsert = insertPos > to ? insertPos - (to - from) : insertPos;
    const tr = targetEditor.state.tr.delete(from, to);
    let cursor = adjustedInsert;
    for (const n of nodes) {
      tr.insert(cursor, n);
      cursor += n.nodeSize;
    }
    selectBlocks(tr, adjustedInsert, cursor);
    targetEditor.view.dispatch(tr);
    targetEditor.view.focus();
    return;
  }

  // Cross-editor: insert into the target first, then delete from the source.
  const insertTr = targetEditor.state.tr;
  let cursor = insertPos;
  for (const n of nodes) {
    insertTr.insert(cursor, n);
    cursor += n.nodeSize;
  }
  selectBlocks(insertTr, insertPos, cursor);
  targetEditor.view.dispatch(insertTr);
  targetEditor.view.focus();
  const deleteTr = sourceEditor.state.tr.delete(from, to);
  sourceEditor.view.dispatch(deleteTr);
}

/** Select the inserted block run (just inside the first block to just inside
 *  the last) so the moved text lands selected — mirrors the block-move's
 *  selection. Guarded — a boundary that can't host a selection is skipped. */
function selectBlocks(
  tr: import("@tiptap/pm/state").Transaction,
  start: number,
  end: number,
): void {
  try {
    const selStart = start + 1;
    const selEnd = end - 1;
    if (selEnd > selStart) {
      tr.setSelection(
        TextSelection.between(tr.doc.resolve(selStart), tr.doc.resolve(selEnd)),
      );
    }
  } catch {
    /* boundary can't host a selection — leave the doc's selection */
  }
}
