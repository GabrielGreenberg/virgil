"use client";

/**
 * Selection word/char counts — a per-editor LAZY store, read only by the Word
 * Count panel (task 1395).
 *
 * History: this was the `selectionUpdate` half of the old useWordCount,
 * extracted in perf Wave 1 and then owned by `EditorPane` — so every 50 ms
 * selection pause sliced + walked the selection and set PANE state with a fresh
 * object, re-rendering the pane and every word-count host, whether or not any
 * surface showed the number. And it recounted ONLY on `selectionUpdate`, which
 * TipTap emits only when the selection's POSITIONS move: an edit INSIDE a held
 * selection that leaves its endpoints put (a footnote body edited in its panel,
 * a math atom re-committed through its popover, a citation's display text
 * refreshing in place) left the Selection stat stale beside a fresh headline.
 *
 * The store fixes both legs at their owner:
 *  - It ATTACHES its editor listeners only while ≥1 subscriber exists (the
 *    panel's `useSyncExternalStore`), so a closed panel costs nothing.
 *  - Recount triggers are `selectionUpdate` AND a document change while the
 *    selection is non-empty. The document channel is TipTap's `update` (one
 *    timer reset per docChanged transaction), and it is subscribed ONLY while
 *    the last count saw a real selection — typing over a selection collapses
 *    it, so ordinary typing holds no document subscription at all. (Not the
 *    DocStructureBus: its content channel is keyed by block uuid, and a
 *    paragraph that was never anchored carries none, so an atom edited inside
 *    it reaches no bus subscriber — the very case this store exists for.)
 *  - A recount that equals the previous tally (`categoryCountsEqual`) keeps the
 *    previous object and notifies no one.
 *
 * Registry, not a slot: keyed by editor in a WeakMap (per-doc keep-alive law —
 * N panes are mounted at once).
 *
 * The count itself returns the SAME `CategoryCounts` shape as the whole-document
 * counts, produced by the SAME canonical walker (task 122). It used to keep its
 * own flat-text walker, which (a) hand-copied the categorization rules — the
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

import { useCallback, useSyncExternalStore } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import {
  type CategoryCounts,
  categoryCountsEqual,
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

/** Quiet window for a recount — a drag-select or a burst of in-selection edits
 *  costs ONE count. */
export const SELECTION_RECOUNT_MS = 50;

export interface SelectionCountsStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): CategoryCounts | null;
}

function countsSame(a: CategoryCounts | null, b: CategoryCounts | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return categoryCountsEqual(a, b);
}

function createSelectionCountsStore(editor: Editor): SelectionCountsStore {
  const listeners = new Set<() => void>();
  let snapshot: CategoryCounts | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Is the document channel attached? Only while the last count saw a real
   *  selection. */
  let docAttached = false;

  const syncDocChannel = (selectionHeld: boolean) => {
    if (selectionHeld === docAttached) return;
    docAttached = selectionHeld;
    if (selectionHeld) editor.on("update", schedule);
    else editor.off("update", schedule);
  };

  const recount = () => {
    timer = undefined;
    if (editor.isDestroyed) return;
    const next = getSelectionCounts(editor);
    syncDocChannel(!editor.state.selection.empty);
    if (countsSame(snapshot, next)) return;
    snapshot = next;
    for (const l of listeners) l();
  };

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(recount, SELECTION_RECOUNT_MS);
  }

  const attach = () => {
    // Fresh read on (re)attach — nothing tracked the selection while detached.
    // `useSyncExternalStore` re-reads the snapshot after subscribing, so no
    // notify is needed here.
    snapshot = editor.isDestroyed ? null : getSelectionCounts(editor);
    if (!editor.isDestroyed) syncDocChannel(!editor.state.selection.empty);
    editor.on("selectionUpdate", schedule);
  };

  const detach = () => {
    editor.off("selectionUpdate", schedule);
    syncDocChannel(false);
    clearTimeout(timer);
    timer = undefined;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) attach();
      return () => {
        if (!listeners.delete(listener)) return;
        if (listeners.size === 0) detach();
      };
    },
    getSnapshot: () => snapshot,
  };
}

const STORES = new WeakMap<Editor, SelectionCountsStore>();

/** The ONE selection-counts producer for `editor` (both DocProducts flag
 *  states — there is no legacy twin). */
export function getSelectionCountsStore(editor: Editor): SelectionCountsStore {
  let store = STORES.get(editor);
  if (!store) {
    store = createSelectionCountsStore(editor);
    STORES.set(editor, store);
  }
  return store;
}

const noopSubscribe = () => () => {};
const nullSnapshot = () => null;

/** Read the selection tally. Mount it ONLY where the number is shown — mounting
 *  is what attaches the producer. */
export function useSelectionCounts(editor: Editor | null): CategoryCounts | null {
  const store = editor ? getSelectionCountsStore(editor) : null;
  const subscribe = useCallback(
    (l: () => void) => (store ? store.subscribe(l) : noopSubscribe()),
    [store],
  );
  const getSnapshot = store ? store.getSnapshot : nullSnapshot;
  return useSyncExternalStore(subscribe, getSnapshot, nullSnapshot);
}
