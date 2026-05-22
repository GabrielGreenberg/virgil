import { describe, expect, it } from "vitest";
import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly as serializeBody, extractSidecarData } from "@/lib/latex-serializer";

function parseBody(input: string) {
  const wrapped = `\\documentclass{article}\\begin{document}\n${input}\n\\end{document}`;
  return parseLatex(wrapped);
}

function findTexBlocks(node: any, out: any[] = []): any[] {
  if (node.type === "texBlock") out.push(node);
  if (node.content) for (const c of node.content) findTexBlocks(c, out);
  return out;
}

describe("texBlock round-trip", () => {
  it("parses a single texBlock", () => {
    const input = `Before.

%!vtex:begin a4f1
\\begin{tikzpicture}
\\node at (0,0) {hi};
\\end{tikzpicture}
%!vtex:end a4f1

After.`;
    const json = parseBody(input);
    const blocks = findTexBlocks(json);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].attrs.uuid).toBe("a4f1");
    expect(blocks[0].attrs.code).toContain("tikzpicture");
    expect(blocks[0].attrs.code).toContain("\\node at (0,0) {hi};");
  });

  it("round-trips body verbatim", () => {
    const body = `\\begin{tikzpicture}\n\\node at (0,0) {hi};\n\\end{tikzpicture}`;
    const input = `%!vtex:begin abcd\n${body}\n%!vtex:end abcd\n\n`;
    const json = parseBody(input);
    const out = serializeBody(json);
    expect(out).toContain("%!vtex:begin abcd");
    expect(out).toContain("%!vtex:end abcd");
    expect(out).toContain(body);
  });

  it("handles an empty body", () => {
    const input = `%!vtex:begin abcd\n%!vtex:end abcd\n\n`;
    const json = parseBody(input);
    const blocks = findTexBlocks(json);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].attrs.code).toBe("");
  });

  it("treats a non-matching end uuid as part of the body", () => {
    const input = `%!vtex:begin aaaa\nstuff\n%!vtex:end bbbb\nmore stuff\n%!vtex:end aaaa\n\n`;
    const json = parseBody(input);
    const blocks = findTexBlocks(json);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].attrs.uuid).toBe("aaaa");
    expect(blocks[0].attrs.code).toContain("%!vtex:end bbbb");
    expect(blocks[0].attrs.code).toContain("more stuff");
  });

  it("does not recurse into nested \\begin{tikzpicture} environments in the body", () => {
    // The point: the parser must NOT try to interpret the body. The body
    // can contain arbitrary LaTeX including environments the editor
    // doesn't render — those should round-trip verbatim, not be tokenized.
    const body = `\\begin{tikzpicture}\n\\begin{scope}\n\\node {n};\n\\end{scope}\n\\end{tikzpicture}`;
    const input = `%!vtex:begin abcd\n${body}\n%!vtex:end abcd\n\n`;
    const json = parseBody(input);
    const blocks = findTexBlocks(json);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].attrs.code).toBe(body);
  });

  it("escapes %!vtex:end appearing inside the body across a round-trip", () => {
    const body = `Here is a sentinel: %!vtex:end abcd that should not terminate`;
    const json = {
      type: "doc",
      content: [
        { type: "texBlock", attrs: { uuid: "abcd", code: body } },
      ],
    };
    const tex = serializeBody(json);
    // The serializer must escape so the begin..end uuid pair survives.
    expect(tex).toContain("%!v tex:end abcd");
    // And the round trip recovers the original verbatim.
    const wrapped = `\\documentclass{article}\\begin{document}\n${tex}\\end{document}`;
    const reparsed = parseLatex(wrapped);
    const blocks = findTexBlocks(reparsed);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].attrs.code).toBe(body);
  });

  it("handles two adjacent texBlocks", () => {
    const input = `%!vtex:begin aaaa\nfirst\n%!vtex:end aaaa\n\n%!vtex:begin bbbb\nsecond\n%!vtex:end bbbb\n\n`;
    const json = parseBody(input);
    const blocks = findTexBlocks(json);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].attrs.code).toBe("first");
    expect(blocks[1].attrs.code).toBe("second");
  });

  it("collects collapsed into the sidecar when set on a texBlock", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "texBlock",
          attrs: {
            uuid: "c01a",
            code: "\\node {n};",
            collapsed: true,
          },
        },
      ],
    };
    const sidecar = extractSidecarData(doc);
    expect(sidecar.paragraphs.c01a).toBeDefined();
    expect(sidecar.paragraphs.c01a.collapsed).toBe(true);
  });

  it("omits collapsed from the sidecar when the texBlock is expanded", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "texBlock",
          attrs: {
            uuid: "c01b",
            code: "\\node {n};",
            collapsed: false,
          },
        },
      ],
    };
    const sidecar = extractSidecarData(doc);
    // The block has no title and no inline text content (atom), so it
    // shouldn't produce a sidecar entry at all when collapsed is false.
    expect(sidecar.paragraphs.c01b).toBeUndefined();
  });

  it("collects parTitle into the sidecar when set on a texBlock", () => {
    // The sidecar pipeline walks any node whose type carries a `uuid` attr
    // and has a `parTitle`. texBlock being in that set lets user-supplied
    // titles round-trip through .virgil/sidecar.yaml.
    const doc = {
      type: "doc",
      content: [
        {
          type: "texBlock",
          attrs: {
            uuid: "abcd",
            code: "\\node {n};",
            parTitle: "My TikZ snippet",
          },
        },
      ],
    };
    const sidecar = extractSidecarData(doc);
    expect(sidecar.paragraphs.abcd).toBeDefined();
    expect(sidecar.paragraphs.abcd.title).toBe("My TikZ snippet");
  });

  it("does not collide with %!v:xxxx paragraph anchors", () => {
    // Paragraph-anchor regex is /%!v:[0-9a-f]{4}/. Our prefix is %!vtex: —
    // distinct so this should never trigger the paragraph branch.
    const input = `Para one. %!v:1234\n\n%!vtex:begin abcd\nraw\n%!vtex:end abcd\n\nPara two. %!v:5678\n\n`;
    const json = parseBody(input);
    const blocks = findTexBlocks(json);
    expect(blocks).toHaveLength(1);
  });
});
