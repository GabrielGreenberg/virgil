"use client";

import { useCallback, useMemo, useRef } from "react";
import {
  dormantKeysOf,
  insertionTouchesDormant,
  markDormant,
  reviveLiveLinks,
  releaseFromSnippet,
  reviveRemapped,
  settleDormancy,
  type AnchorLiveness,
  type CarriedKeys,
  type DormantCardShape,
  type DormantKeys,
  type IsPassageRestorable,
  type ReturningRemap,
} from "@/links/dormant";
import { useAnchorsArchived, useAnchorsRevived } from "@/lib/tiptap/orphan-events";

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
/** The per-kind CARRY op (task 1194): the archive capture took the text
 *  `keys` names into snippet `snippetId` — mark those links dormant (and the
 *  card archived-with-its-text when every anchor is). The kind's
 *  `CardLifecycle.carry`. */
export type CarryCard = (id: string, snippetId: string, keys: CarriedKeys) => void;

/** Restore's collision door (task 1194 → 1269): the snippet's returning
 *  blocks / carried marks were given fresh ids (`remap`, old → new per
 *  identity space) — move this kind's dormant links onto them and revive
 *  them. See `reviveRemapped`. */
export type ReturnRemapped = (snippetId: string, remap: ReturningRemap) => void;

/** The passage `snippetId` was deleted for good (task 1195): drop this
 *  kind's links dormant there and clear `archivedWith`. Never deletes a card.
 *  See `releaseFromSnippet`. */
export type ReleaseSnippet = (snippetId: string) => void;

/** Settle every card of this kind against the dormancy invariant (task
 *  1329): links dormant in a snippet that can no longer bring them back revive
 *  on live text or are released. See `settleDormancy`. Calls `update()` ONLY
 *  when some card changes, so a not-yet-loaded store is never poisoned. */
export type SettleDormancy = (restorable: IsPassageRestorable, live: AnchorLiveness) => void;

/** The writes a card hook exposes for the dormant state. */
export interface DormantDoors {
  carry: CarryCard;
  returnRemapped: ReturnRemapped;
  release: ReleaseSnippet;
  settle: SettleDormancy;
}

export function useDormantRevival<S, C extends DormantCardShape>(
  docId: string | null,
  update: (updater: (prev: S) => S) => void,
  state: S,
  selectCards: (state: S) => readonly C[],
  mapCards: (state: S, next: C[]) => S,
): DormantDoors {
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

  // The WRITE half (task 1194) — the archive capture's door into this kind's
  // state. Same `update` / select / map the reviver uses, so making a link
  // dormant and reviving it are one vocabulary over one store. Identity-stable
  // (the lifecycle table is a memo; the selectors are inline lambdas).
  const io = useRef({ update, selectCards, mapCards, state });
  io.current = { update, selectCards, mapCards, state };
  const mapEach = useCallback((step: (c: C) => C) => {
    const { update: write, selectCards: select, mapCards: map } = io.current;
    write((prev) => {
      let changed = false;
      const next = select(prev).map((c) => {
        const r = step(c);
        if (r !== c) changed = true;
        return r;
      });
      return changed ? map(prev, next) : prev;
    });
  }, []);
  // The DEPARTURE half read off the document (task 1269): ids an un-retired
  // snippet holds left the doc with no gesture to carry their cards — a Redo
  // of an Archive. Same op as the gesture's `carry`, over every card; it lands
  // before the orphan event for the same ids, whose strip then skips the now
  // dormant links. Identity no-op for a card none of whose links it names.
  useAnchorsArchived(docId, ({ snippetId, uuids, anchorIds }) => {
    const keys: CarriedKeys = { pids: new Set(uuids), anchorIds: new Set(anchorIds) };
    mapEach((c) => markDormant(c, snippetId, keys));
  });
  const carry = useCallback<CarryCard>(
    (id, snippetId, keys) =>
      mapEach((c) => (c.id === id ? markDormant(c, snippetId, keys) : c)),
    [mapEach],
  );
  const returnRemapped = useCallback<ReturnRemapped>(
    (snippetId, remap) => mapEach((c) => reviveRemapped(c, snippetId, remap)),
    [mapEach],
  );
  const release = useCallback<ReleaseSnippet>(
    (snippetId) => mapEach((c) => releaseFromSnippet(c, snippetId)),
    [mapEach],
  );
  const settle = useCallback<SettleDormancy>(
    (restorable, live) => {
      // Loader invariant (`useReconcileModeAAnchors`): decide off the latest
      // rendered cards and write only when something is stranded — a store
      // with nothing dormant (or not loaded yet) sees no `update()` at all.
      const { selectCards: select, state: cur } = io.current;
      const stranded = select(cur).some((c) => settleDormancy(c, restorable, live) !== c);
      if (stranded) mapEach((c) => settleDormancy(c, restorable, live));
    },
    [mapEach],
  );
  return useMemo(
    () => ({ carry, returnRemapped, release, settle }),
    [carry, returnRemapped, release, settle],
  );
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
