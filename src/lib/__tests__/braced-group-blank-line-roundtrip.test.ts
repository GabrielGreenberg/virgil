// @vitest-environment jsdom
// Task 1018 — a braced argument that spans a blank line is ONE argument.
//
// LaTeX2e's `\@footnotetext` is `\long`, as are `\parbox`, `\textbf`,
// `\thanks` and a bare `{…}` group — a blank line inside them is a `\par`
// INSIDE the argument, and multi-paragraph footnotes are routine in humanities
// papers. Pre-1018 `readParagraph` broke at every blank line, so the
// paragraph ended inside the group: `\footnote` reached the inline parser with
// no closing brace and was demoted to a grey command, and the orphan `{` / `}`
// became PROSE, which the serializer escaped — `A\footnote\{One.\n\nTwo.\} b.`
// on the first save, a fixed point nothing healed, and invisible to the
// write-path word measure (no word is lost; braces are ESCAPED).
//
// Harness: the REAL save pipeline through the PM schema leg (`parseLatex` →
// `assignUuids` → `nodeFromJSON` → `toJSON` → `serializeToLatex`), two cycles.
vi.mock("@/lib/storage", () => ({
  readTex: vi.fn(() => Promise.resolve("")),
}));

import { describe, expect, it, vi } from "vitest";
import { getSchema } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { parseLatex, extractPreambleAndPostamble } from "@/lib/latex-parser";
import { serializeToLatex, assignUuids } from "@/lib/latex-serializer";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}
const MAIN_SCHEMA = getSchema(buildEditorExtensions(mainCtx()));

const PRE = "\\documentclass{article}\n\\begin{document}\n";
const POST = "\n\\end{document}\n";

function parse(tex: string): JSONContent {
  const content = parseLatex(tex);
  assignUuids(content);
  return MAIN_SCHEMA.nodeFromJSON(content).toJSON() as JSONContent;
}

function save(tex: string): string {
  return serializeToLatex(parse(tex), extractPreambleAndPostamble(tex) ?? undefined);
}

function body(tex: string): string {
  const start = tex.indexOf("\\begin{document}");
  const end = tex.indexOf("\\end{document}");
  return tex
    .slice(start + "\\begin{document}".length, end === -1 ? undefined : end)
    .replace(/[ \t]*%!v:[0-9a-f]{4}/g, "")
    .replace(/\\vfid\{[0-9a-f]+\}/g, "")
    .replace(/^\n+|\s+$/g, "");
}

function expectStable(bodyIn: string): void {
  const c1 = save(PRE + bodyIn + POST);
  const c2 = save(c1);
  expect(body(c1)).toBe(bodyIn.trim());
  expect(body(c2), "second save must not move the bytes").toBe(body(c1));
}

function findAll(node: JSONContent, type: string, out: JSONContent[] = []): JSONContent[] {
  if (node.type === type) out.push(node);
  for (const child of node.content ?? []) findAll(child, type, out);
  return out;
}

describe("task 1018 — a blank line inside a balanced group is not a paragraph break", () => {
  it.each([
    ["\\footnote", "A\\footnote{One.\n\nTwo.} b."],
    ["\\footnote[3]", "A\\footnote[3]{One.\n\nTwo.} b."],
    ["\\endnote", "A\\endnote{One.\n\nTwo.} b."],
    ["\\thanks in a heading", "\\section{T\\thanks{one\n\ntwo}}"],
    ["\\parbox", "A \\parbox{3cm}{one\n\ntwo} b."],
    ["\\fbox{\\parbox}", "A \\fbox{\\parbox{3cm}{one\n\ntwo}} b."],
    ["a grouped declaration", "A {\\itshape one\n\ntwo} b."],
    ["\\textbf", "A \\textbf{one\n\ntwo} b."],
    ["a footnote holding a quote", "A\\footnote{One.\n\n\\begin{quote}Q\\end{quote}\n\nTwo.} b."],
  ])("%s round-trips byte-identical", (_label, input) => {
    expectStable(input);
  });

  it("a multi-paragraph footnote opens AS a footnote", () => {
    const doc = parse(PRE + "A\\footnote{One.\n\nTwo.} b." + POST);
    const notes = findAll(doc, "footnote");
    expect(notes).toHaveLength(1);
    expect(JSON.stringify(doc)).not.toContain("\\\\footnote");
  });

  it("the \\thanks row keeps its heading", () => {
    const doc = parse(PRE + "\\section{T\\thanks{one\n\ntwo}}" + POST);
    expect(findAll(doc, "heading")).toHaveLength(1);
  });

  it.each([
    ["an unbalanced { bounds damage to its paragraph", "Text { open\n\nNext para."],
    ["an unbalanced } is carried", "Text } close\n\nNext para."],
    ["a stray { before a later balanced group", "Text { open\n\nA\\footnote{x} b."],
  ])("fallback fidelity: %s, and no brace is escaped", (_label, input) => {
    const out = body(save(PRE + input + POST));
    expect(out).not.toMatch(/\\[{}]/);
    expectStable(input);
  });

  it("an unbalanced { does not swallow the following paragraph", () => {
    const doc = parse(PRE + "Text { open\n\nNext para." + POST);
    const paras = findAll(doc, "paragraph");
    expect(paras.length).toBeGreaterThanOrEqual(2);
  });

  it.each([
    ["\\par control", "A\\footnote{One.\n%\nTwo.} b."],
    ["escaped braces stay escaped", "A \\{ set \\} b.\n\nNext."],
  ])("control: %s", (_label, input) => {
    expectStable(input);
  });
});

// Task 1203 — the group that spans a blank line is closed by the comment- and
// verbatim-AWARE reading, never the blind count. Pre-1203 `findGroupClose`
// fell back to the blind close across `\n\n`, so a `}` inside a `%` comment
// ended the footnote and the comment's brace went live; and `readParagraph`
// counted the `{` of `\verb|{|`, merging two paragraphs into one node.
describe("task 1203 — a commented or verbatim brace never closes a group", () => {
  it.each([
    ["a commented } in a multi-paragraph footnote", "A\\footnote{One. % old }\nmore.\n\nTwo.} b."],
    ["a commented } in a multi-paragraph \\thanks", "\\section{T\\thanks{one % x }\n\ntwo}}"],
    ["a commented } in a bare group", "A {\\itshape one % }\n\ntwo} b."],
    ["\\verb braces across paragraphs", "Type \\verb|{| to open.\n\nLater \\verb|}| closes."],
    ["a \\verb brace inside a multi-paragraph footnote", "A\\footnote{Use \\verb|}| here.\n\nTwo.} b."],
  ])("%s round-trips and is a fixed point", (_label, input) => {
    expectStable(input);
  });

  it("the footnote keeps BOTH paragraphs and the comment stays a comment", () => {
    const doc = parse(PRE + "A\\footnote{One. % old }\nmore.\n\nTwo.} b." + POST);
    expect(findAll(doc, "footnote")).toHaveLength(1);
    const out = save(PRE + "A\\footnote{One. % old }\nmore.\n\nTwo.} b." + POST);
    // the commented brace is still on a comment line, never live source
    expect(out).toMatch(/% old \}\n/);
  });

  it("\\verb|{| … blank line … \\verb|}| stays TWO paragraphs", () => {
    const doc = parse(PRE + "Type \\verb|{| to open.\n\nLater \\verb|}| closes." + POST);
    expect(findAll(doc, "paragraph")).toHaveLength(2);
  });
});
