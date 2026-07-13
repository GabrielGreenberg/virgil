import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { getBus } from "@/lib/tiptap/doc-structure";
import { sectionFoldingPluginKey } from "@/lib/section-folding";

/**
 * Subscribe to exactly the transactions that can change which top-level child
 * indices are folded — the invalidation set for the omni fold mirror's
 * `hiddenTopLevel` derivation (`getHiddenTopLevelIndices`, which returns the
 * section-folding plugin's cached `hiddenIdx`: a set of ABSOLUTE top-level
 * child indices keyed on the `doc.forEach(...i)` position).
 *
 * The plugin rebuilds `hiddenIdx` on ANY structural block diff — a plain
 * (non-heading) paragraph inserted, deleted, or reordered ELSEWHERE in the doc
 * shifts every subsequent top-level index — as well as on fold-state changes
 * and heading add/remove (`diffHasStructuralEntries`, section-folding.ts). This
 * helper MIRRORS that exact trigger set so a `hiddenTopLevel` consumer never
 * reads a stale index set.
 *
 * Task 126: before this, the omni gate bumped only on fold-meta + heading
 * add/remove — a strict SUBSET of the plugin's rebuild triggers. So a block
 * insert/delete/reorder while a section was folded shifted the plugin's
 * `hiddenIdx` but left the omni memo stale, mis-binning cards (ghost card beside
 * a collapsed section, or a wrongly-dropped visible card) until the next fold
 * toggle. A stale absolute-index set MUST re-read on exactly the transaction set
 * that shifts absolute top-level indices; mirror the plugin, don't
 * under-approximate it with "headings only."
 *
 * Keystroke-safe: every source is either the fold-meta transaction or a
 * DocStructureBus STRUCTURAL event (blocks/headings added/removed/reordered) —
 * none fire on a plain in-block keystroke, so `emitCount` stays flat while
 * typing. It deliberately does NOT subscribe to `onBlockContentChanged`:
 * in-block text edits don't shift top-level indices, and that event is not
 * keystroke-flat for uuid-bearing blocks (it would reintroduce per-keystroke
 * work).
 *
 * @returns an unsubscribe that detaches every listener.
 */
export function subscribeFoldMirrorInvalidation(
  editor: Editor,
  onInvalidate: () => void,
): () => void {
  const bus = getBus(editor);
  // (a) Fold-toggle / collapseAll / expandAll: dispatched as a transaction
  //     carrying `sectionFoldingPluginKey` meta. No bus event covers this — the
  //     plugin's apply runs synchronously inside the same tx.
  const onTr = (props: { transaction: Transaction }) => {
    if (props.transaction.getMeta(sectionFoldingPluginKey) !== undefined) {
      onInvalidate();
    }
  };
  editor.on("transaction", onTr);
  // (b) Heading add/remove AND (c) block add/remove/reorder: all shift the
  //     absolute top-level child index map that `getHiddenTopLevelIndices`
  //     reads. These are precisely the section-folding plugin's own
  //     `hiddenIdx`-rebuild triggers (`diffHasStructuralEntries`).
  const unsubs = [
    bus?.onHeadingsAdded(onInvalidate),
    bus?.onHeadingsRemoved(onInvalidate),
    bus?.onBlocksAdded(onInvalidate),
    bus?.onBlocksRemoved(onInvalidate),
    bus?.onBlockOrderChanged(onInvalidate),
  ];
  return () => {
    editor.off("transaction", onTr);
    for (const u of unsubs) u?.();
  };
}
