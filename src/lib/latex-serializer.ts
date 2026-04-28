import { JSONContent } from "@tiptap/react";
import type { VirgilSidecar } from "@/lib/types";
import { ANCHORABLE_NODES } from "@/lib/marginalia";
import { generateShortId } from "@/lib/uuid";
import { richJsonToLatex, richJsonToPlainText, normalizeRichContent } from "@/lib/footnote-content";
import { CLASSIC_PREAMBLE } from "@/lib/document-styles";

// The classic preset is the historical default — used as the fallback
// when a doc has no preserved preamble and the caller didn't pass one.
const DEFAULT_PREAMBLE = CLASSIC_PREAMBLE;

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
  const hasVexid = /\\(?:provide|new|renew)command\{\\vexid\}/.test(preamble);
  if (hasVfid && hasVcid && hasVexid) return preamble;

  const beginMarker = "\\begin{document}";
  const beginIdx = preamble.indexOf(beginMarker);
  if (beginIdx === -1) return preamble;

  const additions: string[] = [];
  if (!hasVfid) additions.push("\\providecommand{\\vfid}[1]{}");
  if (!hasVcid) additions.push("\\providecommand{\\vcid}[1]{}");
  if (!hasVexid) additions.push("\\providecommand{\\vexid}[1]{}");

  const before = preamble.slice(0, beginIdx).replace(/\s*$/, "");
  const after = preamble.slice(beginIdx);
  return before + "\n\n" + additions.join("\n") + "\n\n" + after;
}

function serializeMarks(
  text: string,
  marks?: { type: string; attrs?: Record<string, unknown> }[]
): string {
  if (!marks || marks.length === 0) return escapeLatex(text);

  // latexCommand mark: text is already raw LaTeX — return as-is
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

function escapeLatex(text: string): string {
  // Don't escape backslashes — they're intentional LaTeX commands.
  // The editor preserves raw LaTeX, so we only escape the few chars
  // that would break LaTeX if they appeared as literal text.
  // We also don't escape {, }, $ since those are part of LaTeX syntax.
  return text
    .replace(/(?<!\\)([&%#_])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

function serializeTitleField(node: JSONContent): string {
  const field = node.attrs?.field as string;
  const rawPrefix = (node.attrs?.rawPrefix as string) || "";
  const uuid = node.attrs?.uuid as string | null;
  const anchor = uuid ? ` %!v:${uuid}` : "";
  if (node.attrs?.isToday) {
    return `\\${field}{\\today}${anchor}\n`;
  }
  const inner = (node.content || []).map(serializeInline).join("");
  return `\\${field}{${rawPrefix}${inner}}${anchor}\n`;
}

function collectPreambleTitleFields(doc: JSONContent): JSONContent[] {
  const out: JSONContent[] = [];
  function walk(n: JSONContent) {
    if (n.type === "titleField" && n.attrs?.fromPreamble) out.push(n);
    n.content?.forEach(walk);
  }
  walk(doc);
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
      if (!node.content || node.content.length === 0) return suppressChildUuids ? "" : "%!v:blank\n";
      const inner = (node.content || []).map(serializeInline).join("");
      if (suppressChildUuids) return inner;
      const uuid = node.attrs?.uuid as string | null;
      const anchor = uuid ? ` %!v:${uuid}` : "";
      return inner + anchor + "\n\n";
    }

    case "heading": {
      const level = (node.attrs?.level as number) || 1;
      const label = node.attrs?.label as string | null;
      const uuid = node.attrs?.uuid as string | null;
      const numbered = node.attrs?.numbered;
      const inner = (node.content || []).map(serializeInline).join("");
      const commands = ["\\chapter", "\\section", "\\subsection", "\\subsubsection"];
      const cmd = commands[Math.min(level - 1, 3)];
      const star = numbered === false ? "*" : "";
      const labelStr = label ? `\n\\label{${label}}` : "";
      const anchor = uuid ? ` %!v:${uuid}` : "";
      return `${cmd}${star}{${inner}}${labelStr}${anchor}\n\n`;
    }

    case "titleField": {
      // When the title field came from the preamble, it's re-emitted
      // by `serializeToLatex` directly into the preamble text — skip
      // it here so it doesn't also appear in the body.
      if (node.attrs?.fromPreamble) return "";
      return serializeTitleField(node) + "\n";
    }

    case "maketitleMarker": {
      const uuid = node.attrs?.uuid as string | null;
      const anchor = uuid ? ` %!v:${uuid}` : "";
      return `\\maketitle${anchor}\n\n`;
    }

    case "codeBlock": {
      const inner = (node.content || []).map(serializeInline).join("");
      const uuid = node.attrs?.uuid as string | null;
      const anchor = uuid ? ` %!v:${uuid}` : "";
      return `\\begin{verbatim}\n${inner}\n\\end{verbatim}${anchor}\n\n`;
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
          ? (head.content || []).map(serializeInline).join("")
          : "";
      // Serialize trailing block children (nested lists, etc.) with bumped depth
      const tailText = tail
        .map((n) => serializeNode(n, false, listDepth + 1))
        .join("")
        .replace(/\n+$/, ""); // strip trailing blank lines from nested blocks
      if (tailText) {
        return `${indent}\\item ${headText}\n${tailText}\n`;
      }
      return `${indent}\\item ${headText}\n`;
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
      return `${idMarker}\\footnote{${richJsonToLatex(normalizeRichContent(node.attrs?.content))}}`;
    }

    case "latexComment": {
      const uuid = node.attrs?.uuid as string | null;
      const anchor = uuid ? ` %!v:${uuid}` : "";
      return `% ${node.attrs?.text || ""}${anchor}\n`;
    }

    case "archiveMarker": {
      const preview = (node.attrs?.preview || "").replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}");
      return `\\archivemarker{${node.attrs?.archiveId || ""}}{${preview}}`;
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

    case "aiRequestMarker": {
      const kind = String(node.attrs?.kind || "footnote");
      const text = String(node.attrs?.text || "")
        .replace(/\r?\n/g, " ")
        .trim();
      return `% AI request (${kind}): ${text}\n`;
    }

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
  return nodes.map(serializeInline).join("");
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

  // Walk children in document order — paragraphs, gloss blocks, and
  // exampleItemLists can interleave freely. Schema:
  // `(paragraph | exampleGloss | exampleItemList)*`.
  const children = node.content || [];
  const bodyPieces: string[] = [];
  for (const child of children) {
    if (child.type === "paragraph") {
      bodyPieces.push(serializeExampleInlineChildren(child.content));
    } else if (child.type === "exampleGloss") {
      bodyPieces.push(serializeExampleGloss(child).trimEnd());
    } else if (child.type === "exampleItemList") {
      const items = (child.content || []).filter(
        (c) => c.type === "exampleItem",
      );
      const itemsStr = items.map((it) => serializeExampleItem(it)).join("");
      if (itemsStr) bodyPieces.push(itemsStr.trimEnd());
    }
  }
  const body = bodyPieces.join("\n");

  return (
    `${idMarker}\\${kind}${suppress}${optStr}${tagStr}${labelStr}\n` +
    (body ? body + "\n" : "") +
    `\\xe\n\n`
  );
}

function serializeExampleItem(node: JSONContent): string {
  const tag = (node.attrs?.tag as string) || "";
  const tagStr = tag ? `<${tag}>` : "";
  const label = (node.attrs?.label as string) || "";
  const labelStr = label ? `\\label{${label}}` : "";
  const pieces: string[] = [];
  for (const child of node.content || []) {
    if (child.type === "paragraph") {
      pieces.push(serializeExampleInlineChildren(child.content));
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
  return `\\a${tagStr}${labelStr} ${body}\n`;
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
    return `${idMarker}\\footnote{${richJsonToLatex(normalizeRichContent(node.attrs?.content))}}`;
  }
  if (node.type === "archiveMarker") {
    const preview = (node.attrs?.preview || "").replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}");
    return `\\archivemarker{${node.attrs?.archiveId || ""}}{${preview}}`;
  }
  if (node.type === "citation") {
    const cid = node.attrs?.citationId as string | undefined;
    const idMarker = cid ? `\\vcid{${cid}}` : "";
    return `${idMarker}${node.attrs?.command || ""}`;
  }
  if (node.type === "labelRef") {
    return serializeLabelRef(node);
  }
  if (node.type === "aiRequestMarker") {
    // AI request markers are placeholders. Emit them as a LaTeX comment
    // so they round-trip through the .tex file without breaking the
    // surrounding inline text. LaTeX comments swallow the newline that
    // follows them, so we add a space prefix to keep adjacent words from
    // concatenating in the rendered output.
    const kind = String(node.attrs?.kind || "footnote");
    const text = String(node.attrs?.text || "")
      .replace(/\r?\n/g, " ")
      .trim();
    return ` % AI request (${kind}): ${text}\n`;
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


/** Assign UUIDs to all block-level nodes that lack one. Mutates the doc in place.
 *  Container nodes (lists, blockquote) get a single UUID — inner paragraphs are suppressed.
 *  Headings, titleFields, atom blocks (displayMath, latexComment, codeBlock) always get a UUID. */
export function assignUuids(doc: JSONContent): void {
  const CONTAINER_TYPES = new Set(["bulletList", "orderedList", "blockquote"]);
  const existing = new Set<string>();

  // First pass: collect existing UUIDs and detect duplicates.
  // If the same UUID appears on multiple nodes (e.g. from a bad recovery),
  // only the first node keeps it — the rest get cleared so pass 2 assigns
  // fresh unique UUIDs.
  const seen = new Set<string>();
  function dedup(node: JSONContent) {
    if (ANCHORABLE_NODES.has(node.type!) && node.attrs?.uuid) {
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
    // Container nodes get a single UUID; inner paragraphs are suppressed
    if (CONTAINER_TYPES.has(node.type!)) {
      if (!node.attrs?.uuid) ensureUuid(node);
      // Clear stale UUIDs on paragraphs inside list items / blockquote children
      const clearChildren = (children: JSONContent[]) => {
        for (const child of children) {
          if (child.type === "paragraph" && child.attrs?.uuid) {
            child.attrs.uuid = null;
            child.attrs.parTitle = null;
          }
          // For lists, walk into listItem children
          if (child.type === "listItem" && child.content) clearChildren(child.content);
        }
      };
      if (node.content) clearChildren(node.content);
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
      (node.type === "displayMath" || node.type === "latexComment" || node.type === "codeBlock") &&
      !node.attrs?.uuid
    ) {
      ensureUuid(node);
    }
    node.content?.forEach((child) => assign(child, insideContainer));
  }
  assign(doc);
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
  if (node.type === "archiveMarker") return "";
  if (node.type === "aiRequestMarker") return "";
  if (!node.content) return "";
  const sep = node.type === "bulletList" || node.type === "orderedList" ? "; " : "";
  return node.content.map(extractPlainText).join(sep);
}

/** Compute a content fingerprint: lowercased, whitespace-collapsed, first 80 chars. */
function computeFingerprint(node: JSONContent): string {
  const text = extractPlainText(node);
  return text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80);
}

const UUID_ELIGIBLE = ANCHORABLE_NODES;

/** Extract sidecar data (titles + fingerprints keyed by UUID) from the document. */
export function extractSidecarData(doc: JSONContent): VirgilSidecar {
  const paragraphs: VirgilSidecar["paragraphs"] = {};
  function walk(node: JSONContent) {
    if (UUID_ELIGIBLE.has(node.type!) && node.attrs?.uuid) {
      const uuid = node.attrs.uuid as string;
      const fp = computeFingerprint(node);
      const title = node.attrs.parTitle as string | undefined;
      if (title || fp) {
        paragraphs[uuid] = {
          ...(title ? { title } : {}),
          ...(fp ? { fingerprint: fp } : {}),
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
    // Container nodes: recover the container UUID, don't recurse into children
    if (CONTAINER_TYPES.has(node.type!)) {
      if (!node.attrs?.uuid) {
        const fp = computeFingerprint(node);
        if (fp) tryRestore(node, fp);
      }
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
      (node.type === "displayMath" || node.type === "latexComment" || node.type === "codeBlock") &&
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
