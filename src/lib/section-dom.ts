import type { Editor } from "@tiptap/core";
import { getSectionRangeByUuid } from "./section-range";

/**
 * The live DOM elements of a section's top-level blocks, in order
 * (heading first). View-dependent counterpart of the pure
 * `getSectionRangeByUuid`: it resolves each block in the section's node
 * range to its rendered DOM via `editor.view.nodeDOM`.
 *
 * Used by the lifted-overlay's heading hooks (`renderGhost` clones every
 * block; `liftSourceRect` measures the last block's extent for the
 * visible-page clamp) — factored here so the two don't drift on the
 * section→DOM walk. NOT in the pure `section-range.ts`: that module is
 * doc-only (no view), and keeping it that way lets the parser/serializer
 * import it; this helper needs `editor.view`, so it lives view-side.
 *
 * `range.start` is the heading's top-level position (the position before
 * the node — exactly what `nodeDOM` resolves), and the section's blocks
 * are consecutive top-level siblings, so advancing `pos` by each node's
 * `nodeSize` lands on the next sibling's start. Returns an empty array
 * if the heading/section is gone (concurrent delete). The returned
 * elements are LIVE — clone before mounting anywhere (never detach the
 * editor's own DOM).
 */
export function sectionBlockDoms(
  editor: Editor,
  headingUuid: string,
): HTMLElement[] {
  const range = getSectionRangeByUuid(editor.state.doc, headingUuid);
  if (!range) return [];
  const out: HTMLElement[] = [];
  let pos = range.start;
  for (const node of range.nodes) {
    const dom = editor.view.nodeDOM(pos);
    if (dom instanceof HTMLElement) out.push(dom);
    pos += node.nodeSize; // top-level children: next sibling starts here
  }
  return out;
}
