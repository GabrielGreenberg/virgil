/**
 * Word-count core — the SINGLE canonical categorization walker shared by the
 * Word Count panel (`useWordCount`), the SELECTION counter
 * (`useSelectionCounts`) and the Outline panel's per-section counts
 * (`buildPerBlockCounts`). Every surface gates on the same
 * `useWordCountConfig` include-set, so they MUST bucket identically or a
 * category toggle silently filters different word sets on each surface
 * (task 112: the outline hand-copy bucketed inline math into "Math" while
 * the canonical walker kept it in the surrounding context bucket).
 *
 * …and it also owns the FILTER, because a walker everyone shares is only half
 * an SSOT while "how many words is that" is answered per consumer. Task 122:
 * the config-filtered total lived as an inline reduce inside `WordCountPanel`,
 * so the Cutter goal strip and the selection counter — which had no reduce of
 * their own — read the precomputed unfiltered `total` instead and "words"
 * meant two different things one panel apart. Both halves are here now:
 * `collectCategoryParts` decides WHICH bucket, `includedTotals` decides which
 * buckets COUNT.
 *
 * Canonical bucketing rules:
 *   - inline math counts toward the SURROUNDING CONTEXT bucket (mainText in
 *     a paragraph, headings in a heading) — "Math" = displayMath only;
 *   - text marked `latexCommand` / `latexVerbatim` is raw LaTeX, not prose — only its
 *     `\caption{...}` payloads count (as captions);
 *   - citations are reference markers, never prose;
 *   - footnote content → footnotes, latexComment text → comments.
 *
 * Pure module: no React, no DOM — operates on TipTap JSONContent so the
 * PmNode consumer (`useWordCount`) converts via `doc.toJSON()` inside its
 * already-debounced recount (off the keystroke path).
 */

import type { JSONContent } from "@tiptap/react";
import { LATEX_VERBATIM_MARK } from "@/lib/latex-lexer";

export type Category =
  | "mainText"
  | "headings"
  | "footnotes"
  | "captions"
  | "math"
  | "comments";

export const ALL_CATEGORIES: Category[] = [
  "mainText",
  "headings",
  "footnotes",
  "captions",
  "math",
  "comments",
];

export const CATEGORY_LABELS: Record<Category, string> = {
  mainText: "Main Text",
  headings: "Headings",
  footnotes: "Footnotes",
  captions: "Captions",
  math: "Math",
  comments: "Comments",
};

/** The user's per-category include-set (`useWordCountConfig`). */
export type IncludeSet = Record<Category, boolean>;

/**
 * Per-category tallies — THE shape every word-count surface carries, for the
 * whole document AND for a selection (they are the same kind of thing, so
 * they are the same type: one producer per scope, one filter for both).
 *
 * There is deliberately NO precomputed `total`/`characters` here. "How many
 * words" is a live function of the include-config, so it is resolved at READ
 * time through `includedTotals` and never frozen onto the record — a stored
 * copy of an app-state-dependent value cannot be wrong when written and cannot
 * be right afterwards, and the one that existed (`WordCounts.total`) is
 * exactly what the Cutter goal and the selection counter read instead of
 * asking the filter (task 122). Making it unrepresentable is the guard: a
 * consumer can no longer reach an unfiltered total by accident, only by
 * summing `ALL_CATEGORIES` itself — which the census in
 * `word-count-filter-ssot.test.ts` forbids outside this module.
 */
export interface CategoryCounts {
  /** Per-category word counts. */
  words: Record<Category, number>;
  /** Per-category NON-WHITESPACE character counts, exactly parallel to `words`
   *  — so the headline "chars" filters through the same include-set that
   *  drives "words" and the two stats never disagree on scope (task 121). */
  characters: Record<Category, number>;
}

const zeroByCategory = (): Record<Category, number> =>
  Object.fromEntries(ALL_CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;

/** Shared empty tally — the doc-open / flag-off / no-editor placeholder every
 *  surface used to hand-write as its own literal (three copies, one per host). */
export const EMPTY_CATEGORY_COUNTS: CategoryCounts = Object.freeze({
  words: Object.freeze(zeroByCategory()),
  characters: Object.freeze(zeroByCategory()),
});

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Extract plain text from `\caption{...}` commands inside raw LaTeX strings
 * (e.g. from unknown environments like figure/table). Handles nested braces.
 */
export function extractCaptionText(raw: string): string[] {
  const results: string[] = [];
  let i = 0;
  while (i < raw.length) {
    const idx = raw.indexOf("\\caption", i);
    if (idx === -1) break;
    let pos = idx + "\\caption".length;
    // skip optional star
    if (pos < raw.length && raw[pos] === "*") pos++;
    // skip optional [...]
    if (pos < raw.length && raw[pos] === "[") {
      const close = raw.indexOf("]", pos);
      if (close !== -1) pos = close + 1;
    }
    // expect {
    if (pos < raw.length && raw[pos] === "{") {
      let depth = 1;
      const start = pos + 1;
      pos++;
      while (pos < raw.length && depth > 0) {
        if (raw[pos] === "\\" && pos + 1 < raw.length) {
          pos += 2; // skip escaped char
          continue;
        }
        if (raw[pos] === "{") depth++;
        else if (raw[pos] === "}") depth--;
        if (depth > 0) pos++;
      }
      if (depth === 0) {
        // Strip inner LaTeX commands to get plain text
        const inner = raw.slice(start, pos);
        const plain = inner
          .replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])*\{([^}]*)\}/g, "$2") // \cmd{text} → text
          .replace(/\\[a-zA-Z]+\*?/g, "") // bare \commands
          .replace(/[{}]/g, "") // leftover braces
          .trim();
        if (plain) results.push(plain);
      }
    }
    i = pos + 1;
  }
  return results;
}

/** All descendant text of a JSON node, concatenated (PmNode.textContent). */
function flattenText(n: JSONContent): string {
  if (n.text) return n.text;
  return (n.content ?? []).map(flattenText).join("");
}

/**
 * Walk a JSON doc (or any block subtree) and collect its raw text parts per
 * category. THE canonical walker — every categorized word-count surface
 * derives from this.
 */
export function collectCategoryParts(node: JSONContent): Record<Category, string[]> {
  const cats: Record<Category, string[]> = {
    mainText: [],
    headings: [],
    footnotes: [],
    captions: [],
    math: [],
    comments: [],
  };

  const collectInline = (n: JSONContent, bucket: string[]) => {
    if (n.type === "text" && n.text) {
      // Text marked as latexCommand — or as the byte-literal `latexVerbatim`
      // carrier — is raw LaTeX, not prose.
      // Extract any \caption{...} text into captions, skip the rest.
      if (
        n.marks?.some(
          (m) =>
            m.type === "latexCommand" || m.type === LATEX_VERBATIM_MARK,
        )
      ) {
        for (const c of extractCaptionText(n.text)) cats.captions.push(c);
        return;
      }
      bucket.push(n.text);
      return;
    }
    if (n.type === "inlineMath") {
      // Inline math reads as part of the sentence → surrounding context
      // bucket. The "math" category is displayMath only.
      const latex = (n.attrs?.latex as string) || "";
      if (latex) bucket.push(latex);
      return;
    }
    if (n.type === "citation") return; // reference markers, not prose
    if (n.type === "footnote") {
      const content = (n.attrs?.content as string) || "";
      if (content) cats.footnotes.push(content);
      return;
    }
    if (n.type === "hardBreak") {
      bucket.push(" ");
      return;
    }
    for (const child of n.content ?? []) collectInline(child, bucket);
  };

  const walkBlock = (n: JSONContent, ctx: Category) => {
    switch (n.type) {
      case "heading":
        collectInline(n, cats.headings);
        return;
      case "blockquote":
      case "bulletList":
      case "orderedList":
      case "listItem":
        for (const child of n.content ?? []) walkBlock(child, ctx);
        return;
      case "displayMath": {
        const latex = (n.attrs?.latex as string) || "";
        if (latex) cats.math.push(latex);
        return;
      }
      case "latexComment": {
        const text = flattenText(n);
        if (text) cats.comments.push(text);
        return;
      }
      case "paragraph":
      case "codeBlock": // code blocks count as surrounding context
        collectInline(n, cats[ctx]);
        return;
      default:
        // doc, titleField, maketitleMarker, horizontalRule, etc.
        for (const child of n.content ?? []) walkBlock(child, ctx);
        return;
    }
  };

  walkBlock(node, "mainText");
  return cats;
}

/** Per-category WORD counts for one block (or any subtree). Deliberately not
 *  `computeCategoryCounts(node).words`: the per-block path runs once per block
 *  of the document, and the character pass costs a whole-text copy per
 *  category that the Outline never reads. Same walker either way — this is a
 *  cheaper projection of it, not a second rule. */
export function countCategories(node: JSONContent): Record<Category, number> {
  const parts = collectCategoryParts(node);
  const out = {} as Record<Category, number>;
  for (const cat of ALL_CATEGORIES) {
    out[cat] = countWords(parts[cat].join(" "));
  }
  return out;
}

/**
 * Precompute per-top-level-block category word counts so per-heading section
 * sums are O(blocks) instead of O(blocks × headings).
 */
export function buildPerBlockCounts(doc: JSONContent | null): Record<Category, number>[] {
  if (!doc?.content) return [];
  return doc.content.map((node) => countCategories(node));
}

/**
 * THE summation rule: add up one tally record over the INCLUDED categories.
 *
 * Module-private on purpose — publish whole operations, never the pieces. An
 * exported `sumIncluded` is an invitation for the next consumer to re-derive
 * "the total" from `counts.words` on its own, which is the fork this module
 * exists to close.
 */
function sumIncluded(
  per: Record<Category, number> | undefined,
  include: IncludeSet,
): number {
  if (!per) return 0;
  let total = 0;
  for (const cat of ALL_CATEGORIES) {
    if (include[cat]) total += per[cat] ?? 0;
  }
  return total;
}

/**
 * THE filter door — the only way to turn per-category tallies into the two
 * headline numbers. Words and characters come back TOGETHER, from one
 * include-set read, so a surface cannot filter one and not the other.
 *
 * `null` counts (no selection yet, no editor) resolve to zeros so callers
 * render `0` without a second branch.
 */
export function includedTotals(
  counts: CategoryCounts | null | undefined,
  include: IncludeSet,
): { words: number; characters: number } {
  return {
    words: sumIncluded(counts?.words, include),
    characters: sumIncluded(counts?.characters, include),
  };
}

export function sumIncludedWords(
  perBlock: Record<Category, number>[],
  fromIdx: number,
  toIdx: number, // exclusive
  include: IncludeSet,
): number {
  let total = 0;
  for (let i = fromIdx; i < toIdx; i++) {
    total += sumIncluded(perBlock[i], include);
  }
  return total;
}

/**
 * Per-category counts for a whole doc — or for any subtree, which is how the
 * SELECTION counter derives from this same walker (`useSelectionCounts` cuts
 * the selection out with `doc.slice(from, to, true)` and hands the block
 * fragment straight here, rather than keeping the parallel flat-text walker it
 * used to have).
 *
 * Join separators are whitespace, so they're stripped and don't affect the
 * per-category character count.
 */
export function computeCategoryCounts(doc: JSONContent): CategoryCounts {
  const cats = collectCategoryParts(doc);

  const words = {} as Record<Category, number>;
  const characters = {} as Record<Category, number>;

  for (const cat of ALL_CATEGORIES) {
    const joined = cats[cat].join(" ");
    words[cat] = countWords(joined);
    characters[cat] = joined.replace(/\s/g, "").length;
  }

  return { words, characters };
}
