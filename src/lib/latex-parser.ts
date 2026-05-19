import { JSONContent } from "@tiptap/react";
import type { VirgilSidecar } from "@/lib/types";
import { richLatexToJson } from "@/lib/footnote-content";
import { CITE_NAMES_RE_INLINE, MULTI_CITE_NAMES } from "@/lib/cite-commands";
import { generateShortId, NODE_UUID_ANCHOR, NODE_UUID_REGEX } from "@/lib/uuid";

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
 * the editor. Each returned node is flagged `fromPreamble: true` so
 * the serializer knows to emit it back into the preamble.
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
      attrs: { field, rawPrefix: rawPrefix || null, isToday, uuid, fromPreamble: true },
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
 * we stash the id in `pendingFootnoteId` / `pendingCitationId`; the next
 * matching entity consumes it. Without these markers we fall back to
 * `generateShortId()` for legacy `.tex` files without markers — first
 * save will anchor the generated id back into the source.
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
              footnoteId: pendingFootnoteId || generateShortId(),
            },
          });
          pendingFootnoteId = null;
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
              footnoteId: pendingFootnoteId || generateShortId(),
              thanks: true,
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
                citationId: pendingCitationId || generateShortId(),
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
                  citationId: pendingCitationId || generateShortId(),
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

  // Number footnotes sequentially
  numberFootnotes(doc);

  // Assign hierarchical section numbers
  numberHeadings(doc);

  // Number expex examples (and assign sub-labels to items) so that
  // `resolveRefs` can look up their numbers.
  numberExamples(doc);

  // Resolve \ref / \getref / \getfullref display text
  resolveRefs(doc);

  // Merge sidecar titles into paragraph nodes by UUID
  if (sidecar) {
    mergeSidecarTitles(doc, sidecar);
  }

  return doc;
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
function resolveRefs(node: JSONContent): void {
  const headingMap = new Map<string, string>();
  const exampleMap = new Map<
    string,
    { number: string; items: Map<string, string> }
  >();

  function collect(n: JSONContent) {
    if (n.type === "heading" && n.attrs?.label && n.attrs?.sectionNumber) {
      headingMap.set(n.attrs.label as string, n.attrs.sectionNumber as string);
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

    // \vexid{uuid} — no-op marker carrying a stable exampleId for the next
    // \ex / \pex we encounter in block context. Emitted by the serializer.
    const vexidBlockMatch = rest.match(/^\\vexid\{/);
    if (vexidBlockMatch) {
      const idArg = extractBraced(ctx.src, ctx.pos + "\\vexid".length);
      if (idArg !== null) {
        ctx.pendingExampleId = idArg.content || null;
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
      // Optional [opts] — preserved-but-ignored for now
      if (ctx.src[ctx.pos] === "[") {
        const close = ctx.src.indexOf("]", ctx.pos);
        if (close !== -1) ctx.pos = close + 1;
      }
      const bodyStart = ctx.pos;
      const endIdx = ctx.src.indexOf("\\endgl", bodyStart);
      const bodyText =
        endIdx !== -1 ? ctx.src.slice(bodyStart, endIdx) : ctx.src.slice(bodyStart);
      ctx.pos = endIdx !== -1 ? endIdx + "\\endgl".length : ctx.src.length;
      const glossNode = buildGlossFromBody(bodyText);
      parent.content.push(glossNode);
      continue;
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
        /^\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph|begin|end|\[|hrulefill|title|author|date|maketitle|noindent|vspace|hspace|newcounter|setcounter|renewcommand|newcommand|usepackage|bibliographystyle|bibliography|tableofcontents|appendix|clearpage|newpage|par|ex|pex|xe|vexid|begingl|endgl)\b/.test(
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

// ---------------------------------------------------------------------------
// expex helpers
// ---------------------------------------------------------------------------

/** Scan for the `\end{xlist}` that closes the `\begin{xlist}` opened at
 *  `startPos`. Handles nested xlist environments by tracking depth.
 *  Returns the index of the backslash in `\end{xlist}`, or -1 if not
 *  found. */
function findMatchingXlistEnd(src: string, startPos: number): number {
  let depth = 1;
  let pos = startPos;
  while (pos < src.length) {
    if (src.startsWith("\\begin{xlist}", pos)) {
      depth++;
      pos += "\\begin{xlist}".length;
      continue;
    }
    if (src.startsWith("\\end{xlist}", pos)) {
      depth--;
      if (depth === 0) return pos;
      pos += "\\end{xlist}".length;
      continue;
    }
    pos++;
  }
  return -1;
}

/** Scan for the `\xe` that closes the `\ex`/`\pex` opened just before
 *  `startPos`. Handles nested `\ex`/`\pex` by tracking depth. Returns the
 *  index of the backslash in `\xe`, or -1 if not found. */
function findMatchingXe(src: string, startPos: number): number {
  let depth = 1;
  let pos = startPos;
  while (pos < src.length) {
    if (src[pos] !== "\\") {
      pos++;
      continue;
    }
    const tail = src.slice(pos);
    const openMatch = tail.match(/^\\(ex|pex)\b/);
    if (openMatch) {
      depth++;
      pos += openMatch[0].length;
      continue;
    }
    const closeMatch = tail.match(/^\\xe\b/);
    if (closeMatch) {
      depth--;
      if (depth === 0) return pos;
      pos += closeMatch[0].length;
      continue;
    }
    pos++;
  }
  return -1;
}

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
    text: string;
  }>;
} {
  const items: Array<{
    tag: string;
    label: string;
    exnoOverride: string | null;
    text: string;
  }> = [];
  let preamble = "";
  let pos = 0;
  let firstAt = -1;
  let current: {
    tag: string;
    label: string;
    exnoOverride: string | null;
    start: number;
  } | null = null;

  const flushCurrent = (endPos: number) => {
    if (!current) return;
    items.push({
      tag: current.tag,
      label: current.label,
      exnoOverride: current.exnoOverride,
      text: body.slice(current.start, endPos).trim(),
    });
    current = null;
  };

  while (pos < body.length) {
    // Skip nested \begingl … \endgl, nested \ex/\pex blocks, and nested
    // \begin{xlist} … \end{xlist} so their internal \a markers don't get
    // confused with ours at the current tier.
    if (body.startsWith("\\begingl", pos)) {
      const endIdx = body.indexOf("\\endgl", pos + "\\begingl".length);
      pos = endIdx === -1 ? body.length : endIdx + "\\endgl".length;
      continue;
    }
    if (body.startsWith("\\begin{xlist}", pos)) {
      const xlistEnd = findMatchingXlistEnd(body, pos + "\\begin{xlist}".length);
      pos = xlistEnd === -1 ? body.length : xlistEnd + "\\end{xlist}".length;
      continue;
    }
    const exStart = body.slice(pos).match(/^\\(ex|pex)\b/);
    if (exStart) {
      pos += exStart[0].length;
      const innerEnd = findMatchingXe(body, pos);
      pos = innerEnd === -1 ? body.length : innerEnd + "\\xe".length;
      continue;
    }
    // Top-level \a with word-boundary
    if (body.startsWith("\\a", pos)) {
      const after = body[pos + 2];
      const isAccent = after === " " && /[a-zA-Z]/.test(body[pos + 3] || "");
      // `\a ` followed by a single letter is the LaTeX accent, not a part
      // marker. Real part markers are `\a<tag>`, `\a[opts]`, `\a\label`, or
      // `\a` at end of line followed by content. Heuristic: treat as part
      // marker unless followed by " X" where X is a single letter and then
      // whitespace/non-letter (true accent).
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
        current = { tag, label, exnoOverride, start: cursor };
        pos = cursor;
        continue;
      }
      void isAccent;
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
    // Parse the body as a sequence of paragraphs + glosses.
    const inner = parseExampleBodyAsBlocks(body);
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
      itemNodes.push(buildExampleItemFromText(item.tag, item.label, item.text));
    }
    if (itemNodes.length === 0) {
      itemNodes.push({
        type: "exampleItem",
        attrs: { tag: "", label: "", subLabel: "" },
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
 *  `paragraph+ exampleItemList? exampleGloss?`. */
function buildExampleItemFromText(
  tag: string,
  label: string,
  text: string,
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
    const innerEnd = findMatchingXlistEnd(stripped, innerStart);
    if (innerEnd !== -1) {
      const innerBody = stripped.slice(innerStart, innerEnd);
      nestedList = buildExampleItemListFromBody(innerBody);
      stripped =
        stripped.slice(0, xlistOpen) +
        stripped.slice(innerEnd + "\\end{xlist}".length);
    }
  }

  const itemContent = parseExampleBodyAsBlocks(stripped);
  const normalized: JSONContent[] = [];
  const paragraphs = itemContent.filter((n) => n.type === "paragraph");
  const glosses = itemContent.filter((n) => n.type === "exampleGloss");
  if (paragraphs.length === 0) normalized.push({ type: "paragraph" });
  else normalized.push(...paragraphs);
  if (nestedList) normalized.push(nestedList);
  if (glosses.length > 0) normalized.push(glosses[0]);

  return {
    type: "exampleItem",
    attrs: { tag, label, subLabel: "" },
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
    itemNodes.push(buildExampleItemFromText(item.tag, item.label, item.text));
  }
  if (itemNodes.length === 0) {
    itemNodes.push({
      type: "exampleItem",
      attrs: { tag: "", label: "", subLabel: "" },
      content: [{ type: "paragraph" }],
    });
  }
  return { type: "exampleItemList", content: itemNodes };
}

/** Parse an example body fragment (between `\ex`/`\pex` and `\xe`, or between
 *  consecutive `\a` markers) as a sequence of paragraph + gloss blocks. */
function parseExampleBodyAsBlocks(body: string): JSONContent[] {
  const sub: JSONContent = { type: "__scratch", content: [] };
  const subCtx: ParseContext = { pos: 0, src: body };
  parseBody(subCtx, sub);
  const out: JSONContent[] = [];
  for (const child of sub.content || []) {
    // Only keep paragraph + exampleGloss children; anything else collapses
    // to an inline latex-command fallback paragraph.
    if (child.type === "paragraph" || child.type === "exampleGloss") {
      out.push(child);
      continue;
    }
    out.push({
      type: "paragraph",
      content: [{ type: "text", text: body.trim(), marks: [{ type: "latexCommand" }] }],
    });
    break;
  }
  return out;
}

/** Parse a `\begingl … \endgl` body into an `exampleGloss` node with
 *  `alignedGlossRow` + `proseGlossRow` children. */
function buildGlossFromBody(body: string): JSONContent {
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
    attrs: { glossId: null, colCount: maxCells },
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
      // Non-whitespace run up to next space
      const start = i;
      while (i < src.length && !/\s/.test(src[i])) i++;
      token = src.slice(start, i);
    }
    cells.push({
      type: "glossCell",
      content: parseInlineContent(token),
    });
  }
  return cells;
}
