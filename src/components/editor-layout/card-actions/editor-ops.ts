import { useCallback, useRef, type RefObject } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import type { EditorHandle } from "../../Editor";
import {
  renameHeadingByUuid,
  renameParTitleByUuid,
  updateHeadingLabelByUuid,
} from "@/lib/tiptap/structural-edit";
import {
  DOC_START_BLOCK_INDEX,
  resolveBlockIndex,
  resolveBlockSpan,
  type BlockAddress,
  type BlockSpanAddress,
} from "@/lib/tiptap/block-address";
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

  // Outline click-to-scroll — IDENTITY-addressed (task 285). `null` is the
  // Document-start row. A hydrated address whose block a concurrent writer
  // deleted resolves to null and the click no-ops, rather than scrolling to
  // whatever slid into that index.
  const handleScrollToHeading = useCallback(
    (target: BlockAddress | null) => {
      const handle = editorRef.current;
      if (!handle) return;
      if (!target) {
        handle.scrollToHeading(DOC_START_BLOCK_INDEX);
        return;
      }
      const editor = handle.getEditor();
      if (!editor) return;
      const index = resolveBlockIndex(editor.state.doc, target);
      if (index == null) return;
      handle.scrollToHeading(index);
    },
    [editorRef],
  );

  // Outline drag-reorder — IDENTITY-addressed on BOTH ends (task 285). The
  // dragged section and the drop target are named by durable block uuid, and
  // each one's EXTENT is re-derived from the live doc here, so neither the
  // start index nor the block count can have drifted since the outline
  // snapshot the drag was painted from. `side` is the hover half, resolved to a
  // landing index only now that the target's live span is known — the pre-285
  // `landingBlockIndex` folded the target's STALE `blockCount` into the number
  // it handed over, so a write inside the target section mis-landed the drop
  // even when the source addressed correctly.
  const handleReorderBlocks = useCallback(
    (source: BlockSpanAddress, target: BlockSpanAddress, side: "above" | "below") => {
      const editor = editorRef.current?.getEditor();
      if (!editor) return;
      const doc = editor.state.doc;
      const src = resolveBlockSpan(doc, source);
      const tgt = resolveBlockSpan(doc, target);
      // Either end deleted under the drag → refuse. Moving a section to where a
      // now-absent block used to be is a guess, not a gesture.
      if (!src || !tgt) return;
      const fromIndex = src.index;
      const count = src.count;
      const toIndex = side === "above" ? tgt.index : tgt.index + tgt.count;

      const positions: { from: number; to: number }[] = [];
      doc.forEach((node, offset) => {
        positions.push({ from: offset, to: offset + node.nodeSize });
      });
      if (fromIndex < 0 || fromIndex + count > positions.length || toIndex < 0 || toIndex > positions.length) return;
      // Own-range rejection, re-checked against the LIVE spans: a landing at (or
      // inside) the dragged section's own range is a no-op or a move-into-self.
      // The panel runs the same check on its snapshot to keep the drop indicator
      // honest; this one is what actually protects the document.
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
