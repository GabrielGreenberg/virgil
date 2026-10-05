/**
 * The bibliography annotation's storage bridge (task 952).
 *
 * An annotation is stored as a sanitized HTML STRING in `annotations.json`
 * (the `useAnnotations` sidecar, keyed by uid; `answer-bib-review --type=notes`
 * writes plain text into the same slot). It is EDITED in the shared
 * `RichTextField`, which speaks `JSONContent` — so this file is the one place
 * the two dialects meet, one door each way:
 *
 *   • READ  — `annotationHtmlToRich`: sanitize (BIB-F5-01: the stored string is
 *     untrusted), then the same HTML→JSON reader legacy footnote bodies migrate
 *     through. Plain text (the skill's shape) becomes a paragraph.
 *   • WRITE — `richToAnnotationHtml`: a small serializer whose mark spellings
 *     are DERIVED from `WRAPPER_MARK_ROWS` (the tag the reader maps back), so
 *     the round trip cannot drift from the vocabulary table. The caller still
 *     routes the result through `sanitizeAnnotationHtml` — the write seam.
 *
 * Inline atoms a card body can hold (a dropped citation, inline math, a ref)
 * have no HTML spelling the sanitizer would keep, so they are written as their
 * PLAIN-TEXT projection (`richJsonToPlainText`) — the words survive, the atom
 * does not. Annotations are prose about a reference, not document content.
 */

import type { JSONContent } from "@tiptap/react";
import {
  escapeHtml,
  normalizeRichContent,
  richJsonToPlainText,
} from "@/lib/footnote-content";
import { SMALL_CAPS_MARK, WRAPPER_MARK_ROWS } from "@/lib/mark-composition";
import { sanitizeAnnotationHtml } from "@/lib/sanitize-html";

/** Stored annotation (HTML or plain text, untrusted) → editor content. */
export function annotationHtmlToRich(stored: string): JSONContent {
  return normalizeRichContent(sanitizeAnnotationHtml(stored || ""));
}

/** mark type → [open, close] tag pair, from the vocabulary table. */
const MARK_TAGS: ReadonlyMap<string, readonly [string, string]> = new Map(
  WRAPPER_MARK_ROWS.flatMap((row): Array<[string, readonly [string, string]]> => {
    if (row.mark === SMALL_CAPS_MARK) {
      return [[row.mark, ["<span data-small-caps>", "</span>"]]];
    }
    const tag = "html" in row ? row.html?.[0] : undefined;
    return tag ? [[row.mark, [`<${tag}>`, `</${tag}>`]]] : [];
  }),
);

function inlineToHtml(nodes: JSONContent[] | undefined): string {
  let out = "";
  for (const node of nodes ?? []) {
    if (node.type === "text") {
      let html = escapeHtml(node.text ?? "");
      // Innermost-first: the node's own mark order is the nesting order.
      for (const mark of node.marks ?? []) {
        const tags = MARK_TAGS.get(mark.type);
        if (tags) html = `${tags[0]}${html}${tags[1]}`;
      }
      out += html;
    } else if (node.type === "hardBreak") {
      out += "<br>";
    } else {
      out += escapeHtml(richJsonToPlainText(node));
    }
  }
  return out;
}

function blockToHtml(node: JSONContent): string {
  switch (node.type) {
    case "paragraph":
      return `<p>${inlineToHtml(node.content)}</p>`;
    case "bulletList":
    case "orderedList": {
      const tag = node.type === "bulletList" ? "ul" : "ol";
      const items = (node.content ?? []).map((li) => {
        // A list item's paragraphs read back as one line each.
        const inner = (li.content ?? [])
          .map((child) =>
            child.type === "paragraph" ? inlineToHtml(child.content) : blockToHtml(child),
          )
          .join("<br>");
        return `<li>${inner}</li>`;
      });
      return `<${tag}>${items.join("")}</${tag}>`;
    }
    default: {
      const text = richJsonToPlainText(node);
      return text ? `<p>${escapeHtml(text)}</p>` : "";
    }
  }
}

/**
 * Editor content → the stored HTML. An annotation with no words serializes to
 * `""`, which `useAnnotations` treats as "delete the key" — clearing the field
 * clears the annotation rather than storing `<p></p>`.
 */
export function richToAnnotationHtml(doc: JSONContent): string {
  if (!richJsonToPlainText(doc).trim()) return "";
  return (doc.content ?? []).map(blockToHtml).join("");
}
