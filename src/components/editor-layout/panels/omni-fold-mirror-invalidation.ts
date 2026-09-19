import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { getBus, diffHasStructuralEntries } from "@/lib/tiptap/doc-structure";
import { sectionFoldingPluginKey } from "@/lib/section-folding";

/**
 * Subscribe to exactly the transactions that can change which top-level child
 * indices are folded — the invalidation set for the omni fold mirror's
 * `hiddenTopLevel` derivation (`getHiddenTopLevelIndices`, which returns the
 * section-folding plugin's cached `hiddenIdx`: a set of ABSOLUTE top-level
 * child indices keyed on the `doc.forEach(...i)` position).
 *
 * The plugin rebuilds `hiddenIdx` on a fold-state change and on ANY structural
 * diff — `diffHasStructuralEntries(diff)` (section-folding.ts). This helper
 * MIRRORS that trigger set so a `hiddenTopLevel` consumer never reads a stale
 * index set.
 *
 * A MIRROR ASKS THE PREDICATE; IT DOES NOT RE-STATE IT (task 657)
 * ------------------------------------------------------------------
 * Until task 657 the mirror named five per-kind bus events by hand
 * (`onHeadingsAdded` / `onHeadingsRemoved` / `onBlocksAdded` /
 * `onBlocksRemoved` / `onBlockOrderChanged`) and asserted, right here, that
 * this list WAS the plugin's trigger set. It was not: `onHeadingsChanged` was
 * missing, so a uuid-conserving heading LEVEL flip (the heading annotation
 * chip's type menu — `setNodeMarkup`, which keeps the uuid, so the diff carries
 * `changedHeadings` and nothing else) rebuilt the plugin's `hiddenIdx` — the
 * fold stack keys on `node.attrs.level` — while the mirror stayed silent. Cards
 * anchored in a stretch that had just become folded kept rendering in the
 * gutter beside prose that was no longer on screen, and the mirror image
 * (promote a heading out of a fold, its cards stay dropped) until the next fold
 * toggle. That is the SECOND member of this class: task 126 closed the block
 * insert/delete/reorder member the same way — by extending the hand-written
 * list.
 *
 * So the list is gone. The mirror now takes the bus's generic structural
 * channel and asks the plugin's OWN predicate, `diffHasStructuralEntries`, the
 * same function the plugin's `apply` calls. A bucket added to that predicate
 * cannot be forgotten here a third time, because there is no longer anywhere to
 * forget it.
 *
 * Two boundary facts this rests on, stated rather than assumed:
 *
 *  1. `onAnyChange` fires on the bus's own (deliberately narrower) wake
 *     predicate, `diffWakesStructuralWatchers`, which omits exactly
 *     `changedBlocks` / `changedFootnotes` / `changedExamples` — the three
 *     sets whose co-set order/structure flag (`blockOrderChanged` /
 *     `footnoteOrderChanged` / `exampleStructureChanged`) wakes the channel in
 *     their stead. That relationship is pinned by
 *     `doc-structure/__tests__/diff-predicate-congruence.test.ts`, so gating a
 *     generic subscription on `diffHasStructuralEntries` is equivalent to
 *     asking the plugin's predicate directly.
 *  2. The plugin has one further rebuild trigger this mirror deliberately does
 *     NOT take: `!txPreservesTopLevelNodeDecorations(tr, …)`. That one is about
 *     whether a cached DECORATION set may be `.map()`ed forward, not about
 *     whether `hiddenIdx` changed — and any transaction that genuinely moves a
 *     top-level node in or out of a fold also lands in the diff (a block or
 *     heading added/removed/changed). Taking it would mean walking every
 *     transaction's steps inside this handler for a rebuild the mirror does not
 *     need. Declared here rather than left as an omission readable only by
 *     diffing two lists.
 *
 * Keystroke-safe by construction: the transaction handler is a single
 * `getMeta` check, and `onAnyChange` never fires for a content-only diff (the
 * two content-only sets are excluded from BOTH predicates) — so plain typing,
 * a heading's text included (heading text edits route to
 * `contentChangedUuids`, not `changedHeadings`), leaves `emitCount` flat and
 * this gate silent.
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
  // (b) Every structural transaction — asked of the plugin's own predicate
  //     rather than re-listed as per-kind events (see the header).
  const unsubStructural = bus?.onAnyChange((diff) => {
    if (diffHasStructuralEntries(diff)) onInvalidate();
  });
  return () => {
    editor.off("transaction", onTr);
    unsubStructural?.();
  };
}
