import { Extension, InputRule } from "@tiptap/core";

/**
 * Type-time typographic input rules: smart curly quotes and en/em dashes.
 *
 * Quotes:
 * - At start of a text run, or right after whitespace / opening punctuation:
 *   the typed `"` becomes `“` (U+201C, opening).
 * - Otherwise: it becomes `”` (U+201D, closing).
 *
 * Dashes (following the LaTeX convention that the parse/serialize round-trip
 * already encodes — see `dashesToGlyphs` / `typographyToLatex`):
 * - `--` → `–` (en dash, U+2013)
 * - `---` → `—` (em dash, U+2014)
 *   Because `--` converts to `–` the instant the second hyphen is typed, the
 *   third hyphen arrives as `–` + `-`, so the em-dash rule matches `–-` (and,
 *   defensively, a literal `---` should one ever reach the rule intact).
 *
 * These glyphs then serialize back to `--` / `---` via `typographyToLatex` in
 * `latex-serializer.ts`, so the source `.tex` round-trips byte-for-byte
 * regardless of how the dash was entered.
 *
 * Scoping: all of these rules ride TipTap's `inputRulesPlugin`, which refuses
 * to fire inside a `code`-spec NODE or on text carrying a `code`-spec MARK.
 * Math is an `atom` node with no editable ProseMirror text, so an input rule
 * can't fire inside it either. That is what "gated to exclude code / math /
 * verbatim" means here — the framework does it; we don't re-check per rule,
 * and adding a fourth typographic rule below inherits the gate by riding the
 * same plugin.
 *
 * The gate is only as complete as the DECLARATIONS it reads, and until task
 * 512 one was missing: `latexComment` declared `marks: ""` (byte-literal
 * container) and NOT `code`, so every rule here fired inside a `%` comment
 * block and wrote curly quotes and en/em dashes into the comment's own source
 * bytes. It declares both now, and `prose-index.test.ts` pins that the two
 * spellings of "byte-literal container" — a markless textblock, and a `code`
 * textblock — are the same set, so a future verbatim node kind is gated by
 * shipping rather than by someone remembering this file.
 *
 * The MARK half is deliberately asymmetric and must stay so: `latexVerbatim`
 * and `latexCommentTail` are `code` (measured — a `"` typed inside either run
 * is left literal), while `latexCommand` is deliberately NOT, because
 * smartening a quote typed into a stray inherited command span is what keeps
 * it emitting valid `.tex` (`latex-command.ts` says so in place). Do not
 * "unify" that away.
 *
 * Doing the conversion at type time also bypasses any `latexCommand` mark
 * inheritance that would otherwise let a raw `"` / `--` through to the .tex.
 *
 * Apostrophes (`'`) are intentionally untouched — straight apostrophes are
 * the only sane representation for contractions like "don't", and LaTeX
 * accepts them verbatim.
 */
const EN_DASH = "–"; // –
const EM_DASH = "—"; // —

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
      // Em dash — must precede the en-dash rule so `–-` (the incremental
      // third-hyphen case) and any intact `---` win over a bare `--` match.
      new InputRule({
        find: /(?:---|–-)$/,
        handler: ({ state, range }) => {
          state.tr.insertText(EM_DASH, range.from, range.to);
        },
      }),
      // En dash — fires on the second hyphen.
      new InputRule({
        find: /--$/,
        handler: ({ state, range }) => {
          state.tr.insertText(EN_DASH, range.from, range.to);
        },
      }),
    ];
  },
});
