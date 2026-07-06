import { describe, it, expect } from "vitest";
import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly as serializeBody } from "@/lib/latex-serializer";
import type { JSONContent } from "@tiptap/react";

function parseBody(input: string) {
  const wrapped = `\\documentclass{article}\\begin{document}\n${input}\n\\end{document}`;
  return parseLatex(wrapped);
}

function findAll(doc: JSONContent, type: string): JSONContent[] {
  const out: JSONContent[] = [];
  (function walk(n: JSONContent) {
    if (n.type === type) out.push(n);
    n.content?.forEach(walk);
  })(doc);
  return out;
}

// Strip the block-level \vexid{…} marker (whose id regenerates each parse) so
// we can compare the item-marker + text bytes for a true content round-trip.
function stripVolatileIds(tex: string): string {
  return tex.replace(/\\vexid\{[^}]*\}/g, "");
}

describe("splitPexBody — spaced accents / special letters are not mis-split (P3)", () => {
  // The former item-marker heuristic read `\v s` as item marker `\v` +
  // content `s …`, silently DELETING the accent and splitting one item into
  // several. The lexer fix tries matchAccent/matchSpecialLetter before the
  // item test, so the accent is consumed as inline text.

  it("\\a … \\v s … stays ONE item with the caron preserved", () => {
    const tex = `\\pex\n\\a the word \\v s means bear\n\\xe`;
    const json = parseBody(tex);
    const items = findAll(json, "exampleItem");
    expect(items).toHaveLength(1);
    // Composed glyph š (s + caron), not a deleted accent.
    const text = JSON.stringify(items[0]);
    expect(text).toContain("š");
    expect(text).toContain("the word š means bear");
  });

  it("re-serializes byte-identically (ignoring the volatile \\vexid id)", () => {
    const tex = `\\pex\n\\a the word \\v s means bear\n\\xe`;
    const first = serializeBody(parseBody(tex));
    const second = serializeBody(parseBody(stripVolatileIds(first)));
    expect(stripVolatileIds(second)).toBe(stripVolatileIds(first));
    // And the item marker + accent survive the round-trip.
    expect(stripVolatileIds(first)).toContain(
      "\\a the word \\v{s} means bear",
    );
  });

  it("handles a mix of spaced accents and special letters in one item", () => {
    // \v s (caron), \d t (dot-below), \i (dotless i), \o (ø), \l (ł).
    const tex = `\\pex\n\\a naive \\v s then \\d t plus \\i and \\o and \\l end\n\\xe`;
    const json = parseBody(tex);
    const items = findAll(json, "exampleItem");
    // A single item — none of the accent/special-letter commands split it.
    expect(items).toHaveLength(1);
    const t = JSON.stringify(items[0]);
    expect(t).toContain("š"); // \v s
    expect(t).toContain("ṭ"); // \d t
    expect(t).toContain("ı"); // \i
    expect(t).toContain("ø"); // \o
    expect(t).toContain("ł"); // \l

    // Round-trips byte-stable (ignoring the volatile block id).
    const first = serializeBody(json);
    const second = serializeBody(parseBody(stripVolatileIds(first)));
    expect(stripVolatileIds(second)).toBe(stripVolatileIds(first));
  });

  it("a real \\a marker is still sliced correctly alongside accents", () => {
    const tex = `\\pex\n\\a first with \\v s inside\n\\a second plain\n\\xe`;
    const json = parseBody(tex);
    const items = findAll(json, "exampleItem");
    expect(items).toHaveLength(2);
    expect(JSON.stringify(items[0])).toContain("first with š inside");
    expect(JSON.stringify(items[1])).toContain("second plain");
  });
});
