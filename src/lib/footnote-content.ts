// Footnote and note content live as Tiptap JSONContent — a small subset of
// the main editor's document tree. The content can hold inline formatting
// (bold/italic/underline), citation nodes, inline math, and lists. We store
// JSON so citation node attributes (citationId, command, displayText) survive
// round-tripping cleanly without needing a custom parseHTML for every attr.
//
// Legacy footnote/note content was an HTML string. The migrate helpers below
// promote those old strings to JSON the first time they're read.

import type { JSONContent } from "@tiptap/react";
import { generateShortId } from "@/lib/uuid";
import {
  emitMarker,
  markerArgStart,
  markerOpensAt,
  PendingMarkerId,
  VIRGIL_MARKERS,
} from "@/lib/latex-markers";
import { matchCiteCommandAt } from "@/lib/cite-commands";
import {
  matchAccent,
  matchSpecialLetter,
  dashesToGlyphs,
  typographyToLatex,
  smartenStraightQuotes,
  escapeLatexChars,
  matchCharEscapeAt,
  CHAR_ESCAPE_LEADS,
  matchTextMacroAt,
  matchQuotePairAt,
  QUOTE_PAIR_LEADS,
} from "@/lib/latex-typography";
import {
  findMatchingBrace,
  hasVerbatimMark,
  matchBraceGroupAt,
  matchCommandToken,
  matchCommandArgumentRun,
  matchControlSymbolAt,
  matchInlineMathAt,
  matchInlineVerbAt,
  matchLineBreakAt,
  verbatimMark,
} from "@/lib/latex-lexer";

const HTML_TAG_RE = /<[^>]+>/;

export function looksLikeHtml(s: string): boolean {
  return HTML_TAG_RE.test(s);
}

/**
 * Empty content shape used when a footnote/note has no body yet — a single
 * empty paragraph so the Tiptap editor has somewhere to put the cursor.
 */
export function emptyRichContent(): JSONContent {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

/**
 * Coerce whatever is currently stored on a footnote/note `content` attribute
 * into a Tiptap JSONContent doc. Handles four shapes:
 *   1. A JSONContent doc — used as-is
 *   2. A JSONContent fragment (e.g. {type:"paragraph", ...}) — wrapped in doc
 *   3. An HTML string — parsed into JSON via the lightweight HTML→JSON walker
 *   4. A plain text string — wrapped in a single paragraph
 */
/**
 * Marks that exist ONLY in the main editor's document schema and have no place
 * in a card body / borrowed card surface. Card surfaces (RichTextField,
 * BorrowedMainText) compose the `borrowed-schema` atom set, which deliberately
 * omits these — so JSONContent borrowed from the document (e.g. a cut excerpt,
 * a revision's original paragraph, or any prose a card quotes) that still
 * carries one of these marks would make the card editor's `setContent` /
 * creation throw ("There is no mark type X in this schema") and render BLANK.
 * `linkedAnchor` is the doc-level note/highlight/cut/revision anchor mark —
 * meaningless inside a card body — so we strip it here, at the one normalizer
 * both card surfaces funnel content through.
 */
const DOC_ONLY_MARKS = new Set<string>(["linkedAnchor"]);

/**
 * Recursively drop {@link DOC_ONLY_MARKS} from a JSONContent tree. Clones only
 * the nodes that actually change (the source — often the live card content —
 * is never mutated); returns the input unchanged when there is nothing to strip.
 */
function stripDocOnlyMarks(node: JSONContent): JSONContent {
  let nextMarks = node.marks;
  if (nextMarks && nextMarks.some((m) => DOC_ONLY_MARKS.has(m.type))) {
    nextMarks = nextMarks.filter((m) => !DOC_ONLY_MARKS.has(m.type));
  }
  let nextContent = node.content;
  if (nextContent) {
    const mapped = nextContent.map(stripDocOnlyMarks);
    if (mapped.some((n, i) => n !== nextContent![i])) nextContent = mapped;
  }
  if (nextMarks === node.marks && nextContent === node.content) return node;
  const out: JSONContent = { ...node };
  if (nextMarks && nextMarks.length > 0) out.marks = nextMarks;
  else delete out.marks;
  if (nextContent) out.content = nextContent;
  return out;
}

export function normalizeRichContent(content: unknown): JSONContent {
  if (!content) return emptyRichContent();

  // Already JSON. Strip doc-only marks (linkedAnchor) so borrowed prose never
  // crashes a card editor whose schema lacks them.
  if (typeof content === "object") {
    const c = content as JSONContent;
    if (c.type === "doc") return stripDocOnlyMarks(c);
    if (c.type) return { type: "doc", content: [stripDocOnlyMarks(c)] };
  }

  if (typeof content === "string") {
    if (!content.trim()) return emptyRichContent();
    if (looksLikeHtml(content)) return htmlToJson(content);
    // Plain text
    return {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: content }] }],
    };
  }

  return emptyRichContent();
}

/**
 * Lightweight HTML → Tiptap JSON parser. Recognizes the small subset that the
 * legacy contentEditable footnote editor produced: <p>, <ul>/<ol>/<li>,
 * <strong>/<b>, <em>/<i>, <u>, <br>, plus citation spans (data-type=citation).
 *
 * This is intentionally not a general-purpose HTML parser — it only needs to
 * preserve old footnotes that were saved before the JSON migration.
 */
export function htmlToJson(html: string): JSONContent {
  if (!html.trim()) return emptyRichContent();

  if (typeof window === "undefined") {
    // Server-side fallback: produce a single text paragraph stripped of tags.
    const text = html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
    return {
      type: "doc",
      content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }],
    };
  }

  // SECURITY (BIB-F5-01 sibling): parse into an INERT DOMParser document, NOT
  // `div.innerHTML`. A detached div still carries a browsing context, so
  // assigning `innerHTML` attempts resource loads — `<img src=x onerror=…>`
  // fires its handler before we ever read the tree. A DOMParser document has no
  // browsing context: parsing alone runs no scripts and fetches nothing, so the
  // payload is neutralized before the walk. (Same inert-parse technique backs
  // `sanitize-html.ts`.) The walker below only reads known marks / text /
  // citation attrs, so the emitted JSON is already free of dangerous markup.
  const doc = new DOMParser().parseFromString(html, "text/html");

  const blocks: JSONContent[] = [];
  let pendingInline: JSONContent[] | null = null;

  function flushInline() {
    if (pendingInline && pendingInline.length > 0) {
      blocks.push({ type: "paragraph", content: pendingInline });
      pendingInline = null;
    }
  }

  function inlineFromNodes(
    nodes: NodeListOf<ChildNode> | ChildNode[],
    activeMarks: { type: string }[] = []
  ): JSONContent[] {
    const out: JSONContent[] = [];
    nodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        const text = n.textContent || "";
        if (!text) return;
        out.push({
          type: "text",
          text,
          ...(activeMarks.length ? { marks: activeMarks } : {}),
        });
        return;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) return;

      const el = n as HTMLElement;
      const tag = el.tagName.toLowerCase();

      // Citation node (preserved attrs)
      if (tag === "span" && el.dataset.type === "citation") {
        out.push({
          type: "citation",
          attrs: {
            citationId: el.dataset.citationId || "",
            command: el.dataset.command || el.textContent || "",
            displayText: el.dataset.displayText || el.textContent || "",
          },
        });
        return;
      }

      // Inline math node
      if (tag === "span" && el.dataset.type === "inline-math") {
        out.push({
          type: "inlineMath",
          attrs: { latex: el.dataset.latex || "" },
        });
        return;
      }

      // Hard break
      if (tag === "br") {
        out.push({ type: "hardBreak" });
        return;
      }

      // Mark wrappers
      if (tag === "strong" || tag === "b") {
        out.push(...inlineFromNodes(el.childNodes, [...activeMarks, { type: "bold" }]));
        return;
      }
      if (tag === "em" || tag === "i") {
        out.push(...inlineFromNodes(el.childNodes, [...activeMarks, { type: "italic" }]));
        return;
      }
      if (tag === "u") {
        out.push(...inlineFromNodes(el.childNodes, [...activeMarks, { type: "underline" }]));
        return;
      }
      if (tag === "code") {
        out.push(...inlineFromNodes(el.childNodes, [...activeMarks, { type: "code" }]));
        return;
      }

      // Anything else: descend into children, keeping current marks.
      out.push(...inlineFromNodes(el.childNodes, activeMarks));
    });
    return out;
  }

  function walkBlocks(parent: HTMLElement) {
    parent.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        const text = n.textContent || "";
        if (!text.trim()) return;
        if (!pendingInline) pendingInline = [];
        pendingInline.push({ type: "text", text });
        return;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) return;

      const el = n as HTMLElement;
      const tag = el.tagName.toLowerCase();

      if (tag === "p" || tag === "div") {
        flushInline();
        const inner = inlineFromNodes(el.childNodes);
        blocks.push({ type: "paragraph", content: inner });
        return;
      }

      if (tag === "ul" || tag === "ol") {
        flushInline();
        const items: JSONContent[] = [];
        el.childNodes.forEach((c) => {
          if (c.nodeType !== Node.ELEMENT_NODE) return;
          const li = c as HTMLElement;
          if (li.tagName.toLowerCase() !== "li") return;
          const inline = inlineFromNodes(li.childNodes);
          items.push({
            type: "listItem",
            content: [{ type: "paragraph", content: inline }],
          });
        });
        if (items.length) {
          blocks.push({
            type: tag === "ul" ? "bulletList" : "orderedList",
            content: items,
          });
        }
        return;
      }

      if (tag === "br") {
        if (!pendingInline) pendingInline = [];
        pendingInline.push({ type: "hardBreak" });
        return;
      }

      // Inline element at the top level — accumulate into a pending paragraph.
      if (!pendingInline) pendingInline = [];
      pendingInline.push(...inlineFromNodes([el]));
    });
    flushInline();
  }

  walkBlocks(doc.body);

  if (blocks.length === 0) blocks.push({ type: "paragraph" });
  return { type: "doc", content: blocks };
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON ↔ LaTeX (used by latex-parser / latex-serializer)
// ─────────────────────────────────────────────────────────────────────────────

function escapeLatex(text: string, opts?: { typography?: boolean }): string {
  // Both halves go through the shared SSOTs, not local copies, because this
  // file's copies had each drifted from the main serializer's:
  //  - quote smartening was missing `/` from the opener character class, so
  //    `and/"or"` produced a wrong-way closing pair inside a footnote but not
  //    in body prose (task 209);
  //  - char-escaping was missing `$`, `{`, `}`, `\` and the bracket
  //    protections, so a prose `$` in a footnote body came back as an
  //    `inlineMath` atom on reload and the `.tex` in between was already wrong
  //    for LaTeX itself (task 339). `escapeLatexChars` reads
  //    `CHAR_ESCAPE_TABLE` — the same table the parse rung below matches
  //    against, and the same one the main serializer emits from.
  const escaped = smartenStraightQuotes(escapeLatexChars(text));
  // Typographic reverse-map runs AFTER char-escaping so its `\^{e}`/`\~{n}`
  // output isn't re-escaped. Suppressed for code spans by the caller.
  return opts?.typography === false ? escaped : typographyToLatex(escaped);
}

function serializeMarks(text: string, marks?: { type: string }[]): string {
  if (!marks || marks.length === 0) return escapeLatex(text);
  // BYTE-LITERAL verbatim (a `\verb<delim>…<delim>` run) — emit exactly as
  // parsed. The twin of the main serializer's branch; before task 264 this
  // fork had no `\verb` handling at all, so a footnote's `\verb"code"` came
  // back ``\verb``code''`` (task 264).
  if (hasVerbatimMark(marks)) return text;
  if (marks.some((m) => m.type === "latexCommand")) {
    return smartenStraightQuotes(text);
  }
  // Code spans are verbatim — suppress typography (memo §A exclusion).
  const inCode = marks.some((m) => m.type === "code");
  let result = escapeLatex(text, { typography: !inCode });
  for (const mark of marks) {
    switch (mark.type) {
      case "bold":
        result = `\\textbf{${result}}`;
        break;
      case "italic":
        result = `\\emph{${result}}`;
        break;
      case "underline":
        result = `\\underline{${result}}`;
        break;
      case "code":
        result = `\\texttt{${result}}`;
        break;
    }
  }
  return result;
}

function serializeInlineNode(node: JSONContent): string {
  if (node.type === "text") return serializeMarks(node.text || "", node.marks as { type: string }[] | undefined);
  if (node.type === "inlineMath") return `$${node.attrs?.latex || ""}$`;
  if (node.type === "citation") {
    const cid = node.attrs?.citationId as string | undefined;
    const idMarker = cid ? emitMarker(VIRGIL_MARKERS.citation, cid) : "";
    return `${idMarker}${(node.attrs?.command as string) || ""}`;
  }
  // labelRef (\ref / \getref / \getfullref) — a footnote body can now hold a
  // nested cross-reference (CHIP 5: `\ref` created while editing inside a
  // footnote). Without this case `richJsonToLatex` would DROP the ref on save,
  // since the footnote node serializes its body through here (latex-serializer's
  // footnote case → richJsonToLatex). Mirror the main serializer's
  // `serializeLabelRef` so the body round-trips to `\footnote{… \ref{x} …}`.
  if (node.type === "labelRef") {
    const label = (node.attrs?.label as string) || "";
    const cmd = (node.attrs?.refCommand as string) || "ref";
    if (cmd === "getref") return `\\getref{${label}}`;
    if (cmd === "getfullref") return `\\getfullref{${label}}`;
    return `\\ref{${label}}`;
  }
  if (node.type === "hardBreak") return " ";
  return "";
}

/**
 * Serialize a footnote/note JSONContent body to a LaTeX-friendly inline string
 * suitable for `\footnote{...}`. Lists become bullet-prefixed runs and
 * paragraphs are joined with single spaces — same conventions the legacy
 * htmlToLatex helper used.
 */
export function richJsonToLatex(json: JSONContent): string {
  if (!json) return "";

  function walk(node: JSONContent): string {
    if (!node) return "";
    if (node.type === "text" || node.type === "inlineMath" || node.type === "citation" || node.type === "hardBreak") {
      return serializeInlineNode(node);
    }
    if (node.type === "paragraph") {
      return (node.content || []).map(serializeInlineNode).join("");
    }
    if (node.type === "bulletList" || node.type === "orderedList") {
      const items = (node.content || []).map((li) => {
        const inner = (li.content || []).map(walk).join("").trim();
        return `\u00b7 ${inner}`;
      });
      return items.join("; ");
    }
    if (node.type === "listItem") {
      return (node.content || []).map(walk).join("");
    }
    if (node.type === "doc") {
      return (node.content || []).map(walk).join(" ");
    }
    // Block atoms — these end up here only when card-borne content
    // (note / footnote body that originated from an archive restore)
    // is serialized back to inline LaTeX. The main editor's LaTeX
    // serializer (latex-serializer.ts) handles the full-document path;
    // this is the inline / footnote-body fallback. Emit a sensible
    // LaTeX projection so atoms don't silently vanish on save.
    if (node.type === "texBlock") {
      return (node.attrs?.code as string) || "";
    }
    if (node.type === "latexComment") {
      const text = (node.content ?? []).map((c) => c.text ?? "").join("");
      return `% ${text}`;
    }
    if (node.type === "displayMath") {
      return `$$${(node.attrs?.latex as string) || ""}$$`;
    }
    if (node.type === "figureBlock") {
      // Bare-bones rebuild — the structured caption + sources we'd
      // need for a full `\begin{figure}` re-emit live in the main
      // LaTeX serializer. This fallback shouldn't typically fire
      // (figures don't normally end up inside footnote bodies);
      // preserve the verbatim env if we have it, otherwise emit a
      // stub the user can clean up.
      const raw = (node.attrs?.raw as string) || "";
      if (raw) return `\\begin{figure}${raw}\\end{figure}`;
      const source = (node.attrs?.source as string) || "";
      return source ? `\\includegraphics{${source}}` : "";
    }
    if (node.type === "graphicsBlock") {
      const command = (node.attrs?.command as string) || "";
      if (command) return command;
      const source = (node.attrs?.source as string) || "";
      return source ? `\\includegraphics{${source}}` : "";
    }
    if (node.content) {
      return node.content.map(walk).join("");
    }
    return "";
  }

  return walk(json).replace(/\s+/g, " ").trim();
}

/**
 * Parse the inline body of a `\footnote{...}` back into JSONContent. Reuses
 * the lightweight inline parser logic (textbf/textit/cite/inline math, etc.)
 * — but it's intentionally simple: footnotes don't carry headings or display
 * math, so we only need a small inline grammar.
 */
export function richLatexToJson(latex: string): JSONContent {
  if (!latex || !latex.trim()) return emptyRichContent();
  const inline = parseInlineLatex(latex);
  return {
    type: "doc",
    content: [{ type: "paragraph", content: inline.length ? inline : [] }],
  };
}

function parseInlineLatex(text: string, inCode = false): JSONContent[] {
  const nodes: JSONContent[] = [];
  let i = 0;
  let buffer = "";
  // `\vcid{uuid}` marker stashes a stable citationId for the cite that starts
  // where the marker ends — and for nothing else (task 341; see
  // `PendingMarkerId`). Footnotes don't nest, so `\vfid` isn't handled here.
  const pendingCitationId = new PendingMarkerId();

  const flush = () => {
    if (buffer) {
      // Dashes → en/em glyph at flush, except inside code spans (memo §A).
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

    // Non-backslash members of `CHAR_ESCAPE_TABLE` — the `{[}` / `{]}` prose
    // bracket protections and the `~` TIE — the twin of the main parser's
    // branch, at the same position, reading the same DERIVED lead set
    // (tasks 339 / 349). The protections arrived with their emit half in 339:
    // an unwrap-less parse would make a footnote body holding `arr[0]` grow a
    // brace layer on EVERY save, unbounded — the non-idempotency
    // `serializeMarklessTextBody` warns about. The tie is the same shape one
    // member over: this fork's escape rung emits `\textasciitilde{}` for an
    // ASCII `~`, so without the inward half a tie in a footnote or card body
    // came back as a printed tilde, permanently.
    if (CHAR_ESCAPE_LEADS.has(text[i])) {
      const glyph = matchCharEscapeAt(text, i);
      if (glyph) {
        buffer += glyph.char;
        i = glyph.end;
        continue;
      }
    }

    // A BARE `{…}` GROUP → braces on the raw-LaTeX carrier, content as prose
    // (task 349 M6) — the twin of the main parser's branch. A card body is
    // itself a braced ARGUMENT, so this fork recognizes no comment tails at
    // all; the group's own recursion therefore has no opt to thread.
    {
      const group = matchBraceGroupAt(text, i);
      if (group) {
        flush();
        nodes.push({
          type: "text",
          text: "{",
          marks: [{ type: "latexCommand" }],
        });
        nodes.push(...parseInlineLatex(group.content, inCode));
        nodes.push({
          type: "text",
          text: "}",
          marks: [{ type: "latexCommand" }],
        });
        i = group.end;
        continue;
      }
    }

    // Inline math — `$…$`, `$$…$$`, `\[…\]`, `\(…\)`. Read through the lexer's
    // `matchInlineMathAt`, the same scanner the main inline parser calls, at
    // the same position in the branch order (task 341). This fork knew `$…$`
    // and nothing else, so `\(x^2\)` / `$$E=mc^2$$` / `\[x^2\]` in a footnote
    // or card body fell through to the PROSE buffer and were char-escaped —
    // `x^2` came back as `x\textasciicircum{}2`, a literal caret in math mode,
    // so every superscript and subscript in the body was lost in the PDF while
    // the editor kept showing it correctly (the unescape rung maps the
    // spelling back on the way in, so the wrong bytes on disk never surface).
    {
      const math = matchInlineMathAt(text, i);
      if (math) {
        flush();
        nodes.push({ type: "inlineMath", attrs: { latex: math.latex } });
        i = math.end;
        continue;
      }
    }

    if (text[i] === "\\") {
      const rest = text.slice(i);

      // \verb<delim>…<delim> — BYTE-LITERAL, the twin of the main parser's
      // inline-verb branch and the reason it must be FIRST here: `\verb` used
      // to fall all the way through to the unknown-\command fallback, which
      // consumes only the token `\verb` and leaves the payload in the plain
      // text buffer — where it got char-escaped, dash-glyphified and
      // smart-quoted. A footnote reading `\verb|x = "hi"|` serialized back as
      // ``\verb|x = ``hi''|``. Placed above the mark/accent branches so
      // nothing inside the delimiter pair can be claimed by them, and read
      // through the lexer's shared matcher so the two inline parsers agree on
      // what a verb run is (task 264).
      const verbEnd = matchInlineVerbAt(text, i);
      if (verbEnd !== -1) {
        flush();
        nodes.push({
          type: "text",
          text: text.slice(i, verbEnd),
          marks: [verbatimMark()],
        });
        i = verbEnd;
        continue;
      }

      // Mark commands: \textbf{...}, \textit{...}, \emph{...}, \underline{...}, \texttt{...}
      const markMatch = rest.match(/^\\(textbf|textit|emph|underline|texttt)\{/);
      if (markMatch) {
        const cmdName = markMatch[1];
        const open = i + markMatch[0].length;
        const closed = findClose(text, open - 1);
        if (closed !== -1) {
          flush();
          const inner = text.slice(open, closed);
          // `\texttt{}` is a code span — suppress typography in its body.
          const innerNodes = parseInlineLatex(inner, cmdName === "texttt");
          const markType =
            cmdName === "textbf" ? "bold" :
            cmdName === "textit" ? "italic" :
            cmdName === "emph" ? "italic" :
            cmdName === "underline" ? "underline" :
            "code";
          for (const n of innerNodes) {
            const marks = [...((n as JSONContent).marks || []) as { type: string }[], { type: markType }];
            nodes.push({ ...n, marks });
          }
          i = closed + 1;
          continue;
        }
      }

      // \vcid{uuid} — no-op marker stashing a stable citationId for the
      // next citation command. See parseInlineContent in latex-parser.ts.
      if (markerOpensAt(text, i, VIRGIL_MARKERS.citation)) {
        const open = markerArgStart(i, VIRGIL_MARKERS.citation);
        const closed = findClose(text, open);
        if (closed !== -1) {
          pendingCitationId.set(text.slice(open + 1, closed) || null, closed + 1);
          i = closed + 1;
          continue;
        }
      }

      // Citation commands — vocabulary AND `[pre][post]{key}` argument grammar
      // both from the registry's `matchCiteCommandAt`, the same call the main
      // inline parser makes (task 341). This branch used to hand-spell 17 of
      // the registry's 27 names, so ten cite commands (`\fullcite`, `\nocite`,
      // `\citetitle`, `\citeurl`, `\citedate`, `\smartcite`, `\smartcites`,
      // `\footfullcite`, `\citenum`, `\citetext`) became grey monospace text
      // inside a card body while behaving as citations in the document — no
      // card, no panel row, no `.bib` linkage, and the `\vcid` deleted from the
      // `.tex` on the next save. It also hand-wrote the multi-cite loop with
      // the per-key brackets consumed only BEFORE the first key, so
      // `\footcites[p1][q1]{a}[p2][q2]{jones_21}` — a name it already had —
      // leaked its tail into prose and had the citekey escaped to `jones\_21`.
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

      // \ref{key} / \getref{key} / \getfullref{key} — cross-reference, the
      // re-parse twin of the labelRef serialize case above (CHIP 5). A footnote
      // body that round-trips through `\footnote{… \ref{x} …}` must re-parse the
      // ref back into a `labelRef` node here; otherwise it falls through to the
      // unknown-\command branch and renders as grey monospace inside the
      // footnote. `displayText`/`targetKind` are resolved later by the doc-level
      // ref-display pass — mirror the main parser's labelRef attrs.
      const refCmdMatch = rest.match(/^\\(getfullref|getref|ref)\{/);
      if (refCmdMatch) {
        const open = i + refCmdMatch[0].length - 1; // index of the `{`
        const closed = findClose(text, open);
        if (closed !== -1) {
          flush();
          const refCommand =
            refCmdMatch[1] === "getfullref"
              ? "getfullref"
              : refCmdMatch[1] === "getref"
                ? "getref"
                : "ref";
          nodes.push({
            type: "labelRef",
            attrs: {
              label: text.slice(open + 1, closed),
              displayText: "",
              refCommand,
              targetKind: null,
            },
          });
          i = closed + 1;
          continue;
        }
      }

      // Common text macros
      // The vocabulary is `TEXT_MACRO_TABLE`'s, not a local alternation: this
      // was hand-written here AND in the card/footnote fork (task 341's twin
      // rule), and its ellipsis half was a second spelling of `LITERAL_TABLE`'s
      // own `latexForms` — the same shape task 255 retired for the marker
      // commands. Byte-identical to the `\b`-terminated alternation it replaces.
      const textMacro = matchTextMacroAt(text, i);
      if (textMacro) {
        buffer += textMacro.text;
        i = textMacro.end;
        continue;
      }

      // `\\` (line break / escaped backslash) is ONE token — consume both
      // chars together. Otherwise the lone-backslash fallback below advances
      // by one and the SECOND backslash re-pairs with a following special as
      // an escape: `end\\$x^2$` became `end\$x^2$` (one backslash eaten, the
      // math never opening). Consuming the pair is what makes the `$` toggle
      // above see an EVEN backslash run and open math correctly (task 206).
      //
      // It rides the raw-LaTeX CARRIER since task 360, where it used to go
      // into the prose buffer as two literal backslashes. Same reason the
      // control-symbol door below exists: with `\` escaped unconditionally, a
      // buffered `\\` reaches the `.tex` as `\textbackslash{}\textbackslash{}`.
      // The break's own argument run comes from the lexer's `matchLineBreakAt`,
      // the same door the main parser reads (the task-341 twin rule), so a
      // `\\[2pt]` in a card body keeps its spacing instead of printing it.
      const cardLineBreak = matchLineBreakAt(text, i);
      if (cardLineBreak) {
        flush();
        nodes.push({
          type: "text",
          text: cardLineBreak.raw,
          marks: [{ type: "latexCommand" }],
        });
        i = cardLineBreak.end;
        continue;
      }

      // Escaped specials — from `CHAR_ESCAPE_TABLE`, the twin of the main
      // parser's rung (task 339). Same position as the hand-written
      // alternation it replaces: after `\\` above, before the accents.
      const esc = matchCharEscapeAt(text, i);
      if (esc) {
        buffer += esc.char;
        i = esc.end;
        continue;
      }

      // Typographic accents (\'e \v{s} \c{c} …) + special letters (\ss \o …)
      // → composed glyph, BEFORE the unknown-\command fallback so they don't
      // become grey monospace. Suppressed inside code spans (memo §A).
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

      // Unknown \command — preserve as raw text marked latexCommand. The
      // control-WORD read comes from the lexer SSOT (`matchCommandToken`), the
      // same one the main inline parser reads, so this fork cannot drift on
      // what a command NAME is (task 338).
      const unknownCmd = matchCommandToken(text, i);
      if (unknownCmd) {
        // The whole argument run, from the lexer SSOT the main inline parser
        // reads (task 349 M1–M3). This fork had its own copy of the two-brace
        // cap AND of the fixed bracket-then-brace order — and, unlike the main
        // parser, no `{[}`-protection check at all, so a prose bracket abutting
        // a command was folded into it here and not there. One door closes all
        // three divergences (the task-341 twin rule).
        const args = matchCommandArgumentRun(text, unknownCmd.end);
        flush();
        nodes.push({
          type: "text",
          text: "\\" + unknownCmd.name + args.raw,
          marks: [{ type: "latexCommand" }],
        });
        i = args.end;
        continue;
      }

      // A CONTROL SYMBOL — `\` plus one non-letter — on the raw-LaTeX
      // carrier, the twin of the main parser's door (task 360). `\,` `\;`
      // `\ ` and their kin are real LaTeX this fork does not model, and a
      // literal backslash left in the prose buffer is destroyed the moment the
      // escape rung stops treating a backslash as a reason to give up.
      const cardControlSymbol = matchControlSymbolAt(text, i);
      if (cardControlSymbol) {
        flush();
        nodes.push({
          type: "text",
          text: cardControlSymbol.raw,
          marks: [{ type: "latexCommand" }],
        });
        i = cardControlSymbol.end;
        continue;
      }

      // A trailing `\` with nothing after it — genuinely literal.
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

/** Index of the `}` matching the `{` at `openBrace`, or -1. Delegates to the
 *  lexer's `findMatchingBrace` — this was a re-rolled copy carrying the naive
 *  single-char escape test (task 206). */
function findClose(text: string, openBrace: number): number {
  return findMatchingBrace(text, openBrace);
}

// ─────────────────────────────────────────────────────────────────────────────
// Plain-text projection (used for drag ghosts, copy-to-clipboard, tooltips)
// ─────────────────────────────────────────────────────────────────────────────

export function richJsonToPlainText(json: JSONContent | unknown): string {
  if (!json) return "";
  // Legacy paths may still hand us a string
  if (typeof json === "string") return htmlToPlain(json);
  if (typeof json !== "object") return String(json);

  function walk(node: JSONContent): string {
    if (!node) return "";
    if (node.type === "text") return node.text || "";
    if (node.type === "inlineMath") return `$${node.attrs?.latex || ""}$`;
    if (node.type === "citation") return (node.attrs?.displayText as string) || (node.attrs?.command as string) || "";
    // labelRef (\ref / \getref / \getfullref) — a footnote body can hold a
    // nested cross-reference (CHIP 5). Like citation, it's a leaf atom with no
    // `content`, so without this case it falls through to `return ""` and the
    // ref VANISHES from the plain-text projection (drag ghosts, clipboard,
    // tooltips, search, compressed/omni previews). Mirror the citation case:
    // prefer the resolved number, fall back to the raw `\ref{label}` command.
    if (node.type === "labelRef") {
      const display = node.attrs?.displayText as string | undefined;
      if (display) return display;
      const cmd = (node.attrs?.refCommand as string) || "ref";
      return `\\${cmd}{${(node.attrs?.label as string) || ""}}`;
    }
    if (node.type === "hardBreak") return "\n";
    if (node.type === "paragraph") return (node.content || []).map(walk).join("");
    if (node.type === "bulletList" || node.type === "orderedList") {
      return (node.content || []).map((li) => walk(li)).join("\n");
    }
    if (node.type === "listItem") return (node.content || []).map(walk).join("");
    if (node.type === "doc") return (node.content || []).map(walk).join("\n");
    // Block atoms — content lives in attrs, not in child text. Without
    // these cases compressed-card previews, search, drag ghosts, and
    // tooltips would all show "" for any selection that contains
    // (only) a block atom. Keep aligned with the schema in
    // RichTextField.tsx — if a new block atom is added there, add a
    // case here too.
    if (node.type === "texBlock") {
      const title = (node.attrs?.parTitle as string | null) || "";
      const code = (node.attrs?.code as string) || "";
      return title ? `${title}\n${code}` : code;
    }
    if (node.type === "figureBlock") {
      const caption = (node.attrs?.caption as string | undefined) || "";
      const source = (node.attrs?.source as string | null) || "";
      return caption || source || "[figure]";
    }
    if (node.type === "graphicsBlock") {
      const source = (node.attrs?.source as string | undefined) || "";
      return source || "[graphic]";
    }
    if (node.type === "latexComment") {
      const text = (node.content ?? []).map((c) => c.text ?? "").join("");
      return `% ${text}`;
    }
    if (node.type === "displayMath") {
      return `$$${(node.attrs?.latex as string) || ""}$$`;
    }
    if (node.content) return node.content.map(walk).join("");
    return "";
  }

  return walk(json as JSONContent).replace(/\n{2,}/g, "\n").trim();
}

function htmlToPlain(html: string): string {
  if (typeof window === "undefined") {
    return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
  }
  // SECURITY (BIB-F5-01 sibling): inert DOMParser parse — `div.innerHTML` would
  // attempt resource loads (e.g. `<img onerror>`); a DOMParser document has no
  // browsing context, so nothing executes or fetches during the parse.
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent || "").trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy aliases — old call sites kept compiling while we migrate.
// These will shrink/disappear as the panel + extensions move over to JSON.
// ─────────────────────────────────────────────────────────────────────────────

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** @deprecated — use normalizeRichContent + Tiptap rendering instead. */
export function normalizeFootnoteContent(content: unknown): JSONContent {
  return normalizeRichContent(content);
}

/** @deprecated — use richJsonToLatex instead. */
export function footnoteHtmlToLatex(content: unknown): string {
  return richJsonToLatex(normalizeRichContent(content));
}

/** @deprecated — use richJsonToPlainText instead. */
export function footnoteHtmlToPlainText(content: unknown): string {
  return richJsonToPlainText(content);
}

/** @deprecated — use richLatexToJson instead. */
export function footnoteLatexToHtml(latex: string): JSONContent {
  return richLatexToJson(latex);
}
