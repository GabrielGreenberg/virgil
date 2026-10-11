/**
 * Collab selection-broadcast SSOT (task 239).
 *
 * The soft-presence effect in `EditorLayout` broadcasts which cards the local
 * user has selected so the partner's card chrome (`CollabCardTrailing`) can
 * paint presence dots. That reader gates itself on the `hasCollabClaims` facet
 * — it NEVER looks up a claim for a `collabClaims:false` kind. This module is
 * the WRITER's matching gate: the set of kinds that broadcast a claim is
 * *derived from the same facet*, not a hand-kept literal that can drift from it.
 *
 * Before this module the writer was ten unconditional `if (selectedXId)
 * cards.push(...)` lines — four of them (`citation`/`todo`/`bib`/`example`)
 * for `collabClaims:false` kinds whose claims no reader ever consumed (dead
 * writes), and it silently omitted no live kind ONLY because report-request
 * happens to share `report`'s selection slot and themeKey. Folding the
 * membership decision into `hasCollabClaims` deletes the dead writes and closes
 * the symmetric "forgot to broadcast a new claim-bearing kind" hole.
 */
import type { CardKind } from "./types";
import type { PanelThemeKey } from "@/lib/panel-theme";
import {
  STORED_KIND_BY_PANEL,
  collabClaimScope,
  hasCollabClaims,
  storedKindForCardKind,
} from "./predicates";
import { MODE_B_COLLECTIONS, type ModeBBag, type ModeBCollection } from "./mode-b-collections";

/** One presence claim on the collab wire. Byte-shape matches
 *  `useCollab.updateSelection` / `getCardSelections`. */
export interface CollabClaim {
  panelKind: PanelThemeKey;
  cardId: string;
}

/**
 * The card kinds the broadcast enumerates — one per selection slot EditorLayout
 * maintains (`useAnchoredSelectionSlots` + the local `bib` slot). This is the
 * irreducible slot→kind wiring (selection state is named per-slot, not
 * registry-derived); WHETHER each broadcasts is NOT decided here but by the
 * `hasCollabClaims` facet inside `collabClaimsFor`.
 *
 * `report-request` has no own slot: it shares `report`'s selection AND themeKey
 * (`collabClaimScope("report-request") === collabClaimScope("report")`), so the
 * `report` entry already covers it on the wire. The coverage test pins that
 * every claim-bearing kind's scope token is produced by some slot here.
 */
export const COLLAB_SELECTION_SLOT_KINDS = [
  "note",
  "footnote",
  "citation",
  "todo",
  "archive",
  "cutter-comment",
  "report",
  "revision-comment",
  "bib",
  "example",
] as const satisfies readonly CardKind[];

/** The exact key set `collabClaimsFor` requires — compile-tied to the slot list
 *  so EditorLayout's per-slot map cannot omit or add a slot without a type
 *  error (the two lists can never drift). */
export type CollabSlotKind = (typeof COLLAB_SELECTION_SLOT_KINDS)[number];

/**
 * A slot is named after ONE kind but holds the selected id of EVERY kind its
 * panel stores (task 1063): the `note` slot also carries highlight ids, the
 * `cutter-comment` / `revision-comment` slots their panel's suggestion ids, the
 * `report` slot report-request ids. Which kinds share a slot is DERIVED from
 * the stored-kind table (`STORED_KIND_BY_PANEL`, task 999) — the slot kind's
 * panel row — and which bag collections can hold such an id from the Mode-B
 * slot table (`MODE_B_COLLECTIONS`). A slot whose kind lives in no polymorphic
 * panel (footnote, archive, …) resolves to no collections: its kind is exact.
 */
const SHARED_SLOT_COLLECTIONS: ReadonlyMap<CollabSlotKind, readonly ModeBCollection[]> =
  (() => {
    const m = new Map<CollabSlotKind, readonly ModeBCollection[]>();
    for (const slot of COLLAB_SELECTION_SLOT_KINDS) {
      const address = storedKindForCardKind(slot);
      if (!address) continue;
      const row: Readonly<Record<string, CardKind>> = STORED_KIND_BY_PANEL[address.panel];
      const family = new Set<CardKind>(Object.values(row));
      m.set(
        slot,
        MODE_B_COLLECTIONS.filter((c) => c.kinds.some((k) => family.has(k))),
      );
    }
    return m;
  })();

/**
 * The ACTUAL card kind of the id selected in `slot` — looked up in the pane's
 * card bag for a shared slot, the slot's own kind otherwise. An id the bag does
 * not (yet) hold falls back to the slot kind, the pre-1063 behaviour.
 */
export function selectedCardKind(
  slot: CollabSlotKind,
  cardId: string,
  bag: ModeBBag,
): CardKind {
  for (const collection of SHARED_SLOT_COLLECTIONS.get(slot) ?? []) {
    const record = bag[collection.slot]?.find((r) => r.id === cardId);
    if (record) return collection.kindOf(record);
  }
  return slot;
}

/**
 * Build the collab claim broadcast from the current per-slot selections.
 * Emits a claim for a selected card IFF its ACTUAL kind participates in collab
 * claims (`hasCollabClaims`) — the same facet the reader gates on — so the
 * writer set can never drift from the reader gate. The gate reads the selected
 * CARD's kind (`selectedCardKind`), not the slot's: selecting a highlight, a
 * suggestion or a report-request through a shared slot is judged as what it
 * is (task 1063), and its claim carries that kind's scope. A null/absent
 * selection contributes nothing.
 */
export function collabClaimsFor(
  selectedByKind: Record<CollabSlotKind, string | null | undefined>,
  bag: ModeBBag,
): CollabClaim[] {
  const claims: CollabClaim[] = [];
  for (const slot of COLLAB_SELECTION_SLOT_KINDS) {
    const cardId = selectedByKind[slot];
    if (!cardId) continue;
    const kind = selectedCardKind(slot, cardId, bag);
    if (hasCollabClaims(kind)) {
      claims.push({ panelKind: collabClaimScope(kind), cardId });
    }
  }
  return claims;
}
