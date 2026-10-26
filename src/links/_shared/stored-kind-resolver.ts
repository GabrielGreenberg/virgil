/**
 * "Which kind is card `id` in panel P's collection?" — answered per doc store.
 *
 * Four panels keep ONE collection holding two card kinds
 * (`STORED_KIND_BY_PANEL`: notes = note + highlight, revisions/cutter =
 * comment + suggestion, reports = report + report-request). Their selection
 * slots are id-only setters (`setSelectedNoteId(id)` …), so a fresh select
 * had to GUESS the kind — and guessed the panel's first kind. A highlight was
 * stored as `{kind:"note"}`: the halo reconciler looked for a note, missed it,
 * and the existence prune cleared the selection (task 1296). The same guess
 * made a freshly-selected cutter/revision SUGGESTION a "comment".
 *
 * The owner that holds the collection — the `EditorPane` mounting that doc —
 * registers a resolver here; the slot setter asks it. A store can be shared by
 * several panes of the same paper (`getCardStore` is keyed by doc id), so each
 * panel holds a SET of resolvers and a departing pane removes only its own
 * (the per-doc-services law). Light leaf: no React, no editor.
 */

import type { CardStore } from "./anchored-card-store";
import type { CardKind } from "@/cards/types";
import type { PolymorphicPanel } from "@/cards/predicates";

/** Resolve a card id to its spine kind, or `null` if this collection lacks it. */
export type StoredKindResolver = (id: string) => CardKind | null;

const _resolvers = new WeakMap<CardStore, Map<PolymorphicPanel, Set<StoredKindResolver>>>();

/** Register `panel`'s kind resolver on a doc's store; returns the release. */
export function registerStoredKindResolver(
  store: CardStore,
  panel: PolymorphicPanel,
  resolve: StoredKindResolver,
): () => void {
  let byPanel = _resolvers.get(store);
  if (!byPanel) {
    byPanel = new Map<PolymorphicPanel, Set<StoredKindResolver>>();
    _resolvers.set(store, byPanel);
  }
  let set = byPanel.get(panel);
  if (!set) {
    set = new Set();
    byPanel.set(panel, set);
  }
  set.add(resolve);
  return () => {
    _resolvers.get(store)?.get(panel)?.delete(resolve);
  };
}

/** The kind card `id` has in `panel`'s collection, per any registered owner;
 *  `null` when no owner is registered or none holds the id. */
export function resolveStoredKind(
  store: CardStore,
  panel: PolymorphicPanel,
  id: string,
): CardKind | null {
  const set = _resolvers.get(store)?.get(panel);
  if (!set) return null;
  for (const resolve of set) {
    const kind = resolve(id);
    if (kind != null) return kind;
  }
  return null;
}
