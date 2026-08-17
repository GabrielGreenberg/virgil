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
 * Imports ONLY latex-typography (a leaf) to avoid a cycle.
 */

import {
  matchAccent,
  matchSpecialLetter,
  isEscaped,
  findUnescaped,
} from "@/lib/latex-typography";

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
 * to end of line) is the truth. This one asks what VIRGIL'S PARSER sees, which
 * is the only question a construct-terminator scan may ask, and the parser
 * recognizes a comment ONLY at the head of a line: `parseBody` takes its
 * `%` branch at a block boundary (after `skipWhitespace`), and `readParagraph`
 * breaks on a `%` only when the previous char is a newline. A mid-line `%` is
 * ordinary PROSE to Virgil, preserved byte-for-byte — `See a%b and more.` is
 * one text node, and `\url{http://ex.com/a%20b}` is one `latexCommand` run.
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
function startsLineComment(src: string, pos: number): boolean {
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
function stripInlineVerb(line: string): string {
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
      last = line.length;
      break;
    }
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
  const { begin: beginRe, end: endRe } = familyBeginEndRes(envs);

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
  let inVerbatim = false;
  for (const rawLine of src.split("\n")) {
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
          line = "";
          break;
        }
        inVerbatim = false;
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
        kept += inlineVerb ? stripInlineVerb(visible) : visible;
        break;
      }
      const head = line.slice(0, begin.index);
      kept += inlineVerb ? stripInlineVerb(head) : head;
      inVerbatim = true;
      line = line.slice(begin.index + begin[0].length);
    }
    out.push(kept);
  }
  return out.join("\n");
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

/** `\ex` / `\pex` at `pos` (control word, so `\b`-terminated), or null. */
function matchExOpenAt(
  src: string,
  pos: number,
): { name: string; end: number } | null {
  if (src[pos] !== "\\") return null;
  for (const name of ["pex", "ex"]) {
    if (src.startsWith(name, pos + 1) && !isWordChar(src[pos + 1 + name.length]))
      return { name, end: pos + 1 + name.length };
  }
  return null;
}

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

  const ex = matchExOpenAt(src, pos);
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
