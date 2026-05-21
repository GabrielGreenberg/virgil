import { describe, expect, it } from "vitest";
import { parseLatex } from "@/lib/latex-parser";
import {
  serializeBodyOnly as serializeBody,
  assignUuids,
} from "@/lib/latex-serializer";
import type { JSONContent } from "@tiptap/react";

function parseBody(input: string) {
  const wrapped = `\\documentclass{article}\\begin{document}\n${input}\n\\end{document}`;
  return parseLatex(wrapped);
}

function findFirst(doc: JSONContent, type: string): JSONContent | null {
  if (doc.type === type) return doc;
  for (const c of doc.content ?? []) {
    const f = findFirst(c, type);
    if (f) return f;
  }
  return null;
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

describe("list item UUID round-trip", () => {
  it("parses outer-list marker into the bulletList uuid (legacy doc)", () => {
    const tex = `\\begin{itemize}
  \\item first
  \\item second
\\end{itemize} %!v:abcd`;
    const json = parseBody(tex);
    const list = findFirst(json, "bulletList");
    expect(list?.attrs?.uuid).toBe("abcd");
    const items = findAll(json, "listItem");
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.attrs?.uuid ?? null).toBeNull();
    }
  });

  it("parses per-item markers into each listItem's uuid", () => {
    const tex = `\\begin{itemize}
  \\item first item %!v:aaaa
  \\item second item %!v:bbbb
\\end{itemize} %!v:abcd`;
    const json = parseBody(tex);
    const list = findFirst(json, "bulletList");
    expect(list?.attrs?.uuid).toBe("abcd");
    const items = findAll(json, "listItem");
    expect(items).toHaveLength(2);
    expect(items[0].attrs?.uuid).toBe("aaaa");
    expect(items[1].attrs?.uuid).toBe("bbbb");
    // The per-item marker should NOT leak into rendered text
    const firstText = findFirst(items[0], "paragraph")?.content?.map(c => c.text).join("");
    expect(firstText ?? "").not.toContain("%!v:");
    expect(firstText ?? "").toContain("first item");
  });

  it("parses ordered list per-item markers", () => {
    const tex = `\\begin{enumerate}
  \\item alpha %!v:1111
  \\item beta %!v:2222
\\end{enumerate} %!v:ee01`;
    const json = parseBody(tex);
    const list = findFirst(json, "orderedList");
    expect(list?.attrs?.uuid).toBe("ee01");
    const items = findAll(json, "listItem");
    expect(items[0].attrs?.uuid).toBe("1111");
    expect(items[1].attrs?.uuid).toBe("2222");
  });

  it("assignUuids stamps missing listItem UUIDs and clears inner paragraph UUIDs", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  attrs: { uuid: "stale" },
                  content: [{ type: "text", text: "alpha" }],
                },
              ],
            },
            {
              type: "listItem",
              attrs: { uuid: "keep" },
              content: [
                { type: "paragraph", content: [{ type: "text", text: "beta" }] },
              ],
            },
          ],
        },
      ],
    };
    assignUuids(doc);
    const list = findFirst(doc, "bulletList")!;
    expect(typeof list.attrs?.uuid).toBe("string");
    const items = findAll(doc, "listItem");
    // First item had no UUID — gets a fresh one. Second item kept its "keep".
    expect(items).toHaveLength(2);
    expect(items[0].attrs?.uuid).toMatch(/^[0-9a-f]{4}$/);
    expect(items[1].attrs?.uuid).toBe("keep");
    // Inner paragraph UUIDs are stripped (the listItem owns the anchor identity).
    const paras = findAll(doc, "paragraph");
    for (const p of paras) {
      expect(p.attrs?.uuid ?? null).toBeNull();
    }
  });

  it("emits per-item markers on serialize and preserves outer-list marker", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          attrs: { uuid: "abcd" },
          content: [
            {
              type: "listItem",
              attrs: { uuid: "aaaa" },
              content: [
                { type: "paragraph", content: [{ type: "text", text: "first item" }] },
              ],
            },
            {
              type: "listItem",
              attrs: { uuid: "bbbb" },
              content: [
                { type: "paragraph", content: [{ type: "text", text: "second item" }] },
              ],
            },
          ],
        },
      ],
    };
    const out = serializeBody(doc);
    expect(out).toContain("\\item first item %!v:aaaa");
    expect(out).toContain("\\item second item %!v:bbbb");
    expect(out).toContain("\\end{itemize} %!v:abcd");
  });

  it("round-trips a list with per-item UUIDs", () => {
    const tex = `\\begin{itemize}
  \\item one %!v:1111
  \\item two %!v:2222
\\end{itemize} %!v:abcd`;
    const json = parseBody(tex);
    const out = serializeBody(json);
    expect(out).toContain("\\item one %!v:1111");
    expect(out).toContain("\\item two %!v:2222");
    expect(out).toContain("\\end{itemize} %!v:abcd");
  });

  it("backward-compat: legacy list (only outer marker) loads then resaves with per-item markers", () => {
    const tex = `\\begin{itemize}
  \\item one
  \\item two
\\end{itemize} %!v:abcd`;
    const json = parseBody(tex);
    // Simulate the storage layer's assignUuids pass that runs on load.
    assignUuids(json);
    const items = findAll(json, "listItem");
    expect(items[0].attrs?.uuid).toMatch(/^[0-9a-f]{4}$/);
    expect(items[1].attrs?.uuid).toMatch(/^[0-9a-f]{4}$/);
    expect(items[0].attrs?.uuid).not.toBe(items[1].attrs?.uuid);
    // Re-serialize: per-item markers now present.
    const out = serializeBody(json);
    expect(out).toMatch(/\\item one %!v:[0-9a-f]{4}/);
    expect(out).toMatch(/\\item two %!v:[0-9a-f]{4}/);
    expect(out).toContain("\\end{itemize} %!v:abcd");
  });
});
