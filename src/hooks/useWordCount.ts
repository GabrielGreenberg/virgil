"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import {
  type WordCounts,
  CATEGORY_LABELS,
  computeWordCounts,
  countWords,
} from "@/lib/word-count-core";
import {
  getSelectionCounts,
  type SelectionCounts,
} from "@/hooks/useSelectionCounts";

export type { WordCounts, SelectionCounts };
export { CATEGORY_LABELS, countWords };

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
