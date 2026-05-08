import { Extension, InputRule } from "@tiptap/core";

/**
 * Convert straight `"` to smart curly quotes at type time.
 *
 * - At start of a text run, or right after whitespace / opening punctuation:
 *   the typed `"` becomes `“` (U+201C, opening).
 * - Otherwise: it becomes `”` (U+201D, closing).
 *
 * The smart quotes then serialize to `` `` `` / `''` via `escapeLatex` in
 * `latex-serializer.ts` — so the source `.tex` always emits a compile-able
 * LaTeX quote pair regardless of how the quote was entered. Doing the
 * conversion at type time also bypasses any `latexCommand` mark inheritance
 * that would otherwise let a raw `"` through to the .tex.
 *
 * Apostrophes (`'`) are intentionally untouched — straight apostrophes are
 * the only sane representation for contractions like "don't", and LaTeX
 * accepts them verbatim.
 */
export const SmartQuotes = Extension.create({
  name: "smartQuotes",

  addInputRules() {
    return [
      new InputRule({
        find: /(^|[\s([{—–—–])"$/,
        handler: ({ state, range, match }) => {
          const lead = match[1] ?? "";
          state.tr.insertText(`${lead}“`, range.from, range.to);
        },
      }),
      new InputRule({
        find: /"$/,
        handler: ({ state, range }) => {
          state.tr.insertText("”", range.from, range.to);
        },
      }),
    ];
  },
});
