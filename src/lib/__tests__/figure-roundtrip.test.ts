import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/react";
import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly as serializeBody } from "@/lib/latex-serializer";
import {
  canEditWidthInOptions,
  extractFigureAttrs,
  setWidthInOptions,
  withReplacedFigurePath,
  withUpdatedFigureWidth,
} from "@/lib/figures/parse-attrs";

function parseBody(input: string): JSONContent {
  const wrapped = `\\documentclass{article}\\begin{document}\n${input}\n\\end{document}`;
  return parseLatex(wrapped);
}

function findByType(node: JSONContent, type: string, out: JSONContent[] = []): JSONContent[] {
  if (node.type === type) out.push(node);
  if (node.content) for (const c of node.content) findByType(c, type, out);
  return out;
}

describe("figureBlock round-trip", () => {
  it("parses `\\begin{figure}` with caption + label", () => {
    const input = `Before.

\\begin{figure}[ht]
  \\centering
  \\includegraphics[width=0.6\\textwidth]{figures/fig1}
  \\caption{A schematic.}
  \\label{fig:bands}
\\end{figure}

After.`;
    const json = parseBody(input);
    const figs = findByType(json, "figureBlock");
    expect(figs).toHaveLength(1);
    expect(figs[0].attrs?.source).toBe("figures/fig1");
    expect(figs[0].attrs?.widthPercent).toBe(60);
    expect(figs[0].attrs?.label).toBe("fig:bands");
    expect(figs[0].attrs?.placement).toBe("[ht]");
    expect(figs[0].attrs?.starred).toBe(false);
    // Caption is now a child node, not a flat attr — assert against the
    // child's inline text content.
    const captions = findByType(figs[0], "figureCaption");
    expect(captions).toHaveLength(1);
    const captionText = (captions[0].content || [])
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");
    expect(captionText).toBe("A schematic.");
    // Parser-side numbering pass assigns figureNumber on first paint.
    expect(figs[0].attrs?.figureNumber).toBe(1);
  });

  it("recognises `\\begin{figure*}` starred variant", () => {
    const input = `\\begin{figure*}\n  \\includegraphics{x}\n\\end{figure*}\n`;
    const json = parseBody(input);
    const figs = findByType(json, "figureBlock");
    expect(figs).toHaveLength(1);
    expect(figs[0].attrs?.starred).toBe(true);
  });

  it("captures subfigures (multiple \\includegraphics in one env)", () => {
    const input = `\\begin{figure}
  \\includegraphics[width=0.3\\textwidth]{a}
  \\includegraphics[width=0.3\\textwidth]{b}
  \\caption{Side by side.}
\\end{figure}\n`;
    const json = parseBody(input);
    const figs = findByType(json, "figureBlock");
    expect(figs).toHaveLength(1);
    expect(figs[0].attrs?.sources).toHaveLength(2);
    const sources = figs[0].attrs?.sources as Array<{ path: string }>;
    expect(sources[0].path).toBe("a");
    expect(sources[1].path).toBe("b");
  });

  it("round-trips the figure env body verbatim", () => {
    const body = `\n  \\centering\n  \\includegraphics[width=0.6\\textwidth]{figures/fig1}\n  \\caption{A schematic.}\n  \\label{fig:bands}\n`;
    const input = `\\begin{figure}[ht]${body}\\end{figure}\n`;
    const json = parseBody(input);
    const out = serializeBody(json);
    expect(out).toContain("\\begin{figure}[ht]");
    expect(out).toContain("\\includegraphics[width=0.6\\textwidth]{figures/fig1}");
    expect(out).toContain("\\caption{A schematic.}");
    expect(out).toContain("\\label{fig:bands}");
    expect(out).toContain("\\end{figure}");
  });

  it("preserves \\begin{figure*} on serialize", () => {
    const input = `\\begin{figure*}\n  \\includegraphics{x}\n\\end{figure*}\n`;
    const json = parseBody(input);
    const out = serializeBody(json);
    expect(out).toContain("\\begin{figure*}");
    expect(out).toContain("\\end{figure*}");
  });

  it("round-trips a \\cite inside the caption as a structured node", () => {
    const input = `\\begin{figure}
  \\centering
  \\includegraphics[width=0.5\\textwidth]{plot}
  \\caption{See \\cite{foo} for context.}
  \\label{fig:plot}
\\end{figure}\n`;
    const json = parseBody(input);
    const captions = findByType(json, "figureCaption");
    expect(captions).toHaveLength(1);
    const captionNodes = captions[0].content || [];
    // Caption body should have split into text + citation + text.
    const citationNodes = captionNodes.filter((c) => c.type === "citation");
    expect(citationNodes).toHaveLength(1);
    // Serializing back should reproduce the \cite{} marker (vcid marker
    // prefix is acceptable — the citation node round-trips with a stable id).
    const out = serializeBody(json);
    // The serializer emits a \vcid{…} stable-id marker before the citation;
    // accept anything between "See " and "\cite{foo}" so the assertion
    // doesn't break when the marker changes shape.
    expect(out).toMatch(/\\caption\{See .*?\\cite\{foo\}/);
    expect(out).toContain("for context.");
    expect(out).toContain("\\label{fig:plot}");
  });

  it("captures the optional \\caption[short] list-of-figures argument", () => {
    const input = `\\begin{figure}
  \\includegraphics{img}
  \\caption[Short LoF text]{Full descriptive caption}
  \\label{fig:x}
\\end{figure}\n`;
    const json = parseBody(input);
    const figs = findByType(json, "figureBlock");
    expect(figs).toHaveLength(1);
    expect(figs[0].attrs?.shortCaption).toBe("Short LoF text");
  });

  it("round-trips \\caption[short]{long} re-emitting the [short] bracket byte-for-byte (task 263)", () => {
    const input = `\\begin{figure}
  \\includegraphics{img}
  \\caption[Short LoF text]{Full descriptive caption}
  \\label{fig:x}
\\end{figure}\n`;
    const json = parseBody(input);
    const out = serializeBody(json);
    expect(out).toContain("\\caption[Short LoF text]{Full descriptive caption}");
  });

  it("leaves a bracket-free \\caption{...} byte-identical (no spurious [] on serialize)", () => {
    const input = `\\begin{figure}
  \\includegraphics{img}
  \\caption{Plain caption}
\\end{figure}\n`;
    const json = parseBody(input);
    const figs = findByType(json, "figureBlock");
    expect(figs[0].attrs?.shortCaption).toBeNull();
    const out = serializeBody(json);
    expect(out).toContain("\\caption{Plain caption}");
    expect(out).not.toContain("\\caption[");
  });

  it("preserves an empty \\caption[]{long} bracket (opaque, not dropped)", () => {
    const input = `\\begin{figure}
  \\includegraphics{img}
  \\caption[]{Long body}
\\end{figure}\n`;
    const json = parseBody(input);
    const figs = findByType(json, "figureBlock");
    expect(figs[0].attrs?.shortCaption).toBe("");
    const out = serializeBody(json);
    expect(out).toContain("\\caption[]{Long body}");
  });

  // The popover re-extraction path (FigureBlockNodeView / EditorLayout
  // `updateFromText`) rebuilds figure attrs from the edited source via
  // `extractFigureAttrs`, so that seam must surface `shortCaption` for the
  // re-thread to pick up — else editing the `[short]` bracket in the popover
  // is silently ignored (task 263, popover edit path).
  it("extractFigureAttrs surfaces shortCaption for the popover re-extraction seam", () => {
    const withShort = extractFigureAttrs(
      `\n  \\includegraphics{img}\n  \\caption[LoF text]{Long body}\n`,
    );
    expect(withShort.shortCaption).toBe("LoF text");
    const withoutShort = extractFigureAttrs(
      `\n  \\includegraphics{img}\n  \\caption{Long body}\n`,
    );
    expect(withoutShort.shortCaption).toBeNull();
  });

  it("numbers multiple figures sequentially", () => {
    const input = `\\begin{figure}
  \\includegraphics{a}
  \\caption{First}
\\end{figure}

Some text.

\\begin{figure}
  \\includegraphics{b}
  \\caption{Second}
\\end{figure}\n`;
    const json = parseBody(input);
    const figs = findByType(json, "figureBlock");
    expect(figs).toHaveLength(2);
    expect(figs[0].attrs?.figureNumber).toBe(1);
    expect(figs[1].attrs?.figureNumber).toBe(2);
  });
});

describe("graphicsBlock (bare \\includegraphics) round-trip", () => {
  it("parses a standalone block-level \\includegraphics", () => {
    const input = `Before.

\\includegraphics[width=0.5\\textwidth]{figures/standalone}

After.`;
    const json = parseBody(input);
    const blocks = findByType(json, "graphicsBlock");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].attrs?.source).toBe("figures/standalone");
    expect(blocks[0].attrs?.widthPercent).toBe(50);
    expect(blocks[0].attrs?.command).toBe(
      "\\includegraphics[width=0.5\\textwidth]{figures/standalone}",
    );
  });

  it("parses \\includegraphics without options", () => {
    const input = `\\includegraphics{plain}\n`;
    const json = parseBody(input);
    const blocks = findByType(json, "graphicsBlock");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].attrs?.source).toBe("plain");
    expect(blocks[0].attrs?.widthPercent).toBeNull();
  });

  it("round-trips the command verbatim", () => {
    const input = `\\includegraphics[width=0.5\\textwidth]{figures/foo}\n`;
    const json = parseBody(input);
    const out = serializeBody(json);
    expect(out).toContain("\\includegraphics[width=0.5\\textwidth]{figures/foo}");
  });
});

describe("setWidthInOptions", () => {
  it("replaces an existing \\textwidth width", () => {
    expect(setWidthInOptions("width=0.5\\textwidth", 70)).toEqual({
      options: "width=0.7\\textwidth",
      ok: true,
    });
  });

  it("inserts a width when none is set", () => {
    expect(setWidthInOptions("", 60)).toEqual({
      options: "width=0.6\\textwidth",
      ok: true,
    });
    expect(setWidthInOptions("clip", 60)).toEqual({
      options: "width=0.6\\textwidth,clip",
      ok: true,
    });
  });

  it("refuses to rewrite absolute-unit widths", () => {
    expect(setWidthInOptions("width=5cm", 60).ok).toBe(false);
    expect(setWidthInOptions("width=5cm", 60).options).toBe("width=5cm");
    expect(setWidthInOptions("width=120pt,clip", 60).ok).toBe(false);
    expect(setWidthInOptions("width=2.5in", 60).ok).toBe(false);
  });

  it("preserves \\linewidth and \\columnwidth units", () => {
    expect(setWidthInOptions("width=0.5\\linewidth", 70).options).toBe(
      "width=0.7\\linewidth",
    );
    expect(setWidthInOptions("width=0.5\\columnwidth", 70).options).toBe(
      "width=0.7\\columnwidth",
    );
  });

  it("preserves other options around the width directive", () => {
    expect(
      setWidthInOptions("width=0.5\\textwidth,angle=45,clip", 70).options,
    ).toBe("width=0.7\\textwidth,angle=45,clip");
    expect(
      setWidthInOptions("angle=45,width=0.5\\textwidth,clip", 70).options,
    ).toBe("angle=45,width=0.7\\textwidth,clip");
  });

  it("formats fractions with no trailing zeros", () => {
    expect(setWidthInOptions("width=0.5\\textwidth", 35).options).toBe(
      "width=0.35\\textwidth",
    );
    expect(setWidthInOptions("width=0.5\\textwidth", 100).options).toBe(
      "width=1.0\\textwidth",
    );
  });
});

describe("canEditWidthInOptions", () => {
  it("returns true for empty or relative-unit options", () => {
    expect(canEditWidthInOptions("")).toBe(true);
    expect(canEditWidthInOptions("clip")).toBe(true);
    expect(canEditWidthInOptions("width=0.5\\textwidth")).toBe(true);
  });

  it("returns false for absolute-unit widths", () => {
    expect(canEditWidthInOptions("width=5cm")).toBe(false);
    expect(canEditWidthInOptions("width=120pt,clip")).toBe(false);
  });
});

describe("withUpdatedFigureWidth", () => {
  it("rewrites the width inside a graphicsBlock command", () => {
    expect(
      withUpdatedFigureWidth(
        "\\includegraphics[width=0.5\\textwidth]{figures/foo}",
        80,
      ),
    ).toBe("\\includegraphics[width=0.8\\textwidth]{figures/foo}");
  });

  it("rewrites the first \\includegraphics inside a figureBlock body", () => {
    const raw =
      "\n  \\centering\n  \\includegraphics[width=0.6\\textwidth]{figures/sample}\n  \\caption{x}\n";
    const out = withUpdatedFigureWidth(raw, 90);
    expect(out).toBe(
      "\n  \\centering\n  \\includegraphics[width=0.9\\textwidth]{figures/sample}\n  \\caption{x}\n",
    );
  });

  it("preserves the starred form", () => {
    expect(
      withUpdatedFigureWidth(
        "\\includegraphics*[width=0.5\\textwidth]{foo}",
        70,
      ),
    ).toBe("\\includegraphics*[width=0.7\\textwidth]{foo}");
  });

  it("preserves untouched options", () => {
    expect(
      withUpdatedFigureWidth(
        "\\includegraphics[width=0.5\\textwidth,angle=45,clip]{foo}",
        70,
      ),
    ).toBe("\\includegraphics[width=0.7\\textwidth,angle=45,clip]{foo}");
  });

  it("returns null for absolute-unit widths", () => {
    expect(
      withUpdatedFigureWidth("\\includegraphics[width=5cm]{foo}", 70),
    ).toBeNull();
  });

  it("returns null when no \\includegraphics is present", () => {
    expect(withUpdatedFigureWidth("\\caption{just a caption}", 70)).toBeNull();
  });

  it("inserts a width when the command has no options", () => {
    expect(withUpdatedFigureWidth("\\includegraphics{foo}", 60)).toBe(
      "\\includegraphics[width=0.6\\textwidth]{foo}",
    );
  });
});

describe("withReplacedFigurePath", () => {
  it("swaps the path argument and preserves the options", () => {
    expect(
      withReplacedFigurePath(
        "\\includegraphics[width=0.5\\textwidth,angle=45]{old}",
        "figures/new",
      ),
    ).toBe("\\includegraphics[width=0.5\\textwidth,angle=45]{figures/new}");
  });

  it("works on an empty-path stub", () => {
    expect(
      withReplacedFigurePath(
        "\\includegraphics[width=0.5\\textwidth]{}",
        "figures/foo.png",
      ),
    ).toBe("\\includegraphics[width=0.5\\textwidth]{figures/foo.png}");
  });

  it("targets only the first \\includegraphics in a figureBlock raw body", () => {
    const raw =
      "\n  \\includegraphics[width=0.3\\textwidth]{first}\n  \\includegraphics[width=0.3\\textwidth]{second}\n";
    const out = withReplacedFigurePath(raw, "swapped");
    expect(out).toBe(
      "\n  \\includegraphics[width=0.3\\textwidth]{swapped}\n  \\includegraphics[width=0.3\\textwidth]{second}\n",
    );
  });

  it("returns null when no \\includegraphics is present", () => {
    expect(withReplacedFigurePath("\\caption{none}", "x")).toBeNull();
  });
});
