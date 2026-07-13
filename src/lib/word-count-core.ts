/**
 * Word-count core — the SINGLE canonical categorization walker shared by the
 * Word Count panel (`useWordCount`) and the Outline panel's per-section
 * counts (`buildPerBlockCounts`). Both surfaces gate on the same
 * `useWordCountConfig` include-set, so they MUST bucket identically or a
 * category toggle silently filters different word sets on each surface
 * (task 112: the outline hand-copy bucketed inline math into "Math" while
 * the canonical walker kept it in the surrounding context bucket).
 *
 * Canonical bucketing rules:
 *   - inline math counts toward the SURROUNDING CONTEXT bucket (mainText in
 *     a paragraph, headings in a heading) — "Math" = displayMath only;
 *   - text marked `latexCommand` is raw LaTeX, not prose — only its
 *     `\caption{...}` payloads count (as captions);
 *   - citations are reference markers, never prose;
 *   - footnote content → footnotes, latexComment text → comments.
 *
 * Pure module: no React, no DOM — operates on TipTap JSONContent so the
 * PmNode consumer (`useWordCount`) converts via `doc.toJSON()` inside its
 * already-debounced recount (off the keystroke path).
 */

import type { JSONContent } from "@tiptap/react";

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

export interface WordCounts {
  total: number;
  characters: number;
  sentences: number;
  readingTime: string;
  /** Per-category word counts (the include-config filters these for the headline). */
  categories: Record<string, number>;
  /**
   * Per-category NON-WHITESPACE character counts, exactly parallel to
   * `categories`. The panel's headline "chars" filters this by the same
   * include-set that drives "words", so the two stats never disagree on scope
   * (task 121). `characterCategories` sums to `characters` over ALL_CATEGORIES.
   */
  characterCategories: Record<string, number>;
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function countSentences(text: string): number {
  const matches = text.match(/[.!?]+[\s"'”’)}\]]*(?=[A-ZÀ-ɏ]|\s*$)/g);
  return matches ? matches.length : text.trim() ? 1 : 0;
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
      // Text marked as latexCommand is raw LaTeX — not prose.
      // Extract any \caption{...} text into captions, skip the rest.
      if (n.marks?.some((m) => m.type === "latexCommand")) {
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

/** Per-category word counts for one block (or any subtree). */
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

export function sumIncludedWords(
  perBlock: Record<Category, number>[],
  fromIdx: number,
  toIdx: number, // exclusive
  include: Record<Category, boolean>,
): number {
  let total = 0;
  for (let i = fromIdx; i < toIdx; i++) {
    const counts = perBlock[i];
    if (!counts) continue;
    for (const cat of ALL_CATEGORIES) {
      if (include[cat]) total += counts[cat];
    }
  }
  return total;
}

/** Full-document counts for the Word Count panel (doc = `editor.state.doc.toJSON()`). */
export function computeWordCounts(doc: JSONContent): WordCounts {
  const cats = collectCategoryParts(doc);

  const allText: string[] = [];
  const categories: Record<string, number> = {};
  const characterCategories: Record<string, number> = {};

  for (const cat of ALL_CATEGORIES) {
    const joined = cats[cat].join(" ");
    categories[cat] = countWords(joined);
    // Non-whitespace chars for this category, mirroring the whole-doc rule
    // below. Join separators are whitespace, so they're stripped and don't
    // affect the per-category count — the sum over categories equals the
    // whole-doc `characters` exactly (pinned in word-count-core.test.ts).
    characterCategories[cat] = joined.replace(/\s/g, "").length;
    if (joined.trim()) allText.push(joined);
  }

  const fullText = allText.join(" ");
  const total = countWords(fullText);
  const characters = fullText.replace(/\s/g, "").length;
  const sentences = countSentences(fullText);
  const minutes = Math.max(1, Math.round(total / 225));
  const readingTime = minutes === 1 ? "1 min" : `${minutes} min`;

  return { total, characters, sentences, readingTime, categories, characterCategories };
}
