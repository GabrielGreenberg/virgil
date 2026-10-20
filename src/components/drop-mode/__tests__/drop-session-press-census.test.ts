// Task 1192 — a PRESS is not a drag: CENSUS of who may begin a drop session.
//
// A drop session's begin edge has global side effects (body
// `data-drop-mode-active` → click-through markers / overflow pill / grab
// handle, crosshair cursor, the content LayoutGestureBus begin, global
// `user-select:none`, payload resolution). Begun on the press, a plain click
// paid them all — and the margin marker's own click never arrived. So every
// press-started producer goes through `pendDropSession` / `pendDrag`
// (`pending-session.ts`), which begins only past `DROP_DRAG_THRESHOLD_PX`.
//
// This census pins the DIRECT begin doors to the files that call them on a
// threshold edge of their own. A new direct caller fails here: route its press
// through the pending door, or — if it already gates on movement — add it with
// the reason.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { commentsStripped, REPO_ROOT, walkFiles } from "@/lib/__tests__/_source-scan";

const SRC = path.join(REPO_ROOT, "src");

/** Files that call `beginDropSession(` directly, each with why its call is
 *  on a drag edge rather than a press. */
const DIRECT_BEGIN: Record<string, string> = {
  "src/components/drop-mode/pending-session.ts":
    "the pending door's promote edge — past DROP_DRAG_THRESHOLD_PX",
  "src/lib/tiptap/inline-atom-grab.ts":
    "begins inside its own mousemove once DRAG_THRESHOLD is crossed",
  "src/text-objects/LiftHost.tsx":
    "beginLift is the POST-threshold core; its callers are censused below",
};

/** Files that call `.beginLift(` (which begins a session), each with the
 *  threshold its call sits behind. */
const LIFT_CALLERS: Record<string, string> = {
  "src/text-objects/TextObjectGrabHandle.tsx":
    "the grab handle calls beginLift on its own threshold-crossing move",
  "src/floats/FloatWindow.tsx":
    "the text-object float drop button calls beginLift from pendDrag's onPromote",
};

function callers(re: RegExp): string[] {
  return walkFiles(SRC, { skipDirs: ["__tests__"] })
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => re.test(commentsStripped(fs.readFileSync(f, "utf8"))))
    .map((f) => path.relative(REPO_ROOT, f).split(path.sep).join("/"))
    .sort();
}

describe("drop session press CENSUS (task 1192)", () => {
  it("only threshold-gated files begin a drop session directly", () => {
    // A CALL, not the definition (`function beginDropSession(`).
    const found = callers(/(?<!function )\bbeginDropSession\(/).filter(
      (f) => f !== "src/components/drop-mode/controller.ts",
    );
    expect(found.length, "non-vacuous").toBeGreaterThan(1);
    expect(
      found,
      "A file begins a drop session directly. If it does so from a mousedown/" +
        "pointerdown, route the press through pendDropSession/pendDrag " +
        "(drop-mode/pending-session.ts) so a click stays a click. If it already " +
        "begins on a movement threshold of its own, add it to DIRECT_BEGIN with the reason.",
    ).toEqual(Object.keys(DIRECT_BEGIN).sort());
  });

  it("only threshold-gated files start a lift (which begins a session)", () => {
    const found = callers(/\.beginLift\(/);
    expect(found, "non-vacuous").toContain("src/text-objects/TextObjectGrabHandle.tsx");
    expect(
      found,
      "A file calls beginLift. It begins a drop session; call it from a threshold " +
        "edge (pendDrag's onPromote for a press), then add it to LIFT_CALLERS.",
    ).toEqual(Object.keys(LIFT_CALLERS).sort());
  });

  it("FloatWindow's lift sits behind the pending door", () => {
    const src = commentsStripped(
      fs.readFileSync(path.join(REPO_ROOT, "src/floats/FloatWindow.tsx"), "utf8"),
    );
    expect(src).toMatch(/pendDrag\(\{[\s\S]*?onPromote:[\s\S]*?\.beginLift\(/);
  });

  it("the card drop gesture pends, never begins", () => {
    const src = commentsStripped(
      fs.readFileSync(path.join(REPO_ROOT, "src/components/drop-mode/card-drop-gesture.ts"), "utf8"),
    );
    expect(src).toMatch(/\bpendDropSession\(/);
    expect(src).not.toMatch(/\bbeginDropSession\(/);
  });
});
