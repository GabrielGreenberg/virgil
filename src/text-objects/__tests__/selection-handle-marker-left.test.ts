/**
 * Task 092 — the selected-text grab handle is a positional REPLACEMENT of its
 * containing block's text-object handle: both hug the block's measured
 * `markerLeft`, so they land in the SAME gutter X.
 *
 * The old code forked the X anchor on `ref.kind`: a selection used
 * `frame.contentLeft` (text-start), a text-object used `frame.markerLeft`. For a
 * plain paragraph `markerLeft === contentLeft`, so both coincided — fine. But
 * for a marker-bearing block (`listItem` bullet band, `exampleItem` `(n)`/`a.`)
 * `markerLeft < contentLeft`, so the selection grip landed OVER the bullet
 * instead of in the gutter (the reported bug). The fix routes BOTH kinds through
 * `resolveHandleMarkerLeft`, which returns `markerLeft` regardless of kind.
 *
 * PURE-LOGIC (like `marker-left-fallback.test.ts`): we don't trust jsdom layout
 * — we exercise the two placement helpers the source uses (`resolveHandleMarkerLeft`
 * → `computeHandleLeftEdge`) with synthetic frames, asserting the selection and
 * text-object handles resolve to the SAME `left` for a marker-bearing block and
 * remain unchanged for a plain paragraph.
 */

import { describe, expect, it } from "vitest";
import {
  computeHandleLeftEdge,
  resolveHandleMarkerLeft,
} from "@/text-objects/handle-layout";

const EDITOR_COLUMN_LEFT = 100;
const BASELINE_INSET = 40; // floor = 60; kept below every marker below
const GAP_PX = 6;

/** Resolve a handle's left edge exactly as `computePlacement` does: pick the
 *  block X via `resolveHandleMarkerLeft`, then apply the shared gap/width/floor. */
function handleLeft(
  frame: { markerLeft: number; contentLeft: number },
  refKind: "selection" | "text-object",
): number {
  return computeHandleLeftEdge({
    markerLeft: resolveHandleMarkerLeft(frame, refKind),
    gapPx: GAP_PX,
    editorColumnLeft: EDITOR_COLUMN_LEFT,
    baselineInset: BASELINE_INSET,
    // Task 382: the ink boundary. These legs are about the X ANCHOR, so every
    // frame here declares its own marker as the ink — the pre-382 geometry,
    // where the anchor was the only bound.
    inkLeft: frame.markerLeft,
  });
}

describe("selection handle takes the text-object handle's gutter slot (#092)", () => {
  it("marker-bearing block (listItem): selection === text-object left, LEFT of content", () => {
    // A bullet band sits left of the text: markerLeft < contentLeft.
    const frame = { markerLeft: 300, contentLeft: 324 };
    const selection = handleLeft(frame, "selection");
    const textObject = handleLeft(frame, "text-object");

    expect(selection).toBe(textObject); // same gutter slot — the fix
    // and it hugs the MARKER, not the text (would-be over-the-bullet position).
    expect(selection).toBe(computeHandleLeftEdge({
      markerLeft: frame.markerLeft,
      gapPx: GAP_PX,
      editorColumnLeft: EDITOR_COLUMN_LEFT,
      baselineInset: BASELINE_INSET,
      inkLeft: frame.markerLeft,
    }));
    // The old contentLeft anchor would have sat a full marker-band right of this.
    const oldSelectionLeft = computeHandleLeftEdge({
      markerLeft: frame.contentLeft,
      gapPx: GAP_PX,
      editorColumnLeft: EDITOR_COLUMN_LEFT,
      baselineInset: BASELINE_INSET,
      inkLeft: frame.contentLeft,
    });
    expect(selection).toBeLessThan(oldSelectionLeft);
  });

  it("marker-bearing block (exampleItem): selection === text-object left", () => {
    const frame = { markerLeft: 280, contentLeft: 298 };
    expect(handleLeft(frame, "selection")).toBe(handleLeft(frame, "text-object"));
  });

  it("plain paragraph (markerLeft === contentLeft): selection unchanged, === text-object", () => {
    // A markerless block: markerLeft IS contentLeft, so no fork mattered.
    const frame = { markerLeft: 300, contentLeft: 300 };
    const selection = handleLeft(frame, "selection");
    expect(selection).toBe(handleLeft(frame, "text-object"));
    // Unchanged from the pre-fix behavior (contentLeft anchor === markerLeft anchor).
    expect(selection).toBe(computeHandleLeftEdge({
      markerLeft: frame.contentLeft,
      gapPx: GAP_PX,
      editorColumnLeft: EDITOR_COLUMN_LEFT,
      baselineInset: BASELINE_INSET,
      inkLeft: frame.contentLeft,
    }));
  });

  it("resolveHandleMarkerLeft returns markerLeft for BOTH kinds (no per-kind fork)", () => {
    const frame = { markerLeft: 300 };
    expect(resolveHandleMarkerLeft(frame, "selection")).toBe(300);
    expect(resolveHandleMarkerLeft(frame, "text-object")).toBe(300);
  });
});
