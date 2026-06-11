/**
 * R28/D-2 pin tests — registry-derived collab claim scopes.
 *
 * The collab sidecar's claim/presence `panelKind` tokens are WIRE data
 * (written to `virgil/collab.json`, matched byte-for-byte by the partner's
 * reader). `collabClaimScope(kind)` derives them from `CARD_REGISTRY`
 * (`≡ themeKey`), replacing the 7 docked + 7 float hand-kept literals. These
 * tables FREEZE the emitted tokens so a registry edit (or a future themeKey
 * rename) that would silently break existing on-disk claims trips a test
 * instead of shipping.
 */
import { describe, it, expect } from "vitest";
import { CARD_REGISTRY } from "@/cards/card-registry";
import { CARD_KINDS, collabClaimScope, hasCollabClaims } from "@/cards/predicates";
import type { CardKind } from "@/cards/types";
import type { PanelThemeKey } from "@/lib/panel-theme";

/** The 7 claim-bearing kinds and their FROZEN wire tokens. These strings are
 *  what shipped collab sidecars already contain — byte-identical forever
 *  (or until an explicit on-disk migration). */
const FROZEN_WIRE_TABLE: Record<string, PanelThemeKey> = {
  note: "note",
  footnote: "footnote",
  archive: "archive",
  "cutter-comment": "cut",
  report: "report",
  "report-request": "report",
  "revision-comment": "revision",
};

describe("collab claim scope contract (R28/D-2)", () => {
  it("collabClaimScope over the claim-bearing kinds matches the frozen wire table", () => {
    for (const [kind, wireToken] of Object.entries(FROZEN_WIRE_TABLE)) {
      expect(collabClaimScope(kind as CardKind)).toBe(wireToken);
    }
  });

  it("the collabClaims facet is true for EXACTLY the 7 claim-bearing kinds", () => {
    const claimKinds = CARD_KINDS.filter((k) => hasCollabClaims(k));
    expect(claimKinds.sort()).toEqual(Object.keys(FROZEN_WIRE_TABLE).sort());
    // And the facet ≡ the predicate (no second source).
    for (const k of CARD_KINDS) {
      expect(hasCollabClaims(k)).toBe(CARD_REGISTRY[k].collabClaims);
    }
  });

  it("morph-continuity: a claim survives a morph between claim-bearing siblings", () => {
    // For every claim-bearing kind whose morph target is ALSO claim-bearing
    // (today: report ↔ report-request), the two scopes must be equal — the
    // scope re-derives per render from the current kind, so unequal scopes
    // would orphan the partner's live claim mid-morph.
    let checked = 0;
    for (const k of CARD_KINDS) {
      if (!hasCollabClaims(k)) continue;
      const morph = CARD_REGISTRY[k].morph;
      if (!morph || !hasCollabClaims(morph.to)) continue;
      expect(collabClaimScope(k)).toBe(collabClaimScope(morph.to));
      checked++;
    }
    // The report pair morphs both ways — pin that the loop really ran.
    expect(checked).toBeGreaterThanOrEqual(2);
  });
});
