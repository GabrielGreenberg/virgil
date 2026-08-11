import { useCallback, useRef, type RefObject } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import type { EditorHandle } from "../../Editor";
import {
  renameHeadingByUuid,
  renameParTitleByUuid,
  updateHeadingLabelByUuid,
} from "@/lib/tiptap/structural-edit";
import { docProductsEnabled } from "@/lib/doc-products/use-doc-products";

/**
 * Editor-scope action handlers: update debouncing, heading-scroll routing,
 * and structural edits on top-level blocks (reorder, rename heading, rename
 * parTitle, update label).
 *
 * `handleScrollToHeading` delegates to the main editor's `scrollToHeading`.
 * It used to fork to a MIRROR ProseMirror view when the editor split was open
 * and the bottom pane held focus; the split was retired in task 115 (its
 * render site had been dropped in a refactor, so that branch had been
 * unreachable — `mirrorViewRef.current` was null for every caller).
 *
 * `handleUpdate` debounces `setLatestDoc(doc)` so outline / word-count
 * subscribers don't re-derive on every keystroke. The autosave is
 * driven by `useDocument` inside EditorPane (its `onUpdate` is wired
 * directly to TipTap there); this hook only feeds the shell's own
 * derived state.
 */
export function useEditorOps(deps: {
  editorRef: RefObject<EditorHandle | null>;
  setLatestDoc: (doc: JSONContent | null) => void;
  /** Central duplicate-label predicate (the SAME one the live label warning
   *  reads). The label commit gates on it so the warning and the commit can
   *  never disagree (OUT-F8-03 / OUT-F5-03). */
  isLabelTaken: (candidate: string, excludeLabel: string | null) => boolean;
}) {
  const {
    editorRef,
    setLatestDoc,
    isLabelTaken,
  } = deps;

  const latestDocTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleUpdate = useCallback(
    (editor: Editor) => {
      // Flag-on (perf Wave 1): the DocProducts pipeline owns the shared doc
      // snapshot; EditorLayout reads it via useDocJson and this legacy
      // getJSON feed stays dead. (This was the one un-guardrailed O(doc)
      // subscriber — it rides the TipTap onUpdate OPTION, not editor.on.)
      if (docProductsEnabled) return;
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
      editorRef.current?.scrollToHeading(blockIndex);
    },
    [editorRef],
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
