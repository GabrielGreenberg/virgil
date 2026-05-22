/**
 * Grab-handle placement — single shared utility consumed by every grab
 * handle. Replaces the scattered per-component placement math that
 * accumulated in ParagraphFloat, HeadingFloat, ListFloat, SelectionFloat,
 * the per-node-view grips on tex/figure/graphics/example blocks, and the
 * main-editor SelectionDragHandle.
 *
 * Algorithm (memo §7):
 *
 *   handleRightEdge =
 *     elDOM.getBoundingClientRect().left
 *     - decorationSafety[kind]   // pixel-zone reserved for bullets, ex-markers
 *     - HANDLE_GAP
 *
 *   handleRightEdge = max(handleRightEdge, editorColumnLeft - HANDLE_GAP)
 *
 * The clamp keeps top-level handles out in the gutter (current behavior);
 * sub-object handles indent by their decoration zone.
 *
 * `decorationSafety` is a constant in the simple case and a `(node) => number`
 * for kinds that want live-measure (strategy (b) in memo §7). Start with
 * the constant — promote per-kind to a function if visual breakage emerges.
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import type { TextObjectKind, TextObjectMeta } from "./types";

/** Pixels of breathing space between handle's right edge and the
 *  content's left edge. */
export const HANDLE_GAP = 8;

/** Compute the left edge (in CSS pixels) where the grab handle's
 *  right edge should sit for a given TextObject. */
export interface HandleLayoutInput {
  /** The TextObject's rendered DOM element. */
  elDOM: Element;
  /** The kind. Used to look up `decorationSafety` from the registry. */
  kind: TextObjectKind;
  /** The PM node (used only by kinds with function-form
   *  `decorationSafety`). Omit for `linkedRange` / non-node kinds. */
  node?: PMNode;
  /** Left edge of the editor column in viewport coords. The handle is
   *  clamped to sit no further right than this minus HANDLE_GAP, so
   *  top-level handles always render in the gutter. */
  editorColumnLeft: number;
  /** Registry meta for the kind — caller hands this in so we don't
   *  import the registry from a layout utility (avoid the circular). */
  meta: TextObjectMeta;
}

export function computeHandleLeftEdge(input: HandleLayoutInput): number {
  const contentLeft = input.elDOM.getBoundingClientRect().left;
  const safety = resolveDecorationSafety(input.meta, input.node);
  const proposed = contentLeft - safety - HANDLE_GAP;
  const ceiling = input.editorColumnLeft - HANDLE_GAP;
  return Math.max(proposed, ceiling);
}

function resolveDecorationSafety(
  meta: TextObjectMeta,
  node: PMNode | undefined,
): number {
  if (typeof meta.decorationSafety === "function") {
    if (!node) return 0;
    return meta.decorationSafety(node);
  }
  return meta.decorationSafety;
}

// ---------------------------------------------------------------------------
// Default decoration-safety constants (memo §7)
// ---------------------------------------------------------------------------

/** A bullet glyph (`•`) plus a hair of breathing space. Calibrated to
 *  the editor's default font/size; tweak if list typography changes. */
export const BULLET_DECORATION_WIDTH = 18;

/**
 * Widest of the expex marker cycle (`I.`, `II.`, `III.`, etc., plus
 * the lowercase/numeric variants). Used by `exampleItem` as a
 * hardcoded constant (strategy (a)). If shallow-depth gutter gaps
 * become visually annoying, promote `exampleItem`'s `decorationSafety`
 * to a `(node) => number` that live-measures the marker text.
 */
export const EXAMPLE_ITEM_MAX_MARKER_WIDTH = 28;
