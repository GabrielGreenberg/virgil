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
