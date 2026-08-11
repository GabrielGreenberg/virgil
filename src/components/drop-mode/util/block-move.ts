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
import type { DropPlan, DropSpec, Placement } from "../types";
import { fitNodesAtInsert } from "../specs/drop-context";
import { plannedDropSpec } from "../planned-spec";
import { parseAnyKey } from "@/floats/float-key";

export interface BlockMoveOptions {
  /** Schema node name (e.g. "paragraph", "exampleBlock"). */
  nodeName: string;
}

export function blockMoveSpec(opts: BlockMoveOptions): DropSpec {
  return plannedDropSpec({
    allowedPlacements: ["between-blocks"],
    targetScope: "any-editor",
    postDrop: "close",
    /**
     * ONE resolution, two doors (task 321). The container fit's `reject` — an
     * exampleBlock card released in another example's item gap — used to be a
     * bare `return` from `applyDrop` that `classifyDrop` never saw, so the
     * gesture reported `apply`, `postDrop: "close"` dismissed the popped-out
     * float, and the block never moved.
     */
    planDrop(placement, cardKey): DropPlan | null {
      if (placement.kind !== "between-blocks") return null;
      const src = locateSource(opts, placement, cardKey);
      if (!src) return null;
      if (
        placement.editor === src.editor &&
        placement.insertPos >= src.from &&
        placement.insertPos <= src.to
      ) {
        return null;
      }
      const { editor: targetEditor, insertPos } = placement;
      const { editor: sourceEditor, node: sourceNode, from, to } = src;
      // The shared container-fit gate (task 257) — this factory asked NOTHING
      // about the drop context, so an exampleBlock card released in another
      // example's item gap spliced an `exampleBlock` into `exampleItemList` and
      // the fitter tore that example in two (duplicate uuid), the same class the
      // two move specs were hitting from their own half-answers. It fits or it
      // refuses; a refusal returns before the delete, leaving the doc untouched.
      const fit = fitNodesAtInsert(targetEditor, insertPos, [sourceNode]);
      if (fit.kind === "reject") return null;
      const node = fit.nodes[0];
      if (targetEditor === sourceEditor) {
        const adjustedInsert = insertPos > to ? insertPos - (to - from) : insertPos;
        const tr = targetEditor.state.tr.delete(from, to);
        tr.insert(adjustedInsert, node);
        selectInsertedBlock(tr, adjustedInsert, node.nodeSize);
        return {
          commit: () => {
            targetEditor.view.dispatch(tr);
            targetEditor.view.focus();
          },
        };
      }
      const insertTr = targetEditor.state.tr.insert(insertPos, node);
      selectInsertedBlock(insertTr, insertPos, node.nodeSize);
      const deleteTr = sourceEditor.state.tr.delete(from, to);
      return {
        commit: () => {
          targetEditor.view.dispatch(insertTr);
          targetEditor.view.focus();
          sourceEditor.view.dispatch(deleteTr);
        },
      };
    },
  });
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
  // Colon-safe id (e.g. `float:card:example:<uuid>` → `<uuid>`).
  const uuid = parseAnyKey(cardKey)?.id;
  if (!uuid) return null;
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
