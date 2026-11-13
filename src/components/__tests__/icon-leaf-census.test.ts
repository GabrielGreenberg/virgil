/**
 * ICON LEAF CENSUS (task 2026-11-13-1612).
 *
 * STYLE_GUIDE → "Icons" names shared glyph leaves and states the stroke rules,
 * but nothing read them, so copies kept appearing: the Library list row
 * hand-drew the open-as-tab box-with-arrow, three surfaces drew their own
 * two-sheets copy mark (two visibly different), a dozen buttons drew their own
 * close "×" (and the tab strip had a second shared X), and the MenuBar group
 * row drew an 8-grid chevron with no `width`, so the small stroke rung — which
 * keys on `svg[width=…]` — missed it. This census makes the rules read:
 *
 *  1. A shared leaf's path data has ONE speller: the leaf. A surface that wants
 *     the mark renders `ExternalLinkIcon` / `CopyIcon` / `CloseIcon`.
 *  2. Every inline `<svg>` that strokes declares a `width` attribute — the
 *     small-rung selector (globals.css "One line weight") keys on it, so a glyph
 *     sized only by a class silently draws at the large weight.
 *  3. A glyph declares its stroke ONCE, on the outer `<svg>`: no child element
 *     carries a `strokeWidth` of its own (an own-weight glyph excepted by name).
 *  4. A `strokeWidth` literal is a rung (`icon-stroke.ts`: 2, or the imported
 *     constants). The off-rung literals that predate this census are a
 *     RATCHET, by file: the count may only go down, and the table must follow.
 *
 * Population: every tracked `.ts`/`.tsx` under `src/` and `library/`, tests
 * excluded.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, trackedFiles, commentsStripped } from "@/lib/__tests__/_source-scan";

const SOURCES = [...trackedFiles("src", /\.tsx?$/), ...trackedFiles("library", /\.tsx?$/)]
  .map((abs) => path.relative(REPO_ROOT, abs))
  .filter((p) => !p.includes("/__tests__/") && !/\.test\.tsx?$/.test(p));

const read = (rel: string) => commentsStripped(readFileSync(path.join(REPO_ROOT, rel), "utf8"));

/** Each leaf's path data → the one file allowed to spell it. */
const LEAVES: { name: string; door: string; signature: RegExp; allowed?: Record<string, string> }[] = [
  {
    name: "ExternalLinkIcon",
    door: "src/components/icons/ExternalLinkIcon.tsx",
    signature: /M18 13v6a2 2 0 0 1-2 2H5/,
  },
  {
    name: "CopyIcon",
    door: "src/components/icons/CopyIcon.tsx",
    signature: /M5 15H4a2 2 0 0 1-2-2V4/,
  },
  {
    name: "CloseIcon",
    door: "src/components/icons/CloseIcon.tsx",
    // the two diagonals of a 24-grid "×", as lines or as one path
    signature: /x1=["']18["']\s+y1=["']6["']\s+x2=["']6["']\s+y2=["']18["']|x1=["']6["']\s+y1=["']6["']\s+x2=["']18["']\s+y2=["']18["']|M\s*6 6\s*l\s*12 12|M\s*18 6\s*L\s*6 18|M\s*18 6 6 18/,
    allowed: {
      "src/components/panel-primitives.tsx":
        "the popout button's vanilla-DOM glyph: its × is the popped STATE of one morphing svg, built as a string",
    },
  },
];

/** An inline svg open tag: attrs may hold `{…}` expressions (no nested braces). */
const SVG_OPEN = /<svg\b((?:[^>{]|\{[^}]*\})*)>/g;
const STROKES = (attrs: string) => /(?<![\w-])stroke\s*=/.test(attrs) && !/(?<![\w-])stroke\s*=\s*["']none["']/.test(attrs);
const HAS_WIDTH = (attrs: string) => /(?<![\w-])width\s*=/.test(attrs);

const CHILD_STROKE = /<(?:path|line|polyline|polygon|circle|ellipse|rect|g)\b(?:[^>{]|\{[^}]*\})*?(?<![\w-])(?:strokeWidth|stroke-width)\s*=/g;
/** Own-weight glyphs (`data-icon-weight="own"`) whose child carries the weight by design. */
const CHILD_STROKE_OWN: Record<string, string> = {
  "src/components/chrome/FolderTabChrome.tsx": "the folder-tab outline is drawn chrome, a 1px hairline, not an icon",
  "src/components/CheckSquare.tsx": "a checkbox: the box and the tick are two weights by design",
  "src/components/icons/RadioMark.tsx": "a radio: ring and dot are two weights by design",
  "src/components/editor-layout/panel-icons.tsx": "the request ring: each arc carries its own weight and opacity",
};

/** A numeric stroke literal in JSX, a vanilla attribute, or a style object. */
const STROKE_LITERAL = /stroke(?:Width|-width)\s*[=:]\s*\{?\s*["']?(\d+(?:\.\d+)?)/g;
const RUNG_LITERALS = new Set(["2"]);

/**
 * Off-rung `strokeWidth` literals that predate the census, by file (task 1612
 * ratchet: 73 at landing, down from 87 once the members moved onto leaves).
 * Moving a glyph onto a rung lowers its file's count — lower the number here.
 */
const OFF_RUNG_BASELINE: Record<string, number> = {
  "src/components/editor-layout/panel-icons.tsx": 15,
  "src/components/ActionsMenuPanel.tsx": 8,
  "src/panels/Outline/OutlinePanel.tsx": 4,
  "src/components/TabPlusMenu.tsx": 3,
  "src/components/EditorPane.tsx": 3,
  "src/components/EditorLayout.tsx": 3,
  "src/components/DocumentInterruptionBanner.tsx": 3,
  "src/components/TexFilePickerModal.tsx": 2,
  "src/components/SourcePodNodeView.tsx": 2,
  "src/components/SkillSyncControls.tsx": 2,
  "src/components/MenuBar.tsx": 2,
  "src/components/ExternalChangeBadge.tsx": 2,
  "src/components/BibEntryCard.tsx": 2,
  "src/components/AIWindow.tsx": 2,
  "library/components/LeftListRow.tsx": 2,
  "src/panels/Search/SearchPanel.tsx": 1,
  "src/components/stack/StackIcon.tsx": 1,
  "src/components/library/BibEntryPickerMenu.tsx": 1,
  "src/components/editor-layout/StatusCluster.tsx": 1,
  "src/components/editor-layout/BarMoreMenu.tsx": 1,
  "src/components/chrome/FolderTabChrome.tsx": 1,
  "src/components/SoftwareUpdateBanner.tsx": 1,
  "src/components/SaveStateBadge.tsx": 1,
  "src/components/RecentPapersList.tsx": 1,
  "src/components/PreservationNoticeBadge.tsx": 1,
  "src/components/MirrorRecoveryBadge.tsx": 1,
  "src/components/FontPicker.tsx": 1,
  "src/components/CoworkPenBadge.tsx": 1,
  "src/components/CompileLogDisclosure.tsx": 1,
  "src/components/CheckSquare.tsx": 1,
  "src/components/BugReportWindow.tsx": 1,
  "src/components/BarModeChips.tsx": 1,
  "library/components/LibraryView.tsx": 1,
};

function offRung(src: string): number {
  return [...src.matchAll(STROKE_LITERAL)].filter((m) => !RUNG_LITERALS.has(m[1])).length;
}

function widthlessStrokedSvgs(src: string): string[] {
  return [...src.matchAll(SVG_OPEN)]
    .filter((m) => STROKES(m[1]) && !HAS_WIDTH(m[1]))
    .map((m) => m[0].replace(/\s+/g, " ").slice(0, 100));
}

describe("ICON LEAF CENSUS", () => {
  it("the population is real", () => {
    expect(SOURCES.length).toBeGreaterThan(200);
    for (const leaf of LEAVES) expect(SOURCES).toContain(leaf.door);
    expect(SOURCES.some((p) => p.startsWith("library/"))).toBe(true);
  });

  it("canaries: each needle sees its pre-fix shape", () => {
    // task 1612's members, as they were
    const listRow = `<svg width="14" height="14" viewBox="0 0 24 24" stroke="currentColor"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>`;
    expect(LEAVES[0].signature.test(listRow)).toBe(true);
    expect(LEAVES[2].signature.test(`<line x1="18" y1="6" x2="6" y2="18" />`)).toBe(true);
    expect(LEAVES[2].signature.test(`<path d="M6 6l12 12M18 6L6 18" />`)).toBe(true);
    const menuBar = `<svg className="w-3 h-3 text-ink-muted" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2.5 1L5.5 4L2.5 7" /></svg>`;
    expect(widthlessStrokedSvgs(menuBar)).toHaveLength(1);
    expect(widthlessStrokedSvgs(`<svg width={size} stroke="currentColor"><path d="M1 1" /></svg>`)).toEqual([]);
    expect(widthlessStrokedSvgs(`<svg viewBox="0 0 8 8" fill="currentColor" stroke="none"><circle r="1" /></svg>`)).toEqual([]);
    expect([...`<line x1="6.5" y1="4" x2="13" y2="4" stroke="currentColor" strokeWidth="1.3" />`.matchAll(CHILD_STROKE)]).toHaveLength(1);
    expect([...`<svg strokeWidth="2"><line x1="3" /></svg>`.matchAll(CHILD_STROKE)]).toHaveLength(0);
    expect(offRung(`strokeWidth="1.5" strokeWidth={ICON_STROKE} strokeWidth="2" stroke-width="1.8"`)).toBe(2);
  });

  it("a shared leaf's path data has one speller: the leaf", () => {
    const offenders: string[] = [];
    for (const leaf of LEAVES) {
      for (const file of SOURCES) {
        if (file === leaf.door || leaf.allowed?.[file]) continue;
        if (leaf.signature.test(read(file))) offenders.push(`${file}: hand-drawn copy — render <${leaf.name}>`);
      }
      for (const file of Object.keys(leaf.allowed ?? {})) {
        expect(leaf.signature.test(read(file)), `${file}: allowlisted for ${leaf.name} but no longer draws it`).toBe(true);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every stroked inline svg declares a width (the small rung keys on it)", () => {
    const offenders = SOURCES.flatMap((file) => widthlessStrokedSvgs(read(file)).map((t) => `${file}: ${t}`));
    expect(offenders, "add width/height attributes (or render a shared leaf with `size`)").toEqual([]);
  });

  it("no child element overrides its svg's stroke weight", () => {
    const offenders: string[] = [];
    for (const file of SOURCES) {
      const n = [...read(file).matchAll(CHILD_STROKE)].length;
      if (n > 0 && !CHILD_STROKE_OWN[file]) offenders.push(`${file}: ${n} child strokeWidth — declare it once, on the <svg>`);
    }
    expect(offenders).toEqual([]);
    for (const file of Object.keys(CHILD_STROKE_OWN)) {
      expect(read(file)).toContain('data-icon-weight="own"');
    }
  });

  it("off-rung stroke literals only go down (ratchet)", () => {
    const drift: string[] = [];
    const seen = new Set<string>();
    for (const file of SOURCES) {
      const n = offRung(read(file));
      if (n === 0) continue;
      seen.add(file);
      const base = OFF_RUNG_BASELINE[file] ?? 0;
      if (n > base) drift.push(`${file}: ${n} off-rung strokeWidth literal(s) (baseline ${base}) — use ICON_STROKE / ICON_STROKE_SMALL`);
      if (n < base) drift.push(`${file}: ${n} off-rung (baseline ${base}) — lower OFF_RUNG_BASELINE`);
    }
    for (const file of Object.keys(OFF_RUNG_BASELINE)) {
      if (!seen.has(file)) drift.push(`${file}: now 0 off-rung — delete its OFF_RUNG_BASELINE row`);
    }
    expect(drift).toEqual([]);
  });
});
