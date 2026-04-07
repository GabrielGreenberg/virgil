"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import type { Editor } from "@tiptap/react";
import type { Node as PmNode } from "@tiptap/pm/model";
import {
  type Category,
  type WordCountConfig,
  ALL_CATEGORIES,
  CATEGORY_LABELS,
} from "./useWordCountConfig";

export interface WordCounts {
  /** Sum of words from categories the config marks as included. */
  total: number;
  /** Characters (no whitespace) of the included text. */
  characters: number;
  /** Sentences in the included text. */
  sentences: number;
  /** Reading time string for the included text. */
  readingTime: string;
  /** Raw per-category word counts (independent of config). */
  categories: Record<Category, number>;
}

export interface SelectionCounts {
  words: number;
  characters: number;
}

// Re-export so existing imports keep working.
export { CATEGORY_LABELS };
export type { Category };

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function countSentences(text: string): number {
  const matches = text.match(/[.!?]+[\s"'\u201D\u2019)}\]]*(?=[A-Z\u00C0-\u024F]|\s*$)/g);
  return matches ? matches.length : text.trim() ? 1 : 0;
}

const EMPTY_TEXTS: Record<Category, string> = {
  mainText: "",
  headings: "",
  footnotes: "",
  blockquotes: "",
  lists: "",
  math: "",
  comments: "",
};

/**
 * Walk the document and bucket text by category. Categories are stored as
 * raw strings so the consuming hook can re-derive totals whenever the
 * include config changes — without re-walking the doc.
 */
function walkDoc(doc: PmNode): Record<Category, string> {
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
      const latex = (node.attrs.latex as string) || "";
      if (latex) cats.math.push(latex);
    } else if (node.type.name === "citation") {
      // citations are reference markers, not prose — skip
    } else if (node.type.name === "footnote") {
      const content = (node.attrs.content as string) || "";
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
        const latex = (node.attrs.latex as string) || "";
        if (latex) cats.math.push(latex);
        break;
      }

      case "latexComment": {
        const text = (node.attrs.text as string) || "";
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

  const out = { ...EMPTY_TEXTS };
  for (const cat of ALL_CATEGORIES) {
    out[cat] = cats[cat].join(" ");
  }
  return out;
}

/**
 * Apply the include config to bucketed text and produce display-ready counts.
 */
function computeCounts(
  texts: Record<Category, string>,
  config: WordCountConfig,
): WordCounts {
  const categories: Record<Category, number> = {
    mainText: 0,
    headings: 0,
    footnotes: 0,
    blockquotes: 0,
    lists: 0,
    math: 0,
    comments: 0,
  };
  const includedParts: string[] = [];
  for (const cat of ALL_CATEGORIES) {
    const text = texts[cat];
    categories[cat] = countWords(text);
    if (config.include[cat] && text.trim()) {
      includedParts.push(text);
    }
  }
  const fullText = includedParts.join(" ");
  const total = countWords(fullText);
  const characters = fullText.replace(/\s/g, "").length;
  const sentences = countSentences(fullText);
  const minutes = Math.max(1, Math.round(total / 225));
  const readingTime = minutes === 1 ? "1 min" : `${minutes} min`;

  return { total, characters, sentences, readingTime, categories };
}

/**
 * Count words/characters in the current selection. Comments are skipped
 * unless the user explicitly selected only comment content (pragmatic rule
 * — clicking a single comment node should still report its size).
 */
function getSelectionCounts(editor: Editor, config: WordCountConfig): SelectionCounts | null {
  const { from, to } = editor.state.selection;
  if (from === to) return null;

  let nonCommentWords = 0;
  let nonCommentChars = 0;
  let commentWords = 0;
  let commentChars = 0;
  let nonCommentContent = false;

  const addText = (text: string, isComment: boolean) => {
    const w = countWords(text);
    const c = text.replace(/\s/g, "").length;
    if (isComment) {
      commentWords += w;
      commentChars += c;
    } else {
      nonCommentWords += w;
      nonCommentChars += c;
      if (text.trim()) nonCommentContent = true;
    }
  };

  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    const name = node.type.name;

    if (name === "latexComment") {
      addText((node.attrs.text as string) || "", true);
      return false;
    }
    if (name === "footnote") {
      addText((node.attrs.content as string) || "", false);
      return false;
    }
    if (name === "inlineMath" || name === "displayMath") {
      addText((node.attrs.latex as string) || "", false);
      return false;
    }
    if (name === "citation") {
      // skip — markers, not prose
      return false;
    }
    if (node.isText && node.text) {
      const start = Math.max(pos, from);
      const end = Math.min(pos + node.nodeSize, to);
      const slice = node.text.slice(start - pos, end - pos);
      if (slice) addText(slice, false);
      return false;
    }
    return true;
  });

  // Pragmatic rule: if the selection contains *only* comment text, count it
  // even when the include config excludes comments — the user clearly wanted
  // to know how big that comment is.
  const onlyComments = !nonCommentContent && (commentWords > 0 || commentChars > 0);
  const includeComments = config.include.comments || onlyComments;

  return {
    words: nonCommentWords + (includeComments ? commentWords : 0),
    characters: nonCommentChars + (includeComments ? commentChars : 0),
  };
}

export function useWordCount(editor: Editor | null, config: WordCountConfig) {
  const [texts, setTexts] = useState<Record<Category, string>>(() => EMPTY_TEXTS);
  // selSignal increments on every selectionUpdate so the selection memo
  // recomputes against the current editor state without us having to mirror
  // the (from, to) range into React state.
  const [selSignal, setSelSignal] = useState(0);

  const contentTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const selTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!editor) return;

    setTexts(walkDoc(editor.state.doc));
    setSelSignal((s) => s + 1);

    const onUpdate = () => {
      clearTimeout(contentTimer.current);
      contentTimer.current = setTimeout(() => {
        setTexts(walkDoc(editor.state.doc));
      }, 300);
    };
    const onSel = () => {
      clearTimeout(selTimer.current);
      selTimer.current = setTimeout(() => setSelSignal((s) => s + 1), 50);
    };

    editor.on("update", onUpdate);
    editor.on("selectionUpdate", onSel);

    return () => {
      editor.off("update", onUpdate);
      editor.off("selectionUpdate", onSel);
      clearTimeout(contentTimer.current);
      clearTimeout(selTimer.current);
    };
  }, [editor]);

  const counts = useMemo(() => computeCounts(texts, config), [texts, config]);

  const selection = useMemo(
    () => (editor ? getSelectionCounts(editor, config) : null),
    // selSignal is the dependency that ties this to editor selection events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, config, selSignal],
  );

  return { counts, selection };
}
