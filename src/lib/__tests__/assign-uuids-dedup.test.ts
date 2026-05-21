import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/react";
import { assignUuids } from "@/lib/latex-serializer";

function collectIds(doc: JSONContent, type: string, attr: string): string[] {
  const out: string[] = [];
  const walk = (node: JSONContent) => {
    if (node.type === type) {
      const v = (node.attrs ?? {})[attr];
      if (typeof v === "string" && v) out.push(v);
    }
    node.content?.forEach(walk);
  };
  walk(doc);
  return out;
}

describe("assignUuids inline-id dedup", () => {
  it("dedupes duplicate citationIds while keeping the first occurrence", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "p001" },
          content: [
            { type: "text", text: "See " },
            { type: "citation", attrs: { citationId: "abcd", command: "\\citet{x}" } },
            { type: "text", text: " and " },
            { type: "citation", attrs: { citationId: "abcd", command: "\\citet{y}" } },
            { type: "text", text: "." },
          ],
        },
      ],
    };
    assignUuids(doc);
    const ids = collectIds(doc, "citation", "citationId");
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe("abcd");
    expect(ids[1]).not.toBe("abcd");
    expect(ids[1]).toMatch(/^[0-9a-f]{4}$/);
  });

  it("dedupes duplicate footnoteIds while keeping the first occurrence", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "p001" },
          content: [
            { type: "text", text: "Body " },
            { type: "footnote", attrs: { footnoteId: "abed", content: [], number: 1 } },
            { type: "text", text: " and " },
            { type: "footnote", attrs: { footnoteId: "abed", content: [], number: 2 } },
            { type: "text", text: "." },
          ],
        },
      ],
    };
    assignUuids(doc);
    const ids = collectIds(doc, "footnote", "footnoteId");
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe("abed");
    expect(ids[1]).not.toBe("abed");
    expect(ids[1]).toMatch(/^[0-9a-f]{4}$/);
  });

  it("dedupes paragraph and exampleBlock uuids in one pass", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { uuid: "abed" }, content: [{ type: "text", text: "A" }] },
        { type: "paragraph", attrs: { uuid: "abed" }, content: [{ type: "text", text: "B" }] },
        { type: "exampleBlock", attrs: { uuid: "ee01" }, content: [] },
        { type: "exampleBlock", attrs: { uuid: "ee01" }, content: [] },
      ],
    };
    assignUuids(doc);
    const paraIds = collectIds(doc, "paragraph", "uuid");
    const exIds = collectIds(doc, "exampleBlock", "uuid");
    expect(paraIds[0]).toBe("abed");
    expect(paraIds[1]).not.toBe("abed");
    expect(paraIds[1]).toMatch(/^[0-9a-f]{4}$/);
    expect(exIds[0]).toBe("ee01");
    expect(exIds[1]).not.toBe("ee01");
    expect(exIds[1]).toMatch(/^[0-9a-f]{4}$/);
  });

  it("fills missing inline ids alongside dedup, avoiding survivor collisions", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "p001" },
          content: [
            { type: "citation", attrs: { citationId: "abcd", command: "\\citet{x}" } },
            { type: "citation", attrs: { citationId: "", command: "\\citet{y}" } },
            { type: "citation", attrs: { citationId: "abcd", command: "\\citet{z}" } },
          ],
        },
      ],
    };
    assignUuids(doc);
    const ids = collectIds(doc, "citation", "citationId");
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe("abcd");
  });

  it("dedupes citations nested inside footnote.attrs.content (doc shape)", () => {
    // Footnotes are inline atoms whose body lives on `attrs.content` as a
    // JSONContent doc node (richLatexToJson's shape). Citations inside a
    // footnote aren't reachable via node.content recursion — the walker
    // must descend into attrs.content too. Two footnotes each carry one
    // citation with id "cc01", plus one citation at the outer paragraph
    // level — three total occurrences, all should end unique.
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "p001" },
          content: [
            { type: "citation", attrs: { citationId: "cc01", command: "\\citet{a}" } },
            {
              type: "footnote",
              attrs: {
                footnoteId: "ff01",
                number: 1,
                content: {
                  type: "doc",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        { type: "text", text: "see " },
                        { type: "citation", attrs: { citationId: "cc01", command: "\\citet{b}" } },
                      ],
                    },
                  ],
                },
              },
            },
          ],
        },
        {
          type: "paragraph",
          attrs: { uuid: "p002" },
          content: [
            {
              type: "footnote",
              attrs: {
                footnoteId: "ff02",
                number: 2,
                content: {
                  type: "doc",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        { type: "citation", attrs: { citationId: "cc01", command: "\\citet{c}" } },
                      ],
                    },
                  ],
                },
              },
            },
          ],
        },
      ],
    };
    assignUuids(doc);
    const allCitationIds: string[] = [];
    const collect = (node: JSONContent) => {
      if (node.type === "citation") {
        const v = (node.attrs ?? {}).citationId;
        if (typeof v === "string" && v) allCitationIds.push(v);
      }
      node.content?.forEach(collect);
      const inner = node.attrs?.content;
      if (Array.isArray(inner)) {
        (inner as JSONContent[]).forEach(collect);
      } else if (inner && typeof inner === "object") {
        collect(inner as JSONContent);
      }
    };
    collect(doc);
    expect(allCitationIds).toHaveLength(3);
    expect(new Set(allCitationIds).size).toBe(3);
    expect(allCitationIds[0]).toBe("cc01");
  });

  it("keeps citation and footnote namespaces independent", () => {
    // A citation and a footnote may share the same 4-char id without
    // conflict, since React keys are prefixed `citation:` / `footnote:`.
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "p001" },
          content: [
            { type: "citation", attrs: { citationId: "abed", command: "\\citet{x}" } },
            { type: "footnote", attrs: { footnoteId: "abed", content: [], number: 1 } },
          ],
        },
      ],
    };
    assignUuids(doc);
    const citationIds = collectIds(doc, "citation", "citationId");
    const footnoteIds = collectIds(doc, "footnote", "footnoteId");
    expect(citationIds).toEqual(["abed"]);
    expect(footnoteIds).toEqual(["abed"]);
  });
});
