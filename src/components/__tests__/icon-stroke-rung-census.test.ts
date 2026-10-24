/**
 * ICON STROKE RUNG CENSUS (task 2026-10-24-1276).
 *
 * STYLE_GUIDE → "Icons" states stroke 2 as the default and names ONE second
 * rung, the small-glyph `ICON_STROKE_SMALL` (2.5) for bare marks at ≤14px. The
 * rung used to live as 22 hand-typed `strokeWidth="2.5"` literals the guide
 * never sanctioned — the popout button even overrode its own svg's declared 2
 * on the popped "×" lines, so one button changed weight with its state.
 *
 *  1. No `2.5` stroke literal outside `icon-stroke.ts` — JSX string or
 *     number, or the vanilla `stroke-width="2.5"` attribute. A site on the rung
 *     imports it; a new weight is a STYLE_GUIDE decision, not a literal.
 *  2. The popout glyph declares its weight once, on the outer svg: no child
 *     line carries a `stroke-width` of its own.
 *  3. The menu-trigger caret polyline has ONE speller, the `MenuCaret` leaf.
 *
 * Population: every tracked `.ts`/`.tsx` under `src/`, tests excluded.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, trackedFiles, commentsStripped } from "@/lib/__tests__/_source-scan";

const RUNG_DOOR = "src/components/icons/icon-stroke.ts";
const CARET_DOOR = "src/components/icons/MenuCaret.tsx";

/** Repo-relative paths (`trackedFiles` answers absolute ones). */
const SOURCES = trackedFiles("src", /\.tsx?$/)
  .map((abs) => path.relative(REPO_ROOT, abs))
  .filter((p) => !p.includes("/__tests__/") && !/\.test\.tsx?$/.test(p));

const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

/** `strokeWidth="2.5"`, `strokeWidth={2.5}`, `stroke-width="2.5"`, `strokeWidth: 2.5`. */
const RUNG_LITERAL = /stroke(?:Width|-width)\s*[=:]\s*(?:\{\s*)?["']?2\.5\b/;
const CARET_POINTS = /6 9 12 15 18 9/;

describe("ICON STROKE RUNG CENSUS", () => {
  it("the population is real", () => {
    expect(SOURCES.length).toBeGreaterThan(200);
    expect(SOURCES).toContain(RUNG_DOOR);
    expect(SOURCES).toContain(CARET_DOOR);
  });

  it("no bare 2.5 stroke literal outside icon-stroke.ts", () => {
    const hits = SOURCES.filter((p) => p !== RUNG_DOOR).filter((p) =>
      RUNG_LITERAL.test(commentsStripped(read(p))),
    );
    expect(hits, "import ICON_STROKE_SMALL from src/components/icons/icon-stroke").toEqual([]);
  });

  it("the popout glyph's lines inherit the svg's one stroke weight", () => {
    const src = commentsStripped(read("src/components/panel-primitives.tsx"));
    const inner = src.slice(
      src.indexOf("function popoutSvgInner"),
      src.indexOf("function popoutStroke"),
    );
    expect(inner.length).toBeGreaterThan(0);
    expect(inner).not.toMatch(/stroke-width/);
  });

  it("the menu caret polyline has one speller (MenuCaret)", () => {
    const hits = SOURCES.filter((p) => CARET_POINTS.test(commentsStripped(read(p))));
    expect(hits).toEqual([CARET_DOOR]);
  });
});
