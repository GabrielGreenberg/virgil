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
  blockquotes: "Block Quotes",
  lists: "Lists",
  math: "Math",
  comments: "Comments",
};

export { CATEGORY_LABELS };

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function countSentences(text: string): number {
  const matches = text.match(/[.!?]+[\s"'\u201D\u2019)}\]]*(?=[A-Z\u00C0-\u024F]|\s*$)/g);
  return matches ? matches.length : text.trim() ? 1 : 0;
}

type Category = "mainText" | "headings" | "footnotes" | "blockquotes" | "lists" | "math" | "comments";

function walkDoc(doc: PmNode): WordCounts {
  const cats: Record<Category, string[]> = {
    mainText: [],
    headings: [],
    footnotes: [],
    blockquotes: [],
    lists: [],
    math: [],
    comments: [],
  };

  function collectInline(node: PmNode, bucket: string[]) {
    if (node.isText && node.text) {
      bucket.push(node.text);
    } else if (node.type.name === "inlineMath") {
      bucket.push(node.attrs.latex || "");
    } else if (node.type.name === "citation") {
      // citations are reference markers, not prose — skip
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
        node.forEach((child) => walkBlock(child, "blockquotes"));
        break;

      case "bulletList":
      case "orderedList":
        node.forEach((child) => walkBlock(child, ctx === "blockquotes" ? "blockquotes" : "lists"));
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
  const text = editor.state.doc.textBetween(from, to, " ");
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
