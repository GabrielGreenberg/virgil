/**
 * Drop-context classifier shared by the between-blocks drop specs.
 *
 * `classifyParentAt` resolves the nearest enclosing TextObject kind at a doc
 * position: it walks depths innermost→outermost from the resolved position
 * and returns the first node whose type name is a registered TextObjectKind,
 * or null when the position sits at the top level (a sibling of top-level
 * blocks). A spec uses it to FIT inserted content to its context — a block
 * dropped into a list gap becomes a list item, into a blockquote a paragraph
 * inside the quote, at top level a bare paragraph.
 *
 * Canonical home (extracted for L3f-3's `text-range-move` between-paragraphs
 * drop). `textobject.ts` (the element block-move spec) carries a private twin
 * with the identical body, left untouched this session per the L3f-3
 * constraint not to modify the element-move spec; unify by pointing it here
 * the next time that file is edited.
 */

import type { Editor } from "@tiptap/react";
import type { NodeType } from "@tiptap/pm/model";
import { TEXT_OBJECT_REGISTRY } from "@/text-objects/text-object-registry";
import type { TextObjectKind } from "@/text-objects/types";

export function classifyParentAt(
  editor: Editor,
  insertPos: number,
): TextObjectKind | null {
  const $pos = editor.state.doc.resolve(insertPos);
  // Walk depths from innermost outward; first TextObjectKind wins.
  for (let d = $pos.depth; d > 0; d--) {
    const name = $pos.node(d).type.name;
    if (name in TEXT_OBJECT_REGISTRY) {
      return name as TextObjectKind;
    }
  }
  return null;
}

/**
 * Schema-driven test: would inserting a bare node of `nodeType` at `insertPos`
 * leave the IMMEDIATE insert parent's content valid? (`$pos.parent.canReplaceWith`
 * at the resolved index.) This is the SSOT for the drop spec's wrap-vs-direct
 * decision — distinct from `classifyParentAt`, which collapses two structurally
 * different positions onto the same enclosing TextObjectKind.
 *
 * Concretely (Feature A2): a single example's widened body (parent
 * `exampleBlock`) and the multi between-items gap (parent `exampleItemList`)
 * BOTH classify as `exampleBlock` via `classifyParentAt` (which skips the
 * unregistered `exampleItemList`), yet the first must drop-direct and the second
 * must wrap. The immediate parent's schema separates them: `exampleBlock`
 * (post-widen) / `exampleItem` accept the bare block → true; `exampleItemList`
 * (content `exampleItem+`) rejects it → false. No magic parent-kind string.
 */
export function canDropDirectAt(
  editor: Editor,
  insertPos: number,
  nodeType: NodeType,
): boolean {
  const doc = editor.state.doc;
  if (insertPos < 0 || insertPos > doc.content.size) return false;
  const $pos = doc.resolve(insertPos);
  const index = $pos.index();
  return $pos.parent.canReplaceWith(index, index, nodeType);
}
