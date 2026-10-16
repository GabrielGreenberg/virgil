// A Mode-B text anchor's hover/selection has ONE painter (task 1148).
//
// THE FINDING
//
//   The same `.linked-anchor` span got attention chrome from two writers fed
//   by two copies of one fact: the SHELL (`useLinkHighlight`, stamping
//   `data-link-highlight` from `activeAnchorId` / `hoveredAnchorId` it kept in
//   sync with the pane's card store) and the PANE (`useAnchorHighlightReconciler`,
//   stamping `data-card-hovered` / `data-card-selected` from that store
//   directly). Both CSS rules were (0,2,0) and the reconciler's came later, so
//   its 22% wash always won the background: the shell's 45% / 60% washes never
//   painted, and only its 1px "active" ring survived — by accident.
//
// THE FIX, pinned here
//
//   The reconciler is the only writer. The ring the user actually saw moved
//   onto `.linked-anchor[data-card-selected]`; the shell channel, its state
//   copies, its CSS, its view-only vocabulary member and its strip-list rows
//   are gone. This census refuses the second channel's return in any form.
//
// The reconciler's own stamping (hover → `data-card-hovered`, select →
// `data-card-selected` on the Mode-B span) is exercised behaviourally in
// `archived-anchor-chrome.test.tsx` ("CONTROL — hovering an ACTIVE card still
// paints", "selection is gated too, and un-archiving restores the paint").
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  commentsStripped,
  cssCommentsStripped,
  trackedFiles,
  REPO_ROOT,
} from "@/lib/__tests__/_source-scan";
import { VIEW_ONLY_ATTENTION_ATTRS } from "@/lib/view-only-chrome";

const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");
const CSS = cssCommentsStripped(read("src/app/globals.css"));

/** Every `selector { body }` whose selector names a `.linked-anchor` with the
 *  given attribute. */
function linkedAnchorRules(attr: string): string[] {
  const out: string[] = [];
  for (const m of CSS.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const sel = m[1];
    if (sel.includes(".linked-anchor") && sel.includes(`[${attr}`)) out.push(m[2]);
  }
  return out;
}

describe("Mode-B span attention — ONE painter CENSUS", () => {
  it("no source in src/ writes or reads the retired `data-link-highlight` channel", () => {
    const offenders: string[] = [];
    for (const abs of trackedFiles("src", /\.(ts|tsx)$/)) {
      if (abs.includes("__tests__")) continue;
      if (commentsStripped(readFileSync(abs, "utf8")).includes("data-link-highlight")) {
        offenders.push(abs);
      }
    }
    expect(offenders, "a second Mode-B attention channel came back").toEqual([]);
    expect(CSS).not.toContain("data-link-highlight");
  });

  it("the view-only vocabulary declares exactly the reconciler's two attributes", () => {
    expect([...VIEW_ONLY_ATTENTION_ATTRS].sort()).toEqual([
      "data-card-hovered",
      "data-card-selected",
    ]);
  });

  it("the SELECTED span carries the ring the user saw; hover does not", () => {
    // Preserved rendered result: 22% wash on hover and on selection, plus the
    // 1px ring on selection (formerly the shell's `active` ring).
    const selected = linkedAnchorRules("data-card-selected");
    expect(selected.some((b) => /22%/.test(b))).toBe(true);
    expect(
      selected.some((b) =>
        /box-shadow:\s*0 0 0 1px color-mix\(in oklab, var\(--link-anchor-color\) 80%/.test(b),
      ),
      "the selected Mode-B span lost its 1px ring",
    ).toBe(true);
    const hovered = linkedAnchorRules("data-card-hovered");
    expect(hovered.some((b) => /22%/.test(b))).toBe(true);
    // The one rule shared by both selectors paints no ring.
    for (const m of CSS.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      if (/\.linked-anchor\[data-card-hovered="true"\]/.test(m[1])) {
        expect(m[2]).not.toMatch(/box-shadow/);
      }
    }
  });

  it("the shell keeps no copy of the pane's hover/selection for anchor paint", () => {
    const shell = commentsStripped(read("src/components/EditorLayout.tsx"));
    for (const gone of [
      "activeAnchorId",
      "hoveredAnchorId",
      "useSelectedAnchorSync",
      "entityToAnchorId",
      "getHoverSnapshot",
    ]) {
      expect(shell, `EditorLayout re-grew \`${gone}\``).not.toContain(gone);
    }
    const hook = commentsStripped(read("src/links/_shared/useLinkHighlight.ts"));
    expect(hook).not.toMatch(/activeLinkId|hoveredLinkId/);
  });
});
