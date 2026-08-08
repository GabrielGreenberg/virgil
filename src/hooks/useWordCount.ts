"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import {
  type WordCounts,
  CATEGORY_LABELS,
  computeWordCounts,
  countWords,
  extractCaptionText,
} from "@/lib/word-count-core";
import { LATEX_VERBATIM_MARK } from "@/lib/latex-lexer";

export type { WordCounts };
export { CATEGORY_LABELS, countWords };

export interface SelectionCounts {
  words: number;
  characters: number;
}

function getSelectionCounts(editor: Editor): SelectionCounts | null {
  const { from, to } = editor.state.selection;
  if (from === to) return null;

  const parts: string[] = [];
  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isText && node.text) {
      // Raw LaTeX (e.g. \cite{foo}, unhandled commands) — skip, but pull
      // any \caption{...} text out so figure/table captions still count.
      // `latexVerbatim` (a \verb run / verbatim-family env) is raw LaTeX for
      // the same reason `latexCommand` is — excluded on the same terms.
      if (
        node.marks.some(
          (m) =>
            m.type.name === "latexCommand" ||
            m.type.name === LATEX_VERBATIM_MARK,
        )
      ) {
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
        const text = node.textContent;
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
    categories: {}, characterCategories: {},
  });
  const [selection, setSelection] = useState<SelectionCounts | null>(null);

  const contentTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const selTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Categorization lives in the shared word-count-core walker (SSOT with the
  // Outline panel's per-section counts). It takes JSONContent, so serialize
  // here — only ever inside the debounced recount, off the keystroke path.
  const recount = useCallback(() => {
    if (!editor) return;
    setCounts(computeWordCounts(editor.state.doc.toJSON() as JSONContent));
  }, [editor]);

  const resel = useCallback(() => {
    if (!editor) return;
    setSelection(getSelectionCounts(editor));
  }, [editor]);

  useEffect(() => {
    if (!editor) return;

    // initial count
    setCounts(computeWordCounts(editor.state.doc.toJSON() as JSONContent));
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

  return useMemo(() => ({ counts, selection }), [counts, selection]);
}
