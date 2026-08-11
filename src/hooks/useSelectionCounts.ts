"use client";

/**
 * Selection word/char counts — the `selectionUpdate` half of the historical
 * useWordCount, extracted (perf plan Wave 1 / P2-S2) so the flag-gated
 * DocProducts pipeline can own the CONTENT counts while selection counts
 * keep their own cheap path: a 50 ms-debounced O(selection) scan, fired
 * from `selectionUpdate` only. (The keystroke-subscriber guardrail
 * deliberately scopes to 'update'/'transaction'; this subscriber does no
 * doc-scale work — the `from === to` bail is O(1), so a plain caret move
 * costs nothing and only a real selection pays for the cut below.)
 *
 * It returns the SAME `CategoryCounts` shape as the whole-document counts,
 * produced by the SAME canonical walker (task 122). It used to keep its own
 * flat-text walker, which (a) hand-copied the categorization rules — the
 * task-112 drift class, one surface over — and (b) produced a single
 * uncategorized number, so the include-config had nothing to filter and a
 * selection's "words" silently counted comments the panel headline excluded.
 *
 * The cut is `doc.slice(from, to, true)`: `includeParents` is load-bearing,
 * not decorative. Without it a selection inside ONE textblock resolves to the
 * shared depth and comes back as a fragment of BARE INLINE nodes — no
 * paragraph, no heading — and the block walker (which decides
 * headings-vs-mainText, and skips nothing at inline level) would silently
 * count zero for the commonest selection there is.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import {
  type CategoryCounts,
  computeCategoryCounts,
} from "@/lib/word-count-core";

export function getSelectionCounts(editor: Editor): CategoryCounts | null {
  const { from, to } = editor.state.selection;
  if (from === to) return null;

  const content = editor.state.doc.slice(from, to, true).content.toJSON() as
    | JSONContent[]
    | null;
  if (!content || content.length === 0) return null;

  return computeCategoryCounts({ type: "doc", content });
}

export function useSelectionCounts(editor: Editor | null): CategoryCounts | null {
  const [selection, setSelection] = useState<CategoryCounts | null>(null);
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
