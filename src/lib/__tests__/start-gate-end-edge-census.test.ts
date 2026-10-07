// Task 993 — START GATE ⇒ END EDGE census.
//
// `isPrimaryDragStart` is half of the pointer contract in
// `pane-resize/pointer-invariants.ts`; the other half is the end edge that
// survives a release the page never sees (`isMissedRelease` inside a move
// handler, or `watchHeldPress` for a latch that tracks no movement). The ⚡
// bolt's editor-press latch took the start gate and not the end edge, so a
// swallowed mouseup hid the bolt until the user's next click — and the
// pane-drag guardrail could not see it, because a latch installs no move
// listener and is not shaped like a gesture. This census sees it by IMPORT:
// every non-test file that takes the start gate also takes an end edge, or
// says here why its end belongs to someone else.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { commentsStripped, REPO_ROOT, walkFiles } from "./_source-scan";

const SRC = path.join(REPO_ROOT, "src");
const END_EDGE = /\b(?:isMissedRelease|watchHeldPress)\b/;

/** Files that take the start gate but hand the gesture's END to an owner
 *  that pays the end-edge invariant itself. Each entry names that owner. */
const DELEGATES_END: Record<string, string> = {
  "src/components/stack/StackThumbnail.tsx":
    "the press is handed straight to `beginDropSession`; the drop-mode controller owns the session's end (it imports isMissedRelease)",
  "src/lib/pane-resize/pointer-invariants.ts": "the invariants' own home",
};

function startGateTakers(): string[] {
  return walkFiles(SRC, { skipDirs: ["__tests__"] })
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => /\bisPrimaryDragStart\b/.test(commentsStripped(fs.readFileSync(f, "utf8"))))
    .map((f) => path.relative(REPO_ROOT, f).split(path.sep).join("/"))
    .sort();
}

describe("start gate ⇒ end edge CENSUS (task 993)", () => {
  const takers = startGateTakers();

  it("finds the start gate's consumers (non-vacuous)", () => {
    expect(takers).toContain("src/components/SelectionActionsMenu.tsx");
    expect(takers.length).toBeGreaterThan(5);
  });

  it("every start-gate taker also takes an end edge, or delegates it by name", () => {
    const missing = takers.filter(
      (f) =>
        !(f in DELEGATES_END) &&
        !END_EDGE.test(commentsStripped(fs.readFileSync(path.join(REPO_ROOT, f), "utf8"))),
    );
    expect(
      missing,
      "These files gate a press START with isPrimaryDragStart but have no end edge " +
        "for a release the page never sees. A move-tracking gesture: end on " +
        "isMissedRelease(e) in its move handler. A held-press latch with no move " +
        "handler: arm watchHeldPress(onEnd) at the press. If another owner ends the " +
        "gesture, add the file to DELEGATES_END naming that owner.",
    ).toEqual([]);
  });

  it("every delegation entry is still a live start-gate taker (no stale allowlist)", () => {
    expect(Object.keys(DELEGATES_END).filter((f) => !takers.includes(f))).toEqual([]);
  });

  it("the drop-mode controller StackThumbnail delegates to really pays the end edge", () => {
    const controller = commentsStripped(
      fs.readFileSync(path.join(SRC, "components/drop-mode/controller.ts"), "utf8"),
    );
    expect(controller).toMatch(END_EDGE);
  });
});
