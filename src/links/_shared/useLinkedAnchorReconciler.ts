"use client";

/**
 * Single owner of the invariant: every `linkedAnchor` mark in the editor
 * doc must back a card alive in one of the anchor-bearing collections
 * (notes, highlights, cutterCards, comments, reportCards, todos). On every
 * change to those collections, walk the doc and strip orphan marks.
 *
 * Dual of `useAnchorHighlightReconciler` — same idempotent-sweep pattern,
 * but the side effect is editor transactions instead of DOM attribute
 * writes. Centralizing the cleanup means per-kind delete paths no longer
 * have to remember to call `removeLinkedAnchor`; future card kinds that
 * adopt `linkedAnchor` inherit the cleanup automatically.
 *
 * Does NOT handle the reverse direction (mark missing for a live card).
 * That stays with the once-per-doc `applyLinkedAnchors` effect — folding
 * both directions into one reconciler is a separate refactor.
 */

import { useLayoutEffect, useMemo } from "react";
import type { Editor } from "@tiptap/react";
import { getTextAnchor, removeLinkedAnchor, type CardWithLinks } from "../links";

export interface UseLinkedAnchorReconcilerArgs {
  editor: Editor | null;
  notes:       ReadonlyArray<CardWithLinks>;
  highlights:  ReadonlyArray<CardWithLinks>;
  cutterCards: ReadonlyArray<CardWithLinks>;
  comments:    ReadonlyArray<CardWithLinks>;
  reportCards: ReadonlyArray<CardWithLinks>;
  /** Todos carry a Mode-B text-range anchor when created from a selection
   *  (symmetric with note/cutter/revision). They MUST be in the alive-set:
   *  without them the next collection sweep reaps a todo's `linkedAnchor`
   *  as an orphan → phantom-tint break. See the todo Mode-B chip. */
  todos:       ReadonlyArray<CardWithLinks>;
}

export function useLinkedAnchorReconciler({
  editor,
  notes,
  highlights,
  cutterCards,
  comments,
  reportCards,
  todos,
}: UseLinkedAnchorReconcilerArgs): void {
  // Memoize on the collection array identities. EditorPane rebuilds
  // collection wrappers on every render — depending on a wrapper object
  // literal would re-fire the effect every render. Each hook only produces
  // a new array when its data actually changed. The alive-set is built from
  // card stores (O(cards)), never a per-keystroke doc walk.
  const aliveAnchorIds = useMemo(() => {
    const ids = new Set<string>();
    const add = (cards: ReadonlyArray<CardWithLinks>) => {
      for (const c of cards) {
        const ta = getTextAnchor(c);
        if (ta) ids.add(ta.anchorId);
      }
    };
    add(notes);
    add(highlights);
    add(cutterCards);
    add(comments);
    add(reportCards);
    add(todos);
    return ids;
  }, [notes, highlights, cutterCards, comments, reportCards, todos]);

  useLayoutEffect(() => {
    if (!editor) return;
    // Defer one macrotask so a fresh `createLinkedAnchor` → `addCard`
    // sequence has time to commit the new card into the alive set. The
    // cleanup cancels an in-flight strip if a newer collection update
    // arrives mid-window, so we never act on a stale alive set.
    const timer = window.setTimeout(() => {
      if (editor.isDestroyed || !editor.isInitialized) return;
      const orphans = new Set<string>();
      editor.state.doc.descendants((node) => {
        if (!node.isText) return true;
        for (const m of node.marks) {
          if (m.type.name !== "linkedAnchor") continue;
          const id = m.attrs.anchorId as string | undefined;
          if (id && !aliveAnchorIds.has(id)) orphans.add(id);
        }
        return true;
      });
      for (const id of orphans) removeLinkedAnchor(editor, id);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [editor, aliveAnchorIds]);
}
