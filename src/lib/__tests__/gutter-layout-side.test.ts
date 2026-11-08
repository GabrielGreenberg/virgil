/**
 * Cards-right / tools-left (task 1440): with `virgil:gutter-layout` ON every
 * panel's side is "right" — the ONE ladder (`resolvePanelSide`) answers it, so
 * the strip, the margin markers, the rails and the omni columns all move
 * together. OFF keeps the placement ladder exactly as before.
 */
import { afterEach, describe, expect, it } from "vitest";
import { setFlagOverride } from "@/lib/feature-flags";
import { panelSidesFromPlacements, resolvePanelSide } from "@/lib/panel-side";
import { resolveMarginSide } from "@/lib/margin-side";
import { appliedPendingSide, deriveCategorySides } from "@/panels/Omni/omni-categories";
import { omniSideToReveal, panelSideOf } from "@/hooks/view-prefs-derived";

afterEach(() => setFlagOverride("virgil:gutter-layout", false));

const placements = [
  { id: "footnotes", side: "left" as const },
  { id: "notes", side: "left" as const },
];

describe("gutter layout — every card on the right", () => {
  it("OFF: the placement ladder decides", () => {
    setFlagOverride("virgil:gutter-layout", false);
    const sides = panelSidesFromPlacements(placements);
    expect(resolvePanelSide("footnotes", sides)).toBe("left");
    expect(resolvePanelSide("notes", sides, "right")).toBe("right");
  });

  it("ON: placements, overrides and registry defaults all resolve right", () => {
    setFlagOverride("virgil:gutter-layout", true);
    const sides = panelSidesFromPlacements(placements);
    expect(resolvePanelSide("footnotes", sides)).toBe("right");
    expect(resolvePanelSide("citations", {})).toBe("right");
    expect(resolvePanelSide("notes", sides, "left")).toBe("right");
    expect(resolveMarginSide("footnotes", sides)).toBe("right");
    const cats = deriveCategorySides(placements);
    for (const side of Object.values(cats)) {
      if (side !== null) expect(side).toBe("right");
    }
  });
});

// Task 1528 — "reveal the omni column for a new card" must name the side the
// card RENDERS on. It spelled the placement ladder itself, so under the gutter
// layout a footnote (placed left) answered "left" while its card sat in the
// folded RIGHT gutter: nothing unfolded, or the ToolGutter did.
describe("gutter layout — revealing a new card's column (task 1528)", () => {
  const folded = (collapsedLeft: boolean, collapsedRight: boolean) => ({
    placements,
    collapsedLeft,
    collapsedRight,
  });

  it("ON: a left-placed panel's card is revealed by unfolding the RIGHT gutter", () => {
    setFlagOverride("virgil:gutter-layout", true);
    expect(omniSideToReveal(folded(false, true), "footnotes")).toBe("right");
    // Both folded: the right (cards) gutter, never the left ToolGutter.
    expect(omniSideToReveal(folded(true, true), "footnotes")).toBe("right");
    // Left folded only: the card's column is shown — nothing to reveal.
    expect(omniSideToReveal(folded(true, false), "footnotes")).toBeNull();
    expect(panelSideOf({ placements }, "footnotes")).toBe("right");
  });

  it("OFF: today's answer — the placement side", () => {
    setFlagOverride("virgil:gutter-layout", false);
    expect(omniSideToReveal(folded(false, true), "footnotes")).toBeNull();
    expect(omniSideToReveal(folded(true, false), "footnotes")).toBe("left");
    expect(panelSideOf({ placements }, "footnotes")).toBe("left");
  });

  it("a host's ABSENT category reads the ladder, not the raw registry default", () => {
    // `{}` = every category on its no-placement side. Under the gutter layout
    // that side is "right" for all of them.
    setFlagOverride("virgil:gutter-layout", true);
    expect(appliedPendingSide({})).toBe("right");
  });
});
