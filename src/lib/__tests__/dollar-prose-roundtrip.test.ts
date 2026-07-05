import { describe, expect, it } from "vitest";
import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly } from "@/lib/latex-serializer";

// ─── helpers ────────────────────────────────────────────────────────────────

function parseBody(input: string) {
  const wrapped = `\\documentclass{article}\\begin{document}\n${input}\n\\end{document}`;
  return parseLatex(wrapped);
}

/** First paragraph's inline children. */
function firstParagraphContent(doc: any): any[] {
  const para = (doc.content || []).find((n: any) => n.type === "paragraph");
  return para?.content || [];
}

function makeDoc(text: string) {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  } as any;
}

// Task 2026-07-05-037 — literal `$` in prose is escaped symmetrically so it
// survives save→reload instead of being re-read as an inline-math delimiter.
describe("dollar-in-prose round-trip (serializer↔parser escape symmetry)", () => {
  it("a text node with bare `$`s serializes to `\\$` and re-parses to the SAME text node — no inlineMath", () => {
    const prose = "items cost $5, $10, and $15 each";
    const doc = makeDoc(prose);

    // Serialize: every bare `$` must be escaped to `\$`.
    const tex = serializeBodyOnly(doc);
    expect(tex).toContain("items cost \\$5, \\$10, and \\$15 each");
    expect(tex).not.toMatch(/(?<!\\)\$/); // no unescaped `$` leaked out

    // Reload: parses back to a single literal-`$` text node, no math atom.
    const reparsed = parseBody(tex);
    const inline = firstParagraphContent(reparsed);
    expect(inline.every((n) => n.type !== "inlineMath")).toBe(true);
    const roundtripped = inline.map((n) => n.text || "").join("");
    expect(roundtripped).toBe(prose);
  });

  it("a correctly-escaped on-disk `.tex` (`\\$`) parses to a literal-`$` text node AND re-serializes with `\\$` intact", () => {
    const onDisk = "items cost \\$5, \\$10, and \\$15 each";

    // Parse: `\$` → literal `$`, single text node, no math.
    const parsed = parseBody(onDisk);
    const inline = firstParagraphContent(parsed);
    expect(inline.every((n) => n.type !== "inlineMath")).toBe(true);
    expect(inline.map((n) => n.text || "").join("")).toBe(
      "items cost $5, $10, and $15 each",
    );

    // Re-serialize: the `\$` escaping is preserved (not emitted bare).
    const reserialized = serializeBodyOnly(parsed);
    expect(reserialized).toContain("items cost \\$5, \\$10, and \\$15 each");
    expect(reserialized).not.toMatch(/(?<!\\)\$/);
  });

  it("genuine inline math is untouched — a real `$x$` atom still serializes as bare `$…$`", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "cost " },
            { type: "inlineMath", attrs: { latex: "x^2" } },
            { type: "text", text: " here" },
          ],
        },
      ],
    } as any;
    const tex = serializeBodyOnly(doc);
    expect(tex).toContain("$x^2$"); // math delimiters stay bare
    expect(tex).not.toContain("\\$x"); // math was NOT escaped
  });

  it("`$` inside a code (\\texttt) span is escaped too (correct for compilation)", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "run ", marks: [] },
            { type: "text", text: "echo $PATH", marks: [{ type: "code" }] },
          ],
        },
      ],
    } as any;
    const tex = serializeBodyOnly(doc);
    expect(tex).toContain("\\texttt{echo \\$PATH}");
  });
});
