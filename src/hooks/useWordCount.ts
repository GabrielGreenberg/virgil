"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import type { Node as PmNode } from "@tiptap/pm/model";

export interface WordCounts {
  total: number;
  characters: number;
  sentences: number;
  readingTime: string;
  categories: Record<string, number>;
}

export interface SelectionCounts {
  words: number;
  characters: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  mainText: "Main Text",
  headings: "Headings",
  footnotes: "Footnotes",
  captions: "Captions",
  math: "Math",
  comments: "Comments",
};

export { CATEGORY_LABELS };

/**
 * Extract plain text from `\caption{...}` commands inside raw LaTeX strings
 * (e.g. from unknown environments like figure/table). Handles nested braces.
 */
function extractCaptionText(raw: string): string[] {
  const results: string[] = [];
  let i = 0;
  while (i < raw.length) {
    const idx = raw.indexOf("\\caption", i);
    if (idx === -1) break;
    let pos = idx + "\\caption".length;
    // skip optional star
    if (pos < raw.length && raw[pos] === "*") pos++;
    // skip optional [...]
    if (pos < raw.length && raw[pos] === "[") {
      const close = raw.indexOf("]", pos);
      if (close !== -1) pos = close + 1;
    }
    // expect {
    if (pos < raw.length && raw[pos] === "{") {
      let depth = 1;
      const start = pos + 1;
      pos++;
      while (pos < raw.length && depth > 0) {
        if (raw[pos] === "\\" && pos + 1 < raw.length) {
          pos += 2; // skip escaped char
          continue;
        }
        if (raw[pos] === "{") depth++;
        else if (raw[pos] === "}") depth--;
        if (depth > 0) pos++;
      }
      if (depth === 0) {
        // Strip inner LaTeX commands to get plain text
        const inner = raw.slice(start, pos);
        const plain = inner
          .replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])*\{([^}]*)\}/g, "$2") // \cmd{text} → text
          .replace(/\\[a-zA-Z]+\*?/g, "") // bare \commands
          .replace(/[{}]/g, "") // leftover braces
          .trim();
        if (plain) results.push(plain);
      }
    }
    i = pos + 1;
  }
  return results;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function countSentences(text: string): number {
  const matches = text.match(/[.!?]+[\s"'\u201D\u2019)}\]]*(?=[A-Z\u00C0-\u024F]|\s*$)/g);
  return matches ? matches.length : text.trim() ? 1 : 0;
}

type Category = "mainText" | "headings" | "footnotes" | "captions" | "math" | "comments";

function walkDoc(doc: PmNode): WordCounts {
  const cats: Record<Category, string[]> = {
    mainText: [],
    headings: [],
    footnotes: [],
    captions: [],
    math: [],
    comments: [],
  };

  function collectInline(node: PmNode, bucket: string[]) {
    if (node.isText && node.text) {
      // Text marked as latexCommand is raw LaTeX — not prose.
      // Extract any \caption{...} text into captions, skip the rest.
      if (node.marks.some((m) => m.type.name === "latexCommand")) {
        const capts = extractCaptionText(node.text);
        for (const c of capts) cats.captions.push(c);
        return;
      }
      bucket.push(node.text);
    } else if (node.type.name === "inlineMath") {
      bucket.push(node.attrs.latex || "");
    } else if (node.type.name === "citation") {
      // citations are reference markers, not prose — skip
    } else if (node.type.name === "aiRequestMarker") {
      // AI request placeholders are not prose — skip
    } else if (node.type.name === "footnote") {
      // footnote content goes to footnotes category
      const content = node.attrs.content || "";
      if (content) cats.footnotes.push(content);
    } else if (node.type.name === "hardBreak") {
      bucket.push(" ");
    } else {
      node.forEach((child) => collectInline(child, bucket));
    }
  }

  function walkBlock(node: PmNode, ctx: Category) {
    switch (node.type.name) {
      case "doc":
        node.forEach((child) => walkBlock(child, ctx));
        break;

      case "heading":
        collectInline(node, cats.headings);
        break;

      case "blockquote":
        node.forEach((child) => walkBlock(child, ctx));
        break;

      case "bulletList":
      case "orderedList":
        node.forEach((child) => walkBlock(child, ctx));
        break;

      case "listItem":
        node.forEach((child) => walkBlock(child, ctx));
        break;

      case "displayMath": {
        const latex = node.attrs.latex || "";
        if (latex) cats.math.push(latex);
        break;
      }

      case "latexComment": {
        const text = node.attrs.text || "";
        if (text) cats.comments.push(text);
        break;
      }

      case "paragraph":
        collectInline(node, cats[ctx]);
        break;

      case "codeBlock":
        // code blocks: count as main text
        collectInline(node, cats[ctx]);
        break;

      default:
        // titleField, maketitleMarker, horizontalRule, etc.
        if (node.content && node.content.size > 0) {
          node.forEach((child) => walkBlock(child, ctx));
        }
        break;
    }
  }

  walkBlock(doc, "mainText");

  const allText: string[] = [];
  const categories: Record<string, number> = {};

  for (const [key, parts] of Object.entries(cats)) {
    const joined = parts.join(" ");
    const wc = countWords(joined);
    categories[key] = wc;
    if (joined.trim()) allText.push(joined);
  }

  const fullText = allText.join(" ");
  const total = countWords(fullText);
  const characters = fullText.replace(/\s/g, "").length;
  const sentences = countSentences(fullText);
  const minutes = Math.max(1, Math.round(total / 225));
  const readingTime = minutes === 1 ? "1 min" : `${minutes} min`;

  return { total, characters, sentences, readingTime, categories };
}

function getSelectionCounts(editor: Editor): SelectionCounts | null {
  const { from, to } = editor.state.selection;
  if (from === to) return null;

  const parts: string[] = [];
  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isText && node.text) {
      // Raw LaTeX (e.g. \cite{foo}, unhandled commands) — skip, but pull
      // any \caption{...} text out so figure/table captions still count.
      if (node.marks.some((m) => m.type.name === "latexCommand")) {
        for (const c of extractCaptionText(node.text)) parts.push(c);
        return false;
      }
      const start = Math.max(pos, from);
      const end = Math.min(pos + node.nodeSize, to);
      parts.push(node.text.slice(start - pos, end - pos));
      return false;
    }
    switch (node.type.name) {
      case "citation":
      case "aiRequestMarker":
        return false;
      case "inlineMath":
      case "displayMath": {
        const latex = node.attrs.latex || "";
        if (latex) parts.push(latex);
        return false;
      }
      case "footnote": {
        const content = node.attrs.content || "";
        if (content) parts.push(content);
        return false;
      }
      case "latexComment": {
        const text = node.attrs.text || "";
        if (text) parts.push(text);
        return false;
      }
      default:
        return true;
    }
  });

  const text = parts.join(" ");
  return {
    words: countWords(text),
    characters: text.replace(/\s/g, "").length,
  };
}

export function useWordCount(editor: Editor | null) {
  const [counts, setCounts] = useState<WordCounts>({
    total: 0, characters: 0, sentences: 0, readingTime: "0 min",
    categories: {},
  });
  const [selection, setSelection] = useState<SelectionCounts | null>(null);

  const contentTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const selTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const recount = useCallback(() => {
    if (!editor) return;
    setCounts(walkDoc(editor.state.doc));
  }, [editor]);

  const resel = useCallback(() => {
    if (!editor) return;
    setSelection(getSelectionCounts(editor));
  }, [editor]);

  useEffect(() => {
    if (!editor) return;

    // initial count
    setCounts(walkDoc(editor.state.doc));
    setSelection(getSelectionCounts(editor));

    const onUpdate = () => {
      clearTimeout(contentTimer.current);
      contentTimer.current = setTimeout(recount, 300);
    };
    const onSel = () => {
      clearTimeout(selTimer.current);
      selTimer.current = setTimeout(resel, 50);
    };

    editor.on("update", onUpdate);
    editor.on("selectionUpdate", onSel);

    return () => {
      editor.off("update", onUpdate);
      editor.off("selectionUpdate", onSel);
      clearTimeout(contentTimer.current);
      clearTimeout(selTimer.current);
    };
  }, [editor, recount, resel]);

  return { counts, selection };
}
