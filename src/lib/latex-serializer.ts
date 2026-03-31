import { JSONContent } from "@tiptap/react";

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

function serializeNode(node: JSONContent): string {
  switch (node.type) {
    case "doc":
      return (node.content || []).map(serializeNode).join("");

    case "paragraph": {
      if (!node.content || node.content.length === 0) return "\n";
      const inner = (node.content || []).map(serializeInline).join("");
      return inner + "\n\n";
    }

    case "heading": {
      const level = (node.attrs?.level as number) || 1;
      const label = node.attrs?.label as string | null;
      const inner = (node.content || []).map(serializeInline).join("");
      const commands = ["\\section", "\\subsection", "\\subsubsection"];
      const cmd = commands[Math.min(level - 1, 2)];
      const labelStr = label ? `\n\\label{${label}}` : "";
      return `${cmd}{${inner}}${labelStr}\n\n`;
    }

    case "codeBlock": {
      const inner = (node.content || []).map(serializeInline).join("");
      return `\\begin{verbatim}\n${inner}\n\\end{verbatim}\n\n`;
    }

    case "blockquote": {
      const inner = (node.content || []).map(serializeNode).join("");
      return `\\begin{quote}\n${inner}\\end{quote}\n\n`;
    }

    case "bulletList": {
      const items = (node.content || []).map(serializeNode).join("");
      return `\\begin{itemize}\n${items}\\end{itemize}\n\n`;
    }

    case "orderedList": {
      const items = (node.content || []).map(serializeNode).join("");
      return `\\begin{enumerate}\n${items}\\end{enumerate}\n\n`;
    }

    case "listItem": {
      const inner = (node.content || [])
        .map(serializeNode)
        .join("")
        .trim();
      return `  \\item ${inner}\n`;
    }

    case "horizontalRule":
      return "\\hrulefill\n\n";

    case "inlineMath":
      return `$${node.attrs?.latex || ""}$`;

    case "displayMath":
      return `\\[\n${node.attrs?.latex || ""}\n\\]\n\n`;

    case "footnote":
      return `\\footnote{${node.attrs?.content || ""}}`;

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
        return (node.content || []).map(serializeNode).join("");
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
    return `\\footnote{${node.attrs?.content || ""}}`;
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
