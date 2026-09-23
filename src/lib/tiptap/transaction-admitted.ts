/**
 * A pure probe of ProseMirror's transaction filters (task 735).
 *
 * `view.dispatch(tr)` returns nothing, and a transaction a `filterTransaction`
 * refuses is dropped silently. Most callers should dispatch and MEASURE
 * (`dispatchLanded`); this is for the few that must know BEFORE dispatching.
 */

import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";

/**
 * Would `editor`'s plugins ADMIT `tr` if it were dispatched now? A pure probe of
 * every `filterTransaction` — the same loop `EditorState` runs inside
 * `applyTransaction`, minus the apply. A filter is a predicate by contract, so
 * asking costs no side effect.
 *
 * It exists for the ONE compound whose card half cannot follow its document
 * half: a duplicate's sidecar clones MINT the ids the inserted slice carries
 * (`lifecycle.clone` returns the new id), so the clones have to exist before the
 * transaction can be built. That caller asks this first, on a dry build, so the
 * clones are minted only for a transaction the plugins will take (task 735).
 * `tryCreateLinkedAnchor` asks it too, to tell a FILTERED mark from one that
 * simply had nothing to apply to. Everywhere else, prefer the commit door
 * (`commitDocThenCards`): dispatch, measure, THEN the cards.
 */
export function transactionAdmitted(editor: Editor, tr: Transaction): boolean {
  const state = editor.state;
  for (const plugin of state.plugins) {
    const filter = plugin.spec.filterTransaction;
    if (filter && !filter.call(plugin, tr, state)) return false;
  }
  return true;
}
