import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, strip, trackedFiles } from "@/lib/__tests__/_source-scan";

/**
 * UI TYPE SIZES — integer px rungs, no half-pixel strays (task 1414).
 *
 * The rule (STYLE_GUIDE "In-card type scale" + "UI sizes are integer px"):
 * every named UI size is a whole pixel — META 10, CONTENT 12, PanelHeader 11,
 * Button sm 12 / md 13, chips 9–10. A `text-[10.5px]` is a value nobody chose
 * from the ladder; before this census five of them (prefs dialog, bib picker)
 * survived because the class guards (`card-ui-consistency`,
 * `section-caption-census`) check WHICH class a label wears and
 * `font-vocabulary` checks only the family — nothing read the size.
 *
 * Legs: a FRACTIONAL px font size fails in
 *  - Tailwind arbitrary values  `text-[10.5px]`
 *  - inline style objects       `fontSize: "13.5px"` / `fontSize: 12.5`
 *  - CSS (stylesheets AND css-in-string)  `font-size: 15.5px`
 * outside the stated-exemption allowlist below. rem/em sizes are out of
 * scope (em inside inline atoms is relative on purpose); editor/reader sizes
 * that are user preferences read a var and never match.
 */

const STYLESHEETS = ["src/app/globals.css", "library/styles/library.css"];

/** Kept half-pixel sizes, with the reason. Key: `<file>|<matched literal>`.
 *  Both are READING text (a document body), not UI chrome. */
const ALLOW: Record<string, string> = {
  "src/components/CodeEditor.tsx|fontSize: \"13.5px\"":
    "code-pane body text — between Button md 13px and editor prose on purpose",
  "library/styles/library.css|font-size: 15.5px": "Library Reader prose body size",
};

const FRACTIONAL_SIZE = [
  // Tailwind arbitrary text size: text-[10.5px] (any variant prefix).
  /\btext-\[\d*\.\d+px\]/g,
  // Inline style object: fontSize: "13.5px" | fontSize: 12.5
  /\bfontSize:\s*(?:["'`]\d*\.\d+px["'`]|\d*\.\d+\b)/g,
  // CSS declaration, in a stylesheet or a css string.
  /\bfont-size:\s*\d*\.\d+px/g,
];

function violations(rel: string, src: string): string[] {
  const hits: string[] = [];
  const at = (i: number) => src.slice(0, i).split("\n").length;
  for (const re of FRACTIONAL_SIZE) {
    for (const m of src.matchAll(re)) {
      if (ALLOW[`${rel}|${m[0]}`]) continue;
      hits.push(`${rel}:${at(m.index)} ${m[0]}`);
    }
  }
  return hits;
}

function sourceFiles(): string[] {
  return ["src", "library"]
    .flatMap((r) => trackedFiles(r, /\.tsx?$/))
    .filter((f) => !/(__tests__|\.test\.tsx?$)/.test(f));
}

/** Strings kept, comments blanked, line-aligned. */
const scanView = (src: string) => strip(src, true, true);

/** CSS comments blanked (line-aligned) so prose mentioning a size can't fire. */
const cssView = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));

/** The five UI sizes (STYLE_GUIDE "Typography"). */
const UI_RUNGS = new Set([11, 12, 13, 15, 20]);

/** A px size off the ladder, with the reason. Key: `<file>|<matched literal>`. */
const OFF_LADDER: Record<string, string> = {
  "src/components/ActionsMenuPanel.tsx|fontSize: 14": "the A colour tile: a glyph drawn as an icon",
  "library/components/LeftList.tsx|fontSize: 8": "decorative ▾",
  "library/components/PaperAiRequestsMenu.tsx|fontSize: 9": "decorative ▾",
  "library/components/LibrariesNavigator.tsx|fontSize: 16": "the + glyph on an icon button",
  "library/components/RowMenu.tsx|fontSize: 16": "the ⋮ glyph on an icon button",
  "library/components/panel-tabs/PanelTabStrip.tsx|fontSize: 18": "the + glyph on the new-tab button",
  "library/components/LibraryFolderGate.tsx|fontSize: 22": "onboarding gate: serif display title",
  "library/components/LibraryPermissionGate.tsx|fontSize: 22": "onboarding gate: serif display title",
  "library/components/LibraryFolderPicker.tsx|fontSize: 32": "onboarding gate: serif display title",
};

const PX_SIZE = [
  /\btext-\[(\d+(?:\.\d+)?)px\]/g,
  /\bfontSize:\s*["'`]?(\d+(?:\.\d+)?)(?:px)?["'`]?(?=[,\s}])/g,
  /\bfont-size:\s*(\d+(?:\.\d+)?)px/g,
];

function offLadder(rel: string, src: string): string[] {
  const hits: string[] = [];
  const at = (i: number) => src.slice(0, i).split("\n").length;
  for (const re of PX_SIZE) {
    for (const m of src.matchAll(re)) {
      if (UI_RUNGS.has(Number(m[1])) && !m[0].startsWith("text-[")) continue;
      if (ALLOW[`${rel}|${m[0]}`] || OFF_LADDER[`${rel}|${m[0]}`]) continue;
      hits.push(`${rel}:${at(m.index)} ${m[0]}`);
    }
  }
  return hits;
}

const CAPITALS = [/\buppercase\b/g, /\btext-transform:\s*uppercase\b/g, /\btextTransform:\s*["']uppercase["']/g];

function capitals(rel: string, src: string): string[] {
  const at = (i: number) => src.slice(0, i).split("\n").length;
  return CAPITALS.flatMap((re) => [...src.matchAll(re)].map((m) => `${rel}:${at(m.index)} ${m[0]}`));
}

describe("the five UI sizes (STYLE_GUIDE \"Typography\")", () => {
  it("no .ts/.tsx ships a size off the ladder", () => {
    const hits = sourceFiles().flatMap((f) =>
      offLadder(path.relative(REPO_ROOT, f), scanView(readFileSync(f, "utf8"))),
    );
    expect(hits).toEqual([]);
  });

  it.each(STYLESHEETS)("%s: no px size off the ladder", (rel) => {
    expect(offLadder(rel, cssView(readFileSync(path.join(REPO_ROOT, rel), "utf8")))).toEqual([]);
  });

  it("no chrome sets its text in capitals", () => {
    const tsx = sourceFiles().filter((f) => f.endsWith(".tsx"));
    const hits = tsx.flatMap((f) =>
      capitals(path.relative(REPO_ROOT, f), scanView(readFileSync(f, "utf8"))),
    );
    const css = STYLESHEETS.flatMap((rel) =>
      capitals(rel, cssView(readFileSync(path.join(REPO_ROOT, rel), "utf8"))),
    );
    expect([...hits, ...css]).toEqual([]);
  });

  it("every off-ladder key still names a live site", () => {
    const stale = Object.keys(OFF_LADDER).filter((key) => {
      const [rel, literal] = key.split("|");
      return !readFileSync(path.join(REPO_ROOT, rel), "utf8").includes(literal);
    });
    expect(stale).toEqual([]);
  });

  it("the Tailwind ladder is owned, not inherited", () => {
    const css = readFileSync(path.join(REPO_ROOT, "src/app/globals.css"), "utf8");
    expect(css).toMatch(/--text-\*:\s*initial;/);
    for (const [name, px] of [["2xs", 11], ["xs", 12], ["sm", 13], ["base", 15], ["lg", 20]]) {
      expect(css).toMatch(new RegExp(`--text-${name}:\\s*${px}px;`));
    }
  });
});

describe("UI type-size census (task 1414)", () => {
  it("no .ts/.tsx ships a fractional-px font size", () => {
    const hits = sourceFiles().flatMap((f) =>
      violations(path.relative(REPO_ROOT, f), scanView(readFileSync(f, "utf8"))),
    );
    expect(hits).toEqual([]);
  });

  it.each(STYLESHEETS)("%s: no fractional-px font-size", (rel) => {
    expect(violations(rel, cssView(readFileSync(path.join(REPO_ROOT, rel), "utf8")))).toEqual([]);
  });

  it("every allowlist key still names a live site", () => {
    const stale = Object.keys(ALLOW).filter((key) => {
      const [rel, literal] = key.split("|");
      return !readFileSync(path.join(REPO_ROOT, rel), "utf8").includes(literal);
    });
    expect(stale).toEqual([]);
  });

  describe("self-check: each leg fires on a planted stray", () => {
    it("Tailwind", () => {
      expect(violations("x.tsx", `<i className="text-[10.5px] text-ink-muted" />`)).toHaveLength(1);
      expect(violations("x.tsx", `<i className="hover:text-[11.5px]" />`)).toHaveLength(1);
      expect(violations("x.tsx", `<i className="text-[10px]" />`)).toEqual([]);
    });
    it("inline", () => {
      expect(violations("x.tsx", `const s = { fontSize: "13.5px" };`)).toHaveLength(1);
      expect(violations("x.tsx", `const s = { fontSize: 12.5 };`)).toHaveLength(1);
      expect(violations("x.tsx", `const s = { fontSize: 12, lineHeight: 1.5 };`)).toEqual([]);
    });
    it("CSS", () => {
      expect(violations("x.css", `.a { font-size: 10.5px; }`)).toHaveLength(1);
      expect(violations("x.css", `.a { font-size: 0.68rem; }`)).toEqual([]);
      expect(violations("x.css", cssView(`/* was font-size: 10.5px */ .a { font-size: 10px; }`))).toEqual([]);
    });
    it("the allowlist exempts only its own file", () => {
      expect(violations("src/components/Other.tsx", `{ fontSize: "13.5px" }`)).toHaveLength(1);
    });
  });
});
