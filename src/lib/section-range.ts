import type { Node as PMNode } from "@tiptap/pm/model";

/**
 * Locate the document range that belongs to the section anchored by a
 * given heading uuid. The section is the heading itself plus every
 * top-level block that follows it until — but not including — the next
 * heading of the same or higher rank (numerically lower or equal level)
 * or the end of the document, whichever comes first.
 *
 * Returns positions in absolute doc coordinates, suitable for
 * `tr.delete(start, end)` and `tr.replaceWith(start, end, …)`. The
 * collected `nodes` are returned for callers that want to re-insert
 * them elsewhere (e.g. drag-to-reorder, popout float content).
 *
 * Returns `null` when no heading with the given uuid exists, or when
 * the heading is not a top-level child (sections only fold at the doc
 * root, matching the section-folding plugin's behavior).
 */
export function getSectionRangeByUuid(
  doc: PMNode,
  headingUuid: string,
): { start: number; end: number; level: number; nodes: PMNode[] } | null {
  let foundLevel: number | null = null;
  let startPos: number | null = null;
  let endPos: number | null = null;
  const nodes: PMNode[] = [];
  let collecting = false;
  doc.forEach((node, offset) => {
    if (collecting) {
      if (
        node.type.name === "heading" &&
        (node.attrs.level as number) <= foundLevel!
      ) {
        if (endPos === null) endPos = offset;
        collecting = false;
        return;
      }
      nodes.push(node);
    } else if (
      node.type.name === "heading" &&
      node.attrs?.uuid === headingUuid
    ) {
      foundLevel = node.attrs.level as number;
      startPos = offset;
      nodes.push(node);
      collecting = true;
    }
  });
  if (startPos === null || foundLevel === null) return null;
  if (endPos === null) endPos = doc.content.size;
  return { start: startPos, end: endPos, level: foundLevel, nodes };
}
