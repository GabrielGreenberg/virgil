"use client";

import {
  dormantKeysOf,
  insertionTouchesDormant,
  reviveLiveLinks,
  type DormantCardShape,
  type DormantKeys,
} from "@/links/dormant";
import { useAnchorsRevived } from "@/lib/tiptap/orphan-events";

/**
 * The insert-driven half of DORMANT-link revival (task 1193; the load half is
 * `useReconcileModeAAnchors`). A card hook mounts this beside its reconcile:
 * when its document re-inserts a block uuid or a `linkedAnchor` mark that one
 * of its dormant links is waiting on — a Restore, a doc Undo of an archive,
 * the agent's restore door landing while the doc is open — that link revives,
 * and a card archived WITH its text comes back with it.
 *
 * Keystroke sanctity: the announcement comes from the orphan guards' existing
 * observer-diff gate (added blocks / anchors only — plain typing adds
 * neither), and this handler is O(inserted) against an index built LAZILY, on
 * the first insert event after the cards changed (cached per card array), so
 * no render — not even typing in a card body — pays for it. A card set with
 * nothing dormant answers in O(1) and never calls `update()`, so a not-yet-loaded panel is never poisoned (the
 * `useReconcileModeAAnchors` loader invariant).
 */
export function useDormantRevival<S, C extends DormantCardShape>(
  docId: string | null,
  update: (updater: (prev: S) => S) => void,
  state: S,
  selectCards: (state: S) => readonly C[],
  mapCards: (state: S, next: C[]) => S,
): void {
  // No refs: `useAnchorsRevived` already re-points its listener at the latest
  // handler every render, so this closure always reads the current state.
  useAnchorsRevived(docId, (detail) => {
    if (!insertionTouchesDormant(keysOf(selectCards(state)), detail)) return;
    const uuids = new Set(detail.uuids);
    const anchorIds = new Set(detail.anchorIds);
    const live = {
      isUuidLive: (u: string) => uuids.has(u),
      isAnchorIdLive: (a: string) => anchorIds.has(a),
    };
    update((prev) => {
      const cur = selectCards(prev);
      let changed = false;
      const next = cur.map((c) => {
        const r = reviveLiveLinks(c, live);
        if (r !== c) changed = true;
        return r;
      });
      return changed ? mapCards(prev, next) : prev;
    });
  });
}

/** The dormant-key index per card ARRAY — the sidecar hooks hand out a new
 *  array exactly when a card changes, so identity is the right cache key. */
const KEYS_CACHE = new WeakMap<readonly DormantCardShape[], DormantKeys>();
function keysOf(cards: readonly DormantCardShape[]): DormantKeys {
  let keys = KEYS_CACHE.get(cards);
  if (!keys) {
    keys = dormantKeysOf(cards);
    KEYS_CACHE.set(cards, keys);
  }
  return keys;
}
