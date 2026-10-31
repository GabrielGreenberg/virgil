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

export type { CategoryCounts };
export { CATEGORY_LABELS, countWords };

export function useWordCount(editor: Editor | null) {
  const [counts, setCounts] = useState<CategoryCounts>(EMPTY_CATEGORY_COUNTS);

  const contentTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Categorization lives in the shared word-count-core walker (SSOT with the
  // Outline panel's per-section counts). It takes JSONContent, so serialize
  // here — only ever inside the debounced recount, off the keystroke path.
  const recount = useCallback(() => {
    if (!editor) return;
    setCounts(computeCategoryCounts(editor.state.doc.toJSON() as JSONContent));
  }, [editor]);

  useEffect(() => {
    if (!editor) return;

    // initial count
    setCounts(computeCategoryCounts(editor.state.doc.toJSON() as JSONContent));

    const onUpdate = () => {
      clearTimeout(contentTimer.current);
      contentTimer.current = setTimeout(recount, 300);
    };

    editor.on("update", onUpdate);

    return () => {
      editor.off("update", onUpdate);
      clearTimeout(contentTimer.current);
    };
  }, [editor, recount]);

  // Content counts only. The SELECTION tally is not a pane fact: it is a lazy
  // per-editor store read by the Word Count panel alone (useSelectionCounts,
  // task 1395) — one producer for both DocProducts flag states.
  return useMemo(() => ({ counts }), [counts]);
}
