// The projection and its two inverses (task 131). These are pure, so the
// coordinate contract is pinned without a React tree; the hook-level suite
// (`useLibraryTabs.coords.test.tsx`) proves the mutators actually route
// through them.

import { describe, expect, it } from "vitest";
import {
  CENTRAL_LIBRARY_ID,
  projectLibraryIdForDoc,
  type PanelTabsState,
} from "@library/lib/library-store";
import {
  displayedIndexToRaw,
  projectLeftTabs,
  resolveReplaceTargetId,
} from "@library/lib/panel-tab-coords";

const C = CENTRAL_LIBRARY_ID;
const pA = projectLibraryIdForDoc("docA");
const pB = projectLibraryIdForDoc("docB");

const raw = (openIds: string[], activeId: string): PanelTabsState => ({
  openIds,
  activeId,
});

describe("projectLeftTabs — raw → displayed", () => {
  it("splices project tabs right after Central", () => {
    const out = projectLeftTabs({
      raw: raw([C, "custom1", "custom2"], C),
      projectIds: [pA, pB],
    });
    expect(out.openIds).toEqual([C, pA, pB, "custom1", "custom2"]);
  });

  it("puts project tabs at the head when Central isn't first", () => {
    const out = projectLeftTabs({
      raw: raw(["custom1"], "custom1"),
      projectIds: [pA],
    });
    expect(out.openIds).toEqual([pA, "custom1"]);
  });

  it("overrides activeId to the current doc's project tab", () => {
    const out = projectLeftTabs({
      raw: raw([C, "custom1"], C),
      projectIds: [pA, pB],
      currentDocId: "docB",
    });
    expect(out.activeId).toBe(pB);
  });

  it("a pinned non-project tab beats the currentDocId override", () => {
    const out = projectLeftTabs({
      raw: raw([C, "custom1"], C),
      projectIds: [pA],
      currentDocId: "docA",
      pinnedActiveId: "custom1",
    });
    expect(out.activeId).toBe("custom1");
  });

  it("falls back to the first displayed tab when activeId resolves nothing", () => {
    const out = projectLeftTabs({
      raw: raw([C], "gone"),
      projectIds: [pA],
    });
    expect(out.activeId).toBe(C);
  });
});

describe("displayedIndexToRaw — displayed → raw insertion index", () => {
  const displayed = [C, pA, pB, "custom1", "custom2"];
  const rawIds = [C, "custom1", "custom2"];

  it("is the identity when there is no projection", () => {
    for (let i = 0; i <= rawIds.length; i++) {
      expect(displayedIndexToRaw(rawIds, rawIds, i)).toBe(i);
    }
  });

  it("counts only RAW members before the insertion point", () => {
    expect(displayedIndexToRaw(displayed, rawIds, 0)).toBe(0);
    // Everything from "just after Central" through "just before custom1"
    // denotes the same raw slot — a raw tab cannot render between Central
    // and the project tabs, so these displayed points collapse.
    expect(displayedIndexToRaw(displayed, rawIds, 1)).toBe(1);
    expect(displayedIndexToRaw(displayed, rawIds, 2)).toBe(1);
    expect(displayedIndexToRaw(displayed, rawIds, 3)).toBe(1);
    expect(displayedIndexToRaw(displayed, rawIds, 4)).toBe(2);
    expect(displayedIndexToRaw(displayed, rawIds, 5)).toBe(3);
  });

  it("clamps out-of-range indices to the raw bounds", () => {
    expect(displayedIndexToRaw(displayed, rawIds, -3)).toBe(0);
    expect(displayedIndexToRaw(displayed, rawIds, 99)).toBe(rawIds.length);
  });
});

describe("resolveReplaceTargetId — displayed active → raw slot to replace", () => {
  const alwaysReplaceable = () => true;

  it("appends when the displayed active tab is synthetic (a project tab)", () => {
    expect(
      resolveReplaceTargetId({
        rawIds: [C, "custom1"],
        displayedActiveId: pA,
        isReplaceable: alwaysReplaceable,
      }),
    ).toBeNull();
  });

  it("replaces the displayed active tab when it holds a raw slot", () => {
    expect(
      resolveReplaceTargetId({
        rawIds: [C, "custom1"],
        displayedActiveId: "custom1",
        isReplaceable: alwaysReplaceable,
      }),
    ).toBe("custom1");
  });

  it("appends when the target is pinned / unknown", () => {
    expect(
      resolveReplaceTargetId({
        rawIds: [C],
        displayedActiveId: C,
        isReplaceable: () => false,
      }),
    ).toBeNull();
  });

  it("appends on an empty panel", () => {
    expect(
      resolveReplaceTargetId({
        rawIds: [],
        displayedActiveId: "",
        isReplaceable: alwaysReplaceable,
      }),
    ).toBeNull();
  });
});
