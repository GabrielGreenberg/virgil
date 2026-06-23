import { describe, it, expect } from "vitest";
import type { PanelId, Side, ViewPrefs } from "@/hooks/useViewPrefs";
import { PANEL_REGISTRY } from "@/panels/panel-registry";
import { jumpTargetSide, planJumpDocks } from "../jump-docks";

/**
 * Regression guard for the cross-panel "jump to item" dock (the SearchHost
 * action behind `openItemInPanel` in EditorPane). The bug: the jump only set a
 * retired `activeLeftPanelKind` model that nothing renders from, so jumping to
 * a citation/footnote/etc. never actually opened its panel. The fix routes the
 * jump through `viewPrefs.openPanelDocked`; `planJumpDocks` owns the side math.
 */

type StackShape = { left: PanelId[]; right: PanelId[] };

function makePrefs(
  placements: Array<{ id: PanelId; side: Side }>,
  dockStack: StackShape = { left: [], right: [] },
): ViewPrefs {
  return { placements, dockStack } as unknown as ViewPrefs;
}

describe("jumpTargetSide", () => {
  it("uses the panel's explicit placement side", () => {
    expect(jumpTargetSide(makePrefs([{ id: "citations", side: "right" }]), "citations")).toBe(
      "right",
    );
    expect(jumpTargetSide(makePrefs([{ id: "citations", side: "left" }]), "citations")).toBe(
      "left",
    );
  });

  it("falls back to the registry default side when unplaced", () => {
    const expected = PANEL_REGISTRY.citations?.defaultStripSide ?? "left";
    expect(jumpTargetSide(makePrefs([]), "citations")).toBe(expected);
  });
});

describe("planJumpDocks", () => {
  it("docks the target panel (the jump must actually open it)", () => {
    const ops = planJumpDocks(makePrefs([{ id: "citations", side: "left" }]), "citations");
    expect(ops).toEqual([{ id: "citations", side: "left" }]);
  });

  it("re-docks search FIRST when it shares the target's side (so the LRU evict drops something else)", () => {
    const prefs = makePrefs(
      [
        { id: "citations", side: "left" },
        { id: "search", side: "left" },
      ],
      { left: ["search"], right: [] },
    );
    expect(planJumpDocks(prefs, "citations")).toEqual([
      { id: "search", side: "left" },
      { id: "citations", side: "left" },
    ]);
  });

  it("does NOT touch search when it is docked on the OTHER side", () => {
    const prefs = makePrefs(
      [
        { id: "citations", side: "left" },
        { id: "search", side: "right" },
      ],
      { left: [], right: ["search"] },
    );
    expect(planJumpDocks(prefs, "citations")).toEqual([{ id: "citations", side: "left" }]);
  });

  it("Reader case: search is never docked, so only the target docks", () => {
    // Reader chrome has no search panel → dockStack never holds "search".
    const prefs = makePrefs([{ id: "footnotes", side: "left" }], { left: [], right: [] });
    expect(planJumpDocks(prefs, "footnotes")).toEqual([{ id: "footnotes", side: "left" }]);
  });
});
