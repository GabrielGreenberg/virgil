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
 *
 * `blocksToRangeSlice` — the named INVERSE of `rangeSliceToBlocks` (L3f-7):
 * given the live doc, a tracked text-bounded range, and the (edited) block
 * nodes from a float, it builds the `Slice` for `tr.replace(from, to, slice)`
 * so write-back is the faithful inverse of the seed extraction (reusing the
 * cut's open depths) instead of forcing a closed-block `replaceWith` that
 * splits the boundary paragraphs / wraps an extra list. `text-range-move.ts`
 * already follows this open-slice discipline (its inline-cursor move inserts
 * the open `doc.slice(from,to)` via `tr.replace`); `blocksToRangeSlice`
 * codifies it for the same-range write-back, which was the lone outlier.
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

/**
 * Inverse of `rangeSliceToBlocks` (L3f-7): given the live main `doc`, the
 * tracked text-bounded `range`, and the (possibly edited) block nodes read
 * back from a float, build the `Slice` to hand to `tr.replace(from, to, slice)`
 * so a float write-back is the FAITHFUL INVERSE of the seed extraction.
 *
 * Why this is needed. `findLinkedAnchorRange` returns TEXT-bounded positions,
 * so `[from,to)` is usually mid-paragraph and `doc.slice(from,to)` is an OPEN
 * cut (openStart/openEnd > 0). The forward seed kept a multi-block range's
 * blocks and WRAPPED a within-one-textblock run in a single paragraph. To
 * invert, the replacement must re-open with the SAME depths (block range) or
 * unwrap that single paragraph (inline range). Replacing with FULLY-CLOSED
 * blocks instead (`tr.replaceWith`, which builds a Slice with
 * openStart=openEnd=0) forces ProseMirror's fitter to split the boundary
 * paragraphs and, when the range touches a list, wrap an extra list — the
 * L3f-7 artifact. Reusing the cut's open depths makes an UNEDITED round-trip
 * byte-identical (`tr.doc.eq(doc)`) and an EDITED one land exactly the edit
 * with the boundary paragraphs preserved.
 *
 * `text-range-move.ts` already follows this discipline (its inline-cursor move
 * inserts the open `doc.slice(from,to)` via `tr.replace`); write-back was the
 * lone outlier. O(range-size): `doc.slice(from,to)` is O(range), never a doc
 * walk.
 */
export function blocksToRangeSlice(
  doc: PMNode,
  range: { from: number; to: number },
  blocks: PMNode[],
): Slice {
  const cut = doc.slice(range.from, range.to);
  // Mirror `rangeSliceToBlocks`' inline branch: a cut WITHIN one text block
  // arrives as bare inline content, which the forward wrapped in ONE paragraph.
  // Unwrap that single paragraph so the replacement re-opens as bare inline
  // (openStart = openEnd = 0) exactly as the cut produced — no boundary split.
  const cutInline =
    cut.content.childCount > 0 && cut.content.child(0).isInline;
  if (cutInline && blocks.length === 1 && blocks[0].type.name === "paragraph") {
    return new Slice(blocks[0].content, 0, 0);
  }
  // Block range (multi-block, including lists, or a boundary-aligned whole-block
  // cut): re-apply the cut's open depths so the boundary paragraphs MERGE back
  // into the surrounding text instead of splitting, and a touched list isn't
  // re-wrapped. CLAMP each depth to what the edited blocks can actually support
  // (`Slice.maxOpen`): a float edit may restructure the leading/trailing block
  // (e.g. add a paragraph after a list whose tail the cut opened 3 deep) so it
  // no longer opens as deep as the original cut — an unclamped `Slice` would be
  // malformed and `tr.replace` would throw, silently dropping the write-back
  // (losing the edit). For an unedited or structure-preserving edit the blocks
  // open at least as deep as the cut, so the clamp is a no-op and the
  // round-trip stays byte-identical.
  const content = Fragment.from(blocks);
  const maxOpen = Slice.maxOpen(content);
  return new Slice(
    content,
    Math.min(cut.openStart, maxOpen.openStart),
    Math.min(cut.openEnd, maxOpen.openEnd),
  );
}
