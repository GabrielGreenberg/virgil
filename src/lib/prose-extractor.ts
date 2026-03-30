import { JSONContent } from "@tiptap/react";

export function extractProse(doc: JSONContent): string {
  const parts: string[] = [];
  walkNode(doc, parts);
  return parts.join("").replace(/\n{3,}/g, "\n\n").trim();
}

function walkNode(node: JSONContent, parts: string[]): void {
  switch (node.type) {
    case "doc":
      (node.content || []).forEach((n) => walkNode(n, parts));
      break;

    case "paragraph":
      (node.content || []).forEach((n) => walkInline(n, parts));
      parts.push("\n\n");
      break;

    case "heading":
      (node.content || []).forEach((n) => walkInline(n, parts));
      parts.push("\n\n");
      break;

    case "blockquote":
      (node.content || []).forEach((n) => walkNode(n, parts));
      break;

    case "bulletList":
    case "orderedList":
      (node.content || []).forEach((n) => walkNode(n, parts));
      break;

    case "listItem":
      (node.content || []).forEach((n) => walkNode(n, parts));
      break;

    case "codeBlock":
      (node.content || []).forEach((n) => walkInline(n, parts));
      parts.push("\n\n");
      break;

    case "displayMath":
      // skip math in prose extraction
      parts.push("[math]\n\n");
      break;

    case "horizontalRule":
      parts.push("\n\n");
      break;

    default:
      if (node.content) {
        (node.content || []).forEach((n) => walkNode(n, parts));
      }
  }
}

function walkInline(node: JSONContent, parts: string[]): void {
  if (node.type === "text") {
    parts.push(node.text || "");
  } else if (node.type === "inlineMath") {
    // keep inline math as-is for context
    parts.push(`$${node.attrs?.latex || ""}$`);
  } else if (node.type === "hardBreak") {
    parts.push("\n");
  }
}
