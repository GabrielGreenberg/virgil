/**
 * Task 112 — word-count categorization SSOT.
 *
 * The Word Count panel (`computeCategoryCounts` via useWordCount), the
 * selection counter and the Outline panel's per-section counts
 * (`buildPerBlockCounts`/`sumIncludedWords`) gate
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
  type IncludeSet,
  blockCategoryCounts,
  buildPerBlockCounts,
  categoryCountsEqual,
  computeCategoryCounts,
  getBlockTallyCacheStats,
  countWords,
  includedTotals,
  sumIncludedWords,
} from "@/lib/word-count-core";
import { LATEX_COMMENT_TAIL_MARK, LATEX_VERBATIM_MARK } from "@/lib/latex-lexer";

const ALL_ON = Object.fromEntries(
  ALL_CATEGORIES.map((c) => [c, true]),
) as IncludeSet;

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
        // The REAL footnote shape: rich JSONContent (task 767 — the old
        // string fixture is what masked "[object Object]" = 2 words).
        {
          type: "footnote",
          attrs: {
            content: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "footnote words here" }],
                },
              ],
            },
          },
        },
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
  const { words: categories } = computeCategoryCounts(doc);

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
    // Everything-included is the whole document — asked through the ONE
    // filter door, since there is no precomputed total to compare against
    // any more (task 122).
    expect(includedTotals(computeCategoryCounts(doc), ALL_ON).words).toBe(
      ALL_CATEGORIES.reduce((sum, cat) => sum + (categories[cat] ?? 0), 0),
    );
  });
});

describe("panel ↔ outline parity (the task-112 contract)", () => {
  const panelCategories = computeCategoryCounts(doc).words;
  const perBlock = buildPerBlockCounts(doc);

  it("per-block sums match the panel's categories for EVERY category", () => {
    for (const cat of ALL_CATEGORIES) {
      const outlineSum = perBlock.reduce((sum, b) => sum + b[cat], 0);
      expect(outlineSum, `category "${cat}"`).toBe(panelCategories[cat] ?? 0);
    }
  });

  it("any single category toggled off filters the same words on both surfaces", () => {
    for (const off of ALL_CATEGORIES) {
      const include = { ...ALL_ON, [off]: false };
      // Word Count panel headline — through the shared filter door, which is
      // what the panel itself now calls (it used to hand-roll this reduce, and
      // that is exactly why its siblings couldn't share it).
      const panelFiltered = includedTotals(
        computeCategoryCounts(doc),
        include,
      ).words;
      // Outline per-section derivation over the whole doc
      const outlineFiltered = sumIncludedWords(perBlock, 0, perBlock.length, include);
      expect(outlineFiltered, `with "${off}" off`).toBe(panelFiltered);
    }
  });
});

describe("per-category character parity (the task-121 contract)", () => {
  // Chars are now a per-category quantity in the SSOT, exactly parallel to
  // words — the panel's headline "chars" filters this by the SAME include-set
  // that drives "words", so the two stats never disagree on scope (before the
  // fix, "chars" always counted every category, incl. comments which the
  // default config excludes).
  const counts = computeCategoryCounts(doc);
  const characterCategories = counts.characters;
  const characters = includedTotals(counts, ALL_ON).characters;

  it("per-category characters sum to the everything-included total", () => {
    const sum = ALL_CATEGORIES.reduce(
      (acc, cat) => acc + (characterCategories[cat] ?? 0),
      0,
    );
    expect(sum).toBe(characters);
  });

  it("every category has some characters (the fixture exercises all six)", () => {
    for (const cat of ALL_CATEGORIES) {
      expect(characterCategories[cat] ?? 0, `category "${cat}"`).toBeGreaterThan(0);
    }
  });

  it("an included-set filter over chars matches the panel's headline derivation", () => {
    // Mirror of the filteredTotal parity test: toggling each category off must
    // drop the panel's filtered chars by exactly that category's characters —
    // the same include-set, and now literally the same call, that drives the
    // filtered words figure.
    for (const off of ALL_CATEGORIES) {
      const include = { ...ALL_ON, [off]: false };
      expect(
        includedTotals(counts, include).characters,
        `with "${off}" off`,
      ).toBe(characters - (characterCategories[off] ?? 0));
    }
  });
});

// ── task 767: the walker's vocabulary is the SCHEMA's, not a name list ──────

const para = (text: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const words = (d: JSONContent) => computeCategoryCounts(d).words;

describe("footnote bodies are WALKED, not stringified (task 767)", () => {
  it("a rich JSON footnote counts its real words and characters", () => {
    const d: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Main" },
            {
              type: "footnote",
              attrs: {
                content: {
                  type: "doc",
                  content: [para("seven words live inside this long footnote")],
                },
              },
            },
          ],
        },
      ],
    };
    const c = computeCategoryCounts(d);
    expect(c.words.footnotes).toBe(7);
    expect(c.characters.footnotes).toBe(
      "sevenwordsliveinsidethislongfootnote".length,
    );
    expect(c.words.mainText).toBe(1);
  });

  it("inline math / citations inside a footnote follow the main-text rules", () => {
    const d: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "footnote",
              attrs: {
                content: {
                  type: "doc",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        { type: "text", text: "see " },
                        { type: "citation", attrs: { keys: "x" } },
                        { type: "text", text: " where " },
                        { type: "inlineMath", attrs: { latex: "x" } },
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
    const w = words(d);
    expect(w.footnotes).toBe(3); // see / where / x — the citation adds nothing
    expect(w.math).toBe(0);
  });

  it("a LEGACY string footnote body still counts", () => {
    const d: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "footnote", attrs: { content: "legacy plain words" } },
          ],
        },
      ],
    };
    expect(words(d).footnotes).toBe(3);
  });
});

describe("textblocks the old switch never named now count (task 767)", () => {
  const d: JSONContent = {
    type: "doc",
    content: [
      {
        type: "titleField",
        attrs: { field: "title" },
        content: [{ type: "text", text: "A five word title here" }],
      },
      para("three main words"),
      {
        type: "figureBlock",
        content: [
          {
            type: "figureCaption",
            content: [{ type: "text", text: "native caption text" }],
          },
        ],
      },
      {
        type: "exampleBlock",
        content: [
          {
            type: "exampleGloss",
            content: [
              {
                type: "alignedGlossRow",
                content: [
                  { type: "glossCell", content: [{ type: "text", text: "a" }] },
                  { type: "glossCell", content: [{ type: "text", text: "b" }] },
                ],
              },
            ],
          },
          {
            type: "proseGlossRow",
            content: [{ type: "text", text: "free translation words" }],
          },
        ],
      },
    ],
  };
  const w = words(d);
  it("titleField → headings", () => expect(w.headings).toBe(5));
  it("native figureCaption → captions", () => expect(w.captions).toBe(3));
  it("gloss rows and cells → the surrounding context", () =>
    expect(w.mainText).toBe(3 + 2 + 3));
});

describe("a word split by a mark change is ONE word (task 767)", () => {
  it("adjacent text runs glue; an atom between them still separates", () => {
    const d: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "un" },
            { type: "text", text: "believ", marks: [{ type: "bold" }] },
            { type: "text", text: "able words" },
            { type: "inlineMath", attrs: { latex: "x" } },
            { type: "text", text: "tail" },
          ],
        },
        para("next"),
      ],
    };
    // unbelievable / words / x / tail / next
    expect(words(d).mainText).toBe(5);
  });
});

describe("whole-doc tally = sum of cached per-block tallies (task 1479)", () => {
  // Every construct whose glue/separator handling could make the tally
  // NON-additive across block boundaries: adjacent-mark text runs (glued
  // within a block), heading → heading, prose → prose with no trailing space,
  // comment tails, verbatim carriers, hard breaks, inline/display math,
  // footnotes, nested containers.
  const blocks = (): JSONContent[] => [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "First" }] },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "head" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "glu" },
        { type: "text", text: "ed", marks: [{ type: "bold" }] },
        { type: "text", text: " word" },
        { type: "hardBreak" },
        { type: "text", text: "after" },
        { type: "inlineMath", attrs: { latex: "a+b" } },
        { type: "text", text: "% tail words", marks: [{ type: LATEX_COMMENT_TAIL_MARK }] },
      ],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "next" },
        { type: "text", text: "\\verb|x| \\caption{Cap here}", marks: [{ type: LATEX_VERBATIM_MARK }] },
        {
          type: "footnote",
          attrs: {
            content: {
              type: "doc",
              content: [{ type: "paragraph", content: [{ type: "text", text: "fn body" }] }],
            },
          },
        },
      ],
    },
    { type: "displayMath", attrs: { latex: "x^2" } },
    { type: "latexComment", content: [{ type: "text", text: "a comment" }] },
    ...(doc.content ?? []),
  ];

  it("summed per-block tallies equal the DIRECT walk for every category", () => {
    const content = blocks();
    const summed = computeCategoryCounts({ type: "doc", content });
    // A non-doc container is walked directly (same mainText context as doc).
    const direct = computeCategoryCounts({ type: "blockquote", content });
    expect(summed).toEqual(direct);
    expect(categoryCountsEqual(summed, direct)).toBe(true);
    // Non-vacuous: the fixture exercises every category.
    for (const cat of ALL_CATEGORIES) expect(direct.words[cat], cat).toBeGreaterThan(0);
  });

  it("a second pass over the same block objects is all cache hits", () => {
    const content = blocks();
    const docJson: JSONContent = { type: "doc", content };
    const first = computeCategoryCounts(docJson);
    const before = getBlockTallyCacheStats();
    const again = computeCategoryCounts(docJson);
    buildPerBlockCounts(docJson);
    const after = getBlockTallyCacheStats();
    expect(after.misses).toBe(before.misses);
    expect(after.hits - before.hits).toBe(content.length * 2);
    expect(categoryCountsEqual(first, again)).toBe(true);

    // Replacing ONE block recounts exactly that block.
    const edited = [...content];
    edited[2] = { type: "paragraph", content: [{ type: "text", text: "changed now" }] };
    const b2 = getBlockTallyCacheStats();
    computeCategoryCounts({ type: "doc", content: edited });
    expect(getBlockTallyCacheStats().misses - b2.misses).toBe(1);
  });

  it("per-block records are the cached tallies' words, frozen", () => {
    const content = blocks();
    const per = buildPerBlockCounts({ type: "doc", content });
    expect(per[0]).toBe(blockCategoryCounts(content[0]).words);
    expect(Object.isFrozen(per[0])).toBe(true);
  });
});
