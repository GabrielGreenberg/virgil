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
import { collabClaimScope, hasCollabClaims } from "./predicates";

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
 * Build the collab claim broadcast from the current per-slot selections.
 * Emits a claim for a selected card IFF its kind participates in collab claims
 * (`hasCollabClaims`) — the same facet the reader gates on — so the writer set
 * can never drift from the reader gate. A null/absent selection contributes
 * nothing.
 */
export function collabClaimsFor(
  selectedByKind: Record<CollabSlotKind, string | null | undefined>,
): CollabClaim[] {
  const claims: CollabClaim[] = [];
  for (const kind of COLLAB_SELECTION_SLOT_KINDS) {
    const cardId = selectedByKind[kind];
    if (cardId && hasCollabClaims(kind)) {
      claims.push({ panelKind: collabClaimScope(kind), cardId });
    }
  }
  return claims;
}
