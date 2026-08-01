import { JSONContent } from "@tiptap/react";
import type { VirgilSidecar } from "@/lib/types";
import { generateShortId } from "@/lib/uuid";
import { richJsonToLatex, richJsonToPlainText, normalizeRichContent } from "@/lib/footnote-content";
import { CLASSIC_PREAMBLE } from "@/lib/document-styles";
import {
  detectBodyRequirements,
  ensurePreambleRequirements,
} from "@/lib/latex-requirements";
import { typographyToLatex, smartenStraightQuotes } from "@/lib/latex-typography";
import { extractBraced, isEscaped, VERBATIM_ENVS_FULL } from "@/lib/latex-lexer";
import type { BibFamily, BibFamilyConflict } from "@/lib/bib-family";
import { classifyCiteFamily } from "@/lib/bib-family";
import {
  createRequirementCollector,
  TIKZ_RE,
  type RequirementCollector,
} from "@/lib/latex-requirement-collector";

// -----------------------------------------------------------------------------
// Requirement collection — side channel (P4, requirements by emission).
//
// The requirement declared at each emit-site is pushed into a module-scoped
// ACTIVE collector rather than threaded through every serializeNode signature.
// Serialization is fully synchronous and single-threaded, so a module-level
// "current collector" is safe: `serializeToLatex` sets it before its walk and
// clears it after, and the body-only / single-paragraph projections leave it
// null (a `need()` on a null collector is a no-op). This keeps collection
// STRICTLY side-channel — no byte of emitted output changes.
// -----------------------------------------------------------------------------
let activeCollector: RequirementCollector | null = null;

/** Declare a package/shim requirement adjacent to the bytes an emit-site
 *  writes. No-op when no collector is active (body-only projections). */
function need(id: string): void {
  activeCollector?.need(id);
}

/** Declare the bib family a cite command pins, adjacent to its emit. */
function needBibFamily(fam: BibFamily | null): void {
  activeCollector?.needBibFamily(fam);
}

/** Run the shared tikz/bib/expex/graphicx vocabulary over a raw-passthrough
 *  block's OWN bytes (texBlock code, figure extras) and declare accordingly —
 *  co-locating even raw-passthrough detection with its emitter. */
function declareFromRawLatex(raw: string): void {
  if (!raw) return;
  if (TIKZ_RE.test(raw)) need("tikz");
  if (/\\includegraphics(?![a-zA-Z])/.test(raw)) need("graphicx");
  if (/\\textcolor(?![a-zA-Z])/.test(raw)) need("xcolor");
  if (
    /\\(?:begingl|getfullref|getref|pex|ex)(?![a-zA-Z])|\\begin\{xlist\}/.test(
      raw,
    )
  ) {
    need("expex");
  }
  if (/\\begin\{xlist\}/.test(raw)) need("xlistenv");
}

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
    return smartenStraightQuotes(text);
  }

  // Code spans are verbatim — `--` is literal and accent commands stay raw,
  // so the typographic reverse-map is suppressed for `code`-marked text
  // (memo §A exclusion). Smart-quote + char escaping still applies.
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
      case "textColor": {
        const c = (mark.attrs?.color as string | undefined) ?? "";
        // \textcolor[HTML] expects 6 uppercase hex digits, no leading "#".
        const hex = c.replace(/^#/, "").toUpperCase();
        if (/^[0-9A-F]{6}$/.test(hex)) {
          result = `\\textcolor[HTML]{${hex}}{${result}}`;
          need("xcolor"); // declared adjacent to the \textcolor byte emit
        }
        break;
      }
    }
  }
  return result;
}

/**
 * Byte-raw body of a MARKLESS text-node container (`content: "text*"`,
 * `marks: ""`) — currently exactly `codeBlock` and `latexComment`.
 *
 * These two are the schema's verbatim pair: their parser reads byte-preserve
 * the source into a single bare text node (`latex-parser.ts` `case "verbatim"`
 * / the `latexComment` branch), running no `unescapeLatex` and no typography.
 * So the serializer must be that read's exact byte-inverse — flatten the text
 * children and emit them raw. Routing them through `serializeInlineSequence`
 * instead (as `codeBlock` did until task 207) sends them down the PROSE escape
 * path, which char-escapes `& % # $ _ ^ ~`, rewrites `[`→`{[}`, and runs the
 * typographic reverse-map. That is not merely wrong once — it is NON-IDEMPOTENT:
 * the parser re-ingests `{[}` literally and the next save re-wraps it, so a
 * body containing `arr[0]` grows a brace layer on EVERY save, unbounded.
 * `latex-typography.ts` states outright that callers must never run it inside a
 * verbatim/code span; this is the helper that keeps that contract structural.
 *
 * The schema guarantees the escaping can never be *needed* here: `marks: ""`
 * makes marked children impossible and `content: "text*"` makes non-text
 * children impossible, so a flatten loses nothing (see
 * `text-object-registry.ts` — it names these two as the markless pair).
 */
function serializeMarklessTextBody(content: JSONContent[] | undefined): string {
  return (content ?? []).map((c) => c.text ?? "").join("");
}

function escapeLatex(
  text: string,
  opts?: { typography?: boolean },
): string {
  // Don't escape backslashes — they're intentional LaTeX commands.
  // The editor preserves raw LaTeX, so we only escape the few chars
  // that would break LaTeX if they appeared as literal text.
  // `$` IS escaped here (→ `\$`): a bare `$` in a plain-text node is re-read
  // as an inline-math delimiter by the parser (`$…$` → inlineMath), so leaving
  // it raw silently converts prose like `costs $5, $10` into a math atom on the
  // next save→reload. Genuine inline math never reaches escapeLatex — it is a
  // separate `inlineMath` node serialized directly as `$${latex}$` — and the
  // parser un-escapes `\$` back to a literal `$`, so this closes the round-trip.
  // We still don't escape {, } since those are structural LaTeX syntax the
  // editor emits and re-reads verbatim.
  //
  // `[` / `]` are escaped SYMMETRICALLY as `{[}` / `{]}` (task 037's `$` twin).
  // A literal prose `[` that abuts a preceding `\\` hard-break or a
  // `\command` is otherwise re-read as an OPTIONAL ARGUMENT: `\\[Note]` reads
  // as a line-break of length `Note`, and `\cmd[Note]` folds `[Note]` into the
  // command atom (the parser's optional-arg absorber). Wrapping the bracket in
  // its own brace group (`{[}`) neutralizes both — a braced `[` can never begin
  // an optional arg — while still rendering as a plain `[`. We deliberately do
  // NOT use `\[` (that starts DISPLAY MATH, silently turning `[Note]` into a
  // math block on reload). Genuine structural brackets (`\begin{figure}[t]`,
  // `\ex[exno=3]`, real `\\[2em]` lengths) live on latexCommand/texBlock/example
  // paths that bypass escapeLatex, so only prose text is touched. The parser
  // collapses `{[}`/`{]}` back to a bare `[`/`]`, closing the round-trip.
  // Straight/curly `"` → smart LaTeX pairs via the shared serialize-side
  // helper (also used by serializeMarks' latexCommand path) so the
  // opener/closer character class has exactly ONE definition.
  const escaped = smartenStraightQuotes(
    text
      .replace(/(?<!\\)([&%#$_])/g, "\\$1")
      .replace(/\[/g, "{[}")
      .replace(/\]/g, "{]}")
      .replace(/~/g, "\\textasciitilde{}")
      .replace(/\^/g, "\\textasciicircum{}"),
  );
  // Typographic reverse-map (accents/special-letters/dashes/ellipsis →
  // canonical LaTeX) runs AFTER char-escaping so its emitted `\^{e}` / `\~{n}`
  // commands aren't re-escaped by the `^`/`~` rules above. Suppressed for
  // code spans by the caller (memo §A). The dash-glyph used as a `"`-opening
  // lookbehind (— –) is preserved by that rule above before being mapped here.
  return opts?.typography === false ? escaped : typographyToLatex(escaped);
}

function serializeTitleField(node: JSONContent): string {
  const field = node.attrs?.field as string;
  const rawPrefix = (node.attrs?.rawPrefix as string) || "";
  const uuid = node.attrs?.uuid as string | null;
  const anchor = uuid ? ` %!v:${uuid}` : "";
  if (node.attrs?.isToday) {
    // Interpolate rawPrefix exactly as the non-today branch below does — the
    // parser strips a sizing/weight prefix (`\small`, `\Large`, …) into
    // rawPrefix even on the \today path (latex-parser.ts), so dropping it here
    // silently rewrites `\date{\small\today}` → `\date{\today}` on round-trip.
    return `\\${field}{${rawPrefix}\\today}${anchor}\n`;
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
      // Verbatim is byte-preserving in BOTH directions — flatten the markless
      // text children raw (the parser's `case "verbatim"` inverse). See
      // `serializeMarklessTextBody`.
      const inner = serializeMarklessTextBody(node.content);
      const uuid = node.attrs?.uuid as string | null;
      const anchor = uuid ? ` %!v:${uuid}` : "";
      // A body line reading `\end{verbatim}` would otherwise close the
      // environment early (the parser's `findMatchingEnd` matches the
      // literal string). Escape it to a private form that breaks the
      // delimiter substring; the parser un-escapes it on the way back in.
      // Mirrors the `texBlock` `%!vtex:end` → `%!v tex:end` sentinel guard.
      // The `%` is injected into an already-RAW body, so it stays raw (not
      // `\%`) and reverses cleanly. Verbatim bodies containing
      // a literal `\end{verbatim}` are uncompilable in raw LaTeX anyway, so
      // preserving Virgil's representation losslessly is strictly better.
      const escaped = inner.replace(
        /\\end\{verbatim\}/g,
        "\\end{verbatim%!v-esc}",
      );
      return `\\begin{verbatim}\n${escaped}\n\\end{verbatim}${anchor}\n\n`;
    }

    case "texBlock": {
      // Raw LaTeX passthrough. Contents emit verbatim between comment
      // sentinels so the compiler runs them as LaTeX; the parser
      // recovers them by matching uuid. We escape any literal
      // `%!vtex:end` in the body so a pasted snippet can't terminate
      // the block early.
      const uuid = (node.attrs?.uuid as string) || "";
      const rawCode = (node.attrs?.code as string) || "";
      // Raw passthrough is unmodeled: run the shared vocabulary over its OWN
      // bytes so tikz/graphicx/xcolor/expex used inside a texBlock declare
      // their package at the emit-site (co-located with the fallback detector's
      // vocabulary, so declared and detected can't diverge).
      declareFromRawLatex(rawCode);
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
      // `extras` is raw passthrough (\includegraphics, TikZ, pgfplots) — run the
      // shared vocabulary over it so its packages declare at the emit-site.
      declareFromRawLatex(extras);
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
        // Re-emit the optional `[short]` list-of-figures argument opaquely when
        // present (task 263); a bracket-free caption stays byte-identical.
        const shortCaption = node.attrs?.shortCaption as string | null;
        const shortArg =
          typeof shortCaption === "string" ? `[${shortCaption}]` : "";
        bodyParts.push("\n  ");
        bodyParts.push(`\\caption${shortArg}{${captionTex}}`);
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
      need("graphicx"); // \includegraphics is graphicx-bound
      return `${command}${anchor}\n\n`;
    }

    case "blockquote": {
      // Join child paragraphs with a `\n\n` block separator: under
      // `suppressChildUuids` the paragraph branch returns bare `inner` with no
      // trailing break, so joining with "" fuses consecutive paragraphs into
      // one on re-parse (the parser only splits the quote body on `\n\n`). The
      // separator preserves the hard paragraph break inside a multi-paragraph
      // quote; a single-paragraph quote is byte-unchanged (single-element join).
      const inner = (node.content || []).map((n) => serializeNode(n, true)).join("\n\n");
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
      // Comment text is native inline content now (`content: text*`), not an
      // `attrs.text` — flatten the text nodes raw, via the shared markless
      // byte-passthrough helper it shares with `codeBlock`.
      const text = serializeMarklessTextBody(node.content);
      return `% ${text}${anchor}\n`;
    }

    case "citation": {
      const cid = node.attrs?.citationId as string | undefined;
      const idMarker = cid ? `\\vcid{${cid}}` : "";
      const command = (node.attrs?.command as string) || "";
      // Declare the bib family this cite command pins, adjacent to its emit.
      needBibFamily(classifyCiteFamily(command));
      return `${idMarker}${command}`;
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
  // \getref / \getfullref are expex reference commands (matched by the expex
  // fallback detector too); declare adjacent to the emit. Plain \ref is kernel.
  if (cmd === "getref") {
    need("expex");
    return `\\getref{${label}}`;
  }
  if (cmd === "getfullref") {
    need("expex");
    return `\\getfullref{${label}}`;
  }
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
  // An example block emits `\ex`/`\pex … \xe` — an expex construct.
  need("expex");
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
      need("graphicx"); // \includegraphics is graphicx-bound
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
  // An `\a` item is an expex construct.
  need("expex");
  const uuid = node.attrs?.uuid as string | null;
  const idMarker = uuid ? `\\vxid{${uuid}}` : "";
  const tag = (node.attrs?.tag as string) || "";
  const tagStr = tag ? `<${tag}>` : "";
  // Item-level `\a[exno=N]` override — mirror the block leg
  // (`serializeExampleBlock`: `optStr` before `tagStr`). Emitted only when
  // present, so an override-free item serializes byte-identically.
  const override = (node.attrs?.exnoOverride as string | null) || null;
  const optStr = override ? `[exno=${override}]` : "";
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
      need("graphicx"); // \includegraphics is graphicx-bound
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
      // Nested tier of \a items — wrap in the `xlist` environment. This is the
      // key P4 decoupling site: emitting `\begin{xlist}` REQUIRES both expex
      // (the `\pex`/`\xe` the env expands to) and the `xlistenv` definition
      // (expex ships no `xlist`), declared adjacent to the bytes — so a nested
      // tier can never emit without both requirements, independent of the
      // fallback regex.
      need("expex");
      need("xlistenv");
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
  return `${idMarker}\\a${optStr}${tagStr}${labelStr} ${body}\n`;
}

/** True if `s` has a whitespace char at brace depth 0 — i.e. a space that
 *  expex would treat as a column separator. Whitespace *inside* a `{...}`
 *  group (e.g. a command's braced argument) is already protected, so it
 *  doesn't count. `\{`/`\}` are literal, not group delimiters. */
function hasTopLevelWhitespace(s: string): boolean {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "{" && !isEscaped(s, i)) depth++;
    else if (c === "}" && !isEscaped(s, i)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && /\s/.test(c)) return true;
  }
  return false;
}

function glossCellToText(cell: JSONContent): string {
  // One cell = inline content; preserve any backslash commands verbatim.
  // Plain text tokens are whitespace-joined; wrap in braces only if the
  // serialized form has a space at brace depth 0.
  const inner = serializeExampleInlineChildren(cell.content);
  const trimmed = inner.trim();
  if (!trimmed) return "{}";
  // Brace only when a top-level (brace-depth-0) space is present, so expex
  // doesn't split the cell into multiple columns. A whitespace-bearing run
  // already wrapped by a command's braces — `\textbf{a b}` — needs no
  // redundant outer group, and the brace-aware parser re-reads it as one cell.
  if (hasTopLevelWhitespace(trimmed)) return `{${trimmed}}`;
  return trimmed;
}

function serializeExampleGloss(node: JSONContent): string {
  // A gloss emits `\begingl … \endgl` — an expex construct.
  need("expex");
  // Re-emit the opaque `[<opts>]` bracket the parser captured (task 262) so a
  // user's gloss options survive save→reload byte-for-byte; a null attr (source
  // had no bracket) emits a bare `\begingl` identical to today. A string —
  // including "" from a literal `\begingl[]` — keeps the bracket, so the
  // round-trip is a true fixed point.
  const rawOptions = node.attrs?.glossOptions;
  const glossOptions = typeof rawOptions === "string" ? rawOptions : null;
  const optStr = glossOptions !== null ? `[${glossOptions}]` : "";
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
  return `\\begingl${optStr}\n${lines.join("\n")}\n\\endgl\n`;
}

/**
 * The internal Virgil marker commands the serializer emits inline to round-trip
 * structure that has no LaTeX of its own: linked-anchor range boundaries
 * (`\vlid` / `\vlidend`, {@link serializeInlineSequence}), citation ids
 * (`\vcid`) and footnote ids (`\vfid`) (the atom emit sites at :360/:376 and
 * :665/:671). These are NOT real LaTeX — they are private sentinels the parser
 * (`parseInlineContent` / `applyLinkedAnchorBoundaries`) reads back to
 * re-materialize anchors + atoms. Single-sourced here (alongside the emit
 * sites) so any consumer that must treat serialized text as trusted-marker-free
 * — notably the pending-change applicator's splice guard
 * (`containsInternalMarker`) — never drifts from the set the serializer
 * actually produces. Longest-first so the regex alternation matches `\vlidend`
 * before its `\vlid` prefix.
 */
export const INTERNAL_MARKER_COMMANDS = [
  "vlidend",
  "vlid",
  "vcid",
  "vfid",
] as const;

const INTERNAL_MARKER_REGEX = new RegExp(
  `\\\\(?:${INTERNAL_MARKER_COMMANDS.join("|")})\\b`,
);

/**
 * True if `text` contains any internal Virgil marker command
 * (`\vlid` / `\vlidend` / `\vcid` / `\vfid`). Used to refuse REPARSING
 * untrusted text (e.g. a suggestion's `replacement`): concatenating a marker
 * into a paragraph's serialized inline LaTeX and reparsing it would mint a
 * phantom `linkedAnchor` / citation / footnote atom that no card owns — the
 * write-side mirror of the applicator's `originalText` verbatim guard.
 */
export function containsInternalMarker(text: string): boolean {
  return INTERNAL_MARKER_REGEX.test(text);
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
    const command = (node.attrs?.command as string) || "";
    needBibFamily(classifyCiteFamily(command));
    return `${idMarker}${command}`;
  }
  if (node.type === "labelRef") {
    return serializeLabelRef(node);
  }
  if (node.type === "hardBreak") {
    return "\\\\\n";
  }
  return "";
}

/**
 * Collapse runs of 3+ newlines down to a single blank-line separator —
 * EXCEPT inside the `verbatim` FAMILY, whose bodies are byte-preserving.
 * Verbatim blocks are pulled out behind placeholders, the collapse runs on
 * the remaining prose, then the blocks are spliced back intact. A body line
 * reading `\end{verbatim}` is escaped (`%!v-esc`) at emit time, so the
 * non-greedy match always stops at the block's real terminator even when the
 * body itself contains a literal `\begin{verbatim}`.
 *
 * The stash pattern is built from the `VERBATIM_ENVS_FULL` vocab SSOT (not a
 * hard-coded bare-`verbatim` literal), so `verbatim*`/`lstlisting`/`minted`
 * bodies keep their interior blank runs too (task 243). A capture-group
 * backreference (`\1`) pairs each `\begin{env}` with its own `\end{env}`, and
 * the alternation is longest-first so `verbatim*` is tried before `verbatim`.
 */
const VERBATIM_BLOCK_RE = new RegExp(
  `\\\\begin\\{(${[...VERBATIM_ENVS_FULL]
    .sort((a, b) => b.length - a.length)
    .map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")})\\}\\n[\\s\\S]*?\\n\\\\end\\{\\1\\}`,
  "g",
);
function collapseBlankRuns(s: string): string {
  const blocks: string[] = [];
  // Stash each verbatim block behind a placeholder that carries no newline
  // (so the collapse pass can't touch it) and cannot collide with real prose
  // (`@@` + a reserved tag). Restore is index-guarded — an unmatched token is
  // left verbatim rather than turning into "undefined".
  const stashed = s.replace(VERBATIM_BLOCK_RE, (m) => {
    blocks.push(m);
    return `@@VBTSTASH:${blocks.length - 1}@@`;
  });
  const collapsed = stashed.replace(/\n{3,}/g, "\n\n");
  return collapsed.replace(/@@VBTSTASH:(\d+)@@/g, (whole, i) => {
    const block = blocks[Number(i)];
    return block === undefined ? whole : block;
  });
}

export function serializeToLatex(
  doc: JSONContent,
  options?: {
    preamble?: string;
    postamble?: string;
    /**
     * The AUTHORITATIVE per-doc bib family (from the virgil settings sidecar /
     * useCitations). When supplied it OVERRIDES the body-derived family guess —
     * so a doc whose user has chosen biblatex ensures biblatex even if a lone
     * shared cite would otherwise default to natbib. Optional; backward
     * compatible (unset → body-derived family, today's behavior).
     */
    bibFamily?: BibFamily | null;
    /**
     * Called once at serialize time when the family the body needs conflicts
     * with the family the preamble hard-loads (natbib baseline + `\autocite`,
     * or the symmetric case). Per the locked decision we WARN, never rewrite —
     * the save path renders this as a soft notice. Fires at most once.
     */
    onRequirementConflict?: (conflict: BibFamilyConflict) => void;
  },
): string {
  // Seed a per-serialize collector and set it as the active side channel for
  // the walk. Cleared in `finally` so body-only projections never see it.
  const collector = createRequirementCollector();
  const prevCollector = activeCollector;
  activeCollector = collector;
  let body: string;
  try {
    body = collapseBlankRuns(serializeNode(doc)).trim();
  } finally {
    activeCollector = prevCollector;
  }

  // Requirements pass runs on EVERY serialize — including the no-options
  // DEFAULT_PREAMBLE fallback — so a body that emits expex / graphicx /
  // tikz / cite commands always has the matching \usepackage (and every
  // `\v*id` shim) by the time the .tex hits disk. `||` (not `??`): an
  // empty-string preamble falls back to the default, as before.
  //
  // The DECLARED set (collector.ids, from emit-sites) is UNIONed with the
  // FALLBACK detector (detectBodyRequirements, for hand-typed raw LaTeX). The
  // two never subtract, so the result is a superset-improvement over the old
  // detector-only set — byte-stable for existing docs (the emit-sites declare
  // exactly what the regexes were catching, plus previously-missed cases).
  const required = detectBodyRequirements(body);
  for (const id of collector.ids) required.add(id);

  // Bib family: prefer the authoritative per-doc choice; else the family the
  // cite emit-sites declared. The declared/authoritative family is reconciled
  // against the preamble by ensurePreambleRequirements (inject the RIGHT
  // family; warn — never delete — on a hard conflict).
  const declaredFamily: BibFamily | null =
    options?.bibFamily ?? collector.bibFamily;

  const rawPreamble = ensurePreambleRequirements(
    options?.preamble || DEFAULT_PREAMBLE,
    required,
    {
      declaredBibFamily: declaredFamily,
      onBibFamilyConflict: options?.onRequirementConflict,
    },
  );
  // Re-inject preamble-sourced \title/\author/\date right before
  // \begin{document}. They live in the doc tree (so the editor can show
  // them), but the user intends them to live in the preamble.
  const preambleFields = collectPreambleTitleFields(doc);
  const preamble = injectTitleFieldsIntoPreamble(rawPreamble, preambleFields);
  const postamble = options?.postamble ?? DEFAULT_POSTAMBLE;
  return preamble + body + postamble;
}

export function serializeBodyOnly(doc: JSONContent): string {
  return collapseBlankRuns(serializeNode(doc)).trim();
}

/**
 * Serialize ONE paragraph node's inline content to LaTeX — the inline sequence
 * only (atoms, marks, `\vcid`/`\vfid`/`\vlid` markers), with NO trailing
 * ` %!v:<uuid>` anchor and NO surrounding blank lines.
 *
 * This is the exact string the headless AI-change applicator
 * (`src/links/apply-suggestion.ts`) splices into: it serializes the live
 * paragraph, byte-matches the suggestion's `originalText` against it (the stale
 * guard), splices `originalText → replacement`, and re-parses the whole result
 * with `parseInlineContent`. Routing through the real `serializeNode` path
 * (with `suppressChildUuids = true`, the same flag lists / blockquote bodies
 * use to drop the per-paragraph anchor) keeps the projection byte-faithful to
 * what `serializeBodyOnly` would emit for the same paragraph, so the splice the
 * applicator computes matches the headless Python accept's splice.
 *
 * `node` must be a JSONContent `paragraph` (e.g. from `pmNode.toJSON()` on the
 * live block); any other node type returns its default `serializeNode`
 * projection. No `%!v:` trailer is emitted regardless.
 */
export function serializeParagraphInline(node: JSONContent): string {
  return serializeNode(node, /* suppressChildUuids */ true);
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
  // Brace scanning is the lexer's `extractBraced` — the SSOT. (A former
  // comment here claimed the re-rolled copy avoided a "cross-module dep";
  // that was false — the lexer imports only latex-typography, so there is
  // no cycle — and the copy carried the naive single-char escape bug, which
  // dropped a `\title{Foo\\}` field plus its `%!v:` UUID on a style switch.)
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
    const braced = extractBraced(preamble, bracedStart);
    if (!braced) {
      // Unbalanced — bail on this match, advance past `\foo{`.
      i += m[0].length;
      continue;
    }
    let end = braced.end;
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
  // latexComment holds its text as native inline content now — fall through to
  // the generic content-flatten below (no `attrs.text` special-case).
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
