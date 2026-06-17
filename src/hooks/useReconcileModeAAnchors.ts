"use client";

import { useCallback } from "react";
import type { Editor } from "@tiptap/react";
import { collectLiveUuids, reconcileModeAAnchors } from "@/links/links";
import type { CardWithLinks } from "@/links/links";

/**
 * Shared factory for a panel hook's Mode-A anchor reconcile.
 *
 * On reload, a Mode-A margin card anchors via a bare paragraph UUID that
 * round-trips through the `.tex` only as a `%!v:` comment. If that write
 * lost the race to a reload, the paragraph is re-minted a fresh UUID and
 * the card silently orphans. `reconcileModeAAnchors` repairs this:
 *   - UUID-first: if the stored UUID still resolves, backfill the
 *     self-healing snapshot from the live paragraph (makes legacy
 *     snapshot-less links durable going forward).
 *   - Snapshot-fallback: if the stored UUID is dead but the snapshot
 *     matches a live paragraph, rewrite `textObjectIds[0]` to the live
 *     UUID and persist.
 *
 * This factory wraps the hook's `usePersistentState` `update` setter so
 * each hook exposes a uniform `reconcileAnchors(editor)` the load
 * reconcile effect calls once per doc-open. Idempotent (a second run
 * finds nothing to change → no write). LOAD-ONLY — never on a keystroke;
 * `collectLiveUuids` + the per-card walk are O(doc) and must stay off the
 * typing path.
 *
 * `selectCards` reads the card array off the hook's state; `mapCards`
 * writes a mapped array back into the same state shape (preserving any
 * sibling fields like `goal` / `tracker`).
 */
export function useReconcileModeAAnchors<S, C extends CardWithLinks>(
  update: (updater: (prev: S) => S) => void,
  selectCards: (state: S) => readonly C[],
  mapCards: (state: S, next: C[]) => S,
): (editor: Editor | null | undefined) => void {
  return useCallback(
    (editor) => {
      if (!editor) return;
      const liveUuids = collectLiveUuids(editor);
      if (liveUuids.size === 0) return; // editor not ready — don't touch
      update((prev) => {
        const cards = selectCards(prev);
        let anyChanged = false;
        const next = cards.map((c) => {
          const res = reconcileModeAAnchors(c, editor, liveUuids);
          if (res.changed) anyChanged = true;
          return res.card;
        });
        if (!anyChanged) return prev; // no-op → no persist, stable identity
        return mapCards(prev, next);
      });
    },
    [update, selectCards, mapCards],
  );
}
