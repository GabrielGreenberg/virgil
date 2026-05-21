import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/react";
import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly as serializeBody } from "@/lib/latex-serializer";

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
    expect(figs[0].attrs?.caption).toBe("A schematic.");
    expect(figs[0].attrs?.label).toBe("fig:bands");
    expect(figs[0].attrs?.placement).toBe("[ht]");
    expect(figs[0].attrs?.starred).toBe(false);
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
