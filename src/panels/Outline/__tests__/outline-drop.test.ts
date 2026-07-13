import { describe, it, expect } from "vitest";
import {
  landingBlockIndex,
  isRejectedDrop,
  resolveDropIndicator,
  type DropPod,
} from "../outline-drop";

/**
 * Task 114 — edit-mode drop indicator derives from the LANDING index, so the
 * painted line and where the blocks actually land can't disagree.
 *
 * Fixture (doc order): h1 owns blocks 0-9 with a parTitle, a subheading h2
 * (blocks 6-9) and its parTitle nested inside; h3 is the next sibling section.
 */
const h1: DropPod = { id: "h1", blockIndex: 0, blockCount: 10 };
const pt1: DropPod = { id: "pt1", blockIndex: 2, blockCount: 1 };
const h2: DropPod = { id: "h2", blockIndex: 6, blockCount: 4 };
const pt2: DropPod = { id: "pt2", blockIndex: 8, blockCount: 1 };
const h3: DropPod = { id: "h3", blockIndex: 10, blockCount: 5 };
const allPods = [h1, pt1, h2, pt2, h3];

describe("landingBlockIndex", () => {
  it("lands above at the pod's own start, below after its whole section", () => {
    expect(landingBlockIndex(h1, "above")).toBe(0);
    expect(landingBlockIndex(h1, "below")).toBe(10);
    expect(landingBlockIndex(pt1, "below")).toBe(3);
  });
});

describe("resolveDropIndicator", () => {
  it("paints below an EXPANDED heading on the section's last visible member (the bug case)", () => {
    // All children visible: the line must sit where the blocks land — after
    // pt2, the last visible pod of h1's section — not at h1's own bottom edge
    // (which is visually between h1 and pt1).
    expect(resolveDropIndicator(allPods, h1, "below", h3)).toEqual({
      podId: "pt2",
      position: "below",
    });
  });

  it("paints below a COLLAPSED heading on the pod itself (unchanged behavior)", () => {
    const visible = [h1, h3]; // h1 collapsed — children hidden
    expect(resolveDropIndicator(visible, h1, "below", h3)).toEqual({
      podId: "h1",
      position: "below",
    });
  });

  it("hands the line to a collapsed subheading when it is the last visible member", () => {
    const visible = [h1, pt1, h2, h3]; // h2 collapsed — pt2 hidden
    expect(resolveDropIndicator(visible, h1, "below", h3)).toEqual({
      podId: "h2",
      position: "below",
    });
  });

  it("paints above-hovers on the hovered pod itself", () => {
    expect(resolveDropIndicator(allPods, h2, "above", h3)).toEqual({
      podId: "h2",
      position: "above",
    });
  });

  it("keeps a leaf (parTitle) below-hover on the pod itself", () => {
    expect(resolveDropIndicator(allPods, pt1, "below", h3)).toEqual({
      podId: "pt1",
      position: "below",
    });
  });

  it("suppresses the indicator when the drop would be rejected (own pod / own range)", () => {
    // Hovering the dragged pod itself.
    expect(resolveDropIndicator(allPods, h1, "below", h1)).toBeNull();
    // Landing inside the dragged section: above pt1 lands at 2 and below pt1
    // at 3 — both strictly inside h1's 0-10 range; handleDrop rejects, so no
    // line. (Below h2 lands at 10 = h1's END boundary — that one is legal and
    // covered by the boundary test below.)
    expect(resolveDropIndicator(allPods, pt1, "above", h1)).toBeNull();
    expect(resolveDropIndicator(allPods, pt1, "below", h1)).toBeNull();
  });

  it("still lights boundary landings (a legal no-op move is not a rejection)", () => {
    // Above h3 lands at 10 — h1's END boundary, which handleDrop allows.
    expect(resolveDropIndicator(allPods, h3, "above", h1)).toEqual({
      podId: "h3",
      position: "above",
    });
  });
});

describe("isRejectedDrop", () => {
  it("matches handleDrop's guards: same pod, strictly-inside landing", () => {
    expect(isRejectedDrop(undefined, h1, 10)).toBe(false);
    expect(isRejectedDrop(h1, h1, 0)).toBe(true);
    expect(isRejectedDrop(h1, pt1, 2)).toBe(true); // inside (0, 10)
    expect(isRejectedDrop(h1, h3, 10)).toBe(false); // boundary
    expect(isRejectedDrop(h2, h3, 15)).toBe(false); // clear of the range
  });
});
