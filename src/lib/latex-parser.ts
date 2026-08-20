import { JSONContent } from "@tiptap/react";
import type { VirgilSidecar } from "@/lib/types";
import { richLatexToJson } from "@/lib/footnote-content";
import { matchCiteCommandAt } from "@/lib/cite-commands";
import {
  detachItemAnchor,
  generateShortId,
  NODE_UUID_ANCHOR,
  NODE_UUID_REGEX,
} from "@/lib/uuid";
import { collectExampleBodyLabelsJSON } from "@/lib/example-refs";
import {
  UUID_BEARING_NODE_TYPES,
  TITLED_NODE_TYPES,
  COLLAPSIBLE_NODE_TYPES,
} from "@/lib/node-attr-sets";
import {
  markerArgStart,
  markerOpensAt,
  PendingMarkerId,
  VIRGIL_MARKERS,
} from "@/lib/latex-markers";
import {
  extractFigureAttrs,
  extractGraphicsAttrs,
  matchIncludegraphics,
} from "@/lib/figures/parse-attrs";
import {
  matchAccent,
  matchSpecialLetter,
  dashesToGlyphs,
  matchCharEscapeAt,
  CHAR_ESCAPE_LEADS,
  matchTextMacroAt,
  matchQuotePairAt,
  QUOTE_PAIR_LEADS,
} from "@/lib/latex-typography";
import {
  extractBraced,
  extractBracketed,
  findMatchingEnv,
  findMatchingGloss,
  findMatchingXe,
  blockMarkerPrefixLength,
  matchExpexOpenerAt,
  matchLinguexItemAt,
  matchLinguexOpenerAt,
  LINGUEX_UNMODELLED_RE,
  preambleLoadsPackage,
  findDocumentBoundary,
  END_DOCUMENT_TOKEN,
  isEscaped,
  findUnescaped,
  matchBeginEnvAt,
  matchBraceGroupAt,
  matchCommandToken,
  matchCommandArgumentRun,
  matchSectioningCommandAt,
  matchStarOptBraceAt,
  matchControlSymbolAt,
  matchInlineMathAt,
  matchInlineVerbAt,
  matchLineBreakAt,
  skipOpaqueConstructAt,
  skipLineCommentAt,
  projectStructuralLatex,
  unwrapVerbatimEnvBody,
  verbatimMark,
  commentTailMark,
  matchCommentTailAt,
  startsLineComment,
  startsBlockBoundary,
  wrapVerbatimEnvBody,
} from "@/lib/latex-lexer";
import {
  DEFAULT_EXAMPLE_DIALECT,
  type ExampleDialect,
} from "@/lib/example-dialect";

interface ParseContext {
  pos: number;
  src: string;
  /** Stashed example id from a preceding `\vexid{uuid}`. Consumed by
   *  the next `\ex` / `\pex` block. */
  pendingExampleId?: string | null;
}

/**
 * **May this parse MODEL linguex examples?** — a per-DOCUMENT fact, so it is
 * module state beside `seenTitleFields` rather than a `ParseContext` field.
 *
 * That placement is the whole point. `ParseContext` is per-SLICE: `parseBody`
 * runs on a quote body, a list item and an example body in their own contexts,
 * and a document-level capability threaded through four constructors is a
 * capability someone forgets at the fifth. Reset at the top of `parseLatex`,
 * which is the ONLY layer that has a preamble to ask.
 *
 * It gates MODELLING, never RECOGNITION: a `\ex.` site is linguex by FORM
 * wherever it appears (`matchLinguexOpenerAt` — form alone, no preamble), and
 * this decides whether Virgil claims it as an `exampleBlock` (task 355) or
 * carries its bytes raw as task 350 left it. Absent — a fragment, a card body,
 * a paste, anything with no preamble — the answer is `false`, so the CARRY is
 * the fail-safe default rather than a decision anyone has to remember.
 */
let linguexModelled = false;

function stripPreamble(latex: string): string {
  const { bodyStart, endDoc } = findDocumentBoundary(latex);
  if (bodyStart !== -1) {
    // unterminated-ok: no LIVE `\end{document}` means the body genuinely does
    // run to EOF — there is no content past it that this claim could swallow.
    const end = endDoc !== -1 ? endDoc : latex.length;
    return latex.slice(bodyStart, end).trim();
  }
  return latex.trim();
}

/**
 * Extract the preamble (everything up to and including `\begin{document}`)
 * and postamble (`\end{document}` onward) from a LaTeX source. Returns
 * `null` if the source has no `\begin{document}` marker.
 *
 * The returned preamble has `\title{…}` / `\author{…}` / `\date{…}`
 * commands stripped out — those are hoisted into the doc tree as
 * `titleField` nodes, and the serializer re-injects them before
 * `\begin{document}`. Leaving them in the preserved preamble would
 * cause duplicate emission on save.
 *
 * The returned strings are shaped so that
 *   `preamble + body + postamble`
 * reproduces a well-formed `.tex` file. The serializer uses this to
 * preserve the user's original preamble across parse/serialize cycles.
 */
export function extractPreambleAndPostamble(
  latex: string,
): { preamble: string; postamble: string } | null {
  const { beginDoc, bodyStart, endDoc } = findDocumentBoundary(latex);
  if (beginDoc === -1) return null;
  const rawPreamble = latex.slice(0, beginDoc);
  const strippedPreamble = stripTitleFieldsFromText(rawPreamble);
  // The user's own spelling of the token is carried, not re-canonicalized: for
  // the ordinary `\begin{document}` this slice IS the literal, byte for byte,
  // and for the spaced `\begin {document}` TeX accepts (task 375 M5) it is what
  // the user wrote. Re-normalizing would be a silent rewrite of a line nobody
  // asked us to touch.
  const preamble = strippedPreamble + latex.slice(beginDoc, bodyStart) + "\n\n";
  const postamble =
    endDoc !== -1
      ? "\n" + latex.slice(endDoc).replace(/\n*$/, "\n")
      : "\n" + END_DOCUMENT_TOKEN + "\n";
  return { preamble, postamble };
}

/**
 * The `{preamble, postamble}` a WRITE of `rawTex` must use — **the one door**
 * every save path enters, because the alternative each of them used to spell
 * ("`extractPreambleAndPostamble` said null, so seed from the style") is an
 * inference the null does not support.
 *
 * Three cases, and only the FIRST is allowed to invent bytes:
 *
 *  - **The file is EMPTY** (no bytes, or only whitespace) — `null`, meaning
 *    "there is no document here yet; seed the preamble from the doc's selected
 *    style". This is the brand-new-document case the seed was written for.
 *  - **The boundary is located** — the user's own delimiters, verbatim.
 *  - **The file has BYTES but no locatable boundary** — a fragment (a chapter
 *    some master file `\input`s), a preamble-only file, a mid-edit `.tex` —
 *    `{ preamble: "", postamble: "" }`: the whole file is body, so it is
 *    written back as body and nothing is prepended to it.
 *
 * That third case is task 375 member M5, and before this it was read as the
 * first: `\begin {document}` (a spelling TeX accepts, and which the boundary
 * door now locates) returned null, so a paper's `\documentclass[11pt]{amsart}`
 * and its packages were carried into the BODY while a *different*
 * `\documentclass` was written above them from a style seed — on OPEN, with no
 * edit by the user. **A `.tex` with bytes in it must never have its preamble
 * replaced by a write nobody asked for**; where we cannot say where the
 * preamble ends, the honest answer is to add none.
 */
export function resolveWriteDelimiters(
  rawTex: string | null | undefined,
): { preamble: string; postamble: string } | null {
  if (!rawTex || rawTex.trim() === "") return null;
  return extractPreambleAndPostamble(rawTex) ?? { preamble: "", postamble: "" };
}

/**
 * One occurrence of a `\title{…}` / `\author{…}` / `\date{…}` command in a
 * preamble, with the exact byte span the hoist would remove.
 */
interface PreambleTitleFieldOccurrence {
  field: string;
  /** Index of the leading backslash. */
  start: number;
  /** One past the last byte the hoist removes (brace close, any `%!v:` anchor, one trailing newline). */
  end: number;
  /** Raw brace content. */
  inner: string;
  /** Raw `[short]` argument; null when the source had no bracket. */
  shortTitle: string | null;
  uuid: string | null;
}

/** The three fields Virgil hoists into `titleField` nodes. The ONE spelling —
 *  the preamble scan and the body-position branch both read it. */
const TITLE_FIELD_NAMES: ReadonlySet<string> = new Set([
  "title",
  "author",
  "date",
]);

/**
 * Find every LIVE `\title` / `\author` / `\date` command in a preamble — ONE
 * scan, read by BOTH the strip and the parse (task 356 site 3).
 *
 * That the two were separate scans is the whole defect: they disagreed in two
 * ways at once, and each disagreement destroyed something different.
 *
 *  - **Comment-blindness.** Neither predated the `%`-projection SSOT, so
 *    `%\title{old draft}` sitting above the live `\title{…}` was PROMOTED to
 *    be the document title (the parse keeps the FIRST match) while the real
 *    one was stripped from the preamble and never emitted — the user's title
 *    replaced by a commented-out draft, on OPEN, with no edit. The strip also
 *    swallowed the trailing newline, fusing the orphaned `%` onto the NEXT
 *    preamble line and commenting THAT out too. Comment membership is asked of
 *    `matchCommentTailAt` — TeX's rule, escape-aware, so `\%` is never a
 *    comment and a mid-line `%` still shadows what follows it on that line.
 *  - **strip-ALL vs keep-FIRST.** The strip removed every occurrence and the
 *    parse kept only the first of each field, so an `amsart`/ACM-style
 *    multi-author preamble (repeated `\author{…}`) lost every author but one —
 *    silently, and under the 350-D preservation gate's word slack.
 *
 * The rule both halves now share: a field is HOISTED only when it occurs
 * exactly ONCE live. A repeated field is left RAW in the preserved preamble,
 * where it round-trips byte-for-byte in its original order — Virgil's title
 * model is one field per kind, so a repeated field is simply outside it, and
 * the answer to that is task 342's ("what the system does not model, it
 * CARRIES"), not a silent drop. Cost, stated: a multi-author paper's authors
 * are not editable from the title strip. Data over affordance.
 */
function findPreambleTitleFields(
  text: string,
): PreambleTitleFieldOccurrence[] {
  const out: PreambleTitleFieldOccurrence[] = [];
  let i = 0;
  while (i < text.length) {
    // A comment tail owns everything to the end of its line — including any
    // `\title{…}` inside it. Skip the whole run.
    const comment = matchCommentTailAt(text, i);
    if (comment) {
      i = comment.end;
      continue;
    }
    if (text[i] !== "\\") {
      i++;
      continue;
    }
    const word = matchCommandToken(text, i);
    if (!word || !TITLE_FIELD_NAMES.has(word.name)) {
      i++;
      continue;
    }
    // `[short]` is legal on all three in beamer / revtex / acmart, and the
    // brace need not abut (task 376 M6). A STARRED spelling is refused to the
    // raw preamble rather than claimed: none of the three has one, and a fact
    // the model cannot carry must not be swallowed.
    const braced = matchStarOptBraceAt(text, word.end);
    if (!braced || braced.starred) {
      // Unbalanced argument — fail closed: the bytes stay put as raw preamble.
      i++;
      continue;
    }
    let end = braced.end;
    let uuid: string | null = null;
    const afterMatch = text.slice(end).match(NODE_UUID_ANCHOR);
    if (afterMatch) {
      uuid = afterMatch[1];
      end += afterMatch[0].length;
    }
    // Swallow one trailing newline so the hoist doesn't leave a blank row.
    if (text[end] === "\n") end++;
    out.push({
      field: word.name,
      start: i,
      end,
      inner: braced.required,
      shortTitle: braced.optional,
      uuid,
    });
    i = braced.end;
  }
  return out;
}

/** The occurrences the parse hoists into `titleField` nodes and the strip
 *  therefore removes — a field that occurs more than once live stays raw. */
function hoistablePreambleTitleFields(
  text: string,
): PreambleTitleFieldOccurrence[] {
  const found = findPreambleTitleFields(text);
  const count = new Map<string, number>();
  for (const o of found) count.set(o.field, (count.get(o.field) ?? 0) + 1);
  return found.filter((o) => count.get(o.field) === 1);
}

/**
 * Remove exactly the `\title{…}` / `\author{…}` / `\date{…}` commands the
 * parser HOISTS into the doc tree — no more, no less. Anything left behind
 * (a commented-out draft, a repeated field) is preserved raw, in place.
 */
function stripTitleFieldsFromText(text: string): string {
  const spans = hoistablePreambleTitleFields(text);
  if (spans.length === 0) return text;
  let out = "";
  let cursor = 0;
  for (const span of spans) {
    out += text.slice(cursor, span.start);
    cursor = span.end;
  }
  out += text.slice(cursor);
  return out;
}

/**
 * Parse the hoistable `\title{…}` / `\author{…}` / `\date{…}` commands from a
 * preamble string into `titleField` nodes, so title commands placed before
 * `\begin{document}` are visible and editable in the editor.
 *
 * Note: titleField nodes are ALWAYS treated as preamble-bound by the
 * serializer (it walks the whole doc and re-emits them in canonical
 * order into the preamble). The earlier per-node `fromPreamble` flag
 * was retired — flag fragility was a bug source (any HTML round-trip
 * would drop it, and the next save would mis-emit to body).
 */
function parsePreambleTitleFields(preamble: string): JSONContent[] {
  const nodes: JSONContent[] = [];
  for (const occ of hoistablePreambleTitleFields(preamble)) {
    let rawContent = occ.inner;
    let rawPrefix = "";
    const prefixMatch = rawContent.match(/^((?:\\(?:rmfamily|Large|large|huge|Huge|bfseries|itshape|sffamily|normalsize|small|footnotesize|tiny|textbf|textit|textsf)\s*)+)/);
    if (prefixMatch) {
      rawPrefix = prefixMatch[1];
      rawContent = rawContent.slice(rawPrefix.length);
    }
    let isToday = false;
    if (rawContent.trim() === "\\today") {
      isToday = true;
      const now = new Date();
      rawContent = now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    }
    const attrs: Record<string, unknown> = {
      field: occ.field,
      rawPrefix: rawPrefix || null,
      isToday,
      uuid: occ.uuid,
    };
    if (occ.shortTitle !== null) attrs.shortTitle = occ.shortTitle;
    nodes.push({
      type: "titleField",
      attrs,
      content: parseInlineContent(rawContent),
    });
  }
  // Stable canonical order: title, author, date.
  const order: Record<string, number> = { title: 0, author: 1, date: 2 };
  nodes.sort((a, b) => (order[a.attrs?.field as string] ?? 99) - (order[b.attrs?.field as string] ?? 99));
  return nodes;
}

/**
 * Parse a run of inline LaTeX into Tiptap inline nodes.
 *
 * `\vfid{uuid}` and `\vcid{uuid}` are no-op markers the serializer emits
 * right before `\footnote{...}` / `\cite{...}` to preserve stable
 * `footnoteId` / `citationId` values across parse cycles. When we see one,
 * we stash the id in `pendingFootnoteId` / `pendingCitationId`; the atom that
 * starts at exactly that position consumes it, and nothing else can (see
 * {@link PendingMarkerId} — task 341). Without these markers we fall back to
 * `generateShortId()` for legacy `.tex` files without markers — first
 * save will anchor the generated id back into the source.
 *
 * `opts.commentTails` opts this run in to recognizing a `%` COMMENT TAIL as
 * the byte-literal carrier it is (task 347). It is OFF by default, and the
 * default is the load-bearing half: a comment tail owns everything to the end
 * of its LINE, so it may only be recognized where the emitted form actually
 * ends a line. Inside a braced ARGUMENT (`\texttt{5% off}`, a `\footnote{}`
 * body, a gloss cell, a figure caption) the very next byte the serializer
 * writes is the closing `}` — a carrier there would comment out the brace and
 * break the user's document. So the block-level paragraph callers opt IN, the
 * six recursive argument calls below inherit the OFF default, and a new caller
 * has to state that its content is line-final before it can get one.
 *
 * `inCode` says the run sits inside a `\texttt{}` CODE SPAN, where `--` is two
 * literal hyphens and an accent command stays raw (memo §A exclusion). It is
 * INHERITED by every mark recursion below, and pre-377 it was not: only the
 * `\texttt` branch passed anything, so a command nested INSIDE a code span had
 * its body typographied. The emit side reads the same fact correctly and at the
 * same depth (`inlineTextBytes` suppresses typography under a `code` wrapper),
 * so the two rungs disagreeing wrote a raw U+2013 / U+00E9 straight into the
 * `.tex`: `\texttt{\textbf{x--y}}` came back `\texttt{\textbf{x\u2013y}}`, where
 * the source's two hyphens must print as two hyphens. `\texttt{x--y}` (one
 * level) was always correct, which is why it read as latent. The card/footnote
 * fork had the identical gap (task 341's twin rule).
 */
export function parseInlineContent(
  text: string,
  inCode = false,
  opts?: { commentTails?: boolean },
): JSONContent[] {
  const nodes: JSONContent[] = [];
  let i = 0;
  let buffer = "";
  const pendingFootnoteId = new PendingMarkerId();
  const pendingCitationId = new PendingMarkerId();

  const flush = () => {
    if (buffer) {
      // Dashes (-- / ---) → en/em glyph at flush time, EXCEPT inside code
      // spans where `--` is literal (memo §A exclusion). Accents/special
      // letters are matched as commands below, also gated by `inCode`.
      //
      // There is no un-escape pass here, deliberately: character un-escaping
      // happens in the SCANNER (`matchCharEscapeAt`, driven by
      // `CHAR_ESCAPE_TABLE`), so by the time a run reaches the buffer every
      // `\{` / `\$` / `\textbackslash{}` is already the literal character.
      // Until task 339 this line called `unescapeLatex(flushed)` — an
      // `unescapeLatex(text) { return text; }` stub, i.e. a dead SSOT that the
      // serializer's own comment cited as the round trip's other half. That is
      // exactly how the two rungs came to disagree with nobody noticing.
      const flushed = inCode ? buffer : dashesToGlyphs(buffer);
      nodes.push({ type: "text", text: flushed });
      buffer = "";
    }
  };

  while (i < text.length) {
    // LaTeX double-quote pairs → curly quotes in the display. The spellings
    // AND the positions come from `QUOTE_PAIR_TABLE` (task 368) — this test was
    // hand-written here and in the other inline parser, byte for byte, and a
    // third copy was about to be written for the display projection. A lone
    // backtick or apostrophe still passes through: single-quote LaTeX semantics
    // and apostrophes in contractions are out of scope.
    if (QUOTE_PAIR_LEADS.has(text[i])) {
      const quotePair = matchQuotePairAt(text, i);
      if (quotePair) {
        buffer += quotePair.glyph;
        i = quotePair.end;
        continue;
      }
    }

    // Non-backslash members of `CHAR_ESCAPE_TABLE`: the `{[}` / `{]}` prose
    // bracket protections (task 037's `$` twin) and the `~` TIE (task 349 M5).
    //
    // The serializer wraps a prose `[`/`]` in its own brace group so it can't
    // be absorbed as a LaTeX optional argument (`\\[len]`, `\cmd[opt]`); here
    // we unwrap it back to a bare glyph in the buffer, so adjacent letters stay
    // one text node. A `~` resolves to U+00A0, the character it MEANS — which
    // is what keeps it distinguishable from the ASCII tilde `\textasciitilde{}`
    // un-escapes to two lines further down, and so from being re-escaped into a
    // printed tilde on the next save.
    //
    // Not gated on `inCode`: inline-code (`\texttt`) prose is escaped by the
    // same rung and must round-trip identically, and a `~` inside `\texttt{a~b}`
    // is a tie exactly as it is outside one. Genuine structural brackets never
    // reach this inline scanner as the literal triple `{[}` — they live on
    // latexCommand / texBlock / example paths.
    //
    // The spellings AND the set of positions come from `CHAR_ESCAPE_TABLE`
    // (task 339 / 349) — the same table the serializer's escape rung reads — so
    // neither the members nor their reachability can drift from the emit side.
    // The `\`-led family is matched from the `\` branch below at the position it
    // has always been matched, after the command rules.
    if (CHAR_ESCAPE_LEADS.has(text[i])) {
      const glyph = matchCharEscapeAt(text, i);
      if (glyph) {
        buffer += glyph.char;
        i = glyph.end;
        continue;
      }
    }

    // A BARE `{…}` GROUP → its braces on the raw-LaTeX carrier, its content
    // parsed as ordinary inline prose (task 349 M6). Reached only after the
    // protections above have declined, so `{[}` still unwraps to a literal `[`.
    // The `opts` are passed DOWN rather than reset: these braces are the
    // SOURCE's own bytes at these positions, so re-emitting the content exactly
    // as it arrived is what makes the group byte-identical — where a braced
    // ARGUMENT (below) is a wrapper the serializer fabricates, and a comment
    // tail inside one would comment out a `}` the source never had.
    {
      const group = matchBraceGroupAt(text, i);
      if (group) {
        flush();
        nodes.push({
          type: "text",
          text: "{",
          marks: [{ type: "latexCommand" }],
        });
        nodes.push(...parseInlineContent(group.content, inCode, opts));
        nodes.push({
          type: "text",
          text: "}",
          marks: [{ type: "latexCommand" }],
        });
        i = group.end;
        continue;
      }
    }

    // Inline math — `$…$`, `$$…$$`, `\[…\]`, `\(…\)`, longest-opener-first.
    // Its content is LITERAL math and must NEVER reach the dash/accent buffer
    // (memo §A "Critical exclusions": math stays literal). Preserving it as a
    // math node keeps `--`, `\'e`, etc. verbatim in the latex attr — the
    // transforms only run on the plain-text buffer, which math content never
    // enters. (Pre-typography behavior left two empty inlineMath nodes with
    // the content leaking as glyphified plain text — the D2 regression.)
    //
    // The delimiter set and the escape-aware close search live in the lexer's
    // `matchInlineMathAt`, which the footnote/card fork reads too (task 341) —
    // the same shared-scanner shape `matchInlineVerbAt` already has. Block-level
    // `\[…\]` at a paragraph boundary is handled by the block parser; this
    // catches the mid-paragraph case the block parser doesn't split out.
    {
      const math = matchInlineMathAt(text, i);
      if (math) {
        flush();
        nodes.push({ type: "inlineMath", attrs: { latex: math.latex } });
        i = math.end;
        continue;
      }
    }

    // `%` COMMENT TAIL → the byte-literal comment carrier (task 347).
    //
    // Position matters twice over. It sits AFTER the verb/math matchers above
    // and after every command rule below is unreachable for this byte — a `%`
    // inside `\verb|a%b|`, inside `$…$`, or inside `\url{http://ex.com/a%20b}`
    // has already been consumed as part of that construct, which is why task
    // 338's `\url` case stays byte-identical and why this branch never has to
    // re-derive what a command IS. And it is reached only for an UNESCAPED `%`:
    // `\%` enters the `\` branch and is consumed by `matchCharEscapeAt`, so a
    // percent the user genuinely wrote still round-trips as `\%`.
    //
    // Gated on `opts.commentTails` — see the header for why OFF is the default
    // and which callers may turn it on.
    if (opts?.commentTails && text[i] === "%") {
      const tail = matchCommentTailAt(text, i);
      if (tail) {
        flush();
        nodes.push({
          type: "text",
          text: tail.raw,
          marks: [commentTailMark()],
        });
        i = tail.end;
        continue;
      }
    }

    // LaTeX commands for marks
    if (text[i] === "\\") {
      const rest = text.slice(i);

      // \verb<delim>…<delim> and \verb*<delim>…<delim> — verbatim. The
      // delimiter-paired payload is LITERAL (`--` is two hyphens, `\'e` is raw)
      // and must be excluded from the dash/accent transforms (memo §A). We
      // consume the whole `\verb|…|` and emit it as ONE byte-literal node.
      // Delimiter boundary rules (a non-letter, non-`*`, non-space char, so
      // `\verbatim`/`\verbdef` don't mis-lex) live in the lexer's shared
      // `matchInlineVerbAt`, which the footnote/card inline parser reads too.
      const verbEnd = matchInlineVerbAt(text, i);
      if (verbEnd !== -1) {
        flush();
        // Preserve the exact `\verb<delim>…<delim>` spelling so it round-trips:
        // a `code` mark would serialize to `\texttt{…}` (wrong — and would
        // re-run typography on edit), so we keep the literal command form on
        // the VERBATIM carrier. Until task 264 this rode the undifferentiated
        // `latexCommand` mark, whose serializer path smart-quotes — so the
        // "stays byte-faithful" claim this comment used to make was false for
        // quotes: `\verb|x="hi"|` came back as ``\verb|x=``hi''|``, and
        // `\verb"code"` (quote as the DELIMITER) came back as ``\verb``code''``,
        // which is not even a valid `\verb` invocation. `latexVerbatim` is
        // returned untouched by every serializer, so the claim is now true.
        nodes.push({
          type: "text",
          text: text.slice(i, verbEnd),
          marks: [verbatimMark()],
        });
        i = verbEnd;
        continue;
      }

      // \textbf{...}
      const boldMatch = rest.match(/^\\textbf\{/);
      if (boldMatch) {
        flush();
        const inner = extractBraced(text, i + "\\textbf".length);
        if (inner !== null) {
          const innerNodes = parseInlineContent(inner.content, inCode);
          for (const n of innerNodes) {
            nodes.push({
              ...n,
              marks: [...(n.marks || []), { type: "bold" }],
            });
          }
          i = inner.end;
          continue;
        }
      }

      // \emph{...}
      const emphMatch = rest.match(/^\\emph\{/);
      if (emphMatch) {
        flush();
        const inner = extractBraced(text, i + "\\emph".length);
        if (inner !== null) {
          const innerNodes = parseInlineContent(inner.content, inCode);
          for (const n of innerNodes) {
            nodes.push({
              ...n,
              marks: [...(n.marks || []), { type: "italic" }],
            });
          }
          i = inner.end;
          continue;
        }
      }

      // \underline{...}
      const ulMatch = rest.match(/^\\underline\{/);
      if (ulMatch) {
        flush();
        const inner = extractBraced(text, i + "\\underline".length);
        if (inner !== null) {
          const innerNodes = parseInlineContent(inner.content, inCode);
          for (const n of innerNodes) {
            nodes.push({
              ...n,
              marks: [...(n.marks || []), { type: "underline" }],
            });
          }
          i = inner.end;
          continue;
        }
      }

      // \textit{...}
      const textitMatch = rest.match(/^\\textit\{/);
      if (textitMatch) {
        flush();
        const inner = extractBraced(text, i + "\\textit".length);
        if (inner !== null) {
          const innerNodes = parseInlineContent(inner.content, inCode);
          for (const n of innerNodes) {
            nodes.push({
              ...n,
              marks: [...(n.marks || []), { type: "italic" }],
            });
          }
          i = inner.end;
          continue;
        }
      }

      // \texttt{...}
      const ttMatch = rest.match(/^\\texttt\{/);
      if (ttMatch) {
        flush();
        const inner = extractBraced(text, i + "\\texttt".length);
        if (inner !== null) {
          // Code span: suppress typographic transforms (`--` is literal,
          // accent commands stay raw) — memo §A exclusion. `true` rather than
          // `inCode` because THIS is the command that opens a code span.
          const innerNodes = parseInlineContent(inner.content, true);
          for (const n of innerNodes) {
            nodes.push({
              ...n,
              marks: [...(n.marks || []), { type: "code" }],
            });
          }
          i = inner.end;
          continue;
        }
      }

      // \textcolor[HTML]{RRGGBB}{...} — emitted by the textColor mark.
      // Named-color variants (\textcolor{red}{...}) are intentionally
      // skipped; they round-trip as plain text without a mark.
      const tcMatch = rest.match(/^\\textcolor\[HTML\]\{([0-9A-Fa-f]{6})\}\{/);
      if (tcMatch) {
        flush();
        const colorHex = tcMatch[1].toUpperCase();
        // tcMatch[0] ends with the opening "{" of the inner arg; rewind
        // one char so extractBraced lands on that brace.
        const argStart = i + tcMatch[0].length - 1;
        const inner = extractBraced(text, argStart);
        if (inner !== null) {
          const innerNodes = parseInlineContent(inner.content, inCode);
          for (const n of innerNodes) {
            nodes.push({
              ...n,
              marks: [
                ...(n.marks || []),
                { type: "textColor", attrs: { color: `#${colorHex}` } },
              ],
            });
          }
          i = inner.end;
          continue;
        }
      }

      // \vfid{uuid} — no-op marker stashing a stable footnoteId for the
      // footnote that starts where the marker ends. Emitted by the serializer.
      if (markerOpensAt(text, i, VIRGIL_MARKERS.footnote)) {
        const idArg = extractBraced(text, markerArgStart(i, VIRGIL_MARKERS.footnote));
        if (idArg !== null) {
          pendingFootnoteId.set(idArg.content || null, idArg.end);
          i = idArg.end;
          continue;
        }
      }

      // \vcid{uuid} — same, for citationId.
      if (markerOpensAt(text, i, VIRGIL_MARKERS.citation)) {
        const idArg = extractBraced(text, markerArgStart(i, VIRGIL_MARKERS.citation));
        if (idArg !== null) {
          pendingCitationId.set(idArg.content || null, idArg.end);
          i = idArg.end;
          continue;
        }
      }

      // \vlid{anchorId} / \vlidend{anchorId} — paired markers for a
      // `linkedAnchor` mark that spans the enclosed text. May span
      // paragraph boundaries; the post-pass `applyLinkedAnchorBoundaries`
      // walks the assembled doc and stamps marks over each open range.
      // Here we emit transient boundary sentinels in the inline stream.
      if (markerOpensAt(text, i, VIRGIL_MARKERS.linkedRangeOpen)) {
        const idArg = extractBraced(
          text,
          markerArgStart(i, VIRGIL_MARKERS.linkedRangeOpen),
        );
        if (idArg !== null) {
          flush();
          nodes.push({
            type: "_linkedAnchorBoundary",
            attrs: { kind: "open", anchorId: idArg.content || "" },
          });
          i = idArg.end;
          continue;
        }
      }
      if (markerOpensAt(text, i, VIRGIL_MARKERS.linkedRangeClose)) {
        const idArg = extractBraced(
          text,
          markerArgStart(i, VIRGIL_MARKERS.linkedRangeClose),
        );
        if (idArg !== null) {
          flush();
          nodes.push({
            type: "_linkedAnchorBoundary",
            attrs: { kind: "close", anchorId: idArg.content || "" },
          });
          i = idArg.end;
          continue;
        }
      }

      // \footnote[n]{...} — the optional argument is LaTeX's own "print this
      // mark instead of the counter". Read through the shared
      // `[opt]{req}` door (task 376 M5): the hand-written `/^\\footnote\{/`
      // required the brace to ABUT, so `\footnote[3]{…}` was not a footnote at
      // all — no node, no `\vfid` marker, no card, no panel row, where the
      // plain spelling gets the whole apparatus.
      //
      // A `\footnote*` is REFUSED to the carrier rather than claimed: there is
      // no such command in LaTeX, and claiming a spelling whose facts the model
      // cannot carry is how a star gets silently deleted (task 356's rule,
      // and M4 one construct over).
      if (matchCommandToken(text, i)?.name === "footnote") {
        const args = matchStarOptBraceAt(
          text,
          i + "\\footnote".length,
        );
        if (args && !args.starred) {
          flush();
          const attrs: Record<string, unknown> = {
            content: richLatexToJson(args.required),
            number: 0,
            footnoteId: pendingFootnoteId.take(i) || generateShortId(),
          };
          // Raw and opaque, the `exnoOverride` shape. Deliberately NOT fed to
          // `numberFootnotes`: in LaTeX `\footnote[3]` also does not STEP the
          // counter, so honouring it in Virgil's own chrome means renegotiating
          // how every following footnote is numbered — a bigger change than
          // carrying the byte, and one the bytes do not depend on.
          if (args.optional !== null) attrs.numberOverride = args.optional;
          nodes.push({ type: "footnote", attrs });
          i = args.end;
          continue;
        }
      }

      // \thanks{...} — title-page acknowledgement; reuses the footnote node
      // with thanks=true so it threads through the footnote panel/omni-view.
      //
      // The same door as its `\footnote` sibling (task 376), so the pair cannot
      // drift on what an argument looks like — but `\thanks` has NEITHER a star
      // NOR an optional argument in LaTeX, so a spelling carrying one is
      // REFUSED to the carrier rather than claimed and re-emitted without it.
      if (matchCommandToken(text, i)?.name === "thanks") {
        const thanksArgs = matchStarOptBraceAt(text, i + "\\thanks".length);
        const inner =
          thanksArgs && !thanksArgs.starred && thanksArgs.optional === null
            ? { content: thanksArgs.required, end: thanksArgs.end }
            : null;
        if (inner !== null) {
          flush();
          nodes.push({
            type: "footnote",
            attrs: {
              content: richLatexToJson(inner.content),
              number: 0,
              footnoteId: pendingFootnoteId.take(i) || generateShortId(),
              thanks: true,
            },
          });
          i = inner.end;
          continue;
        }
      }

      // Citation commands: natbib (\cite, \citet, \citep, etc.) and biblatex
      // (\textcite, \parencite, \cites, etc.). Both the NAME vocabulary and the
      // `[pre][post]{key}` argument grammar (repeated, for the plural forms)
      // come from the registry's `matchCiteCommandAt`, which the footnote/card
      // fork reads too — task 341, where the fork's hand-written twin of this
      // loop was ten names short AND consumed the repetition wrong.
      const cite = matchCiteCommandAt(text, i);
      if (cite && cite.keyed) {
        flush();
        nodes.push({
          type: "citation",
          attrs: {
            citationId: pendingCitationId.take(i) || generateShortId(),
            command: cite.command,
            displayText: "",
          },
        });
        i = cite.end;
        continue;
      }
      // An UNKEYED cite name is not a citation, so it falls through to the
      // unknown-`\command` branch below and takes the CARRIER with its whole
      // argument run — which is where the card fork has always sent it (task
      // 341's twin rule; the two now agree byte-for-byte on `\citep[see]`).
      // Until task 360 this branch pushed `cite.command` into the PROSE buffer
      // and stopped there, so the name's own `[see]` was left to the escape
      // rung, which protects a prose bracket as `{[}see{]}`. That was invisible
      // only because the buffered backslash also suppressed the protection —
      // one accident hiding another.

      // \ref{key} / \getref{key} / \getfullref{key.sub} — cross-reference
      const refCmdMatch = rest.match(/^\\(getfullref|getref|ref)\{/);
      if (refCmdMatch) {
        flush();
        const inner = extractBraced(text, i + refCmdMatch[0].length - 1);
        if (inner) {
          const refCommand =
            refCmdMatch[1] === "getfullref"
              ? "getfullref"
              : refCmdMatch[1] === "getref"
                ? "getref"
                : "ref";
          nodes.push({
            type: "labelRef",
            attrs: {
              label: inner.content,
              displayText: "",
              refCommand,
              targetKind: null,
            },
          });
          i = inner.end;
          continue;
        }
      }

      // Common text commands
      // Suppressed inside a CODE SPAN (task 380 M3), for the reason the accent
      // and special-letter rungs just below already were: the EMIT side reads
      // the same fact (`inlineTextBytes` suppresses typography under a `code`
      // wrapper), so converting here with no way back wrote a raw U+2026 into
      // the `.tex` — `\texttt{a\ldots b}` came back `\texttt{a… b}` on the
      // first save. Task 377 M4 closed exactly this for `--` and the accents
      // and left the text macro out; it is the same fork, one member over.
      // The vocabulary is `TEXT_MACRO_TABLE`'s, not a local alternation: this
      // was hand-written here AND in the card/footnote fork (task 341's twin
      // rule), and its ellipsis half was a second spelling of `LITERAL_TABLE`'s
      // own `latexForms` — the same shape task 255 retired for the marker
      // commands. Byte-identical to the `\b`-terminated alternation it replaces.
      const textMacro = inCode ? null : matchTextMacroAt(text, i);
      if (textMacro) {
        buffer += textMacro.text;
        i = textMacro.end;
        continue;
      }

      // Escaped special chars — matched from `CHAR_ESCAPE_TABLE` (task 339),
      // the same table the serializer emits from, longest-spelling-first so
      // `\textbackslash{}` wins over any shorter member prefixing it. Sits
      // exactly where the hand-written alternation sat: AFTER the command
      // rules above (so `\ldots` etc. still win) and BEFORE the `\\` hard
      // break, which no table member spells.
      const esc = matchCharEscapeAt(text, i);
      if (esc) {
        buffer += esc.char;
        i = esc.end;
        continue;
      }

      // `\\` -> hard break, and its own ARGUMENT RUN if it has one.
      //
      // A bare `\\` is the modelled `hardBreak` node (what Shift+Enter produces,
      // and what the serializer writes back as `\\\n`). A break carrying `*`
      // and/or `[<len>]` is carried byte-literally on the raw-LaTeX mark
      // instead: Virgil does not model break spacing, and before task 349 M4
      // those bytes were demoted to prose, where the escape table's `protect`
      // member turned `\\[2pt]` into a printed `[2pt]` and (one step earlier)
      // `readParagraph` split the paragraph at the `\[` and emitted an
      // unterminated display-math opener. The token's shape comes from the
      // lexer's `matchLineBreakAt`, beside the boundary predicate whose
      // disagreement with it was the defect.
      //
      // The trailing newline is deliberately NOT consumed on the carrier path
      // (unlike the bare-break path, which re-emits its own): a newline left in
      // the following prose buffer round-trips verbatim, which is what makes the
      // bytes identical — a paragraph's interior newlines are already carried
      // that way.
      const lineBreak = matchLineBreakAt(text, i);
      if (lineBreak) {
        flush();
        if (lineBreak.plain) {
          nodes.push({ type: "hardBreak" });
          i = lineBreak.end;
          // skip optional newline
          if (i < text.length && text[i] === "\n") i++;
        } else {
          nodes.push({
            type: "text",
            text: lineBreak.raw,
            marks: [{ type: "latexCommand" }],
          });
          i = lineBreak.end;
        }
        continue;
      }

      // Typographic accents (\'e \v{s} \c{c} …) and special letters
      // (\ss \o \ae …) → composed Unicode glyph. Matched HERE, before the
      // unknown-`\command` grey-monospace fallback below, so accents render
      // as real glyphs instead of falling through to `latexCommand`.
      // Suppressed inside code spans (memo §A exclusion). The glyph goes
      // into `buffer` so adjacent letters stay one text node.
      if (!inCode) {
        const accent = matchAccent(text, i);
        if (accent) {
          buffer += accent.glyph;
          i = accent.end;
          continue;
        }
        const special = matchSpecialLetter(text, i);
        if (special) {
          buffer += special.glyph;
          i = special.end;
          continue;
        }
      }

      // Unknown \command{...} or \command[...]{...} — render as grey monospace.
      // The control-WORD read is the lexer's (`matchCommandToken`), not a
      // local `[a-zA-Z@]+` copy: `footnote-content.ts` is a second inline
      // parser that had hand-rolled the identical regex, and the two must
      // agree on what a command name IS (task 338 / the vocabulary rule).
      const unknownCmd = matchCommandToken(text, i);
      if (unknownCmd) {
        flush();
        // A command atom carries ALL of its arguments — the `*`, and every
        // abutting `{…}` / `[…]` group in whatever order, from the lexer's
        // `matchCommandArgumentRun`. Until task 349 this was a bracket loop
        // followed by a brace loop capped at TWO, so a third argument fell into
        // the prose buffer and its braces were escaped as literals:
        // `\definecolor{myblue}{rgb}{0.2,0.4,0.8}` reached disk with two
        // arguments and the paper stopped compiling. The bounds, the fail-closed
        // scanners and the `{[}`-protection rule all live at that door, which
        // the card/footnote fork reads too (task 341's twin rule).
        const args = matchCommandArgumentRun(text, unknownCmd.end);
        nodes.push({
          type: "text",
          text: "\\" + unknownCmd.name + args.raw,
          marks: [{ type: "latexCommand" }],
        });
        i = args.end;
        continue;
      }

      // A CONTROL SYMBOL — `\` plus one non-letter — on the raw-LaTeX
      // carrier (task 360). Everything above has declined, so what is left
      // here is `\,` `\;` `\!` `\:` `\ ` `\-` `\/` and their kin: real
      // LaTeX that Virgil does not model. Until this door existed they fell
      // into the prose buffer as a literal backslash plus a literal
      // punctuation mark, and survived only because the escape rung refused to
      // touch a backslash in a run that held one. With bare text now prose BY
      // CONSTRUCTION and `\` escaped unconditionally, that accident is gone:
      // an un-carried `U.S.\ Route` would reach the `.tex` as
      // `U.S.\textbackslash{} Route` — a printed backslash. The vocabulary at
      // a backslash has to be TOTAL, and this is the member that closes it.
      const controlSymbol = matchControlSymbolAt(text, i);
      if (controlSymbol) {
        flush();
        nodes.push({
          type: "text",
          text: controlSymbol.raw,
          marks: [{ type: "latexCommand" }],
        });
        i = controlSymbol.end;
        continue;
      }

      // A trailing `\` with nothing after it — genuinely literal, and now
      // re-emitted as `\textbackslash{}` rather than as a dangling backslash
      // the compiler chokes on.
      buffer += "\\";
      i++;
      continue;
    }

    buffer += text[i];
    i++;
  }

  flush();
  return nodes;
}

export function parseLatex(latex: string, sidecar?: VirgilSidecar): JSONContent {
  seenTitleFields.clear();
  // Which example dialect may be MODELLED here (task 355). Asked ONCE, of the
  // LIVE preamble (`preambleLoadsPackage` projects comments and verbatim away
  // first — the detector law tasks 344/345 earned, so a commented-out
  // `% \usepackage{linguex}` enables nothing).
  linguexModelled = preambleLoadsPackage(latex, "linguex");
  const body = stripPreamble(latex);
  const doc: JSONContent = { type: "doc", content: [] };

  // Hoist \title/\author/\date from the preamble into the doc tree so
  // they're visible and editable in the editor. Mark seen fields so the
  // body parser doesn't emit duplicates if the same command appears
  // again below \begin{document}.
  const { beginDoc } = findDocumentBoundary(latex);
  const preambleText = beginDoc !== -1 ? latex.slice(0, beginDoc) : "";
  const preambleTitleNodes = parsePreambleTitleFields(preambleText);
  for (const n of preambleTitleNodes) {
    const field = n.attrs?.field as string;
    if (field) seenTitleFields.add(field);
    doc.content!.push(n);
  }

  if (!body) {
    if (doc.content!.length === 0) doc.content = [{ type: "paragraph" }];
    return doc;
  }

  const ctx: ParseContext = { pos: 0, src: body };
  parseBody(ctx, doc);

  if (!doc.content || doc.content.length === 0) {
    doc.content = [{ type: "paragraph" }];
  }

  // Stamp `linkedAnchor` marks on text nodes between `\vlid` / `\vlidend`
  // boundaries (which the inline parser emitted as transient sentinel
  // nodes). Runs before any other post-pass so the rest of the pipeline
  // sees a doc with the boundary sentinels removed.
  applyLinkedAnchorBoundaries(doc);

  // Canonicalize titleField position: any \title / \author / \date that
  // ended up below other content (e.g. parsed from the body, where the
  // serializer never puts them but a user might) is hoisted to the top
  // of the doc tree in title → author → date order. After this pass,
  // any save will emit them to the preamble (by serializer convention),
  // so the doc tree shape stays consistent with where the data lives
  // in the LaTeX source.
  hoistTitleFieldsToTop(doc);

  // Number footnotes sequentially
  numberFootnotes(doc);

  // Assign hierarchical section numbers
  numberHeadings(doc);

  // Number expex examples (and assign sub-labels to items) so that
  // `resolveRefs` can look up their numbers.
  numberExamples(doc);

  // Number figureBlocks in document order so the `Figure N:` prefix is
  // ready on first paint. The live `sectionNumbers` plugin in Editor.tsx
  // keeps this attr in sync after edits.
  numberFigures(doc);

  // Resolve \ref / \getref / \getfullref display text
  resolveRefs(doc);

  // Merge sidecar titles into paragraph nodes by UUID
  if (sidecar) {
    mergeSidecarTitles(doc, sidecar);
  }

  return doc;
}

/**
 * Lift any titleField nodes out of their current positions and re-insert
 * them at the top of the doc, in canonical title → author → date order.
 * Idempotent. Safe when zero, one, or several titleFields are present.
 * Dedups by `field`: the first occurrence wins, later duplicates drop.
 *
 * Runs once after `parseBody` so any body-position `\title{}` (which the
 * body parser does pick up, see the titleField branch around line 1150)
 * ends up where the serializer expects it. Without this hoist, the
 * serializer would still emit them to preamble (collector walks the
 * whole tree), but the editor would show them in the wrong spot.
 */
function hoistTitleFieldsToTop(doc: JSONContent): void {
  if (!doc.content) return;
  const order: Record<string, number> = { title: 0, author: 1, date: 2 };
  const titles: JSONContent[] = [];
  const rest: JSONContent[] = [];
  const seen = new Set<string>();
  for (const child of doc.content) {
    if (child.type === "titleField") {
      const field = child.attrs?.field as string | undefined;
      if (field && !seen.has(field)) {
        seen.add(field);
        titles.push(child);
      }
      // Duplicates and field-less nodes are dropped silently.
      continue;
    }
    rest.push(child);
  }
  if (titles.length === 0) return; // No-op when no titleFields present.
  titles.sort(
    (a, b) =>
      (order[a.attrs?.field as string] ?? 99) -
      (order[b.attrs?.field as string] ?? 99),
  );
  doc.content = [...titles, ...rest];
}

/**
 * Restore the sidecar-only attrs (`parTitle`, `collapsed`) onto the parsed doc.
 *
 * This is the ONLY consumer of `sidecar.paragraphs[…].title` in the app, and
 * the sidecar is the sole carrier for both fields — nothing downstream heals a
 * value this walk declines to restore, and the next save serializes the doc as
 * it now stands back over the sidecar entry. So a type this misses does not
 * merely fail to render its title: it DESTROYS it. Both sets therefore come
 * from the one declaration `extractSidecarData` writes by (task 343, where a
 * hand list of four silently ate every exampleBlock title).
 */
function mergeSidecarTitles(node: JSONContent, sidecar: VirgilSidecar): void {
  if (UUID_BEARING_NODE_TYPES.has(node.type!) && node.attrs?.uuid) {
    const meta = sidecar.paragraphs[node.attrs.uuid as string];
    if (meta?.title && TITLED_NODE_TYPES.has(node.type!)) {
      node.attrs.parTitle = meta.title;
    }
    if (meta?.collapsed && COLLAPSIBLE_NODE_TYPES.has(node.type!)) {
      node.attrs.collapsed = true;
    }
  }
  node.content?.forEach((child) => mergeSidecarTitles(child, sidecar));
}

function numberFootnotes(node: JSONContent): void {
  let counter = 1;
  function walk(n: JSONContent) {
    if (n.type === "footnote") {
      n.attrs = { ...n.attrs, number: counter++ };
    }
    if (n.content) {
      for (const child of n.content) {
        walk(child);
      }
    }
  }
  walk(node);
}

/**
 * Walk the doc in order. Maintain a stack of open `linkedAnchor`
 * anchorIds. For each `_linkedAnchorBoundary` sentinel inserted by
 * `parseInlineContent` for a `\vlid{}` / `\vlidend{}` marker, push or
 * pop the stack and remove the sentinel. For each text node between an
 * open and close, stamp a `linkedAnchor` mark with the topmost anchorId.
 *
 * Cross-paragraph spans are natural: state survives across container
 * boundaries. Nested anchors with different ids are tolerated — only
 * the topmost is visible on text (ProseMirror's same-name mark
 * exclusivity), but the outer's range is preserved on text before and
 * after the inner.
 *
 * Defensive recovery:
 *  - Unmatched `\vlidend{x}` (no matching opener) — drop silently.
 *  - Unmatched `\vlid{x}` at EOF — `console.warn`; the sidecar's
 *    `textSnapshot` re-anchoring (`reanchorByText`) is the recovery
 *    path for any cards still pointing at the orphan.
 *
 * Fragment-safe: the matching is position-LOCAL (an open/close pair both
 * inside one block's inline-content array is resolved within that array),
 * so this also runs on a SINGLE synthetic block wrapping one paragraph's
 * inline JSON — the reuse path the headless apply-suggestion applicator
 * takes to keep pre-existing in-paragraph anchors alive across its
 * serialize → splice → reparse round-trip. Exported for that reuse; the
 * stamped mark carries only the anchorId+range (the `\vlid{}` marker holds
 * nothing else), so a caller wanting the original `kind`/`tintColor`/
 * `linkCard` must re-apply them from its own live source afterwards.
 */
export function applyLinkedAnchorBoundaries(doc: JSONContent): void {
  const open: string[] = [];

  function walk(n: JSONContent): void {
    if (!n.content || n.content.length === 0) return;
    const next: JSONContent[] = [];
    for (const child of n.content) {
      if (child.type === "_linkedAnchorBoundary") {
        const kind = child.attrs?.kind as "open" | "close" | undefined;
        const id = child.attrs?.anchorId as string | undefined;
        if (!id) continue;
        if (kind === "open") {
          open.push(id);
        } else if (kind === "close") {
          // Pop the matching id (innermost match wins).
          for (let j = open.length - 1; j >= 0; j--) {
            if (open[j] === id) {
              open.splice(j, 1);
              break;
            }
          }
        }
        // Sentinel removed from output.
        continue;
      }
      if (child.type === "text" && open.length > 0) {
        const topId = open[open.length - 1];
        const existingMarks = child.marks || [];
        const hasLinkedAnchor = existingMarks.some(
          (m) => m.type === "linkedAnchor",
        );
        if (!hasLinkedAnchor) {
          next.push({
            ...child,
            marks: [
              ...existingMarks,
              {
                type: "linkedAnchor",
                attrs: { anchorId: topId, kind: "note", linkId: topId },
              },
            ],
          });
          continue;
        }
      }
      // Recurse into block children to pick up their inline content.
      walk(child);
      next.push(child);
    }
    n.content = next;
  }

  walk(doc);

  if (open.length > 0) {
    console.warn(
      `applyLinkedAnchorBoundaries: unmatched ${VIRGIL_MARKERS.linkedRangeOpen.macro} opener(s) at EOF; recovery via sidecar reanchoring:`,
      open,
    );
  }
}

/** Assign hierarchical section numbers (e.g. "1", "2.3", "2.3.1") to heading nodes. */
function numberHeadings(node: JSONContent): void {
  // First pass: find the highest heading level used.
  // Levels 0..6 (part..subparagraph); 7 is the sentinel "above all".
  let topLevel = 7;
  function findTop(n: JSONContent) {
    if (n.type === "heading" && n.attrs?.numbered !== false) {
      const lvl = (n.attrs?.level as number) ?? 2;
      if (lvl < topLevel) topLevel = lvl;
    }
    n.content?.forEach(findTop);
  }
  findTop(node);
  if (topLevel > 6) return; // no numbered headings

  const counters = [0, 0, 0, 0, 0, 0, 0]; // indices 0..6 → levels 0..6

  function walk(n: JSONContent) {
    if (n.type === "heading") {
      if (n.attrs?.numbered !== false) {
        const rawLvl = (n.attrs?.level as number) ?? 2;
        const idx = Math.max(0, Math.min(rawLvl, 6));
        counters[idx]++;
        for (let i = idx + 1; i < 7; i++) counters[i] = 0;
        const parts: number[] = [];
        for (let i = topLevel; i <= idx; i++) parts.push(counters[i]);
        n.attrs = { ...n.attrs, sectionNumber: parts.join(".") };
      } else {
        n.attrs = { ...n.attrs, sectionNumber: null };
      }
    }
    n.content?.forEach(walk);
  }
  walk(node);
}

/** Assign sequential numbers to exampleBlocks (global) and depth-aware
 *  sub-labels (a/i/A/I, cycling) to exampleItems within each item list.
 *  Also recomputes colCount on every exampleGloss. Mirrors the live
 *  ExpexNumbering ProseMirror plugin for the initial parse pass. */
function numberExamples(node: JSONContent): void {
  function toSubLabel(n: number): string {
    let s = "";
    let i = n;
    while (i > 0) {
      i--;
      s = String.fromCharCode(97 + (i % 26)) + s;
      i = Math.floor(i / 26);
    }
    return s || "a";
  }
  function toAlphaUpper(n: number): string {
    let s = "";
    let i = n;
    while (i > 0) {
      i--;
      s = String.fromCharCode(65 + (i % 26)) + s;
      i = Math.floor(i / 26);
    }
    return s || "A";
  }
  function toRomanLower(n: number): string {
    if (n <= 0) return "i";
    const arabic = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
    const roman = ["m", "cm", "d", "cd", "c", "xc", "l", "xl", "x", "ix", "v", "iv", "i"];
    let out = "";
    let v = n;
    for (let k = 0; k < arabic.length; k++) {
      while (v >= arabic[k]) {
        out += roman[k];
        v -= arabic[k];
      }
    }
    return out || "i";
  }
  function markerForDepth(depth: number, n: number): string {
    const tier = ((depth % 4) + 4) % 4;
    if (tier === 0) return toSubLabel(n);
    if (tier === 1) return toRomanLower(n);
    if (tier === 2) return toAlphaUpper(n);
    return toRomanLower(n).toUpperCase();
  }

  function walkItemList(
    list: JSONContent,
    depth: number,
    counter: { n: number },
  ) {
    if (list.type !== "exampleItemList") return;
    for (const item of list.content || []) {
      if (item.type !== "exampleItem") continue;
      counter.n++;
      item.attrs = {
        ...(item.attrs || {}),
        subLabel: markerForDepth(depth, counter.n),
      };
      // Nested xlist tiers start a fresh counter.
      for (const child of item.content || []) {
        if (child.type === "exampleItemList") {
          walkItemList(child, depth + 1, { n: 0 });
        }
      }
    }
  }

  let exampleCounter = 0;
  function walk(n: JSONContent) {
    if (n.type === "exampleBlock") {
      exampleCounter++;
      const override = n.attrs?.exnoOverride;
      const num = override ? override : exampleCounter;
      n.attrs = { ...(n.attrs || {}), number: num };
      // Top-level items number consecutively across multiple lists.
      const topCounter = { n: 0 };
      for (const child of n.content || []) {
        if (child.type === "exampleItemList") {
          walkItemList(child, 0, topCounter);
        }
      }
    }
    if (n.type === "exampleGloss") {
      let max = 1;
      for (const row of n.content || []) {
        if (row.type === "alignedGlossRow") {
          const cells = row.content?.length || 0;
          if (cells > max) max = cells;
        }
      }
      n.attrs = { ...(n.attrs || {}), colCount: max };
    }
    n.content?.forEach(walk);
  }
  walk(node);
}

/** Resolve `\ref` / `\getref` / `\getfullref` display text.
 *
 *  Builds a unified map from labels to display strings:
 *  - Heading labels → bare section number (e.g. `"2.1"`).
 *  - Example tag OR inner `\label{…}` → example number (e.g. `"3"`).
 *  - Dotted `"parent.sub"` → `"3b"` using the sub-item's computed label.
 *
 *  The `refCommand` attr selects the template:
 *  - `ref` → bare text (`"3"`).
 *  - `getref` / `getfullref` → parenthesized (`"(3)"`, `"(3b)"`).
 */
/** Assign sequential 1-based numbers to numbered figureBlocks in document
 *  order. Mirrors the live `sectionNumbers` plugin in `Editor.tsx` so the
 *  prefix is ready on first paint without waiting for a no-op edit.
 *
 *  A figure only takes a number if it will carry a `\caption` — that is LaTeX's
 *  own rule, and since task 319 stopped inventing an empty caption for a
 *  caption-less env, honouring it here is what keeps the on-screen `Figure N:`
 *  (and the `\ref` display text resolved from it, just below) equal to the
 *  number the compiled PDF will print. Counting a figure LaTeX skips would put
 *  every LATER figure's number — and every `\ref` to it — off by one.
 *
 *  `hasCaption` alone is the whole test HERE, unlike the live twin, which also
 *  asks whether the caption node has content. This runs only over freshly
 *  parsed JSON, where the caption child is built from `figAttrs.caption` and
 *  both come from ONE scan — so `hasCaption === false` implies an empty caption
 *  child, and the content arm could never change the answer. Writing it anyway
 *  would be a branch no input can reach, which reads as agreement between the
 *  two sites while proving nothing. */
function numberFigures(node: JSONContent): void {
  let counter = 0;
  function walk(n: JSONContent) {
    if (n.type === "figureBlock") {
      if (n.attrs?.numbered !== false && n.attrs?.hasCaption !== false) {
        counter++;
        n.attrs = { ...(n.attrs || {}), figureNumber: counter };
      } else {
        n.attrs = { ...(n.attrs || {}), figureNumber: null };
      }
      // figureBlock's only child is a figureCaption — no nested figures.
      return;
    }
    n.content?.forEach(walk);
  }
  walk(node);
}

function resolveRefs(node: JSONContent): void {
  const headingMap = new Map<string, string>();
  const exampleMap = new Map<
    string,
    { number: string; items: Map<string, string> }
  >();
  const figureMap = new Map<string, string>();

  function collect(n: JSONContent) {
    if (n.type === "heading" && n.attrs?.label && n.attrs?.sectionNumber) {
      headingMap.set(n.attrs.label as string, n.attrs.sectionNumber as string);
    }
    if (
      n.type === "figureBlock" &&
      n.attrs?.label &&
      n.attrs?.figureNumber != null
    ) {
      figureMap.set(n.attrs.label as string, String(n.attrs.figureNumber));
    }
    if (n.type === "exampleBlock" && n.attrs?.number) {
      const num = String(n.attrs.number);
      const entry = { number: num, items: new Map<string, string>() };
      if (n.attrs.tag) exampleMap.set(n.attrs.tag as string, entry);
      if (n.attrs.label) exampleMap.set(n.attrs.label as string, entry);
      function walkItems(m: JSONContent) {
        if (m.type === "exampleItem") {
          const sub = (m.attrs?.subLabel as string) || "";
          if (sub) {
            if (m.attrs?.tag) entry.items.set(m.attrs.tag as string, sub);
            if (m.attrs?.label) entry.items.set(m.attrs.label as string, sub);
            // Flat sub-item resolution: `\ref{foo}` where foo is a
            // sub-item label resolves to e.g. "3a" (matching expex).
            const fullSub = `${num}${sub}`;
            const subItemEntry = { number: fullSub, items: new Map<string, string>() };
            if (m.attrs?.tag) {
              const k = m.attrs.tag as string;
              if (!exampleMap.has(k)) exampleMap.set(k, subItemEntry);
            }
            if (m.attrs?.label) {
              const k = m.attrs.label as string;
              if (!exampleMap.has(k)) exampleMap.set(k, subItemEntry);
            }
          }
        }
        // Continue recursing — items can contain nested exampleItemLists
        // whose items also need to participate in dotted refs.
        m.content?.forEach(walkItems);
      }
      n.content?.forEach(walkItems);
      // Body-line `\label{…}` (anywhere in the `\ex`/`\pex` body, not just
      // header-adjacent) is captured via the shared SSOT and bound to the
      // parent (→ N) or the enclosing item (→ N+sub). Explicit tag/label/
      // sub-item attr keys already set above win (`!has` guards).
      for (const bl of collectExampleBodyLabelsJSON(n)) {
        if (bl.subLabel == null) {
          if (!exampleMap.has(bl.key)) exampleMap.set(bl.key, entry);
        } else {
          if (!exampleMap.has(bl.key)) {
            exampleMap.set(bl.key, {
              number: `${num}${bl.subLabel}`,
              items: new Map<string, string>(),
            });
          }
          if (!entry.items.has(bl.key)) entry.items.set(bl.key, bl.subLabel);
        }
      }
    }
    n.content?.forEach(collect);
  }
  collect(node);

  function resolve(label: string, refCommand: string): string {
    if (!label) return "??";
    const heading = headingMap.get(label);
    if (heading) return refCommand === "ref" ? heading : `(${heading})`;
    const ex = exampleMap.get(label);
    if (ex) return refCommand === "ref" ? ex.number : `(${ex.number})`;
    const fig = figureMap.get(label);
    if (fig) return refCommand === "ref" ? fig : `(${fig})`;
    const dot = label.lastIndexOf(".");
    if (dot > 0) {
      const parent = exampleMap.get(label.slice(0, dot));
      if (parent) {
        const subKey = label.slice(dot + 1);
        const sub = parent.items.get(subKey) || subKey;
        const full = `${parent.number}${sub}`;
        return refCommand === "ref" ? full : `(${full})`;
      }
    }
    return "??";
  }

  function fill(n: JSONContent) {
    if (n.type === "labelRef" && n.attrs?.label) {
      const refCommand = (n.attrs.refCommand as string) || "ref";
      const display = resolve(n.attrs.label as string, refCommand);
      // Set targetKind as advisory for the popover.
      const targetKind = headingMap.has(n.attrs.label as string)
        ? "heading"
        : figureMap.has(n.attrs.label as string)
          ? "figure"
          : exampleMap.has(n.attrs.label as string)
            ? "example"
            : n.attrs.label && (n.attrs.label as string).includes(".")
              ? "example"
              : null;
      n.attrs = { ...n.attrs, displayText: display, targetKind };
    }
    n.content?.forEach(fill);
  }
  fill(node);
}

const seenTitleFields = new Set<string>();

/** The half-open byte range of `ctx.src` a top-level child of `parseBody` was
 *  parsed from. Recorded ONLY when a caller asks for it (task 350 C): a
 *  consumer whose target schema cannot hold the node the parser produced needs
 *  the ORIGINAL BYTES so it can CARRY the construct instead of dropping it —
 *  byte-exact by construction rather than by re-serialization luck, and
 *  reachable from this leaf, which cannot import the serializer. */
interface SourceSpan {
  start: number;
  end: number;
}

/** Per-child spans, keyed by the produced node object (unique per parse). */
type SourceSpanMap = Map<JSONContent, SourceSpan>;

function parseBody(
  ctx: ParseContext,
  parent: JSONContent,
  spans?: SourceSpanMap,
): void {
  if (!parent.content) parent.content = [];

  // Span recording is closed LAZILY — at the top of the NEXT iteration, and
  // once after the loop. The alternative (closing at the end of each
  // iteration) is unreachable without extracting the loop body: the ~20 arms
  // below all exit by `continue`, and one exits by `break`. Closing before
  // `skipWhitespace` also keeps a construct's span free of the whitespace that
  // follows it, which the opening `skipWhitespace` already excluded at the
  // other end.
  let pendingStart = -1;
  let pendingFrom = 0;
  const closePendingSpan = (): void => {
    if (!spans || pendingStart < 0) return;
    const kids = parent.content!;
    for (let i = pendingFrom; i < kids.length; i++) {
      spans.set(kids[i], { start: pendingStart, end: ctx.pos });
    }
    pendingStart = -1;
  };

  while (ctx.pos < ctx.src.length) {
    closePendingSpan();
    skipWhitespace(ctx);
    if (ctx.pos >= ctx.src.length) break;
    if (spans) {
      pendingStart = ctx.pos;
      pendingFrom = parent.content.length;
    }

    const rest = ctx.src.slice(ctx.pos);

    // \part{...}, \chapter{...}, \section{...}, \subsection{...}, \subsubsection{...},
    // \paragraph{...}, \subparagraph{...} — starred variants, an optional
    // `[short]` running-head title, and the whitespace-separated spelling.
    //
    // The vocabulary AND the argument grammar come from the lexer's sectioning
    // door (task 376). The regex this replaces required the brace to ABUT the
    // name, so `\section[Intro]{Introduction}` — legal in every class — was not
    // a heading at all: it fell through to the raw carrier, where the bytes
    // survived and the entire heading apparatus (Outline, folding, numbering,
    // `\label`/`\ref`, `\partitle`, focus band, word counts) was silently dead.
    {
      const sec = matchSectioningCommandAt(ctx.src, ctx.pos);
      if (sec) {
        const level = sec.level;
        const numbered = !sec.starred;
        const inner = { content: sec.title, end: sec.end };
        ctx.pos = inner.end;
        // Check for optional \label{...} immediately after (whitespace allowed)
        const afterHeading = ctx.src.slice(ctx.pos);
        const labelMatch = afterHeading.match(/^[ \t]*\n?[ \t]*\\label\{([^}]*)\}/);
        let label: string | null = null;
        if (labelMatch) {
          label = labelMatch[1];
          ctx.pos += labelMatch[0].length;
        }
        // Check for optional %!v:xxxx UUID anchor after heading/label
        const afterLabel = ctx.src.slice(ctx.pos);
        const uuidMatch = afterLabel.match(NODE_UUID_ANCHOR);
        let uuid: string | null = null;
        if (uuidMatch) {
          uuid = uuidMatch[1];
          ctx.pos += uuidMatch[0].length;
        }
        const attrs: Record<string, unknown> = { level, label, numbered };
        // The `[short]` running-head / ToC title rides OPAQUELY, the same shape
        // `figureBlock.shortCaption` has (task 263): Virgil has no editor
        // surface for it, and a fact with no surface is still the user's bytes.
        if (sec.shortTitle !== null) attrs.shortTitle = sec.shortTitle;
        if (uuid) attrs.uuid = uuid;
        parent.content.push({
          type: "heading",
          attrs,
          content: parseInlineContent(inner.content),
        });
        continue;
      }
    }

    // \title[Short]{...}, \author{...}, \date{...} — only first occurrence of
    // each. Same door as the preamble scan (task 376 M6), so a body-position
    // title cannot be read by a different grammar from a preamble one.
    {
      const titleWord = matchCommandToken(ctx.src, ctx.pos);
      const titleArgs =
        titleWord && TITLE_FIELD_NAMES.has(titleWord.name)
          ? matchStarOptBraceAt(ctx.src, titleWord.end)
          : null;
      if (
        titleWord &&
        titleArgs &&
        !titleArgs.starred &&
        !seenTitleFields.has(titleWord.name)
      ) {
      const field = titleWord.name;
      seenTitleFields.add(field);
      const inner = { content: titleArgs.required, end: titleArgs.end };
      {
        ctx.pos = inner.end;
        // Check for trailing %!v:xxxx UUID anchor
        const afterTitle = ctx.src.slice(ctx.pos);
        const titleUuidMatch = afterTitle.match(NODE_UUID_ANCHOR);
        let titleUuid: string | null = null;
        if (titleUuidMatch) {
          titleUuid = titleUuidMatch[1];
          ctx.pos += titleUuidMatch[0].length;
        }
        // Strip LaTeX formatting commands from content, store as rawPrefix
        let rawContent = inner.content;
        let rawPrefix = "";
        const prefixMatch = rawContent.match(/^((?:\\(?:rmfamily|Large|large|huge|Huge|bfseries|itshape|sffamily|normalsize|small|footnotesize|tiny|textbf|textit|textsf)\s*)+)/);
        if (prefixMatch) {
          rawPrefix = prefixMatch[1];
          rawContent = rawContent.slice(rawPrefix.length);
        }
        // Replace \today with actual date for display
        let isToday = false;
        if (rawContent.trim() === "\\today") {
          isToday = true;
          const now = new Date();
          rawContent = now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
        }
        const tfAttrs: Record<string, unknown> = {
          field,
          rawPrefix: rawPrefix || null,
          isToday,
          uuid: titleUuid,
        };
        if (titleArgs.optional !== null) tfAttrs.shortTitle = titleArgs.optional;
        parent.content.push({
          type: "titleField",
          attrs: tfAttrs,
          content: parseInlineContent(rawContent),
        });
        continue;
      }
      }
    }


    // \maketitle — hidden marker that renders as the title block in the output.
    const maketitleMatch = rest.match(/^\\maketitle\b/);
    if (maketitleMatch) {
      ctx.pos += maketitleMatch[0].length;
      let maketitleUuid: string | null = null;
      const afterMaketitle = ctx.src.slice(ctx.pos);
      const uuidMatch = afterMaketitle.match(NODE_UUID_ANCHOR);
      if (uuidMatch) {
        maketitleUuid = uuidMatch[1];
        ctx.pos += uuidMatch[0].length;
      }
      parent.content.push({
        type: "maketitleMarker",
        attrs: maketitleUuid ? { uuid: maketitleUuid } : {},
      });
      continue;
    }

    // Display math \[...\]
    if (rest.startsWith("\\[")) {
      // Escape-aware close search (parity SSOT — see the mid-paragraph twin):
      // a `\\` line break right before a literal `]` (e.g. a matrix row ending
      // `\\` before the environment close) must not close the math early.
      const endMath = findUnescaped(ctx.src, "\\]", ctx.pos + 2);
      if (endMath !== -1) {
        const latex = ctx.src.slice(ctx.pos + 2, endMath).trim();
        ctx.pos = endMath + 2;
        // Check for trailing %!v:xxxx UUID anchor
        let mathUuid: string | null = null;
        const afterMath = ctx.src.slice(ctx.pos);
        const uuidMatch = afterMath.match(NODE_UUID_ANCHOR);
        if (uuidMatch) {
          mathUuid = uuidMatch[1];
          ctx.pos += uuidMatch[0].length;
        }
        parent.content.push({
          type: "displayMath",
          attrs: { latex, ...(mathUuid ? { uuid: mathUuid } : {}) },
        });
        continue;
      }
    }

    // \vexid{uuid} — no-op marker carrying a stable exampleId for the next
    // \ex / \pex we encounter in block context. Emitted by the serializer.
    if (markerOpensAt(ctx.src, ctx.pos, VIRGIL_MARKERS.exampleBlock)) {
      const idArg = extractBraced(
        ctx.src,
        markerArgStart(ctx.pos, VIRGIL_MARKERS.exampleBlock),
      );
      if (idArg !== null) {
        ctx.pendingExampleId = idArg.content || null;
        ctx.pos = idArg.end;
        continue;
      }
    }

    // \vxid{uuid} — id marker for the next \a item inside an expex
    // exampleItemList. Its legit consumer is splitPexBody (which stashes
    // the uuid for the next \a); a `\vxid` reaching parseBody means it's
    // either (a) at the top of a preamble/item-body slice that
    // splitPexBody has already drained, or (b) a stray from a previous
    // round-trip. Discard so it doesn't fall through to readParagraph and
    // get absorbed as paragraph text — which would re-serialize on next
    // save and accumulate +1 per cycle.
    if (markerOpensAt(ctx.src, ctx.pos, VIRGIL_MARKERS.exampleItem)) {
      const idArg = extractBraced(
        ctx.src,
        markerArgStart(ctx.pos, VIRGIL_MARKERS.exampleItem),
      );
      if (idArg !== null) {
        ctx.pos = idArg.end;
        continue;
      }
    }

    // \ex. … <blank line> — a LINGUEX example (task 355).
    //
    // Recognition is the LEXER's, exactly as the expex twin below: the PERIOD
    // is the per-site discriminator between the two dialects, so a mixed
    // document (Gabriel's own paper loads both packages) is read correctly
    // example by example. What the PREAMBLE decides is different and is asked
    // once, in `parseLatex`: whether Virgil may MODEL a linguex site at all.
    // With the package absent, `linguexModelled` is false, nothing here fires,
    // and task 350's carry-raw behaviour stands byte-for-byte.
    //
    // A refusal (`readLinguexExample` → null, for a construct this v1 does not
    // model) leaves `ctx.pos` untouched and falls through to `readParagraph`,
    // which carries the bytes — the same shape as the fail-closed expex arm
    // below, and the reason the modelled subset can be small without any of it
    // costing the user a byte.
    if (linguexModelled) {
      const linguexOpen = matchLinguexOpenerAt(ctx.src, ctx.pos);
      if (linguexOpen) {
        const linguexNode = readLinguexExample(ctx, linguexOpen.end);
        if (linguexNode) {
          parent.content.push(linguexNode);
          continue;
        }
      }
    }

    // \ex / \pex … \xe  — expex single or multi-part example block.
    //
    // Recognition is the LEXER's (task 350 defect A). The pre-350 test here was
    // `rest.match(/^\\(ex|pex)(~?)/)`, which never looked at what followed — so
    // `\example` / `\exercise` / `\expandafter` were each claimed as openers,
    // and so was linguex's `\ex.`, whose stranded period is the fingerprint the
    // reproducing document left behind (`.\label{s1-disjoint}\a. …`). The scan
    // that PAIRS the body (`findMatchingXe` → `skipOpaqueConstructAt`) already
    // asked the strict question; only this dispatcher did not, so the two layers
    // disagreed about the very set of openers the pairing is computed over.
    const exStartMatch = matchExpexOpenerAt(ctx.src, ctx.pos);
    if (exStartMatch) {
      const { kind, suppressSpace } = exStartMatch;
      // Where the opener BEGINS, so an unterminated example can put it back —
      // see the fail-closed branch below.
      const exOpenStart = ctx.pos;
      ctx.pos = exStartMatch.end;

      // Optional [opts]. `exno=` is INTERPRETED (the renumberer reads it); every
      // other key is CARRIED raw — see `rawOptions` (task 356 site 4).
      let exnoOverride: string | null = null;
      let rawOptions = "";
      while (ctx.pos < ctx.src.length && ctx.src[ctx.pos] === "[") {
        const close = ctx.src.indexOf("]", ctx.pos);
        if (close === -1) break;
        const optStr = ctx.src.slice(ctx.pos + 1, close);
        const exnoMatch = optStr.match(/exno\s*=\s*([^,\s]+)/);
        if (exnoMatch) exnoOverride = exnoMatch[1];
        rawOptions += ctx.src.slice(ctx.pos, close + 1);
        ctx.pos = close + 1;
      }
      // Optional <tag>  (angle-bracket tag)
      let tag = "";
      if (ctx.src[ctx.pos] === "<") {
        const close = ctx.src.indexOf(">", ctx.pos);
        if (close !== -1) {
          tag = ctx.src.slice(ctx.pos + 1, close);
          ctx.pos = close + 1;
        }
      }
      // Optional \label{…} immediately after (no body parsing yet)
      let label = "";
      while (true) {
        const afterHeader = ctx.src.slice(ctx.pos);
        const labelMatch = afterHeader.match(/^[ \t]*\n?[ \t]*\\label\{([^}]*)\}/);
        if (labelMatch) {
          label = labelMatch[1];
          ctx.pos += labelMatch[0].length;
          continue;
        }
        // Optional [opts] again (expex tolerates them either side of the tag)
        const optsMatch = afterHeader.match(/^[ \t]*\[([^\]]*)\]/);
        if (optsMatch) {
          const exnoMatch = optsMatch[1].match(/exno\s*=\s*([^,\s]+)/);
          if (exnoMatch && !exnoOverride) exnoOverride = exnoMatch[1];
          rawOptions += `[${optsMatch[1]}]`;
          ctx.pos += optsMatch[0].length;
          continue;
        }
        break;
      }

      // Consume the body up to the matching \xe (handling nested \ex/\pex).
      const bodyStart = ctx.pos;
      const bodyEnd = findMatchingXe(ctx.src, bodyStart);
      if (bodyEnd === -1) {
        // FAIL CLOSED (task 350 defect B). An `\ex` with no `\xe` is not an
        // example: put the cursor back on the opener and let it be carried as
        // ordinary raw content, exactly as any other unmodelled command is.
        //
        // The pre-350 arm took `ctx.src.slice(bodyStart)` and set
        // `ctx.pos = ctx.src.length` — the REST OF THE DOCUMENT became one
        // example body, and `buildExampleBlockFromBody`'s whitelist then kept
        // the paragraphs and silently discarded every heading, figure,
        // blockquote, nested example and texBlock in the tail. Measured on the
        // reproducing document: ~350 of 394 lines destroyed, on OPEN, with no
        // edit by the user, because `readDocBundle` fires the load-writeback
        // unconditionally. The serializer then wrote a `\xe` the user never
        // typed, so the damage was a FIXED POINT — no later save healed it.
        //
        // Damage from malformed input must be LOCAL: the same rule task 347
        // drew for an unbalanced `{` (bounded to its own paragraph) and task
        // 338 for a construct whose end nobody can find. Note this is the
        // policy `skipOpaqueConstructAt` ALREADY states for the identical
        // question one layer down ("Unterminated ⇒ TRANSPARENT") — the two
        // layers disagreed, and this is the layer that was wrong.
        ctx.pos = exOpenStart;
        // Deliberately NOT `continue` — fall through to the remaining block
        // dispatchers and ultimately `readParagraph`, which is what carries the
        // bytes. `rest` was sliced at `exOpenStart`, so restoring the cursor
        // leaves it accurate for those tests. Progress is guaranteed:
        // `readParagraph`'s block-boundary test requires a non-empty accumulated
        // `result`, so the opener that begins the paragraph can never terminate
        // it, and the cursor always advances past at least `\ex`.
      } else {
      const bodyText = ctx.src.slice(bodyStart, bodyEnd);
      ctx.pos = bodyEnd + "\\xe".length;

      const uuid = ctx.pendingExampleId || null;
      ctx.pendingExampleId = null;

      const exampleNode = buildExampleBlockFromBody(bodyText, {
        kind,
        tag,
        label,
        uuid,
        exnoOverride,
        rawOptions: rawOptions || null,
        suppressSpace,
      });
      parent.content.push(exampleNode);
      continue;
      }
    }

    // \begingl … \endgl — expex interlinear gloss block (top-level or
    // nested inside an ex/pex body).
    const beginGlMatch = rest.match(/^\\begingl\b/);
    if (beginGlMatch) {
      // Where the opener BEGINS — see the fail-closed branch below.
      const glOpenStart = ctx.pos;
      ctx.pos += beginGlMatch[0].length;
      // Optional `[opts]` — expex's documented gloss-option bracket
      // (`glhangstyle`, `aboveglftskip`, `glstyle`, `everygla`, `textoffset`,
      // …). Captured as an opaque raw string (Virgil need not interpret the
      // keys) and threaded onto the node so `serializeExampleGloss` can
      // re-emit it byte-for-byte — the same parse↔serialize symmetry the
      // item-level `\a[exno=N]` override keeps (task 244).
      let glossOptions: string | null = null;
      if (ctx.src[ctx.pos] === "[") {
        const close = ctx.src.indexOf("]", ctx.pos);
        if (close !== -1) {
          glossOptions = ctx.src.slice(ctx.pos + 1, close);
          ctx.pos = close + 1;
        }
      }
      const bodyStart = ctx.pos;
      // Boundary/comment-aware, depth-counted terminator (a bare indexOf
      // would stop at a commented or nested `\endgl`, or at `\endglpreamble`).
      const endIdx = findMatchingGloss(ctx.src, bodyStart);
      if (endIdx === -1) {
        // FAIL CLOSED — the `\ex` twin, and worse in its own way (task 350
        // defect B). The pre-350 arm swallowed the rest of the document as
        // gloss body, and `buildGlossFromBody` keeps only `\gla`/`\glb`/`\glc`/
        // `\glft`/`\glpreamble` segments, so everything before the first tier
        // marker vanished and everything after it was FOLDED INTO a gloss line
        // — measured: `\glb one two// \section{Two} This section must survive.
        // //`, a heading and its prose absorbed into an interlinear tier.
        ctx.pos = glOpenStart;
        // Falls through to `readParagraph`, as above.
      } else {
      const bodyText = ctx.src.slice(bodyStart, endIdx);
      const glossNode = buildGlossFromBody(bodyText, glossOptions);
      if (glossNode === null) {
        // REFUSED — the body is outside what the gloss model can hold (task
        // 378: no tier marker at all, or inert bytes among the tiers). Same
        // answer as an unterminated close one branch up: carry the bytes, never
        // keep the fraction we recognise.
        //
        // A BYTE-LITERAL carrier, not the prose fall-through, and the
        // difference is not cosmetic: `\endgl` is a block boundary, so
        // `readParagraph` ends the paragraph before it and the two are rejoined
        // with a BLANK LINE — a `\par` inside `\begingl … \endgl`, which is
        // exactly the kind of byte a construct we have just declined to model
        // must not acquire. The slice is the whole construct including its
        // `[opts]` bracket, so the next parse meets the identical bytes and
        // refuses identically: a fixed point from cycle 1.
        let glEnd = endIdx + "\\endgl".length;
        // Re-absorb the carrier's OWN trailing `%!v:` anchor, exactly as the
        // `\begin{env}` carrier one branch up does and for the same reason: the
        // serializer appends one to the paragraph this pushes, so leaving it in
        // the stream would re-read it as a standalone empty block — one stray
        // anchor line per save, unbounded. `NODE_UUID_ANCHOR` is start-anchored
        // with `[ \t]*`, so it can match nothing but an anchor on the same line
        // as the `\endgl` just consumed.
        let glUuid: string | null = null;
        {
          const uuidMatch = ctx.src.slice(glEnd).match(NODE_UUID_ANCHOR);
          if (uuidMatch) {
            glUuid = uuidMatch[1];
            glEnd += uuidMatch[0].length;
          }
        }
        parent.content.push({
          type: "paragraph",
          ...(glUuid ? { attrs: { uuid: glUuid } } : {}),
          content: [
            {
              type: "text",
              text: ctx.src.slice(glOpenStart, endIdx + "\\endgl".length),
              marks: [verbatimMark()],
            },
          ],
        });
        ctx.pos = glEnd;
        continue;
      } else {
        ctx.pos = endIdx + "\\endgl".length;
        parent.content.push(glossNode);
        continue;
      }
      }
    }

    // \includegraphics — standalone (block-level) graphics insertion not
    // wrapped in a `figure` env. The render path is identical to a
    // single-image figureBlock, so we emit a dedicated `graphicsBlock`
    // node and let the shared NodeView handle display.
    if (rest.startsWith("\\includegraphics")) {
      const incl = matchIncludegraphics(ctx.src, ctx.pos);
      if (incl) {
        ctx.pos = incl.end;
        const attrs = extractGraphicsAttrs(incl.command);
        if (attrs) {
          // Optional trailing UUID anchor (matches the env path).
          let grUuid: string | null = null;
          const afterCmd = ctx.src.slice(ctx.pos);
          const uuidMatch = afterCmd.match(NODE_UUID_ANCHOR);
          if (uuidMatch) {
            grUuid = uuidMatch[1];
            ctx.pos += uuidMatch[0].length;
          }
          parent.content.push({
            type: "graphicsBlock",
            attrs: {
              command: attrs.command,
              source: attrs.source,
              widthPercent: attrs.widthPercent,
              ...(grUuid ? { uuid: grUuid } : {}),
            },
          });
          continue;
        }
      }
    }

    // \begin{...}[optional]
    // The env-name spelling comes from the lexer (`\w+\*?`, so starred envs
    // like figure*/table* match) — the SAME matcher `skipOpaqueConstructAt`
    // uses, so the dispatcher and the body splitters can never disagree about
    // where a construct begins or what it is called (task 338).
    const beginAt = matchBeginEnvAt(ctx.src, ctx.pos);
    if (beginAt) {
      const env = beginAt.name;
      // Where the opener BEGINS — see the fail-closed branch below.
      const envOpenStart = ctx.pos;
      // The `[options]` an environment carries. Read through the lexer's
      // bracket scanner rather than a `[^\]]*` regex (task 376 M3): that
      // regex stops at the first `]` whatever encloses it, so a shipped
      // enumitem idiom like `[label={\roman*)}]` was truncated mid-option —
      // survivable while a list's options were being DELETED anyway, and not
      // once the bytes are carried and re-emitted.
      const optBracket = extractBracketed(ctx.src, beginAt.end);
      const optArg = optBracket
        ? ctx.src.slice(beginAt.end, optBracket.end)
        : "";
      ctx.pos = beginAt.end + optArg.length;
      // Find the matching \end{env} through the lexer SSOT. It owns the
      // `verbatim` FAMILY fork the parser used to hand-write here: those envs
      // are non-nestable and their body is LITERAL, so the correct terminator
      // is the FIRST `\end{env}` — depth-counting is actively wrong there,
      // since a literal `\begin{env}` in the body would bump the counter and
      // swallow the real close (and, when the counter never rebalances,
      // swallow the rest of the document into one block). Membership reads the
      // vocab SSOT (`isVerbatimFamilyEnv`), so every family member —
      // `verbatim*`/`lstlisting`/`minted`/fancyvrb's `Verbatim`/`comment`, not
      // just bare `verbatim` — gets first-close-wins handling (task 243). The
      // serializer escapes any body `\end{verbatim}` (→
      // `\end{verbatim%!v-esc}`), so the first literal `\end{env}` we find is
      // the block's true end.
      const envEnd = findMatchingEnv(ctx.src, ctx.pos, env);
      if (envEnd === -1) {
        // FAIL CLOSED — the `\ex` / `\begingl` twin, and the member of the
        // family that fires most often (task 356 site 1; task 350 defect B is
        // the same disease one branch over).
        //
        // The pre-356 arm took `ctx.src.slice(ctx.pos)` and set
        // `ctx.pos = ctx.src.length`: any `\begin{X}` whose exact `\end{X}`
        // never appears swallowed THE WHOLE DOCUMENT TAIL into one environment
        // body — and the modeled branches below then discard what their node
        // cannot hold (`parseList` keeps only `\item` slices, `figure` keeps
        // only its recognised attrs), so the tail was not merely mis-shaped, it
        // was DESTROYED. The serializer then wrote the `\end{X}` the user never
        // typed, making the damage a FIXED POINT that no later save healed.
        //
        // The routine trigger is not a typo'd or commented-out close — it is
        // TYPING: in the code pane the user writes `\begin{itemize}` and, for
        // the seconds before the close exists, every keystroke re-parses a
        // document whose tail is inside that environment.
        //
        // Damage from malformed input must be LOCAL: put the cursor back on the
        // opener and let it be carried as ordinary raw content, exactly as any
        // other unmodelled command is. This is the policy `skipOpaqueConstructAt`
        // ALREADY states one layer down ("Unterminated ⇒ TRANSPARENT") — this
        // dispatcher was the layer that still disagreed.
        ctx.pos = envOpenStart;
        // Deliberately NOT `continue` — fall through to the remaining block
        // dispatchers and ultimately `readParagraph`, which is what carries the
        // bytes. Progress is guaranteed: `readParagraph`'s block-boundary test
        // requires a non-empty accumulated `result`, so the opener that begins
        // the paragraph can never terminate it.
      } else {
      const envContent = ctx.src.slice(ctx.pos, envEnd);
      ctx.pos = envEnd + `\\end{${env}}`.length;

      // Harvest the trailing %!v:xxxx UUID anchor right after \end{env} —
      // UNCONDITIONALLY, for every environment name (task 342).
      //
      // The anchor is EMITTED per node TYPE and was HARVESTED per environment
      // NAME, from a hand list of the six names the switch below happens to
      // model. But EVERY branch of that switch produces a node, and the
      // serializer emits a trailing anchor for any carrier node carrying a
      // uuid — so the correct list of anchor-less envs is EMPTY, and the hand
      // list could only ever be missing names. It was: `align`, `equation`,
      // `table`, `tabular`, `center`, `abstract`, `theorem` and every other env
      // Virgil doesn't model were written WITH an anchor and read back WITHOUT
      // one, so `assignUuids` minted a fresh uuid every save (orphaning every
      // card anchored to that block, with no edit by the user) and the orphaned
      // line was re-read as a STANDALONE empty paragraph — one stray `%!v:`
      // line and one blank block per save, unbounded. Task 264 closed exactly
      // this for the verbatim family and left the general case live; this
      // deletes the list rather than extending it.
      //
      // Safe to run for every name because `NODE_UUID_ANCHOR` is anchored at
      // the start with `[ \t]*` only: it can match nothing but an anchor on the
      // SAME line as the `\end{env}` we just consumed, which is precisely where
      // this env's own carrier node would have put it.
      let envUuid: string | null = null;
      {
        const uuidMatch = ctx.src.slice(ctx.pos).match(NODE_UUID_ANCHOR);
        if (uuidMatch) {
          envUuid = uuidMatch[1];
          ctx.pos += uuidMatch[0].length;
        }
      }

      switch (env) {
        case "verbatim": {
          // Verbatim is byte-preserving: `unwrapVerbatimEnvBody` is the exact
          // inverse of the serializer's emit (undo the single wrapping `\n` on
          // each side — never a blunt `.trim()`, which would drop first-line
          // indentation and blank lines every cycle — then un-escape the
          // `\end{verbatim%!v-esc}` sentinel).
          const text = unwrapVerbatimEnvBody(envContent);
          const codeNode: JSONContent = {
            type: "codeBlock",
            content: [{ type: "text", text }],
          };
          if (envUuid) {
            codeNode.attrs = { uuid: envUuid };
          }
          parent.content.push(codeNode);
          break;
        }
        case "quote":
          {
            const quoteDoc: JSONContent = { type: "blockquote", content: [] };
            if (envUuid) {
              quoteDoc.attrs = { uuid: envUuid };
            }
            const quoteCtx: ParseContext = { pos: 0, src: envContent.trim() };
            parseBody(quoteCtx, quoteDoc);
            parent.content.push(quoteDoc);
          }
          break;
        case "itemize":
        case "enumerate": {
          const listNode = parseList(
            envContent,
            env === "itemize" ? "bulletList" : "orderedList",
            optArg,
          );
          if (!listNode) {
            // The body holds no `\item` — not a list Virgil can model. Carry
            // the whole environment rather than keep an empty shell (task 356).
            pushVerbatimEnvCarrier(parent, env, optArg, envContent, envUuid);
            break;
          }
          if (envUuid) {
            if (!listNode.attrs) listNode.attrs = {};
            listNode.attrs.uuid = envUuid;
          }
          parent.content.push(listNode);
          break;
        }
        case "figure":
        case "figure*": {
          const figAttrs = extractFigureAttrs(envContent);
          const captionInline = parseInlineContent(figAttrs.caption);
          const figNode: JSONContent = {
            type: "figureBlock",
            attrs: {
              extras: figAttrs.extras,
              // Bytes after the figure's own `\caption` — a second
              // figure-depth `\label`, a stray second `\caption`, a trailing
              // comment. Carried on the side they were written on, because a
              // `\label` that crosses the caption changes which counter it
              // names (task 379).
              trailingExtras: figAttrs.trailingExtras,
              placement: optArg,
              starred: env === "figure*",
              source: figAttrs.source,
              widthPercent: figAttrs.widthPercent,
              sources: figAttrs.sources,
              label: figAttrs.label,
              // Did the source carry a `\caption` command? The child below is
              // ALWAYS built (see its comment), so it cannot answer this and
              // the emitter must not be left inferring it (task 319).
              hasCaption: figAttrs.hasCaption,
              shortCaption: figAttrs.shortCaption,
              // `\caption*` IS "unnumbered float" in LaTeX, so it is read into
              // the attr that already means that rather than a second, parallel
              // fact (task 376 M4). Before this the star was deleted on the
              // first save and `numbered` reached the `.tex` nowhere at all, so
              // the toggle did not survive a reload.
              numbered: !figAttrs.captionStarred,
              figureNumber: null,
              ...(envUuid ? { uuid: envUuid } : {}),
            },
            // Always emit a figureCaption child — the lozenge anchors under
            // it, and the `Figure N:` prefix is rendered by the parent
            // NodeView regardless of caption text presence.
            content: [{ type: "figureCaption", content: captionInline }],
          };
          parent.content.push(figNode);
          break;
        }
        default:
          // Every environment Virgil does not model rides the VERBATIM
          // CARRIER: the whole `\begin{env}…\end{env}` preserved byte-for-byte,
          // env name and arguments included, flagged so no serializer runs
          // typography over it, and carrying the block's uuid so its identity
          // survives the save (task 342).
          //
          // **An environment body Virgil does not model is byte-literal by
          // definition.** It is raw source being carried through — nothing
          // downstream is entitled to rewrite it. Under the old
          // `latexCommand` mark it went through `smartenStraightQuotes`, so a
          // fancyvrb `\begin{Verbatim}` body reading `print("hi")` came back
          // `print(``hi'')` on the FIRST save — silent, durable, idempotent on
          // the corrupted form, and (the env being verbatim) visibly wrong in
          // the compiled PDF as literal backticks. `alltt` and `comment` the
          // same. Widening the verbatim vocabulary fixes those three names and
          // leaves the NEXT unmodeled env corrupting; making the default
          // byte-literal fixes every environment Virgil will ever fail to
          // model, including ones that don't exist yet. The vocabulary now
          // decides only the RICHER treatments (the `codeBlock` node,
          // first-close-wins end-finding, scanner inertness) — never whether
          // the user's bytes are safe.
          //
          // Bare `verbatim` keeps its richer byte-preserving `codeBlock`
          // (above); the family's other members have no modeled node — Virgil
          // doesn't render `lstlisting` options or `minted` languages — so they
          // land here, exactly as they did before this branch became the
          // carrier they were being special-cased into (task 264).
          pushVerbatimEnvCarrier(parent, env, optArg, envContent, envUuid);
      }
      continue;
      }
    }

    // % comment line
    if (rest.startsWith("%")) {
      // %!vtex:begin <uuid> ... raw LaTeX ... %!vtex:end <uuid>
      // Round-trip marker for the texBlock node. Contents are slurped
      // verbatim — do NOT recurse into parseBody, the whole point is to
      // hold raw LaTeX the editor doesn't try to render.
      const texBeginMatch = rest.match(/^%!vtex:begin[ \t]+([0-9a-f]+)/);
      const texBeginEol = texBeginMatch ? ctx.src.indexOf("\n", ctx.pos) : -1;
      const texEndIdx =
        texBeginMatch && texBeginEol !== -1
          ? ctx.src.indexOf(`%!vtex:end ${texBeginMatch[1]}`, texBeginEol + 1)
          : -1;
      // FAIL CLOSED on a begin marker whose `%!vtex:end` never appears — or
      // which has no line at all after it (task 356's census).
      //
      // The pre-356 arms took `ctx.src.slice(bodyStart)` to EOF and `ctx.pos =
      // ctx.src.length`: the whole document tail became ONE opaque texBlock,
      // and the serializer then wrote the `%!vtex:end` the user never typed, so
      // every heading, list and card anchor below the stranded marker was
      // permanently folded into raw source with no way back through the editor.
      // The other arm DELETED the marker line outright.
      //
      // Failing closed here means simply not claiming the construct: the
      // `%!vtex:begin …` line falls through to the general comment branch below
      // (it is comment bytes, and `%!v:` does not match `%!vtex:`), so it is
      // carried as a `latexComment` and parsing continues normally past it. The
      // stranded marker is defused on the way out (`% !vtex:begin …`), which is
      // right: a begin with no end is not a construct, and leaving it live
      // would re-slurp on the next open.
      if (texBeginMatch && texBeginEol !== -1 && texEndIdx !== -1) {
        const uuid = texBeginMatch[1];
        const bodyStart = texBeginEol + 1;
        const endIdx = texEndIdx;
        let bodyEnd: number = endIdx;
        // Trim the single newline the serializer always emits before the end marker.
        if (bodyEnd > bodyStart && ctx.src[bodyEnd - 1] === "\n") bodyEnd--;
        const eolAfterEnd = ctx.src.indexOf("\n", endIdx);
        // unterminated-ok: `eolAfterEnd === -1` means the END marker is the
        // last line, so EOF genuinely is the end of the construct — no
        // unrelated content can lie past it.
        const advanceTo = eolAfterEnd === -1 ? ctx.src.length : eolAfterEnd + 1;
        let code = ctx.src.slice(bodyStart, bodyEnd);
        // Unescape any `%!v tex:end` → `%!vtex:end` that the serializer
        // emitted to protect user-pasted markers from terminating early.
        code = code.replace(/%!v tex:end/g, "%!vtex:end");
        ctx.pos = advanceTo;
        parent.content.push({
          type: "texBlock",
          attrs: { uuid, code },
        });
        continue;
      }

      // Virgil markers
      if (rest.startsWith("%!v:")) {
        const eol = ctx.src.indexOf("\n", ctx.pos);
        // Blank paragraph marker (legacy: empty paragraph with no UUID)
        if (rest.startsWith("%!v:blank")) {
          // unterminated-ok: a comment ends at its newline, so a missing one
          // means EOL IS EOF. Line-bounded, not a construct-body claim — the
          // same for every `eol !== -1 ? eol + 1 : ctx.src.length` below.
          ctx.pos = eol !== -1 ? eol + 1 : ctx.src.length;
          parent.content.push({ type: "paragraph" });
          continue;
        }
        // `%!v:<uuid>` on its own block-level line — an empty paragraph
        // whose UUID we want to preserve (e.g. left behind by archive).
        // We accept it as such only when the marker stands alone on the
        // line (no trailing content), otherwise fall through to the
        // silent-skip case below to keep trailing-anchor parsing intact.
        const lineMatch = rest.match(NODE_UUID_REGEX);
        if (lineMatch && lineMatch.index === 0) {
          const afterUuidPos = ctx.pos + lineMatch[0].length;
          // unterminated-ok: line-bounded comment scan (see above).
          const eolPos = eol !== -1 ? eol : ctx.src.length;
          const trailing = ctx.src.slice(afterUuidPos, eolPos);
          if (!trailing.trim()) {
            // unterminated-ok: line-bounded comment scan (see above).
            ctx.pos = eol !== -1 ? eol + 1 : ctx.src.length;
            parent.content.push({ type: "paragraph", attrs: { uuid: lineMatch[1] } });
            continue;
          }
        }
        // Skip UUID anchor comments silently.
        // unterminated-ok: line-bounded comment scan (see above).
        ctx.pos = eol !== -1 ? eol + 1 : ctx.src.length;
        continue;
      }
      const eol = ctx.src.indexOf("\n", ctx.pos);
      const rawComment = eol !== -1
        ? ctx.src.slice(ctx.pos + 1, eol).trim()
        : ctx.src.slice(ctx.pos + 1).trim();
      // unterminated-ok: line-bounded comment scan — and the bytes are CAPTURED
      // into `rawComment` above, so nothing is claimed and nothing is dropped.
      ctx.pos = eol !== -1 ? eol + 1 : ctx.src.length;
      // Strip trailing %!v:xxxx UUID anchor from comment text
      const { text: commentText, uuid: commentUuid } = stripUuidAnchor(rawComment);
      // latexComment holds its text as native inline content now (`text*`),
      // not an `attrs.text` — empty comments carry no content child.
      parent.content.push({
        type: "latexComment",
        attrs: { ...(commentUuid ? { uuid: commentUuid } : {}) },
        content: commentText ? [{ type: "text", text: commentText }] : [],
      });
      continue;
    }

    // \hrulefill
    if (rest.startsWith("\\hrulefill")) {
      parent.content.push({ type: "horizontalRule" });
      ctx.pos += "\\hrulefill".length;
      continue;
    }

    // \partitle{...} — legacy migration: attach title to following paragraph
    if (rest.startsWith("\\partitle{")) {
      const inner = extractBraced(ctx.src, ctx.pos + "\\partitle".length);
      if (inner !== null) {
        ctx.pos = inner.end;
        while (ctx.pos < ctx.src.length && /\s/.test(ctx.src[ctx.pos])) ctx.pos++;
        const para = readParagraph(ctx);
        if (para) {
          const { text: paraText, uuid } = stripUuidAnchor(para);
          const content = parseInlineContent(paraText, false, PARAGRAPH_INLINE);
          if (content.length > 0) {
            const attrs: Record<string, unknown> = { parTitle: inner.content };
            if (uuid) attrs.uuid = uuid;
            parent.content.push({ type: "paragraph", attrs, content });
            continue;
          }
        }
        parent.content.push({
          type: "paragraph",
          attrs: { parTitle: inner.content },
        });
        continue;
      }
    }

    // Regular paragraph — read until double newline or a command
    const para = readParagraph(ctx);
    if (para) {
      const { text: paraText, uuid } = stripUuidAnchor(para);
      const content = parseInlineContent(paraText, false, PARAGRAPH_INLINE);
      if (content.length > 0) {
        const node: JSONContent = { type: "paragraph", content };
        if (uuid) node.attrs = { uuid };
        parent.content.push(node);
      }
    }
  }
  closePendingSpan();
}

/**
 * The inline-parse options a BLOCK-level paragraph reads its content with:
 * a `%` here begins a real comment tail, because what the serializer writes
 * after this content is a newline. Named once so the two paragraph call sites
 * cannot drift, and so the difference from the six ARGUMENT recursions (which
 * take the OFF default) is legible at both ends — see `parseInlineContent`.
 */
const PARAGRAPH_INLINE = { commentTails: true } as const;

/**
 * Strip the trailing `%!v:xxxx` anchor(s) from block text, returning the text
 * and the uuid (last one wins).
 *
 * The anchor Virgil emits IS a comment by TeX's own rule — everything from its
 * `%` to end of line is discarded — which is what makes the second group
 * necessary (task 347). A user who opens the code pane and types a note after
 * the anchor produces `Some prose. %!v:aaaa % user note`, where the anchor is
 * no longer last. The pre-347 end-anchored match simply failed there: the whole
 * tail fell through as prose, `\%`-escaped on the way out, and the block's uuid
 * was DESTROYED on the next save — orphaning every card, marginalia marker and
 * sidecar title keyed on it, with no edit by the user.
 *
 * So the anchors may be followed by a comment REMAINDER, which is handed back
 * as ordinary text for the inline parser to carry (it re-emits it verbatim,
 * and the serializer re-appends the anchor after it — a one-cycle reordering
 * into the canonical `… % user note %!v:aaaa`, stable from then on). The
 * anchors themselves must still be present for either branch to fire, so this
 * can never mistake a trailing `\url{…a%20b}` for an anchor.
 */
function stripUuidAnchor(text: string): { text: string; uuid: string | null } {
  // Group 1: one or more %!v:xxxx markers. Group 2 (optional): a comment
  // remainder the user typed after them, which stays content.
  const match = text.match(/(\s*(?:%!v:[0-9a-f]{4}\s*)+)(%[^\n]*)?$/);
  if (match) {
    const head = text.slice(0, match.index).trimEnd();
    const remainder = match[2] ? match[2].trimEnd() : "";
    // Extract the last UUID from the matched markers
    const uuids = [...match[1].matchAll(new RegExp(NODE_UUID_REGEX.source, "g"))];
    const lastUuid = uuids.length > 0 ? uuids[uuids.length - 1][1] : null;
    const cleaned = remainder ? (head ? `${head} ${remainder}` : remainder) : head;
    return { text: cleaned, uuid: lastUuid };
  }
  return { text, uuid: null };
}

/**
 * One item slice: the text between an `\item` and the next sibling `\item`,
 * plus the RAW `[label]` optional argument if the item carried one.
 *
 * `label` is `null` for a bare `\item` and `""` for `\item[]` — the two are
 * different LaTeX (the second suppresses the marker entirely), so the empty
 * string must stay distinguishable from absence.
 */
interface ListItemSlice {
  text: string;
  label: string | null;
}

/**
 * Push the WHOLE `\begin{env}…\end{env}` onto `parent` as one byte-literal
 * carrier paragraph — env name, optional argument and body included, flagged
 * so no serializer runs typography over it, and carrying the block's uuid so
 * its identity survives the save (task 342).
 *
 * This is the ONE place that spelling lives. It is the environment
 * dispatcher's `default:` arm — and, since task 356, the REFUSAL every modeled
 * branch takes when the body is not something its node can hold. A modeled
 * branch that meets a body outside its model has exactly two honest answers:
 * carry the bytes, or throw. It must never keep the fraction it recognises and
 * drop the rest, which is the whitelist-drop-without-carrier class this and
 * task 350 exist to close.
 */
function pushVerbatimEnvCarrier(
  parent: JSONContent,
  env: string,
  optArg: string,
  envContent: string,
  envUuid: string | null,
): void {
  parent.content!.push({
    type: "paragraph",
    ...(envUuid ? { attrs: { uuid: envUuid } } : {}),
    content: [
      {
        type: "text",
        text: `\\begin{${env}}${optArg}${envContent}\\end{${env}}`,
        marks: [verbatimMark()],
      },
    ],
  });
}

/**
 * Split list-environment content into individual item slices, respecting
 * nested itemize/enumerate environments. Each returned slice holds the text
 * between an `\item` and the next sibling `\item` (or end of content), with
 * surrounding whitespace trimmed, plus the item's raw optional label.
 *
 * Also returns any "preamble" — content that appears before the first
 * `\item` (e.g. `\itemsep`, `\setlength`, custom commands).  This content
 * is invisible in the editor but preserved across round-trips.
 *
 * The optional `[label]` is CAPTURED, not merely skipped (task 340). It used
 * to be consumed here to find where the body starts and then dropped on the
 * floor, so a hand-lettered enumeration or a custom bullet was destroyed on
 * the first save — the user made no edit; opening and saving was enough. It
 * rides the `listItem` node as `itemLabel`, raw and opaque, exactly as the
 * list's own unmodeled `listPreamble` already did one field over.
 */
function splitListItems(content: string): {
  items: ListItemSlice[];
  preamble: string;
  hasItems: boolean;
} {
  const items: ListItemSlice[] = [];
  let pos = 0;
  // Index where the current item's body starts (-1 = before any \item)
  let currentStart = -1;
  // Label of the item whose body starts at `currentStart`.
  let currentLabel: string | null = null;
  // Track where the first \item is so we can extract the preamble
  let firstItemPos = -1;
  while (pos < content.length) {
    // A line-leading `%` is INERT (task 378, member M1). Without this the
    // splitter read a `% \item Draft alternative.` the author had deliberately
    // commented out as a real item boundary: the bullet became live and
    // PRINTED on the first save, the `%` was stranded alone on its own line,
    // and the whole thing was a fixed point (no later save healed it) that
    // MOVED words rather than losing them, so the write gate's word measure
    // scored a shortfall of zero. The rule is the lexer's one reader —
    // `scanLive` and the two sibling splitters ask the identical question.
    // Skipping keeps the commented bytes inside the CURRENT item's slice,
    // where `parseBody` carries them as a comment child; nothing is dropped.
    const afterComment = skipLineCommentAt(content, pos);
    if (afterComment !== -1) {
      pos = afterComment;
      continue;
    }
    // Skip past ANY nested construct — an `\item` inside one belongs to that
    // construct, not to this list. Membership is the lexer's grammar-derived
    // vocabulary, never a hand list here: before task 338 this branch knew
    // literal `itemize`/`enumerate` and nothing else, so a nested
    // `description` / `enumerate*` / `minipage` / `verbatim` code listing was
    // TORN APART on the first save — its `\item` lines hoisted out as siblings
    // of the outer list's items and its `\end{…}` stranded in the prose.
    const skip = skipOpaqueConstructAt(content, pos);
    if (skip !== -1 && skip > pos) {
      pos = skip;
      continue;
    }
    // Look for \item at depth 0 (must be word-boundary so \items etc. don't match)
    if (content.startsWith("\\item", pos)) {
      const after = content[pos + 5];
      if (after === undefined || /[\s\W]/.test(after)) {
        if (firstItemPos === -1) firstItemPos = pos;
        if (currentStart >= 0) {
          items.push({
            text: content.slice(currentStart, pos).trim(),
            label: currentLabel,
          });
        }
        pos += 5;
        // Capture the optional [label] argument and skip trailing whitespace.
        // The scan is the lexer's shared brace-aware, escape-parity bracket
        // reader — never a local `indexOf("]")`, which finds the wrong close
        // for `\item[\textbf{a]b}]`. An unterminated argument answers null and
        // the bytes stay put as ordinary body text.
        while (pos < content.length && /[ \t]/.test(content[pos])) pos++;
        currentLabel = null;
        const bracket = extractBracketed(content, pos);
        if (bracket) {
          currentLabel = bracket.content;
          pos = bracket.end;
        }
        while (pos < content.length && /[ \t]/.test(content[pos])) pos++;
        currentStart = pos;
        continue;
      }
    }
    pos++;
  }
  if (currentStart >= 0) {
    items.push({ text: content.slice(currentStart).trim(), label: currentLabel });
  }
  // Extract preamble: everything before the first \item, trimmed.
  //
  // `firstItemPos === -1` (NO `\item` anywhere) is a different fact from
  // `firstItemPos === 0` (an item at offset 0, so there is no preamble), and
  // the pre-356 `firstItemPos > 0 ? … : ""` conflated the two: a body with no
  // items at all reported an EMPTY preamble and zero items, so `parseList`
  // substituted one empty `listItem` and every byte of the body was destroyed
  // — on WELL-FORMED input, with no unterminated close for the fail-closed arms
  // above to catch. The whole body is preamble when there is no item to
  // separate it from; `hasItems` lets the caller refuse outright.
  const preamble =
    firstItemPos === -1
      ? content.trim()
      : firstItemPos > 0
        ? content.slice(0, firstItemPos).trim()
        : "";
  return { items, preamble, hasItems: firstItemPos !== -1 };
}

/**
 * Parse a list environment's body into a `bulletList`/`orderedList`, or answer
 * `null` when the body is not something the list model can hold.
 *
 * The refusal (task 356 site 2) covers a body with CONTENT but no `\item`:
 * `\begin{itemize}\input{bullets}\end{itemize}`, a tuning-only body
 * (`\itemsep`/`\setlength`), or items hidden inside an opaque construct.
 * Virgil's list model IS its items, so such a body is unrepresentable — and
 * the caller carries the whole environment byte-for-byte instead, which is task
 * 342's rule ("what the system does not model, it CARRIES") read one level in.
 * Routing it through `listPreamble` was the other candidate and is strictly
 * worse: the serializer would re-emit an `\item` the user never typed.
 *
 * A body that is EMPTY (or whitespace only) is not a refusal — there is nothing
 * to lose, and the one-empty-item list is the editable node the user wants.
 */
function parseList(
  content: string,
  type: string,
  options = "",
): JSONContent | null {
  const items: JSONContent[] = [];
  const { items: itemTexts, preamble, hasItems } = splitListItems(content);
  if (!hasItems && content.trim() !== "") return null;

  for (const slice of itemTexts) {
    // Pull off the item's `%!v:xxxx` marker if present, from the ONE place the
    // serializer appends it (`appendUuidAnchor`, at the end of the item's whole
    // body) — plus the pre-348 head-line position, so an existing document's
    // items keep their identity across the upgrade. Stripped before parsing so
    // the marker doesn't leak into the rendered text.
    const { text: itemText, uuid: itemUuid } = detachItemAnchor(slice.text);

    // Parse the item body as a block sequence so nested itemize/enumerate
    // become real list nodes, not unknown commands. parseBody emits
    // paragraphs for plain text and bulletList/orderedList for nested envs.
    const itemDoc: JSONContent = { type: "listItem", content: [] };
    // `null` (no optional argument) is left OFF the node so a plain `\item`
    // round-trips byte-identically; `""` (a marker-suppressing `\item[]`) is
    // a real value and is stamped.
    if (itemUuid) itemDoc.attrs = { uuid: itemUuid };
    if (slice.label !== null) {
      itemDoc.attrs = { ...itemDoc.attrs, itemLabel: slice.label };
    }
    const itemCtx: ParseContext = { pos: 0, src: itemText };
    parseBody(itemCtx, itemDoc);

    // The listItem schema requires "paragraph block*" — ensure the first
    // child is a paragraph. parseBody can produce a leading non-paragraph
    // (e.g. when an item starts with a nested list and no inline text).
    if (!itemDoc.content || itemDoc.content.length === 0) {
      itemDoc.content = [{ type: "paragraph" }];
    } else if (itemDoc.content[0].type !== "paragraph") {
      itemDoc.content.unshift({ type: "paragraph" });
    }

    items.push(itemDoc);
  }

  // Empty list — keep at least one empty item so the schema is valid
  if (items.length === 0) {
    items.push({
      type: "listItem",
      content: [{ type: "paragraph" }],
    });
  }

  const node: JSONContent = { type, content: items };
  if (preamble) {
    node.attrs = { ...node.attrs, listPreamble: preamble };
  }
  // The `\begin{enumerate}[label=(\roman*)]` bracket, carried RAW (task 376
  // M3). Until then this branch was the outlier: `figure` kept its `[htbp]` in
  // `placement` and the unmodeled-env carrier re-emitted its bracket, while a
  // list's options were captured into `optArg`, used only on the refusal path,
  // and DELETED — so an enumitem list reverted from (i)/(ii) to 1./2. in the
  // PDF at a cost of three word tokens, under the write gate's four-word slack.
  // Opaque by choice: interpreting enumitem keys is a different project, and
  // the byte the user wrote is the fact that has to survive.
  if (options) {
    node.attrs = { ...node.attrs, listOptions: options };
  }
  return node;
}

function skipWhitespace(ctx: ParseContext): void {
  while (ctx.pos < ctx.src.length && /\s/.test(ctx.src[ctx.pos])) {
    ctx.pos++;
  }
}

function readParagraph(ctx: ParseContext): string {
  let result = "";
  // Depth of the brace groups open at `ctx.pos`. A block-level command inside
  // a command's ARGUMENT is not a block boundary — it is that command's
  // business (task 341). Without this, `Text.\footnote{Display \[x^2\] here.}`
  // split at the `\[`: the `\footnote` lost its argument and was demoted to a
  // grey `latexCommand`, the `{Display` and `here.}` became prose in two
  // different paragraphs, and the document round-tripped to
  // `\footnote\{Display` / `\[…\]` / `here.\}` — LaTeX errors on that
  // ("Paragraph ended before \footnote was complete"), and no `\vfid` is
  // emitted, so it has stopped being a footnote at all.
  //
  // Only the COMMAND-boundary test is gated. The blank-line and comment breaks
  // stay unconditional, and that is what bounds the damage of an unbalanced
  // `{` in hand-written source: depth is re-zeroed at every paragraph, so a
  // stray brace can cost at most the rest of its own paragraph's boundary
  // splits, never the rest of the file.
  let braceDepth = 0;
  // Are we inside a line-start `%` comment? Maintained forward as we scan (the
  // `startsLineComment` SSOT answers the OPENING question; a comment always
  // ends at its newline), and read only by the block-boundary test below.
  let inLineComment = false;
  while (ctx.pos < ctx.src.length) {
    if (ctx.src[ctx.pos] === "\n") inLineComment = false;
    else if (
      !inLineComment &&
      ctx.src[ctx.pos] === "%" &&
      startsLineComment(ctx.src, ctx.pos)
    ) {
      inLineComment = true;
    }

    // Double newline ends paragraph
    if (ctx.src[ctx.pos] === "\n" && ctx.pos + 1 < ctx.src.length && ctx.src[ctx.pos + 1] === "\n") {
      ctx.pos += 2;
      break;
    }

    // A comment line does NOT end a paragraph (task 347). In LaTeX a `%` line
    // sitting between two non-blank lines is discarded WITH its newline, so
    // `A\n% c\nB` is one paragraph reading "A B". Breaking here split it into
    // two — the serializer then wrote a blank line around the comment block it
    // had made, and one paragraph became two in the compiled PDF, on OPEN,
    // before the user had edited anything.
    //
    // Nothing is lost by not breaking: the comment is carried inline by the
    // `commentTails` branch of `parseInlineContent`, in place, so the bytes
    // round-trip exactly and the reader still sees a comment where they wrote
    // one. And the two shapes that genuinely DO separate paragraphs still do,
    // because they are blank-line shapes: `A\n\n% c\nB` breaks at the blank
    // line above, leaving the `%` at a block boundary where `parseBody` makes
    // it a `latexComment` BLOCK exactly as before, and `A\n% c\n\nB` breaks at
    // the blank line below. The distinction the pre-347 code could not draw is
    // precisely the one LaTeX draws.

    // Check if next non-space char is a block-level command
    if (
      ctx.src[ctx.pos] === "\\" &&
      result.trim() &&
      braceDepth === 0 &&
      // …and is not sitting inside a COMMENT. A block-level command LaTeX
      // never reads is not a block boundary — the same rule task 341 drew for
      // a command inside a braced argument, one construct over. Without it,
      // dropping the paragraph's comment break (task 347) let `% \end{itemize}`
      // terminate the paragraph AT the `\end`, splitting one comment line into
      // an empty `%` plus a live-looking terminator.
      //
      // The gate reads `startsLineComment` — the SCAN's rule, not TeX's — so
      // this agrees byte-for-byte with `findMatchingEnv`, which decides where
      // the enclosing construct actually ends. Reading TeX's wider rule here
      // would re-open exactly the layer disagreement task 338 closed, in the
      // direction that swallows the rest of the document.
      !inLineComment &&
      // …and is a REAL control-sequence start. A backslash that is itself
      // ESCAPED is the second half of a `\\` line break, so what follows it is
      // that break's business, not a new block's (task 349 M4).
      //
      // This is the off-by-one that destroyed `\\[2pt]`: `startsBlockBoundary`
      // tests `\[` (it must — see its own note on the trailing `\b`), and that
      // test fires at the SECOND backslash of `\\[`, where the accumulated
      // `result` holds only ONE backslash — so the `/\\\\\s*$/` guard below,
      // which exists to suppress exactly this break, can never match for the
      // ABUTTING shape. The paragraph split, `Line one\` was emitted with a
      // dangling backslash, and `\[2pt]` became an unterminated display-math
      // opener: a `.tex` that no longer compiles, written on OPEN.
      //
      // Asking `isEscaped` rather than widening the guard states the rule at the
      // right altitude — a construct begins at a live `\`, never at the tail of
      // an escaped pair — and it leaves the `\\`-then-newline case the guard was
      // written for (`Line one\\\n\section{X}`) reading exactly as before, since
      // there the boundary fires at a third, unescaped backslash.
      !isEscaped(ctx.src, ctx.pos)
    ) {
      // The boundary vocabulary is the LEXER's (`startsBlockBoundary`), not a
      // private copy: the serializer asks the same question of a list item's
      // tail to choose the separator that follows the item's head, and the two
      // halves disagreeing is what merged an item's second paragraph into its
      // first on every open (task 348). `\[` and `\includegraphics` are covered
      // there — see that predicate for why `\[` needs its own test.
      if (startsBlockBoundary(ctx.src.slice(ctx.pos))) {
        // Don't break if the previous content ends with \\ (a hardBreak
        // continuation from shift+enter). Otherwise multi-line LaTeX joined by
        // soft line breaks would get split into separate paragraphs on reload.
        if (!/\\\\\s*$/.test(result)) {
          break;
        }
      }
    }

    const ch = ctx.src[ctx.pos];
    if ((ch === "{" || ch === "}") && !isEscaped(ctx.src, ctx.pos)) {
      // Clamp at 0: a stray `}` must not drive the depth negative and make the
      // next real `{` look balanced.
      braceDepth = ch === "{" ? braceDepth + 1 : Math.max(0, braceDepth - 1);
    }
    result += ch;
    ctx.pos++;
  }
  return result.trim();
}

// ---------------------------------------------------------------------------
// expex helpers
// ---------------------------------------------------------------------------

/** Split a `\pex` body into [preambleText, ...itemSegments] where each
 *  itemSegment starts just after an `\a` (with its option/tag consumed). */
function splitPexBody(
  body: string,
): {
  preamble: string;
  items: Array<{
    tag: string;
    label: string;
    exnoOverride: string | null;
    rawOptions: string | null;
    uuid: string | null;
    text: string;
  }>;
} {
  const items: Array<{
    tag: string;
    label: string;
    exnoOverride: string | null;
    rawOptions: string | null;
    uuid: string | null;
    text: string;
  }> = [];
  let preamble = "";
  let pos = 0;
  let firstAt = -1;
  // Stashed uuid from a `\vxid{xxxx}` marker immediately preceding the next
  // `\a` item. Consumed when the item begins.
  let pendingItemUuid: string | null = null;
  let current: {
    tag: string;
    label: string;
    exnoOverride: string | null;
    rawOptions: string | null;
    uuid: string | null;
    start: number;
  } | null = null;

  const flushCurrent = (endPos: number) => {
    if (!current) return;
    items.push({
      tag: current.tag,
      label: current.label,
      exnoOverride: current.exnoOverride,
      rawOptions: current.rawOptions,
      uuid: current.uuid,
      text: body.slice(current.start, endPos).trim(),
    });
    current = null;
  };

  while (pos < body.length) {
    // A line-leading `%` is INERT — the `splitListItems` twin (task 378, member
    // M2), reading the same one lexer primitive. A `% \a Draft alternative.`
    // used to become a LIVE example part, which additionally RENUMBERS every
    // later part and therefore every `\ref` to them; the commented bytes now
    // stay inside the current part's slice, where `parseExampleBodyAsBlocks`
    // carries them as a comment paragraph.
    const afterComment = skipLineCommentAt(body, pos);
    if (afterComment !== -1) {
      pos = afterComment;
      continue;
    }
    // Skip nested \begingl … \endgl, nested \ex/\pex blocks, and ANY nested
    // `\begin{env}` (xlist included) so their internal \a markers don't get
    // confused with ours at the current tier. Same grammar-derived vocabulary
    // `splitListItems` reads: before task 338 this branch listed three expex
    // constructs and no `\begin{env}` at all, so a `verbatim` body containing
    // a literal `\a` SPLIT the example and its `\begin{verbatim}` line was
    // deleted outright.
    const skip = skipOpaqueConstructAt(body, pos);
    if (skip !== -1 && skip > pos) {
      pos = skip;
      continue;
    }
    // \vxid{xxxx} — id marker preceding the next \a item. Stash and skip.
    if (markerOpensAt(body, pos, VIRGIL_MARKERS.exampleItem)) {
      const idArg = extractBraced(
        body,
        markerArgStart(pos, VIRGIL_MARKERS.exampleItem),
      );
      if (idArg !== null) {
        pendingItemUuid = idArg.content || null;
        pos = idArg.end;
        continue;
      }
    }
    // Top-level item marker. expex itself only defines `\a` (the visible
    // sub-label `a`/`b`/`c`/… is computed by expex from position), but
    // hand-authored sources sometimes track the position by typing `\b`,
    // `\c`, … to match the rendered label. Accept the full `\[a-z]` range
    // here for forgiveness; the serializer always emits `\a`, so on the
    // next save the document normalizes to the canonical form.
    if (
      body[pos] === "\\" &&
      body[pos + 1] !== undefined &&
      /[a-z]/.test(body[pos + 1])
    ) {
      // A spaced accent (`\v s`, `\d t`) or a special letter (`\i`, `\o`,
      // `\l`) is NOT an `\a`-style item marker. Consume it as inline item
      // text BEFORE the item-marker `after`-char test — otherwise `\v s`
      // would be read as item marker `\v` + content `s`, silently deleting
      // the accent and corrupting item structure. Reuse the shared accent
      // matchers (SSOT) rather than a parallel table. Strictly subtractive:
      // this only suppresses FALSE `\a` splits; a real `\a` never matches
      // matchAccent/matchSpecialLetter, so its slice is unchanged.
      const accent = matchAccent(body, pos);
      if (accent) {
        pos = accent.end;
        continue;
      }
      const special = matchSpecialLetter(body, pos);
      if (special) {
        pos = special.end;
        continue;
      }
      const after = body[pos + 2];
      // Real part markers are `\a<tag>`, `\a[opts]`, `\a\label`, or `\a`
      // at end of line followed by content. Anything else (letter, `{`,
      // punctuation) is some other LaTeX command — accents like `\b{x}`,
      // multi-letter commands like `\begin`/`\bf`, etc.
      if (after === undefined || /[\s<\[\\]/.test(after)) {
        if (firstAt === -1) firstAt = pos;
        flushCurrent(pos);
        let cursor = pos + 2;
        // Optional [opts] — `exno=` interpreted, the rest carried (task 356).
        let exnoOverride: string | null = null;
        let rawOptions = "";
        while (cursor < body.length && body[cursor] === "[") {
          const close = body.indexOf("]", cursor);
          if (close === -1) break;
          const optStr = body.slice(cursor + 1, close);
          const m = optStr.match(/exno\s*=\s*([^,\s]+)/);
          if (m) exnoOverride = m[1];
          rawOptions += body.slice(cursor, close + 1);
          cursor = close + 1;
        }
        // Optional <tag>
        let tag = "";
        if (body[cursor] === "<") {
          const close = body.indexOf(">", cursor);
          if (close !== -1) {
            tag = body.slice(cursor + 1, close);
            cursor = close + 1;
          }
        }
        // Optional \label{…}
        let label = "";
        const afterHdr = body.slice(cursor);
        const labelMatch = afterHdr.match(/^[ \t]*\\label\{([^}]*)\}/);
        if (labelMatch) {
          label = labelMatch[1];
          cursor += labelMatch[0].length;
        }
        // Consume one leading space for cleanliness
        while (cursor < body.length && /[ \t]/.test(body[cursor])) cursor++;
        current = {
          tag,
          label,
          exnoOverride,
          rawOptions: rawOptions || null,
          uuid: pendingItemUuid,
          start: cursor,
        };
        pendingItemUuid = null;
        pos = cursor;
        continue;
      }
    }
    pos++;
  }
  flushCurrent(body.length);
  if (firstAt > 0) preamble = body.slice(0, firstAt).trim();
  else if (firstAt === -1) preamble = body.trim();
  return { preamble, items };
}

/**
 * Where a linguex example ENDS: the first BLANK line at or after `from`, or
 * the first line that OPENS a block construct, or end-of-source.
 *
 * This is the load-bearing safety property of the whole dialect, and it is a
 * property of linguex's GRAMMAR rather than of this code: a linguex example
 * has no closing command — it is terminated by the paragraph break — so a
 * linguex reader **cannot** swallow past its own paragraph. The catastrophe
 * task 350 fixed (an unterminated `\ex` claiming the rest of the document) is
 * unrepresentable here, and stays that way only while this scan has no
 * "continuation" heuristic bolted onto it. Do not add one.
 *
 * The block-boundary rung is a strict NARROWING of the blank-line rule, and it
 * is faithful to what TeX does: `\section` issues its own `\par`, so linguex
 * ends the example there whether or not the author left a blank line. Reading
 * the boundary vocabulary from the lexer (`startsBlockBoundary`) rather than
 * a private list is what keeps this agreeing with `readParagraph`, which is
 * the function that will carry these same bytes if the example is refused.
 */
function linguexExampleEnd(src: string, from: number): number {
  let scan = from;
  while (scan < src.length) {
    const nl = src.indexOf("\n", scan);
    // unterminated-ok: end-of-source IS a linguex example's terminator. The
    // construct has no closing command — it ends at the paragraph break — and
    // the last paragraph of a document ends at its end. There is nothing here
    // that could have been "missing", so there is nothing to fail closed on;
    // the bound below reads ONE line and cannot exceed it either way.
    if (nl === -1) return src.length;
    const nextNl = src.indexOf("\n", nl + 1);
    const line = src.slice(nl + 1, nextNl === -1 ? src.length : nextNl);
    const trimmed = line.trim();
    // Ask the boundary question of the line MINUS any leading `\vexid`/`\vxid`
    // run: those are Virgil's own bookkeeping and belong to THIS example (they
    // label the very `\a.` that follows), while a marker sitting in front of a
    // real `\ex` must not hide the boundary it opens. Reading the raw line
    // instead cut every re-opened Virgil-saved document's example off at its
    // first item — measured, on cycle 2 of the round trip.
    const afterMarkers = trimmed.slice(blockMarkerPrefixLength(trimmed));
    if (trimmed === "" || startsBlockBoundary(afterMarkers)) return nl;
    scan = nl + 1;
  }
  return src.length;
}

/**
 * Read a linguex `\ex.` example at `ctx.pos`, or REFUSE.
 *
 * On success the node is returned and `ctx.pos` advances past the body. On a
 * refusal `ctx.pos` is left exactly where it was, so the caller falls through
 * to `readParagraph` and the bytes are carried raw — task 350's carrier, and
 * the reason this function can afford to model only the shapes it understands.
 *
 * `afterOpener` is the index just past `\ex.` (from `matchLinguexOpenerAt`).
 */
function readLinguexExample(
  ctx: ParseContext,
  afterOpener: number,
): JSONContent | null {
  const bodyEnd = linguexExampleEnd(ctx.src, afterOpener);
  // Optional `\label{…}` on the header. Exactly ONE is lifted onto the node:
  // a second stays in the body text, where the inline parser carries it as a
  // raw-LaTeX atom and the serializer re-emits it — bytes preserved without a
  // refusal, where "last one wins" would have dropped a `\label` silently.
  let cursor = afterOpener;
  let label = "";
  const labelMatch = ctx.src
    .slice(cursor, bodyEnd)
    .match(/^[ \t]*\\label\{([^}]*)\}/);
  if (labelMatch) {
    label = labelMatch[1];
    cursor += labelMatch[0].length;
  }

  const split = splitLinguexBody(ctx.src.slice(cursor, bodyEnd));
  if (!split) return null;

  const uuid = ctx.pendingExampleId || null;
  const node = buildExampleBlockFromBody("", {
    kind: split.items.length > 0 ? "multi" : "single",
    tag: "",
    label,
    uuid,
    exnoOverride: null,
    rawOptions: null,
    suppressSpace: false,
    dialect: "linguex",
    prebuilt:
      split.items.length > 0
        ? { preamble: split.preamble, items: split.items.map(toItemSpec) }
        : { singleBody: split.preamble },
  });
  ctx.pendingExampleId = null;
  ctx.pos = bodyEnd;
  return node;
}

/** A linguex item in the shared item shape — the expex-only three at their
 *  neutral values (linguex has no `<tag>` and no `[exno=…]`). */
function toItemSpec(item: {
  label: string;
  uuid: string | null;
  text: string;
}): ExampleItemSpec {
  return {
    tag: "",
    label: item.label,
    uuid: item.uuid,
    text: item.text,
    exnoOverride: null,
    rawOptions: null,
  };
}

/**
 * **The linguex body splitter** — the `splitPexBody` twin, and deliberately a
 * separate function rather than a mode on it (the two grammars agree on
 * nothing but the shape of what they produce).
 *
 * `body` is the text AFTER the `\ex.` header and BEFORE the blank line that
 * terminates it — a bound the caller established and this function cannot
 * exceed, which is the safety property the whole feature rests on (task 355:
 * *never scan past the blank line, even for a continuation heuristic*). The
 * task-350 disease is unrepresentable here: there is no terminator to fail to
 * find.
 *
 * Returns `null` to REFUSE — an example holding a construct this v1 does not
 * model is carried raw, whole, by the caller. Never half-parsed: the rule task
 * 350 defect C states one layer down, *never emit a node that serializes to
 * less than it consumed.*
 */
function splitLinguexBody(
  body: string,
): {
  preamble: string;
  items: Array<{ label: string; uuid: string | null; text: string }>;
} | null {
  // The refusal vocabulary, asked of the WHOLE body rather than at line starts
  // only — over-refusing costs the model for a rare shape, under-refusing
  // costs the user's bytes, and only one of those is recoverable.
  if (LINGUEX_UNMODELLED_RE.test(body)) return null;

  const items: Array<{ label: string; uuid: string | null; text: string }> = [];
  let current: { label: string; uuid: string | null; start: number } | null =
    null;
  let firstAt = -1;
  let aCount = 0;
  let pendingItemUuid: string | null = null;
  let pos = 0;
  // True at the head of the body (a first item may abut the `\ex.` header) and
  // after every newline + indentation run. Survives a `\vxid{…}` marker,
  // which is Virgil's own byte sitting between the indent and the marker it
  // labels — see `matchLinguexItemAt` on why the line-start rule is what keeps
  // `\i.` (dotless i) out of the item vocabulary.
  let lineStart = true;

  const flush = (end: number) => {
    if (!current) return;
    items.push({
      label: current.label,
      uuid: current.uuid,
      text: body.slice(current.start, end).trim(),
    });
    current = null;
  };

  while (pos < body.length) {
    // A line-leading `%` is INERT — the third reader of the one lexer
    // primitive (task 378, member M5). This splitter was already correct here
    // and only BY ACCIDENT: the `%` itself cleared `lineStart`, so the
    // `\b.` behind it never reached `matchLinguexItemAt`. That is not a
    // property a refactor can be trusted to preserve, and it is the same
    // question its two siblings were getting wrong outright — so it is stated
    // rather than inherited. Byte-for-byte the pre-378 behaviour.
    const afterComment = skipLineCommentAt(body, pos);
    if (afterComment !== -1) {
      pos = afterComment;
      lineStart = true;
      continue;
    }
    if (lineStart) {
      // \vxid{xxxx} — id marker for the item that follows. Stash and skip,
      // keeping `lineStart` so the marker cannot hide the item behind it.
      if (markerOpensAt(body, pos, VIRGIL_MARKERS.exampleItem)) {
        const idArg = extractBraced(
          body,
          markerArgStart(pos, VIRGIL_MARKERS.exampleItem),
        );
        if (idArg !== null) {
          pendingItemUuid = idArg.content || null;
          pos = idArg.end;
          continue;
        }
      }
      const item = matchLinguexItemAt(body, pos, true);
      if (item) {
        // A SECOND `\a.` opens a deeper tier in linguex, which this v1 does
        // not model — refuse the example whole rather than flatten a nesting
        // level into its parent.
        if (item.letter === "a" && ++aCount > 1) return null;
        if (firstAt === -1) firstAt = pos;
        flush(pos);
        let cursor = item.end;
        // Optional `\label{…}`, abutting or one space away.
        let label = "";
        const labelMatch = body
          .slice(cursor)
          .match(/^[ \t]*\\label\{([^}]*)\}/);
        if (labelMatch) {
          label = labelMatch[1];
          cursor += labelMatch[0].length;
        }
        while (cursor < body.length && /[ \t]/.test(body[cursor])) cursor++;
        current = { label, uuid: pendingItemUuid, start: cursor };
        pendingItemUuid = null;
        pos = cursor;
        lineStart = false;
        continue;
      }
    }
    // An opaque nested construct (an inline `\verb`, a `\begin{env}`) is
    // stepped over whole so a literal `\a.` inside one cannot split the
    // example — the same grammar-derived vocabulary `splitPexBody` reads.
    const skip = skipOpaqueConstructAt(body, pos);
    if (skip !== -1 && skip > pos) {
      pos = skip;
      lineStart = false;
      continue;
    }
    const ch = body[pos];
    if (ch === "\n") {
      lineStart = true;
      pos++;
      continue;
    }
    if (lineStart && (ch === " " || ch === "\t")) {
      pos++;
      continue;
    }
    lineStart = false;
    pos++;
  }
  flush(body.length);

  const preamble =
    firstAt === -1 ? body.trim() : firstAt > 0 ? body.slice(0, firstAt).trim() : "";
  return { preamble, items };
}

function buildExampleBlockFromBody(
  body: string,
  opts: {
    kind: "single" | "multi";
    tag: string;
    label: string;
    uuid: string | null;
    exnoOverride: string | null;
    /** The raw `[opts]` bracket run, verbatim — see the `rawOptions` note on
     *  `serializeExampleBlock`. */
    rawOptions?: string | null;
    suppressSpace: boolean;
    /** Which package's syntax this example was written in. Absent ⇒ expex,
     *  which is what every pre-355 call site means (task 355). */
    dialect?: ExampleDialect;
    /**
     * An ALREADY-split body, for a dialect whose grammar this function's own
     * expex splitter cannot read. Absent ⇒ `body` is expex source and
     * `splitPexBody` reads it.
     *
     * The split is what differs between the dialects; the ATTRS and the
     * ASSEMBLY are what they share, so there is one block builder with two
     * splitters rather than two block builders that must be kept agreeing
     * about `uuid` minting, the `number` seed and the empty-body fallbacks.
     */
    prebuilt?:
      | { singleBody: string }
      | { preamble: string; items: ExampleItemSpec[] };
  },
): JSONContent {
  const attrs: Record<string, unknown> = {
    // Assign a fresh UUID when the source had no `\vexid{…}` marker so
    // the panel and sidecar have a stable id to key by. The serializer
    // then emits `\vexid{…}` on the next save, anchoring the id in the
    // .tex itself.
    uuid: opts.uuid || generateShortId(),
    kind: opts.kind,
    tag: opts.tag,
    label: opts.label,
    exnoOverride: opts.exnoOverride,
    rawOptions: opts.rawOptions ?? null,
    suppressSpace: opts.suppressSpace,
    dialect: opts.dialect ?? DEFAULT_EXAMPLE_DIALECT,
    number: 0,
  };

  const pre = opts.prebuilt;
  const content = pre
    ? "singleBody" in pre
      ? assembleExampleBody(pre.singleBody)
      : assembleExampleBody(null, pre)
    : opts.kind === "single"
      ? assembleExampleBody(body)
      : assembleExampleBody(null, splitPexBody(body));
  return { type: "exampleBlock", attrs, content };
}

/** One item, in the shape both splitters produce. The expex splitter fills
 *  every field; the linguex one leaves the expex-only three at their neutral
 *  values, since linguex's grammar has no `<tag>` and no `[exno=…]`. */
interface ExampleItemSpec {
  tag: string;
  label: string;
  uuid: string | null;
  text: string;
  exnoOverride: string | null;
  rawOptions: string | null;
}

/**
 * **The ONE example-body assembly**, shared by both dialects (task 355).
 *
 * The two dialects disagree about everything up to this point — their opener,
 * their terminator, their item markers, their option syntax — and about
 * nothing after it: both produce the same `exampleBlock` children, under the
 * same schema, with the same empty-body fallbacks. Sharing the assembly is
 * what makes every consumer downstream (numbering, cards, the Examples panel,
 * drop specs, the float bodies) dialect-BLIND rather than dialect-aware, and
 * it is where a per-dialect drift in those fallbacks would otherwise live.
 *
 * `singleBody` non-null ⇒ a `single` example (`\ex` / `\ex.` with no
 * sub-items); `split` non-null ⇒ a `multi` one.
 */
function assembleExampleBody(
  singleBody: string | null,
  split?: { preamble: string; items: ExampleItemSpec[] },
): JSONContent[] {
  const content: JSONContent[] = [];
  if (singleBody !== null) {
    // Parse the body as a sequence of paragraphs / glosses / pictures /
    // equations. Feature A2 widens `exampleBlock` to accept graphicsBlock +
    // displayMath directly, so a dropped picture / equation joins a single
    // `\ex` body — the `block` target admits `\[…\]` so a serialized equation
    // survives the reload (graphicsBlock already parses unconditionally). The
    // `\pex` preamble path below stays un-widened (Non-goals §5).
    const inner = parseExampleBodyAsBlocks(singleBody, { target: "block" });
    content.push(...inner);
    if (content.length === 0) content.push({ type: "paragraph" });
    return content;
  }
  const { preamble, items } = split ?? { preamble: "", items: [] };
  if (preamble) {
    content.push(...parseExampleBodyAsBlocks(preamble, { target: "preamble" }));
  }
  const itemNodes: JSONContent[] = items.map((item) =>
    buildExampleItemFromText(
      item.tag,
      item.label,
      item.uuid,
      item.text,
      item.exnoOverride,
      item.rawOptions,
    ),
  );
  if (itemNodes.length === 0) {
    itemNodes.push({
      type: "exampleItem",
      attrs: { uuid: generateShortId(), tag: "", label: "", subLabel: "" },
      content: [{ type: "paragraph" }],
    });
  }
  content.push({ type: "exampleItemList", content: itemNodes });
  return content;
}

/** Build an exampleItem JSONContent from a raw item body string. The
 *  body may contain inline paragraphs, an optional gloss, and optional
 *  nested `\begin{xlist}…\end{xlist}` environments which become a child
 *  exampleItemList. The schema requires content order
 *  `(paragraph | graphicsBlock | displayMath)+ exampleItemList? exampleGloss?`. */
function buildExampleItemFromText(
  tag: string,
  label: string,
  uuid: string | null,
  text: string,
  exnoOverride: string | null = null,
  rawOptions: string | null = null,
): JSONContent {
  // Lift a nested `\begin{xlist}…\end{xlist}` into the schema's single
  // `exampleItemList?` slot — but ONLY when the item holds exactly one.
  //
  // Two sibling xlists is the `exampleGloss` multiplicity case one construct
  // over, with the same oscillation (see `EXAMPLE_BODY_ACCEPTS_ONCE`): a
  // second xlist stays in `stripped`, where `parseBody`'s environment
  // dispatcher has no `xlist` case and task 342's `default:` makes it a
  // byte-literal carrier PARAGRAPH — which the schema then puts BEFORE the
  // lifted list, so the two swap on every save, forever. Measured. Lifting
  // neither keeps the user's order and settles in one cycle; both survive as
  // bytes either way, so what the all-or-none rule costs is the nested-list
  // MODEL for a shape that is already outside what expex renders as one item.
  let nestedList: JSONContent | null = null;
  let stripped = text;
  const xlistOpen = stripped.indexOf("\\begin{xlist}");
  if (xlistOpen !== -1) {
    const innerStart = xlistOpen + "\\begin{xlist}".length;
    const innerEnd = findMatchingEnv(stripped, innerStart, "xlist");
    if (innerEnd !== -1) {
      const withoutFirst =
        stripped.slice(0, xlistOpen) +
        stripped.slice(innerEnd + "\\end{xlist}".length);
      // Any `\begin{xlist}` still standing once the FIRST one's whole body has
      // been removed is a sibling, not a nesting.
      if (!withoutFirst.includes("\\begin{xlist}")) {
        nestedList = buildExampleItemListFromBody(
          stripped.slice(innerStart, innerEnd),
        );
        stripped = withoutFirst;
      }
    }
  }

  const itemContent = parseExampleBodyAsBlocks(stripped, { target: "item" });
  const normalized: JSONContent[] = [];
  // Head section: (paragraph | graphicsBlock | displayMath)+. Preserve document
  // order so an `\includegraphics` or `\[…\]` between two paragraphs round-trips
  // faithfully (Feature A1 adds displayMath alongside A0's graphicsBlock).
  //
  // A PARTITION, never a whitelist filter (task 350 C): "everything that is
  // not the gloss" IS the head, so nothing can fall off the end.
  //
  // Stated honestly, because the neuter measures it: this is a HARDENING with
  // no behavioural delta today. What actually rescued task 348's nested
  // `itemize` residual — and every gloss after the first — is the carrier one
  // function up, which hands this filter a `paragraph` where the pre-350 code
  // handed it a `bulletList` the three-name filter then deleted. Reverting
  // this line alone fails nothing. It is written as a partition so that a
  // future widening of the `item` accept set lands in the head instead of
  // silently re-opening the hole, which is the shape the whole task is about.
  const head = itemContent.filter((n) => n.type !== "exampleGloss");
  const gloss = itemContent.find((n) => n.type === "exampleGloss") ?? null;
  if (head.length === 0) normalized.push({ type: "paragraph" });
  else normalized.push(...head);
  if (nestedList) normalized.push(nestedList);
  if (gloss) normalized.push(gloss);

  return {
    type: "exampleItem",
    // Assign a fresh UUID when the source had no preceding `\vxid{…}`
    // marker so the panel and sidecar have a stable id to key by. The
    // serializer emits `\vxid{…}` on the next save, anchoring the id in
    // the .tex itself.
    // `exnoOverride` mirrors the block leg (`\pex[exno=N]` →
    // `attrs.exnoOverride`): an item-level `\a[exno=N]` forces a specific
    // sub-example number and must survive the parse→serialize cycle. Only
    // carry it when present so an override-free item's attrs stay identical.
    attrs: {
      uuid: uuid || generateShortId(),
      tag,
      label,
      subLabel: "",
      exnoOverride: exnoOverride ?? null,
      rawOptions,
    },
    content: normalized,
  };
}

/** Parse an `\begin{xlist} … \end{xlist}` body into an exampleItemList
 *  node. Items are split on top-level `\a` markers (same logic as a
 *  `\pex` body). Recurses through buildExampleItemFromText for nested
 *  xlists. */
function buildExampleItemListFromBody(body: string): JSONContent {
  const { items } = splitPexBody(body);
  const itemNodes: JSONContent[] = [];
  for (const item of items) {
    itemNodes.push(
      buildExampleItemFromText(
        item.tag,
        item.label,
        item.uuid,
        item.text,
        item.exnoOverride,
        item.rawOptions,
      ),
    );
  }
  if (itemNodes.length === 0) {
    itemNodes.push({
      type: "exampleItem",
      attrs: { uuid: generateShortId(), tag: "", label: "", subLabel: "" },
      content: [{ type: "paragraph" }],
    });
  }
  return { type: "exampleItemList", content: itemNodes };
}

/** Which node types the container that will hold an example body can actually
 *  accept — read off the three expex schemas in
 *  [expex.ts](src/lib/tiptap/expex.ts), stated ONCE so the two builders below
 *  cannot answer it differently.
 *
 *  - `block` — a single `\ex … \xe` body, held by `exampleBlock`:
 *    `(paragraph | exampleGloss | exampleItemList | bulletList | orderedList |
 *      graphicsBlock | displayMath)*`.
 *  - `preamble` — a `\pex` preamble, held by the SAME node. Deliberately
 *    narrower than `block` by `displayMath` only: pre-350 that context passed
 *    `allowDisplayMath: false`, and widening it here would move bytes for a
 *    reason unrelated to this fix. The equation is no longer DROPPED either
 *    way — it falls to the carrier below, which is the whole point.
 *  - `item` — an `\a` item body, held by `exampleItem`:
 *    `(paragraph | graphicsBlock | displayMath)+ exampleItemList? exampleGloss?`.
 *    Its ORDER is the caller's business (`buildExampleItemFromText` groups
 *    head → list → gloss); its MULTIPLICITY is stated here, because a second
 *    gloss is a thing the container cannot hold and this is the one place that
 *    holds the bytes needed to carry it. Pre-350 the caller kept `glosses[0]`
 *    and dropped the rest. */
type ExampleBodyTarget = "block" | "preamble" | "item";

/** Types the target accepts at most ONCE — and therefore, when the body holds
 *  more than one, NONE of them: every occurrence is carried.
 *
 *  "Keep the first, carry the rest" is the obvious rule and it OSCILLATES.
 *  A carrier is a paragraph, and `exampleItem`'s content expression puts every
 *  paragraph BEFORE the trailing `exampleGloss?`, so the carried second gloss
 *  is emitted first — and the next parse models THAT one and carries the
 *  other. Measured: two glosses swap places on every save, forever, so a
 *  document nobody is editing never reaches a fixed point (a moving `.tex`,
 *  a `DiskWatcher` badge, a dirty diff). Carrying both keeps the user's ORDER
 *  and settles in one cycle. `exampleBlock`'s content expression is free-order
 *  `*`, so only the item constrains multiplicity. */
const EXAMPLE_BODY_ACCEPTS_ONCE: Record<
  ExampleBodyTarget,
  ReadonlySet<string>
> = {
  block: new Set<string>(),
  preamble: new Set<string>(),
  item: new Set(["exampleGloss"]),
};

const EXAMPLE_BODY_ACCEPTS: Record<
  ExampleBodyTarget,
  ReadonlySet<string>
> = {
  block: new Set([
    "paragraph",
    "exampleGloss",
    "bulletList",
    "orderedList",
    "graphicsBlock",
    "displayMath",
  ]),
  preamble: new Set([
    "paragraph",
    "exampleGloss",
    "bulletList",
    "orderedList",
    "graphicsBlock",
  ]),
  item: new Set(["paragraph", "graphicsBlock", "displayMath", "exampleGloss"]),
};

/** A byte-literal CARRIER paragraph holding raw source the target schema
 *  cannot represent (task 350 C; the shape task 342 made the DEFAULT for
 *  unmodeled environments, and 347 for comments).
 *
 *  `verbatimMark` rather than the raw-LaTeX mark, for 342's reason: what the
 *  system does not model, nothing downstream is entitled to REWRITE — the
 *  raw-LaTeX mark still runs `smartenStraightQuotes`, which would turn a
 *  carried `\begin{quote}`'s `"…"` into `` `` ``…`'' `` on the first save. */
function exampleBodyCarrierParagraph(
  raw: string,
  uuid?: unknown,
): JSONContent {
  return {
    type: "paragraph",
    ...(typeof uuid === "string" && uuid ? { attrs: { uuid } } : {}),
    content: [{ type: "text", text: raw, marks: [verbatimMark()] }],
  };
}

/** Parse an example body fragment (between `\ex`/`\pex` and `\xe`, or between
 *  consecutive `\a` markers) as a sequence of blocks the `target` container can
 *  hold.
 *
 *  **Nothing is ever dropped.** A child whose type the target cannot accept is
 *  CARRIED as a byte-literal paragraph cut from the ORIGINAL SOURCE — the span
 *  `parseBody` recorded for it. Before task 350 this function had a whitelist
 *  `if`, two rescue branches (`codeBlock` → task 264, `latexComment` → task
 *  347) and **no `else`**, so `heading`, `blockquote`, `figureBlock`,
 *  `texBlock`, `horizontalRule`, `titleField`, a NESTED `exampleBlock` and a
 *  `displayMath` in a `\pex` preamble all fell off the end of the loop and out
 *  of the user's document — silently, on the first save, with no edit. Making
 *  the DEFAULT what the two rescues do (342's rule) fixes every block kind the
 *  builder will ever fail to model, including ones that don't exist yet.
 *
 *  The two rescues stay: each re-emits its construct's CANONICAL form (through
 *  `wrapVerbatimEnvBody`, and with the `% ` prefix re-added) and preserves the
 *  node's uuid, which a raw slice would only reproduce by luck. */
function parseExampleBodyAsBlocks(
  body: string,
  opts: { target: ExampleBodyTarget },
): JSONContent[] {
  const sub: JSONContent = { type: "__scratch", content: [] };
  const subCtx: ParseContext = { pos: 0, src: body };
  const spans: SourceSpanMap = new Map();
  parseBody(subCtx, sub, spans);
  const accepts = EXAMPLE_BODY_ACCEPTS[opts.target];
  const acceptsOnce = EXAMPLE_BODY_ACCEPTS_ONCE[opts.target];
  // A once-only type that appears more than once is demoted to "cannot be
  // accepted at all" for this body — see the constant's own note on why
  // keeping the first oscillates.
  const overSubscribed = new Set<string>();
  for (const kind of acceptsOnce) {
    let n = 0;
    for (const child of sub.content || []) if (child.type === kind) n++;
    if (n > 1) overSubscribed.add(kind);
  }
  const out: JSONContent[] = [];
  // Carry a span at most once. MEASURED and stated rather than implied: no
  // branch of `parseBody` pushes more than one child in a single iteration
  // today — instrumented across the whole suite, zero hits — so this guard has
  // no reachable trigger. It stays because "at most one push per iteration" is
  // an unenforced property of some twenty branches, and the failure it
  // prevents is not a wrong render but byte DUPLICATION on every save:
  // unbounded growth of the user's file, in the one place that exists to stop
  // the file being damaged.
  let lastCarriedStart = -1;
  for (const child of sub.content || []) {
    const kind = child.type ?? "";
    if (accepts.has(kind) && !overSubscribed.has(kind)) {
      out.push(child);
      continue;
    }
    if (child.type === "codeBlock") {
      // An example item's schema has no `codeBlock` slot, so a `verbatim`
      // block inside one used to be DROPPED here — silently, losing the
      // user's code on the first save. Preserve it as the same byte-literal
      // CARRIER paragraph the top-level parser already gives the other
      // `VERBATIM_ENVS_FULL` members (task 264): the whole
      // `\begin{verbatim}…\end{verbatim}` re-wrapped through the shared
      // `wrapVerbatimEnvBody` SSOT — never a third private copy of the
      // sentinel-escape rule — and marked so no serializer runs typography
      // over it.
      out.push({
        type: "paragraph",
        ...(child.attrs?.uuid ? { attrs: { uuid: child.attrs.uuid } } : {}),
        content: [
          {
            type: "text",
            text: wrapVerbatimEnvBody(
              (child.content ?? []).map((c) => c.text ?? "").join(""),
            ),
            marks: [verbatimMark()],
          },
        ],
      });
      continue;
    }
    if (child.type === "latexComment") {
      // An example item's schema has no `latexComment` slot, so a `%` line
      // inside an `\ex`/`\pex` body was DROPPED here — silently deleting the
      // user's writing on the first save, while `itemize`, `quote` and
      // `figure` all preserved theirs (task 347). Preserve it as the same
      // byte-literal CARRIER paragraph the `codeBlock` branch above already
      // uses, on the comment carrier this time, so it re-emits as the exact
      // `% …` line it was read from and lands back here as a fixed point.
      //
      // The `% ` prefix is re-added because the block parser strips it when it
      // builds the node's text — this is the inverse of that read, and it is
      // the same pair the serializer's `latexComment` case emits.
      const commentText = (child.content ?? []).map((c) => c.text ?? "").join("");
      out.push({
        type: "paragraph",
        ...(child.attrs?.uuid ? { attrs: { uuid: child.attrs.uuid } } : {}),
        content: [
          {
            type: "text",
            text: `% ${commentText}`,
            marks: [commentTailMark()],
          },
        ],
      });
      continue;
    }
    // DEFAULT — carry the original bytes (task 350 C).
    //
    // The old fallback re-emitted `body.trim()` — the WHOLE body — as a
    // latex-command paragraph, which leaked every `\vfid{}` / `\vcid{}` marker
    // back into the source verbatim and doubled the matched
    // footnotes/citations on every save → reload. That is why it was deleted
    // and nothing put in its place. The span is what makes a carrier possible
    // without that cost: it is THIS CHILD's bytes, not the body's, so a
    // sibling paragraph's markers are not re-emitted alongside it.
    //
    // A child with no recorded span is unreachable — every top-level child of
    // a span-recording `parseBody` gets one. If it ever did happen we DROP it,
    // which is the pre-350 defect, and that is the least-bad of three bad
    // options rather than an oversight: pushing the unmountable child instead
    // would hand TipTap a schema mismatch, which `createNodeFromContent`
    // SWALLOWS into an empty document (AGENTS.md "Capture/schema symmetry") —
    // a blank paper rather than one lost construct. And a drop here is not
    // silent any more: the load-writeback preservation gate (task 350 D)
    // weighs the serialized output against the source and REFUSES the write,
    // so the user's `.tex` stays byte-identical.
    const span = spans.get(child);
    if (!span) continue;
    if (span.start === lastCarriedStart) continue;
    lastCarriedStart = span.start;
    const raw = body.slice(span.start, span.end).trimEnd();
    if (!raw) continue;
    out.push(exampleBodyCarrierParagraph(raw, child.attrs?.uuid));
  }
  return out;
}

/**
 * Parse a `\begingl … \endgl` body into an `exampleGloss` node with
 * `alignedGlossRow` + `proseGlossRow` children — or `null` to REFUSE, which
 * the caller answers by carrying the whole construct's bytes (task 356's rule:
 * carry the environment, or refuse; never keep the fraction you recognise).
 *
 * Two things about this scan are load-bearing, both task 378:
 *
 * **SCAN PROJECTED, SLICE RAW.** The tier markers are found in
 * `projectStructuralLatex(body)` — inert bytes blanked to spaces, offsets
 * preserved — while every segment is sliced out of the RAW body, so a marker
 * the compiler never sees cannot mint a tier and no carried byte is ever taken
 * from the projection. That asymmetry is the same one task 345 states for the
 * requirement declarer, and it is what a REGEX scan needs where the sibling
 * splitters get by with `skipLineCommentAt` inside their own byte walk. Before
 * it, a `% \glb old //` minted a spurious LIVE tier.
 *
 * **AND THE TIER REGION MUST BE ENTIRELY LIVE, or the gloss is REFUSED.**
 * Declining to mint the tier is only half the answer: a tier's segment is
 * TOKENIZED INTO CELLS, not carried, so inert bytes left inside one come back
 * as columns — the orphaned `%` above became an extra `glossCell` in the row
 * before it, silently changing the alignment the tier notation exists to
 * express, and the result was not even a fixed point. A row node has no slot
 * for bytes it does not model and inventing one per row would be guessing which
 * tier a free-standing comment belongs to, so the honest answer is task 356's:
 * carry the whole environment. The test is the projection's own divergence from
 * the raw body at or after the first marker, which covers a comment (line- or
 * mid-line), a `\verb` run and a verbatim body with one rule instead of three.
 * The PRE-marker region is exempt because it does have a slot — see below.
 *
 * **THE PRE-FIRST-MARKER BYTES ARE CARRIED.** Segments run from one marker to
 * the next, so `[0, markers[0].start)` used to be read by nothing and the node
 * carried no field for it: a `% Mandarin, adapted from Li (2005)` line — or any
 * other unmodeled bytes an author put between `\begingl` and the first `\gla`
 * — was simply GONE from the `.tex` on the first save. It rides `glossPreamble`
 * now, raw and opaque, exactly as a list's `listPreamble` already carried the
 * analogous pre-`\item` prefix. The asymmetry that made this unarguable: the
 * same comment SURVIVES one line above the gloss, where
 * `parseExampleBodyAsBlocks` explicitly carries a comment child.
 */
function buildGlossFromBody(
  body: string,
  glossOptions: string | null = null,
): JSONContent | null {
  const rows: JSONContent[] = [];
  // Split on \gla / \glb / \glc / \glft / \glpreamble markers at block-start.
  const tierPattern = /\\gl(a|b|c|ft|preamble)\b/g;
  // The projected view — SCANNED, never sliced. Same length as `body` by the
  // primitive's own contract, so `m.index` is an index into `body`.
  const scan = projectStructuralLatex(body);
  const markers: Array<{ tier: string; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = tierPattern.exec(scan)) !== null) {
    const tier =
      m[1] === "a"
        ? "gla"
        : m[1] === "b"
          ? "glb"
          : m[1] === "c"
            ? "glc"
            : m[1] === "ft"
              ? "glft"
              : "glpreamble";
    markers.push({ tier, start: m.index, end: m.index + m[0].length });
  }
  for (let i = 0; i < markers.length; i++) {
    const cur = markers[i];
    const next = markers[i + 1];
    // unterminated-ok: `body` is the already-bounded `\begingl … \endgl` body,
    // and the LAST tier's segment runs to its end by construction — there is no
    // outer content for this slice to reach.
    let segment = body.slice(cur.end, next ? next.start : body.length);
    // Strip the trailing `//` terminator if present.
    segment = segment.replace(/\s*\/\/\s*$/, "").trim();
    if (cur.tier === "gla" || cur.tier === "glb" || cur.tier === "glc") {
      rows.push({
        type: "alignedGlossRow",
        attrs: { tier: cur.tier },
        content: tokenizeGlossCells(segment),
      });
    } else {
      // prose row — inline content
      rows.push({
        type: "proseGlossRow",
        attrs: { tier: cur.tier },
        content: parseInlineContent(segment),
      });
    }
  }
  // The tier region is tokenized, so it must hold no bytes the compiler cannot
  // see. Any divergence between the projection and the raw body at or after the
  // first marker is an inert span that would come back as spurious CELLS —
  // refuse and let the caller carry the construct whole.
  if (markers.length > 0) {
    for (let i = markers[0].start; i < body.length; i++) {
      if (scan[i] !== body[i]) return null;
    }
  }
  // NO tier marker anywhere — REFUSE rather than substitute an empty `\gla`
  // row (task 378, the M4 sibling; task 356's rule, and the exact shape
  // `splitListItems` had for an item-less list body). Measured on the pre-fix
  // tree: `\begingl\nsome unmodelled text here\n\endgl` round-tripped to
  // `\begingl\n\gla  //\n\endgl` — every byte of the body destroyed, on
  // WELL-FORMED input, so no fail-closed arm could have caught it. The caller
  // restores its cursor to the `\begingl` and carries the construct whole.
  if (rows.length === 0) return null;
  // Initial colCount — recomputed live by the numbering plugin.
  let maxCells = 1;
  for (const r of rows) {
    if (r.type === "alignedGlossRow" && r.content) {
      if (r.content.length > maxCells) maxCells = r.content.length;
    }
  }
  // Everything before the first tier marker, raw. `trimEnd` only: the leading
  // newline after `\begingl` is the serializer's own separator (it re-emits
  // one), while the trailing newline before the first `\gla` is likewise
  // re-added by the join — so the round trip is a FIXED POINT from cycle 1.
  const glossPreamble = markers[0].start > 0
    ? body.slice(0, markers[0].start).trim()
    : null;
  return {
    type: "exampleGloss",
    attrs: {
      glossId: null,
      colCount: maxCells,
      glossOptions,
      ...(glossPreamble ? { glossPreamble } : {}),
    },
    content: rows,
  };
}

/** Tokenize one aligned gloss line (post-marker, pre-`//` terminator) into
 *  `glossCell` nodes. Whitespace separates tokens; `{...}` groups a
 *  multi-word cell. */
function tokenizeGlossCells(text: string): JSONContent[] {
  const cells: JSONContent[] = [];
  const src = text.trim();
  let i = 0;
  while (i < src.length) {
    // Skip whitespace between tokens
    while (i < src.length && /\s/.test(src[i])) i++;
    if (i >= src.length) break;
    let token = "";
    if (src[i] === "{") {
      // Balanced group — take the whole contents
      const inner = extractBraced(src, i);
      if (inner) {
        token = inner.content;
        i = inner.end;
      } else {
        // unterminated-ok: an unbalanced `{` in a gloss line takes the rest of
        // THAT LINE into the cell — `src` is one already-bounded tier segment,
        // and the bytes are kept rather than dropped.
        token = src.slice(i);
        i = src.length;
      }
    } else {
      // Non-whitespace run up to the next top-level space. A `{...}` group
      // opened mid-token (e.g. after `\textbf`) is consumed to its matching
      // brace so a space *inside* the argument (`\textbf{a b}`) doesn't sever
      // the cell — only a brace-depth-0 space terminates the token. Mirrors
      // expex, which splits aligned words on brace-depth-0 spaces only.
      const start = i;
      while (i < src.length && !/\s/.test(src[i])) {
        if (src[i] === "{") {
          const inner = extractBraced(src, i);
          if (inner) {
            i = inner.end;
            continue;
          }
        }
        i++;
      }
      token = src.slice(start, i);
    }
    cells.push({
      type: "glossCell",
      content: parseInlineContent(token),
    });
  }
  return cells;
}
