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
 */

import { Fragment, Slice } from "@tiptap/pm/model";
import type { Node as PMNode } from "@tiptap/pm/model";

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
