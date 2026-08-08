import type { Node as PMNode } from "@tiptap/pm/model";
import type { SourceRange } from "@/lib/float-source-range";

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
 *
 * `hint` is a previously-returned range for the SAME heading (the heading
 * float tracks one across transactions). When its `from` still resolves to
 * that heading at the doc root, the leading scan is skipped and the walk
 * starts at the section — so re-reading a section costs O(section), not
 * O(doc). A hint that no longer verifies costs nothing but the check.
 */
export function getSectionRangeByUuid(
  doc: PMNode,
  headingUuid: string,
  hint?: SourceRange | null,
): { start: number; end: number; level: number; nodes: PMNode[] } | null {
  let index = hintedHeadingIndex(doc, headingUuid, hint);
  let offset = index === null ? 0 : hint!.from;

  if (index === null) {
    let i = 0;
    for (; i < doc.childCount; i++) {
      const child = doc.child(i);
      if (child.type.name === "heading" && child.attrs?.uuid === headingUuid) {
        break;
      }
      offset += child.nodeSize;
    }
    if (i >= doc.childCount) return null;
    index = i;
  }

  const heading = doc.child(index);
  const level = heading.attrs.level as number;
  const start = offset;
  const nodes: PMNode[] = [heading];
  offset += heading.nodeSize;

  let end = doc.content.size;
  for (let j = index + 1; j < doc.childCount; j++) {
    const child = doc.child(j);
    if (
      child.type.name === "heading" &&
      (child.attrs.level as number) <= level
    ) {
      end = offset;
      break;
    }
    nodes.push(child);
    offset += child.nodeSize;
  }

  return { start, end, level, nodes };
}

/** Top-level child index the hint points at, if it still names our heading. */
function hintedHeadingIndex(
  doc: PMNode,
  headingUuid: string,
  hint: SourceRange | null | undefined,
): number | null {
  if (!hint) return null;
  if (hint.from < 0 || hint.from >= doc.content.size) return null;
  let $pos;
  try {
    $pos = doc.resolve(hint.from);
  } catch {
    return null;
  }
  // Sections only exist at the doc root; a hint pointing inside a block is
  // either stale or was never one of ours.
  if ($pos.depth !== 0) return null;
  const node = $pos.nodeAfter;
  if (
    !node ||
    node.type.name !== "heading" ||
    node.attrs?.uuid !== headingUuid
  ) {
    return null;
  }
  return $pos.index();
}

/**
 * Locate just the heading-line range for a given heading uuid — the
 * inner content range of the heading node itself, NOT the whole section.
 *
 * Used by annotation-style actions (highlight, footnote, citation, etc.)
 * via the registry's `collectAnnotationRange` slot. The lifecycle
 * counterpart is `getSectionRangeByUuid` (returns the whole section).
 *
 * Returns content positions: `{from: pos+1, to: pos + nodeSize - 1}` so
 * a `setMark` over the range wraps only the heading text and never
 * crosses the wrapping node's boundaries — critical for the
 * `\section{...}`/`\vlid{}` interaction that motivated the split. See
 * ACTION-MENU-DIAGNOSIS.md cluster C11.
 */
export function getHeadingLineRangeByUuid(
  doc: PMNode,
  headingUuid: string,
): { from: number; to: number; node: PMNode } | null {
  let result: { from: number; to: number; node: PMNode } | null = null;
  doc.descendants((node, pos) => {
    if (result) return false;
    if (
      node.type.name === "heading" &&
      (node.attrs?.uuid as string | null) === headingUuid
    ) {
      result = { from: pos + 1, to: pos + node.nodeSize - 1, node };
      return false;
    }
    return true;
  });
  return result;
}
