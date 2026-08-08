/**
 * Unified drop spec for popped-out TextObjects.
 *
 * One spec replaces the per-source-kind specs that used to live as
 * `paragraph.ts`, `heading.ts`, and (someday) any other kind. The
 * cardKey `textobject:<kind>:<id>` carries enough info to resolve the
 * source via the registry's `collectMoveSource` (default: single-node
 * walk; headings override to collect the whole section) and to dispatch
 * the wrap-or-not decision via `meta.dropAdapter`.
 *
 * Drop-target classification:
 *   - top-level         — the insert position is a sibling of top-level
 *                         blocks (parent is `doc`).
 *   - inside-compatible — the immediate enclosing TextObject parent
 *                         accepts this kind as a child.
 *   - inside-incompatible — the enclosing parent doesn't accept it; the
 *                         adapter wraps into a fresh single-item parent.
 *
 * Source kinds that aren't sub-objects always get `top-level` classified
 * targets (their adapter is `topLevelDropAdapter`, which returns
 * `drop-direct`). The classification still runs so future sub-object
 * additions are trivial.
 */

import { TextSelection } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  parseTextObjectPopoutKey,
  TEXT_OBJECT_REGISTRY,
} from "@/text-objects/text-object-registry";
import { isCompatibleParent, tryBuildWrap } from "@/text-objects/drop-adapters";
import type {
  DropTarget,
  MoveSource,
  TextObjectKind,
  TextObjectSourceContext,
} from "@/text-objects/types";
import {
  canDropDirectAt,
  classifyParentAt,
  fitNodesAtInsert,
} from "./drop-context";
import type { DropSpec, Placement } from "../types";

export const textObjectDropSpec: DropSpec = {
  allowedPlacements: ["between-blocks"],
  targetScope: "any-editor",
  classifyDrop(placement, cardKey) {
    if (placement.kind !== "between-blocks") return { kind: "no-op" };
    const src = locate(placement, cardKey);
    if (!src) return { kind: "no-op" };
    // No-op if the drop position is inside the source's own range.
    if (
      placement.editor === src.editor &&
      placement.insertPos >= src.move.from &&
      placement.insertPos <= src.move.to
    ) {
      return { kind: "no-op" };
    }
    return { kind: "apply" };
  },
  applyDrop(placement, cardKey) {
    if (placement.kind !== "between-blocks") return;
    const src = locate(placement, cardKey);
    if (!src) return;
    const targetEditor = placement.editor;
    const targetParentKind = classifyParentAt(targetEditor, placement.insertPos);
    // Feature A2 — schema-driven wrap-vs-direct. Compute whether the source node
    // can drop DIRECTLY at the immediate insert parent (the expex kinds are
    // always single-node moves, so the first node's type is the right test).
    // `blockIntoExpexDropAdapter` keys on this to separate a single example's
    // widened body (drop-direct) from the multi between-items gap (wrap); every
    // other adapter ignores it, so they're byte-unchanged.
    const sourceType = src.move.nodes[0]?.type;
    const canDropDirect = sourceType
      ? canDropDirectAt(targetEditor, placement.insertPos, sourceType)
      : undefined;
    // Task 065 — the ONE wrap-validity gate, shared by all three wrap adapters.
    // Given a kind, reports whether a bare node of that kind is schema-valid at
    // the TRUE immediate insert parent (`canDropDirectAt` over the resolved node
    // type). Each wrap adapter asks it about the node it is about to fabricate:
    // `blockIntoExpexDropAdapter` → `exampleItem` (the A2 edge-fix, formerly the
    // bespoke `canWrapHere` boolean — true exactly at the multi between-items
    // gap, immediate parent `exampleItemList`); `listItemDropAdapter` →
    // `bulletList`/`orderedList`; `exampleItemDropAdapter` → `exampleBlock`. The
    // last two use it to REJECT a cross-kind sub-object dropped into a foreign
    // container's item gap, which would otherwise fabricate a here-invalid wrap
    // that ProseMirror fits by splitting the container (duplicate uuid). Cheap:
    // a single `canReplaceWith` at the resolved index, computed lazily per call.
    const schema = targetEditor.state.schema;
    const canPlaceHere = (kind: TextObjectKind): boolean => {
      const nodeType = schema.nodes[kind];
      return nodeType
        ? canDropDirectAt(targetEditor, placement.insertPos, nodeType)
        : false;
    };
    const target: DropTarget = {
      ...classifyDropTarget(src.kind, targetParentKind),
      canDropDirect,
      canPlaceHere,
    };
    const action = TEXT_OBJECT_REGISTRY[src.kind].dropAdapter(
      { kind: src.kind, id: src.id, sourceContext: src.sourceContext },
      target,
    );
    // A wrap adapter returns `no-op` when the wrap it would fabricate is invalid
    // at the true immediate parent (task 065) — reject the drop, insert nothing.
    if (action.kind === "no-op") return;

    // Build the node(s) to insert. For drop-direct: the original
    // collected nodes. For wrap: wrap each top-level source node in a
    // fresh single-item parent. Wraps target single-source moves; if a
    // multi-node source ever needs wrap, we wrap each node individually
    // (today only headings collect multiple, and they never wrap).
    let toInsert: ReadonlyArray<PMNode> = src.move.nodes;
    if (action.kind === "wrap") {
      // `tryBuildWrap`, not `buildWrap`: the wrap is built with `createChecked`,
      // so a wrapper that cannot HOLD this node is a null rather than a
      // silently-invalid node. The adapter approved the wrap's placement, not
      // its content, so refuse rather than fabricate (task 257).
      const wrapped: PMNode[] = [];
      for (const n of toInsert) {
        const w = tryBuildWrap(targetEditor.state.schema, n, action.parentKind);
        if (!w) return;
        wrapped.push(w);
      }
      toInsert = wrapped;
    }

    // The adapter above expresses what this KIND prefers; the container-fit
    // SSOT below is the authority on what this CONTAINER can actually hold
    // (task 257). The two are not the same question, and the gap between them
    // was a live corruption: the registry adapters know expex and the
    // sub-object containers but nothing about lists, so a paragraph block-move
    // released in a list-item gap drop-directed a bare paragraph into
    // `bulletList` (content `listItem+`) and ProseMirror's fitter split the
    // list in two — both halves keeping the SAME uuid — exactly the mirror of
    // the expex tear the text-range move was producing from its own list-only
    // literal. Routing both through `fitNodesAtInsert` retires the pair and
    // every future container kind with them.
    //
    // A no-op net: where the adapter's answer is already valid here (every case
    // its `canPlaceHere` gate approves), the fit reports `direct` and the nodes
    // pass through byte-for-byte. Where nothing fits, this returns BEFORE the
    // transaction is built, so the source is never deleted.
    const fit = fitNodesAtInsert(targetEditor, placement.insertPos, toInsert, {
      prefer: src.sourceContext.parentKind,
    });
    if (fit.kind === "reject") return;
    toInsert = fit.nodes;

    const sameEditor = targetEditor === src.editor;
    if (sameEditor) {
      const sectionSize = src.move.to - src.move.from;
      const adjustedInsert =
        placement.insertPos > src.move.to
          ? placement.insertPos - sectionSize
          : placement.insertPos;
      const tr = targetEditor.state.tr.delete(src.move.from, src.move.to);
      let cursor = adjustedInsert;
      for (const n of toInsert) {
        tr.insert(cursor, n);
        cursor += n.nodeSize;
      }
      // Select the inserted block(s).
      const selStart = adjustedInsert + 1;
      const selEnd = cursor - 1;
      if (selEnd > selStart) {
        tr.setSelection(
          TextSelection.between(
            tr.doc.resolve(selStart),
            tr.doc.resolve(selEnd),
          ),
        );
      }
      targetEditor.view.dispatch(tr);
      targetEditor.view.focus();
      return;
    }

    // Cross-editor: insert first, then delete from source.
    const insertTr = targetEditor.state.tr;
    let cursor = placement.insertPos;
    for (const n of toInsert) {
      insertTr.insert(cursor, n);
      cursor += n.nodeSize;
    }
    targetEditor.view.dispatch(insertTr);
    targetEditor.view.focus();
    const deleteTr = src.editor.state.tr.delete(src.move.from, src.move.to);
    src.editor.view.dispatch(deleteTr);
  },
  postDrop: "close",
};

// ---------------------------------------------------------------------------
// Source resolution
// ---------------------------------------------------------------------------

interface LocatedSource {
  editor: import("@tiptap/react").Editor;
  kind: TextObjectKind;
  id: string;
  move: MoveSource;
  sourceContext: TextObjectSourceContext;
}

function locate(placement: Placement, cardKey: string): LocatedSource | null {
  const ref = parseTextObjectPopoutKey(cardKey);
  if (!ref) return null;
  const editor = placement.editor;
  const move = resolveMoveSource(editor.state.doc, ref.kind, ref.id);
  if (!move) return null;
  const sourceContext = collectSourceContext(editor.state.doc, ref.kind, ref.id);
  return { editor, kind: ref.kind, id: ref.id, move, sourceContext };
}

function resolveMoveSource(
  doc: PMNode,
  kind: TextObjectKind,
  uuid: string,
): MoveSource | null {
  const meta = TEXT_OBJECT_REGISTRY[kind];
  if (meta.collectMoveSource) {
    return meta.collectMoveSource(doc, uuid);
  }
  // Default: single-node lookup by uuid + type name.
  let found: MoveSource | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === kind && node.attrs?.uuid === uuid) {
      found = { from: pos, to: pos + node.nodeSize, nodes: [node] };
      return false;
    }
    return true;
  });
  return found;
}

/**
 * Walk the doc to find the source node's immediate TextObject parent
 * kind, if any. Used to populate `sourceContext.parentKind` so the
 * adapter can decide what wrap to apply.
 */
function collectSourceContext(
  doc: PMNode,
  kind: TextObjectKind,
  uuid: string,
): TextObjectSourceContext {
  let parentKind: TextObjectKind | undefined;
  doc.descendants((node, _pos, parent) => {
    if (parentKind) return false;
    if (node.type.name === kind && node.attrs?.uuid === uuid) {
      const pname = parent?.type.name;
      if (pname && pname in TEXT_OBJECT_REGISTRY) {
        parentKind = pname as TextObjectKind;
      }
      return false;
    }
    return true;
  });
  return { parentKind, docContext: "float" };
}

// ---------------------------------------------------------------------------
// Drop-target classification
// ---------------------------------------------------------------------------

function classifyDropTarget(
  sourceKind: TextObjectKind,
  parentKind: TextObjectKind | null,
): DropTarget {
  if (!parentKind) return { kind: "top-level" };
  // Single source of truth for child→parent compatibility: `isCompatibleParent`
  // in drop-adapters.ts. Previously this inline-duplicated that logic, which
  // risked drift — the new graphicsBlock→exampleItem rule would have needed
  // editing in two places. One call now covers every kind.
  if (isCompatibleParent(sourceKind, parentKind)) {
    return { kind: "inside-compatible-parent", parentKind };
  }
  return { kind: "inside-incompatible-parent", parentKind };
}
