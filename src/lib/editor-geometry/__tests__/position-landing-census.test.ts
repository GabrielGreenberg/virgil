// Task 1099 — CENSUS: the two doors behind "take me to this position".
//
// Task 857 gave "where on screen does a landed paragraph go?" one answer — the
// READING LINE (`reading-line.ts`) — but converted only one landing. Three
// more each kept a hand `- 100` and picked their own scroll container, and
// one of them (the code view's text-to-code arrow) walked to the first
// ancestor whose computed `overflowY` was not `visible`: the editor pod,
// which is `overflow: clip` and does not scroll. The arrow moved the caret
// and never the page, and nothing noticed.
//
// So both questions get one door, and this census keeps the hand-rolled
// spellings from coming back:
//
//   (a) "which element scrolls this editor?" — `findEditorScrollFor` /
//       `findRowScrollFor` (`layout-scroll.ts`). No production source outside
//       that module reads a computed `overflowY` / `overflow-y` to find one.
//   (b) "land this position" — `scrollPosToReadingLine` /
//       `scrollBlockToReadingLine`. No production source computes a scroll
//       target as `… scrollTop - <literal>`.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, commentsStripped, walkFiles } from "@/lib/__tests__/_source-scan";

function productionFiles(): string[] {
  return ["src", "library"]
    .flatMap((d) => walkFiles(path.join(REPO_ROOT, d), { skipDirs: ["__tests__"] }))
    .filter((p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p));
}

/** Files that may read a computed overflow, with why. */
const OVERFLOW_READ_ALLOWED: Record<string, string> = {
  "src/components/editor-layout/layout-scroll.ts":
    "THE DOOR's module — `findScrollParent` (list-mode panel scrolls) lives beside `findEditorScrollFor` / `findRowScrollFor`.",
  "src/floats/float-policy.ts":
    "`collectClippedHeight` asks a different question — how much of a float's ancestors CLIP it — not which element scrolls.",
};

/** A computed-overflow READ: `.overflowY` that is not an object-literal key
 *  (`overflowY: "auto"`) or a style assignment, or a `getPropertyValue` of
 *  `overflow-y`. */
const OVERFLOW_READ =
  /\.overflowY\b(?!\s*(?::|=(?!=)))|getPropertyValue\(\s*["'`]overflow(?:-y)?["'`]/;

/** A scroll target offset by a hand literal: `scrollTop - 100`. */
const HAND_LANDING = /scrollTop\s*-\s*\d{2,}\b/;

function hits(re: RegExp): string[] {
  const out: string[] = [];
  for (const abs of productionFiles()) {
    const rel = path.relative(REPO_ROOT, abs);
    const lines = commentsStripped(fs.readFileSync(abs, "utf8")).split("\n");
    lines.forEach((line, i) => {
      if (re.test(line)) out.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
  }
  return out;
}

describe("position-landing CENSUS (task 1099)", () => {
  it("(a) no production source hand-walks computed overflow to find a scroll container", () => {
    const offenders = hits(OVERFLOW_READ).filter(
      (h) => !(h.slice(0, h.indexOf(":")) in OVERFLOW_READ_ALLOWED),
    );
    expect(
      offenders,
      "Find the editor's scroller through `findEditorScrollFor` / `findRowScrollFor` (layout-scroll.ts). " +
        "A computed-overflow walk stops at the editor pod (`overflow: clip`, not a scroll container). " +
        "If this site really asks a different question, add it to OVERFLOW_READ_ALLOWED with the reason.",
    ).toEqual([]);
  });

  it("(a) every allowlisted file still reads a computed overflow (no stale entries)", () => {
    const files = new Set(hits(OVERFLOW_READ).map((h) => h.slice(0, h.indexOf(":"))));
    for (const f of Object.keys(OVERFLOW_READ_ALLOWED)) expect(files, f).toContain(f);
  });

  it("(b) no production source lands a position with a hand `scrollTop - <literal>`", () => {
    expect(
      hits(HAND_LANDING),
      "Land through `scrollPosToReadingLine` / `scrollBlockToReadingLine` (editor-geometry/reading-line.ts).",
    ).toEqual([]);
  });

  it("the census patterns catch the pre-1099 spellings", () => {
    expect(OVERFLOW_READ.test(`getComputedStyle(scrollEl).overflowY === "visible"`)).toBe(true);
    expect(OVERFLOW_READ.test(`if (cs.overflowY === "auto" || cs.overflowY === "scroll") break;`)).toBe(true);
    expect(OVERFLOW_READ.test(`style={{ overflowY: "auto" }}`)).toBe(false);
    expect(OVERFLOW_READ.test(`el.style.overflowY = "hidden";`)).toBe(false);
    expect(
      HAND_LANDING.test(`const targetY = coords.top - scrollRect.top + scrollEl.scrollTop - 100;`),
    ).toBe(true);
  });

  it("both former hand landings now name the reading-line door", () => {
    const bridge = fs.readFileSync(path.join(REPO_ROOT, "src/lib/code-pane-bridge.ts"), "utf8");
    const pane = fs.readFileSync(path.join(REPO_ROOT, "src/components/EditorPane.tsx"), "utf8");
    expect(bridge).toMatch(/scrollPosToReadingLine\(editor\.view, pos\)/);
    expect(pane).toMatch(/scrollPosToReadingLine\(ed\.view, range\.from\)/);
  });

  it("EditorHandle.scrollToPos is gone (it had no caller)", () => {
    const ed = fs.readFileSync(path.join(REPO_ROOT, "src/components/Editor.tsx"), "utf8");
    expect(commentsStripped(ed)).not.toMatch(/\bscrollToPos\b/);
  });
});
