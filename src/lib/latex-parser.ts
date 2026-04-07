import { JSONContent } from "@tiptap/react";
import type { VirgilSidecar } from "@/lib/types";
import { richLatexToJson } from "@/lib/footnote-content";

interface ParseContext {
  pos: number;
  src: string;
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

function parseInlineContent(text: string): JSONContent[] {
  const nodes: JSONContent[] = [];
  let i = 0;
  let buffer = "";

  const flush = () => {
    if (buffer) {
      nodes.push({ type: "text", text: unescapeLatex(buffer) });
      buffer = "";
    }
  };

  while (i < text.length) {
    // Inline math: $...$
    if (text[i] === "$" && (i === 0 || text[i - 1] !== "\\")) {
      flush();
      const end = text.indexOf("$", i + 1);
      if (end !== -1) {
        nodes.push({
          type: "inlineMath",
          attrs: { latex: text.slice(i + 1, end) },
        });
        i = end + 1;
        continue;
      }
    }

    // LaTeX commands for marks
    if (text[i] === "\\") {
      const rest = text.slice(i);

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
          const innerNodes = parseInlineContent(inner.content);
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
              footnoteId: crypto.randomUUID(),
            },
          });
          i = inner.end;
          continue;
        }
      }

      // \archivemarker{id}{preview}
      const amMatch = rest.match(/^\\archivemarker\{/);
      if (amMatch) {
        flush();
        const idArg = extractBraced(text, i + "\\archivemarker".length);
        if (idArg !== null) {
          const previewArg = extractBraced(text, idArg.end);
          if (previewArg !== null) {
            nodes.push({
              type: "archiveMarker",
              attrs: { archiveId: idArg.content, preview: previewArg.content.replace(/\\(\{|\}|\\)/g, "$1") },
            });
            i = previewArg.end;
            continue;
          }
        }
      }

      // Citation commands: natbib (\cite, \citet, \citep, etc.) and biblatex (\textcite, \parencite, \cites, etc.)
      // Longer names must come first to avoid partial matches
      const citeMatch = rest.match(/^\\(Citeyearpar|Citeauthor|Citeyear|Citealp|Citealt|Citep|Citet|Textcites|Parencites|Autocites|Footcites|Textcite|Parencite|Autocite|Footcite|Cites|Cite|citeyearpar|citeauthor|citeyear|citealp|citealt|citep|citet|textcites|parencites|autocites|footcites|textcite|parencite|autocite|footcite|cites|cite)(\*?)/);
      if (citeMatch) {
        flush();
        let pos = i + citeMatch[0].length;
        let fullCmd = citeMatch[0];
        const cmdLower = citeMatch[1].toLowerCase();
        const isMultiCite = cmdLower.endsWith("s") && ["cites", "textcites", "parencites", "autocites", "footcites"].includes(cmdLower);

        // Consume optional [...] arguments (up to 2)
        for (let optCount = 0; optCount < 2 && pos < text.length && text[pos] === "["; optCount++) {
          const closeBracket = text.indexOf("]", pos);
          if (closeBracket !== -1) {
            fullCmd += text.slice(pos, closeBracket + 1);
            pos = closeBracket + 1;
          } else {
            break;
          }
        }

        if (isMultiCite) {
          // Biblatex multi-cite: \cites{key1}{key2}{key3} — consume all consecutive {key} groups
          let found = false;
          while (pos < text.length && text[pos] === "{") {
            const inner = extractBraced(text, pos);
            if (inner !== null) {
              fullCmd += "{" + inner.content + "}";
              pos = inner.end;
              found = true;
            } else {
              break;
            }
          }
          if (found) {
            nodes.push({
              type: "citation",
              attrs: {
                citationId: crypto.randomUUID(),
                command: fullCmd,
                displayText: "",
              },
            });
            i = pos;
            continue;
          }
        } else {
          // Single {keys} argument (natbib comma-separated or biblatex single key)
          if (pos < text.length && text[pos] === "{") {
            const inner = extractBraced(text, pos);
            if (inner !== null) {
              fullCmd += "{" + inner.content + "}";
              nodes.push({
                type: "citation",
                attrs: {
                  citationId: crypto.randomUUID(),
                  command: fullCmd,
                  displayText: "",
                },
              });
              i = inner.end;
              continue;
            }
          }
        }

        // If no braced arg, treat as unknown text (will be raw)
        buffer += fullCmd;
        i = pos;
        continue;
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

      // Escaped special chars
      const escMatch = rest.match(
        /^\\(textbackslash\{\}|textasciitilde\{\}|textasciicircum\{\}|[&%$#_{}])/
      );
      if (escMatch) {
        const ch = escMatch[1];
        if (ch === "textbackslash{}") buffer += "\\";
        else if (ch === "textasciitilde{}") buffer += "~";
        else if (ch === "textasciicircum{}") buffer += "^";
        else buffer += ch;
        i += escMatch[0].length;
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

      // Unknown \command{...} or \command[...]{...} — render as grey monospace
      const unknownCmd = rest.match(/^\\([a-zA-Z@]+)/);
      if (unknownCmd) {
        flush();
        let cmdText = "\\" + unknownCmd[1];
        i += unknownCmd[0].length;
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
        // Consume {braced} args (up to 2)
        let braceCount = 0;
        while (i < text.length && text[i] === "{" && braceCount < 2) {
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

function extractBraced(
  text: string,
  startOfBrace: number
): { content: string; end: number } | null {
  if (text[startOfBrace] !== "{") return null;
  let depth = 1;
  let i = startOfBrace + 1;
  while (i < text.length && depth > 0) {
    if (text[i] === "{" && text[i - 1] !== "\\") depth++;
    if (text[i] === "}" && text[i - 1] !== "\\") depth--;
    i++;
  }
  if (depth !== 0) return null;
  return { content: text.slice(startOfBrace + 1, i - 1), end: i };
}

function unescapeLatex(text: string): string {
  return text;
}

export function parseLatex(latex: string, sidecar?: VirgilSidecar): JSONContent {
  seenTitleFields.clear();
  const body = stripPreamble(latex);
  const doc: JSONContent = { type: "doc", content: [] };

  if (!body) {
    doc.content = [{ type: "paragraph" }];
    return doc;
  }

  const ctx: ParseContext = { pos: 0, src: body };
  parseBody(ctx, doc);

  if (!doc.content || doc.content.length === 0) {
    doc.content = [{ type: "paragraph" }];
  }

  // Number footnotes sequentially
  numberFootnotes(doc);

  // Merge sidecar titles into paragraph nodes by UUID
  if (sidecar) {
    mergeSidecarTitles(doc, sidecar);
  }

  return doc;
}

function mergeSidecarTitles(node: JSONContent, sidecar: VirgilSidecar): void {
  const TITLED = new Set(["paragraph", "bulletList", "orderedList"]);
  if (TITLED.has(node.type!) && node.attrs?.uuid) {
    const meta = sidecar.paragraphs[node.attrs.uuid as string];
    if (meta?.title) {
      node.attrs.parTitle = meta.title;
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

const seenTitleFields = new Set<string>();

function parseBody(ctx: ParseContext, parent: JSONContent): void {
  if (!parent.content) parent.content = [];

  while (ctx.pos < ctx.src.length) {
    skipWhitespace(ctx);
    if (ctx.pos >= ctx.src.length) break;

    const rest = ctx.src.slice(ctx.pos);

    // \section{...}
    const sectionMatch = rest.match(/^\\(section|subsection|subsubsection)\{/);
    if (sectionMatch) {
      const level =
        sectionMatch[1] === "section"
          ? 1
          : sectionMatch[1] === "subsection"
            ? 2
            : 3;
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
        const uuidMatch = afterLabel.match(/^[ \t]*%!v:([0-9a-f]{4})/);
        let uuid: string | null = null;
        if (uuidMatch) {
          uuid = uuidMatch[1];
          ctx.pos += uuidMatch[0].length;
        }
        const attrs: Record<string, unknown> = { level, label };
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
          attrs: { field, rawPrefix: rawPrefix || null, isToday },
          content: parseInlineContent(rawContent),
        });
        continue;
      }
    }


    // Display math \[...\]
    if (rest.startsWith("\\[")) {
      const endMath = ctx.src.indexOf("\\]", ctx.pos + 2);
      if (endMath !== -1) {
        parent.content.push({
          type: "displayMath",
          attrs: { latex: ctx.src.slice(ctx.pos + 2, endMath).trim() },
        });
        ctx.pos = endMath + 2;
        continue;
      }
    }

    // \begin{...}[optional]
    const beginMatch = rest.match(/^\\begin\{(\w+)\}(\[[^\]]*\])?/);
    if (beginMatch) {
      const env = beginMatch[1];
      const optArg = beginMatch[2] || "";
      ctx.pos += beginMatch[0].length;
      const envEnd = ctx.src.indexOf(`\\end{${env}}`, ctx.pos);
      const envContent =
        envEnd !== -1
          ? ctx.src.slice(ctx.pos, envEnd)
          : ctx.src.slice(ctx.pos);
      ctx.pos = envEnd !== -1 ? envEnd + `\\end{${env}}`.length : ctx.src.length;

      // Check for a trailing %!v:xxxx UUID anchor right after \end{env}
      let listUuid: string | null = null;
      if (env === "itemize" || env === "enumerate") {
        const afterEnd = ctx.src.slice(ctx.pos);
        const uuidMatch = afterEnd.match(/^[ \t]*%!v:([0-9a-f]{4})/);
        if (uuidMatch) {
          listUuid = uuidMatch[1];
          ctx.pos += uuidMatch[0].length;
        }
      }

      switch (env) {
        case "verbatim":
          parent.content.push({
            type: "codeBlock",
            content: [{ type: "text", text: envContent.trim() }],
          });
          break;
        case "quote":
          {
            const quoteDoc: JSONContent = { type: "blockquote", content: [] };
            const quoteCtx: ParseContext = { pos: 0, src: envContent.trim() };
            parseBody(quoteCtx, quoteDoc);
            parent.content.push(quoteDoc);
          }
          break;
        case "itemize": {
          const listNode = parseList(envContent, "bulletList");
          if (listUuid) {
            if (!listNode.attrs) listNode.attrs = {};
            listNode.attrs.uuid = listUuid;
          }
          parent.content.push(listNode);
          break;
        }
        case "enumerate": {
          const listNode = parseList(envContent, "orderedList");
          if (listUuid) {
            if (!listNode.attrs) listNode.attrs = {};
            listNode.attrs.uuid = listUuid;
          }
          parent.content.push(listNode);
          break;
        }
        default:
          // Unknown environment — preserve as grey monospace paragraph
          parent.content.push({
            type: "paragraph",
            content: [
              {
                type: "text",
                text: `\\begin{${env}}${optArg}${envContent}\\end{${env}}`,
                marks: [{ type: "latexCommand" }],
              },
            ],
          });
      }
      continue;
    }

    // % comment line
    if (rest.startsWith("%")) {
      // Virgil markers
      if (rest.startsWith("%!v:")) {
        const eol = ctx.src.indexOf("\n", ctx.pos);
        // Blank paragraph marker
        if (rest.startsWith("%!v:blank")) {
          ctx.pos = eol !== -1 ? eol + 1 : ctx.src.length;
          parent.content.push({ type: "paragraph" });
          continue;
        }
        // Skip UUID anchor comments silently
        ctx.pos = eol !== -1 ? eol + 1 : ctx.src.length;
        continue;
      }
      const eol = ctx.src.indexOf("\n", ctx.pos);
      const commentText = eol !== -1
        ? ctx.src.slice(ctx.pos + 1, eol).trim()
        : ctx.src.slice(ctx.pos + 1).trim();
      ctx.pos = eol !== -1 ? eol + 1 : ctx.src.length;
      parent.content.push({
        type: "latexComment",
        attrs: { text: commentText },
      });
      continue;
    }

    // \hrulefill
    if (rest.startsWith("\\hrulefill")) {
      parent.content.push({ type: "horizontalRule" });
      ctx.pos += "\\hrulefill".length;
      continue;
    }

    // \archivemarker{id}{preview} — handle at block level to avoid
    // readParagraph breaking on escaped backslashes inside the preview
    if (rest.startsWith("\\archivemarker{")) {
      const idArg = extractBraced(ctx.src, ctx.pos + "\\archivemarker".length);
      if (idArg !== null) {
        const previewArg = extractBraced(ctx.src, idArg.end);
        if (previewArg !== null) {
          parent.content.push({
            type: "paragraph",
            content: [{
              type: "archiveMarker",
              attrs: {
                archiveId: idArg.content,
                preview: previewArg.content.replace(/\\(\{|\}|\\)/g, "$1"),
              },
            }],
          });
          ctx.pos = previewArg.end;
          continue;
        }
      }
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
    const uuids = [...match[1].matchAll(/%!v:([0-9a-f]{4})/g)];
    const lastUuid = uuids.length > 0 ? uuids[uuids.length - 1][1] : null;
    return { text: cleaned, uuid: lastUuid };
  }
  return { text, uuid: null };
}

function parseList(content: string, type: string): JSONContent {
  const items: JSONContent[] = [];
  const itemRegex = /\\item\s*/g;
  let match;
  const positions: number[] = [];

  while ((match = itemRegex.exec(content)) !== null) {
    positions.push(match.index + match[0].length);
  }

  for (let i = 0; i < positions.length; i++) {
    const start = positions[i];
    const end = i + 1 < positions.length ? positions[i + 1] - 6 : content.length; // approximate
    const itemText = content.slice(start, end).trim();
    const itemContent = parseInlineContent(itemText);
    items.push({
      type: "listItem",
      content: [{ type: "paragraph", content: itemContent }],
    });
  }

  return { type, content: items };
}

function skipWhitespace(ctx: ParseContext): void {
  while (ctx.pos < ctx.src.length && /\s/.test(ctx.src[ctx.pos])) {
    ctx.pos++;
  }
}

function readParagraph(ctx: ParseContext): string {
  let result = "";
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
    if (ctx.src[ctx.pos] === "\\" && result.trim()) {
      const rest = ctx.src.slice(ctx.pos);
      if (
        /^\\(section|subsection|subsubsection|begin|end|\[|hrulefill|title|author|date|maketitle|noindent|vspace|hspace|newcounter|setcounter|renewcommand|newcommand|usepackage|bibliographystyle|bibliography|tableofcontents|appendix|clearpage|newpage|par)\b/.test(
          rest
        )
      ) {
        break;
      }
    }

    result += ctx.src[ctx.pos];
    ctx.pos++;
  }
  return result.trim();
}
