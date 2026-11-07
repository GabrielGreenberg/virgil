// Task 1510 — TeX skips spaces (and one line break) before a cite command's
// argument groups, so `\cites[p. 1]{a}\n  [p. 2]{b}` and `\citep [p.~3]{k}` are
// valid, compiling source. The cite reader required every `[`/`{` to ABUT, so
// the unread tail fell to the prose escape rung and a plain load-and-save
// rewrote it to `{[}p. 2{]}{b}` — the saved file cited only `a`. One rule,
// `skipArgumentSpaceAt` in the lexer, now answers "where does TeX probe for the
// next argument?" for both the scanner and the citation model.
import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/react";
import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly } from "@/lib/latex-serializer";
import { parseCiteCommand } from "@/lib/cite-command-model";
import { matchCiteCommandAt } from "@/lib/cite-commands";
import { skipArgumentSpaceAt } from "@/lib/latex-lexer";
import { richLatexToJson, richJsonToLatex } from "@/lib/footnote-content";

const wrap = (body: string) =>
  `\\documentclass{article}\\begin{document}\n${body}\n\\end{document}`;

function citations(node: JSONContent, out: string[] = []): string[] {
  if (node.type === "citation") out.push(String(node.attrs?.command));
  for (const c of node.content ?? []) citations(c, out);
  return out;
}

/** The serialized body with the parser's `\vcid{…}` id stamps removed. */
const saved = (doc: JSONContent) =>
  serializeBodyOnly(doc).replace(/\\vcid\{[^}]*\}/g, "").trim();

describe("task 1510 — the cite reader skips TeX's argument space", () => {
  it.each([
    ["See \\cites[p. 1]{a}\n  [p. 2]{b} here.", "\\cites[p. 1]{a}\n  [p. 2]{b}", ["a", "b"]],
    ["See \\cites[p. 1]{a} [p. 2]{b} here.", "\\cites[p. 1]{a} [p. 2]{b}", ["a", "b"]],
    ["See \\citep [p.~3]{k} here.", "\\citep [p.~3]{k}", ["k"]],
    ["See \\citep[see] [p.~3] {k} here.", "\\citep[see] [p.~3] {k}", ["k"]],
    ["See \\cites{a}%\n  {b} here.", "\\cites{a}%\n  {b}", ["a", "b"]],
  ])("%j is ONE citation carrying every key, and saves byte-identical", (src, cmd, keys) => {
    const doc = parseLatex(wrap(src));
    expect(citations(doc)).toEqual([cmd]);
    expect(parseCiteCommand(cmd)!.keys).toEqual(keys);
    expect(saved(doc)).toBe(src);
  });

  it("a singular cite stops after its one unit: `\\citep{k} [sic]` keeps `[sic]` as prose", () => {
    const m = matchCiteCommandAt("\\citep{k} [sic]", 0)!;
    expect(m.command).toBe("\\citep{k}");
  });

  it("a repeat form gives back the gap and an incomplete unit", () => {
    expect(matchCiteCommandAt("\\cites{a} [sic] more", 0)!.command).toBe("\\cites{a}");
    expect(matchCiteCommandAt("\\cites{a} more", 0)!.command).toBe("\\cites{a}");
  });

  it("a blank line is a \\par and ends the run", () => {
    expect(matchCiteCommandAt("\\cite{a}\n\n[b]{c}", 0)!.command).toBe("\\cite{a}");
    expect(matchCiteCommandAt("\\cites{a}\n\n[b]{c}", 0)!.command).toBe("\\cites{a}");
    expect(matchCiteCommandAt("\\cites{a}%\n\n{c}", 0)!.command).toBe("\\cites{a}");
    // A bare head before a blank line takes nothing from the next paragraph.
    expect(matchCiteCommandAt("\\citep\n\n{k}", 0)!.keyed).toBe(false);
  });

  it("the footnote/card fork reads the same, via the shared scanner", () => {
    const src = "see \\cites[p. 1]{a}\n  [p. 2]{b} there";
    const json = richLatexToJson(src);
    expect(citations(json)).toEqual(["\\cites[p. 1]{a}\n  [p. 2]{b}"]);
    // A card body is written as ONE inline run (its whitespace collapses, by
    // design — TeX reads the two spellings alike); the citation keeps both keys.
    const out = richJsonToLatex(json).replace(/\\vcid\{[^}]*\}/g, "");
    expect(out).toBe("see \\cites[p. 1]{a} [p. 2]{b} there");
    expect(citations(richLatexToJson(out))).toEqual(["\\cites[p. 1]{a} [p. 2]{b}"]);
  });

  it("skipArgumentSpaceAt: one newline, never a blank line; comments only on request", () => {
    expect(skipArgumentSpaceAt("x  \t[", 1)).toBe(4);
    expect(skipArgumentSpaceAt("x \n  [", 1)).toBe(5);
    expect(skipArgumentSpaceAt("x \n \n[", 1)).toBe(4);
    expect(skipArgumentSpaceAt("x %c\n  [", 1)).toBe(2);
    expect(skipArgumentSpaceAt("x %c\n  [", 1, { comments: true })).toBe(7);
    expect(skipArgumentSpaceAt("x\n%c\n  [", 1, { comments: true })).toBe(7);
    expect(skipArgumentSpaceAt("x %c\n\n[", 1, { comments: true })).toBe(5);
  });
});
