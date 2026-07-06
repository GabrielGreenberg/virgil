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

/** Flatten a paragraph's inline text (ignoring node kind). */
function firstParagraphText(doc: any): string {
  return firstParagraphContent(doc)
    .map((n: any) => n.text || "")
    .join("");
}

function makeDoc(content: any[]) {
  return {
    type: "doc",
    content: [{ type: "paragraph", content }],
  } as any;
}

function makeTextDoc(text: string) {
  return makeDoc([{ type: "text", text }]);
}

// Task 2026-07-05-046 — literal `[` / `]` in prose are escaped symmetrically as
// `{[}` / `{]}` so they survive save→reload instead of being re-read as a LaTeX
// OPTIONAL ARGUMENT (a `\\[len]` line-break length, or `\cmd[opt]` absorption).
// A direct clone of task 037 (the `$` twin). NOT `\[` (that starts display math).
describe("bracket-in-prose round-trip (serializer↔parser escape symmetry)", () => {
  it("freestanding prose `[`/`]` serialize to `{[}`/`{]}` and re-parse to the SAME text — no data loss, no `\\[`", () => {
    const prose = "see [note] and the interval [0, 1] here";
    const doc = makeTextDoc(prose);

    const tex = serializeBodyOnly(doc);
    expect(tex).toContain("see {[}note{]} and the interval {[}0, 1{]} here");
    // No bare `[` / `]` leaked (would be an unprotected optional-arg trap)…
    expect(tex).not.toMatch(/(?<!\{)\[(?!\})/);
    expect(tex).not.toMatch(/(?<!\{)\](?!\})/);
    // …and crucially never the destructive `\[` display-math form.
    expect(tex).not.toContain("\\[");

    const reparsed = parseBody(tex);
    expect(firstParagraphText(reparsed)).toBe(prose);
    // Nothing became math.
    expect(
      firstParagraphContent(reparsed).every((n) => n.type !== "inlineMath"),
    ).toBe(true);
  });

  it("a hard break (shift+enter) immediately followed by `[` survives — no `\\[…]` length-arg on disk (external-LaTeX safe)", () => {
    // The reported case: ONE paragraph with a hardBreak, next line starts `[`.
    const doc = makeDoc([
      { type: "text", text: "Paragraph here." },
      { type: "hardBreak" },
      { type: "text", text: "[Note to self.]" },
    ]);

    const tex = serializeBodyOnly(doc);
    // The hard break emits `\\`; the bracket must be brace-protected so the
    // on-disk `.tex` is `\\\n{[}Note…`, never the length-consuming `\\[Note…]`.
    expect(tex).toContain("{[}Note to self.{]}");
    expect(tex).not.toMatch(/\\\\\s*\[/);

    // Round-trips through Virgil with the bracketed text intact.
    const reparsed = parseBody(tex);
    expect(firstParagraphText(reparsed)).toBe(
      "Paragraph here.[Note to self.]",
    );
  });

  it("a `latexCommand` node immediately followed by `[literal]` keeps `[literal]` as literal prose (not absorbed into the command atom)", () => {
    const doc = makeDoc([
      { type: "text", text: "\\customcmd", marks: [{ type: "latexCommand" }] },
      { type: "text", text: "[literal]" },
    ]);

    const tex = serializeBodyOnly(doc);
    // Brace-protected, so the command can't swallow `[literal]` as an opt-arg.
    expect(tex).toContain("\\customcmd{[}literal{]}");

    const reparsed = parseBody(tex);
    const inline = firstParagraphContent(reparsed);
    // The command atom stays exactly `\customcmd` (no `[literal]` / `{[}` folded in)…
    const cmd = inline.find((n: any) =>
      (n.marks || []).some((m: any) => m.type === "latexCommand"),
    );
    expect(cmd?.text).toBe("\\customcmd");
    // …and `[literal]` survives as literal prose after it.
    expect(firstParagraphText(reparsed)).toBe("\\customcmd[literal]");
  });

  it("an on-disk `{[}`/`{]}` parses to literal `[`/`]` AND re-serializes with `{[}`/`{]}` intact (idempotent — no double-brace drift)", () => {
    const onDisk = "wrap {[}this{]} tightly";

    const parsed = parseBody(onDisk);
    expect(firstParagraphText(parsed)).toBe("wrap [this] tightly");
    expect(
      firstParagraphContent(parsed).every((n) => n.type !== "inlineMath"),
    ).toBe(true);

    // Re-serialize: exactly `{[}`/`{]}` again — the map is its own inverse.
    const reserialized = serializeBodyOnly(parsed);
    expect(reserialized).toContain("wrap {[}this{]} tightly");
    // Idempotent: no `{{[}}` growth.
    expect(reserialized).not.toContain("{{[}");
    expect(reserialized).not.toContain("{]}}");
  });

  it("genuine display math `\\[ … \\]` is untouched — still parses to a math atom, not a literal bracket", () => {
    const onDisk = "before \\[ x^2 + y^2 \\] after";
    const parsed = parseBody(onDisk);
    // `\[…\]` at a block boundary becomes a top-level displayMath node; the
    // point is that it is preserved as MATH (never collapsed to literal `[`/`]`
    // by the new prose-bracket unwrap, which only ever sees the `{[}` triple).
    const math: any = (parsed.content || []).find(
      (n: any) => n.type === "displayMath" || n.type === "inlineMath",
    );
    expect(math).toBeDefined();
    expect(math.attrs.latex).toBe("x^2 + y^2");
  });

  it("mid-paragraph inline math `\\( … \\)` is untouched — stays an inlineMath atom", () => {
    const parsed = parseBody("cost \\( x^2 \\) here");
    const inline = firstParagraphContent(parsed);
    const math = inline.find((n: any) => n.type === "inlineMath");
    expect(math).toBeDefined();
    expect(math.attrs.latex).toBe("x^2");
  });

  it("`[` inside a code (\\texttt) span is escaped too and round-trips to a literal `[` (correct for compilation)", () => {
    const doc = makeDoc([
      { type: "text", text: "run " },
      { type: "text", text: "arr[0]", marks: [{ type: "code" }] },
    ]);
    const tex = serializeBodyOnly(doc);
    expect(tex).toContain("\\texttt{arr{[}0{]}}");

    const reparsed = parseBody(tex);
    // The bracket survives as a literal inside the code span.
    expect(firstParagraphText(reparsed)).toContain("arr[0]");
  });
});
