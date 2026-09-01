/**
 * The shared grab-handle test FRAME builder (task 526).
 *
 * Every grab-handle fixture in the repo used to hand-write its own
 * `EditorViewportFrame` as an untyped `Record<string, unknown>` and hand-write
 * its own `containsHoverZone` predicate — and each one chose a zone WIDER than
 * production can produce (`x >= 200` against a real `contentLeft` of 260, i.e.
 * a 60px leftward zone where production's was 30). So a handle escaping its
 * hover zone was unrepresentable in all of them, which is exactly how the zone
 * came to be a fixed `contentLeft − 22 − 8` px constant while the handle's own
 * reach is em-scaled per block.
 *
 * Two properties close that, and both are the point:
 *
 *   • the return type is the REAL {@link EditorViewportFrame}, so a field added
 *     to the frame is a COMPILE ERROR in every fixture rather than a silent
 *     `undefined` that surfaces as a `NaN` placement;
 *   • `hoverZoneLeft` / `containsHoverZone` are DERIVED here from
 *     {@link handleLaneFloor} — the same expression `computeViewportFrame`
 *     reads — so a fixture cannot stub a zone production could not produce.
 *
 * It is deliberately NOT `computeViewportFrame` itself: these fixtures pin a
 * synthetic scroll band and a synthetic portal origin, neither of which jsdom
 * can lay out. The suite that must drive the real measurement
 * (`hover-zone-contains-handle-lane.test.ts`) calls the real function.
 */

import type { EditorViewportFrame } from "@/lib/editor-geometry/viewport-frame";
import { handleLaneFloor } from "@/text-objects/handle-layout";

export interface HandleTestFrameInput {
  /** The `.ProseMirror` element. Its `getBoundingClientRect().left` is the
   *  editor COLUMN's outside-left edge — the reference the lane floor and the
   *  hover zone are both measured from. */
  editorEl: HTMLElement;
  /** The editor's TEXT content-left (`rect.left + padding-left`). */
  contentLeft: number;
  editorRight: number;
  scrollTop: number;
  scrollBottom: number;
  /** `--margin-col-handle-inset`. Defaults to the shipped 22px. */
  marginInset?: number;
  /** The `[data-editor-col]` column that hosts the grab-handle portal. */
  paperEl: HTMLElement | null;
  paperRect: { top: number; left: number };
  /** Override the Y band a hover is answered in. Defaults to the scroll band,
   *  as production does. */
  containsHoverZoneOverride?: (x: number, y: number) => boolean;
}

export function buildHandleTestFrame(
  input: HandleTestFrameInput,
): EditorViewportFrame {
  const marginInset = input.marginInset ?? 22;
  const editorColumnLeft = input.editorEl.getBoundingClientRect().left;
  const hoverZoneLeft = handleLaneFloor(editorColumnLeft, marginInset);
  const hoverZoneRight = input.editorRight;
  const paperRect = input.paperRect;
  return {
    editorEl: input.editorEl,
    contentLeft: input.contentLeft,
    editorRight: input.editorRight,
    scrollParent: null,
    scrollTop: input.scrollTop,
    scrollBottom: input.scrollBottom,
    marginInset,
    editorColumnLeft,
    hoverZoneLeft,
    hoverZoneRight,
    podLeft: editorColumnLeft,
    podRight: input.editorRight,
    podTop: input.scrollTop,
    podBottom: input.scrollBottom,
    containsContentZone: (x, y) =>
      x >= editorColumnLeft &&
      x <= input.editorRight &&
      y >= input.scrollTop &&
      y <= input.scrollBottom,
    paperEl: input.paperEl,
    paperRect,
    containsHoverZone:
      input.containsHoverZoneOverride ??
      ((x, y) =>
        x >= hoverZoneLeft &&
        x <= hoverZoneRight &&
        y >= input.scrollTop &&
        y <= input.scrollBottom),
    toPortalCoords: (x, y) => ({ x: x - paperRect.left, y: y - paperRect.top }),
  };
}
