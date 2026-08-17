import { JSONContent } from "@tiptap/react";
import type { VirgilSidecar } from "@/lib/types";
import { richLatexToJson } from "@/lib/footnote-content";
import { matchCiteCommandAt } from "@/lib/cite-commands";
import { generateShortId, NODE_UUID_ANCHOR, NODE_UUID_REGEX } from "@/lib/uuid";
import { collectExampleBodyLabelsJSON } from "@/lib/example-refs";
import {
  BLOCK_TEX_MARKERS,
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
} from "@/lib/latex-typography";
import {
  extractBraced,
  extractBracketed,
  findMatchingEnv,
  findMatchingGloss,
  findMatchingXe,
  isEscaped,
  findUnescaped,
  matchBeginEnvAt,
  matchCommandToken,
  matchInlineMathAt,
  matchInlineVerbAt,
  skipOpaqueConstructAt,
  unwrapVerbatimEnvBody,
  verbatimMark,
  wrapVerbatimEnvBody,
} from "@/lib/latex-lexer";

/**
 * Commands whose appearance at the head of a line ENDS the paragraph being
 * read. Hoisted to module scope so it compiles once (it is tested per
 * paragraph-continuation candidate), and built rather than spelled because
 * Virgil's own block-position markers belong in it: absorb a `\vexid`/`\vxid`
 * into the preceding paragraph and the next save re-emits it as literal text,
 * accumulating one stray marker per round trip. Their names come from the
 * vocabulary SSOT ([latex-markers.ts](latex-markers.ts)), so a future
 * block-position marker joins this boundary set by declaring itself.
 */
const BLOCK_BOUNDARY_COMMAND_RE = new RegExp(
  "^\\\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph|" +
    "begin|end|\\[|hrulefill|title|author|date|maketitle|includegraphics|" +
    "noindent|vspace|hspace|newcounter|setcounter|renewcommand|newcommand|" +
    "usepackage|bibliographystyle|bibliography|tableofcontents|appendix|" +
    "clearpage|newpage|par|ex|pex|xe|" +
    BLOCK_TEX_MARKERS.map((m) => m.command).join("|") +
    "|begingl|endgl)\\b",
);

interface ParseContext {
  pos: number;
  src: string;
  /** Stashed example id from a preceding `\vexid{uuid}`. Consumed by
   *  the next `\ex` / `\pex` block. */
  pendingExampleId?: string | null;
}

function stripPreamble(latex: string): string {
  const beginDoc = latex.indexOf("\\begin{document}");
  const endDoc = latex.indexOf("\\end{document}");
  if (beginDoc !== -1) {
    const start = beginDoc + "\\begin{document}".length;
    const end = endDoc !== -1 ? endDoc : latex.length;
    return latex.slice(start, end).trim();
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
  const beginDoc = latex.indexOf("\\begin{document}");
  if (beginDoc === -1) return null;
  const endDoc = latex.indexOf("\\end{document}");
  const rawPreamble = latex.slice(0, beginDoc);
  const strippedPreamble = stripTitleFieldsFromText(rawPreamble);
  const preamble = strippedPreamble + "\\begin{document}\n\n";
  const postamble =
    endDoc !== -1
      ? "\n" + latex.slice(endDoc).replace(/\n*$/, "\n")
      : "\n\\end{document}\n";
  return { preamble, postamble };
}

/**
 * Remove `\title{…}`, `\author{…}`, `\date{…}` commands from a LaTeX
 * string. Matching follows the parser rules (balanced braces, allows
 * optional `%!v:xxxx` UUID anchor right after the closing brace).
 * Collapses the whitespace left behind so the result stays tidy.
 */
function stripTitleFieldsFromText(text: string): string {
  let result = "";
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    const m = rest.match(/^\\(title|author|date)\{/);
    if (m) {
      const bracedStart = i + m[0].length - 1;
      const inner = extractBraced(text, bracedStart);
      if (inner) {
        let end = inner.end;
        const afterMatch = text.slice(end).match(NODE_UUID_ANCHOR);
        if (afterMatch) end += afterMatch[0].length;
        // Swallow one trailing newline so we don't leave blank rows.
        if (text[end] === "\n") end++;
        i = end;
        continue;
      }
    }
    result += text[i];
    i++;
  }
  return result;
}

/**
 * Parse `\title{…}` / `\author{…}` / `\date{…}` commands from a
 * preamble string into `titleField` nodes. Used so that title commands
 * placed before `\begin{document}` are still visible and editable in
 * the editor.
 *
 * Note: titleField nodes are ALWAYS treated as preamble-bound by the
 * serializer (it walks the whole doc and re-emits them in canonical
 * order into the preamble). The earlier per-node `fromPreamble` flag
 * was retired — flag fragility was a bug source (any HTML round-trip
 * would drop it, and the next save would mis-emit to body).
 */
function parsePreambleTitleFields(preamble: string): JSONContent[] {
  const nodes: JSONContent[] = [];
  const seen = new Set<string>();
  let i = 0;
  while (i < preamble.length) {
    const rest = preamble.slice(i);
    const m = rest.match(/^\\(title|author|date)\{/);
    if (!m) {
      i++;
      continue;
    }
    const field = m[1];
    if (seen.has(field)) {
      // Skip duplicate — still advance past the command to avoid re-matching.
      i += m[0].length;
      continue;
    }
    const bracedStart = i + m[0].length - 1;
    const inner = extractBraced(preamble, bracedStart);
    if (!inner) {
      i++;
      continue;
    }
    seen.add(field);
    let pos = inner.end;
    const afterTitle = preamble.slice(pos);
    const uuidMatch = afterTitle.match(NODE_UUID_ANCHOR);
    let uuid: string | null = null;
    if (uuidMatch) {
      uuid = uuidMatch[1];
      pos += uuidMatch[0].length;
    }
    let rawContent = inner.content;
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
    nodes.push({
      type: "titleField",
      attrs: { field, rawPrefix: rawPrefix || null, isToday, uuid },
      content: parseInlineContent(rawContent),
    });
    i = pos;
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
 */
export function parseInlineContent(
  text: string,
  inCode = false,
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
    // LaTeX double-quote pairs → smart quotes in the display.
    // Lone ` and ' pass through (single-quote LaTeX semantics +
    // apostrophes in contractions are out of scope).
    if (text[i] === "`" && text[i + 1] === "`") {
      buffer += "“";
      i += 2;
      continue;
    }
    if (text[i] === "'" && text[i + 1] === "'") {
      buffer += "”";
      i += 2;
      continue;
    }

    // Protected prose brackets: `{[}` / `{]}` → literal `[` / `]` (task 037's
    // `$` twin). The serializer wraps a prose `[`/`]` in its own brace group so
    // it can't be absorbed as a LaTeX optional argument (`\\[len]`,
    // `\cmd[opt]`); here we unwrap it back to a bare glyph in the buffer, so
    // adjacent letters stay one text node. Not gated on `inCode`: inline-code
    // (`\texttt`) prose is escaped the same way and must round-trip
    // identically. Genuine structural brackets never reach this inline scanner
    // as the literal triple `{[}` — they live on latexCommand / texBlock /
    // example paths.
    //
    // The spellings come from `CHAR_ESCAPE_TABLE` (task 339) — the same table
    // the serializer's escape rung reads — so the `protect` members cannot
    // drift from their emit side. Guarded on `{` so this can only ever match a
    // protection here; the `escape` family is matched from the `\` branch below
    // at the position it has always been matched, after the command rules.
    if (text[i] === "{") {
      const prot = matchCharEscapeAt(text, i);
      if (prot) {
        buffer += prot.char;
        i = prot.end;
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
          const innerNodes = parseInlineContent(inner.content);
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
          const innerNodes = parseInlineContent(inner.content);
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
          const innerNodes = parseInlineContent(inner.content);
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
          const innerNodes = parseInlineContent(inner.content);
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
          // accent commands stay raw) — memo §A exclusion.
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
          const innerNodes = parseInlineContent(inner.content);
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

      // \footnote{...}
      const fnMatch = rest.match(/^\\footnote\{/);
      if (fnMatch) {
        flush();
        const inner = extractBraced(text, i + "\\footnote".length);
        if (inner !== null) {
          nodes.push({
            type: "footnote",
            attrs: {
              content: richLatexToJson(inner.content),
              number: 0,
              footnoteId: pendingFootnoteId.take(i) || generateShortId(),
            },
          });
          i = inner.end;
          continue;
        }
      }

      // \thanks{...} — title-page acknowledgement; reuses the footnote node
      // with thanks=true so it threads through the footnote panel/omni-view.
      const thanksMatch = rest.match(/^\\thanks\{/);
      if (thanksMatch) {
        flush();
        const inner = extractBraced(text, i + "\\thanks".length);
        if (inner !== null) {
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
      if (cite) {
        flush();
        if (cite.keyed) {
          nodes.push({
            type: "citation",
            attrs: {
              citationId: pendingCitationId.take(i) || generateShortId(),
              command: cite.command,
              displayText: "",
            },
          });
        } else {
          // No braced arg — treat as unknown text (will be raw).
          buffer += cite.command;
        }
        i = cite.end;
        continue;
      }

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
      const textCmdMatch = rest.match(/^\\(ldots|dots|LaTeX|TeX)\b/);
      if (textCmdMatch) {
        const cmd = textCmdMatch[1];
        if (cmd === "ldots" || cmd === "dots") buffer += "\u2026";
        else if (cmd === "LaTeX") buffer += "LaTeX";
        else if (cmd === "TeX") buffer += "TeX";
        i += textCmdMatch[0].length;
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

      // \\  -> hard break
      if (rest.startsWith("\\\\")) {
        flush();
        nodes.push({ type: "hardBreak" });
        i += 2;
        // skip optional newline
        if (i < text.length && text[i] === "\n") i++;
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
        let cmdText = "\\" + unknownCmd.name;
        i = unknownCmd.end;
        // Consume optional starred
        if (i < text.length && text[i] === "*") {
          cmdText += "*";
          i++;
        }
        // Consume optional [...] args
        while (i < text.length && text[i] === "[") {
          const closeBracket = text.indexOf("]", i);
          if (closeBracket !== -1) {
            cmdText += text.slice(i, closeBracket + 1);
            i = closeBracket + 1;
          } else {
            break;
          }
        }
        // Consume {braced} args (up to 2) — but NEVER a protected prose
        // bracket group `{[}`/`{]}` (the `escapeLatex` sentinel for a literal
        // `[`/`]`). Those are prose that merely ABUTS the command, not an
        // argument to it: breaking here lets the command atom close and returns
        // control to the top-of-loop `{[}`→`[` unwrap, so `\cmd{[}x{]}` keeps
        // `[x]` as literal prose instead of folding `[` into the command.
        let braceCount = 0;
        while (i < text.length && text[i] === "{" && braceCount < 2) {
          // "Is the group at `i` a protection?" is a question about the
          // vocabulary, so it is asked of `CHAR_ESCAPE_TABLE` rather than
          // re-spelled here (task 339) — this was the THIRD hand copy of the
          // `{[}` / `{]}` shape, and a fourth spelling of a protection would
          // silently fold prose into a command argument again.
          const prot = matchCharEscapeAt(text, i);
          if (prot) break;
          const inner = extractBraced(text, i);
          if (inner) {
            cmdText += "{" + inner.content + "}";
            i = inner.end;
            braceCount++;
          } else {
            break;
          }
        }
        nodes.push({
          type: "text",
          text: cmdText,
          marks: [{ type: "latexCommand" }],
        });
        continue;
      }

      // Lone backslash (shouldn't normally happen) — preserve it
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
  const body = stripPreamble(latex);
  const doc: JSONContent = { type: "doc", content: [] };

  // Hoist \title/\author/\date from the preamble into the doc tree so
  // they're visible and editable in the editor. Mark seen fields so the
  // body parser doesn't emit duplicates if the same command appears
  // again below \begin{document}.
  const beginDoc = latex.indexOf("\\begin{document}");
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

function mergeSidecarTitles(node: JSONContent, sidecar: VirgilSidecar): void {
  const TITLED = new Set(["paragraph", "bulletList", "orderedList", "texBlock"]);
  if (TITLED.has(node.type!) && node.attrs?.uuid) {
    const meta = sidecar.paragraphs[node.attrs.uuid as string];
    if (meta?.title) {
      node.attrs.parTitle = meta.title;
    }
    if (meta?.collapsed && node.type === "texBlock") {
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

function parseBody(ctx: ParseContext, parent: JSONContent): void {
  if (!parent.content) parent.content = [];

  while (ctx.pos < ctx.src.length) {
    skipWhitespace(ctx);
    if (ctx.pos >= ctx.src.length) break;

    const rest = ctx.src.slice(ctx.pos);

    // \part{...}, \chapter{...}, \section{...}, \subsection{...}, \subsubsection{...},
    // \paragraph{...}, \subparagraph{...} — and starred variants.
    const sectionMatch = rest.match(/^\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)(\*?)\{/);
    if (sectionMatch) {
      const HEADING_LEVELS: Record<string, number> = {
        part: 0,
        chapter: 1,
        section: 2,
        subsection: 3,
        subsubsection: 4,
        paragraph: 5,
        subparagraph: 6,
      };
      const level = HEADING_LEVELS[sectionMatch[1]];
      const numbered = sectionMatch[2] !== "*";
      ctx.pos += sectionMatch[0].length - 1; // position at {
      const inner = extractBraced(ctx.src, ctx.pos);
      if (inner) {
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
        if (uuid) attrs.uuid = uuid;
        parent.content.push({
          type: "heading",
          attrs,
          content: parseInlineContent(inner.content),
        });
        continue;
      }
    }

    // \title{...}, \author{...}, \date{...} — only first occurrence of each
    const titleFieldMatch = rest.match(/^\\(title|author|date)\{/);
    if (titleFieldMatch && !seenTitleFields.has(titleFieldMatch[1])) {
      const field = titleFieldMatch[1];
      seenTitleFields.add(field);
      ctx.pos += titleFieldMatch[0].length - 1; // position at {
      const inner = extractBraced(ctx.src, ctx.pos);
      if (inner) {
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
        parent.content.push({
          type: "titleField",
          attrs: { field, rawPrefix: rawPrefix || null, isToday, uuid: titleUuid },
          content: parseInlineContent(rawContent),
        });
        continue;
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

    // \ex / \pex … \xe  — expex single or multi-part example block.
    const exStartMatch = rest.match(/^\\(ex|pex)(~?)/);
    if (exStartMatch) {
      const kind = exStartMatch[1] === "pex" ? "multi" : "single";
      const suppressSpace = exStartMatch[2] === "~";
      ctx.pos += exStartMatch[0].length;

      // Optional [opts]
      let exnoOverride: string | null = null;
      while (ctx.pos < ctx.src.length && ctx.src[ctx.pos] === "[") {
        const close = ctx.src.indexOf("]", ctx.pos);
        if (close === -1) break;
        const optStr = ctx.src.slice(ctx.pos + 1, close);
        const exnoMatch = optStr.match(/exno\s*=\s*([^,\s]+)/);
        if (exnoMatch) exnoOverride = exnoMatch[1];
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
          ctx.pos += optsMatch[0].length;
          continue;
        }
        break;
      }

      // Consume the body up to the matching \xe (handling nested \ex/\pex).
      const bodyStart = ctx.pos;
      const bodyEnd = findMatchingXe(ctx.src, bodyStart);
      const bodyText =
        bodyEnd !== -1 ? ctx.src.slice(bodyStart, bodyEnd) : ctx.src.slice(bodyStart);
      ctx.pos = bodyEnd !== -1 ? bodyEnd + "\\xe".length : ctx.src.length;

      const uuid = ctx.pendingExampleId || null;
      ctx.pendingExampleId = null;

      const exampleNode = buildExampleBlockFromBody(bodyText, {
        kind,
        tag,
        label,
        uuid,
        exnoOverride,
        suppressSpace,
      });
      parent.content.push(exampleNode);
      continue;
    }

    // \begingl … \endgl — expex interlinear gloss block (top-level or
    // nested inside an ex/pex body).
    const beginGlMatch = rest.match(/^\\begingl\b/);
    if (beginGlMatch) {
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
      const bodyText =
        endIdx !== -1 ? ctx.src.slice(bodyStart, endIdx) : ctx.src.slice(bodyStart);
      ctx.pos = endIdx !== -1 ? endIdx + "\\endgl".length : ctx.src.length;
      const glossNode = buildGlossFromBody(bodyText, glossOptions);
      parent.content.push(glossNode);
      continue;
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
      const optMatch = ctx.src.slice(beginAt.end).match(/^\[[^\]]*\]/);
      const optArg = optMatch ? optMatch[0] : "";
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
      const envContent =
        envEnd !== -1
          ? ctx.src.slice(ctx.pos, envEnd)
          : ctx.src.slice(ctx.pos);
      ctx.pos = envEnd !== -1 ? envEnd + `\\end{${env}}`.length : ctx.src.length;

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
        case "itemize": {
          const listNode = parseList(envContent, "bulletList");
          if (envUuid) {
            if (!listNode.attrs) listNode.attrs = {};
            listNode.attrs.uuid = envUuid;
          }
          parent.content.push(listNode);
          break;
        }
        case "enumerate": {
          const listNode = parseList(envContent, "orderedList");
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
              numbered: true,
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
          parent.content.push({
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
      continue;
    }

    // % comment line
    if (rest.startsWith("%")) {
      // %!vtex:begin <uuid> ... raw LaTeX ... %!vtex:end <uuid>
      // Round-trip marker for the texBlock node. Contents are slurped
      // verbatim — do NOT recurse into parseBody, the whole point is to
      // hold raw LaTeX the editor doesn't try to render.
      const texBeginMatch = rest.match(/^%!vtex:begin[ \t]+([0-9a-f]+)/);
      if (texBeginMatch) {
        const uuid = texBeginMatch[1];
        const eolAfterBegin = ctx.src.indexOf("\n", ctx.pos);
        if (eolAfterBegin === -1) {
          // Malformed: begin marker with no newline. Skip the line.
          ctx.pos = ctx.src.length;
          continue;
        }
        const bodyStart = eolAfterBegin + 1;
        const endMarker = `%!vtex:end ${uuid}`;
        const endIdx = ctx.src.indexOf(endMarker, bodyStart);
        let bodyEnd: number;
        let advanceTo: number;
        if (endIdx === -1) {
          // Unterminated. Recover by treating the rest of the source as body.
          bodyEnd = ctx.src.length;
          advanceTo = ctx.src.length;
        } else {
          bodyEnd = endIdx;
          // Trim the single newline the serializer always emits before the end marker.
          if (bodyEnd > bodyStart && ctx.src[bodyEnd - 1] === "\n") bodyEnd--;
          const eolAfterEnd = ctx.src.indexOf("\n", endIdx);
          advanceTo = eolAfterEnd === -1 ? ctx.src.length : eolAfterEnd + 1;
        }
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
          const eolPos = eol !== -1 ? eol : ctx.src.length;
          const trailing = ctx.src.slice(afterUuidPos, eolPos);
          if (!trailing.trim()) {
            ctx.pos = eol !== -1 ? eol + 1 : ctx.src.length;
            parent.content.push({ type: "paragraph", attrs: { uuid: lineMatch[1] } });
            continue;
          }
        }
        // Skip UUID anchor comments silently
        ctx.pos = eol !== -1 ? eol + 1 : ctx.src.length;
        continue;
      }
      const eol = ctx.src.indexOf("\n", ctx.pos);
      const rawComment = eol !== -1
        ? ctx.src.slice(ctx.pos + 1, eol).trim()
        : ctx.src.slice(ctx.pos + 1).trim();
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
          const content = parseInlineContent(paraText);
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
      const content = parseInlineContent(paraText);
      if (content.length > 0) {
        const node: JSONContent = { type: "paragraph", content };
        if (uuid) node.attrs = { uuid };
        parent.content.push(node);
      }
    }
  }
}

/** Strip trailing %!v:xxxx anchor(s) from paragraph text, return text + uuid (last one wins) */
function stripUuidAnchor(text: string): { text: string; uuid: string | null } {
  // Match one or more %!v:xxxx markers at the end of the line
  const match = text.match(/(\s*(?:%!v:[0-9a-f]{4}\s*)+)$/);
  if (match) {
    const cleaned = text.slice(0, match.index).trimEnd();
    // Extract the last UUID from the matched markers
    const uuids = [...match[1].matchAll(new RegExp(NODE_UUID_REGEX.source, "g"))];
    const lastUuid = uuids.length > 0 ? uuids[uuids.length - 1][1] : null;
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
  // Extract preamble: everything before the first \item, trimmed
  const preamble = firstItemPos > 0 ? content.slice(0, firstItemPos).trim() : "";
  return { items, preamble };
}

// Trailing `%!v:xxxx` marker on a list item's body. Captures the UUID
// after stripping the marker so the inner text isn't polluted.
const ITEM_TRAILING_UUID_REGEX = /[ \t]*%!v:([0-9a-f]{4})\s*$/;

function parseList(content: string, type: string): JSONContent {
  const items: JSONContent[] = [];
  const { items: itemTexts, preamble } = splitListItems(content);

  for (const slice of itemTexts) {
    // Pull off a trailing `%!v:xxxx` per-item marker if present. Stripped
    // before parsing so the marker doesn't leak into the rendered text.
    let itemUuid: string | null = null;
    let itemText = slice.text;
    const m = itemText.match(ITEM_TRAILING_UUID_REGEX);
    if (m) {
      itemUuid = m[1];
      itemText = itemText.slice(0, m.index).trimEnd();
    }

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
  while (ctx.pos < ctx.src.length) {
    // Double newline ends paragraph
    if (ctx.src[ctx.pos] === "\n" && ctx.pos + 1 < ctx.src.length && ctx.src[ctx.pos + 1] === "\n") {
      ctx.pos += 2;
      break;
    }

    // Break at % comment lines (only if at start of line)
    if (ctx.src[ctx.pos] === "%" && result.trim()) {
      // Check if this is at start of a line
      const prevChar = ctx.pos > 0 ? ctx.src[ctx.pos - 1] : "\n";
      if (prevChar === "\n") {
        break;
      }
    }

    // Check if next non-space char is a block-level command
    if (ctx.src[ctx.pos] === "\\" && result.trim() && braceDepth === 0) {
      const rest = ctx.src.slice(ctx.pos);
      if (
        // `\[` opens display math — always a block boundary. Checked
        // separately because the trailing `\b` below never fires after the
        // non-word `[` (so `\[` followed by whitespace/newline, e.g. a
        // serialized `\[\n…`, would otherwise be absorbed into the paragraph).
        // Feature A1 relies on this so a paragraph + equation in one
        // exampleItem round-trips with the equation as its own displayMath.
        rest.startsWith("\\[") ||
        // `\includegraphics` is a block boundary too — the picture-side twin of
        // the `\[` case above (Feature A2). Without it a serialized
        // `paragraph\n\includegraphics{…}` re-merges, absorbing the picture into
        // the paragraph as literal text and losing the graphicsBlock on reload.
        // (`\b` fires fine here — the word ends before the `[`/`{` argument.)
        BLOCK_BOUNDARY_COMMAND_RE.test(rest)
      ) {
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
    uuid: string | null;
    text: string;
  }>;
} {
  const items: Array<{
    tag: string;
    label: string;
    exnoOverride: string | null;
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
    uuid: string | null;
    start: number;
  } | null = null;

  const flushCurrent = (endPos: number) => {
    if (!current) return;
    items.push({
      tag: current.tag,
      label: current.label,
      exnoOverride: current.exnoOverride,
      uuid: current.uuid,
      text: body.slice(current.start, endPos).trim(),
    });
    current = null;
  };

  while (pos < body.length) {
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
        // Optional [opts]
        let exnoOverride: string | null = null;
        while (cursor < body.length && body[cursor] === "[") {
          const close = body.indexOf("]", cursor);
          if (close === -1) break;
          const optStr = body.slice(cursor + 1, close);
          const m = optStr.match(/exno\s*=\s*([^,\s]+)/);
          if (m) exnoOverride = m[1];
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

function buildExampleBlockFromBody(
  body: string,
  opts: {
    kind: "single" | "multi";
    tag: string;
    label: string;
    uuid: string | null;
    exnoOverride: string | null;
    suppressSpace: boolean;
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
    suppressSpace: opts.suppressSpace,
    number: 0,
  };

  const content: JSONContent[] = [];
  if (opts.kind === "single") {
    // Parse the body as a sequence of paragraphs / glosses / pictures /
    // equations. Feature A2 widens `exampleBlock` to accept graphicsBlock +
    // displayMath directly, so a dropped picture / equation joins a single
    // `\ex` body — pass `allowDisplayMath` so a serialized `\[…\]` survives the
    // reload (graphicsBlock already parses unconditionally). The `\pex`
    // preamble path below stays un-widened (Non-goals §5).
    const inner = parseExampleBodyAsBlocks(body, { allowDisplayMath: true });
    content.push(...inner);
    if (content.length === 0) content.push({ type: "paragraph" });
  } else {
    // \pex — split into preamble + items.
    const { preamble, items } = splitPexBody(body);
    if (preamble) {
      const pNodes = parseExampleBodyAsBlocks(preamble);
      content.push(...pNodes);
    }
    const itemNodes: JSONContent[] = [];
    for (const item of items) {
      itemNodes.push(
        buildExampleItemFromText(
          item.tag,
          item.label,
          item.uuid,
          item.text,
          item.exnoOverride,
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
    content.push({ type: "exampleItemList", content: itemNodes });
  }

  return { type: "exampleBlock", attrs, content };
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
): JSONContent {
  // Slice out any `\begin{xlist}…\end{xlist}` body before parsing the
  // surrounding text as paragraphs/gloss. We keep just the FIRST nested
  // list for schema compliance — multiple xlist environments in the
  // same item are uncommon and would be flattened by re-serializing.
  let nestedList: JSONContent | null = null;
  let stripped = text;
  const xlistOpen = stripped.indexOf("\\begin{xlist}");
  if (xlistOpen !== -1) {
    const innerStart = xlistOpen + "\\begin{xlist}".length;
    const innerEnd = findMatchingEnv(stripped, innerStart, "xlist");
    if (innerEnd !== -1) {
      const innerBody = stripped.slice(innerStart, innerEnd);
      nestedList = buildExampleItemListFromBody(innerBody);
      stripped =
        stripped.slice(0, xlistOpen) +
        stripped.slice(innerEnd + "\\end{xlist}".length);
    }
  }

  const itemContent = parseExampleBodyAsBlocks(stripped, {
    allowDisplayMath: true,
  });
  const normalized: JSONContent[] = [];
  // Head section: (paragraph | graphicsBlock | displayMath)+. Preserve document
  // order so an `\includegraphics` or `\[…\]` between two paragraphs round-trips
  // faithfully (Feature A1 adds displayMath alongside A0's graphicsBlock).
  const head = itemContent.filter(
    (n) =>
      n.type === "paragraph" ||
      n.type === "graphicsBlock" ||
      n.type === "displayMath",
  );
  const glosses = itemContent.filter((n) => n.type === "exampleGloss");
  if (head.length === 0) normalized.push({ type: "paragraph" });
  else normalized.push(...head);
  if (nestedList) normalized.push(nestedList);
  if (glosses.length > 0) normalized.push(glosses[0]);

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

/** Parse an example body fragment (between `\ex`/`\pex` and `\xe`, or between
 *  consecutive `\a` markers) as a sequence of paragraph + gloss blocks.
 *
 *  `opts.allowDisplayMath` lets a `\[…\]` equation survive as a `displayMath`
 *  block — passed ONLY from the `\a` item path (Feature A1), since `exampleItem`
 *  accepts displayMath but the `exampleBlock` itself (single `\ex` bodies, `\pex`
 *  preambles) does NOT. Default false keeps those contexts byte-unchanged. */
function parseExampleBodyAsBlocks(
  body: string,
  opts?: { allowDisplayMath?: boolean },
): JSONContent[] {
  const sub: JSONContent = { type: "__scratch", content: [] };
  const subCtx: ParseContext = { pos: 0, src: body };
  parseBody(subCtx, sub);
  const out: JSONContent[] = [];
  for (const child of sub.content || []) {
    if (
      child.type === "paragraph" ||
      child.type === "exampleGloss" ||
      child.type === "bulletList" ||
      child.type === "orderedList" ||
      child.type === "graphicsBlock" ||
      (opts?.allowDisplayMath && child.type === "displayMath")
    ) {
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
    // Other unknown block types are still dropped. The previous fallback
    // re-emitted `body.trim()` as a latex-command paragraph, which leaked
    // every `\vfid{}` / `\vcid{}` marker back into the source verbatim and
    // doubled the matched footnotes/citations on every save → reload. Known
    // residual, PRE-DATING task 338 and unchanged by it: a nested
    // `itemize`/`enumerate`/`blockquote`/`figure` inside an example item is
    // dropped by this filter or by `buildExampleItemFromText`'s head filter —
    // preserving those needs a per-node re-serialize this leaf cannot reach.
  }
  return out;
}

/** Parse a `\begingl … \endgl` body into an `exampleGloss` node with
 *  `alignedGlossRow` + `proseGlossRow` children. */
function buildGlossFromBody(
  body: string,
  glossOptions: string | null = null,
): JSONContent {
  const rows: JSONContent[] = [];
  // Split on \gla / \glb / \glc / \glft / \glpreamble markers at block-start.
  const tierPattern = /\\gl(a|b|c|ft|preamble)\b/g;
  const markers: Array<{ tier: string; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = tierPattern.exec(body)) !== null) {
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
  if (rows.length === 0) {
    rows.push({ type: "alignedGlossRow", attrs: { tier: "gla" }, content: [] });
  }
  // Initial colCount — recomputed live by the numbering plugin.
  let maxCells = 1;
  for (const r of rows) {
    if (r.type === "alignedGlossRow" && r.content) {
      if (r.content.length > maxCells) maxCells = r.content.length;
    }
  }
  return {
    type: "exampleGloss",
    attrs: { glossId: null, colCount: maxCells, glossOptions },
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
