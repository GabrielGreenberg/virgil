// CHIP 9 — top/bottom margin slider reaches the pod's top/bottom edge.
//
// Two coupled changes let the top/bottom margin SETTING collapse the
// wasted white strip between the prose and the pod border:
//
//   1. Editor.tsx's prose padding no longer adds the dead
//      `--doc-top-extra` (a vestige of the removed top-gutter,
//      backlog #5). That var was read with a 40px default but never
//      assigned anywhere, so it locked a permanent slider-uncontrollable
//      +40px onto the TOP — the primary wasted strip and the reason the
//      top looked more padded than the bottom. Removing it makes the top
//      fully slider-controlled and symmetric with the bottom.
//
//   2. MARGIN_MIN.top/bottom drop from 24 → 0 so the clamp lets the
//      slider drive the prose padding all the way to 0. The residual
//      ~8px gap is the irreducible --pod-cap-inner rounded-corner arc
//      (NOT slider-controllable padding) — preserved, untouched.
//
// The TOOTH: revert either change → RED. Restore the +24 floor and the
// clamp test fails; re-add `--doc-top-extra` and the prose-class
// regression test fails.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MARGIN_MIN, MARGIN_MAX } from "@/hooks/useMarginEdit";

function read(rel: string): string {
  return readFileSync(resolve(__dirname, "..", "..", rel), "utf8");
}

const EDITOR = read("components/Editor.tsx");
const VIEWPREFS = read("hooks/useViewPrefs.ts");

describe("top/bottom margin floor reaches the pod edge (chip 9)", () => {
  it("MARGIN_MIN.top and .bottom floor at 0", () => {
    expect(MARGIN_MIN.top).toBe(0);
    expect(MARGIN_MIN.bottom).toBe(0);
  });

  it("leaves the left/right floors alone (chip 8 governs the right)", () => {
    expect(MARGIN_MIN.left).toBe(72);
    expect(MARGIN_MIN.right).toBe(24);
  });

  it("the per-side clamp can reach 0 on the Y axis", () => {
    // Mirrors the drag-flush clamp in beginDrag:
    //   next = Math.max(min, Math.min(MARGIN_MAX, next))
    const clamp = (side: "top" | "bottom", raw: number) =>
      Math.max(MARGIN_MIN[side], Math.min(MARGIN_MAX, raw));

    expect(clamp("top", 0)).toBe(0);
    expect(clamp("top", -50)).toBe(0); // dragging past the edge pins at 0
    expect(clamp("bottom", 0)).toBe(0);
    expect(clamp("bottom", -50)).toBe(0);
    // still capped at the top end
    expect(clamp("top", 9999)).toBe(MARGIN_MAX);
  });
});

describe("Editor prose padding no longer references the dead --doc-top-extra (chip 9)", () => {
  it("the prose top padding reads only --editor-pt", () => {
    expect(EDITOR).toContain("pt-[var(--editor-pt,40px)]");
  });

  it("never references --doc-top-extra anywhere", () => {
    expect(EDITOR).not.toContain("--doc-top-extra");
  });

  it("the bottom padding is unchanged (--editor-pb)", () => {
    expect(EDITOR).toContain("pb-[var(--editor-pb,40px)]");
  });
});

// The persist-side regression: the drag floor (MARGIN_MIN) dropped top/bottom
// to 0, but the viewPrefs *persist* setters still clamped at 24 — so dragging
// the top/bottom edge below 24 and pressing the checkmark snapped it straight
// back to 24 ("resets to its previous position"). The persist floor MUST equal
// the drag floor per side, or the commit fights the drag.
describe("persist-side margin clamp mirrors the drag floor MARGIN_MIN (snap-back regression)", () => {
  const flat = VIEWPREFS.replace(/\s+/g, " ");
  const cases: { pref: string; side: "left" | "right" | "top" | "bottom" }[] = [
    { pref: "editorLeftMargin", side: "left" },
    { pref: "editorRightMargin", side: "right" },
    { pref: "editorTopMargin", side: "top" },
    { pref: "editorBottomMargin", side: "bottom" },
  ];
  for (const { pref, side } of cases) {
    it(`${pref} persist clamp floors at MARGIN_MIN.${side} (${MARGIN_MIN[side]})`, () => {
      expect(flat).toContain(
        `${pref}: Math.max(${MARGIN_MIN[side]}, Math.min(${MARGIN_MAX}, Math.round(px)))`,
      );
    });
  }

  it("the buggy +24 floor is gone for top AND bottom (the snap-back fix)", () => {
    expect(flat).not.toContain("editorTopMargin: Math.max(24,");
    expect(flat).not.toContain("editorBottomMargin: Math.max(24,");
  });
});
