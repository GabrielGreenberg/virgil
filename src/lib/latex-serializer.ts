import { JSONContent } from "@tiptap/react";
import type { VirgilSidecar } from "@/lib/types";
import { richJsonToLatex, richJsonToPlainText, normalizeRichContent } from "@/lib/footnote-content";

const PREAMBLE = `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath}
\\usepackage{amssymb}

\\begin{document}

`;

const POSTAMBLE = `
\\end{document}
`;

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

function serializeNode(node: JSONContent, insideList = false, listDepth = 0): string {
  switch (node.type) {
    case "doc":
      return (node.content || []).map((n) => serializeNode(n)).join("");

    case "paragraph": {
      if (!node.content || node.content.length === 0) return insideList ? "" : "%!v:blank\n";
      const inner = (node.content || []).map(serializeInline).join("");
      if (insideList) return inner;
      const uuid = node.attrs?.uuid as string | null;
      const anchor = uuid ? ` %!v:${uuid}` : "";
      return inner + anchor + "\n\n";
    }

    case "heading": {
      const level = (node.attrs?.level as number) || 1;
      const label = node.attrs?.label as string | null;
      const uuid = node.attrs?.uuid as string | null;
      const inner = (node.content || []).map(serializeInline).join("");
      const commands = ["\\section", "\\subsection", "\\subsubsection"];
      const cmd = commands[Math.min(level - 1, 2)];
      const labelStr = label ? `\n\\label{${label}}` : "";
      const anchor = uuid ? ` %!v:${uuid}` : "";
      return `${cmd}{${inner}}${labelStr}${anchor}\n\n`;
    }

    case "titleField": {
      const field = node.attrs?.field as string;
      const rawPrefix = (node.attrs?.rawPrefix as string) || "";
      if (node.attrs?.isToday) {
        return `\\${field}{\\today}\n\n`;
      }
      const inner = (node.content || []).map(serializeInline).join("");
      return `\\${field}{${rawPrefix}${inner}}\n\n`;
    }

    case "codeBlock": {
      const inner = (node.content || []).map(serializeInline).join("");
      return `\\begin{verbatim}\n${inner}\n\\end{verbatim}\n\n`;
    }

    case "blockquote": {
      const inner = (node.content || []).map((n) => serializeNode(n)).join("");
      return `\\begin{quote}\n${inner}\\end{quote}\n\n`;
    }

    case "bulletList": {
      const items = (node.content || []).map((n) => serializeNode(n, false, listDepth)).join("");
      const uuid = node.attrs?.uuid as string | null;
      const anchor = uuid ? ` %!v:${uuid}` : "";
      const indent = "  ".repeat(listDepth);
      // Top-level list gets surrounding blank lines; nested lists do not.
      const trailing = listDepth === 0 ? "\n\n" : "\n";
      return `${indent}\\begin{itemize}\n${items}${indent}\\end{itemize}${anchor}${trailing}`;
    }

    case "orderedList": {
      const items = (node.content || []).map((n) => serializeNode(n, false, listDepth)).join("");
      const uuid = node.attrs?.uuid as string | null;
      const anchor = uuid ? ` %!v:${uuid}` : "";
      const indent = "  ".repeat(listDepth);
      const trailing = listDepth === 0 ? "\n\n" : "\n";
      return `${indent}\\begin{enumerate}\n${items}${indent}\\end{enumerate}${anchor}${trailing}`;
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

    case "displayMath":
      return `\\[\n${node.attrs?.latex || ""}\n\\]\n\n`;

    case "footnote":
      return `\\footnote{${richJsonToLatex(normalizeRichContent(node.attrs?.content))}}`;

    case "latexComment":
      return `% ${node.attrs?.text || ""}\n`;

    case "archiveMarker": {
      const preview = (node.attrs?.preview || "").replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}");
      return `\\archivemarker{${node.attrs?.archiveId || ""}}{${preview}}`;
    }

    case "citation":
      return node.attrs?.command || "";

    case "hardBreak":
      return "\\\\\n";

    default:
      if (node.content) {
        return (node.content || []).map((n) => serializeNode(n)).join("");
      }
      return "";
  }
}

function serializeInline(node: JSONContent): string {
  if (node.type === "text") {
    return serializeMarks(node.text || "", node.marks);
  }
  if (node.type === "inlineMath") {
    return `$${node.attrs?.latex || ""}$`;
  }
  if (node.type === "footnote") {
    return `\\footnote{${richJsonToLatex(normalizeRichContent(node.attrs?.content))}}`;
  }
  if (node.type === "archiveMarker") {
    const preview = (node.attrs?.preview || "").replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}");
    return `\\archivemarker{${node.attrs?.archiveId || ""}}{${preview}}`;
  }
  if (node.type === "citation") {
    return node.attrs?.command || "";
  }
  if (node.type === "hardBreak") {
    return "\\\\\n";
  }
  return "";
}

export function serializeToLatex(doc: JSONContent): string {
  const body = serializeNode(doc).replace(/\n{3,}/g, "\n\n").trim();
  return PREAMBLE + body + POSTAMBLE;
}

export function serializeBodyOnly(doc: JSONContent): string {
  return serializeNode(doc).replace(/\n{3,}/g, "\n\n").trim();
}

function generateUuid(existing: Set<string>): string {
  let id: string;
  do {
    id = Math.random().toString(16).slice(2, 6);
  } while (existing.has(id));
  return id;
}

/** Assign UUIDs to all non-empty paragraphs and lists that lack one. Mutates the doc in place.
 *  Skips paragraphs inside list items (they don't get individual codes).
 *  Lists (bulletList, orderedList) get a single UUID for the whole list. */
export function assignUuids(doc: JSONContent): void {
  const LIST_TYPES = new Set(["bulletList", "orderedList"]);
  const UUID_TYPES = new Set(["paragraph", "heading", "bulletList", "orderedList"]);
  const existing = new Set<string>();
  // First pass: collect existing UUIDs
  function collect(node: JSONContent) {
    if (UUID_TYPES.has(node.type!) && node.attrs?.uuid) {
      existing.add(node.attrs.uuid as string);
    }
    node.content?.forEach(collect);
  }
  collect(doc);
  // Second pass: assign missing UUIDs (skip paragraphs inside list items)
  function assign(node: JSONContent, insideList = false) {
    // Lists get a single UUID for the whole list
    if (LIST_TYPES.has(node.type!)) {
      if (!node.attrs?.uuid) {
        if (!node.attrs) node.attrs = {};
        node.attrs.uuid = generateUuid(existing);
        existing.add(node.attrs.uuid as string);
      }
      // Clear stale UUIDs on paragraphs inside list items
      node.content?.forEach((listItem) => {
        listItem.content?.forEach((child) => {
          if (child.type === "paragraph" && child.attrs?.uuid) {
            child.attrs.uuid = null;
            child.attrs.parTitle = null;
          }
        });
      });
      return;
    }
    // Headings always get a UUID
    if (node.type === "heading" && !node.attrs?.uuid) {
      if (!node.attrs) node.attrs = {};
      node.attrs.uuid = generateUuid(existing);
      existing.add(node.attrs.uuid as string);
    }
    if (
      node.type === "paragraph" &&
      !insideList &&
      node.content &&
      node.content.length > 0 &&
      !node.attrs?.uuid
    ) {
      if (!node.attrs) node.attrs = {};
      node.attrs.uuid = generateUuid(existing);
      existing.add(node.attrs.uuid as string);
    }
    node.content?.forEach((child) => assign(child, insideList));
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
  if (node.type === "archiveMarker") return "";
  if (!node.content) return "";
  const sep = node.type === "bulletList" || node.type === "orderedList" ? "; " : "";
  return node.content.map(extractPlainText).join(sep);
}

/** Compute a content fingerprint: lowercased, whitespace-collapsed, first 80 chars. */
function computeFingerprint(node: JSONContent): string {
  const text = extractPlainText(node);
  return text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80);
}

const UUID_ELIGIBLE = new Set(["paragraph", "heading", "bulletList", "orderedList"]);

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
  const LIST_TYPES = new Set(["bulletList", "orderedList"]);

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

  // 3. Walk document for UUID-eligible nodes missing a UUID, try to recover
  function recover(node: JSONContent, insideList = false) {
    if (LIST_TYPES.has(node.type!)) {
      if (!node.attrs?.uuid) {
        const fp = computeFingerprint(node);
        if (fp) tryRestore(node, fp);
      }
      return; // don't recurse into list items for recovery
    }
    if (
      node.type === "heading" ||
      (node.type === "paragraph" && !insideList && node.content && node.content.length > 0)
    ) {
      if (!node.attrs?.uuid) {
        const fp = computeFingerprint(node);
        if (fp) tryRestore(node, fp);
      }
    }
    node.content?.forEach((child) => recover(child, insideList));
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
