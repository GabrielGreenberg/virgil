import { JSONContent } from "@tiptap/react";
import type { VirgilSidecar } from "@/lib/types";
import { generateShortId } from "@/lib/uuid";
import { richJsonToLatex, richJsonToPlainText, normalizeRichContent } from "@/lib/footnote-content";
import { CLASSIC_PREAMBLE } from "@/lib/document-styles";

// The classic preset is the historical default — used as the fallback
// when a doc has no preserved preamble and the caller didn't pass one.
const DEFAULT_PREAMBLE = CLASSIC_PREAMBLE;

// Node types that carry a `uuid` attr — kept as a local list because the
// serializer operates on JSONContent without access to the live schema.
// Mirror the `textObject` schema group declared in Editor.tsx / tiptap
// node specs. Adding a kind to that group requires adding it here too.
const UUID_BEARING_NODE_TYPES = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "codeBlock",
  "displayMath",
  "latexComment",
  "titleField",
  "texBlock",
  "figureBlock",
  "graphicsBlock",
  "exampleBlock",
  "exampleItem",
]);

const DEFAULT_POSTAMBLE = `
\\end{document}
`;

/**
 * If the preserved user preamble doesn't already declare `\vfid`/`\vcid`,
 * inject `\providecommand` definitions for them right before
 * `\begin{document}`. Virgil emits these markers inline to carry stable
 * UUIDs for footnotes/citations across parse cycles; without a matching
 * declaration in the preamble, LaTeX compilation fails with "Undefined
 * control sequence."
 */
function ensureVirgilCommands(preamble: string): string {
  const hasVfid = /\\(?:provide|new|renew)command\{\\vfid\}/.test(preamble);
  const hasVcid = /\\(?:provide|new|renew)command\{\\vcid\}/.test(preamble);
  // `\vbid` marks a bibliography entry's durable surrogate id (in the `.bib`,
  // round-tripped by serializeBibFile). It never appears in this `.tex`, but
  // we declare the no-op so a `.bib` `\input` or a paper opened in raw LaTeX
  // never breaks — mirrors the inline-atom `\vcid`/`\vfid` guards.
  const hasVbid = /\\(?:provide|new|renew)command\{\\vbid\}/.test(preamble);
  const hasVexid = /\\(?:provide|new|renew)command\{\\vexid\}/.test(preamble);
  const hasVxid = /\\(?:provide|new|renew)command\{\\vxid\}/.test(preamble);
  const hasVlid = /\\(?:provide|new|renew)command\{\\vlid\}/.test(preamble);
  const hasVlidend = /\\(?:provide|new|renew)command\{\\vlidend\}/.test(preamble);
  // xcolor is needed for `\textcolor[HTML]{...}` emitted by the textColor
  // mark. New docs get it from CLASSIC_PREAMBLE; older docs get it
  // injected lazily on first save.
  const hasXcolor = /\\usepackage(?:\[[^\]]*\])?\{xcolor\}/.test(preamble);
  if (
    hasVfid &&
    hasVcid &&
    hasVbid &&
    hasVexid &&
    hasVxid &&
    hasVlid &&
    hasVlidend &&
    hasXcolor
  )
    return preamble;

  const beginMarker = "\\begin{document}";
  const beginIdx = preamble.indexOf(beginMarker);
  if (beginIdx === -1) return preamble;

  const additions: string[] = [];
  // Packages first, then `\providecommand`s — conventional preamble order.
  if (!hasXcolor) additions.push("\\usepackage{xcolor}");
  if (!hasVfid) additions.push("\\providecommand{\\vfid}[1]{}");
  if (!hasVcid) additions.push("\\providecommand{\\vcid}[1]{}");
  if (!hasVbid) additions.push("\\providecommand{\\vbid}[1]{}");
  if (!hasVexid) additions.push("\\providecommand{\\vexid}[1]{}");
  if (!hasVxid) additions.push("\\providecommand{\\vxid}[1]{}");
  if (!hasVlid) additions.push("\\providecommand{\\vlid}[1]{}");
  if (!hasVlidend) additions.push("\\providecommand{\\vlidend}[1]{}");

  const before = preamble.slice(0, beginIdx).replace(/\s*$/, "");
  const after = preamble.slice(beginIdx);
  return before + "\n\n" + additions.join("\n") + "\n\n" + after;
}

function serializeMarks(
  text: string,
  marks?: { type: string; attrs?: Record<string, unknown> }[]
): string {
  if (!marks || marks.length === 0) return escapeLatex(text);

  // latexCommand mark: text is already raw LaTeX — return as-is, except
  // that uncompilable ASCII / smart quotes get smart-LaTeX-ified so they
  // round-trip to a valid `.tex` even when the mark has been inherited
  // onto stray text by Tiptap's default mark-extension behavior.
  if (marks.some((m) => m.type === "latexCommand")) {
    return text
      .replace(/“/g, "``")
      .replace(/”/g, "''")
      .replace(/(^|[\s([{—–])"/g, "$1``")
      .replace(/"/g, "''");
  }

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
      case "textColor": {
        const c = (mark.attrs?.color as string | undefined) ?? "";
        // \textcolor[HTML] expects 6 uppercase hex digits, no leading "#".
        const hex = c.replace(/^#/, "").toUpperCase();
        if (/^[0-9A-F]{6}$/.test(hex)) {
          result = `\\textcolor[HTML]{${hex}}{${result}}`;
        }
        break;
      }
    }
  }
  return result;
}

function escapeLatex(text: string): string {
  // Don't escape backslashes — they're intentional LaTeX commands.
  // The editor preserves raw LaTeX, so we only escape the few chars
  // that would break LaTeX if they appeared as literal text.
  // We also don't escape {, }, $ since those are part of LaTeX syntax.
  return text
    .replace(/(?<!\\)([&%#_])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/“/g, "``")
    .replace(/”/g, "''")
    // Straight `"` → smart LaTeX pair. Opening if at start or after
    // whitespace / opening punctuation; otherwise closing.
    .replace(/(^|[\s([{—–])"/g, "$1``")
    .replace(/"/g, "''");
}

function serializeTitleField(node: JSONContent): string {
  const field = node.attrs?.field as string;
  const rawPrefix = (node.attrs?.rawPrefix as string) || "";
  const uuid = node.attrs?.uuid as string | null;
  const anchor = uuid ? ` %!v:${uuid}` : "";
  if (node.attrs?.isToday) {
    return `\\${field}{\\today}${anchor}\n`;
  }
  const inner = serializeInlineSequence(node.content || []);
  return `\\${field}{${rawPrefix}${inner}}${anchor}\n`;
}

function collectPreambleTitleFields(doc: JSONContent): JSONContent[] {
  // Walk the whole doc tree and collect every titleField. Title/author/
  // date are ALWAYS preamble residents — that's their LaTeX semantics —
  // so we don't gate on a per-node flag. Dedup by `field` (first
  // occurrence wins) and emit in canonical title → author → date order,
  // mirroring `hoistTitleFieldsToTop` in the parser.
  const order: Record<string, number> = { title: 0, author: 1, date: 2 };
  const out: JSONContent[] = [];
  const seen = new Set<string>();
  function walk(n: JSONContent) {
    if (n.type === "titleField") {
      const field = n.attrs?.field as string | undefined;
      if (field && !seen.has(field)) {
        seen.add(field);
        out.push(n);
      }
    }
    n.content?.forEach(walk);
  }
  walk(doc);
  out.sort(
    (a, b) =>
      (order[a.attrs?.field as string] ?? 99) -
      (order[b.attrs?.field as string] ?? 99),
  );
  return out;
}

function injectTitleFieldsIntoPreamble(preamble: string, titleFields: JSONContent[]): string {
  if (titleFields.length === 0) return preamble;
  const block = titleFields.map(serializeTitleField).join("") + "\n";
  const beginMarker = "\\begin{document}";
  const idx = preamble.indexOf(beginMarker);
  if (idx === -1) return preamble + block;
  const before = preamble.slice(0, idx).replace(/\s*$/, "");
  const after = preamble.slice(idx);
  return before + "\n\n" + block + after;
}

function serializeNode(node: JSONContent, suppressChildUuids = false, listDepth = 0): string {
  switch (node.type) {
    case "doc":
      return (node.content || []).map((n) => serializeNode(n)).join("");

    case "paragraph": {
      if (!node.content || node.content.length === 0) {
        if (suppressChildUuids) return "";
        // Preserve the paragraph's UUID even when empty — archive snippets
        // anchor on UUIDs, and load-bearing empty paragraphs (left behind
        // by archive) need to round-trip without losing their identity.
        const uuid = node.attrs?.uuid as string | null;
        return uuid ? `%!v:${uuid}\n` : "%!v:blank\n";
      }
      const inner = serializeInlineSequence(node.content || []);
      if (suppressChildUuids) return inner;
      const uuid = node.attrs?.uuid as string | null;
      const anchor = uuid ? ` %!v:${uuid}` : "";
      return inner + anchor + "\n\n";
    }

    case "heading": {
      const rawLevel = node.attrs?.level;
      const level = typeof rawLevel === "number" ? rawLevel : 1;
      const label = node.attrs?.label as string | null;
      const uuid = node.attrs?.uuid as string | null;
      const numbered = node.attrs?.numbered;
      const inner = serializeInlineSequence(node.content || []);
      // Indexed by level 0..6 directly.
      const commands = ["\\part", "\\chapter", "\\section", "\\subsection", "\\subsubsection", "\\paragraph", "\\subparagraph"];
      const clampedLevel = Math.max(0, Math.min(level, 6));
      const cmd = commands[clampedLevel];
      const star = numbered === false ? "*" : "";
      const labelStr = label ? `\n\\label{${label}}` : "";
      const anchor = uuid ? ` %!v:${uuid}` : "";
      return `${cmd}${star}{${inner}}${labelStr}${anchor}\n\n`;
    }

    case "titleField": {
      // Title/author/date always round-trip via the preamble. The body
      // walk produces nothing; `serializeToLatex` collects every
      // titleField in the tree and injects them into the preamble via
      // `collectPreambleTitleFields` + `injectTitleFieldsIntoPreamble`.
      return "";
    }

    case "maketitleMarker": {
      const uuid = node.attrs?.uuid as string | null;
      const anchor = uuid ? ` %!v:${uuid}` : "";
      return `\\maketitle${anchor}\n\n`;
    }

    case "codeBlock": {
      const inner = serializeInlineSequence(node.content || []);
      const uuid = node.attrs?.uuid as string | null;
      const anchor = uuid ? ` %!v:${uuid}` : "";
      return `\\begin{verbatim}\n${inner}\n\\end{verbatim}${anchor}\n\n`;
    }

    case "texBlock": {
      // Raw LaTeX passthrough. Contents emit verbatim between comment
      // sentinels so the compiler runs them as LaTeX; the parser
      // recovers them by matching uuid. We escape any literal
      // `%!vtex:end` in the body so a pasted snippet can't terminate
      // the block early.
      const uuid = (node.attrs?.uuid as string) || "";
      const rawCode = (node.attrs?.code as string) || "";
      const escaped = rawCode.replace(/%!vtex:end/g, "%!v tex:end");
      return `%!vtex:begin ${uuid}\n${escaped}\n%!vtex:end ${uuid}\n\n`;
    }

    case "figureBlock": {
      // Rebuild the env body from structured attrs + the caption sub-node.
      // `extras` carries the env's unmodeled content (\centering, raw
      // \includegraphics, TikZ blocks, comments) captured at parse time;
      // \caption{...} and \label{...} are stripped before storing extras
      // so we don't double-emit them here.
      const placement = (node.attrs?.placement as string) ?? "";
      const starred = node.attrs?.starred === true;
      const uuid = node.attrs?.uuid as string | null;
      const label = (node.attrs?.label as string) ?? "";
      const extras = ((node.attrs?.extras as string) ?? "").replace(/\s+$/, "");
      const captionChild = (node.content || []).find(
        (c) => c.type === "figureCaption",
      );
      const captionTex = captionChild
        ? serializeInlineSequence(captionChild.content || [])
        : "";
      const anchor = uuid ? ` %!v:${uuid}` : "";
      const envName = starred ? "figure*" : "figure";
      const bodyParts: string[] = [];
      if (extras) {
        bodyParts.push("\n");
        bodyParts.push(extras);
      }
      if (captionChild) {
        bodyParts.push("\n  ");
        bodyParts.push(`\\caption{${captionTex}}`);
      }
      if (label) {
        bodyParts.push("\n  ");
        bodyParts.push(`\\label{${label}}`);
      }
      bodyParts.push("\n");
      return `\\begin{${envName}}${placement}${bodyParts.join("")}\\end{${envName}}${anchor}\n\n`;
    }

    case "graphicsBlock": {
      // Standalone `\includegraphics` — emit the verbatim command from
      // `command`, with the trailing UUID anchor if present.
      const command = (node.attrs?.command as string) ?? "";
      const uuid = node.attrs?.uuid as string | null;
      const anchor = uuid ? ` %!v:${uuid}` : "";
      return `${command}${anchor}\n\n`;
    }

    case "blockquote": {
      const inner = (node.content || []).map((n) => serializeNode(n, true)).join("");
      const uuid = node.attrs?.uuid as string | null;
      const anchor = uuid ? ` %!v:${uuid}` : "";
      return `\\begin{quote}\n${inner}\\end{quote}${anchor}\n\n`;
    }

    case "bulletList": {
      const items = (node.content || []).map((n) => serializeNode(n, false, listDepth)).join("");
      const uuid = node.attrs?.uuid as string | null;
      const preamble = node.attrs?.listPreamble as string | null;
      const anchor = uuid ? ` %!v:${uuid}` : "";
      const indent = "  ".repeat(listDepth);
      const innerIndent = indent + "  ";
      const preambleStr = preamble
        ? preamble.split("\n").map((l) => `${innerIndent}${l}`).join("\n") + "\n"
        : "";
      // Top-level list gets surrounding blank lines; nested lists do not.
      const trailing = listDepth === 0 ? "\n\n" : "\n";
      return `${indent}\\begin{itemize}\n${preambleStr}${items}${indent}\\end{itemize}${anchor}${trailing}`;
    }

    case "orderedList": {
      const items = (node.content || []).map((n) => serializeNode(n, false, listDepth)).join("");
      const uuid = node.attrs?.uuid as string | null;
      const preamble = node.attrs?.listPreamble as string | null;
      const anchor = uuid ? ` %!v:${uuid}` : "";
      const indent = "  ".repeat(listDepth);
      const innerIndent = indent + "  ";
      const preambleStr = preamble
        ? preamble.split("\n").map((l) => `${innerIndent}${l}`).join("\n") + "\n"
        : "";
      const trailing = listDepth === 0 ? "\n\n" : "\n";
      return `${indent}\\begin{enumerate}\n${preambleStr}${items}${indent}\\end{enumerate}${anchor}${trailing}`;
    }

    case "listItem": {
      // The schema is "paragraph block*" — first child is the inline body,
      // any further children are block-level (typically nested lists).
      const indent = "  ".repeat(listDepth + 1);
      const children = node.content || [];
      const head = children[0];
      const tail = children.slice(1);
      const headText =
        head && head.type === "paragraph"
          ? serializeInlineSequence(head.content || [])
          : "";
      const uuid = node.attrs?.uuid as string | null;
      const anchor = uuid ? ` %!v:${uuid}` : "";
      // Serialize trailing block children (nested lists, etc.) with bumped depth
      const tailText = tail
        .map((n) => serializeNode(n, false, listDepth + 1))
        .join("")
        .replace(/\n+$/, ""); // strip trailing blank lines from nested blocks
      if (tailText) {
        return `${indent}\\item ${headText}${anchor}\n${tailText}\n`;
      }
      return `${indent}\\item ${headText}${anchor}\n`;
    }

    case "horizontalRule":
      return "\\hrulefill\n\n";

    case "inlineMath":
      return `$${node.attrs?.latex || ""}$`;

    case "displayMath": {
      const uuid = node.attrs?.uuid as string | null;
      const anchor = uuid ? ` %!v:${uuid}` : "";
      return `\\[\n${node.attrs?.latex || ""}\n\\]${anchor}\n\n`;
    }

    case "footnote": {
      const fid = node.attrs?.footnoteId as string | undefined;
      const idMarker = fid ? `\\vfid{${fid}}` : "";
      const cmd = node.attrs?.thanks ? "thanks" : "footnote";
      return `${idMarker}\\${cmd}{${richJsonToLatex(normalizeRichContent(node.attrs?.content))}}`;
    }

    case "latexComment": {
      const uuid = node.attrs?.uuid as string | null;
      const anchor = uuid ? ` %!v:${uuid}` : "";
      return `% ${node.attrs?.text || ""}${anchor}\n`;
    }

    case "citation": {
      const cid = node.attrs?.citationId as string | undefined;
      const idMarker = cid ? `\\vcid{${cid}}` : "";
      return `${idMarker}${node.attrs?.command || ""}`;
    }

    case "labelRef":
      return serializeLabelRef(node);

    case "exampleBlock":
      return serializeExampleBlock(node);

    case "exampleItemList":
    case "exampleItem":
      // These are consumed by serializeExampleBlock / serializeExampleItem
      // contextually — the wrapper at top level has no LaTeX expansion of
      // its own, and items are emitted by their parent walk.
      return "";

    case "exampleGloss":
      return serializeExampleGloss(node);

    case "alignedGlossRow":
    case "proseGlossRow":
    case "glossCell":
      // These only appear inside exampleGloss and are consumed there.
      return "";

    case "hardBreak":
      return "\\\\\n";

    default:
      if (node.content) {
        return (node.content || []).map((n) => serializeNode(n)).join("");
      }
      return "";
  }
}

function serializeLabelRef(node: JSONContent): string {
  const label = node.attrs?.label || "";
  const cmd = (node.attrs?.refCommand as string) || "ref";
  if (cmd === "getref") return `\\getref{${label}}`;
  if (cmd === "getfullref") return `\\getfullref{${label}}`;
  return `\\ref{${label}}`;
}

function serializeExampleInlineChildren(nodes: JSONContent[] | undefined): string {
  if (!nodes) return "";
  return serializeInlineSequence(nodes);
}

function serializeExampleBlockBodyParagraphs(
  nodes: JSONContent[] | undefined,
): string {
  if (!nodes) return "";
  // Collapse paragraph children to inline (no blank-line separators — the
  // \ex…\xe envelope owns its own spacing). Multiple paragraphs are joined
  // by blank lines so the source stays readable.
  const pieces: string[] = [];
  for (const child of nodes) {
    if (child.type === "paragraph") {
      pieces.push(serializeExampleInlineChildren(child.content));
    } else if (child.type === "exampleGloss") {
      pieces.push(serializeExampleGloss(child).trimEnd());
    }
  }
  return pieces.join("\n\n");
}

function serializeExampleBlock(node: JSONContent): string {
  const kind = node.attrs?.kind === "multi" ? "pex" : "ex";
  const uuid = node.attrs?.uuid as string | null;
  const idMarker = uuid ? `\\vexid{${uuid}}` : "";
  const tag = (node.attrs?.tag as string) || "";
  const tagStr = tag ? `<${tag}>` : "";
  const override = (node.attrs?.exnoOverride as string | null) || null;
  const optStr = override ? `[exno=${override}]` : "";
  const suppress = (node.attrs?.suppressSpace as boolean) ? "~" : "";
  const label = (node.attrs?.label as string) || "";
  const labelStr = label ? `\\label{${label}}` : "";

  // Walk children in document order — paragraphs, gloss blocks,
  // exampleItemLists, regular itemize/enumerate lists, and (Feature A2)
  // pictures (graphicsBlock) + equations (displayMath) dropped into a single
  // example's body can interleave freely. Schema:
  // `(paragraph | exampleGloss | exampleItemList | bulletList | orderedList |
  //   graphicsBlock | displayMath)*`.
  const children = node.content || [];
  const pieces: Array<{ type: string; text: string }> = [];
  for (const child of children) {
    if (child.type === "paragraph") {
      pieces.push({
        type: "paragraph",
        text: serializeExampleInlineChildren(child.content),
      });
    } else if (child.type === "graphicsBlock") {
      // Feature A2 — a picture dropped into a single example's body. Emit the
      // verbatim command (mirrors serializeExampleItem's graphicsBlock branch;
      // the generic graphicsBlock serializer adds a trailing blank line we
      // don't want inside the example).
      pieces.push({
        type: "graphicsBlock",
        text: (child.attrs?.command as string) ?? "",
      });
    } else if (child.type === "displayMath") {
      // Feature A2 — an equation dropped into a single example's body. Same
      // `\[…\]` envelope as serializeExampleItem (with the trailing %!v: anchor
      // when the equation carries a uuid); `readParagraph` breaks at `\[` so a
      // preceding paragraph stays its own block on re-parse.
      const mUuid = child.attrs?.uuid as string | null;
      const mAnchor = mUuid ? ` %!v:${mUuid}` : "";
      const latex = (child.attrs?.latex as string) || "";
      pieces.push({ type: "displayMath", text: `\\[\n${latex}\n\\]${mAnchor}` });
    } else if (child.type === "exampleGloss") {
      pieces.push({
        type: "exampleGloss",
        text: serializeExampleGloss(child).trimEnd(),
      });
    } else if (child.type === "exampleItemList") {
      const items = (child.content || []).filter(
        (c) => c.type === "exampleItem",
      );
      const itemsStr = items.map((it) => serializeExampleItem(it)).join("");
      if (itemsStr)
        pieces.push({ type: "exampleItemList", text: itemsStr.trimEnd() });
    } else if (child.type === "bulletList" || child.type === "orderedList") {
      pieces.push({ type: child.type, text: serializeNode(child).trimEnd() });
    }
  }
  // Join with a soft "\n", EXCEPT two consecutive paragraphs need a blank line
  // so they re-parse as separate paragraphs (a lone "\n" is a soft break the
  // parser merges). `\[…\]` / `\includegraphics` are self-delimiting (the parser
  // breaks at them), so every other adjacency keeps the single "\n" — which
  // preserves the byte output of every pre-A2 block (≤ 1 body paragraph, so no
  // consecutive-paragraph adjacency ever arose).
  let body = "";
  for (let i = 0; i < pieces.length; i++) {
    if (i > 0) {
      body +=
        pieces[i - 1].type === "paragraph" && pieces[i].type === "paragraph"
          ? "\n\n"
          : "\n";
    }
    body += pieces[i].text;
  }

  return (
    `${idMarker}\\${kind}${suppress}${optStr}${tagStr}${labelStr}\n` +
    (body ? body + "\n" : "") +
    `\\xe\n\n`
  );
}

function serializeExampleItem(node: JSONContent): string {
  const uuid = node.attrs?.uuid as string | null;
  const idMarker = uuid ? `\\vxid{${uuid}}` : "";
  const tag = (node.attrs?.tag as string) || "";
  const tagStr = tag ? `<${tag}>` : "";
  const label = (node.attrs?.label as string) || "";
  const labelStr = label ? `\\label{${label}}` : "";
  const pieces: string[] = [];
  for (const child of node.content || []) {
    if (child.type === "paragraph") {
      pieces.push(serializeExampleInlineChildren(child.content));
    } else if (child.type === "graphicsBlock") {
      // Standalone `\includegraphics` inside the item body — emit the
      // verbatim command (the generic graphicsBlock serializer adds a
      // trailing blank-line we don't want inside an item, so just emit
      // the command).
      const command = (child.attrs?.command as string) ?? "";
      pieces.push(command);
    } else if (child.type === "displayMath") {
      // Display math `\[…\]` inside the item body (Feature A1). Emit the
      // same `\[…\]` envelope as the top-level serializer (with the trailing
      // %!v: anchor when the equation carries a uuid), but without the
      // top-level's blank-line tail — pieces are `\n`-joined inside the item.
      // `readParagraph` breaks at `\[` so a preceding paragraph stays its own
      // block on re-parse (round-trip verified in displaymath-in-item-roundtrip).
      const mUuid = child.attrs?.uuid as string | null;
      const mAnchor = mUuid ? ` %!v:${mUuid}` : "";
      const latex = (child.attrs?.latex as string) || "";
      pieces.push(`\\[\n${latex}\n\\]${mAnchor}`);
    } else if (child.type === "exampleGloss") {
      pieces.push(serializeExampleGloss(child).trimEnd());
    } else if (child.type === "exampleItemList") {
      // Nested tier of \a items — wrap in expex's xlist environment.
      const nestedItems = (child.content || []).filter(
        (c) => c.type === "exampleItem",
      );
      const nestedStr = nestedItems
        .map((n) => serializeExampleItem(n))
        .join("");
      pieces.push(
        `\\begin{xlist}\n${nestedStr.trimEnd()}\n\\end{xlist}`,
      );
    }
  }
  const body = pieces.join("\n");
  return `${idMarker}\\a${tagStr}${labelStr} ${body}\n`;
}

function glossCellToText(cell: JSONContent): string {
  // One cell = inline content; preserve any backslash commands verbatim.
  // Plain text tokens are whitespace-joined; wrap in braces if the
  // serialized form contains a top-level space.
  const inner = serializeExampleInlineChildren(cell.content);
  const trimmed = inner.trim();
  if (!trimmed) return "{}";
  // If the cell contains whitespace at top level, we must brace it so
  // expex doesn't split it into multiple columns.
  if (/\s/.test(trimmed)) return `{${trimmed}}`;
  return trimmed;
}

function serializeExampleGloss(node: JSONContent): string {
  const rows = node.content || [];
  const lines: string[] = [];
  for (const row of rows) {
    if (row.type === "alignedGlossRow") {
      const tier = (row.attrs?.tier as string) || "gla";
      const cells = (row.content || [])
        .filter((c) => c.type === "glossCell")
        .map(glossCellToText);
      lines.push(`\\${tier} ${cells.join(" ")} //`);
    } else if (row.type === "proseGlossRow") {
      const tier = (row.attrs?.tier as string) || "glft";
      const inner = serializeExampleInlineChildren(row.content);
      lines.push(`\\${tier} ${inner} //`);
    }
  }
  return `\\begingl\n${lines.join("\n")}\n\\endgl\n`;
}

/**
 * Walk a sequence of inline nodes, emitting `\vlid{id}` / `\vlidend{id}`
 * marker transitions around the `linkedAnchor` marks on text. Block-
 * local: anchors still open at the end of the sequence are closed with
 * `\vlidend`. A `linkedAnchor` that spans multiple blocks therefore
 * emits a close+reopen pair at each block boundary — verbose but the
 * parser's `applyLinkedAnchorBoundaries` reassembles them correctly.
 *
 * `serializeMarks` already ignores `linkedAnchor` marks (no case in its
 * switch), so the inline wrapping (`\textbf{…}` etc.) sits inside
 * `\vlid…\vlidend`, e.g.: `\vlid{x}\textbf{bold range}\vlidend{x}`.
 */
function serializeInlineSequence(nodes: JSONContent[]): string {
  const open = new Set<string>();
  let out = "";
  for (const node of nodes) {
    if (node.type === "text") {
      const marks = node.marks || [];
      const currentIds = new Set<string>();
      for (const m of marks) {
        if (m.type === "linkedAnchor") {
          const id = m.attrs?.anchorId as string | undefined;
          if (id) currentIds.add(id);
        }
      }
      for (const id of [...open]) {
        if (!currentIds.has(id)) {
          out += `\\vlidend{${id}}`;
          open.delete(id);
        }
      }
      for (const id of currentIds) {
        if (!open.has(id)) {
          out += `\\vlid{${id}}`;
          open.add(id);
        }
      }
      out += serializeMarks(node.text || "", marks);
    } else {
      out += serializeInline(node);
    }
  }
  for (const id of open) {
    out += `\\vlidend{${id}}`;
  }
  return out;
}

function serializeInline(node: JSONContent): string {
  if (node.type === "text") {
    return serializeMarks(node.text || "", node.marks);
  }
  if (node.type === "inlineMath") {
    return `$${node.attrs?.latex || ""}$`;
  }
  if (node.type === "footnote") {
    const fid = node.attrs?.footnoteId as string | undefined;
    const idMarker = fid ? `\\vfid{${fid}}` : "";
    const cmd = node.attrs?.thanks ? "thanks" : "footnote";
    return `${idMarker}\\${cmd}{${richJsonToLatex(normalizeRichContent(node.attrs?.content))}}`;
  }
  if (node.type === "citation") {
    const cid = node.attrs?.citationId as string | undefined;
    const idMarker = cid ? `\\vcid{${cid}}` : "";
    return `${idMarker}${node.attrs?.command || ""}`;
  }
  if (node.type === "labelRef") {
    return serializeLabelRef(node);
  }
  if (node.type === "hardBreak") {
    return "\\\\\n";
  }
  return "";
}

export function serializeToLatex(
  doc: JSONContent,
  options?: { preamble?: string; postamble?: string },
): string {
  const body = serializeNode(doc).replace(/\n{3,}/g, "\n\n").trim();
  const rawPreamble = options?.preamble
    ? ensureVirgilCommands(options.preamble)
    : DEFAULT_PREAMBLE;
  // Re-inject preamble-sourced \title/\author/\date right before
  // \begin{document}. They live in the doc tree (so the editor can show
  // them), but the user intends them to live in the preamble.
  const preambleFields = collectPreambleTitleFields(doc);
  const preamble = injectTitleFieldsIntoPreamble(rawPreamble, preambleFields);
  const postamble = options?.postamble ?? DEFAULT_POSTAMBLE;
  return preamble + body + postamble;
}

export function serializeBodyOnly(doc: JSONContent): string {
  return serializeNode(doc).replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Carry `\title{…}` / `\author{…}` / `\date{…}` lines from the OLD
 * LaTeX's preamble into a NEW style preamble. Used by the Style
 * dropdown switch path ([useDocumentStyle.setStyle]), which previously
 * dropped these commands wholesale when replacing the preamble.
 *
 * `newPreamble` is expected to end with `\begin{document}\n\n` (the
 * shape of `StyleEntry.preamble`); the harvested title-field block is
 * inserted just before that marker. The OLD preamble is everything in
 * `oldLatex` up to its `\begin{document}` — title-field commands are
 * extracted by string-match (not by parsing the whole doc), so this
 * function is safe to call on raw bytes without going through the
 * editor's doc tree.
 *
 * Duplicate `\title{}` (or author/date) lines in the source are
 * collapsed — first occurrence wins, matching `parsePreambleTitleFields`
 * semantics.
 */
export function mergeTitlesIntoStylePreamble(
  oldLatex: string,
  newPreamble: string,
): string {
  const beginDoc = oldLatex.indexOf("\\begin{document}");
  const oldPreamble = beginDoc !== -1 ? oldLatex.slice(0, beginDoc) : oldLatex;
  const harvested = extractTitleFieldLines(oldPreamble);
  if (harvested.length === 0) return newPreamble;
  const block = harvested.join("") + "\n";
  const beginMarker = "\\begin{document}";
  const idx = newPreamble.indexOf(beginMarker);
  if (idx === -1) return newPreamble + block;
  const before = newPreamble.slice(0, idx).replace(/\s*$/, "");
  const after = newPreamble.slice(idx);
  return before + "\n\n" + block + after;
}

/**
 * Extract the literal `\title{…}\n`, `\author{…}\n`, `\date{…}\n`
 * lines from a preamble string (including any trailing `%!v:UUID`
 * anchor). Returns them in source order, deduplicated by field name.
 * Used by `mergeTitlesIntoStylePreamble`.
 */
function extractTitleFieldLines(preamble: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  // Match `\(title|author|date){…}` with brace-balanced extraction,
  // followed by an optional `%!v:hex` UUID anchor up to the line end.
  // We re-implement balanced-brace scanning here (small + local) rather
  // than importing the parser's `extractBraced` (cross-module dep).
  let i = 0;
  while (i < preamble.length) {
    const rest = preamble.slice(i);
    const m = rest.match(/^\\(title|author|date)\{/);
    if (!m) {
      i++;
      continue;
    }
    const field = m[1];
    const bracedStart = i + m[0].length - 1;
    let depth = 1;
    let j = bracedStart + 1;
    while (j < preamble.length && depth > 0) {
      if (preamble[j] === "{" && preamble[j - 1] !== "\\") depth++;
      else if (preamble[j] === "}" && preamble[j - 1] !== "\\") depth--;
      j++;
    }
    if (depth !== 0) {
      // Unbalanced — bail on this match, advance past `\foo{`.
      i += m[0].length;
      continue;
    }
    let end = j;
    // Optional UUID anchor: ` %!v:abcd` immediately after closing brace.
    const afterMatch = preamble.slice(end).match(/^\s*%!v:[a-f0-9]+/);
    if (afterMatch) end += afterMatch[0].length;
    // Swallow one trailing newline so re-injection doesn't accumulate blanks.
    let lineEnd = end;
    if (preamble[lineEnd] === "\n") lineEnd++;
    if (!seen.has(field)) {
      seen.add(field);
      // Preserve the raw line (with anchor + newline if present) so the
      // UUID survives the style switch.
      out.push(preamble.slice(i, lineEnd));
    }
    i = lineEnd;
  }
  return out;
}


/** Assign UUIDs to all block-level nodes that lack one. Mutates the doc in place.
 *  Container nodes (lists, blockquote) get a single UUID — inner paragraphs are suppressed.
 *  Headings, titleFields, atom blocks (displayMath, latexComment, codeBlock) always get a UUID.
 *
 *  Also dedups inline `citationId` and `footnoteId` attrs. The 4-char hex id
 *  space (65K) starts seeing collisions in modest-sized docs, and once two
 *  citations or footnotes share an id the React keys collide in Marginalia /
 *  Omni. Each kind is deduped within its own namespace (React keys are
 *  prefixed `citation:` / `footnote:`, so cross-kind collisions are not a
 *  rendering problem). */
export function assignUuids(doc: JSONContent): void {
  const CONTAINER_TYPES = new Set(["bulletList", "orderedList", "blockquote"]);
  const existing = new Set<string>();

  // First pass: collect existing UUIDs and detect duplicates.
  // If the same UUID appears on multiple nodes (e.g. from a bad recovery),
  // only the first node keeps it — the rest get cleared so pass 2 assigns
  // fresh unique UUIDs.
  const seen = new Set<string>();
  function dedup(node: JSONContent) {
    if (UUID_BEARING_NODE_TYPES.has(node.type!) && node.attrs?.uuid) {
      const uuid = node.attrs.uuid as string;
      if (seen.has(uuid)) {
        // Duplicate — clear so it gets a fresh UUID in pass 2
        node.attrs.uuid = null;
      } else {
        seen.add(uuid);
        existing.add(uuid);
      }
    }
    node.content?.forEach(dedup);
  }
  dedup(doc);

  function ensureUuid(node: JSONContent) {
    if (!node.attrs) node.attrs = {};
    node.attrs.uuid = generateShortId(existing);
    existing.add(node.attrs.uuid as string);
  }

  // Second pass: assign missing UUIDs (skip paragraphs inside containers)
  function assign(node: JSONContent, insideContainer = false) {
    // Strip stale UUIDs on paragraphs inside a container (listItem,
    // blockquote, codeBlock). The container itself or its listItem owns
    // the anchor identity; inner paragraphs don't.
    if (insideContainer && node.type === "paragraph" && node.attrs?.uuid) {
      node.attrs.uuid = null;
      node.attrs.parTitle = null;
    }
    // Container nodes (bulletList / orderedList / blockquote) get a UUID.
    if (CONTAINER_TYPES.has(node.type!)) {
      if (!node.attrs?.uuid) ensureUuid(node);
      node.content?.forEach((child) => assign(child, true));
      return;
    }
    // List items are per-item anchor targets (so the action button works
    // inside an item, marginalia can pin to a single line, etc.). Their
    // inner paragraph stays UUID-less — handled by insideContainer=true.
    if (node.type === "listItem") {
      if (!node.attrs?.uuid) ensureUuid(node);
      node.content?.forEach((child) => assign(child, true));
      return;
    }
    // Headings and titleFields always get a UUID
    if ((node.type === "heading" || node.type === "titleField") && !node.attrs?.uuid) {
      ensureUuid(node);
    }
    // Non-empty paragraphs get a UUID (unless inside a container)
    if (
      node.type === "paragraph" &&
      !insideContainer &&
      node.content &&
      node.content.length > 0 &&
      !node.attrs?.uuid
    ) {
      ensureUuid(node);
    }
    // Atom-like block nodes always get a UUID
    if (
      (node.type === "displayMath" ||
        node.type === "latexComment" ||
        node.type === "codeBlock" ||
        node.type === "exampleBlock" ||
        node.type === "figureBlock" ||
        node.type === "graphicsBlock") &&
      !node.attrs?.uuid
    ) {
      ensureUuid(node);
    }
    node.content?.forEach((child) => assign(child, insideContainer));
  }
  assign(doc);

  // Inline id dedup (separate id space per kind, since React keys are
  // namespaced `citation:` / `footnote:`). For each kind: walk once,
  // clear duplicates, then walk again to refill cleared slots with ids
  // that avoid every survivor. Footnotes stash their body as
  // `attrs.content` (they're inline atoms), and citations inside that
  // body must also be visited — recurse into any attrs.content array.
  function dedupInlineId(typeName: string, attrName: string) {
    const survivors = new Set<string>();
    const localSeen = new Set<string>();
    const walkChildren = (node: JSONContent, fn: (n: JSONContent) => void) => {
      node.content?.forEach(fn);
      // Inline atoms (footnote, note) stash their body on `attrs.content`,
      // shaped as either a JSONContent doc node or a raw children array
      // (see normalizeRichContent's four shapes). Descend into both.
      const attrContent = node.attrs?.content;
      if (Array.isArray(attrContent)) {
        for (const child of attrContent as JSONContent[]) fn(child);
      } else if (attrContent && typeof attrContent === "object") {
        fn(attrContent as JSONContent);
      }
    };
    const dedupWalk = (node: JSONContent) => {
      if (node.type === typeName) {
        const id = node.attrs?.[attrName] as string | undefined;
        if (id) {
          if (localSeen.has(id)) {
            // Duplicate — clear so the fill walk regenerates it.
            (node.attrs as Record<string, unknown>)[attrName] = "";
          } else {
            localSeen.add(id);
            survivors.add(id);
          }
        }
      }
      walkChildren(node, dedupWalk);
    };
    dedupWalk(doc);

    const fillWalk = (node: JSONContent) => {
      if (node.type === typeName) {
        const attrs = (node.attrs ?? {}) as Record<string, unknown>;
        if (!attrs[attrName]) {
          const fresh = generateShortId(survivors);
          survivors.add(fresh);
          attrs[attrName] = fresh;
          node.attrs = attrs;
        }
      }
      walkChildren(node, fillWalk);
    };
    fillWalk(doc);
  }

  dedupInlineId("citation", "citationId");
  dedupInlineId("footnote", "footnoteId");
}

/** Recursively extract plain text from a JSONContent subtree. */
function extractPlainText(node: JSONContent): string {
  if (node.type === "text") return node.text || "";
  if (node.type === "inlineMath") return `$${node.attrs?.latex || ""}$`;
  if (node.type === "citation") return node.attrs?.command || "";
  if (node.type === "footnote") return richJsonToPlainText(normalizeRichContent(node.attrs?.content));
  if (node.type === "hardBreak") return " ";
  if (node.type === "displayMath") return node.attrs?.latex || "";
  if (node.type === "latexComment") return node.attrs?.text || "";
  if (!node.content) return "";
  const sep = node.type === "bulletList" || node.type === "orderedList" ? "; " : "";
  return node.content.map(extractPlainText).join(sep);
}

/** Compute a content fingerprint: lowercased, whitespace-collapsed, first 80 chars. */
function computeFingerprint(node: JSONContent): string {
  const text = extractPlainText(node);
  return text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80);
}

const UUID_ELIGIBLE = UUID_BEARING_NODE_TYPES;

/** Extract sidecar data (titles + fingerprints keyed by UUID) from the document. */
export function extractSidecarData(doc: JSONContent): VirgilSidecar {
  const paragraphs: VirgilSidecar["paragraphs"] = {};
  function walk(node: JSONContent) {
    if (UUID_ELIGIBLE.has(node.type!) && node.attrs?.uuid) {
      const uuid = node.attrs.uuid as string;
      const fp = computeFingerprint(node);
      const title = node.attrs.parTitle as string | undefined;
      const collapsed = node.attrs.collapsed === true;
      if (title || fp || collapsed) {
        paragraphs[uuid] = {
          ...(title ? { title } : {}),
          ...(fp ? { fingerprint: fp } : {}),
          ...(collapsed ? { collapsed: true } : {}),
        };
      }
    }
    node.content?.forEach(walk);
  }
  walk(doc);
  return { paragraphs };
}

/** Recover orphaned UUIDs by matching content fingerprints. Mutates doc in place. */
export function recoverOrphanedUuids(doc: JSONContent, sidecar: VirgilSidecar): void {
  if (!sidecar?.paragraphs) return;
  // 1. Collect current UUIDs in the document
  const currentUuids = new Set<string>();
  function collectCurrent(node: JSONContent) {
    if (UUID_ELIGIBLE.has(node.type!) && node.attrs?.uuid) {
      currentUuids.add(node.attrs.uuid as string);
    }
    node.content?.forEach(collectCurrent);
  }
  collectCurrent(doc);

  // 2. Find orphaned sidecar entries (UUIDs not in the document)
  const orphansByFingerprint = new Map<string, { uuid: string; title?: string }[]>();
  for (const [uuid, meta] of Object.entries(sidecar.paragraphs)) {
    if (currentUuids.has(uuid)) continue;
    if (!meta.fingerprint) continue;
    const list = orphansByFingerprint.get(meta.fingerprint) || [];
    list.push({ uuid, title: meta.title });
    orphansByFingerprint.set(meta.fingerprint, list);
  }

  if (orphansByFingerprint.size === 0) return;

  const CONTAINER_TYPES = new Set(["bulletList", "orderedList", "blockquote"]);

  // 3. Walk document for UUID-eligible nodes missing a UUID, try to recover
  function recover(node: JSONContent, insideContainer = false) {
    // Container nodes (bulletList / orderedList / blockquote): recover
    // the container UUID, then recurse so listItems can recover too.
    if (CONTAINER_TYPES.has(node.type!)) {
      if (!node.attrs?.uuid) {
        const fp = computeFingerprint(node);
        if (fp) tryRestore(node, fp);
      }
      node.content?.forEach((child) => recover(child, true));
      return;
    }
    // List items are per-item anchor targets — recover via the item's
    // content fingerprint, then continue into the inner paragraph(s).
    if (node.type === "listItem") {
      if (!node.attrs?.uuid) {
        const fp = computeFingerprint(node);
        if (fp) tryRestore(node, fp);
      }
      node.content?.forEach((child) => recover(child, true));
      return;
    }
    // Headings and titleFields always recoverable
    if (
      node.type === "heading" ||
      node.type === "titleField" ||
      (node.type === "paragraph" && !insideContainer && node.content && node.content.length > 0)
    ) {
      if (!node.attrs?.uuid) {
        const fp = computeFingerprint(node);
        if (fp) tryRestore(node, fp);
      }
    }
    // Atom-like block nodes
    if (
      (node.type === "displayMath" ||
        node.type === "latexComment" ||
        node.type === "codeBlock" ||
        node.type === "figureBlock" ||
        node.type === "graphicsBlock") &&
      !node.attrs?.uuid
    ) {
      const fp = computeFingerprint(node);
      if (fp) tryRestore(node, fp);
    }
    node.content?.forEach((child) => recover(child, insideContainer));
  }

  function tryRestore(node: JSONContent, fp: string) {
    const candidates = orphansByFingerprint.get(fp);
    if (!candidates || candidates.length !== 1) return; // skip ambiguous
    const orphan = candidates[0];
    if (!node.attrs) node.attrs = {};
    node.attrs.uuid = orphan.uuid;
    if (orphan.title) node.attrs.parTitle = orphan.title;
    currentUuids.add(orphan.uuid);
    orphansByFingerprint.delete(fp); // consumed
  }

  recover(doc);
}
