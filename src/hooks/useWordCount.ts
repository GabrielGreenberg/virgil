"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import {
  type CategoryCounts,
  CATEGORY_LABELS,
  EMPTY_CATEGORY_COUNTS,
  computeCategoryCounts,
  countWords,
} from "@/lib/word-count-core";
import { getSelectionCounts } from "@/hooks/useSelectionCounts";

export type { CategoryCounts };
export { CATEGORY_LABELS, countWords };

export function useWordCount(editor: Editor | null) {
  const [counts, setCounts] = useState<CategoryCounts>(EMPTY_CATEGORY_COUNTS);
  const [selection, setSelection] = useState<CategoryCounts | null>(null);

  const contentTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const selTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Categorization lives in the shared word-count-core walker (SSOT with the
  // Outline panel's per-section counts). It takes JSONContent, so serialize
  // here — only ever inside the debounced recount, off the keystroke path.
  const recount = useCallback(() => {
    if (!editor) return;
    setCounts(computeCategoryCounts(editor.state.doc.toJSON() as JSONContent));
  }, [editor]);

  const resel = useCallback(() => {
    if (!editor) return;
    setSelection(getSelectionCounts(editor));
  }, [editor]);

  useEffect(() => {
    if (!editor) return;

    // initial count
    setCounts(computeCategoryCounts(editor.state.doc.toJSON() as JSONContent));
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
