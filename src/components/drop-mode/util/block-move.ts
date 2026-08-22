/**
 * Generic factory for "move a single anchorable block" drop specs.
 *
 * Used by paragraph and example block. Each block is identified by
 * `attrs.uuid` and `type.name`; the spec finds it in the target
 * editor's doc, builds one delete+insert transaction, and closes the
 * source float on success. No-op if the drop position lies inside the
 * source's own range.
 *
 * SCOPE — this spec is SAME-EDITOR by construction, and says so rather than
 * carrying a branch that cannot run (task 331). `locateSource` resolves the
 * dragged block inside `placement.editor`, i.e. the TARGET document, so the
 * source it finds is always in the editor the payload is landing in. Before
 * this, a `targetEditor === sourceEditor` fork guarded an insert-then-delete
 * cross-editor branch whose condition was true by construction — unreachable
 * code reasoning about a dispatch ordering that could never occur, which is
 * exactly what the dead-SSOT rule (`AGENTS.md`, "A registry earns its name by
 * being read") outlaws. Making a cross-editor block move real is a PRODUCT
 * decision, not a mechanical one: it would newly enable main→card-body block
 * capture, which the capture/schema-symmetry law governs.
 *
 * For multi-block moves (a heading + its section body) see
 * `specs/heading.ts`, which uses `getSectionRangeByUuid` instead of
 * single-node lookup.
 */

import { Node as PMNode } from "@tiptap/pm/model";
import type { DropPlan, DropSpec, Placement } from "../types";
import { fitNodesAtInsert } from "../specs/drop-context";
import { plannedDropSpec } from "../planned-spec";
import { insertNodesAdvancing, selectInsertedSpan } from "./mapped-insert";
import { parseAnyKey } from "@/floats/float-key";

export interface BlockMoveOptions {
  /** Schema node name (e.g. "paragraph", "exampleBlock"). */
  nodeName: string;
}

export function blockMoveSpec(opts: BlockMoveOptions): DropSpec {
  return plannedDropSpec({
    allowedPlacements: ["between-blocks"],
    /** The payload is exactly one block of this factory's node kind (task 416)
     *  — a static answer, so it needs neither the key nor the ctx. */
    blockPayloadFor: () => [opts.nodeName],
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
      if (placement.insertPos >= src.from && placement.insertPos <= src.to) {
        return null;
      }
      const { editor, insertPos } = placement;
      const { node: sourceNode, from, to } = src;
      // The shared container-fit gate (task 257) — this factory asked NOTHING
      // about the drop context, so an exampleBlock card released in another
      // example's item gap spliced an `exampleBlock` into `exampleItemList` and
      // the fitter tore that example in two (duplicate uuid), the same class the
      // two move specs were hitting from their own half-answers. It fits or it
      // refuses; a refusal returns before the delete, leaving the doc untouched.
      const fit = fitNodesAtInsert(editor, insertPos, [sourceNode]);
      if (fit.kind === "reject") return null;
      const tr = editor.state.tr.delete(from, to);
      // ASK the transaction where the insert position went; never predict it
      // (task 331 — the shared rule, and the whole of `mapped-insert.ts`'s
      // header). This was `insertPos - (to - from)`, which assumes `tr.delete`
      // removed the source's declared node size; where the emptied parent keeps
      // a minimal valid residue it does not, and the insert lands early enough
      // to be spliced INSIDE the preceding block, which the fitter then closes
      // — tearing one node into two that both keep its uuid.
      const span = insertNodesAdvancing(tr, { mapThrough: insertPos }, fit.nodes);
      selectInsertedSpan(tr, span);
      return {
        commit: () => {
          editor.view.dispatch(tr);
          editor.view.focus();
        },
      };
    },
  });
}

interface SourceInfo {
  node: PMNode;
  from: number;
  to: number;
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
      found = { node, from: pos, to: pos + node.nodeSize };
      return false;
    }
    return true;
  });
  return found;
}
