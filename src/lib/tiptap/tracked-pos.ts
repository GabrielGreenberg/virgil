/**
 * A captured document position that FOLLOWS the document (task 1190).
 *
 * A deferred-commit surface — the citation / `\ref` create-at-caret popover —
 * captures an insertion point when it opens and writes there on a later
 * gesture. While it is open, other edits can land in the same editor: an
 * agent's `.tex` write reloaded into the view, a code-pane re-parse, an
 * embedded card editor's write-back. A raw number captured at open then names
 * whatever text has shifted into its offset ("Addressing the live document
 * across an async gap"). A clamp keeps it in RANGE, not on the same text.
 *
 * `trackPos` maps the captured position through every applied transaction
 * (and its `appendedTransactions`) for as long as the surface is open, and
 * reports `null` once the spot itself has been deleted — both sides of it
 * removed, as a whole-document replacement does — so the commit REFUSES
 * rather than landing somewhere arbitrary. A deletion that merely ends or
 * starts at the spot leaves it standing at the deletion's edge.
 *
 * `assoc: -1`: content inserted exactly AT the spot goes after it, so the
 * insertion point stays glued to the text before it — the claim a `\cite`
 * follows.
 *
 * [cost: O(steps) per transaction, only while a tracker is live; `dispose()`
 * removes the subscription — the keystroke-subscriber census lists this file.]
 */

import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";

export interface TrackedPos {
  /** The position now, in the live document — `null` once it was deleted
   *  (or the owning editor was destroyed). */
  get(): number | null;
  /** Stop following. Idempotent. `get()` keeps answering its last value. */
  dispose(): void;
}

/** Map `pos` through `tr`'s steps; `null` when `tr` deleted the spot. */
export function mapTrackedPos(pos: number, tr: Transaction): number | null {
  const r = tr.mapping.mapResult(pos, -1);
  return r.deletedAcross ? null : r.pos;
}

/**
 * Follow `pos` in `editor`'s document. With no editor (a legacy request that
 * names no owner) there is nothing to observe: `get()` answers `pos` as given.
 */
export function trackPos(editor: Editor | null | undefined, pos: number): TrackedPos {
  let current: number | null = pos;
  if (!editor || editor.isDestroyed) {
    if (editor?.isDestroyed) current = null;
    return { get: () => current, dispose: () => {} };
  }
  const handler = ({
    transaction,
    appendedTransactions,
  }: {
    transaction: Transaction;
    appendedTransactions?: Transaction[];
  }) => {
    if (current === null) return;
    for (const tr of [transaction, ...(appendedTransactions ?? [])]) {
      if (!tr.docChanged) continue;
      current = mapTrackedPos(current, tr);
      if (current === null) return;
    }
  };
  editor.on("transaction", handler);
  let live = true;
  return {
    get: () => (editor.isDestroyed ? null : current),
    dispose() {
      if (!live) return;
      live = false;
      editor.off("transaction", handler);
    },
  };
}
