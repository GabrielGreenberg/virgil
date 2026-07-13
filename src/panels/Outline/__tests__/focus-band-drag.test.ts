import { describe, it, expect } from "vitest";
import { resolveDragCommit } from "../focus-band-drag";

/**
 * Task 113 — the FocusBand mouseup commit decision. The baseline is the
 * dragged edge's OWN committed row; comparing against the FIXED (opposite)
 * edge silently dropped the standard shrink gesture and let a return-to-origin
 * drag commit a no-op.
 */
describe("resolveDragCommit", () => {
  const range = { startBlockIndex: 4, endBlockIndex: 20 };

  it("commits a bottom-edge shrink onto the band's own start row (the bug case)", () => {
    // Dragging the bottom handle up onto the start heading's row: pending
    // equals the FIXED edge's row — the old fixed-edge baseline read this as
    // "not moved" and dropped the shrink.
    expect(
      resolveDragCommit({ edge: "bottom", pendingBlockIndex: 4, ...range }),
    ).toEqual({ commit: true, blockIndex: 4 });
  });

  it("commits a top-edge shrink onto the band's own end row (symmetric)", () => {
    expect(
      resolveDragCommit({ edge: "top", pendingBlockIndex: 20, ...range }),
    ).toEqual({ commit: true, blockIndex: 20 });
  });

  it("skips when the dragged edge lands back on its own row (no-op drag)", () => {
    // The inverse defect: under the fixed-edge baseline this committed a
    // pointless snapBoundary write (own row ≠ fixed row).
    expect(
      resolveDragCommit({ edge: "bottom", pendingBlockIndex: 20, ...range }),
    ).toEqual({ commit: false });
    expect(
      resolveDragCommit({ edge: "top", pendingBlockIndex: 4, ...range }),
    ).toEqual({ commit: false });
  });

  it("skips when no mousemove ran (plain click on the handle)", () => {
    expect(
      resolveDragCommit({ edge: "top", pendingBlockIndex: null, ...range }),
    ).toEqual({ commit: false });
    expect(
      resolveDragCommit({ edge: "bottom", pendingBlockIndex: null, ...range }),
    ).toEqual({ commit: false });
  });

  it("commits a normal move to a third row with that row's index", () => {
    expect(
      resolveDragCommit({ edge: "top", pendingBlockIndex: 9, ...range }),
    ).toEqual({ commit: true, blockIndex: 9 });
    expect(
      resolveDragCommit({ edge: "bottom", pendingBlockIndex: 30, ...range }),
    ).toEqual({ commit: true, blockIndex: 30 });
  });

  it("commits a shrink past the opposite edge (snapBoundary owns the 1-row clamp)", () => {
    // Dragging the bottom edge ABOVE the start row still commits — the range
    // clamp is useFocusMode.snapBoundary's job, not the commit gate's.
    expect(
      resolveDragCommit({ edge: "bottom", pendingBlockIndex: 2, ...range }),
    ).toEqual({ commit: true, blockIndex: 2 });
  });
});
