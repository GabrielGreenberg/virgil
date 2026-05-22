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
    const tex = serializeBody(doc, "");
    expect(tex).toContain("\\vxid{cd34}\\a");
  });

  it("round-trips an exampleItem's uuid through parse → serialize → parse", () => {
    const original = `\\vexid{ab12}\\pex
\\vxid{cd34}\\a first item
\\vxid{ef56}\\a second item
\\xe`;
    const parsed = parseBody(original);
    const serialized = serializeBody(parsed, "");
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
