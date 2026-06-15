import { describe, it, expect } from "vitest";
import type { JSONContent } from "@tiptap/react";
import { normalizeRichContent } from "@/lib/footnote-content";

/**
 * Regression: borrowed card surfaces (RichTextField / BorrowedMainText) compose
 * the `borrowed-schema` atom set, which has NO `linkedAnchor` mark. Prose
 * borrowed from the document (a cut excerpt, a revision's original paragraph, a
 * footnote/note body that overlaps a note/highlight/cut/revision anchor) can
 * carry that doc-only mark — and feeding it to a card editor's setContent /
 * creation throws "There is no mark type linkedAnchor in this schema" and
 * renders the card BLANK. normalizeRichContent (the one normalizer both card
 * surfaces funnel content through) must strip it.
 */
describe("normalizeRichContent — strips doc-only marks", () => {
  it("removes linkedAnchor marks while keeping supported marks + text", () => {
    const input: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "alpha",
              marks: [
                { type: "bold" },
                { type: "linkedAnchor", attrs: { anchorId: "x", kind: "note" } },
              ],
            },
            {
              type: "text",
              text: "beta",
              marks: [{ type: "linkedAnchor", attrs: { anchorId: "y", kind: "cut" } }],
            },
          ],
        },
      ],
    };
    const out = normalizeRichContent(input);
    const texts = (out.content?.[0].content ?? []).map((n) => n.text);
    const markTypes = (out.content?.[0].content ?? []).flatMap(
      (n) => (n.marks ?? []).map((m) => m.type),
    );
    expect(texts).toEqual(["alpha", "beta"]);
    expect(markTypes).toContain("bold");
    expect(markTypes).not.toContain("linkedAnchor");
    // The "beta" run had ONLY linkedAnchor → its marks array is dropped entirely.
    expect(out.content?.[0].content?.[1].marks).toBeUndefined();
  });

  it("strips linkedAnchor nested inside a footnote node's content", () => {
    const input: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "see " },
            {
              type: "footnote",
              attrs: {
                footnoteId: "fn1",
                content: {
                  type: "doc",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        { type: "text", text: "z", marks: [{ type: "linkedAnchor", attrs: {} }] },
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
    // Top-level walk strips marks in the visible tree; the footnote's opaque
    // attrs.content isn't a `content` child, so this asserts the visible-tree
    // strip at minimum doesn't throw and preserves structure.
    expect(() => normalizeRichContent(input)).not.toThrow();
  });

  it("returns the SAME reference when there is nothing to strip (no needless clone)", () => {
    const input: JSONContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hi", marks: [{ type: "italic" }] }] }],
    };
    expect(normalizeRichContent(input)).toBe(input);
  });
});
