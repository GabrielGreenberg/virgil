/**
 * Task 1022 — a title prefix is only ever a DECLARATION switch. A wrapper
 * command (`\textbf{…}`) in a title is a mark, not a lifted name with its
 * braces left behind; and the switch list is word-bounded.
 */
import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import {
  parseLatex,
  extractPreambleAndPostamble,
  matchTitlePrefix,
} from "@/lib/latex-parser";
import { serializeToLatex } from "@/lib/latex-serializer";

const wrap = (titleLine: string, inPreamble: boolean) =>
  inPreamble
    ? `\\documentclass{article}\n${titleLine}\n\\begin{document}\n\\maketitle\n\nBody.\n\n\\end{document}\n`
    : `\\documentclass{article}\n\\begin{document}\n${titleLine}\n\\maketitle\n\nBody.\n\n\\end{document}\n`;

function titleNode(doc: JSONContent): JSONContent {
  const n = doc.content?.find((c) => c.type === "titleField" && c.attrs?.field === "title");
  if (!n) throw new Error("no title field");
  return n;
}

function roundTrip(tex: string): string {
  const doc = parseLatex(tex);
  return serializeToLatex(doc, extractPreambleAndPostamble(tex) ?? undefined);
}

describe.each([
  ["preamble", true],
  ["body", false],
])("title prefix vocabulary (%s site)", (_label, inPreamble) => {
  it("\\title{\\textbf{Main} Subtitle}: no rawPrefix, Main is bold, bytes stable", () => {
    const tex = wrap("\\title{\\textbf{Main} Subtitle}", inPreamble);
    const t = titleNode(parseLatex(tex));
    expect(t.attrs?.rawPrefix ?? null).toBeNull();
    const main = t.content?.find((c) => c.text === "Main");
    expect(main?.marks?.map((m) => m.type)).toContain("bold");
    expect(t.content?.some((c) => c.text === "{" || c.text === "}")).toBe(false);
    const once = roundTrip(tex);
    expect(once).toContain("\\title{\\textbf{Main} Subtitle}");
    expect(roundTrip(once)).toBe(once);
  });

  it("\\title{\\Large\\bfseries X} keeps its declaration prefix", () => {
    const tex = wrap("\\title{\\Large\\bfseries X}", inPreamble);
    const t = titleNode(parseLatex(tex));
    expect(t.attrs?.rawPrefix).toBe("\\Large\\bfseries ");
    expect(roundTrip(tex)).toContain("\\title{\\Large\\bfseries X}");
  });

  it("\\title{\\smallskip X} is not split at \\small", () => {
    const tex = wrap("\\title{\\smallskip X}", inPreamble);
    const t = titleNode(parseLatex(tex));
    expect(t.attrs?.rawPrefix ?? null).toBeNull();
    const once = roundTrip(tex);
    expect(once).toContain("\\title{\\smallskip X}");
    expect(roundTrip(once)).toBe(once);
  });

  it("\\title{\\textsf{Main}} round-trips byte-identically", () => {
    const tex = wrap("\\title{\\textsf{Main}}", inPreamble);
    expect(titleNode(parseLatex(tex)).attrs?.rawPrefix ?? null).toBeNull();
    const once = roundTrip(tex);
    expect(once).toContain("\\title{\\textsf{Main}}");
    expect(roundTrip(once)).toBe(once);
  });
});

describe("matchTitlePrefix", () => {
  it("matches only word-bounded declaration switches", () => {
    expect(matchTitlePrefix("\\small X")).toBe("\\small ");
    expect(matchTitlePrefix("\\smallcaps X")).toBe("");
    expect(matchTitlePrefix("\\textbf{X}")).toBe("");
    expect(matchTitlePrefix("\\LARGE\\scshape X")).toBe("\\LARGE\\scshape ");
  });
});
