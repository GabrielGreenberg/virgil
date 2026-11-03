// Task 1434 — the figure chrome reads `\includegraphics` by TeX's argument
// grammar, through ONE reader the display and every writer share, and owns a
// width only when the width it writes is the width the PDF prints.
import { describe, expect, it } from "vitest";
import {
  canEditWidthInOptions,
  extractFigureAttrs,
  extractFigureSources,
  figureGraphicsTarget,
  liveIncludegraphicsMatches,
  setWidthInOptions,
  withFigureGraphicsEdit,
  withInsertedFigureGraphics,
  withReplacedFigurePath,
  withUpdatedFigureWidth,
} from "@/lib/figures/parse-attrs";

describe("width ownership (member 1): the chrome never writes a width that prints otherwise", () => {
  const table: Array<[options: string, owned: boolean, after60: string | null]> = [
    ["", true, "width=0.6\\textwidth"],
    ["clip", true, "width=0.6\\textwidth,clip"],
    ["width=0.5\\textwidth", true, "width=0.6\\textwidth"],
    ["scale=0.3", false, null],
    ["height=3cm", false, null],
    ["totalheight=3cm", false, null],
    ["width=0.5\\textwidth,scale=2", false, null],
    ["width=0.5\\textwidth,height=2cm", false, null],
    // graphicx applies keys in order: an angle after the width rotates the
    // sized box, so the printed width is not the written one.
    ["width=0.5\\textwidth,angle=90", false, null],
    ["angle=90,width=0.5\\textwidth", true, "angle=90,width=0.6\\textwidth"],
    // No width yet + an angle: the new width lands AFTER it.
    ["angle=90", true, "angle=90,width=0.6\\textwidth"],
    ["angle=90 % turned\n", true, "angle=90,width=0.6\\textwidth % turned\n"],
    // A commented-out sizing key is not live.
    ["% scale=2\nclip", true, "width=0.6\\textwidth,% scale=2\nclip"],
    // The obsolete bbox form — two option groups.
    ["0,0][100,100", false, null],
  ];
  for (const [options, owned, after60] of table) {
    it(`[${JSON.stringify(options)}] → owned=${owned}`, () => {
      expect(canEditWidthInOptions(options)).toBe(owned);
      const r = setWidthInOptions(options, 60);
      expect(r.ok).toBe(owned);
      expect(r.ok ? r.options : null).toBe(after60);
    });
  }

  it("a refused width leaves the command byte-identical (mutator null)", () => {
    for (const cmd of [
      "\\includegraphics[scale=0.3]{a}",
      "\\includegraphics[height=3cm]{a}",
      "\\includegraphics[width=0.5\\textwidth,angle=90]{a}",
      "\\includegraphics[0,0][100,100]{a}",
    ]) {
      expect(withUpdatedFigureWidth(cmd, 60)).toBeNull();
    }
  });
});

describe("TeX whitespace between arguments (member 2)", () => {
  const spaced = [
    "\\includegraphics [width=0.5\\textwidth] {a}",
    "\\includegraphics\n  [width=0.5\\textwidth]\n  {a}",
    "\\includegraphics[width=0.5\\textwidth]%\n  {a}",
    "\\includegraphics * [width=0.5\\textwidth] {a}",
  ];
  for (const cmd of spaced) {
    it(`reads and edits ${JSON.stringify(cmd)} in place`, () => {
      const [src] = extractFigureSources(`  \\centering\n  ${cmd}\n`);
      expect(src?.path).toBe("a");
      expect(src?.widthPercent).toBe(50);
      // Only the value changes; the author's spacing survives.
      expect(withUpdatedFigureWidth(cmd, 70)).toBe(cmd.replace("0.5", "0.7"));
      expect(withReplacedFigurePath(cmd, "b")).toBe(cmd.replace("{a}", "{b}"));
    });
  }

  it("a width-less spaced command gains its option group after the head", () => {
    expect(withUpdatedFigureWidth("\\includegraphics {a}", 60)).toBe(
      "\\includegraphics[width=0.6\\textwidth] {a}",
    );
    expect(withUpdatedFigureWidth("\\includegraphics* {a}", 60)).toBe(
      "\\includegraphics*[width=0.6\\textwidth] {a}",
    );
  });

  it("a blank line is \\par — TeX stops looking for the argument", () => {
    expect(liveIncludegraphicsMatches("\\includegraphics\n\n{a}")).toEqual([]);
  });

  it("another macro sharing the prefix is not \\includegraphics", () => {
    expect(liveIncludegraphicsMatches("\\includegraphicsx{a}")).toEqual([]);
  });

  it("the picker on a spaced figure REPLACES the path — one image, not two", () => {
    const attrs = extractFigureAttrs(
      "  \\centering\n  \\includegraphics [width=.5\\textwidth] {old}\n  \\caption{C}\n",
    );
    expect(attrs.sources.map((s) => s.path)).toEqual(["old"]);
    const parts = { extras: attrs.extras, trailingExtras: attrs.trailingExtras };
    const next =
      withFigureGraphicsEdit(parts, (t) => withReplacedFigurePath(t, "new")) ??
      withInsertedFigureGraphics(parts, "new");
    expect(next).not.toBeNull();
    const all = `${next!.extras}${next!.trailingExtras}`;
    expect(liveIncludegraphicsMatches(all).map((m) => m.path)).toEqual(["new"]);
  });
});

describe("reader/writer agreement (members 3, 4)", () => {
  // Each fixture: the displayed sources[0] is the command the writer rewrites.
  const fixtures: string[] = [
    "  \\includegraphics[width=0.5\\textwidth]{a}\n  \\caption{C}\n",
    "  \\caption{C}\n  \\includegraphics[width=0.5\\textwidth]{a}\n",
    // An unparseable \includegraphics ahead of a real one: skipped by both.
    "  \\includegraphics[width=0.3\\textwidth]\n\n  \\includegraphics[width=0.5\\textwidth]{a}\n  \\caption{C}\n",
    // An inline icon in a caption-first figure is not the figure's image.
    "  \\caption{See \\includegraphics[height=1em]{icon}.}\n  \\includegraphics[width=0.5\\textwidth]{a}\n",
    "  \\includegraphics [width=0.5\\textwidth] {a}\n  \\caption{C}\n",
    "  % \\includegraphics[width=0.2\\textwidth]{draft}\n  \\includegraphics[width=0.5\\textwidth]{a}\n",
  ];
  for (const body of fixtures) {
    it(JSON.stringify(body), () => {
      const attrs = extractFigureAttrs(body);
      expect(attrs.sources[0]?.path).toBe("a");
      expect(attrs.widthPercent).toBe(50);
      const parts = { extras: attrs.extras, trailingExtras: attrs.trailingExtras };
      const target = figureGraphicsTarget(parts);
      expect(target).not.toBeNull();
      const next = withFigureGraphicsEdit(parts, (t) => withUpdatedFigureWidth(t, 70));
      expect(next).not.toBeNull();
      // The edit landed on the displayed command, and only there.
      const reread = [
        ...extractFigureSources(next!.extras),
        ...extractFigureSources(next!.trailingExtras),
      ];
      expect(reread[0]).toMatchObject({ path: "a", widthPercent: 70 });
      expect(next![target!].replace("0.7", "0.5")).toBe(parts[target!]);
    });
  }
});
