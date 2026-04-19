import { JSONContent } from "@tiptap/react";
import type { VirgilSidecar } from "@/lib/types";
import { richLatexToJson } from "@/lib/footnote-content";
import { CITE_NAMES_RE_INLINE, MULTI_CITE_NAMES } from "@/lib/cite-commands";
import { generateEntityId, NODE_UUID_ANCHOR, NODE_UUID_REGEX } from "@/lib/uuid";

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

/**
 * Parse a run of inline LaTeX into Tiptap inline nodes.
 *
 * `\vfid{uuid}` and `\vcid{uuid}` are no-op markers the serializer emits
 * right before `\footnote{...}` / `\cite{...}` to preserve stable
 * `footnoteId` / `citationId` values across parse cycles. When we see one,
 * we stash the id in `pendingFootnoteId` / `pendingCitationId`; the next
 * matching entity consumes it. Without these markers we fall back to
 * `generateEntityId()` (current behavior for legacy `.tex` files that
 * haven't been re-saved yet).
 */
function parseInlineContent(text: string): JSONContent[] {
  const nodes: JSONContent[] = [];
  let i = 0;
  let buffer = "";
  let pendingFootnoteId: string | null = null;
  let pendingCitationId: string | null = null;

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

      // \vfid{uuid} — no-op marker stashing a stable footnoteId for the
      // next \footnote{...} in the stream. Emitted by the serializer.
      const vfidMatch = rest.match(/^\\vfid\{/);
      if (vfidMatch) {
        const idArg = extractBraced(text, i + "\\vfid".length);
        if (idArg !== null) {
          pendingFootnoteId = idArg.content || null;
          i = idArg.end;
          continue;
        }
      }

      // \vcid{uuid} — same, for citationId.
      const vcidMatch = rest.match(/^\\vcid\{/);
      if (vcidMatch) {
        const idArg = extractBraced(text, i + "\\vcid".length);
        if (idArg !== null) {
          pendingCitationId = idArg.content || null;
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
              footnoteId: pendingFootnoteId || generateEntityId(),
            },
          });
          pendingFootnoteId = null;
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
      // Longer names must come first to avoid partial matches.
      // CITE_NAMES_RE is shared with bib-parser.ts and tiptap-extensions.ts.
      const citeMatch = rest.match(CITE_NAMES_RE_INLINE);
      if (citeMatch) {
        flush();
        let pos = i + citeMatch[0].length;
        let fullCmd = citeMatch[0];
        const cmdLower = citeMatch[1].toLowerCase();
        const isMultiCite =
          cmdLower.endsWith("s") &&
          MULTI_CITE_NAMES.has(cmdLower);

        if (isMultiCite) {
          // Biblatex multi-cite: \cites[pre1][post1]{key1}[pre2][post2]{key2}
          // Consume groups of optional [pre][post] followed by {key}.
          let found = false;
          while (pos < text.length) {
            const savedPos = pos;
            // Optional [pre][post] before this key
            let bracketsStr = "";
            for (let bcount = 0; bcount < 2 && pos < text.length && text[pos] === "["; bcount++) {
              const closeBracket = text.indexOf("]", pos);
              if (closeBracket === -1) break;
              bracketsStr += text.slice(pos, closeBracket + 1);
              pos = closeBracket + 1;
            }
            // Mandatory {key}
            if (pos < text.length && text[pos] === "{") {
              const inner = extractBraced(text, pos);
              if (inner !== null) {
                fullCmd += bracketsStr + "{" + inner.content + "}";
                pos = inner.end;
                found = true;
                continue;
              }
            }
            // No key after optional brackets — restore and stop
            pos = savedPos;
            break;
          }
          if (found) {
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
        } else {
          // Single-key form (natbib or biblatex singular):
          // \cmd[pre][post]{keys}
          for (let optCount = 0; optCount < 2 && pos < text.length && text[pos] === "["; optCount++) {
            const closeBracket = text.indexOf("]", pos);
            if (closeBracket !== -1) {
              fullCmd += text.slice(pos, closeBracket + 1);
              pos = closeBracket + 1;
            } else {
              break;
            }
          }
          if (pos < text.length && text[pos] === "{") {
            const inner = extractBraced(text, pos);
            if (inner !== null) {
              fullCmd += "{" + inner.content + "}";
              nodes.push({
                type: "citation",
                attrs: {
                  citationId: pendingCitationId || generateEntityId(),
                  command: fullCmd,
                  displayText: "",
                },
              });
              pendingCitationId = null;
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

      // \ref{key} — cross-reference to a \label
      const refMatch = rest.match(/^\\ref\{/);
      if (refMatch) {
        flush();
        const inner = extractBraced(text, i + refMatch[0].length - 1);
        if (inner) {
          nodes.push({
            type: "labelRef",
            attrs: { label: inner.content, displayText: "" },
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

  // Assign hierarchical section numbers
  numberHeadings(doc);

  // Resolve \ref{} display text from heading labels
  resolveRefs(doc);

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

/** Assign hierarchical section numbers (e.g. "1", "2.3", "2.3.1") to heading nodes. */
function numberHeadings(node: JSONContent): void {
  // First pass: find the highest heading level used (chapter=1, section=2, …)
  let topLevel = 5;
  function findTop(n: JSONContent) {
    if (n.type === "heading" && n.attrs?.numbered !== false) {
      const lvl = (n.attrs?.level as number) || 2;
      if (lvl < topLevel) topLevel = lvl;
    }
    n.content?.forEach(findTop);
  }
  findTop(node);
  if (topLevel > 4) return; // no numbered headings

  const counters = [0, 0, 0, 0]; // indices 0–3 → levels 1–4

  function walk(n: JSONContent) {
    if (n.type === "heading") {
      if (n.attrs?.numbered !== false) {
        const lvl = (n.attrs?.level as number) || 2;
        const idx = lvl - 1;
        counters[idx]++;
        for (let i = idx + 1; i < 4; i++) counters[i] = 0;
        const parts: number[] = [];
        for (let i = topLevel - 1; i <= idx; i++) parts.push(counters[i]);
        n.attrs = { ...n.attrs, sectionNumber: parts.join(".") };
      } else {
        n.attrs = { ...n.attrs, sectionNumber: null };
      }
    }
    n.content?.forEach(walk);
  }
  walk(node);
}

/** Resolve \ref{label} nodes: build label→sectionNumber map from headings, then fill displayText. */
function resolveRefs(node: JSONContent): void {
  const labelMap = new Map<string, string>();
  // Collect labels from headings
  function collect(n: JSONContent) {
    if (n.type === "heading" && n.attrs?.label && n.attrs?.sectionNumber) {
      labelMap.set(n.attrs.label as string, n.attrs.sectionNumber as string);
    }
    n.content?.forEach(collect);
  }
  collect(node);
  // Fill displayText on labelRef nodes
  function fill(n: JSONContent) {
    if (n.type === "labelRef" && n.attrs?.label) {
      const num = labelMap.get(n.attrs.label as string);
      n.attrs = { ...n.attrs, displayText: num || "??" };
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

    // \chapter{...}, \section{...}, \section*{...}, etc.
    const sectionMatch = rest.match(/^\\(chapter|section|subsection|subsubsection)(\*?)\{/);
    if (sectionMatch) {
      const level =
        sectionMatch[1] === "chapter"
          ? 1
          : sectionMatch[1] === "section"
            ? 2
            : sectionMatch[1] === "subsection"
              ? 3
              : 4;
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


    // Display math \[...\]
    if (rest.startsWith("\\[")) {
      const endMath = ctx.src.indexOf("\\]", ctx.pos + 2);
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

    // \begin{...}[optional]
    const beginMatch = rest.match(/^\\begin\{(\w+)\}(\[[^\]]*\])?/);
    if (beginMatch) {
      const env = beginMatch[1];
      const optArg = beginMatch[2] || "";
      ctx.pos += beginMatch[0].length;
      // Find the matching \end{env}, accounting for nested \begin{env}/\end{env}
      const envEnd = findMatchingEnd(ctx.src, ctx.pos, env);
      const envContent =
        envEnd !== -1
          ? ctx.src.slice(ctx.pos, envEnd)
          : ctx.src.slice(ctx.pos);
      ctx.pos = envEnd !== -1 ? envEnd + `\\end{${env}}`.length : ctx.src.length;

      // Check for a trailing %!v:xxxx UUID anchor right after \end{env}
      let envUuid: string | null = null;
      if (env === "itemize" || env === "enumerate" || env === "verbatim" || env === "quote") {
        const afterEnd = ctx.src.slice(ctx.pos);
        const uuidMatch = afterEnd.match(NODE_UUID_ANCHOR);
        if (uuidMatch) {
          envUuid = uuidMatch[1];
          ctx.pos += uuidMatch[0].length;
        }
      }

      switch (env) {
        case "verbatim": {
          const codeNode: JSONContent = {
            type: "codeBlock",
            content: [{ type: "text", text: envContent.trim() }],
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
      const rawComment = eol !== -1
        ? ctx.src.slice(ctx.pos + 1, eol).trim()
        : ctx.src.slice(ctx.pos + 1).trim();
      ctx.pos = eol !== -1 ? eol + 1 : ctx.src.length;
      // Strip trailing %!v:xxxx UUID anchor from comment text
      const { text: commentText, uuid: commentUuid } = stripUuidAnchor(rawComment);
      parent.content.push({
        type: "latexComment",
        attrs: { text: commentText, ...(commentUuid ? { uuid: commentUuid } : {}) },
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
    const uuids = [...match[1].matchAll(new RegExp(NODE_UUID_REGEX.source, "g"))];
    const lastUuid = uuids.length > 0 ? uuids[uuids.length - 1][1] : null;
    return { text: cleaned, uuid: lastUuid };
  }
  return { text, uuid: null };
}

/**
 * Find the position (index of "\") of the \end{env} that matches the
 * already-opened \begin{env} just before `startPos`. Returns -1 if no
 * matching close is found. Properly handles nested \begin{env}…\end{env}.
 */
function findMatchingEnd(src: string, startPos: number, env: string): number {
  const beginTok = `\\begin{${env}}`;
  const endTok = `\\end{${env}}`;
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

/**
 * Split list-environment content into individual item slices, respecting
 * nested itemize/enumerate environments. Each returned string is the text
 * between an `\item` and the next sibling `\item` (or end of content),
 * with surrounding whitespace trimmed.
 *
 * Also returns any "preamble" — content that appears before the first
 * `\item` (e.g. `\itemsep`, `\setlength`, custom commands).  This content
 * is invisible in the editor but preserved across round-trips.
 */
function splitListItems(content: string): { items: string[]; preamble: string } {
  const items: string[] = [];
  let pos = 0;
  // Index where the current item's body starts (-1 = before any \item)
  let currentStart = -1;
  // Track where the first \item is so we can extract the preamble
  let firstItemPos = -1;
  while (pos < content.length) {
    // Skip past nested list environments — \item markers inside them
    // belong to the inner list, not the current one.
    if (content.startsWith("\\begin{itemize}", pos)) {
      pos += "\\begin{itemize}".length;
      const inner = findMatchingEnd(content, pos, "itemize");
      pos = inner === -1 ? content.length : inner + "\\end{itemize}".length;
      continue;
    }
    if (content.startsWith("\\begin{enumerate}", pos)) {
      pos += "\\begin{enumerate}".length;
      const inner = findMatchingEnd(content, pos, "enumerate");
      pos = inner === -1 ? content.length : inner + "\\end{enumerate}".length;
      continue;
    }
    // Look for \item at depth 0 (must be word-boundary so \items etc. don't match)
    if (content.startsWith("\\item", pos)) {
      const after = content[pos + 5];
      if (after === undefined || /[\s\W]/.test(after)) {
        if (firstItemPos === -1) firstItemPos = pos;
        if (currentStart >= 0) {
          items.push(content.slice(currentStart, pos).trim());
        }
        pos += 5;
        // Consume the optional [label] argument and trailing whitespace
        while (pos < content.length && /[ \t]/.test(content[pos])) pos++;
        if (content[pos] === "[") {
          const close = content.indexOf("]", pos);
          if (close !== -1) pos = close + 1;
        }
        while (pos < content.length && /[ \t]/.test(content[pos])) pos++;
        currentStart = pos;
        continue;
      }
    }
    pos++;
  }
  if (currentStart >= 0) {
    items.push(content.slice(currentStart).trim());
  }
  // Extract preamble: everything before the first \item, trimmed
  const preamble = firstItemPos > 0 ? content.slice(0, firstItemPos).trim() : "";
  return { items, preamble };
}

function parseList(content: string, type: string): JSONContent {
  const items: JSONContent[] = [];
  const { items: itemTexts, preamble } = splitListItems(content);

  for (const itemText of itemTexts) {
    // Parse the item body as a block sequence so nested itemize/enumerate
    // become real list nodes, not unknown commands. parseBody emits
    // paragraphs for plain text and bulletList/orderedList for nested envs.
    const itemDoc: JSONContent = { type: "listItem", content: [] };
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
        /^\\(chapter|section|subsection|subsubsection|begin|end|\[|hrulefill|title|author|date|maketitle|noindent|vspace|hspace|newcounter|setcounter|renewcommand|newcommand|usepackage|bibliographystyle|bibliography|tableofcontents|appendix|clearpage|newpage|par)\b/.test(
          rest
        )
      ) {
        // Don't break if the previous content ends with \\ (a hardBreak
        // continuation from shift+enter). Otherwise multi-line LaTeX joined by
        // soft line breaks would get split into separate paragraphs on reload.
        if (!/\\\\\s*$/.test(result)) {
          break;
        }
      }
    }

    result += ctx.src[ctx.pos];
    ctx.pos++;
  }
  return result.trim();
}
