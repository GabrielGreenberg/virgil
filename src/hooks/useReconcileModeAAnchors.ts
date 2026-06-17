"use client";

import { useCallback, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { captureParagraphSnapshot } from "@/links/links";
import type { CardWithLinks } from "@/links/links";
import {
  buildResolveIndex,
  resolveCardAnchor,
  reconcileCardToResolved,
  type ResolveIndex,
} from "@/links/resolve-card-anchor";

/**
 * Shared factory for a panel hook's Mode-A anchor reconcile.
 *
 * On reload, a Mode-A margin card anchors via a bare paragraph UUID that
 * round-trips through the `.tex` only as a `%!v:` comment. If that write
 * lost the race to a reload, the paragraph is re-minted a fresh UUID and
 * the card silently orphans. The resolver SSOT (`resolve-card-anchor.ts`)
 * repairs this on load — every card funnels through one
 * `resolveCardAnchor` ladder (uuid → mark → rung-2b → snapshot → orphan)
 * and one `reconcileCardToResolved` mutator:
 *   - uuid: backfill the self-healing snapshot from the live paragraph
 *     (makes legacy snapshot-less links durable) AND strip a residual
 *     dead-mark `linkedRange` link (HYBRID CLEANUP — heals a re-anchored
 *     Mode-B todo/revision/cutter/report so `getTextAnchor` returns null).
 *   - snapshot: the stored UUID is dead but the text matches a live
 *     paragraph → rewrite `textObjectIds[0]` (Mode-A) or convert a
 *     relocated Mode-B to a clean Mode-A link.
 *
 * This factory wraps the hook's `usePersistentState` `update` setter so
 * each hook exposes a uniform `reconcileAnchors(editor)` the load
 * reconcile effect calls once per doc-open. Idempotent (a second run
 * finds nothing to change → no write). LOAD-ONLY — never on a keystroke;
 * `buildResolveIndex` is O(doc) and runs ONCE per pass (one index for all
 * cards, a net reduction vs the legacy per-card walks), off the typing
 * path.
 *
 * `getState` reads the hook's live state synchronously (the `stateRef`
 * from `usePersistentState`); `selectCards` reads the card array off that
 * state; `mapCards` writes a mapped array back into the same state shape
 * (preserving any sibling fields like `goal` / `tracker`).
 *
 * Data-loss invariant (anchor-p1 BLOCKER): `update()` sets
 * `hasMutatedRef.current = true` BEFORE its updater runs, and the
 * still-pending sidecar loader bails `if (hasMutatedRef.current) return;`
 * — so calling `update()` before the panel's cards have loaded silently
 * DROPS that panel's entire on-disk set for the session. We therefore
 *   (a) early-bail when the cards aren't loaded yet (empty array), and
 *   (b) compute the reconcile result OUTSIDE `update()` and call `update()`
 *       ONLY when something actually changed.
 * A no-op pass must call `update()` ZERO times.
 */
export function useReconcileModeAAnchors<S, C extends CardWithLinks>(
  update: (updater: (prev: S) => S) => void,
  getState: () => S,
  selectCards: (state: S) => readonly C[],
  mapCards: (state: S, next: C[]) => S,
): (editor: Editor | null | undefined) => void {
  // Hold the selectors in refs so the returned callback identity is stable
  // (callers pass fresh inline arrows each render; the reconcile shape is
  // conceptually constant per hook). Keeps the once-per-doc load effect's
  // dependency list stable.
  const getStateRef = useRef(getState);
  getStateRef.current = getState;
  const selectRef = useRef(selectCards);
  selectRef.current = selectCards;
  const mapRef = useRef(mapCards);
  mapRef.current = mapCards;
  return useCallback(
    (editor) => {
      if (!editor) return;
      // Read live state synchronously (no `update()` yet — that would
      // poison `hasMutatedRef` and make the pending loader drop this
      // panel's on-disk cards). Bail before any mutation when the panel's
      // cards haven't loaded, so a not-yet-loaded panel is never touched.
      const prev = getStateRef.current();
      const cards = selectRef.current(prev);
      if (cards.length === 0) return; // not loaded (or genuinely empty) → never mutate

      // ONE index per pass (O(doc), card-count-independent). Built at the
      // TOP, before the per-card loop — never per card (open-verification
      // #2). `uuidToParagraph` empty ⇒ editor not ready ⇒ don't touch.
      const index = buildResolveIndex(editor);
      if (index.uuidToParagraph.size === 0) return; // editor not ready

      let anyChanged = false;
      const next = cards.map((c) =>
        reconcileOne(c, editor, index).card,
      );
      // Recompute `anyChanged` honestly: `reconcileOne` returns the same
      // object reference when nothing changed.
      anyChanged = next.some((nc, i) => nc !== cards[i]);
      if (!anyChanged) return; // no-op → ZERO update() calls, no loader poison

      // Something changed → persist. The `update()` updater re-reads the
      // current state for correctness, re-running the (idempotent) reconcile
      // on the live card array. The same `index` is reused — it's a pure
      // snapshot of the doc at pass time.
      update((cur) => {
        const curCards = selectRef.current(cur);
        let changed = false;
        const mapped = curCards.map((c) => {
          const res = reconcileOne(c, editor, index);
          if (res.changed) changed = true;
          return res.card;
        });
        if (!changed) return cur;
        return mapRef.current(cur, mapped);
      });
    },
    [update],
  );
}

/**
 * One card's resolve + reconcile against the shared index, threading the
 * two editor-aware augmentations:
 *   - `liveText` — captured (normalized) from the resolved live paragraph
 *     so `reconcileCardToResolved` can backfill a MISSING snapshot
 *     (AUGMENTATION 1); only fetched for a uuid resolution that has a
 *     paragraph (the only branch that backfills).
 *   - `isAnchorIdLive` — `index.anchorIdToParagraph.has`, so the mutator
 *     can detect a dead-mark `linkedRange` residue and clean it up
 *     (AUGMENTATION 2 — HYBRID CLEANUP).
 */
function reconcileOne<C extends CardWithLinks>(
  card: C,
  editor: Editor,
  index: ResolveIndex,
): { card: C; changed: boolean } {
  const res = resolveCardAnchor(card, editor, index);
  const liveText =
    res.source === "uuid" && res.paragraphId
      ? captureParagraphSnapshot(editor, res.paragraphId)
      : null;
  return reconcileCardToResolved(card, res, {
    liveText,
    isAnchorIdLive: (anchorId) => index.anchorIdToParagraph.has(anchorId),
  });
}
