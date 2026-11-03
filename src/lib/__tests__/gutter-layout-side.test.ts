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
import { deriveCategorySides } from "@/panels/Omni/omni-categories";

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
