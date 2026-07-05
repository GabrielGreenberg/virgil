import { describe, expect, it } from "vitest";
import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly as serializeBody } from "@/lib/latex-serializer";
import type { JSONContent } from "@tiptap/core";

function parseBody(input: string) {
  const wrapped = `\\documentclass{article}\\begin{document}\n${input}\n\\end{document}`;
  return parseLatex(wrapped);
}

function findCodeBlocks(node: any, out: any[] = []): any[] {
  if (node.type === "codeBlock") out.push(node);
  if (node.content) for (const c of node.content) findCodeBlocks(c, out);
  return out;
}

function codeBlockText(node: any): string {
  return (node.content ?? []).map((c: any) => c.text ?? "").join("");
}

/** Serialize a single-codeBlock doc, then re-parse it, and return the recovered body. */
function roundTrip(body: string): { blocks: any[]; topLevel: number; text: string } {
  const doc: JSONContent = {
    type: "doc",
    content: [{ type: "codeBlock", content: [{ type: "text", text: body }] }],
  };
  const tex = serializeBody(doc);
  const reparsed = parseBody(tex);
  const blocks = findCodeBlocks(reparsed);
  return {
    blocks,
    topLevel: (reparsed.content ?? []).length,
    text: blocks.length ? codeBlockText(blocks[0]) : "",
  };
}

describe("verbatim codeBlock round-trip", () => {
  it("round-trips a simple body losslessly", () => {
    const { blocks, text } = roundTrip("const x = 1;\nconst y = 2;");
    expect(blocks).toHaveLength(1);
    expect(text).toBe("const x = 1;\nconst y = 2;");
  });

  // Member 1 — the destructive one. An embedded `\end{verbatim}` must NOT
  // truncate the block into sibling paragraphs.
  it("preserves an embedded \\end{verbatim} without truncating (member 1)", () => {
    const body = "line1\n\\end{verbatim}\nline2";
    const { blocks, topLevel, text } = roundTrip(body);
    expect(blocks).toHaveLength(1);
    expect(topLevel).toBe(1); // no leaked sibling paragraphs
    expect(text).toBe(body);
  });

  it("serializes an embedded \\end{verbatim} as the escaped sentinel", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          content: [{ type: "text", text: "a\n\\end{verbatim}\nb" }],
        },
      ],
    };
    const tex = serializeBody(doc);
    expect(tex).toContain("\\end{verbatim%!v-esc}");
    // Exactly one real terminator remains (the block's true close).
    expect(tex.match(/\\end\{verbatim\}/g)).toHaveLength(1);
  });

  // Symmetric latent cousin of member 1: a literal `\begin{verbatim}` in the
  // body would bump the old depth-counter and swallow the real close.
  it("preserves a literal \\begin{verbatim} in the body", () => {
    const body = "before\n\\begin{verbatim}\nafter";
    const { blocks, topLevel, text } = roundTrip(body);
    expect(blocks).toHaveLength(1);
    expect(topLevel).toBe(1);
    expect(text).toBe(body);
  });

  it("handles both delimiters embedded in one body", () => {
    const body = "x\n\\begin{verbatim}\ny\n\\end{verbatim}\nz";
    const { blocks, text } = roundTrip(body);
    expect(blocks).toHaveLength(1);
    expect(text).toBe(body);
  });

  // Member 2 — edge whitespace. Only the serializer's single wrapping `\n`
  // on each side is removed; no other whitespace change.
  it("preserves leading indentation on line 1 (member 2)", () => {
    const { text } = roundTrip("    indented();\nflush();");
    expect(text).toBe("    indented();\nflush();");
  });

  it("preserves a single trailing blank line (member 2)", () => {
    const { text } = roundTrip("code();\n");
    expect(text).toBe("code();\n");
  });

  it("preserves a leading blank line (member 2)", () => {
    const { text } = roundTrip("\ncode();");
    expect(text).toBe("\ncode();");
  });

  // The `\n{3,}` collapse in serializeBodyOnly must be verbatim-aware, or
  // interior double-blank-lines would be silently squashed each save.
  it("preserves multiple interior blank lines byte-faithfully", () => {
    const body = "def a():\n    pass\n\n\ndef b():\n    pass";
    const { text } = roundTrip(body);
    expect(text).toBe(body);
  });

  it("preserves trailing blank lines byte-faithfully", () => {
    const body = "code();\n\n\n";
    const { text } = roundTrip(body);
    expect(text).toBe(body);
  });

  it("round-trips the block UUID anchor", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { uuid: "ab12" },
          content: [{ type: "text", text: "keep();" }],
        },
      ],
    };
    const tex = serializeBody(doc);
    const blocks = findCodeBlocks(parseBody(tex));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].attrs?.uuid).toBe("ab12");
    expect(codeBlockText(blocks[0])).toBe("keep();");
  });

  it("parses a hand-written verbatim with no wrapping newlines", () => {
    // `\begin{verbatim}code\end{verbatim}` — no leading/trailing \n to strip.
    const blocks = findCodeBlocks(
      parseBody("\\begin{verbatim}code\\end{verbatim}"),
    );
    expect(blocks).toHaveLength(1);
    expect(codeBlockText(blocks[0])).toBe("code");
  });
});
