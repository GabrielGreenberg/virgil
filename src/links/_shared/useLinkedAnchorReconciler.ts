"use client";

/**
 * Single owner of the invariant: every `linkedAnchor` mark in the editor
 * doc must back a card alive in one of the Mode-B-bearing collections. Which
 * collections those are is NOT restated here — it is read from the one SSOT
 * (`MODE_B_COLLECTIONS` / `forEachModeBCard`, `@/cards/mode-b-collections`), so
 * this reaper, the in-text hover bridge, the load-time re-apply and the shell's
 * hovered-anchor resolver cannot disagree the way they did before task 666. On
 * every change to those collections, walk the doc and strip orphan marks.
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
import { getTextAnchor, removeLinkedAnchor } from "../links";
import { forEachModeBCard, type ModeBBag } from "@/cards/mode-b-collections";
import {
  pendingMarkAnchorIds,
  type PendingMarkCardLike,
} from "./reapply-pending-marks";

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
      // Pending-AI-change marks are lifecycle-managed by the applicator (stamped
      // on apply, unset on Keep/Revert) — NOT by card-anchor presence. The
      // card-derived alive-set LAGS a fresh auto-apply: the blue mark is stamped
      // one React commit before the card flips to `applied` / gets its
      // `appliedChange.anchorId`, so a sweep in that window reaped the just-
      // stamped mark (the fresh-apply blue vanished while a reload re-stamp
      // stuck — that asymmetry was the bug). Skip by kind so protection is
      // timing-independent; Revert removes the mark explicitly, so none leak.
      //
      // This exemption is ONE kind, not a family. It used to also name
      // `pending-ai-request`, the open-request wash — a mark with no card
      // text-anchor, hence an orphan by every honest test this sweep applies.
      // Task 667 made that wash a DECORATION, so there is no mark to reap and
      // no second name to exempt: the general anchor lifecycle stopped carrying
      // a special case for a signal that was never document content.
      if (m.attrs.kind === "pending-ai-change") continue;
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
  /** Every Mode-B-bearing collection, as the total `ModeBBag`. Totality is the
   *  data-loss guard: a collection left OUT of the alive-set is a collection
   *  whose marks the next sweep reaps as orphans (the phantom-tint break that
   *  the old per-hook list nearly caused for todos, and that the hover bridge's
   *  narrower copy of the same list did cause for hover). Pass a MEMOIZED bag —
   *  the alive-set memoizes on its identity. */
  cards: ModeBBag;
}

export function useLinkedAnchorReconciler({
  editor,
  ready,
  cards,
}: UseLinkedAnchorReconcilerArgs): void {
  // Memoize on the BAG identity. EditorPane rebuilds collection wrappers on
  // every render, so the bag it passes is itself memoized on the six
  // collection-array identities — each hook only produces a new array when its
  // data actually changed. The alive-set is built from card stores (O(cards)),
  // never a per-keystroke doc walk.
  const aliveAnchorIds = useMemo(() => {
    const ids = new Set<string>();
    forEachModeBCard(cards, (record) => {
      const ta = getTextAnchor(record);
      if (ta) ids.add(ta.anchorId);
    });
    // Pending-AI-change marks live at `appliedChange.anchorId` (NOT a card text
    // anchor), so they must be added explicitly or the in-session sweep would
    // strip an applied suggestion's blue mark as an orphan after load. The
    // applied cards live in `comments` (revisions) + `cutterCards`. Flag-OFF →
    // empty set (no applied cards), so this is a no-op when the feature is off.
    for (const id of pendingMarkAnchorIds([
      ...(cards.comments as ReadonlyArray<PendingMarkCardLike>),
      ...(cards.cutterCards as ReadonlyArray<PendingMarkCardLike>),
    ])) {
      ids.add(id);
    }
    return ids;
  }, [cards]);

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
