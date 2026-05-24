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

describe("exampleItem UUID round-trip (\\vxid)", () => {
  it("parses \\vxid{xxxx} preceding \\a into the exampleItem uuid", () => {
    const tex = `\\vexid{ab12}\\pex
\\vxid{cd34}\\a first item
\\vxid{ef56}\\a second item
\\xe`;
    const json = parseBody(tex);
    const items = findAll(json, "exampleItem");
    expect(items).toHaveLength(2);
    expect(items[0].attrs?.uuid).toBe("cd34");
    expect(items[1].attrs?.uuid).toBe("ef56");
  });

  it("assigns a fresh uuid when no \\vxid marker is present (legacy doc)", () => {
    const tex = `\\pex
\\a first item
\\a second item
\\xe`;
    const json = parseBody(tex);
    const items = findAll(json, "exampleItem");
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.attrs?.uuid).toMatch(/^[0-9a-f]{4}$/);
    }
    // Items get distinct uuids.
    expect(items[0].attrs?.uuid).not.toBe(items[1].attrs?.uuid);
  });

  it("serializes exampleItem uuid back as \\vxid{xxxx} before \\a", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "exampleBlock",
          attrs: { uuid: "ab12", kind: "multi", tag: "", label: "" },
          content: [
            {
              type: "exampleItemList",
              content: [
                {
                  type: "exampleItem",
                  attrs: { uuid: "cd34", tag: "", label: "", subLabel: "" },
                  content: [
                    {
                      type: "paragraph",
                      attrs: { uuid: "1234" },
                      content: [{ type: "text", text: "first" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const tex = serializeBody(doc);
    expect(tex).toContain("\\vxid{cd34}\\a");
  });

  it("round-trips an exampleItem's uuid through parse → serialize → parse", () => {
    const original = `\\vexid{ab12}\\pex
\\vxid{cd34}\\a first item
\\vxid{ef56}\\a second item
\\xe`;
    const parsed = parseBody(original);
    const serialized = serializeBody(parsed);
    expect(serialized).toContain("\\vxid{cd34}");
    expect(serialized).toContain("\\vxid{ef56}");

    const reparsed = parseBody(serialized);
    const items = findAll(reparsed, "exampleItem");
    expect(items[0].attrs?.uuid).toBe("cd34");
    expect(items[1].attrs?.uuid).toBe("ef56");
  });

  it("nested \\begin{xlist} items also round-trip uuids via \\vxid", () => {
    const tex = `\\pex
\\vxid{0001}\\a outer item
\\begin{xlist}
\\vxid{0002}\\a inner item one
\\vxid{0003}\\a inner item two
\\end{xlist}
\\xe`;
    const json = parseBody(tex);
    const items = findAll(json, "exampleItem");
    expect(items).toHaveLength(3);
    expect(items[0].attrs?.uuid).toBe("0001");
    expect(items[1].attrs?.uuid).toBe("0002");
    expect(items[2].attrs?.uuid).toBe("0003");
  });
});

describe("exampleItem stray \\vxid resilience (corruption recovery)", () => {
  // Pre-fix bug: stray `\vxid{…}` lines accumulated as paragraph children of
  // the example block on every parse → serialize cycle. The parseBody
  // handler now discards stray markers so they don't survive as text.

  it("discards stray \\vxid lines in pex preamble", () => {
    const tex = `\\pex
\\vxid{aa11}
\\vxid{aa11}
\\vxid{aa11}\\a body
\\xe`;
    const json = parseBody(tex);
    const items = findAll(json, "exampleItem");
    const blocks = findAll(json, "exampleBlock");
    expect(items).toHaveLength(1);
    expect(items[0].attrs?.uuid).toBe("aa11");
    // The exampleBlock must have zero paragraph children — only the
    // exampleItemList. Strays must not survive as preamble paragraphs.
    const paragraphsBefore = (blocks[0].content || []).filter(
      (c) => c.type === "paragraph",
    );
    expect(paragraphsBefore).toHaveLength(0);
  });

  it("discards stray \\vxid inside item bodies", () => {
    const tex = `\\pex
\\vxid{aa11}\\a first
\\vxid{aa11}
\\vxid{bb22}\\a second
\\xe`;
    const json = parseBody(tex);
    const items = findAll(json, "exampleItem");
    expect(items).toHaveLength(2);
    expect(items[0].attrs?.uuid).toBe("aa11");
    expect(items[1].attrs?.uuid).toBe("bb22");
    // No item's serialized JSON should contain a literal `\vxid` — that
    // would mean a marker was absorbed as paragraph text.
    for (const item of items) {
      expect(JSON.stringify(item)).not.toMatch(/\\\\vxid/);
    }
  });

  it("is idempotent under parse → serialize → parse → serialize on corrupted source", () => {
    const corrupt = `\\pex
\\vxid{aa11}
\\vxid{aa11}\\a first
\\vxid{aa11}
\\vxid{bb22}\\a second
\\xe`;
    const j1 = parseBody(corrupt);
    const t1 = serializeBody(j1);
    const j2 = parseBody(t1);
    const t2 = serializeBody(j2);
    expect(t2).toBe(t1);
    // Exactly one \vxid per item — no accumulation.
    expect((t1.match(/\\vxid/g) || []).length).toBe(2);
  });

  it("legit \\vxid{...}\\a path still produces zero stray paragraphs", () => {
    const tex = `\\pex
\\vxid{aa11}\\a only item
\\xe`;
    const json = parseBody(tex);
    const items = findAll(json, "exampleItem");
    const blocks = findAll(json, "exampleBlock");
    expect(items).toHaveLength(1);
    expect(items[0].attrs?.uuid).toBe("aa11");
    const paragraphsBefore = (blocks[0].content || []).filter(
      (c) => c.type === "paragraph",
    );
    expect(paragraphsBefore).toHaveLength(0);
  });
});

describe("exampleItem accepts hand-authored \\b/\\c/\\d aliases for \\a", () => {
  it("parses \\b, \\c, \\d as item markers when used in place of \\a", () => {
    const tex = `\\pex
\\vxid{xi01}\\a first
\\vxid{xi02}\\b second
\\vxid{xi03}\\c third
\\vxid{xi04}\\d fourth
\\xe`;
    const json = parseBody(tex);
    const items = findAll(json, "exampleItem");
    expect(items).toHaveLength(4);
    expect(items.map((it) => it.attrs?.uuid)).toEqual([
      "xi01",
      "xi02",
      "xi03",
      "xi04",
    ]);
  });

  it("normalizes \\b/\\c/\\d to \\a on serialization", () => {
    const tex = `\\pex
\\vxid{xi01}\\a first
\\vxid{xi02}\\b second
\\xe`;
    const json = parseBody(tex);
    const out = serializeBody(json);
    // Only `\a` is emitted; the visual sub-label is regenerated by expex.
    expect(out).toContain("\\vxid{xi01}\\a first");
    expect(out).toContain("\\vxid{xi02}\\a second");
    expect(out).not.toMatch(/\\b second/);
  });

  it("does not treat multi-letter commands like \\begin as item markers", () => {
    const tex = `\\pex
\\a first item
\\begin{itemize}
\\item nested bullet
\\end{itemize}
\\xe`;
    const json = parseBody(tex);
    const items = findAll(json, "exampleItem");
    // Single item; the \begin block does not split into a second item.
    expect(items).toHaveLength(1);
  });
});
