/**
 * Generic factory for "move a single anchorable block" drop specs.
 *
 * Used by paragraph and example block. Each block is identified by
 * `attrs.uuid` and `type.name`; the spec finds it in the target
 * editor's doc, builds a delete+insert transaction (single-tx for
 * same-editor, two-tx for cross-editor), and closes the source float
 * on success. No-op if the drop position lies inside the source's
 * own range.
 *
 * For multi-block moves (a heading + its section body) see
 * `specs/heading.ts`, which uses `getSectionRangeByUuid` instead of
 * single-node lookup.
 */

import { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { DropSpec, Placement } from "../types";

export interface BlockMoveOptions {
  /** Schema node name (e.g. "paragraph", "exampleBlock"). */
  nodeName: string;
}

export function blockMoveSpec(opts: BlockMoveOptions): DropSpec {
  return {
    allowedPlacements: ["between-blocks"],
    targetScope: "any-editor",
    classifyDrop(placement, cardKey) {
      if (placement.kind !== "between-blocks") return { kind: "no-op" };
      const src = locateSource(opts, placement, cardKey);
      if (!src) return { kind: "no-op" };
      if (
        placement.editor === src.editor &&
        placement.insertPos >= src.from &&
        placement.insertPos <= src.to
      ) {
        return { kind: "no-op" };
      }
      return { kind: "apply" };
    },
    applyDrop(placement, cardKey) {
      if (placement.kind !== "between-blocks") return;
      const src = locateSource(opts, placement, cardKey);
      if (!src) return;
      const { editor: targetEditor, insertPos } = placement;
      const { editor: sourceEditor, node, from, to } = src;
      if (targetEditor === sourceEditor) {
        const adjustedInsert = insertPos > to ? insertPos - (to - from) : insertPos;
        const tr = targetEditor.state.tr.delete(from, to);
        tr.insert(adjustedInsert, node);
        selectInsertedBlock(tr, adjustedInsert, node.nodeSize);
        targetEditor.view.dispatch(tr);
        targetEditor.view.focus();
        return;
      }
      const insertTr = targetEditor.state.tr.insert(insertPos, node);
      selectInsertedBlock(insertTr, insertPos, node.nodeSize);
      targetEditor.view.dispatch(insertTr);
      targetEditor.view.focus();
      const deleteTr = sourceEditor.state.tr.delete(from, to);
      sourceEditor.view.dispatch(deleteTr);
    },
    postDrop: "close",
  };
}

interface SourceInfo {
  editor: Placement["editor"];
  node: PMNode;
  from: number;
  to: number;
}

/**
 * After inserting `node` at `pos`, set the transaction's selection to
 * cover the node's inline content (just inside its block boundaries).
 * Uses `TextSelection.between` so positions near block edges are
 * snapped to the nearest valid text point.
 */
function selectInsertedBlock(
  tr: import("@tiptap/pm/state").Transaction,
  pos: number,
  nodeSize: number,
): void {
  const start = pos + 1;
  const end = pos + nodeSize - 1;
  if (end <= start) return;
  const $start = tr.doc.resolve(start);
  const $end = tr.doc.resolve(end);
  tr.setSelection(TextSelection.between($start, $end));
}

function locateSource(
  opts: BlockMoveOptions,
  placement: Placement,
  cardKey: string,
): SourceInfo | null {
  const sep = cardKey.indexOf(":");
  if (sep <= 0) return null;
  const uuid = cardKey.slice(sep + 1);
  const editor = placement.editor;
  let found: SourceInfo | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.attrs?.uuid === uuid && node.type.name === opts.nodeName) {
      found = { editor, node, from: pos, to: pos + node.nodeSize };
      return false;
    }
    return true;
  });
  return found;
}
