import { describe, expect, it } from "vitest";
import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly as serializeBody } from "@/lib/latex-serializer";
import type { JSONContent } from "@tiptap/react";

function parseBody(input: string) {
  const wrapped = `\\documentclass{article}\\begin{document}\n${input}\n\\end{document}`;
  return parseLatex(wrapped);
}

function findAll(doc: JSONContent, type: string): JSONContent[] {
  const out: JSONContent[] = [];
  function walk(n: JSONContent) {
    if (n.type === type) out.push(n);
    n.content?.forEach(walk);
  }
  walk(doc);
  return out;
}

function findFirst(doc: JSONContent, type: string): JSONContent | null {
  if (doc.type === type) return doc;
  for (const c of doc.content ?? []) {
    const f = findFirst(c, type);
    if (f) return f;
  }
  return null;
}

describe("graphicsBlock inside listItem / exampleItem", () => {
  it("parses \\includegraphics inside a bulletList item as a child graphicsBlock", () => {
    const tex = `\\begin{itemize}
  \\item A regular text item.
  \\item \\includegraphics[width=0.3\\textwidth]{figures/diagram}
  \\item Another text item.
\\end{itemize}`;
    const json = parseBody(tex);
    const items = findAll(json, "listItem");
    expect(items).toHaveLength(3);
    // The middle item should contain a graphicsBlock as one of its children.
    const middle = items[1];
    const graphics = (middle.content ?? []).filter(
      (c) => c.type === "graphicsBlock",
    );
    expect(graphics).toHaveLength(1);
  });

  it("parses \\includegraphics inside an expex \\a item as a child graphicsBlock", () => {
    const tex = `\\pex
\\a A regular text sub-item.
\\a \\includegraphics[width=0.3\\textwidth]{figures/diagram}
\\xe`;
    const json = parseBody(tex);
    const items = findAll(json, "exampleItem");
    expect(items).toHaveLength(2);
    const second = items[1];
    const graphics = (second.content ?? []).filter(
      (c) => c.type === "graphicsBlock",
    );
    expect(graphics).toHaveLength(1);
  });

  it("round-trips a graphicsBlock inside a listItem through parse → serialize → parse", () => {
    const original = `\\begin{itemize}
  \\item Some text.
  \\item \\includegraphics[width=0.3\\textwidth]{figures/diagram}
\\end{itemize}`;
    const parsed = parseBody(original);
    const serialized = serializeBody(parsed);
    expect(serialized).toContain("\\includegraphics");
    expect(serialized).toMatch(/\\begin\{itemize\}/);

    const reparsed = parseBody(serialized);
    const items = findAll(reparsed, "listItem");
    expect(items).toHaveLength(2);
    const graphicsInside = findFirst(items[1], "graphicsBlock");
    expect(graphicsInside).not.toBeNull();
  });
});
