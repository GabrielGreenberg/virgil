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
 *  (b) Scanners — position-based `findMatchingBrace`/`extractBraced`, a
 *      depth-counted `findMatchingEnv`, and a greedy `matchCommandToken`,
 *      consolidating the parser's copies. `matchAccent`/`matchSpecialLetter`
 *      are re-exported so consumers import them from one place.
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

/** The FULL verbatim family — what document-class scanning uses. */
export const VERBATIM_ENVS_FULL = [
  "verbatim",
  "verbatim*",
  "lstlisting",
  "minted",
] as const;

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

/** Drop inline `\verb<delim>…<delim>` / `\verb*<delim>…<delim>` runs from a
 *  single line, leaving everything else intact. The delimiter is the char
 *  right after `\verb`/`\verb*` and must be a non-letter (so `\verbatim`,
 *  `\verbdef`, etc. are left untouched), non-`*`, non-space char — the same
 *  boundary the parser's inline-verb matcher uses. An unterminated `\verb`
 *  on the line drops to end-of-line (verb runs do not cross a newline). */
function stripInlineVerb(line: string): string {
  const re = /\\verb\*?([^a-zA-Z*\s])/g;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const delim = m[1];
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

// ---------------------------------------------------------------------------
// Environment / command scanners
// ---------------------------------------------------------------------------

/**
 * Given a `\begin{env}` that has ALREADY been consumed (so `startPos` points
 * just past it, into the environment body), find the position (index of the
 * `\`) of the matching `\end{env}`. Depth-counted so nested same-name
 * environments pair correctly. Returns -1 if no matching close is found.
 *
 * `verbatim`-family environments are non-nestable and their body is literal,
 * so for those the correct terminator is the FIRST `\end{env}` — depth
 * counting is actively wrong (a literal `\begin{verbatim}` in the body would
 * bump the counter and swallow the real close). This mirrors the special
 * case the parser applied at the call site of the former `findMatchingEnd`.
 */
export function findMatchingEnv(
  src: string,
  startPos: number,
  envName: string,
): number {
  const beginTok = `\\begin{${envName}}`;
  const endTok = `\\end{${envName}}`;

  // Non-nestable literal envs: first close wins.
  if (isVerbatimFamily(envName)) {
    const idx = src.indexOf(endTok, startPos);
    return idx;
  }

  let depth = 1;
  let pos = startPos;
  while (pos < src.length) {
    const nextBegin = src.indexOf(beginTok, pos);
    const nextEnd = src.indexOf(endTok, pos);
    if (nextEnd === -1) return -1;
    if (nextBegin !== -1 && nextBegin < nextEnd) {
      depth++;
      pos = nextBegin + beginTok.length;
    } else {
      depth--;
      if (depth === 0) return nextEnd;
      pos = nextEnd + endTok.length;
    }
  }
  return -1;
}

function isVerbatimFamily(envName: string): boolean {
  // Derive from the single vocab SSOT — never re-enumerate the family here.
  // Adding a member to VERBATIM_ENVS_FULL must automatically grant it the
  // first-close-wins / literal-body handling below (task 243).
  return (VERBATIM_ENVS_FULL as readonly string[]).includes(envName);
}

/**
 * Given a `\begingl` that has ALREADY been consumed (so `startPos` points
 * just past it, into the gloss body), find the position (index of the `\`) of
 * the matching `\endgl`. expex's `\begingl…\endgl` is NOT a standard
 * `\begin{env}/\end{env}` pair, so this matches the bare command tokens.
 *
 * Boundary-correct: `\endgl` (and nested `\begingl`) must be terminated by a
 * non-letter, so `\endglpreamble`/`\beginglx` do not falsely terminate or
 * nest. Depth-counted so a nested `\begingl` pairs with its own `\endgl`.
 * Comment-aware: a `\endgl` in a `%`-comment tail does not terminate the
 * gloss. Returns -1 if no matching close is found.
 */
export function findMatchingGloss(src: string, startPos: number): number {
  // Project comments away so a commented `\endgl` is inert, but keep byte
  // offsets aligned by only scanning the live projection for structure while
  // reporting raw offsets. Comments only remove a line-tail, never shift
  // earlier bytes, so we track an in-comment flag inline instead.
  let depth = 1;
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
    if (ch === "%") {
      // Unescaped `%` starts a comment: an even run of backslashes before it
      // does not escape it (`\\%` = line break + comment). Same shared parity
      // rule the brace/math scanners use.
      if (!isEscaped(src, pos)) {
        inComment = true;
        pos++;
        continue;
      }
    }
    if (ch === "\\") {
      if (src.startsWith("\\begingl", pos) && !isLetter(src[pos + "\\begingl".length])) {
        depth++;
        pos += "\\begingl".length;
        continue;
      }
      if (src.startsWith("\\endgl", pos) && !isLetter(src[pos + "\\endgl".length])) {
        depth--;
        if (depth === 0) return pos;
        pos += "\\endgl".length;
        continue;
      }
      // Skip an escaped char (so `\%`, `\\` don't confuse the comment scan).
      pos += 2;
      continue;
    }
    pos++;
  }
  return -1;
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
