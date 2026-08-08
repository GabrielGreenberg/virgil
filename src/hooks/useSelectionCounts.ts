"use client";

/**
 * Selection word/char counts — the `selectionUpdate` half of the historical
 * useWordCount, extracted (perf plan Wave 1 / P2-S2) so the flag-gated
 * DocProducts pipeline can own the CONTENT counts while selection counts
 * keep their own cheap path: a 50 ms-debounced O(selection) scan, fired
 * from `selectionUpdate` only. (The keystroke-subscriber guardrail
 * deliberately scopes to 'update'/'transaction'; this subscriber does no
 * doc-scale work — `nodesBetween` bounds it to the selection.)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { countWords, extractCaptionText } from "@/lib/word-count-core";
import { LATEX_VERBATIM_MARK } from "@/lib/latex-lexer";

export interface SelectionCounts {
  words: number;
  characters: number;
}

export function getSelectionCounts(editor: Editor): SelectionCounts | null {
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

export function useSelectionCounts(editor: Editor | null): SelectionCounts | null {
  const [selection, setSelection] = useState<SelectionCounts | null>(null);
  const selTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const resel = useCallback(() => {
    if (!editor) return;
    setSelection(getSelectionCounts(editor));
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    setSelection(getSelectionCounts(editor));
    const onSel = () => {
      clearTimeout(selTimer.current);
      selTimer.current = setTimeout(resel, 50);
    };
    editor.on("selectionUpdate", onSel);
    return () => {
      editor.off("selectionUpdate", onSel);
      clearTimeout(selTimer.current);
    };
  }, [editor, resel]);

  return selection;
}
