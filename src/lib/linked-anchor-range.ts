/**
 * Shared `linkedAnchor` range helpers.
 *
 * `findLinkedAnchorRange` — the single resolver for "the bounding doc range
 * a `linkedAnchor` mark covers." Extracted from `linked-range-body.tsx`
 * (L3f-2) so the bidirectional float, the `linkedRange` lift-overlay hooks
 * (`renderGhost` / `liftSourceRect` in `text-object-registry.ts`), and the
 * `text-range-move` drop spec all resolve a marked range one way — no copies.
 *
 * `stripLinkedAnchorMarks` — remove every `linkedAnchor` mark from a slice's
 * text, mirroring `LinkedAnchorGuard.transformPasted`
 * (src/lib/tiptap/linked-anchor.ts): a moved (or pasted) run must not carry
 * the transient — or any — anchor identity. AnchorIds mint exactly once at
 * hydration; copies do not propagate identity.
 *
 * `rangeSliceToBlocks` — the range→block-nodes form shared by the float
 * (`sliceAsDoc`) and the `text-range-move` between-paragraphs drop (L3f-3):
 * an inline run becomes one paragraph, a multi-block range keeps its blocks.
 * One transform, no parallel logic.
 */

import { Fragment, Slice } from "@tiptap/pm/model";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";

/**
 * Walk the doc for text nodes whose marks include a `linkedAnchor` with the
 * matching `anchorId`. Returns the bounding range `[firstMarkedStart,
 * lastMarkedEnd)`, which may include unmarked gaps inside (e.g. a paragraph
 * break between two marked spans).
 *
 * Returns null when no text carries the mark — typically because the range
 * was deleted or the doc was reloaded before sidecar reanchoring restored it.
 */
export function findLinkedAnchorRange(
  doc: PMNode,
  anchorId: string,
): { from: number; to: number } | null {
  let from = -1;
  let to = -1;
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const hasMark = node.marks.some(
      (m) => m.type.name === "linkedAnchor" && m.attrs.anchorId === anchorId,
    );
    if (hasMark) {
      if (from === -1) from = pos;
      to = pos + node.nodeSize;
    }
    return true;
  });
  if (from === -1) return null;
  return { from, to };
}

/**
 * Return a copy of `slice` with every `linkedAnchor` mark removed from its
 * text nodes (recursively, preserving open depths + all other marks). The
 * rebuild mirrors `LinkedAnchorGuard.transformPasted` exactly so a moved run
 * and a pasted run shed the anchor identity identically.
 */
export function stripLinkedAnchorMarks(slice: Slice): Slice {
  const rebuild = (frag: Fragment): Fragment => {
    const out: PMNode[] = [];
    frag.forEach((n) => {
      if (n.isText) {
        const filtered = n.marks.filter((m) => m.type.name !== "linkedAnchor");
        out.push(filtered.length === n.marks.length ? n : n.mark(filtered));
      } else {
        out.push(n.copy(rebuild(n.content)));
      }
    });
    return Fragment.fromArray(out);
  };
  return new Slice(rebuild(slice.content), slice.openStart, slice.openEnd);
}

/**
 * Convert a marked range's slice into block-level PM nodes — the shared
 * range→blocks form behind BOTH the `linked-range-body` float (`sliceAsDoc`)
 * and the `text-range-move` between-paragraphs drop (L3f-3). One transform,
 * no parallel logic (the same DRY move as `findLinkedAnchorRange` /
 * `stripLinkedAnchorMarks`).
 *
 * Policy: a slice cut INSIDE one text block comes through as bare inline
 * content → wrap it in a single `paragraph` so the run becomes its own
 * block; a slice that already spans whole blocks comes through as block
 * children → keep them as siblings; an empty slice → one empty paragraph.
 * New paragraphs carry default attrs (uuid null, minted lazily like any
 * freshly-created block). Shedding the `linkedAnchor` handle is the caller's
 * concern — `stripLinkedAnchorMarks` the slice first when the moved run must
 * not carry it (the float keeps it; the move strips it).
 */
export function rangeSliceToBlocks(slice: Slice, schema: Schema): PMNode[] {
  const children: PMNode[] = [];
  slice.content.forEach((n) => children.push(n));
  if (children.some((c) => c.isInline)) {
    return [schema.nodes.paragraph.create(null, slice.content)];
  }
  return children.length > 0 ? children : [schema.nodes.paragraph.create()];
}
