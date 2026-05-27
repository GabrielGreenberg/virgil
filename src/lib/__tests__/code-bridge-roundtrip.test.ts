/**
 * Round-trip safety net for the Code-view bridge
 * (`src/lib/code-pane-bridge.ts`).
 *
 * The bridge depends on this invariant: every UUID-bearing node that
 * round-trips through `serializeToLatex` → `parseLatex` must keep its
 * `attrs.uuid`. If it doesn't, code-view edits would silently re-assign
 * paragraph identities, breaking marginalia anchors, paragraph cards,
 * and selection sync.
 *
 * Per-node-type round-trip tests already exist (figure-roundtrip,
 * list-item-roundtrip, etc.). This file specifically asserts the
 * UUID-preservation chain for the full set the serializer is supposed
 * to anchor, in one place, so future serializer changes catch the
 * regression here too.
 */
import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/react";
import { parseLatex } from "@/lib/latex-parser";
import { serializeToLatex } from "@/lib/latex-serializer";

function collectUuids(doc: JSONContent): Map<string, string> {
  // type → uuid (we expect at most one of each type in the synthetic docs).
  const out = new Map<string, string>();
  function walk(node: JSONContent) {
    const uuid = node.attrs?.uuid;
    if (typeof uuid === "string" && uuid && !out.has(node.type ?? "")) {
      out.set(node.type ?? "", uuid);
    }
    if (node.content) for (const c of node.content) walk(c);
  }
  walk(doc);
  return out;
}

function rt(doc: JSONContent): JSONContent {
  const tex = serializeToLatex(doc);
  return parseLatex(tex);
}

describe("code-pane-bridge: UUID preservation across parse↔serialize", () => {
  it("paragraph", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { uuid: "aaaa" }, content: [{ type: "text", text: "Hello, world." }] },
      ],
    };
    const before = collectUuids(doc);
    const after = collectUuids(rt(doc));
    expect(after.get("paragraph")).toBe(before.get("paragraph"));
  });

  it("heading", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        { type: "heading", attrs: { uuid: "bbbb", level: 2 }, content: [{ type: "text", text: "Intro" }] },
        { type: "paragraph", attrs: { uuid: "cccc" }, content: [{ type: "text", text: "Body." }] },
      ],
    };
    const before = collectUuids(doc);
    const after = collectUuids(rt(doc));
    expect(after.get("heading")).toBe(before.get("heading"));
    expect(after.get("paragraph")).toBe(before.get("paragraph"));
  });

  it("blockquote", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "blockquote",
          attrs: { uuid: "dddd" },
          content: [
            { type: "paragraph", attrs: { uuid: "eeee" }, content: [{ type: "text", text: "A quote." }] },
          ],
        },
      ],
    };
    const before = collectUuids(doc);
    const after = collectUuids(rt(doc));
    expect(after.get("blockquote")).toBe(before.get("blockquote"));
  });

  it("bulletList + listItem", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          attrs: { uuid: "ffff" },
          content: [
            {
              type: "listItem",
              attrs: { uuid: "1111" },
              content: [{ type: "paragraph", attrs: { uuid: "2222" }, content: [{ type: "text", text: "Item." }] }],
            },
          ],
        },
      ],
    };
    const before = collectUuids(doc);
    const after = collectUuids(rt(doc));
    expect(after.get("bulletList")).toBe(before.get("bulletList"));
    expect(after.get("listItem")).toBe(before.get("listItem"));
  });

  it("displayMath", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        { type: "displayMath", attrs: { uuid: "3333", source: "x^2 + y^2 = z^2" } },
      ],
    };
    const before = collectUuids(doc);
    const after = collectUuids(rt(doc));
    expect(after.get("displayMath")).toBe(before.get("displayMath"));
  });

  it("latexComment", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        { type: "latexComment", attrs: { uuid: "4444", source: "TODO: review" } },
        { type: "paragraph", attrs: { uuid: "5555" }, content: [{ type: "text", text: "Body." }] },
      ],
    };
    const before = collectUuids(doc);
    const after = collectUuids(rt(doc));
    expect(after.get("latexComment")).toBe(before.get("latexComment"));
  });
});

describe("code-pane-bridge: full-text round-trip is fixed-point", () => {
  it("re-serializing the parsed output yields identical LaTeX", () => {
    // Start from a representative doc with a few node kinds, serialize
    // twice through parse to confirm we hit a fixed point after the
    // first pass. (Many parsers introduce normalization on first pass
    // and stabilize after; we want serializeToLatex(parseLatex(tex))
    // to be idempotent thereafter — otherwise the bridge would emit
    // a different .tex string on every TipTap → CM push and churn
    // CodeMirror's cursor.)
    // All UUIDs are 4-hex (matches the parser regex
    // `/%!v:[0-9a-f]{4}/` — non-hex values get serialized but not
    // recovered on parse, which is by design).
    const doc: JSONContent = {
      type: "doc",
      content: [
        { type: "heading", attrs: { uuid: "abcd", level: 1 }, content: [{ type: "text", text: "Title" }] },
        { type: "paragraph", attrs: { uuid: "0001" }, content: [{ type: "text", text: "Lorem ipsum dolor sit amet." }] },
        {
          type: "bulletList",
          attrs: { uuid: "0002" },
          content: [
            {
              type: "listItem",
              attrs: { uuid: "0003" },
              content: [{ type: "paragraph", attrs: { uuid: "0004" }, content: [{ type: "text", text: "One." }] }],
            },
            {
              type: "listItem",
              attrs: { uuid: "0005" },
              content: [{ type: "paragraph", attrs: { uuid: "0006" }, content: [{ type: "text", text: "Two." }] }],
            },
          ],
        },
        { type: "paragraph", attrs: { uuid: "0007" }, content: [{ type: "text", text: "Closing." }] },
      ],
    };
    const tex1 = serializeToLatex(doc);
    const parsed = parseLatex(tex1);
    const tex2 = serializeToLatex(parsed);
    expect(tex2).toBe(tex1);
  });
});
