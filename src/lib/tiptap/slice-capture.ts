/**
 * **slice-capture — a ProseMirror `Slice` as card-body JSON.**
 *
 * A `Slice` from `doc.slice(from, to)` carries `openStart` / `openEnd`: the
 * boundaries cut THROUGH ancestor nodes, so for a selection inside a paragraph
 * the content Fragment holds INLINE children (text + inline marks) rather than
 * a paragraph, and for a multi-paragraph selection with partial ends it is
 * MIXED. A card body's `doc.content` is `block+`, so bare inline children at
 * doc level throw `contentMatchAt on a node with invalid content` the moment
 * the body mounts.
 *
 * This is the ONE conversion, in a LEAF, because it now has two callers with
 * very different weights:
 *
 *  - {@link prepareCardBodyCapture} — the DESTRUCTIVE capture door (task 393),
 *    which normalizes and then proves the destination schema can hold the
 *    result. It reaches the resolved card-body schema, and so the whole
 *    extension stack, which is exactly why it cannot live in the import graph
 *    of a module every card surface pulls in.
 *  - `createLinkedAnchor` (task 488) — a DISPLAY capture beside a Mode-B
 *    anchor. Nothing is being deleted, so there is nothing for a mount check to
 *    protect: a passage the render surface cannot represent already falls back
 *    to plain text by `StaticBorrowedText`'s own refusal contract. It wants the
 *    shape conversion and the normalize, and must NOT drag the schema into
 *    `links.ts`.
 *
 * So the leaf publishes the whole small operation (shape + normalize), never
 * its halves — `prepareCardBodyCapture` reads it too, so the payload the
 * destructive door VALIDATES is byte-identical to the one this produces.
 */
import { Slice } from "@tiptap/pm/model";
import type { JSONContent } from "@tiptap/react";
import { normalizeRichContent } from "@/lib/footnote-content";

/**
 * The card-body `doc` JSON for a live document slice.
 *
 * Algorithm: walk the top-level children; inline runs accumulate into a buffer,
 * each block child flushes that buffer into a paragraph and emits itself, with
 * a final flush at the end. Handles every shape —
 *   - all-inline (single-paragraph sub-range): one paragraph wrapping all;
 *   - all-block (full-paragraph selection): blocks pass through unwrapped;
 *   - mixed: inline runs at the boundaries become paragraphs flanking the
 *     middle blocks.
 *
 * The `normalizeRichContent` pass is part of the operation, not a separate
 * step: it strips `DOC_ONLY_MARKS` (`linkedAnchor`), which the card schemas
 * deliberately do not register, so a span already carrying another card's
 * anchor converts cleanly.
 */
export function captureSliceContent(slice: Slice): JSONContent {
  const docContent: JSONContent[] = [];
  let openInline: JSONContent[] = [];
  const flushInline = () => {
    if (openInline.length === 0) return;
    docContent.push({ type: "paragraph", content: openInline });
    openInline = [];
  };
  slice.content.forEach((child) => {
    if (child.isBlock) {
      flushInline();
      docContent.push(child.toJSON() as JSONContent);
    } else {
      openInline.push(child.toJSON() as JSONContent);
    }
  });
  flushInline();
  return normalizeRichContent({ type: "doc", content: docContent });
}

/** Re-exported so a caller can narrow without importing pm/model itself. */
export function isSlice(v: unknown): v is Slice {
  return v instanceof Slice;
}
