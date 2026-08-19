/**
 * The single source of truth for Virgil's LaTeX lexical layer.
 *
 * This leaf module sits directly above `latex-typography.ts` (a zero-import
 * leaf) and below `latex-requirements.ts`, `document-class.ts`, and
 * `latex-parser.ts`. It consolidates the comment/verbatim-inertness
 * projection and the brace/environment scanners that were previously
 * duplicated across those three call sites, so a construct's lexing lives in
 * ONE place.
 *
 * Two capability groups:
 *
 *  (a) Projection — `projectLiveLatex(src, opts)`: a comment- and
 *      verbatim-aware projection that generalizes the two former duplicates
 *      (`projectDetectableBody` in latex-requirements.ts and
 *      `stripCommentsAndVerbatim` in document-class.ts). The verbatim family
 *      and inline-`\verb` handling are parameterized so the requirements side
 *      keeps its NARROW `verbatim`/`verbatim*` coverage (byte-identical to
 *      today) while document-class gets the FULL family plus a
 *      boundary-correct inline `\verb` matcher.
 *
 *  (b) Scanners — position-based `findMatchingBrace`/`extractBraced`, the
 *      construct terminators `findMatchingEnv`/`findMatchingGloss`/
 *      `findMatchingXe`, and a greedy `matchCommandToken`, consolidating the
 *      parser's copies. `matchAccent`/`matchSpecialLetter` are re-exported so
 *      consumers import them from one place.
 *
 *      All three terminators run ONE forward scan (`scanLive`) over ONE
 *      nesting vocabulary (`skipOpaqueConstructAt`), so they cannot drift on
 *      what is opaque to them — which is exactly what the parser's three
 *      private copies had done: two were comment-blind, none knew about
 *      `\begin{env}` in general, and the body splitters that asked the same
 *      question carried a third and fourth answer (task 338).
 *
 * Imports ONLY latex-typography, latex-markers and heading-types (all leaves)
 * to avoid a cycle.
 */

import {
  matchAccent,
  matchSpecialLetter,
  isEscaped,
  findUnescaped,
  matchCharEscapeAt,
} from "@/lib/latex-typography";
import { BLOCK_TEX_MARKERS } from "@/lib/latex-markers";
import { HEADING_TYPES } from "@/lib/heading-types";

export { matchAccent, matchSpecialLetter };

/**
 * Re-export of THE delimiter-escape rule (defined in the zero-import leaf
 * `latex-typography.ts`, see its doc comment). Every scanner in the codebase —
 * brace, math-delimiter, comment, gloss — asks this ONE question, so
 * backslash-run parity is decided in exactly one place (task 206).
 *
 * `findUnescaped` is its closing-side twin — "where is the next REAL delimiter?"
 * — so the math-close searches resolve through the same SSOT parity rule as the
 * opening check rather than an escape-blind `indexOf` (task 210).
 */
export { isEscaped, findUnescaped };

// ---------------------------------------------------------------------------
// Verbatim families
// ---------------------------------------------------------------------------

/** The NARROW verbatim family — what save-time requirements detection uses.
 *  Kept exactly as today so `projectDetectableBody` stays byte-identical. */
export const VERBATIM_ENVS_NARROW = ["verbatim", "verbatim*"] as const;

/**
 * The FULL verbatim family — environments whose body **does not execute as
 * LaTeX**. Membership grants three things, and the criterion is exactly what
 * those three need:
 *
 *  1. first-close-wins end-finding (`findMatchingEnv` — depth counting is
 *     actively wrong for a non-nestable literal env, see there);
 *  2. INERTNESS to every scanner that projects live LaTeX out of source
 *     (`projectLiveLatex` → document-class detection, `\label`/`\ref`
 *     resolution, the syntax checker's brace/math/env balance);
 *  3. the `codeBlock` node for bare `verbatim`.
 *
 * It does **not** decide byte-literalness of the round trip any more: since
 * task 342 every environment Virgil doesn't model rides the byte-literal
 * carrier by DEFAULT (`latex-parser.ts`, the `default:` env branch), so a
 * member added or forgotten here can no longer cost the user their bytes.
 *
 * `Verbatim`/`BVerbatim`/`LVerbatim` (+ starred) are fancyvrb's — `Verbatim`
 * is the commonest verbatim env in real academic LaTeX after bare `verbatim`.
 * `comment` (the `comment` package) is a body LaTeX discards wholesale, so
 * scanning it for structure was always wrong: a commented-out
 * `\documentclass`, `\label` or unbalanced brace must not count.
 *
 * `alltt` is deliberately NOT a member. It looks verbatim and isn't: `\`, `{`
 * and `}` keep their meanings inside it, so its `\ref`s are real references
 * and its braces are real braces. It still round-trips byte-for-byte through
 * the default carrier — which is the whole point of making that the default.
 */
export const VERBATIM_ENVS_FULL = [
  "verbatim",
  "verbatim*",
  "lstlisting",
  "minted",
  "Verbatim",
  "Verbatim*",
  "BVerbatim",
  "BVerbatim*",
  "LVerbatim",
  "LVerbatim*",
  "comment",
] as const;

/**
 * THE membership test for the family above. Exported so no consumer
 * re-enumerates the list or re-casts it to `readonly string[]` — the parser,
 * the syntax checker and `findMatchingEnv` all ask here (task 342).
 */
export function isVerbatimFamilyEnv(envName: string): boolean {
  return (VERBATIM_ENVS_FULL as readonly string[]).includes(envName);
}

// ---------------------------------------------------------------------------
// The verbatim CARRIER — one mark for "these bytes are literal" (task 264)
// ---------------------------------------------------------------------------
//
// Verbatim content is byte-literal by LaTeX's own grammar: inside `\verb|…|`
// or a `VERBATIM_ENVS_FULL` body, a `"` is a straight ASCII quote, `--` is two
// hyphens, and `\'e` is a backslash followed by two letters. So the serializer
// must emit those bytes EXACTLY as parsed — no char-escaping, and crucially no
// typographic reverse-map.
//
// Before task 264 the parser carried both of these on the undifferentiated
// `latexCommand` mark, whose serializer path runs `smartenStraightQuotes`. That
// smartening is INTENTIONAL there (a `latexCommand` mark TipTap inherited onto
// stray prose should still round-trip to valid `.tex`), so verbatim content got
// silently corrupted on the FIRST save: `print("hi")` → ``print(``hi'')``,
// durably, and — the env being verbatim — visibly wrong in the compiled PDF.
//
// `latexVerbatim` is that second carrier. It is a SEPARATE mark rather than an
// attr on `latexCommand` for two reasons: (1) ProseMirror's `Mark.toJSON()`
// emits an `attrs` key as soon as a mark type declares ANY attribute, which
// would have changed the JSON shape of every existing `latexCommand` mark and
// broken the two production `JSON.stringify` identity checks that compare
// live-editor JSON against parser-produced JSON (`RichTextField`'s external
// value sync, `useDocument`'s anchor-commit dedupe); (2) two DIFFERENT mark
// types can never be merged into one text node by ProseMirror, so a verbatim
// run abutting a stray `latexCommand` run stays distinguishable — an attr on
// one shared type would fuse under mark inheritance.
//
// The mark is re-derived from the source bytes on every parse, so it needs no
// representation in the `.tex` and nothing to migrate.

/** Mark name for BYTE-LITERAL raw LaTeX (a `\verb` run or a verbatim-family
 *  env). The string lives here — beside the family SSOT and reachable from the
 *  tiptap-free parser/serializer modules — and the TipTap `Mark.create` in
 *  `src/lib/tiptap/latex-command.ts` reads it. */
export const LATEX_VERBATIM_MARK = "latexVerbatim";

/** The mark object every verbatim-emitting parser branch pushes. */
export function verbatimMark(): { type: string } {
  return { type: LATEX_VERBATIM_MARK };
}

/**
 * THE `verbatim` env body ↔ `.tex` pair, spelled once (task 338).
 *
 * A body line reading `\end{verbatim}` would close the environment early, so
 * it is escaped to a private form that breaks the delimiter substring and
 * un-escaped on the way back in. The single wrapping `\n` on each side is part
 * of the same contract — a blunt `.trim()` on the read side would drop
 * first-line indentation and blank lines every cycle.
 *
 * Three call sites must agree byte-for-byte: the serializer's `codeBlock`
 * emit, the parser's `case "verbatim"` read, and the example-item builder,
 * which cannot hold a `codeBlock` and so preserves one as a byte-literal
 * carrier paragraph. When those three were separate spellings the third did
 * not exist at all — the block was silently DROPPED.
 */
export function wrapVerbatimEnvBody(inner: string): string {
  const escaped = inner.replace(/\\end\{verbatim\}/g, "\\end{verbatim%!v-esc}");
  return `\\begin{verbatim}\n${escaped}\n\\end{verbatim}`;
}

/** Inverse of {@link wrapVerbatimEnvBody}: takes the raw env CONTENT (what
 *  sits between `\begin{verbatim}` and `\end{verbatim}`) and returns the body
 *  bytes. */
export function unwrapVerbatimEnvBody(envContent: string): string {
  let text = envContent;
  if (text.startsWith("\n")) text = text.slice(1);
  if (text.endsWith("\n")) text = text.slice(0, -1);
  return text.replace(/\\end\{verbatim%!v-esc\}/g, "\\end{verbatim}");
}

/** True when a mark list carries the verbatim carrier — the ONE test every
 *  serializer consults before running any typographic transform. */
export function hasVerbatimMark(
  marks: readonly { type: string }[] | undefined,
): boolean {
  return !!marks?.some((m) => m.type === LATEX_VERBATIM_MARK);
}

// ---------------------------------------------------------------------------
// The COMMENT carrier — the third member of the same family (task 347)
// ---------------------------------------------------------------------------
//
// A `%` comment tail is byte-literal for exactly the reason `latexVerbatim` is,
// and one reason more: LaTeX does not TYPESET it at all. Before task 347 the
// inline parser had no representation for a mid-line `%`, so it fell into the
// prose buffer and the serializer's char-escape rung rewrote it to `\%` — which
// silently CHANGES what LaTeX does. `% TODO cite` started typesetting in the
// PDF; `5%` began printing " was observed." that LaTeX had been discarding; and
// `continues%` at end of line, which is TeX's line-JOIN idiom, became a printed
// percent sign that keeps the space. All three were fixed points, so no later
// save healed them and nothing downstream could tell a promoted comment from a
// `\%` the user actually wrote.
//
// So a comment tail rides its own carrier for the same two reasons task 264
// gave for splitting `latexVerbatim` off `latexCommand`: a separate mark type
// keeps the JSON shape of the other carriers untouched, and two different mark
// types can never be merged into one text node — a comment abutting a stray
// `latexCommand` run stays distinguishable.
//
// It is a THIRD carrier rather than a flag on `latexVerbatim` because the two
// make different promises at the EMIT end. Verbatim bytes are typeset; comment
// bytes are not, so a comment tail additionally owns everything to end-of-line
// — which is what makes the serializer's newline obligation (nothing else may
// share its line) this carrier's alone.
//
// Like its sibling, the mark is re-derived from the source bytes on every
// parse, so it needs no representation in the `.tex` and nothing to migrate.

/** Mark name for a `%`-comment TAIL — the bytes from an unescaped `%` to the
 *  end of its line, which LaTeX discards. Lives here beside the verbatim
 *  carrier and reachable from the tiptap-free parser/serializer; the TipTap
 *  `Mark.create` in `src/lib/tiptap/latex-command.ts` reads it. */
export const LATEX_COMMENT_TAIL_MARK = "latexCommentTail";

/** The mark object every comment-tail-emitting parser branch pushes. */
export function commentTailMark(): { type: string } {
  return { type: LATEX_COMMENT_TAIL_MARK };
}

/** True when a mark list carries the comment carrier. Checked BEFORE the
 *  verbatim test by every serializer: a comment is the stricter promise of the
 *  two (not merely literal — not typeset at all). */
export function hasCommentTailMark(
  marks: readonly { type: string }[] | undefined,
): boolean {
  return !!marks?.some((m) => m.type === LATEX_COMMENT_TAIL_MARK);
}

/**
 * Does a comment TAIL begin at `i`? Returns its raw bytes — from the `%`
 * through to (not including) the next newline — or null.
 *
 * This is the positional form of {@link commentTailStart}, which answers the
 * same question for a whole line, and it reads the SAME escaping rule through
 * `isEscaped` so `\%` can never be mistaken for a comment. Deliberately NOT the
 * narrower `startsLineComment`: that one answers "what does VIRGIL'S
 * CONSTRUCT-TERMINATOR SCAN see", where TeX's rule is catastrophic (task 338 —
 * a comment-aware scan calls a LIVE `\end{env}` inert and swallows the rest of
 * the document). This one is a REPRESENTATION question asked from inside the
 * inline parser, at a position every command / verb / math / URL matcher has
 * already declined, so `\url{http://ex.com/a%20b}` never reaches it.
 */
export function matchCommentTailAt(
  text: string,
  i: number,
): { raw: string; end: number } | null {
  if (text[i] !== "%" || isEscaped(text, i)) return null;
  const nl = text.indexOf("\n", i);
  const end = nl === -1 ? text.length : nl;
  return { raw: text.slice(i, end), end };
}

/** The inline-`\verb` delimiter class, as ONE definition. `\verb` is a control
 *  WORD, so it is terminated by a non-letter — the delimiter must not be a
 *  letter (else `\verbatim` / `\verbdef` mis-lex as `\verb` + a delimiter), and
 *  LaTeX also forbids `*` and whitespace. */
const INLINE_VERB_DELIM = "[^a-zA-Z*\\s]";

/** Global scanner form — `\verb*?<delim>`, for stripping passes. */
export function inlineVerbOpenRe(): RegExp {
  return new RegExp(`\\\\verb(\\*?)(${INLINE_VERB_DELIM})`, "g");
}

/** Sticky twin of the same opener, for the anchored matcher below. Module-
 *  scoped and `lastIndex`-driven so the parse hot path (one call per backslash
 *  in every paragraph) allocates neither a RegExp nor a sliced string. */
const INLINE_VERB_OPEN_STICKY = new RegExp(
  `\\\\verb(\\*?)(${INLINE_VERB_DELIM})`,
  "y",
);

/**
 * Anchored form: does a `\verb<delim>…<delim>` run start at `i`? Returns the
 * run's exclusive end index (so `text.slice(i, end)` is the whole literal
 * spelling, delimiters included) or -1.
 *
 * Shared by BOTH inline parsers — the main one in `latex-parser.ts` and the
 * footnote/card fork in `footnote-content.ts` — so the two can't drift on what
 * counts as verbatim.
 *
 * The close search stops at the next newline, matching LaTeX (a `\verb` run
 * cannot cross a line) AND matching {@link stripInlineVerb}, which scans
 * line-by-line. Without the bound the two disagreed about where an
 * unterminated run ends: the node-producing parsers would close it on a
 * delimiter several lines later while the drop projection cut it at EOL, so
 * the same bytes were verbatim to one silo and prose to the other.
 */
export function matchInlineVerbAt(text: string, i: number): number {
  INLINE_VERB_OPEN_STICKY.lastIndex = i;
  const m = INLINE_VERB_OPEN_STICKY.exec(text);
  if (!m) return -1;
  const payloadStart = i + m[0].length;
  const closeIdx = text.indexOf(m[2], payloadStart);
  if (closeIdx === -1) return -1;
  const eol = text.indexOf("\n", payloadStart);
  if (eol !== -1 && eol < closeIdx) return -1;
  return closeIdx + 1;
}

/**
 * The four inline math delimiter pairs, longest-opener-first. `$$` MUST precede
 * `$` or a display run opens an empty inline atom on its own second `$`.
 *
 * `trim` mirrors the main parser's long-standing per-form behaviour: the
 * backslash forms trim their payload, the dollar forms do not. It is data here
 * rather than a branch so the two inline scanners cannot disagree about it.
 */
const INLINE_MATH_DELIMS: readonly { open: string; close: string; trim: boolean }[] = [
  { open: "$$", close: "$$", trim: false },
  { open: "$", close: "$", trim: false },
  { open: "\\[", close: "\\]", trim: true },
  { open: "\\(", close: "\\)", trim: true },
];

export interface InlineMathMatch {
  /** The payload between the delimiters (trimmed for the backslash forms). */
  latex: string;
  /** Index just past the closing delimiter. */
  end: number;
}

/**
 * **THE inline-math vocabulary.** Does an inline math run open at `start`?
 * Returns its payload + the index to continue from, or null.
 *
 * Shared by BOTH inline parsers — the main one in `latex-parser.ts` and the
 * footnote/card fork in `footnote-content.ts` — the same way
 * {@link matchInlineVerbAt} is (task 341). Before that the fork knew `$…$` and
 * nothing else, so `\(x^2\)` / `$$E=mc^2$$` inside a footnote or card body fell
 * through to the PROSE buffer and were char-escaped: `^` became
 * `\textasciicircum{}`, which in math mode typesets a literal caret, so every
 * superscript and subscript in the body was silently lost in the PDF. The
 * damage was invisible in the editor, because the fork's unescape rung mapped
 * the spelling back to `^` on the way in — the file on disk stayed wrong
 * forever while the footnote kept looking right.
 *
 * Math content is LITERAL and must never reach the dash/accent/quote buffer
 * (memo §A "Critical exclusions"), which is the whole reason a delimiter this
 * scanner does not know is worse than one it refuses.
 *
 * The close search runs through {@link findUnescaped} for every form, so a `\\`
 * line break immediately before a literal `]`/`)`/`$` cannot close the run
 * early (task 210's parity rule, now stated once for all four pairs).
 */
export function matchInlineMathAt(
  text: string,
  start: number,
): InlineMathMatch | null {
  const ch = text[start];
  if (ch !== "$" && ch !== "\\") return null;
  for (const d of INLINE_MATH_DELIMS) {
    if (!text.startsWith(d.open, start)) continue;
    // A `$` preceded by an ODD backslash run is an escaped literal dollar, not
    // a delimiter. (The backslash forms ARE the backslash, so the test only
    // makes sense for the dollar pair — `isEscaped` at a `\[` would ask about
    // the backslash before the backslash.)
    if (d.open[0] === "$" && isEscaped(text, start)) return null;
    const payloadStart = start + d.open.length;
    const closeIdx = findUnescaped(text, d.close, payloadStart);
    if (closeIdx === -1) continue;
    const raw = text.slice(payloadStart, closeIdx);
    return { latex: d.trim ? raw.trim() : raw, end: closeIdx + d.close.length };
  }
  return null;
}

export interface ProjectLiveLatexOptions {
  /** Verbatim-family environments whose CONTENTS are dropped. Default: the
   *  NARROW family (`verbatim`/`verbatim*`). */
  envs?: readonly string[];
  /** When true, inline `\verb<delim>…<delim>` / `\verb*<delim>…<delim>` runs
   *  are dropped too, with a boundary-correct delimiter (any single
   *  non-letter, non-`*`, non-space char right after `\verb`/`\verb*`), so
   *  `\verbatim`/`\verbdef` are NOT mis-lexed as `\verb` + delimiter. Default
   *  false. */
  inlineVerb?: boolean;
  /**
   * When true, every inert byte is BLANKED to a space instead of dropped, so
   * the projection is the same LENGTH as its input and an index into it is an
   * index into the original.
   *
   * That is the difference between the two questions this projection answers.
   * "What does the preamble SAY?" ({@link livePreamble}, the detectors) wants
   * the dropped form. "WHERE is byte N?" — the preamble/body boundary, and the
   * requirement/title injectors that splice at it — needs an offset it can hand
   * back to a caller holding the RAW string, and a projection that deletes
   * bytes cannot give one. Before task 375 there was no offset-preserving form
   * at all, so every boundary reader searched the raw bytes and a
   * commented-out or verbatim-quoted `\begin`/`\end{document}` moved the
   * boundary (or, for the injectors, was spliced INTO and un-commented).
   *
   * Newlines are preserved as newlines, so line/column geometry survives too;
   * blanking can only ever REMOVE a match, never create one. Default false.
   */
  preserveOffsets?: boolean;
  /**
   * When true, a verbatim-family `\begin` with NO matching `\end` anywhere below
   * it is NOT treated as an open: its bytes stay live.
   *
   * The default (false) swallows to the end of the source, matching how TeX
   * lexes it — the right direction for a DETECTOR, which should fail toward
   * not-detecting. It is the wrong direction for a STRUCTURAL scan, because a
   * half-typed `\begin{comment}` in a preamble is an ordinary mid-edit state and
   * swallowing to EOF would erase the `\begin{document}` below it: the boundary
   * vanishes and the save writes the whole file back as body. That is this
   * repo's "unterminated ⇒ TRANSPARENT" rule (tasks 350/356) applied one layer
   * down, and it is scoped to an OPT-IN so no detector's answer moves. Default
   * false.
   */
  unterminatedIsLive?: boolean;
}

// ---------------------------------------------------------------------------
// Projection: comment + verbatim inertness
// ---------------------------------------------------------------------------

const escapeForRegex = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Build a `\begin{<env>}` / `\end{<env>}` alternation over the family. The
 *  end regex intentionally does NOT require the same env that opened (it
 *  matches ANY family close), matching the historical `projectDetectableBody`
 *  behavior byte-for-byte. Longest-first so `verbatim*` is tried before
 *  `verbatim`. */
function familyBeginEndRes(envs: readonly string[]): {
  begin: RegExp;
  end: RegExp;
} {
  const alt = [...envs]
    .sort((a, b) => b.length - a.length)
    .map(escapeForRegex)
    .join("|");
  return {
    begin: new RegExp(`\\\\begin\\{(?:${alt})\\}`),
    end: new RegExp(`\\\\end\\{(?:${alt})\\}`),
  };
}

/** Index of the char that begins a line's `%`-comment, or -1 if the line has
 *  none. A `%` starts a comment unless escaped (`\%`); an even run of
 *  backslashes before it (`\\%` = linebreak + comment) does not escape it.
 *  The single SSOT for "where does the comment start" — both `stripCommentTail`
 *  and `projectLiveLatex`'s verbatim-aware walk read it, so the escaping rule
 *  lives in exactly one regex. */
function commentTailStart(line: string): number {
  // Group 1 is the (unescaped) run right before the `%`; the `%` itself sits at
  // `m.index + m[1].length`.
  const m = /((?:^|[^\\])(?:\\\\)*)%/.exec(line);
  return m ? m.index + m[1].length : -1;
}

/** Strip a line's `%`-comment tail (see {@link commentTailStart}). Folded
 *  verbatim from the former `stripCommentTail`. */
function stripCommentTail(line: string): string {
  const i = commentTailStart(line);
  return i === -1 ? line : line.slice(0, i);
}

/**
 * Does a comment *Virgil recognizes* begin at `pos`? An unescaped `%` with
 * nothing but whitespace between it and the start of its line.
 *
 * **This is deliberately NARROWER than {@link commentTailStart}, and the two
 * answer different questions.** `commentTailStart` asks what a LaTeX COMPILER
 * would see, which is the right question for `projectLiveLatex` (document-class
 * detection, verbatim projection) — there, TeX's rule (any unescaped `%` runs
 * to end of line) is the truth. This one asks what VIRGIL'S CONSTRUCT-TERMINATOR
 * SCAN may treat as inert, and the answer is: only a comment at the head of a
 * line. `parseBody` takes its `%` branch at a block boundary (after
 * `skipWhitespace`), and `readParagraph`'s block-boundary test suppresses
 * itself inside a line-start comment — both read THIS predicate, so the parser
 * and the terminator scan agree by construction about where a construct ends.
 *
 * **Task 347 corrected the sentence that used to stand here.** It read: "A
 * mid-line `%` is ordinary PROSE to Virgil, preserved byte-for-byte — `See a%b
 * and more.` is one text node, and `\url{http://ex.com/a%20b}` is one
 * `latexCommand` run." The `\url` half was true and still is. The first half
 * was false, and false in the direction that matters: 338 had verified the
 * PARSE side and never asked the EMIT side, where the char-escape table
 * rewrote that `%` to `\%` — so `See a%b and more.` came back as
 * `See a\%b and more.`, and every `% TODO cite` in a real paper started
 * TYPESETTING. A mid-line `%` is no longer prose at all: it is carried on
 * `LATEX_COMMENT_TAIL_MARK` and re-emitted verbatim, which is what finally
 * makes "preserved byte-for-byte" true.
 *
 * The narrowing itself was right and must not be reverted — see the failure
 * direction below.
 *
 * Reading TeX's rule here instead is a layer disagreement with exactly one
 * failure direction, and it is catastrophic: the scan calls a LIVE `\end{env}`
 * inert, `findMatchingEnv` answers -1, and the parser's unterminated branch
 * swallows the rest of the document into that environment. Measured on this
 * fix's own first cut — a `\url{…%20…}` inside a `quote` (the serializer emits
 * `\end{quote}` on the last content line, so the `%` and the terminator share a
 * line) never reaches a fixed point: successive round trips ALTERNATE between
 * two texts, one of which has swallowed every following paragraph.
 *
 * Known limit, stated rather than implied: at a MID-line `%` the two layers
 * still disagree in the other direction — the scan treats a `% \end{itemize}`
 * written after prose on the same line as live. That is byte-for-byte the
 * pre-338 behaviour of every comment-blind scanner, it is malformed input in
 * the only reading that makes the comment meaningful, and its failure mode is
 * bounded (a construct closes early) rather than absorbing.
 */
/**
 * Commands whose appearance at the head of a line ENDS the paragraph being
 * read. Built rather than spelled because Virgil's own block-position markers
 * belong in it: absorb a `\vexid`/`\vxid` into the preceding paragraph and the
 * next save re-emits it as literal text, accumulating one stray marker per
 * round trip. Their names come from the vocabulary SSOT
 * ([latex-markers.ts](latex-markers.ts)), so a future block-position marker
 * joins this boundary set by declaring itself — and the seven SECTIONING names
 * come from `HEADING_TYPES` for the same reason (task 376): this was the fifth
 * hand-written copy of that alternation, and the four that decided anything
 * had already drifted apart.
 */
const BLOCK_BOUNDARY_COMMAND_RE = new RegExp(
  "^\\\\(" +
    HEADING_TYPES.map((t) => t.command).join("|") +
    "|" +
    "begin|end|\\[|hrulefill|title|author|date|maketitle|includegraphics|" +
    "noindent|vspace|hspace|newcounter|setcounter|renewcommand|newcommand|" +
    "usepackage|bibliographystyle|bibliography|tableofcontents|appendix|" +
    "clearpage|newpage|par|ex|pex|xe|" +
    BLOCK_TEX_MARKERS.map((m) => m.command).join("|") +
    "|begingl|endgl)\\b",
);

/**
 * True iff `text` OPENS with a construct that ends the paragraph above it.
 *
 * The parse side asks this of each continuation line (`readParagraph`); the
 * emit side asks it of a list item's TAIL to choose the separator that follows
 * the item's head. That is the whole reason it lives here rather than in the
 * parser: a single `\n` is enough where the next construct is self-delimiting
 * and DESTROYS a paragraph break where it is not, so the two halves have to
 * read the same rule or a list item's second paragraph is silently merged into
 * its first on the next open (task 348).
 *
 * `\[` is tested separately because the trailing `\b` never fires after the
 * non-word `[` — so `\[` followed by whitespace (a serialized `\[\n…`) would
 * otherwise be absorbed. A `%` comment is deliberately NOT a boundary: in LaTeX
 * a comment line between two prose lines is discarded with its newline, so the
 * paragraph continues through it (task 347).
 */
export function startsBlockBoundary(text: string): boolean {
  return text.startsWith("\\[") || BLOCK_BOUNDARY_COMMAND_RE.test(text);
}

/**
 * How many characters of a leading run of VIRGIL's own block markers
 * (`\vexid{…}`, `\vxid{…}`) sit at the head of `text` — 0 when none do.
 *
 * A marker is Virgil's bookkeeping, not a LaTeX construct, so a scan asking
 * "does a new BLOCK open on this line?" has to look past it. It cannot simply
 * ignore markers, either: `\vexid{ab12}\ex` really does open one. The two
 * facts together mean the question is asked of the line MINUS its marker
 * prefix, which is what this exists for.
 *
 * (Deliberately not folded into {@link startsBlockBoundary}: `readParagraph`
 * has always broken a paragraph AT a marker line, and every serialized
 * document depends on that spacing. This is a separate question a separate
 * caller asks.)
 */
export function blockMarkerPrefixLength(text: string): number {
  let pos = 0;
  outer: for (;;) {
    for (const m of BLOCK_TEX_MARKERS) {
      if (!text.startsWith(m.open, pos)) continue;
      const close = text.indexOf("}", pos + m.open.length);
      if (close === -1) continue;
      pos = close + 1;
      continue outer;
    }
    return pos;
  }
}

/**
 * A `\\` LINE BREAK and its own argument run at `start`, or null.
 *
 * `\\` is a control SYMBOL that takes an optional `*` (no page break here) and
 * an optional `[<len>]` (extra vertical space) — `\\[2pt]`, `\\*`, `\\*[1ex]`.
 * Those are the break's arguments, not prose, and before task 349 M4 nothing
 * modelled them: the `[` fell into the prose buffer, where the escape table's
 * `protect` member wrapped it as `{[}` and the PDF grew a printed `[2pt]`, and
 * one step earlier `readParagraph` had already split the paragraph AT the `\[`
 * and emitted an unterminated display-math opener — a document that no longer
 * compiles, on OPEN, with no edit by the user.
 *
 * `plain` is the whole point of the return shape: a bare `\\` stays the modelled
 * `hardBreak` node (the shipped behaviour, and what a Shift+Enter produces),
 * while a break WITH arguments is carried byte-literally, because Virgil does
 * not model break spacing — 342's rule, *what the system does not model, it
 * CARRIES*. A modelled `hardBreak` spacing ATTR is the richer treatment and a
 * schema change across three surfaces; the carrier is what makes the bytes safe
 * today.
 *
 * Deliberately ABUTTING only: LaTeX itself skips spaces before the `*`/`[`, and
 * reading that wider rule here would swallow a genuinely prose `[` one space
 * after a break (`Line\\ [note]`) into an argument. The serializer emits a prose
 * `[` as `{[}` precisely so it cannot be absorbed, so the abutting form is the
 * only one Virgil's own output can produce — and a hand-written `\\ [note]`
 * keeps today's reading. Stated as a residual rather than guessed at.
 *
 * Lives beside {@link startsBlockBoundary} because the two are the halves of one
 * question — where a `\\` token ENDS, and whether what follows it begins a new
 * block — and the M4 defect was the two answering differently.
 */
export function matchLineBreakAt(
  text: string,
  start: number,
): { raw: string; end: number; plain: boolean } | null {
  if (text[start] !== "\\" || text[start + 1] !== "\\") return null;
  let p = start + 2;
  let plain = true;
  if (text[p] === "*") {
    p++;
    plain = false;
  }
  if (text[p] === "[") {
    // FAILS CLOSED through the shared scanner: an unterminated `[` answers null
    // and the break stays bare, which is byte-for-byte today's behaviour.
    const opt = extractBracketed(text, p);
    if (opt) {
      p = opt.end;
      plain = false;
    }
  }
  return { raw: text.slice(start, p), end: p, plain };
}

export function startsLineComment(src: string, pos: number): boolean {
  if (src[pos] !== "%" || isEscaped(src, pos)) return false;
  for (let i = pos - 1; i >= 0; i--) {
    const ch = src[i];
    if (ch === "\n") return true;
    if (ch !== " " && ch !== "\t" && ch !== "\r") return false;
  }
  return true; // start of source
}

/** Drop inline `\verb<delim>…<delim>` / `\verb*<delim>…<delim>` runs from a
 *  single line, leaving everything else intact. The delimiter is the char
 *  right after `\verb`/`\verb*` and must be a non-letter (so `\verbatim`,
 *  `\verbdef`, etc. are left untouched), non-`*`, non-space char — the same
 *  boundary the parser's inline-verb matcher uses — literally so: both read
 *  the {@link inlineVerbOpenRe} / {@link matchInlineVerbAt} pair above, and
 *  both stop the close search at the newline, so the drop projection and the
 *  node-producing parsers can't drift on what counts as a verb run. An
 *  unterminated `\verb` on the line drops to end-of-line here (verb runs do
 *  not cross a newline); over there it simply doesn't match, and the text
 *  falls through as ordinary prose. */
function stripInlineVerb(line: string, blank: (s: string) => string): string {
  const re = inlineVerbOpenRe();
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const delim = m[2];
    out += line.slice(last, m.index);
    const payloadStart = m.index + m[0].length;
    const close = line.indexOf(delim, payloadStart);
    if (close === -1) {
      // Unterminated: drop to end of line.
      out += blank(line.slice(m.index));
      last = line.length;
      break;
    }
    out += blank(line.slice(m.index, close + 1));
    last = close + 1;
    re.lastIndex = last;
  }
  out += line.slice(last);
  return out;
}

/**
 * Project a LaTeX source down to its LIVE (compiler-visible) LaTeX: drop
 * `%`-comment tails (respecting `\%`) and the CONTENTS of the given
 * verbatim-family environments, optionally also inline `\verb` runs — all of
 * which are inert to detection/scanning. A single line-based pass; an
 * unterminated `\begin{<verbatim>}` (mid-edit) swallows to the end of the
 * source, matching how TeX lexes it.
 *
 * This is the SSOT that `projectDetectableBody` (NARROW family, no inline
 * verb) and `document-class` scanning (FULL family + inline verb) both
 * delegate to.
 */
export function projectLiveLatex(
  src: string,
  opts?: ProjectLiveLatexOptions,
): string {
  const envs = opts?.envs ?? VERBATIM_ENVS_NARROW;
  const inlineVerb = opts?.inlineVerb ?? false;
  // The ONE difference between the dropping and the offset-preserving form:
  // what an inert span becomes. Every drop site below routes through `blank`,
  // so the two modes cannot drift on WHICH bytes are inert — only on whether
  // the inert ones leave a hole or a space.
  const blank: (sp: string) => string = opts?.preserveOffsets
    ? (sp) => " ".repeat(sp.length)
    : () => "";
  const { begin: beginRe, end: endRe } = familyBeginEndRes(envs);
  const unterminatedIsLive = opts?.unterminatedIsLive ?? false;

  // Fast path: nothing inert to strip. (When inlineVerb is off, an inline
  // `\verb` has no `%` and no `\begin{verbatim}`, so the fast path is safe;
  // when inlineVerb is on, a bare `\verb…` line contains neither `%` nor a
  // verbatim begin, so we must not take the fast path if it might carry a
  // `\verb`.)
  const mayHaveInlineVerb = inlineVerb && src.includes("\\verb");
  if (!src.includes("%") && !beginRe.test(src) && !mayHaveInlineVerb) {
    return src;
  }

  const out: string[] = [];
  const lines = src.split("\n");
  // Backward pass: does ANY line at or after `i` carry a family close? One O(n)
  // sweep, so the terminated-ness test at each open is O(1) rather than a
  // rescan (which would be O(n²) on exactly the pathological input).
  const closeAtOrAfter: boolean[] = new Array(lines.length + 1).fill(false);
  if (unterminatedIsLive) {
    for (let i = lines.length - 1; i >= 0; i--) {
      closeAtOrAfter[i] = endRe.test(lines[i]) || closeAtOrAfter[i + 1];
    }
  }
  let inVerbatim = false;
  for (let li = 0; li < lines.length; li++) {
    const rawLine = lines[li];
    let line = rawLine;
    let kept = "";
    // Walk the line through verbatim open/close transitions so same-line
    // `\begin{verbatim}…\end{verbatim}` pairs are handled too. Comment
    // stripping is INTERLEAVED with this walk — never applied up front — so a
    // `%` is only honored on the portion of the line currently OUTSIDE a
    // verbatim span. Inside verbatim a `%` is literal; a `%` before a
    // same-line `\end{verbatim}` must NOT truncate the `\end` token (the
    // pre-strip bug that let a same-line verbatim swallow the source to EOF).
    for (;;) {
      if (inVerbatim) {
        const end = endRe.exec(line);
        if (!end) {
          kept += blank(line);
          line = "";
          break;
        }
        inVerbatim = false;
        kept += blank(line.slice(0, end.index + end[0].length));
        line = line.slice(end.index + end[0].length);
        continue;
      }
      // Outside verbatim: a comment tail wins over any `\begin{verbatim}` that
      // sits at or after it — that begin is itself commented out. Only a begin
      // strictly BEFORE the comment is a real open.
      const begin = beginRe.exec(line);
      const comment = commentTailStart(line);
      if (!begin || (comment !== -1 && begin.index >= comment)) {
        const visible = comment === -1 ? line : line.slice(0, comment);
        kept += inlineVerb ? stripInlineVerb(visible, blank) : visible;
        if (comment !== -1) kept += blank(line.slice(comment));
        break;
      }
      const rest = line.slice(begin.index + begin[0].length);
      if (
        unterminatedIsLive &&
        !endRe.test(rest) &&
        !closeAtOrAfter[li + 1]
      ) {
        // Unterminated ⇒ transparent: this is not an open, so the whole
        // remaining visible span (comment tail excluded, as ever) stays live.
        const visible = comment === -1 ? line : line.slice(0, comment);
        kept += inlineVerb ? stripInlineVerb(visible, blank) : visible;
        if (comment !== -1) kept += blank(line.slice(comment));
        break;
      }
      const head = line.slice(0, begin.index);
      kept += inlineVerb ? stripInlineVerb(head, blank) : head;
      inVerbatim = true;
      kept += blank(begin[0]);
      line = rest;
    }
    out.push(kept);
  }
  return out.join("\n");
}

/**
 * The bytes a DETECTOR may believe: the live projection at the NARROW
 * verbatim family (`verbatim` / `verbatim*`) with inline `\verb` left in.
 *
 * This is one named door rather than a spelled-out option bag at each call
 * site, because "which bytes count as live for a detector?" is a single
 * question that several layers must answer identically. THREE layers ask it:
 * the requirements side (`detectBodyRequirements` /
 * `ensurePreambleRequirements`'s satisfaction test), the bib-family side
 * (`detectBibFamily`), and — since task 345 — the serializer's own
 * raw-passthrough declaration (`declareFromRawLatex`, the one emit-site
 * requirement that SCANS user bytes rather than reading Virgil's own emit).
 * Before task 344 the bib detector answered it with the RAW `.tex`, so a
 * commented-out `% \usepackage{biblatex}` outranked a live
 * `\usepackage{natbib}`; before 345 the raw-passthrough declaration did the
 * same for `\includegraphics` / tikz / expex.
 *
 * The family stays NARROW deliberately (the P3 design fork F1): the
 * requirements pass injects `\usepackage` lines off this projection, so
 * widening it to `VERBATIM_ENVS_FULL` would change which packages get
 * injected for docs that put cite/expex commands inside `lstlisting`/`minted`
 * — a change to saved `.tex` bytes, not a tidy-up. Inline `\verb` is likewise
 * left live for byte-compatibility with the pre-consolidation implementation.
 * Both are stated residuals, not oversights: a `\verb|\usepackage{biblatex}|`
 * still reads as a live load.
 *
 * A third residual, and the one 345 made load-bearing: the comment-tail strip
 * runs on the visible span REGARDLESS of `inlineVerb`, so a raw `%` inside a
 * `\verb|100%|` or a hyperref `\url{…a%20b}` truncates the rest of that LINE.
 * Every reader now shares that, so nothing rescues an over-strip: a live
 * `\includegraphics` sharing such a line goes undeclared. That is the safe
 * direction — a missing `\usepackage` is a loud compile error, where the
 * over-declaration it replaced silently broke a compiling paper — but it is a
 * behaviour, not an accident.
 */
export function projectDetectableLatex(src: string): string {
  return projectLiveLatex(src, { envs: VERBATIM_ENVS_NARROW });
}

/** The `\begin{document}` token — the preamble/body boundary, spelled once for
 *  every reader rather than an eighth raw `indexOf`. Exported so a caller that
 *  must EMIT the canonical spelling reads it here too. */
export const BEGIN_DOCUMENT_TOKEN = "\\begin{document}";

/** The `\end{document}` token — the body/postamble boundary. */
export const END_DOCUMENT_TOKEN = "\\end{document}";

/**
 * The LIVE preamble of a `.tex` source — `projectDetectableLatex` applied to
 * the whole file, then split at `\begin{document}`.
 *
 * The two halves of that sentence are each a rule task 344 had to learn, and
 * they are stated here so a third detector cannot re-learn them:
 *
 *  - **Only live bytes count.** A commented-out `% \usepackage{linguex}` is
 *    the single most ordinary thing in an academic preamble, and before 344 it
 *    outranked a live load one detector over.
 *  - **The split is taken on the PROJECTED text**, so a commented-out
 *    `% \begin{document}` cannot move the boundary. A source with no
 *    `\begin{document}` at all (a fragment, a brand-new doc) fails OPEN — the
 *    whole projection is preamble, which is what a fragment scan wants.
 *
 * NOT offset-preserving: this answers "what does the preamble SAY", never
 * "where is byte N". The `injectPreambleRequirements` family needs the second
 * question and keeps its own raw scan (AGENTS.md records that as an open
 * residual of the same class).
 */
export function livePreamble(tex: string): string {
  return preambleSliceOfProjected(projectDetectableLatex(tex));
}

/**
 * The prefix of an ALREADY-projected source up to its `\begin{document}`, or
 * the whole thing when there is none (fail OPEN — a fragment scan wants the
 * whole projection).
 *
 * Exported for the one other detector that projects for itself and then needs
 * the preamble half ({@link detectBibFamily}), so "where does the preamble end"
 * has one answer even on the DROPPING projection — including the spaced
 * `\begin {document}` spelling, which a raw `indexOf` misses.
 */
export function preambleSliceOfProjected(projected: string): string {
  const m = BEGIN_DOCUMENT_RE.exec(projected);
  return m ? projected.slice(0, m.index) : projected;
}

/**
 * Does the LIVE preamble of `tex` load `\usepackage{<name>}`? Tolerates the
 * option form (`\usepackage[opt]{name}`) and a comma-separated package list
 * (`\usepackage{expex,linguex}`), which is how a real preamble writes it.
 *
 * A detector, so it obeys the detector law: it believes only the bytes the
 * compiler would ({@link livePreamble}).
 */
export function preambleLoadsPackage(tex: string, name: string): boolean {
  return preambleListLoadsPackage(livePreamble(tex), name);
}

/** The {@link preambleLoadsPackage} question asked of an ALREADY-projected
 *  preamble, for a caller that has one in hand (and must not project twice). */
export function preambleListLoadsPackage(
  livePreambleText: string,
  name: string,
): boolean {
  const re = /\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(livePreambleText)) !== null) {
    if (m[1].split(",").some((p) => p.trim() === name)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// The preamble/body boundary — ONE door (task 375)
// ---------------------------------------------------------------------------

/**
 * The bytes a STRUCTURAL scan may believe, with offsets preserved: the live
 * projection at the FULL verbatim family, inline `\verb` included, every inert
 * byte blanked to a space.
 *
 * The family choice is deliberate and differs from {@link projectDetectableLatex}'s.
 * A DETECTOR stays NARROW for byte-compatibility of package injection (the P3
 * fork F1); a boundary is a structural question, the same one
 * `findSectioningCommands` asks, and an `\end{document}` inside a `lstlisting`
 * or a `\verb|\end{document}|` is not a boundary by any reading — that is
 * member M4 of task 375, where the body was cut mid-verbatim and a `%!v:`
 * anchor was written into what remained, printing literally in the PDF.
 */
export function projectStructuralLatex(src: string): string {
  return projectLiveLatex(src, {
    envs: VERBATIM_ENVS_FULL,
    inlineVerb: true,
    preserveOffsets: true,
    unterminatedIsLive: true,
  });
}

/**
 * `\begin{document}` / `\end{document}` as TeX scans them: the control word,
 * then optional horizontal whitespace around the braced argument. TeX skips
 * spaces while scanning an argument, so `\begin {document}` and `\begin{ document }`
 * are the same token — and an exact-literal `indexOf` reads a document spelled
 * that way as having NO boundary at all (task 375 member M5), which sent the
 * whole file through `stripPreamble`'s body fallback and replaced the user's
 * `\documentclass` with a style seed.
 *
 * Horizontal whitespace only, deliberately: `\s*` would let the token span a
 * blank line, which is a `\par` and not a continuation. A `\begin%\n{document}`
 * comment continuation is therefore still not matched — a stated residual, and
 * exactly today's behaviour, so no regression rides on it.
 */
const BEGIN_DOCUMENT_RE = /\\begin[ \t]*\{[ \t]*document[ \t]*\}/;
const END_DOCUMENT_RE = /\\end[ \t]*\{[ \t]*document[ \t]*\}/;

/** The byte span of one live `\begin{document}` / `\end{document}` occurrence,
 *  as offsets into the ORIGINAL source. */
export interface LiveDocumentToken {
  /** Index of the leading `\`. */
  start: number;
  /** One past the closing `}`. */
  end: number;
}

/**
 * Every LIVE `\begin{document}` and `\end{document}` in `latex`, in source
 * order — ONE projection, and the single implementation
 * {@link findDocumentBoundary} is derived from.
 *
 * Exported for the two callers that need more than the first pair: the style
 * blob validator (which counts begins and rejects any end) and the census's own
 * pins. Everything else wants the boundary door.
 */
export function findLiveDocumentTokens(latex: string): {
  begins: LiveDocumentToken[];
  ends: LiveDocumentToken[];
} {
  const live = projectStructuralLatex(latex);
  const spans = (re: RegExp): LiveDocumentToken[] => {
    const g = new RegExp(re.source, "g");
    const out: LiveDocumentToken[] = [];
    let m: RegExpExecArray | null;
    while ((m = g.exec(live)) !== null) {
      out.push({ start: m.index, end: m.index + m[0].length });
    }
    return out;
  };
  return { begins: spans(BEGIN_DOCUMENT_RE), ends: spans(END_DOCUMENT_RE) };
}

/** Where a `.tex` source's preamble ends and its postamble begins. Offsets are
 *  into the ORIGINAL string; -1 means "no live token". */
export interface DocumentBoundary {
  /** Index of the leading `\` of the live `\begin{document}`, or -1. */
  beginDoc: number;
  /** One past that token — where the BODY starts. -1 when `beginDoc` is -1. */
  bodyStart: number;
  /** Index of the leading `\` of the first live `\end{document}` AT OR AFTER
   *  `bodyStart`, or -1. Never precedes `beginDoc` by construction. */
  endDoc: number;
}

/**
 * Locate the preamble/body boundary of a `.tex` source. **The one door** — every
 * reader in `src/` goes through it, and a census leg forbids a call site from
 * spelling the literal itself.
 *
 * Two rules, and each is a member of task 375 rather than a nicety:
 *
 *  - **Only LIVE bytes count** ({@link projectStructuralLatex}). A preamble that
 *    merely MENTIONS the token in a comment, a `\verb`, or a verbatim listing
 *    does not move the boundary. Commenting out an early `\end{document}` to
 *    truncate a compile is one of the most ordinary things an author does, and
 *    before this the body cut landed INSIDE that comment: the `%` was severed
 *    from its token, the `\end{document}` went LIVE, and the rest of the paper
 *    stopped printing.
 *  - **The end is searched FROM the end of the begin token**, never from 0. A
 *    preamble comment naming `\end{document}` used to make `endDoc < beginDoc`,
 *    which emptied the entire body into the postamble and wrote a `.tex` with
 *    two `\begin{document}` and a `\usepackage` after the first.
 *
 * Fails OPEN in the same direction {@link livePreamble} does: an unlocatable
 * boundary answers -1 rather than guessing, and each caller states what it does
 * with that (never "seed a preamble over a file that has bytes in it").
 */
export function findDocumentBoundary(latex: string): DocumentBoundary {
  const { begins, ends } = findLiveDocumentTokens(latex);
  const begin = begins[0];
  if (!begin) return { beginDoc: -1, bodyStart: -1, endDoc: -1 };
  const end = ends.find((t) => t.start >= begin.end);
  return {
    beginDoc: begin.start,
    bodyStart: begin.end,
    endDoc: end ? end.start : -1,
  };
}

// ---------------------------------------------------------------------------
// Brace scanners
// ---------------------------------------------------------------------------

/**
 * Find the index of the `}` matching the `{` at `open`. Returns -1 if the
 * char at `open` is not `{` or the group is unbalanced. `\{`/`\}` are treated
 * as literal (an escaped brace does not change depth), with escaping decided
 * by the shared `isEscaped` backslash-run parity rule — so `\\{`/`\\}` (a
 * `\\` line break followed by a REAL delimiter) balances correctly.
 */
export function findMatchingBrace(text: string, open: number): number {
  if (text[open] !== "{") return -1;
  let depth = 1;
  let i = open + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "{" && !isEscaped(text, i)) depth++;
    else if (ch === "}" && !isEscaped(text, i)) {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/**
 * Extract the contents of the `{...}` group starting at `startOfBrace`.
 * Returns `{ content, end }` where `end` is the index just past the closing
 * `}`, or null if the char at `startOfBrace` is not `{` or the group is
 * unbalanced. `\{`/`\}` are treated as literal — same shared `isEscaped`
 * parity rule as `findMatchingBrace`.
 */
export function extractBraced(
  text: string,
  startOfBrace: number,
): { content: string; end: number } | null {
  if (text[startOfBrace] !== "{") return null;
  let depth = 1;
  let i = startOfBrace + 1;
  while (i < text.length && depth > 0) {
    if (text[i] === "{" && !isEscaped(text, i)) depth++;
    if (text[i] === "}" && !isEscaped(text, i)) depth--;
    i++;
  }
  if (depth !== 0) return null;
  return { content: text.slice(startOfBrace + 1, i - 1), end: i };
}

/**
 * Extract the contents of the `[...]` OPTIONAL ARGUMENT starting at
 * `startOfBracket`. Returns `{ content, end }` where `end` is the index just
 * past the closing `]`, or null if the char at `startOfBracket` is not `[` or
 * no closing `]` is found.
 *
 * THE spelling of an optional-argument scan, for the same reason
 * {@link matchBeginEnvAt} is THE spelling of an environment name: a caller that
 * re-rolls it gets the wrong close bracket, and the failure is silent in both
 * directions — a label captured too short leaks the rest of the argument into
 * the item body, and one captured from a `]` that was never a delimiter eats
 * prose.
 *
 * Two rules the naive `indexOf("]")` gets wrong, both borrowed verbatim from
 * the brace scanners above so the three agree:
 *
 * - **Brace-aware.** A `]` inside a balanced `{...}` group is ordinary text,
 *   not the delimiter — `\item[\textbf{a]b}]` closes at the LAST bracket.
 * - **Escape parity.** `\]` is literal, decided by the shared `isEscaped`
 *   backslash-run rule, so `\\]` (a `\\` line break followed by a REAL
 *   delimiter) still closes.
 *
 * FAILS CLOSED: an unterminated argument (`\item[a{b`) answers null rather
 * than guessing a delimiter, so the caller leaves the bytes where they are as
 * ordinary text. Losing the optional-argument READING of malformed input is
 * strictly better than consuming bytes on a delimiter that isn't one — the
 * whole point of the class this belongs to (task 340) is that a construct
 * Virgil half-understands must not be silently destroyed.
 */
export function extractBracketed(
  text: string,
  startOfBracket: number,
): { content: string; end: number } | null {
  if (text[startOfBracket] !== "[") return null;
  let braceDepth = 0;
  let i = startOfBracket + 1;
  while (i < text.length) {
    const ch = text[i];
    if (!isEscaped(text, i)) {
      if (ch === "{") braceDepth++;
      else if (ch === "}") braceDepth--;
      else if (ch === "]" && braceDepth <= 0) {
        return { content: text.slice(startOfBracket + 1, i), end: i + 1 };
      }
    }
    i++;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Environment / command scanners
// ---------------------------------------------------------------------------

/**
 * `\begin{<env>}` at `pos`? Returns the env NAME and the index just past the
 * closing brace, or null.
 *
 * THE spelling of an environment name — `\w+` with an optional trailing `*`
 * (`figure*`, `enumerate*`, `verbatim*`). Both the parser's env dispatcher and
 * {@link skipOpaqueConstructAt} read it here rather than each carrying a
 * regex, because the two must agree byte-for-byte: a construct the skipper
 * does not RECOGNIZE is a construct whose `\item`/`\a` lines leak into the
 * enclosing body, and one it recognizes differently is a construct the
 * dispatcher then re-reads from the wrong offset (task 338).
 */
export function matchBeginEnvAt(
  src: string,
  pos: number,
): { name: string; end: number } | null {
  if (src[pos] !== "\\") return null;
  BEGIN_ENV_STICKY.lastIndex = pos;
  const m = BEGIN_ENV_STICKY.exec(src);
  if (!m) return null;
  return { name: m[1], end: pos + m[0].length };
}

const BEGIN_ENV_STICKY = /\\begin\{(\w+\*?)\}/y;

/** `\b`-style word boundary: is the char at `i` a word char? */
function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[a-zA-Z0-9_]/.test(ch);
}

/**
 * **THE expex example-opener vocabulary** — `\ex` / `\pex` at `pos`, optionally
 * `~`-suffixed, or null. Returns the index to continue from (`end`, past any
 * `~`) plus the two facts the parser needs to build the node.
 *
 * This is a shared SSOT rather than a private helper because **the parser and
 * the nesting scan must agree on what an opener IS** (task 350). Pre-350 they
 * did not: this function enforced the control-word boundary and the dispatcher
 * in `latex-parser.ts` matched a bare `/^\\(ex|pex)(~?)/` with no lookahead at
 * all, so the two layers disagreed about `\example` / `\exercise` /
 * `\expandafter`. Whichever one is wrong, the damage is the same shape — the
 * body pairing is computed against a different set of openers than the one the
 * node was built from — so there is one answer and both read it here.
 *
 * Two conditions, and each is a different kind of claim:
 *
 *  - **TeX's own rule.** A control WORD is a maximal run of letters, so `\ex`
 *    is `\ex` only where the next character is not a word char. A rule about
 *    the LANGUAGE, so it needs no package to justify it.
 *  - **`.` is linguex, not expex.** `\ex.` / `\pex.` open a *linguex* example,
 *    and expex's grammar never puts a period after `\ex`. The delimiter alone
 *    settles it, which is why this deliberately does NOT consult the preamble
 *    for `\usepackage{linguex}`: a fragment, a card body and a paste have no
 *    preamble, and a form check that works everywhere beats a package signal
 *    that works sometimes. (The reproducing document loaded BOTH packages, so
 *    a preamble signal could not have decided it either way.)
 *
 * A declined opener is CARRIED as raw content by the parser (task 342's rule),
 * which is what keeps a linguex document byte-intact through a save.
 */
export function matchExpexOpenerAt(
  src: string,
  pos: number,
): {
  name: "ex" | "pex";
  kind: "single" | "multi";
  suppressSpace: boolean;
  end: number;
} | null {
  if (src[pos] !== "\\") return null;
  for (const name of ["pex", "ex"] as const) {
    if (!src.startsWith(name, pos + 1)) continue;
    const afterName = pos + 1 + name.length;
    if (isWordChar(src[afterName])) return null;
    const suppressSpace = src[afterName] === "~";
    const end = afterName + (suppressSpace ? 1 : 0);
    // linguex `\ex.` — carry it, don't claim it.
    if (src[end] === ".") return null;
    return {
      name,
      kind: name === "pex" ? "multi" : "single",
      suppressSpace,
      end,
    };
  }
  return null;
}

/**
 * **THE linguex example-opener vocabulary** — `\ex.` at `pos`, or null.
 *
 * The expex twin above is where the two dialects are told apart, and the
 * discriminator is the PERIOD, per SITE: expex's grammar never puts one after
 * `\ex`, linguex's always does. That is why neither function consults the
 * preamble — a fragment, a card body and a paste have no preamble, and the
 * reproducing document for task 350 loaded BOTH packages, so a package signal
 * could not have decided it either way.
 *
 * The package signal decides something ELSE, and the parser asks it separately
 * (`preambleLoadsPackage(tex, "linguex")`): whether a recognized linguex site
 * is MODELLED (task 355) or CARRIED RAW as task 350 left it. Form answers
 * "which dialect is this"; the package answers "may Virgil claim it".
 *
 * **What is deliberately NOT an opener**, and why it needs no code: `\exg.`
 * (glossed), `\exi.` (indented continuation) and `\exr.` (repeated number) are
 * different control WORDS, so the control-word boundary declines them and task
 * 342's carrier takes their bytes byte-faithfully. That is the whole of the
 * v1 scope line — the out-of-scope forms are carried by construction rather
 * than by a list someone has to maintain.
 */
export function matchLinguexOpenerAt(
  src: string,
  pos: number,
): { end: number } | null {
  if (src[pos] !== "\\") return null;
  if (!src.startsWith("ex", pos + 1)) return null;
  const afterName = pos + 3;
  if (isWordChar(src[afterName])) return null;
  if (src[afterName] !== ".") return null;
  return { end: afterName + 1 };
}

/**
 * **THE linguex sub-item vocabulary** — `\a.` … `\y.` at `pos`, or null.
 *
 * linguex defines the whole `\a.`–`\z.` range as sub-item markers, all
 * equivalent (the visible letter is computed from position, exactly as expex
 * computes it for `\a`); authors type them in alphabetical order so the
 * rendered label matches. `\z.` is EXCLUDED here because it additionally
 * CLOSES the list level, which is a nesting fact this v1 does not model — an
 * example containing one is refused whole and carried raw rather than
 * half-parsed (see `LINGUEX_UNMODELLED_RE`).
 *
 * `lineStart` is the caller's answer to "is `pos` at the start of a line
 * (after optional indentation), or immediately after the example header?" —
 * the only two places a real linguex item marker appears. Requiring it is what
 * keeps `\i.` (dotless i) and `\o.` (ø) from being read as item markers when
 * they occur mid-sentence in the body prose, which is the same false-split
 * class `splitPexBody` guards with `matchAccent`/`matchSpecialLetter`.
 */
export function matchLinguexItemAt(
  src: string,
  pos: number,
  lineStart: boolean,
): { letter: string; end: number } | null {
  if (!lineStart) return null;
  if (src[pos] !== "\\") return null;
  const letter = src[pos + 1];
  if (letter === undefined || !/[a-y]/.test(letter)) return null;
  if (src[pos + 2] !== ".") return null;
  return { letter, end: pos + 3 };
}

/**
 * The linguex constructs this build does NOT model. An `\ex.` body containing
 * any of them is REFUSED whole (carried raw, task 350's carrier) rather than
 * half-parsed — the rule task 350 defect C states for the example body one
 * layer down: *never emit a node that serializes to less than it consumed.*
 *
 * Members, each with the reason it cannot be half-parsed:
 *  - `\z.` — a sub-item that also CLOSES its level. Parsed as a plain item its
 *    close would be dropped on re-emit, silently re-opening the level for
 *    whatever follows.
 *  - `\ag.` / `\bg.` / … — GLOSSED sub-items, whose body is three
 *    `\\`-separated interlinear tiers. Virgil has a gloss model (expex's
 *    `\begingl`), but mapping linguex's tiers onto it is a second feature; a
 *    plain-text parse would flatten the alignment.
 *  - a SECOND `\a.` — in linguex `\a.` opens a level, so a second one inside
 *    one example body is the third nesting tier, which this v1 does not model.
 *    (Detected by the caller, which counts them; it cannot be a regex.)
 */
export const LINGUEX_UNMODELLED_RE = /\\(?:z\.|[a-z]g\.)/;

/**
 * **THE nesting vocabulary.** Does an OPAQUE nested construct start at `pos` —
 * one whose interior belongs to itself and must be invisible to whatever body
 * scan is walking past it? Returns the index to CONTINUE from, or -1 when no
 * such construct opens here.
 *
 * Membership is DERIVED from the LaTeX grammar rather than hand-listed: any
 * `\begin{<env>}` at all (so `description`, `enumerate*`, `minipage`,
 * `tabular`, `align`, a third-party list env, and every `VERBATIM_ENVS_FULL`
 * member are covered with nothing to add), plus the two expex pairs that are
 * NOT `\begin`/`\end` — `\begingl…\endgl` and `\ex`/`\pex…\xe` — plus an
 * inline `\verb<delim>…<delim>` run.
 *
 * Before task 338 each body splitter carried its own incomplete answer:
 * `splitListItems` knew literal `itemize`/`enumerate` and nothing else, so an
 * `\item` inside a nested `description` (or a `verbatim` code listing) split
 * the OUTER list — the nested env's body was hoisted out as sibling items and
 * its `\end{…}` left stranded in the prose, on the first save, with no edit by
 * the user. `splitPexBody` knew three expex constructs and no `\begin{env}` at
 * all.
 *
 * **Unterminated ⇒ TRANSPARENT.** A construct with no terminator answers with
 * the index just past its OPENING token, so the scan continues INSIDE it
 * rather than swallowing to end-of-source. That is the fail-soft direction:
 * mid-edit or malformed input degrades to the pre-338 behaviour (the `\item`s
 * split as before) instead of collapsing the rest of the document into one
 * node — the failure mode task 243 exists to prevent, arriving from the other
 * side. It is ONE policy, stated here, so no caller re-decides it.
 */
export function skipOpaqueConstructAt(src: string, pos: number): number {
  if (src[pos] !== "\\") return -1;

  // Inline `\verb<delim>…<delim>` — a literal run that can hide anything.
  if (src.startsWith("\\verb", pos)) {
    const verbEnd = matchInlineVerbAt(src, pos);
    if (verbEnd !== -1) return verbEnd;
  }

  const begin = matchBeginEnvAt(src, pos);
  if (begin) {
    const close = findMatchingEnv(src, begin.end, begin.name);
    return close === -1 ? begin.end : close + `\\end{${begin.name}}`.length;
  }

  if (src.startsWith("\\begingl", pos) && !isLetter(src[pos + "\\begingl".length])) {
    const bodyStart = pos + "\\begingl".length;
    const close = findMatchingGloss(src, bodyStart);
    return close === -1 ? bodyStart : close + "\\endgl".length;
  }

  const ex = matchExpexOpenerAt(src, pos);
  if (ex) {
    const close = findMatchingXe(src, ex.end);
    return close === -1 ? ex.end : close + "\\xe".length;
  }

  return -1;
}

/**
 * The ONE forward scan every terminator matcher below runs, so all three share
 * a single AWARENESS POLICY instead of the three different ones the parser's
 * private copies had (`findMatchingEnd`/`findMatchingXlistEnd` were
 * comment-blind, `findMatchingGloss` was not, so a `% \end{xlist}` terminated
 * one and not the other).
 *
 * The policy: a comment tail is inert from a LINE-LEADING `%` onward — the rule
 * VIRGIL's parser itself applies, spelled once in {@link startsLineComment},
 * which is where the reason a mid-line `%` may NOT be read as a comment here is
 * written down; an escaped char is consumed whole; and an opaque nested
 * construct is skipped via {@link skipOpaqueConstructAt} — which is also what
 * makes same-name nesting pair correctly, so no matcher needs its own depth
 * counter.
 *
 * `probe` is called at each LIVE backslash and returns the answer index, or
 * null to keep scanning. Returns -1 if the probe never answers.
 *
 * **Callers MUST gate on `hasTerminator` first.** The scan RECURSES through
 * `skipOpaqueConstructAt`, and an unterminated nested construct that answers
 * fail-soft leaves the enclosing scan to walk into it and meet the SAME nested
 * constructs again — which for k unterminated `\begin{…}`s in one body is
 * EXPONENTIAL, not quadratic (measured before the gate: 20 of them cost 245 ms,
 * 100 did not finish). Mid-edit source with an unterminated environment is
 * ordinary, and the code-pane bridge re-parses on a debounce, so this is a real
 * input rather than a hypothetical one.
 *
 * Stated limit: comment detection does not model an inline `\verb` run's
 * literal `%` beyond what `skipOpaqueConstructAt` skips, and a `%` inside a
 * verbatim ENV body is reached only via that skip (never scanned directly).
 */
function scanLive(
  src: string,
  startPos: number,
  probe: (pos: number) => number | null,
): number {
  let pos = startPos;
  let inComment = false;
  while (pos < src.length) {
    const ch = src[pos];
    if (ch === "\n") {
      inComment = false;
      pos++;
      continue;
    }
    if (inComment) {
      pos++;
      continue;
    }
    if (ch === "%" && startsLineComment(src, pos)) {
      inComment = true;
      pos++;
      continue;
    }
    if (ch === "\\") {
      const hit = probe(pos);
      if (hit !== null) return hit;
      const skip = skipOpaqueConstructAt(src, pos);
      if (skip !== -1 && skip > pos) {
        pos = skip;
        continue;
      }
      // Escaped char / ordinary command: never re-read its second char, so
      // `\%` and `\\` can't confuse the comment scan.
      pos += 2;
      continue;
    }
    pos++;
  }
  return -1;
}

/**
 * Given a `\begin{env}` that has ALREADY been consumed (so `startPos` points
 * just past it, into the environment body), find the position (index of the
 * `\`) of the matching `\end{env}`. Returns -1 if no matching close is found.
 *
 * Nested same-name environments pair correctly because the scan SKIPS every
 * nested construct wholesale (see {@link skipOpaqueConstructAt}) rather than
 * counting depth — which also makes a `\end{env}` inside a nested verbatim
 * listing or an inline `\verb` run inert, and a commented one likewise.
 *
 * `verbatim`-family environments are non-nestable and their body is literal,
 * so for those the correct terminator is the FIRST `\end{env}` — depth
 * counting (and any comment awareness — a `%` in a verbatim body is a literal
 * percent) is actively wrong there. This is the fork the parser used to
 * hand-write at its own call site.
 */
export function findMatchingEnv(
  src: string,
  startPos: number,
  envName: string,
): number {
  const endTok = `\\end{${envName}}`;

  // Non-nestable literal envs: first close wins.
  if (isVerbatimFamilyEnv(envName)) {
    return src.indexOf(endTok, startPos);
  }

  // The gate scanLive's doc demands. NECESSARY condition, checked without
  // recursing: the live scan can only ever answer at a position where the
  // literal token starts, so a source with no `\end{env}` at all after
  // `startPos` cannot have one — and answering that in one native `indexOf`
  // is what keeps an unterminated environment from costing a recursive walk.
  if (src.indexOf(endTok, startPos) === -1) return -1;

  return scanLive(src, startPos, (p) =>
    src.startsWith(endTok, p) ? p : null,
  );
}


/**
 * Given a `\begingl` that has ALREADY been consumed (so `startPos` points
 * just past it, into the gloss body), find the position (index of the `\`) of
 * the matching `\endgl`. expex's `\begingl…\endgl` is NOT a standard
 * `\begin{env}/\end{env}` pair, so this matches the bare command tokens.
 *
 * Boundary-correct: `\endgl` (and nested `\begingl`) must be terminated by a
 * non-letter, so `\endglpreamble`/`\beginglx` do not falsely terminate or
 * nest. A nested `\begingl` pairs with its own `\endgl` because the shared
 * scan skips it wholesale. Comment-aware (and, since task 338, inert to an
 * `\endgl` inside a nested env or `\verb` run): see {@link scanLive}. Returns
 * -1 if no matching close is found.
 */
export function findMatchingGloss(src: string, startPos: number): number {
  if (src.indexOf("\\endgl", startPos) === -1) return -1; // see scanLive
  return scanLive(src, startPos, (p) =>
    src.startsWith("\\endgl", p) && !isLetter(src[p + "\\endgl".length])
      ? p
      : null,
  );
}

/**
 * Given an `\ex`/`\pex` that has ALREADY been consumed (so `startPos` points
 * just past it, into the example body), find the position (index of the `\`)
 * of the matching `\xe`. expex's `\ex`/`\pex…\xe` is not a `\begin`/`\end`
 * pair either, so this matches the bare command tokens — boundary-correct, so
 * `\xetc` does not terminate. Nested `\ex`/`\pex` blocks pair with their own
 * `\xe` through the shared scan. Returns -1 if no matching close is found.
 */
export function findMatchingXe(src: string, startPos: number): number {
  if (src.indexOf("\\xe", startPos) === -1) return -1; // see scanLive
  return scanLive(src, startPos, (p) =>
    src.startsWith("\\xe", p) && !isWordChar(src[p + "\\xe".length]) ? p : null,
  );
}

function isLetter(ch: string | undefined): boolean {
  return ch !== undefined && /[a-zA-Z]/.test(ch);
}


/**
 * Read a greedy control-word token at `pos`, which must point at `\`. Returns
 * `{ name, end }` where `name` is the `[a-zA-Z@]+` run after the backslash
 * and `end` is the index just past it, or null if there is no letter run
 * (e.g. a control symbol like `\%` or `\\`).
 */
export function matchCommandToken(
  src: string,
  pos: number,
): { name: string; end: number } | null {
  if (src[pos] !== "\\") return null;
  const m = src.slice(pos + 1).match(/^[a-zA-Z@]+/);
  if (!m) return null;
  return { name: m[0], end: pos + 1 + m[0].length };
}

/**
 * TeX's own ceiling on a macro's arguments (`#1` … `#9`). Used as the bound on
 * the argument run below — a principled number rather than a guessed one.
 */
const MAX_COMMAND_ARGS = 9;

/** One `{…}` or `[…]` group of a command's argument run, with the offsets that
 *  let a MODELED matcher consume only the arity it declares (task 376). */
export interface CommandArgumentGroup {
  kind: "brace" | "bracket";
  /** Group contents, delimiters excluded. */
  content: string;
  /** Index of the opening delimiter. */
  start: number;
  /** One past the closing delimiter. */
  end: number;
}

export interface CommandArgumentRun {
  /** Every byte the run consumed, delimiters included. */
  raw: string;
  /** One past the last consumed byte. */
  end: number;
  /** A trailing `*` on the control word. */
  starred: boolean;
  /** The groups, in source order — bracket and brace interleaved as written. */
  groups: readonly CommandArgumentGroup[];
}

/**
 * Read a command's whole ARGUMENT RUN starting at `pos`, which must be the index
 * just past its control-word name (i.e. `matchCommandToken(...).end`).
 *
 * Consumes an optional trailing `*` and then every abutting `{…}` / `[…]` group
 * in WHATEVER ORDER they appear, up to {@link MAX_COMMAND_ARGS} groups. Returns
 * `{ raw, end }`; `raw` is `""` where the command takes no arguments here.
 *
 * WHY IT IS NOT A COUNT OF TWO (task 349 M1–M3). Both inline parsers read the
 * unknown-`\command` fallback with `[…]` groups consumed only BEFORE the braces
 * and the braces capped at TWO, so a command's THIRD argument fell out of the
 * command atom into the prose buffer — where the escape table treats `{`/`}` as
 * literal characters. Measured through the real save pipeline:
 *
 *   `\addcontentsline{toc}{section}{Introduction}`
 *      → `\addcontentsline{toc}{section}\{Introduction\}`   ToC destroyed, braces PRINT
 *   `\definecolor{myblue}{rgb}{0.2,0.4,0.8}`
 *      → `\definecolor{myblue}{rgb}\{0.2,0.4,0.8\}`         two args: COMPILE ERROR
 *   `\resizebox{3cm}{!}{Some content}`  → same
 *
 * and the fixed ORDER was the same defect one axis over: `\newcommand{\x}[1]{…}`
 * put its `[1]` after a brace, so the bracket loop had already finished and
 * `[1]` was emitted as `{[}1{]}` — printed text in the PDF.
 *
 * Three bounds, so a stray `{` in hand-written source cannot swallow the
 * document (the failure mode task 338 spent a whole task on):
 *
 *  - the group scanners are the SSOT pair (`extractBraced` / `extractBracketed`),
 *    which FAIL CLOSED on an unbalanced group — the run simply ends there, which
 *    is byte-for-byte the pre-349 behaviour for that shape;
 *  - a group whose content spans a BLANK LINE is refused. A paragraph's text is
 *    all either inline parser is ever handed, so this cannot fire on Virgil's
 *    own output; it bounds a caller that passes a wider slice;
 *  - the group count is capped at TeX's own `#1`…`#9`.
 *
 * A `{[}` / `{]}` PROTECTION also ends the run, and that rule is asked of
 * `CHAR_ESCAPE_TABLE` rather than re-spelled (task 339): those braces are prose
 * that merely ABUTS the command, so breaking here returns control to the
 * top-of-loop unwrap and `\cmd{[}x{]}` keeps `[x]` as literal prose. The main
 * parser had this check and the card/footnote fork did not — a pre-existing
 * divergence this shared door closes on the way past (the task-341 twin rule).
 */
export function matchCommandArgumentRun(
  text: string,
  pos: number,
): CommandArgumentRun {
  let p = pos;
  const starred = text[p] === "*";
  if (starred) p++;
  const groups: CommandArgumentGroup[] = [];
  while (p < text.length && groups.length < MAX_COMMAND_ARGS) {
    const ch = text[p];
    if (ch !== "{" && ch !== "[") break;
    // A protected prose bracket group is not an argument — see above.
    if (ch === "{" && matchCharEscapeAt(text, p)) break;
    const group =
      ch === "{" ? extractBraced(text, p) : extractBracketed(text, p);
    if (!group) break;
    if (/\n[ \t]*\n/.test(group.content)) break;
    groups.push({
      kind: ch === "{" ? "brace" : "bracket",
      content: group.content,
      start: p,
      end: group.end,
    });
    p = group.end;
  }
  return { raw: text.slice(pos, p), end: p, starred, groups };
}

/**
 * The SHAPE almost every MODELED construct actually has: an optional `*`, an
 * optional `[…]`, and the one `{…}` the model holds — `\section*[Short]{Long}`,
 * `\footnote[3]{…}`, `\title[Short]{Long}`, `\caption*[Short]{Long}`.
 *
 * `pos` is the index just past the control word (`matchCommandToken(...).end`).
 * Returns null when no required brace follows, which is the REFUSAL direction
 * (task 356): a `\section` with nothing to name is not a heading, and the
 * carrier keeps its bytes rather than the model claiming it and re-emitting
 * something else.
 *
 * WHY THIS IS NOT `matchCommandArgumentRun` ITSELF (task 376). That door
 * answers "what could this command's arguments be?" and is deliberately
 * MAXIMAL — it consumes every abutting group up to nine, which is right for
 * the CARRIER (whose job is to keep bytes together) and wrong for a modeled
 * construct, which consumes its OWN declared arity and no more: `\footnote{a}{b}`
 * is a footnote whose body is `a` followed by a bare prose group `{b}`, and a
 * maximal read would swallow the second into the footnote and re-emit it inside
 * the note. So this reads the run's PARTS and stops at the first brace — one
 * scanner, two arities.
 *
 * The gap before the FIRST argument is skipped, because that is TeX's own rule
 * (it skips spaces while scanning for an argument) and `\section {X}` /
 * `\section\n{X}` are spellings the four hand-written matchers all declined
 * while the compat checker accepted them. A gap spanning a BLANK LINE is not
 * skipped: a `\par` cannot appear inside an argument scan, and refusing there
 * keeps a bare `\section` at the end of a paragraph from reaching forward into
 * the next block. Gaps BETWEEN groups are deliberately not skipped — that is
 * `matchCommandArgumentRun`'s existing rule and this door does not renegotiate
 * it.
 */
export function matchStarOptBraceAt(
  text: string,
  pos: number,
): { starred: boolean; optional: string | null; required: string; end: number } | null {
  const gap = text.slice(pos).match(/^[ \t]*\n?[ \t]*/);
  const gapLen = gap ? gap[0].length : 0;
  const run = matchCommandArgumentRun(text, pos + gapLen);
  let optional: string | null = null;
  for (const g of run.groups) {
    if (g.kind === "bracket") {
      // Only the FIRST bracket is this construct's optional argument; a second
      // one belongs to whatever follows and is left in the stream.
      if (optional !== null) return null;
      optional = g.content;
      continue;
    }
    return { starred: run.starred, optional, required: g.content, end: g.end };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sectioning — the ONE answer to "is this a sectioning command, and what are
// its arguments?" (task 376)
// ---------------------------------------------------------------------------

/**
 * The sectioning vocabulary had FOUR spellings — the parser's own regex, the
 * serializer's level-indexed `commands` array, `HEADING_TYPES` (whose
 * `headingTypeCommand` had no callers at all: a dead SSOT, task 202's class),
 * and `document-class.findSectioningCommands` — and **only the copy that
 * decides nothing got the grammar right.** The parser's
 * `/^\\(part|…)(\*?)\{/` requires the brace to ABUT, so
 * `\section[Intro]{Introduction}` — an ordinary construct, legal in every
 * class — parsed to a PARAGRAPH carrying a `latexCommand` mark. Bytes
 * round-tripped (task 349/360's carrier did its job), and the whole heading
 * apparatus was dead for it: no Outline row, no folding, no section number, no
 * `\label`/`\ref` resolution, no `\partitle`, no focus band, no heading word
 * counts, and grey monospace where a styled heading belongs. Meanwhile the
 * compat checker's regex accepted the bracket AND the whitespace, so it
 * correctly saw a `\chapter[Short]{X}` the parser had already thrown away.
 *
 * This is that answer, DERIVED from `HEADING_TYPES` so the vocabulary is
 * stated once, and reading {@link matchStarOptBraceAt} so the argument grammar
 * is the shared one rather than a fifth regex.
 */
export interface SectioningCommandMatch {
  /** The control word, e.g. `"section"`. */
  command: string;
  /** `HEADING_TYPES` level: part 0 … subparagraph 6. */
  level: number;
  /** `\section*` — an unnumbered heading. */
  starred: boolean;
  /** Raw `[short]` running-head / ToC title; null when the source had none. */
  shortTitle: string | null;
  /** Raw brace body. */
  title: string;
  /** One past the closing brace. */
  end: number;
}

const SECTIONING_BY_COMMAND: ReadonlyMap<string, number> = new Map(
  HEADING_TYPES.map((t) => [t.command as string, t.level] as const),
);

/** Is `name` one of the seven sectioning control words? The ONE membership
 *  test — a caller that spells the alternation itself is the fork this door
 *  exists to retire. */
export function isSectioningCommand(name: string): boolean {
  return SECTIONING_BY_COMMAND.has(name);
}

/**
 * A sectioning command USE at `pos` — the name plus evidence that an argument
 * follows, with no requirement that the argument be well formed.
 *
 * This is the compat checker's question ("does this document REACH FOR
 * `\chapter`?"), which is genuinely weaker than the parser's ("is this a
 * heading, and what does it say?"): an undefined control sequence errors
 * whatever its arguments look like. Both are answered here so neither spells
 * the vocabulary itself.
 */
export function matchSectioningUseAt(
  src: string,
  pos: number,
): { command: string; level: number; end: number } | null {
  const word = matchCommandToken(src, pos);
  if (!word) return null;
  const level = SECTIONING_BY_COMMAND.get(word.name);
  if (level === undefined) return null;
  const gap = src.slice(word.end).match(/^[ \t]*\n?[ \t]*/);
  const after = word.end + (gap ? gap[0].length : 0);
  const ch = src[after];
  if (ch !== "*" && ch !== "{" && ch !== "[") return null;
  return { command: word.name, level, end: word.end };
}

/** The full parse of a sectioning command at `pos`, or null. */
export function matchSectioningCommandAt(
  src: string,
  pos: number,
): SectioningCommandMatch | null {
  const use = matchSectioningUseAt(src, pos);
  if (!use) return null;
  const args = matchStarOptBraceAt(src, use.end);
  if (!args) return null;
  return {
    command: use.command,
    level: use.level,
    starred: args.starred,
    shortTitle: args.optional,
    title: args.required,
    end: args.end,
  };
}

/**
 * A BARE `{…}` GROUP at `pos` — braces that belong to no command (task 349 M6).
 *
 * In LaTeX a bare `{a, b}` is a group: it scopes, and it typesets `a, b` with
 * no braces printed. Virgil has no node for a group, so the braces fell into
 * the prose buffer and `CHAR_ESCAPE_TABLE`'s `{`/`}` members rewrote them to
 * `\{`/`\}` — which typesets the braces the source did not print. Same shape as
 * the tie one table over: a construct with no representation is demoted to
 * prose, and the escape table then decides its meaning.
 *
 * The carrier is 342's, not 347's: a group's braces ARE typeset-relevant (they
 * scope), so `LATEX_COMMENT_TAIL_MARK`'s promise — *not typeset at all* — is
 * false for them. The braces ride `latexCommand` ("raw LaTeX the editor doesn't
 * model") and the CONTENT stays ordinary prose, so `{a, b}` keeps `a, b`
 * editable instead of greying out the user's words.
 *
 * Returns null — leaving today's escape-to-`\{` behaviour in place — unless the
 * bytes are unambiguously a group. Three bounds, deliberately the ones
 * {@link matchCommandArgumentRun} already states:
 *
 *  - `extractBraced` FAILS CLOSED on an unbalanced group, so a stray `{` in
 *    hand-written prose can never swallow the rest of the document;
 *  - a group whose content spans a BLANK LINE is refused (that bounds a caller
 *    handing over a wider slice than one paragraph);
 *  - a `{[}` / `{]}` PROTECTION is not a group, and that rule is ASKED of
 *    `CHAR_ESCAPE_TABLE` rather than re-spelled.
 *
 * Note the asymmetry with the escape members it sits beside: `\{` still parses
 * to a literal `{` in the prose buffer and still re-emits as `\{`, so a brace
 * the user genuinely means to PRINT is untouched. Only a BARE brace — one the
 * source already carried as syntax — takes the carrier.
 */
export function matchBraceGroupAt(
  text: string,
  pos: number,
): { content: string; end: number } | null {
  if (text[pos] !== "{" || isEscaped(text, pos)) return null;
  if (matchCharEscapeAt(text, pos)) return null;
  const group = extractBraced(text, pos);
  if (!group) return null;
  if (/\n[ \t]*\n/.test(group.content)) return null;
  return group;
}

// ---------------------------------------------------------------------------
// The RAW-LATEX vocabulary at a backslash — one answer, read by three layers
// ---------------------------------------------------------------------------

/**
 * A CONTROL SYMBOL at `pos` — `\` followed by exactly ONE non-letter character
 * (task 360).
 *
 * This is the member both inline parsers were missing. Their unknown-command
 * fallback reads a control WORD (`matchCommandToken`), and everything else at a
 * `\` fell through to a *lone backslash* branch that pushed the bare character
 * into the prose buffer — so `\,` `\;` `\!` `\:` `\ ` `\-` `\/` arrived in the
 * document as a literal backslash plus a literal punctuation mark, with nothing
 * left to say they had ever been LaTeX. Measured against this repo's own
 * corpora, `\;` (16), `\ ` (14) and `\,` (9) all occur in ordinary body prose —
 * `U.S.\ Route`, the standard abbreviation idiom.
 *
 * That was survivable only while `CHAR_ESCAPE_TABLE` left a backslash alone in
 * any run that held one (the pre-360 `prose-only` rule): the bytes round-tripped
 * *by accident*, because the escape rung could not tell the user's literal
 * backslash from LaTeX's. Once the carrier makes bare text prose by
 * construction and `\` is escaped unconditionally, an un-carried control symbol
 * is DESTROYED on the first save — `U.S.\ Route` → `U.S.\textbackslash{} Route`,
 * a printed backslash. So the carrier's vocabulary has to be TOTAL over the
 * backslash-led constructs, and this is the member that makes it so: after task
 * 360, a bare `\` in a text node is LITERAL, always.
 *
 * Deliberately does NOT consume an argument run. `\'{e}` reaches this door only
 * when {@link matchAccent} has already declined it (inside a code span, where
 * accents are suppressed), and there the following `{e}` is read by the group
 * rule on its own terms. Consuming a run here would let a `\ ` swallow a
 * genuinely prose `{…}` one character later — the same over-reach
 * {@link matchLineBreakAt} declines for its optional argument.
 *
 * A trailing `\` (nothing after it) and a `\` before a newline both answer null:
 * neither is a construct, both are literal, and both now round-trip as
 * `\textbackslash{}` instead of reaching the `.tex` as a dangling backslash.
 */
export function matchControlSymbolAt(
  text: string,
  pos: number,
): { raw: string; end: number } | null {
  if (text[pos] !== "\\") return null;
  const c = text[pos + 1];
  if (c === undefined) return null;
  if (/[a-zA-Z@]/.test(c)) return null; // a control WORD — not this door
  if (c === "\n" || c === "\r") return null;
  return { raw: text.slice(pos, pos + 2), end: pos + 2 };
}

/**
 * One span of text that must ride the raw-LaTeX carrier, and the CONSTRUCT it
 * belongs to.
 *
 * The two ranges differ only for a brace GROUP, where the bytes to mark are the
 * two braces and the construct is the whole group — which is what lets a caller
 * ask "did this edit write this construct?" once, for a `{` and a `}` the edit
 * may touch neither of (typing inside `{\bf hi}` touches only its content).
 */
export interface RawLatexSpan {
  /** Offsets, in the scanned string, of the bytes that take the carrier. */
  from: number;
  to: number;
  /** The whole construct those bytes belong to — the gating unit. */
  extentFrom: number;
  extentTo: number;
}

/**
 * Every RAW-LATEX span in one inline string (task 360).
 *
 * THE type-time half of the carrier law, and deliberately the same vocabulary,
 * in the same order, that both inline parsers read at a `\`: the line-break
 * token, a control WORD with its whole argument run, an accent, and a control
 * SYMBOL. Sharing the door is the point — what the user types and what a reload
 * produces cannot drift, because neither side spells its own answer.
 *
 * Two rules are this scanner's own, and both are PROVENANCE rules rather than
 * lexical ones:
 *
 *  - **A bare `{…}` group is raw LaTeX only if it CONTAINS raw LaTeX.** The
 *    parse rung carries the braces of *every* bare group (task 349 M6), because
 *    a group in the SOURCE is syntax the source already carried. A group the
 *    user TYPES is not: `see {this}` is prose, and its braces must print. So the
 *    evidence rule that task 339 applied to a whole run — *no backslash, no
 *    LaTeX* — is applied here at group granularity. The two answers are each a
 *    fixed point (a typed `{this}` saves as `\{this\}` and parses back to
 *    literal braces; a source `{this}` saves as `{this}` and parses back to a
 *    group), so nothing oscillates.
 *
 *  - **The char-escape spellings are NOT members.** A `\%` typed by a
 *    LaTeX-fluent user reaches this scanner as a control symbol and takes the
 *    carrier, so it emits `\%` and comes back from the next parse as the literal
 *    `%` it means. Asking `matchCharEscapeAt` here first would leave it bare, and
 *    the escape rung would then write `\textbackslash{}\%` — a printed
 *    backslash. The one word-shaped member, `\textbackslash{}`, is likewise read
 *    as a control word here and un-escaped to a literal `\` on the way back in.
 *
 * Returns spans in source order; nested constructs (a command inside a group)
 * appear after the group's own braces.
 */
export function scanRawLatexSpans(text: string): RawLatexSpan[] {
  const out: RawLatexSpan[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    if (ch === "{") {
      const group = matchBraceGroupAt(text, i);
      if (group) {
        const contentFrom = i + 1;
        const inner = scanRawLatexSpans(group.content);
        if (inner.length > 0) {
          // The braces themselves, plus every construct the content holds —
          // all sharing the GROUP's extent, so an edit anywhere inside it
          // writes the whole group. The content between them stays prose,
          // exactly as the parse rung leaves it.
          out.push({
            from: i,
            to: i + 1,
            extentFrom: i,
            extentTo: group.end,
          });
          out.push({
            from: group.end - 1,
            to: group.end,
            extentFrom: i,
            extentTo: group.end,
          });
          for (const s of inner) {
            out.push({
              from: contentFrom + s.from,
              to: contentFrom + s.to,
              extentFrom: contentFrom + s.extentFrom,
              extentTo: contentFrom + s.extentTo,
            });
          }
          i = group.end;
          continue;
        }
        // A group with no LaTeX in it is prose — skip PAST its opening brace
        // only, so a nested `{a {\bf b}}` is still reached by the outer scan.
      }
      i++;
      continue;
    }

    if (ch !== "\\") {
      i++;
      continue;
    }

    const push = (end: number) => {
      out.push({ from: i, to: end, extentFrom: i, extentTo: end });
      i = end;
    };

    const lineBreak = matchLineBreakAt(text, i);
    if (lineBreak) {
      push(lineBreak.end);
      continue;
    }
    const word = matchCommandToken(text, i);
    if (word) {
      push(matchCommandArgumentRun(text, word.end).end);
      continue;
    }
    const accent = matchAccent(text, i);
    if (accent) {
      push(accent.end);
      continue;
    }
    const symbol = matchControlSymbolAt(text, i);
    if (symbol) {
      push(symbol.end);
      continue;
    }
    i++; // a trailing `\` — literal
  }
  return out;
}
