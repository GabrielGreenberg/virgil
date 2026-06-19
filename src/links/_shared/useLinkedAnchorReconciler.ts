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

/**
 * Pure orphan-reap sweep (no React). Walk the editor doc and strip every
 * `linkedAnchor` mark whose `anchorId` is NOT in `aliveAnchorIds` — i.e. has
 * no live owning card. Each strip routes through `removeLinkedAnchor`
 * (`unsetMark` over the resolved range), the same path the per-kind delete
 * sites use.
 *
 * Shared by the `useLinkedAnchorReconciler` hook (collection-keyed sweep) and
 * the EditorPane load-reconcile pass (run LAST, after re-apply, so a
 * just-re-applied healthy mark is in the alive-set and is not reaped). It is
 * load/gesture-time only — never wired to `editor.on('update'|'transaction')`.
 */
export function reapOrphanLinkedAnchors(
  editor: Editor,
  aliveAnchorIds: Set<string> | ReadonlyArray<string>,
): void {
  // Guard on `isDestroyed` only — NOT `isInitialized`. TipTap flips
  // `isInitialized` true inside a `setTimeout(0)` AFTER the `create` emit, so
  // it is still false on the synchronous first layout-effect pass right after
  // mount — exactly when the load-time orphan reap must run. The view + state
  // exist from the constructor, so the doc walk + `unsetMark` transaction are
  // safe before `create` has fired.
  if (editor.isDestroyed) return;
  const alive =
    aliveAnchorIds instanceof Set ? aliveAnchorIds : new Set(aliveAnchorIds);
  const orphans = new Set<string>();
  editor.state.doc.descendants((node) => {
    if (!node.isText) return true;
    for (const m of node.marks) {
      if (m.type.name !== "linkedAnchor") continue;
      const id = m.attrs.anchorId as string | undefined;
      if (id && !alive.has(id)) orphans.add(id);
    }
    return true;
  });
  for (const id of orphans) removeLinkedAnchor(editor, id);
}

export interface UseLinkedAnchorReconcilerArgs {
  editor: Editor | null;
  /**
   * Load-order DATA-LOSS gate. The sweep MUST NOT run until EVERY anchor-bearing
   * sidecar has finished loading — i.e. the alive-set is AUTHORITATIVE. On a
   * fresh doc-open the editor mounts with `linkedAnchor` marks already parsed
   * from the `.tex`, but the card collections populate asynchronously; a sweep
   * fired in that window sees an EMPTY/partial alive-set and would reap EVERY
   * live annotation as an "orphan" (mass data loss). The prior `setTimeout(0)` +
   * `clearTimeout` implementation masked this by DEBOUNCING — each alive-set
   * change cancelled the pending reap, so the empty-set sweep never committed.
   * The synchronous sweep has no such debounce, so the caller MUST pass
   * `allCardSidecarsLoaded && docContentReady` here (the SAME gate the EditorPane
   * load-reconcile pass uses). After load this stays true, so in-session card
   * deletes still reap synchronously (closing the autosave race the macrotask
   * version lost to). */
  ready: boolean;
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
  ready,
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
    // DATA-LOSS gate: never reap until every sidecar has loaded (see `ready`'s
    // JSDoc). Before that the alive-set is incomplete and a sweep would reap
    // live annotations as orphans on every doc-open.
    if (!ready) return;
    // SYNCHRONOUS sweep (was a `setTimeout(0)` macrotask that raced the
    // 1500ms autosave). A fresh `createLinkedAnchor` → `addCard` gesture
    // commits the new card into its collection in the SAME synchronous
    // handler (`addNote`/`addHighlight`/… → `setState`), so by the time this
    // layout effect re-runs the `aliveAnchorIds` memo already contains the
    // new anchorId — the sweep cannot reap a just-created mark. (The mark and
    // card never split across two React commits: both land in one event.)
    reapOrphanLinkedAnchors(editor, aliveAnchorIds);
  }, [editor, ready, aliveAnchorIds]);
}
