// TASK 1592 — CENSUS: the figure source popover's click event has ONE emitter.
//
// `virgil-figure-click` was built inline at four sites (the page and float
// NodeViews, the lightning grid's insert callback, the registry's insert
// fallback), so a new identity field — as `uuid` was in task 1082 — had to be
// added by hand at each, and a missed one routed a save to the wrong editor.
// The door is `emitFigureClick` (+ the `clickedFigureOf` identity builder) in
// `src/lib/figures/popover-target.ts`; nothing else constructs the event.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO_ROOT, trackedFiles } from "@/lib/__tests__/_source-scan";

const DOOR = "src/lib/figures/popover-target.ts";

describe("figure-click emitter CENSUS (task 1592)", () => {
  it("no file outside popover-target.ts constructs the figure-click event", () => {
    const offenders: string[] = [];
    for (const file of trackedFiles("src", /\.(ts|tsx)$/)) {
      const rel = relative(REPO_ROOT, file);
      if (rel.includes("/__tests__/")) continue;
      if (rel === DOOR) continue;
      const text = readFileSync(file, "utf8");
      if (/new CustomEvent\(\s*(?:"virgil-figure-click"|FIGURE_CLICK_EVENT)/.test(text)) {
        offenders.push(rel);
      }
    }
    expect(offenders, "dispatch through emitFigureClick").toEqual([]);
  });

  it("the door constructs it exactly once", () => {
    const door = readFileSync(join(REPO_ROOT, DOOR), "utf8");
    expect(door.match(/new CustomEvent\(FIGURE_CLICK_EVENT/g)).toHaveLength(1);
  });
});
