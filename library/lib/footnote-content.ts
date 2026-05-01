// Footnote and note content live as Tiptap JSONContent — a small subset of
// the main editor's document tree. The content can hold inline formatting
// (bold/italic/underline), citation nodes, inline math, and lists. We store
// JSON so citation node attributes (citationId, command, displayText) survive
// round-tripping cleanly without needing a custom parseHTML for every attr.
//
// Legacy footnote/note content was an HTML string. The migrate helpers below
// promote those old strings to JSON the first time they're read.

import type { JSONContent } from "@tiptap/react";
import { generateEntityId } from "@library/lib/uuid";

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
export function normalizeRichContent(content: unknown): JSONContent {
  if (!content) return emptyRichContent();

  // Already JSON
  if (typeof content === "object") {
    const c = content as JSONContent;
    if (c.type === "doc") return c;
    if (c.type) return { type: "doc", content: [c] };
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

  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;

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

  walkBlocks(wrapper);

  if (blocks.length === 0) blocks.push({ type: "paragraph" });
  return { type: "doc", content: blocks };
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON ↔ LaTeX (used by latex-parser / latex-serializer)
// ─────────────────────────────────────────────────────────────────────────────

function escapeLatex(text: string): string {
  return text
    .replace(/(?<!\\)([&%#_])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

function serializeMarks(text: string, marks?: { type: string }[]): string {
  if (!marks || marks.length === 0) return escapeLatex(text);
  if (marks.some((m) => m.type === "latexCommand")) return text;
  let result = escapeLatex(text);
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

function parseInlineLatex(text: string): JSONContent[] {
  const nodes: JSONContent[] = [];
  let i = 0;
  let buffer = "";
  // `\vcid{uuid}` marker stashes a stable citationId for the next cite.
  // Footnotes don't nest, so `\vfid` isn't handled in this inline parser.
  let pendingCitationId: string | null = null;

  const flush = () => {
    if (buffer) {
      nodes.push({ type: "text", text: buffer });
      buffer = "";
    }
  };

  while (i < text.length) {
    // Inline math: $...$
    if (text[i] === "$" && (i === 0 || text[i - 1] !== "\\")) {
      const end = text.indexOf("$", i + 1);
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
          const innerNodes = parseInlineLatex(inner);
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
              citationId: pendingCitationId || generateEntityId(),
              command: fullCmd,
              displayText: "",
            },
          });
          pendingCitationId = null;
          i = pos;
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

function findClose(text: string, openBrace: number): number {
  if (text[openBrace] !== "{") return -1;
  let depth = 1;
  let i = openBrace + 1;
  while (i < text.length && depth > 0) {
    if (text[i] === "{" && text[i - 1] !== "\\") depth++;
    else if (text[i] === "}" && text[i - 1] !== "\\") depth--;
    if (depth === 0) return i;
    i++;
  }
  return -1;
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
    if (node.type === "hardBreak") return "\n";
    if (node.type === "paragraph") return (node.content || []).map(walk).join("");
    if (node.type === "bulletList" || node.type === "orderedList") {
      return (node.content || []).map((li) => walk(li)).join("\n");
    }
    if (node.type === "listItem") return (node.content || []).map(walk).join("");
    if (node.type === "doc") return (node.content || []).map(walk).join("\n");
    if (node.content) return node.content.map(walk).join("");
    return "";
  }

  return walk(json as JSONContent).replace(/\n{2,}/g, "\n").trim();
}

function htmlToPlain(html: string): string {
  if (typeof window === "undefined") {
    return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
  }
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent || "").trim();
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
