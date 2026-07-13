/**
 * Task 112 — word-count categorization SSOT.
 *
 * The Word Count panel (`computeWordCounts` via useWordCount) and the Outline
 * panel's per-section counts (`buildPerBlockCounts`/`sumIncludedWords`) gate
 * on the SAME include-config, so they must bucket identically — historically
 * the outline kept a hand-copied walker that drifted (inline math landed in
 * "Math" there but in the surrounding context bucket canonically), making a
 * category toggle filter different word sets on each surface. Both now
 * consume the one walker in word-count-core; this test pins the canonical
 * bucketing AND per-token parity between the two derivations so any future
 * fork of the walker fails here.
 */

import { describe, it, expect } from "vitest";
import type { JSONContent } from "@tiptap/react";
import {
  ALL_CATEGORIES,
  type Category,
  buildPerBlockCounts,
  computeWordCounts,
  countWords,
  sumIncludedWords,
} from "@/lib/word-count-core";

/** Fixture exercising every categorized construct (per the task contract):
 *  paragraph with inline math + display math + footnote + citation +
 *  latexCommand text with a \caption payload + hardBreak, a heading with
 *  inline math, a latexComment, a nested list, and a code block. */
const doc: JSONContent = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [
        { type: "text", text: "Semantics of " },
        { type: "inlineMath", attrs: { latex: "\\lambda x" } },
      ],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Alpha beta " },
        { type: "inlineMath", attrs: { latex: "E = mc^2" } },
        {
          type: "text",
          text: "\\centering\\caption{Nice figure caption}",
          marks: [{ type: "latexCommand" }],
        },
        { type: "footnote", attrs: { content: "footnote words here" } },
        { type: "citation", attrs: { keys: "burke1969" } },
        { type: "hardBreak" },
        { type: "text", text: "delta" },
      ],
    },
    { type: "displayMath", attrs: { latex: "\\int_0^1 f(x) dx" } },
    {
      type: "latexComment",
      content: [{ type: "text", text: "todo fix this" }],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "list item words" }],
            },
          ],
        },
      ],
    },
    { type: "codeBlock", content: [{ type: "text", text: "code tokens two" }] },
  ],
};

describe("word-count-core canonical bucketing", () => {
  const { categories } = computeWordCounts(doc);

  it("buckets inline math into the surrounding context, not Math", () => {
    // paragraph inline math ("E = mc^2" → 3 tokens) counts as mainText;
    // heading inline math ("\lambda x" → 2 tokens) counts as headings.
    expect(categories.mainText).toBe(
      countWords("Alpha beta E = mc^2   delta list item words code tokens two"),
    );
    expect(categories.headings).toBe(countWords("Semantics of \\lambda x"));
  });

  it("reserves the Math category for displayMath only", () => {
    expect(categories.math).toBe(countWords("\\int_0^1 f(x) dx"));
  });

  it("extracts \\caption payloads from latexCommand runs, skips the rest", () => {
    expect(categories.captions).toBe(countWords("Nice figure caption"));
  });

  it("routes footnote content and comments; ignores citations", () => {
    expect(categories.footnotes).toBe(countWords("footnote words here"));
    expect(categories.comments).toBe(countWords("todo fix this"));
    expect(computeWordCounts(doc).total).toBe(
      ALL_CATEGORIES.reduce((sum, cat) => sum + (categories[cat] ?? 0), 0),
    );
  });
});

describe("panel ↔ outline parity (the task-112 contract)", () => {
  const panelCategories = computeWordCounts(doc).categories;
  const perBlock = buildPerBlockCounts(doc);

  it("per-block sums match the panel's categories for EVERY category", () => {
    for (const cat of ALL_CATEGORIES) {
      const outlineSum = perBlock.reduce((sum, b) => sum + b[cat], 0);
      expect(outlineSum, `category "${cat}"`).toBe(panelCategories[cat] ?? 0);
    }
  });

  it("any single category toggled off filters the same words on both surfaces", () => {
    const allOn = Object.fromEntries(
      ALL_CATEGORIES.map((c) => [c, true]),
    ) as Record<Category, boolean>;
    for (const off of ALL_CATEGORIES) {
      const include = { ...allOn, [off]: false };
      // Word Count panel's filteredTotal derivation (WordCountPanel.tsx)
      const panelFiltered = ALL_CATEGORIES.reduce(
        (sum, cat) => sum + (include[cat] ? (panelCategories[cat] ?? 0) : 0),
        0,
      );
      // Outline per-section derivation over the whole doc
      const outlineFiltered = sumIncludedWords(perBlock, 0, perBlock.length, include);
      expect(outlineFiltered, `with "${off}" off`).toBe(panelFiltered);
    }
  });
});
