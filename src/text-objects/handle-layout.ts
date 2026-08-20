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
 * Task 382 makes that a LANE rather than a point: a row's handles live in
 * `[floor … cap]`, where the cap is derived from the row's `inkLeft` — the
 * leftmost DOCUMENT INK on that row. The natural position is the anchor rule
 * above; the lane is what the same-row separation (`applySameRowSeparation` in
 * TextObjectGrabHandle) may push a handle within. Before 382 the separation had
 * no upper bound at all and walked the inner handle of a top-level list onto
 * the bullet — chrome over the user's document — and a wide `10.` marker
 * collided with the natural position even before any push.
 *
 * The VERTICAL axis lives in block-frame.ts (`opticalCenterY`, chip 1).
 */

/** Grab-handle box width in px. Mirrors `.text-object-grab-handle { width:
 *  12px }` in globals.css: the handle's right edge sits `gapPx` left of the
 *  marker, so its left edge is `markerLeft − gapPx − HANDLE_WIDTH`. */
export const HANDLE_WIDTH = 12;

/**
 * The block X a grab handle hugs, for BOTH the text-object handle and the
 * selected-text handle. Convention (task 092): the selection handle is a
 * positional REPLACEMENT of its containing block's text-object handle — it
 * takes the SAME gutter slot — so both hug the block's measured `markerLeft`.
 *
 * For a markerless block (paragraph / heading / blockquote / …) `markerLeft ===
 * contentLeft`, so this is a no-op for plain paragraphs. For a marker-bearing
 * block (a `listItem` bullet band, an `exampleItem` `(n)`/`a.`) `markerLeft <
 * contentLeft`, so anchoring the selection handle here places its grip in the
 * gutter LEFT of the marker — the same slot as the text-object handle — instead
 * of OVER the bullet (the reported symptom of the old `contentLeft` fork).
 *
 * `refKind` is accepted so the single X-anchor decision lives in ONE guarded
 * place rather than being re-forked at the call site; it is intentionally unused
 * — no kind branches the anchor. Any future per-kind fork (e.g. `contentLeft`
 * for selections) must happen HERE, where the placement test guards it.
 */
export function resolveHandleMarkerLeft(
  frame: { markerLeft: number },
  _refKind: "selection" | "text-object",
): number {
  return frame.markerLeft;
}

/**
 * Fraction of the row's `gapPx` kept between a handle's right edge and the
 * row's ink when the handle is pushed to the cap. Deliberately SMALLER than the
 * full gap the natural anchor leaves: at the full gap the cap would equal the
 * natural position, the same-row separation could never move anything, and two
 * nested handles would render as the single 24px-wide blob task 353 exists to
 * prevent. Half a gap keeps a real void while letting the separation recover
 * most of the same-row separation's minimum — and, because it is a fraction of an
 * em-resolved token, it scales with the prose like every other margin length.
 */
export const INK_CLEARANCE_FACTOR = 0.5;

/** Inputs to {@link computeHandleLeftEdge} — the block's measured marker and
 *  resolved gap (from `block-frame.ts`) plus the narrow-viewport floor. */
export interface HandleLayoutInput {
  /** The block's MEASURED marker-left from `block-frame.ts`. BOTH a text-object
   *  handle and a selection handle pass this (see {@link resolveHandleMarkerLeft}
   *  — the selection handle takes the same gutter slot as the block's
   *  text-object handle). */
  markerLeft: number;
  /** The block's `--margin-handle-gap` resolved (em → px) against its font,
   *  from `block-frame.ts`. */
  gapPx: number;
  /** Left edge of the editor column (the `.ProseMirror` DOM rect.left) — the
   *  floor reference so narrow viewports don't push the handle off-screen. */
  editorColumnLeft: number;
  /** Narrow-viewport floor inset, read from `--margin-col-handle-inset` via
   *  the EditorViewportFrame (`frame.marginInset`). */
  baselineInset: number;
  /** The row's `BlockFrame.inkLeft` — the left edge of the leftmost DOCUMENT
   *  INK on this handle's row (bullet band, `(n)` marker, or the prose itself).
   *  Required, not defaulted: "how far right may this handle go" is a decision
   *  about the user's document, and a caller that hasn't resolved it must say
   *  so by passing its `markerLeft` rather than have a fallback chosen for it. */
  inkLeft: number;
}

/** A handle's resolved horizontal lane: where it sits, and the furthest right
 *  anything may move it (see {@link resolveHandleLane}). */
export interface HandleLane {
  /** The handle's left edge (CSS px) at rest. */
  left: number;
  /** The furthest-right left-edge this handle may take without its box
   *  crossing the row's ink. Consumed by the same-row separation, which may
   *  push a handle inboard only within its own lane. */
  maxLeft: number;
}

/**
 * Resolve a handle's horizontal LANE: its resting left edge and the inboard
 * bound nothing may push it past.
 *
 * Three bounds, and their precedence is the whole rule:
 *   1. the ANCHOR (`markerLeft − gapPx − HANDLE_WIDTH`) — where it wants to be;
 *   2. the INK CAP (`inkLeft − gapPx·{@link INK_CLEARANCE_FACTOR} −
 *      HANDLE_WIDTH`) — the furthest right it may ever be, so chrome never
 *      paints on the document. It binds the resting position too, not just a
 *      push: a wide `10.` marker reaches further left than the band-middle
 *      anchor assumes, so that row's natural slot is already on the ink.
 *   3. the FLOOR (`editorColumnLeft − baselineInset`) — the furthest LEFT, so a
 *      deeply-indented block on a narrow viewport never pushes the handle
 *      off-screen. The floor OUTRANKS the cap when the two conflict: an
 *      unreachable handle is worse than an overlapping one, and a cap left of
 *      the floor means the row has no clear margin at all.
 */
export function resolveHandleLane(input: HandleLayoutInput): HandleLane {
  const anchor = input.markerLeft - input.gapPx - HANDLE_WIDTH;
  const floor = input.editorColumnLeft - input.baselineInset;
  const cap =
    input.inkLeft - input.gapPx * INK_CLEARANCE_FACTOR - HANDLE_WIDTH;
  const maxLeft = Math.max(cap, floor);
  return { left: Math.max(Math.min(anchor, maxLeft), floor), maxLeft };
}

/**
 * Compute a grab handle's resting left edge (CSS px) — {@link resolveHandleLane}
 * for a caller that needs only the position, not the lane's inboard bound.
 */
export function computeHandleLeftEdge(input: HandleLayoutInput): number {
  return resolveHandleLane(input).left;
}
