import { useCallback, useRef, type RefObject } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import type { EditorView } from "prosemirror-view";
import type { EditorHandle } from "../../Editor";
import { findEditorScrollFor } from "../layout-scroll";
import {
  renameHeadingByUuid,
  renameParTitleByUuid,
  updateHeadingLabelByUuid,
} from "@/lib/tiptap/structural-edit";

/**
 * Editor-scope action handlers: update debouncing, scroll routing across
 * the main/mirror panes, and structural edits on top-level blocks
 * (reorder, rename heading, rename parTitle, update label).
 *
 * `handleScrollToHeading` routes to the mirror view when the split is
 * open and the bottom pane is focused; otherwise delegates to the main
 * editor's scrollToHeading.
 *
 * `handleUpdate` debounces `setLatestDoc(doc)` so outline / word-count
 * subscribers don't re-derive on every keystroke. The autosave is
 * driven by `useDocument` inside EditorPane (its `onUpdate` is wired
 * directly to TipTap there); this hook only feeds the shell's own
 * derived state.
 */
export function useEditorOps(deps: {
  editorRef: RefObject<EditorHandle | null>;
  mirrorViewRef: RefObject<EditorView | null>;
  editorSplit: boolean;
  activeSplitPane: "top" | "bottom";
  setLatestDoc: (doc: JSONContent | null) => void;
  /** Central duplicate-label predicate (the SAME one the live label warning
   *  reads). The label commit gates on it so the warning and the commit can
   *  never disagree (OUT-F8-03 / OUT-F5-03). */
  isLabelTaken: (candidate: string, excludeLabel: string | null) => boolean;
}) {
  const {
    editorRef,
    mirrorViewRef,
    editorSplit,
    activeSplitPane,
    setLatestDoc,
    isLabelTaken,
  } = deps;

  const latestDocTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleUpdate = useCallback(
    (editor: Editor) => {
      if (latestDocTimerRef.current) clearTimeout(latestDocTimerRef.current);
      // Defer `editor.getJSON()` to inside the 300 ms timeout — the
      // serialization cost is O(doc-size) and pre-fix ran on every
      // keystroke even though `setLatestDoc` was already debounced.
      latestDocTimerRef.current = setTimeout(() => {
        if (editor.isDestroyed) return;
        setLatestDoc(editor.getJSON());
      }, 300);
    },
    [setLatestDoc],
  );

  const handleScrollToHeading = useCallback(
    (blockIndex: number) => {
      const mirrorView = mirrorViewRef.current;
      if (editorSplit && activeSplitPane === "bottom" && mirrorView) {
        const editor = editorRef.current?.getEditor();
        if (!editor) return;
        if (blockIndex === -1) {
          editor.commands.setTextSelection(1);
          const scrollEl = findEditorScrollFor(mirrorView.dom);
          if (scrollEl) scrollEl.scrollTop = 0;
          return;
        }
        let pos = 0;
        let idx = 0;
        editor.state.doc.forEach((_node, offset) => {
          if (idx === blockIndex) pos = offset + 1;
          idx++;
        });
        if (pos > 0) {
          editor.commands.setTextSelection(pos);
          try {
            const domAtPos = mirrorView.domAtPos(pos);
            const el = domAtPos.node instanceof HTMLElement
              ? domAtPos.node
              : domAtPos.node.parentElement;
            el?.scrollIntoView({ behavior: "instant", block: "center" });
          } catch { /* noop */ }
        }
        return;
      }
      editorRef.current?.scrollToHeading(blockIndex);
    },
    [editorRef, mirrorViewRef, editorSplit, activeSplitPane],
  );

  const handleReorderBlocks = useCallback(
    (fromIndex: number, count: number, toIndex: number) => {
      const editor = editorRef.current?.getEditor();
      if (!editor) return;
      const doc = editor.state.doc;
      const positions: { from: number; to: number }[] = [];
      doc.forEach((node, offset) => {
        positions.push({ from: offset, to: offset + node.nodeSize });
      });
      if (fromIndex < 0 || fromIndex + count > positions.length || toIndex < 0 || toIndex > positions.length) return;
      if (toIndex >= fromIndex && toIndex <= fromIndex + count) return;

      const sliceFrom = positions[fromIndex].from;
      const sliceTo = positions[fromIndex + count - 1].to;
      const slice = doc.slice(sliceFrom, sliceTo);

      let tr = editor.state.tr;
      if (toIndex < fromIndex) {
        const insertPos = positions[toIndex].from;
        tr = tr.insert(insertPos, slice.content);
        const shift = slice.content.size;
        tr = tr.delete(sliceFrom + shift, sliceTo + shift);
      } else {
        tr = tr.delete(sliceFrom, sliceTo);
        const shift = sliceTo - sliceFrom;
        const insertPos = toIndex >= positions.length
          ? positions[positions.length - 1].to - shift
          : positions[toIndex].from - shift;
        tr = tr.insert(insertPos, slice.content);
      }
      editor.view.dispatch(tr);
    },
    [editorRef],
  );

  // Heading rename — UUID-addressed, atom-preserving (T3 / OUT-F5-01). The old
  // `delete(from,to).insertText(plainText)` flattened away every inline atom
  // (math / cite / ref) and mark in the heading; `renameHeadingByUuid` splices
  // the new label back around them instead.
  const handleRenameHeading = useCallback(
    (uuid: string, newText: string) => {
      const editor = editorRef.current?.getEditor();
      if (!editor) return;
      renameHeadingByUuid(editor, uuid, newText);
    },
    [editorRef],
  );

  // Heading-label commit — UUID-addressed, gated on the SAME `isLabelTaken`
  // predicate the live warning reads, so a duplicate label can never be
  // committed past the advisory warning (OUT-F8-03 / OUT-F5-03).
  const handleUpdateLabel = useCallback(
    (uuid: string, newLabel: string | null) => {
      const editor = editorRef.current?.getEditor();
      if (!editor) return;
      updateHeadingLabelByUuid(editor, uuid, newLabel, isLabelTaken);
    },
    [editorRef, isLabelTaken],
  );

  // parTitle rename — UUID-addressed with a node-type guard (refuses a heading),
  // so a drifted address can no longer stamp `parTitle` onto the wrong node or
  // throw (OUT-F5-02 / OUT-F8-04).
  const handleRenameParTitle = useCallback(
    (uuid: string, newTitle: string) => {
      const editor = editorRef.current?.getEditor();
      if (!editor) return;
      renameParTitleByUuid(editor, uuid, newTitle);
    },
    [editorRef],
  );

  return {
    handleUpdate,
    handleScrollToHeading,
    handleReorderBlocks,
    handleRenameHeading,
    handleUpdateLabel,
    handleRenameParTitle,
  };
}
