/**
 * Grab-handle HORIZONTAL placement — the single shared utility every grab
 * handle uses to find its left edge. Reads the canonical per-block geometry
 * from `block-frame.ts` (the MEASURED `markerLeft` + the resolved em `gapPx`),
 * so the handle, the future drop indicator, and figure chrome all hug the
 * SAME measured marker by construction.
 *
 * ONE uniform rule for every kind (replacing the pre-chip-2 per-kind
 * `decorationSafety` / `SUB_OBJECT_GAP` / `baselineInset` constants):
 *
 *     handle.left = markerLeft − gapPx − HANDLE_WIDTH
 *
 * i.e. the handle's RIGHT edge sits one `gapPx` (an em token resolved per
 * block in block-frame.ts) left of the block's measured marker. The result is
 * floored at `editorColumnLeft − baselineInset` so a deeply-indented block on
 * a narrow viewport never pushes the handle off-screen-left.
 *
 * The VERTICAL axis lives in block-frame.ts (`opticalCenterY`, chip 1).
 */

/** Grab-handle box width in px. Mirrors `.text-object-grab-handle { width:
 *  12px }` in globals.css: the handle's right edge sits `gapPx` left of the
 *  marker, so its left edge is `markerLeft − gapPx − HANDLE_WIDTH`. */
export const HANDLE_WIDTH = 12;

/** Inputs to {@link computeHandleLeftEdge} — the block's measured marker and
 *  resolved gap (from `block-frame.ts`) plus the narrow-viewport floor. */
export interface HandleLayoutInput {
  /** The block's MEASURED marker-left from `block-frame.ts` (a selection,
   *  which labels text not a marker, passes its `contentLeft` instead). */
  markerLeft: number;
  /** The block's `--margin-handle-gap` resolved (em → px) against its font,
   *  from `block-frame.ts`. */
  gapPx: number;
  /** Left edge of the editor column (the `.ProseMirror` DOM rect.left) — the
   *  floor reference so narrow viewports don't push the handle off-screen. */
  editorColumnLeft: number;
  /** Narrow-viewport floor inset, read from `--margin-col-handle-inset` via
   *  the EditorViewportCache (`cache.marginInset`). */
  baselineInset: number;
}

/**
 * Compute a grab handle's left edge (CSS px). Uniform across every kind: the
 * handle's right edge hugs one `gapPx` left of the block's marker, floored at
 * the editor's baseline column.
 */
export function computeHandleLeftEdge(input: HandleLayoutInput): number {
  const proposed = input.markerLeft - input.gapPx - HANDLE_WIDTH;
  const floor = input.editorColumnLeft - input.baselineInset;
  return Math.max(proposed, floor);
}
