/**
 * Grab-handle placement — single shared utility consumed by every grab
 * handle. Replaces the scattered per-component placement math that
 * accumulated in ParagraphFloat, HeadingFloat, ListFloat (and the
 * SelectionFloat that Phase E retired), the per-node-view grips on
 * tex/figure/graphics/example blocks, and the main-editor
 * SelectionDragHandle.
 *
 * Two policies, branched on the registry's `meta.isSubObject` flag —
 * the gutter the handle parks in is a different thing in each case:
 *
 *   TOP-LEVEL (isSubObject = false):
 *     The gutter is the editor's left padding. Every top-level handle
 *     parks in a SHARED baseline column at `contentLeft − baselineInset`.
 *     `baselineInset` is read from --gutter-col-handle-inset by the
 *     caller (TextObjectGrabHandle) so JS placement and CSS chrome
 *     (chevron column, etc.) share one source of truth.
 *
 *   SUB-OBJECT (isSubObject = true):
 *     The gutter is the parent's marker zone (bullet glyph, ex-marker).
 *     Handle parks at `contentLeft − decorationSafety − SUB_OBJECT_GAP`,
 *     indenting into the marker column with breathing room. Clamped
 *     to the editor's baseline column so narrow viewports don't push
 *     the handle off-screen.
 *
 * `decorationSafety` is a constant in the simple case and a
 * `(node) => number` for kinds that want live-measure (strategy (b)
 * in memo §7). Start with the constant — promote per-kind to a
 * function if visual breakage emerges.
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import type { TextObjectKind, TextObjectMeta } from "./types";

/** Pixels of breathing space between a sub-object handle's right edge
 *  and the parent marker's right edge. */
export const SUB_OBJECT_GAP = 8;

/** Legacy alias. Retained for any external consumer that imports the
 *  pre-baseline-refactor name; new code should reference
 *  `SUB_OBJECT_GAP` for sub-objects or `--gutter-col-handle-inset`
 *  for the top-level baseline column. */
export const HANDLE_GAP = SUB_OBJECT_GAP;

/** Compute the left edge (in CSS pixels) where the grab handle's
 *  left edge should sit for a given TextObject. */
export interface HandleLayoutInput {
  /** The TextObject's rendered DOM element. */
  elDOM: Element;
  /** The kind. Used to look up `decorationSafety` from the registry. */
  kind: TextObjectKind;
  /** The PM node (used only by kinds with function-form
   *  `decorationSafety`). Omit for `linkedRange` / non-node kinds. */
  node?: PMNode;
  /** Left edge of the editor column in viewport coords. Used as the
   *  floor for the sub-object branch so narrow viewports don't push
   *  the handle off-screen. */
  editorColumnLeft: number;
  /** Pixels from contentLeft to the top-level baseline column. Read
   *  from --gutter-col-handle-inset by the caller so CSS chrome and
   *  JS placement share one source. */
  baselineInset: number;
  /** Registry meta for the kind — caller hands this in so we don't
   *  import the registry from a layout utility (avoid the circular). */
  meta: TextObjectMeta;
}

export function computeHandleLeftEdge(input: HandleLayoutInput): number {
  const contentLeft = input.elDOM.getBoundingClientRect().left;
  if (input.meta.isSubObject) {
    const safety = resolveDecorationSafety(input.meta, input.node);
    const proposed = contentLeft - safety - SUB_OBJECT_GAP;
    // Floor at the editor's top-level baseline column so a deeply
    // indented sub-object on a narrow viewport doesn't run past the
    // gutter where its parent's handle lives.
    const floor = input.editorColumnLeft - input.baselineInset;
    return Math.max(proposed, floor);
  }
  return contentLeft - input.baselineInset;
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
