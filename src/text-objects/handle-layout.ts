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
 * Task 487 gives the rule its second reading — Gabriel's placement ruling. The
 * one above says a handle HUGS the marker it labels, which is right for every
 * block that HAS one and vacuous for a markerless CONTAINER: a `<ul>` renders
 * no glyph on its own row, so "one gap left of nothing" was a step of an
 * arbitrary `--margin-track-width` off its first item's anchor, and on a
 * top-level list that step landed the two handles ~8px apart — one ~20px blob
 * where a press on the left of the item's box grabbed the LIST (task 483). The
 * ruling: a container OCCUPIES the marker column of the level above it, the
 * column its list hangs from, right-justified — so it sits directly under the
 * parent row's bullet and the two handles are in two different columns. Which
 * reading applies is decided ONCE, in `block-frame.ts`
 * (`BlockFrame.columnRight`), never at a call site.
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
  /** The block's `BlockFrame.columnRight` (task 487) — the inner edge of the
   *  MARKER COLUMN this handle occupies, or `null` when it hugs its marker.
   *  Required for the same reason `inkLeft` is: "does this handle occupy a
   *  column or hug a glyph?" is a placement DECISION, and a caller that hasn't
   *  resolved it must say `null` rather than have an answer chosen for it. */
  columnRight: number | null;
  /** The block's `BlockFrame.chevronRight` (task 526) — the inner edge of the
   *  FOLD-CHEVRON column reserved on this row, or `null` when this row renders
   *  no chevron. Required for the same reason the two above are: whether the
   *  lane has an outboard occupant is a fact about the row, and a caller that
   *  hasn't resolved it must say `null`. */
  chevronRight: number | null;
}

/** A handle's resolved horizontal lane: where it sits, and the two bounds
 *  nothing may move it past (see {@link resolveHandleLane}). */
export interface HandleLane {
  /** The handle's left edge (CSS px) at rest. */
  left: number;
  /** The furthest-right left-edge this handle may take without its box
   *  crossing the row's ink. Consumed by the same-row separation, which may
   *  push a handle inboard only within its own lane. */
  maxLeft: number;
  /**
   * The lane's OUTBOARD bound: the furthest-LEFT x this handle's RENDERED
   * EXTENT may reach — its 12px box, the hit/hover halo centred on it
   * (`--margin-handle-hit-pad`), and anything the same-row separation pushes
   * outboard.
   *
   * It is {@link handleLaneFloor} — the narrow-viewport floor — RAISED by the
   * reserved fold-chevron column on rows that have one (task 526). Three
   * consumers, one number, and that is the whole of the lane's outboard half:
   *
   *   • the RESTING position is clamped here, so a `\part`-sized heading's
   *     em-scaled box cannot sit 3px into the 14px chevron;
   *   • the same-row separation's OUTBOARD pass (task 487) pushes within it.
   *     Its predecessor's stated reason — "nothing on this row lies left of
   *     the row's own marker, so the margin out here is free" — is exactly
   *     right and exactly what the chevron column corrects: on a chevron row
   *     something IS out there. Byte-identical for every row 487 was about
   *     (a list reserves no chevron, so this equals the floor there);
   *   • the HALO is capped here by `TextObjectGrabHandle#applyHitCaps`, which
   *     folds it into the same `--margin-handle-hit-cap` the sibling clamp
   *     writes. Since the HOVER ZONE's left edge is the un-raised
   *     {@link handleLaneFloor}, and this is never left of it, "the zone
   *     contains every rendered handle" is a PROPERTY rather than two numbers
   *     agreeing.
   */
  minLeft: number;
}

/**
 * Resolve a handle's horizontal LANE: its resting left edge and the two bounds
 * nothing may push it past.
 *
 * Three bounds, and their precedence is the whole rule:
 *   1. the ANCHOR — where it wants to be. TWO readings, and which one applies
 *      is decided once, in `block-frame.ts` (task 487): a block with a marker
 *      of its own HUGS it (`markerLeft − gapPx − HANDLE_WIDTH`), while a
 *      markerless CONTAINER OCCUPIES the marker column of the level above,
 *      right-justified to its inner edge (`columnRight − HANDLE_WIDTH`) — so
 *      it lands directly under that level's bullet, a row up. Two levels then
 *      sit in two different columns, which is what makes their non-overlap
 *      structural instead of a separation constant;
 *   2. the INK CAP (`inkLeft − gapPx·{@link INK_CLEARANCE_FACTOR} −
 *      HANDLE_WIDTH`) — the furthest right it may ever be, so chrome never
 *      paints on the document. It binds the resting position too, not just a
 *      push: a wide `10.` marker reaches further left than the band-middle
 *      anchor assumes, so that row's natural slot is already on the ink.
 *   3. the FLOOR ({@link handleLaneFloor}) — the furthest LEFT, so a
 *      deeply-indented block on a narrow viewport never pushes the handle
 *      off-screen. The floor OUTRANKS the cap when the two conflict: an
 *      unreachable handle is worse than an overlapping one, and a cap left of
 *      the floor means the row has no clear margin at all.
 *   4. the CHEVRON COLUMN (task 526) — the margin's OTHER occupant, and the
 *      reason rung 3 is a LANE bound rather than a viewport clamp. Where the
 *      row reserves one (`BlockFrame.chevronRight`) it RAISES the floor, so a
 *      `\part`-sized heading — whose em-scaled gap otherwise puts its 12px box
 *      3px into the 14px chevron — cannot steal the chevron's clicks, and
 *      neither can its halo (`applyHitCaps` caps at the same
 *      {@link HandleLane.minLeft}). This is the LEFT margin's reading of the
 *      lane law the right margin already states (`resolveRightLane`,
 *      AGENTS.md → "The ordering half"): the outboard occupant places first,
 *      and the inboard one takes what remains.
 */
export function resolveHandleLane(input: HandleLayoutInput): HandleLane {
  const anchorRight = input.columnRight ?? input.markerLeft - input.gapPx;
  const anchor = anchorRight - HANDLE_WIDTH;
  // The lane's OUTBOARD bound: the narrow-viewport floor, raised by the
  // reserved chevron column where the row has one. `Math.max` keeps rung 3's
  // precedence — a chevron column left of the floor could never bind anyway,
  // and one right of it is the tighter bound.
  const floor = Math.max(
    handleLaneFloor(input.editorColumnLeft, input.baselineInset),
    input.chevronRight ?? -Infinity,
  );
  const cap =
    input.inkLeft - input.gapPx * INK_CLEARANCE_FACTOR - HANDLE_WIDTH;
  const maxLeft = Math.max(cap, floor);
  return {
    left: Math.max(Math.min(anchor, maxLeft), floor),
    maxLeft,
    minLeft: floor,
  };
}

/**
 * The lane's OUTBOARD bound — the furthest-left x any grab handle's BOX may
 * take (rung 3 above), and, since task 526, the left edge of the grab-handle
 * HOVER ZONE (`editor-geometry/viewport-frame.ts`).
 *
 * Those two were separate tables and that was the bug: the zone was a fixed
 * `contentLeft − 22 − 8` px constant sized for a pre-halo, pre-em handle, while
 * the handle's own reach is em-scaled per block — so at the shipped defaults
 * every `\section` heading's hit target already reached ~7px outside the strip
 * that keeps the handle alive, and one notch up the font-size slider did it for
 * every paragraph. Leaving the strip nulls `mousePosRef` and the resolver
 * returns nothing, so the handle vanished as the user reached for it.
 *
 * Stated as ONE expression read by both: the zone that REVEALS a handle is
 * exactly the lane a handle may OCCUPY. The halo is capped to the same bound
 * ({@link HandleLane.minLeft}), so containment is a property rather than
 * a coincidence between two numbers.
 */
export function handleLaneFloor(
  editorColumnLeft: number,
  baselineInset: number,
): number {
  return editorColumnLeft - baselineInset;
}

/**
 * Compute a grab handle's resting left edge (CSS px) — {@link resolveHandleLane}
 * for a caller that needs only the position, not the lane's inboard bound.
 */
export function computeHandleLeftEdge(input: HandleLayoutInput): number {
  return resolveHandleLane(input).left;
}
