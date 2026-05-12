import { describe, expect, it } from "vitest";
import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly as serializeBody } from "@/lib/latex-serializer";

function gather(node: any): string {
  let s = "";
  if (node.type === "text") s += node.text || "";
  if (node.type === "inlineMath") s += `$${node.attrs?.latex || ""}$`;
  if (node.content) for (const c of node.content) s += gather(c);
  return s;
}

function parseBody(input: string) {
  const wrapped = `\\documentclass{article}\\begin{document}\n${input}\n\\end{document}`;
  return parseLatex(wrapped);
}

describe("LaTeX double-quote round-trip", () => {
  it("renders `` and '' as curly quotes in the display", () => {
    const json = parseBody("He said ``hello world.'' Done.");
    const text = gather(json);
    expect(text).toContain("“hello world.”");
    expect(text).not.toContain("``");
  });

  it("serializes curly quotes back to `` and ''", () => {
    const json = parseBody("He said ``hello world.'' Done.");
    const out = serializeBody(json);
    expect(out).toContain("``hello world.''");
    expect(out).not.toContain("“");
    expect(out).not.toContain("”");
  });

  it("preserves a single apostrophe inside contractions", () => {
    const json = parseBody("It's cold outside.");
    const text = gather(json);
    expect(text).toContain("It's cold outside.");
  });

  it("treats triple backticks as pair + lone backtick", () => {
    const json = parseBody("```weird'''");
    const text = gather(json);
    expect(text).toContain("“`weird”'");
  });

  it("converts pairs inside \\textbf{...}", () => {
    const json = parseBody("\\textbf{``bold''} done");
    const text = gather(json);
    expect(text).toContain("“bold”");
    const out = serializeBody(json);
    expect(out).toContain("\\textbf{``bold''}");
  });

  it("round-trips: tex pair -> display -> tex pair", () => {
    const original = "Quoting ``the founder'' verbatim.";
    const json = parseBody(original);
    const out = serializeBody(json);
    expect(out).toContain("``the founder''");
  });

  it("smart quotes pasted into the doc serialize to `` and ''", () => {
    // Simulate: user pasted curly quotes directly. The parser sees them
    // as plain text (since the source file has the unicode chars). On
    // serialize, escapeLatex turns them into `` and ''.
    const json = parseBody("Quoting “the founder” verbatim.");
    const out = serializeBody(json);
    expect(out).toContain("``the founder''");
  });

  it("straight \" typed in the editor serializes to `` / '' by context", () => {
    // Build JSON directly to skip the parse step (the user typed " in the
    // editor; the JSON text node holds a plain ASCII double quote).
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: 'He said "this", and left.' }],
        },
      ],
    };
    const out = serializeBody(doc as any);
    expect(out).toContain("``this''");
    expect(out).not.toMatch(/"/);
  });

  it("straight \" at start of paragraph opens correctly", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: '"opening" at start.' }],
        },
      ],
    };
    const out = serializeBody(doc as any);
    expect(out).toContain("``opening''");
  });

  it("straight \" after opening parenthesis treats as opening", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: '(see "page 4")' }],
        },
      ],
    };
    const out = serializeBody(doc as any);
    expect(out).toContain("(see ``page 4'')");
  });
});
