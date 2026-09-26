/**
 * Task 778 — a command TeX reads in HORIZONTAL mode does not end a paragraph.
 *
 * `readParagraph` used to ask the block-boundary question at every position, so
 * a mid-line `\hspace`, `\noindent` or inline `\includegraphics` ended the
 * paragraph, and the serializer wrote a blank line: a real `\par`, and a new
 * indented paragraph in the PDF, on OPEN. The vocabulary now has three tiers
 * (`latex-lexer.ts` → `BLOCK_BOUNDARY_TIERS`): commands that end a paragraph
 * wherever they appear, commands that are a block only ALONE on their line
 * (`\includegraphics`, `\hrulefill`), and horizontal commands that never are.
 */
import { describe, expect, it } from "vitest";
import { parseLatex, extractPreambleAndPostamble } from "@/lib/latex-parser";
import { serializeToLatex, assignUuids } from "@/lib/latex-serializer";
import { endsParagraphAt, startsBlockBoundary } from "@/lib/latex-lexer";

const PRE = "\\documentclass{article}\n\\begin{document}\n";
const POST = "\n\\end{document}\n";

function save(tex: string): string {
  const content = parseLatex(tex);
  assignUuids(content);
  return serializeToLatex(content, extractPreambleAndPostamble(tex) ?? undefined);
}

function body(tex: string): string {
  const start = tex.indexOf("\\begin{document}");
  const end = tex.indexOf("\\end{document}");
  return tex
    .slice(start + "\\begin{document}".length, end === -1 ? undefined : end)
    .replace(/[ \t]*%!v:[0-9a-f]{4}/g, "")
    .replace(/^\n+|\s+$/g, "");
}

function types(bodyIn: string): string[] {
  return (parseLatex(PRE + bodyIn + POST).content ?? []).map((n) => String(n.type));
}

function expectStable(bodyIn: string): void {
  const c1 = save(PRE + bodyIn + POST);
  const c2 = save(c1);
  expect(body(c2), "second save must not move the bytes").toBe(body(c1));
  expect(body(c1)).toBe(bodyIn.trim());
}

describe("task 778 — a mid-line horizontal command stays in its paragraph", () => {
  it.each([
    ["\\hspace", "Name: Jane\\hspace{2em}Date: today."],
    ["\\noindent", "Some text \\noindent more text."],
    ["inline \\includegraphics", "Click \\includegraphics[height=1em]{icon} here."],
    ["\\hrulefill leading a line with prose after it", "\\hrulefill\\quad Signature"],
    ["\\vspace", "Some text\\vspace{1em} more text."],
    ["a line-leading \\noindent inside a paragraph", "First line\n\\noindent second line."],
  ])("%s round-trips byte-identical as ONE paragraph", (_label, src) => {
    expect(types(src)).toEqual(["paragraph"]);
    expectStable(src);
  });

  it("a user macro \\hrulefillx is not read as a rule plus prose", () => {
    const src = "\\hrulefillx after";
    expect(types(src)).toEqual(["paragraph"]);
    expectStable(src);
  });
});

describe("task 778 — controls: a line-leading block construct still starts a block", () => {
  it("\\includegraphics alone on its line is a graphicsBlock", () => {
    expect(types("Before.\n\n\\includegraphics{fig}\n\nAfter.")).toEqual([
      "paragraph",
      "graphicsBlock",
      "paragraph",
    ]);
  });

  it("\\hrulefill alone on its line is a horizontalRule", () => {
    expect(types("Before.\n\n\\hrulefill\n\nAfter.")).toEqual([
      "paragraph",
      "horizontalRule",
      "paragraph",
    ]);
  });

  it("a \\section at a line start ends the paragraph above it", () => {
    expect(types("Prose.\n\\section{S}\nMore.")).toContain("heading");
  });

  it("a \\begin{figure} at a line start ends the paragraph above it", () => {
    const t = types("Prose.\n\\begin{figure}\n\\includegraphics{f}\n\\end{figure}");
    expect(t[0]).toBe("paragraph");
    expect(t.length).toBeGreaterThan(1);
  });

  it("\\includegraphics alone on a continuation line still breaks the paragraph", () => {
    expect(types("Prose.\n\\includegraphics{fig}")).toEqual(["paragraph", "graphicsBlock"]);
  });
});

describe("task 778 — the positional predicate", () => {
  it("line-block commands are boundaries only alone on their line", () => {
    expect(startsBlockBoundary("\\includegraphics{a}")).toBe(true);
    expect(startsBlockBoundary("\\includegraphics[width=2in]{a} %!v:ab12\nnext")).toBe(true);
    expect(startsBlockBoundary("\\includegraphics{a} here.")).toBe(false);
    expect(startsBlockBoundary("\\hrulefill\n")).toBe(true);
    expect(startsBlockBoundary("\\hrulefill\\quad x")).toBe(false);
    expect(startsBlockBoundary("\\hrulefillx")).toBe(false);
  });

  it("horizontal commands are never boundaries", () => {
    for (const s of ["\\hspace{1em}", "\\noindent x", "\\vspace{2pt}"]) {
      expect(startsBlockBoundary(s)).toBe(false);
    }
  });

  it("mid-line, only the anywhere tier ends a paragraph", () => {
    const src = "a \\section{x} b \\includegraphics{y}";
    expect(endsParagraphAt(src, src.indexOf("\\section"))).toBe(true);
    expect(endsParagraphAt(src, src.indexOf("\\includegraphics"))).toBe(false);
    const line = "a\n  \\includegraphics{y}\nb";
    expect(endsParagraphAt(line, line.indexOf("\\includegraphics"))).toBe(true);
  });
});
