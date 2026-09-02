import { useCallback, useRef, type RefObject } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import type { EditorHandle } from "../../Editor";
import {
  findNodeByUuid,
  renameHeadingByUuid,
  renameParTitleByUuid,
} from "@/lib/tiptap/structural-edit";
import { renameLabelWithRefs } from "@/lib/tiptap/label-rename";
import {
  DOC_START_BLOCK_INDEX,
  resolveBlockIndex,
  resolveBlockSpan,
  type BlockAddress,
  type BlockSpanAddress,
} from "@/lib/tiptap/block-address";
import { isInsideOwnRange, isNoOpLanding } from "@/panels/Outline/outline-drop";
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
}) {
  const {
    editorRef,
    setLatestDoc,
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
      // Defence in depth. `resolveBlockSpan` bounds-checks its index and caps
      // the extent at the doc's end, so neither condition can hold today.
      if (fromIndex < 0 || fromIndex + count > positions.length || toIndex < 0 || toIndex > positions.length) return;
      // Own-range rejection through the SHARED predicates the drop indicator
      // reads (task 285), so neither side can hand-write its own copy of the
      // rule. The write refuses one case MORE than the indicator does — a
      // landing on either boundary leaves the section where it is, which the
      // indicator deliberately still lights (the drop is honest: nothing moves,
      // and nothing was supposed to) but which must not dispatch an
      // effect-less transaction. The two also ask against different documents:
      // the panel against its snapshot, this against the live spans, and only
      // this one protects the document.
      if (isInsideOwnRange(fromIndex, count, toIndex)) return;
      if (isNoOpLanding(fromIndex, count, toIndex)) return;

      const sliceFrom = positions[fromIndex].from;
      const sliceTo = positions[fromIndex + count - 1].to;
      const slice = doc.slice(sliceFrom, sliceTo);
      const landingPos = toIndex >= positions.length
        ? positions[positions.length - 1].to
        : positions[toIndex].from;

      // Ask the transaction where a position went; never predict it (the law
      // the container fit and the identity net both earned). The delta of a
      // splice is not reliably the payload's declared size — the fitter may pad
      // or reshape — so the second half of each branch MAPS its position
      // through the first half instead of adding/subtracting `content.size`.
      let tr = editor.state.tr;
      if (toIndex < fromIndex) {
        tr = tr.insert(landingPos, slice.content);
        tr = tr.delete(tr.mapping.map(sliceFrom), tr.mapping.map(sliceTo));
      } else {
        tr = tr.delete(sliceFrom, sliceTo);
        tr = tr.insert(tr.mapping.map(landingPos), slice.content);
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

  // Heading-label commit — UUID-addressed, through the ONE label-rename door
  // (task 534). The door gates on the SAME `@/lib/labels` predicate the live
  // warning reads (a duplicate label can never be committed past the advisory
  // warning — OUT-F8-03 / OUT-F5-03), and it carries every `\ref` naming the
  // old key: pre-534 this path wrote the heading attr alone and orphaned them
  // without asking. The confirm is MAIN's own (`EditorHandle.onConfirmLabelRename`
  // → `EditorPane`'s dialog), so the Outline, the heading strip and the figure
  // lozenge ask one question in one voice.
  const handleUpdateLabel = useCallback(
    (uuid: string, newLabel: string | null) => {
      const handle = editorRef.current;
      const editor = handle?.getEditor();
      if (!handle || !editor) return;
      void renameLabelWithRefs(editor, {
        locate: () => {
          const hit = findNodeByUuid(editor, uuid);
          return hit && hit.node.type.name === "heading" ? hit : null;
        },
        newLabel,
        confirm: (oldLabel, next, refCount) =>
          handle.onConfirmLabelRename(oldLabel, next, refCount),
      });
    },
    [editorRef],
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
