// Task 782 — an expex `\ex` header the node cannot represent is REFUSED, never
// half-kept.
//
// The pre-782 opener loop re-read `\label` / `[opts]` after it had already
// filled those slots: a second `\label` overwrote the first ("last one wins" —
// `ex:a` deleted, every `\ref{ex:a}` → `??`), and an `[opts]` written after the
// label/tag was folded into the options run and re-emitted in FRONT of them. The
// fix is one header grammar (`readExpexHeader`, `[opts]* <tag>? \label?`, the
// serializer's own order) shared by the opener and every `\a` part; an opener
// whose header goes on past it is carried as ONE byte-literal carrier.
//
// Each leg drives the real save pipeline over TWO cycles (cycle 1 is where the
// loss happened; cycle 2 proves a fixed point). Canonical headers are CONTROLS
// through the identical harness: they must still become exampleBlocks.
import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/react";
import { parseLatex, extractPreambleAndPostamble } from "@/lib/latex-parser";
import { serializeToLatex, assignUuids } from "@/lib/latex-serializer";

function save(tex: string): string {
  const content = parseLatex(tex);
  assignUuids(content);
  return serializeToLatex(content, extractPreambleAndPostamble(tex) ?? undefined);
}

function doc(body: string): string {
  return `\\documentclass{article}\n\\usepackage{expex}\n\\begin{document}\n\n${body}\n\n\\end{document}\n`;
}

function findAll(node: JSONContent, type: string): JSONContent[] {
  const out: JSONContent[] = [];
  (function walk(n: JSONContent) {
    if (n.type === type) out.push(n);
    n.content?.forEach(walk);
  })(node);
  return out;
}

describe("expex opener header — unrepresentable shapes are carried verbatim", () => {
  const refused: Array<[string, string]> = [
    ["two labels", "\\ex\\label{ex:a}\\label{ex:b} Sentence.\n\\xe"],
    ["two labels across a line break", "\\ex\\label{ex:a}\n\\label{ex:b}\nSentence.\n\\xe"],
    ["options after the label", "\\ex\\label{a}[exno=3] Sentence.\n\\xe"],
    ["options after the tag", "\\ex[x]<t>[y] Sentence.\n\\xe"],
    ["a \\pex with two labels", "\\pex\\label{ex:a}\\label{ex:b}\n\\a One.\n\\a Two.\n\\xe"],
  ];
  for (const [name, example] of refused) {
    it(`${name}: bytes survive, fixed point from cycle 1`, () => {
      const src = doc(`See \\ref{ex:a}.\n\n${example}`);
      const once = save(src);
      expect(once).toContain(example);
      expect(save(once)).toBe(once);
      // Refused, not modelled: no exampleBlock carries a fraction of the header.
      expect(findAll(parseLatex(src), "exampleBlock")).toHaveLength(0);
    });
  }

  it("a pending \\vexid does not leak onto the NEXT example", () => {
    const src = doc(
      "\\vexid{ab12}\\ex\\label{a}\\label{b} One.\n\\xe\n\n\\ex Two.\n\\xe",
    );
    const blocks = findAll(parseLatex(src), "exampleBlock");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].attrs?.uuid).not.toBe("ab12");
  });
});

describe("expex opener header — canonical controls still model", () => {
  const controls: Array<[string, string, Record<string, unknown>]> = [
    ["bare label", "\\ex\\label{a}\nSentence.\n\\xe", { label: "a" }],
    ["options then label", "\\ex[exno=3]\\label{a}\nSentence.\n\\xe", { label: "a", exnoOverride: "3" }],
    ["options, tag, label", "\\ex[x]<t>\\label{a}\nSentence.\n\\xe", { label: "a", tag: "t", rawOptions: "[x]" }],
    ["label on the next line", "\\ex\n\\label{a}\nSentence.\n\\xe", { label: "a" }],
  ];
  for (const [name, example, attrs] of controls) {
    it(`${name}: parses to an exampleBlock and round-trips`, () => {
      const blocks = findAll(parseLatex(doc(example)), "exampleBlock");
      expect(blocks).toHaveLength(1);
      expect(blocks[0].attrs).toMatchObject(attrs);
      const once = save(doc(example));
      expect(save(once)).toBe(once);
      expect(once).toContain(`\\label{${attrs.label}}`);
    });
  }

  it("an \\a part keeps a second label in its text (the shared grammar's part rule)", () => {
    const src = doc("\\pex\n\\a\\label{p1}\\label{p2} One.\n\\a Two.\n\\xe");
    const once = save(src);
    expect(once).toContain("\\label{p1}");
    expect(once).toContain("\\label{p2}");
    expect(save(once)).toBe(once);
  });
});
