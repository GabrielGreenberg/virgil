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
  matchAccent,
  matchSpecialLetter,
  dashesToGlyphs,
  typographyToLatex,
} from "@/lib/latex-typography";
import { findMatchingBrace, isEscaped, findUnescaped } from "@/lib/latex-lexer";

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
  const escaped = text
    .replace(/(?<!\\)([&%#_])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/“/g, "``")
    .replace(/”/g, "''")
    .replace(/(^|[\s([{—–])"/g, "$1``")
    .replace(/"/g, "''");
  // Typographic reverse-map runs AFTER char-escaping so its `\^{e}`/`\~{n}`
  // output isn't re-escaped. Suppressed for code spans by the caller.
  return opts?.typography === false ? escaped : typographyToLatex(escaped);
}

function serializeMarks(text: string, marks?: { type: string }[]): string {
  if (!marks || marks.length === 0) return escapeLatex(text);
  if (marks.some((m) => m.type === "latexCommand")) {
    return text
      .replace(/“/g, "``")
      .replace(/”/g, "''")
      .replace(/(^|[\s([{—–])"/g, "$1``")
      .replace(/"/g, "''");
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
    const idMarker = cid ? `\\vcid{${cid}}` : "";
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
  // `\vcid{uuid}` marker stashes a stable citationId for the next cite.
  // Footnotes don't nest, so `\vfid` isn't handled in this inline parser.
  let pendingCitationId: string | null = null;

  const flush = () => {
    if (buffer) {
      // Dashes → en/em glyph at flush, except inside code spans (memo §A).
      const flushed = inCode ? buffer : dashesToGlyphs(buffer);
      nodes.push({ type: "text", text: flushed });
      buffer = "";
    }
  };

  while (i < text.length) {
    // LaTeX double-quote pairs → smart quotes in the display.
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

    // Inline math: $...$
    if (text[i] === "$" && !isEscaped(text, i)) {
      const end = findUnescaped(text, "$", i + 1);
      if (end !== -1) {
        flush();
        nodes.push({ type: "inlineMath", attrs: { latex: text.slice(i + 1, end) } });
        i = end + 1;
        continue;
      }
    }

    if (text[i] === "\\") {
      const rest = text.slice(i);

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
      const vcidMatch = rest.match(/^\\vcid\{/);
      if (vcidMatch) {
        const open = i + "\\vcid".length;
        const closed = findClose(text, open);
        if (closed !== -1) {
          pendingCitationId = text.slice(open + 1, closed) || null;
          i = closed + 1;
          continue;
        }
      }

      // Citation commands: \cite, \citep, \citet, \textcite, \parencite, \cites, etc.
      const citeMatch = rest.match(/^\\(Citeyearpar|Citeauthor|Citeyear|Citealp|Citealt|Citep|Citet|Textcites|Parencites|Autocites|Footcites|Textcite|Parencite|Autocite|Footcite|Cites|Cite|citeyearpar|citeauthor|citeyear|citealp|citealt|citep|citet|textcites|parencites|autocites|footcites|textcite|parencite|autocite|footcite|cites|cite)(\*?)/);
      if (citeMatch) {
        let pos = i + citeMatch[0].length;
        let fullCmd = citeMatch[0];
        // Optional [...] args
        for (let optCount = 0; optCount < 2 && pos < text.length && text[pos] === "["; optCount++) {
          const close = text.indexOf("]", pos);
          if (close !== -1) {
            fullCmd += text.slice(pos, close + 1);
            pos = close + 1;
          } else break;
        }
        // {keys} (one or more for biblatex multi-cite)
        if (pos < text.length && text[pos] === "{") {
          while (pos < text.length && text[pos] === "{") {
            const close = findClose(text, pos);
            if (close === -1) break;
            fullCmd += text.slice(pos, close + 1);
            pos = close + 1;
            const cmdLower = citeMatch[1].toLowerCase();
            const isMulti = ["cites", "textcites", "parencites", "autocites", "footcites"].includes(cmdLower);
            if (!isMulti) break;
          }
          flush();
          nodes.push({
            type: "citation",
            attrs: {
              citationId: pendingCitationId || generateShortId(),
              command: fullCmd,
              displayText: "",
            },
          });
          pendingCitationId = null;
          i = pos;
          continue;
        }
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
      const textCmdMatch = rest.match(/^\\(ldots|dots|LaTeX|TeX)\b/);
      if (textCmdMatch) {
        const cmd = textCmdMatch[1];
        if (cmd === "ldots" || cmd === "dots") buffer += "\u2026";
        else if (cmd === "LaTeX") buffer += "LaTeX";
        else if (cmd === "TeX") buffer += "TeX";
        i += textCmdMatch[0].length;
        continue;
      }

      // `\\` (line break / escaped backslash) is ONE token — consume both
      // chars together. Otherwise the lone-backslash fallback below advances
      // by one and the SECOND backslash re-pairs with a following special as
      // an escape: `end\\$x^2$` became `end\$x^2$` (one backslash eaten, the
      // math never opening). Consuming the pair is what makes the `$` toggle
      // above see an EVEN backslash run and open math correctly (task 206).
      if (rest[1] === "\\") {
        buffer += "\\\\";
        i += 2;
        continue;
      }

      // Escaped specials
      const escMatch = rest.match(/^\\(textbackslash\{\}|textasciitilde\{\}|textasciicircum\{\}|[&%$#_{}])/);
      if (escMatch) {
        const ch = escMatch[1];
        if (ch === "textbackslash{}") buffer += "\\";
        else if (ch === "textasciitilde{}") buffer += "~";
        else if (ch === "textasciicircum{}") buffer += "^";
        else buffer += ch;
        i += escMatch[0].length;
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

      // Unknown \command — preserve as raw text marked latexCommand
      const unknownCmd = rest.match(/^\\([a-zA-Z@]+)/);
      if (unknownCmd) {
        let cmdText = "\\" + unknownCmd[1];
        let p = i + unknownCmd[0].length;
        if (p < text.length && text[p] === "*") { cmdText += "*"; p++; }
        while (p < text.length && text[p] === "[") {
          const close = text.indexOf("]", p);
          if (close === -1) break;
          cmdText += text.slice(p, close + 1);
          p = close + 1;
        }
        let braceCount = 0;
        while (p < text.length && text[p] === "{" && braceCount < 2) {
          const close = findClose(text, p);
          if (close === -1) break;
          cmdText += text.slice(p, close + 1);
          p = close + 1;
          braceCount++;
        }
        flush();
        nodes.push({ type: "text", text: cmdText, marks: [{ type: "latexCommand" }] });
        i = p;
        continue;
      }

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
