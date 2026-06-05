/**
 * Feature A1 — `displayMath` (an `\[…\]` equation) inside an expex `\a` item.
 *
 * The schema widen (`exampleItem` content gains `displayMath`, expex.ts) is only
 * half the feature: a `displayMath` dropped into an example must also survive the
 * LaTeX round-trip (serialize → re-parse), the real risk the plan flagged. Before
 * A1 both halves silently DROPPED it — `serializeExampleItem` had no displayMath
 * branch and `parseExampleBodyAsBlocks` / the item head-filter excluded it. These
 * locks prove the equation survives inside the item, in document order, with its
 * latex + uuid intact, while the `exampleBlock`-level contexts (single `\ex`
 * bodies, `\pex` preambles — which the schema does NOT widen) stay unchanged.
 */

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

describe("displayMath inside an expex exampleItem", () => {
  it("parses a lone \\[…\\] inside an \\a item as a child displayMath", () => {
    const tex = `\\pex
\\a A regular text sub-item.
\\a \\[
x = 1
\\]
\\xe`;
    const json = parseBody(tex);
    const items = findAll(json, "exampleItem");
    expect(items).toHaveLength(2);
    const second = items[1];
    const math = (second.content ?? []).filter((c) => c.type === "displayMath");
    expect(math).toHaveLength(1);
    expect(math[0].attrs?.latex).toBe("x = 1");
    // A lone equation item must NOT gain a spurious empty paragraph.
    expect(second.content).toHaveLength(1);
  });

  it("keeps a paragraph + displayMath item in document order", () => {
    const tex = `\\pex
\\a Some text. \\[
y = 2
\\]
\\xe`;
    const json = parseBody(tex);
    const item = findAll(json, "exampleItem")[0];
    const kinds = (item.content ?? []).map((c) => c.type);
    expect(kinds).toEqual(["paragraph", "displayMath"]);
    expect((item.content ?? [])[0].content?.[0].text).toContain("Some text.");
    expect((item.content ?? [])[1].attrs?.latex).toBe("y = 2");
  });

  it("round-trips a displayMath inside an item through parse → serialize → parse", () => {
    const original = `\\pex
\\a Text before the equation.
\\a \\[
E = mc^2
\\]
\\xe`;
    const parsed = parseBody(original);
    const serialized = serializeBody(parsed);
    // The equation survives serialization (it is NOT dropped).
    expect(serialized).toContain("\\[");
    expect(serialized).toContain("E = mc^2");
    expect(serialized).toMatch(/\\a /);

    const reparsed = parseBody(serialized);
    const items = findAll(reparsed, "exampleItem");
    expect(items).toHaveLength(2);
    const math = findAll(items[1], "displayMath");
    expect(math).toHaveLength(1);
    expect(math[0].attrs?.latex).toBe("E = mc^2");
  });

  it("round-trips a mixed paragraph+equation item preserving order + latex", () => {
    const original = `\\pex
\\a The setup text. \\[
a + b = c
\\]
\\xe`;
    const reparsed = parseBody(serializeBody(parseBody(original)));
    const item = findAll(reparsed, "exampleItem")[0];
    const kinds = (item.content ?? []).map((c) => c.type);
    expect(kinds).toEqual(["paragraph", "displayMath"]);
    expect((item.content ?? [])[1].attrs?.latex).toBe("a + b = c");
  });

  it("preserves a displayMath's uuid anchor across the round-trip", () => {
    // %!v: anchors carry a 4-hex id (NODE_UUID_ANCHOR).
    const original = `\\pex
\\a \\[
z = 0
\\] %!v:ab12
\\xe`;
    const parsed = parseBody(original);
    expect(findAll(parsed, "displayMath")[0].attrs?.uuid).toBe("ab12");
    const reparsed = parseBody(serializeBody(parsed));
    const math = findAll(reparsed, "displayMath");
    expect(math).toHaveLength(1);
    expect(math[0].attrs?.uuid).toBe("ab12");
    expect(math[0].attrs?.latex).toBe("z = 0");
  });

  it("does NOT leak a displayMath into a single \\ex body (exampleBlock stays un-widened)", () => {
    // `exampleBlock` content does not accept displayMath directly; a single
    // `\ex` body parses through `parseExampleBodyAsBlocks` WITHOUT the
    // allowDisplayMath flag, so a stray equation there is dropped (unchanged
    // pre-A1 behavior) rather than producing a schema-invalid block child.
    const tex = `\\ex A one-liner. \\[
q = 9
\\]
\\xe`;
    const json = parseBody(tex);
    const block = findAll(json, "exampleBlock")[0];
    // No exampleItemList (single \ex) and no displayMath child at block level.
    const blockMath = (block.content ?? []).filter(
      (c) => c.type === "displayMath",
    );
    expect(blockMath).toHaveLength(0);
  });
});
