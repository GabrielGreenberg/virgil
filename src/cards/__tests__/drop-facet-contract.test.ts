/**
 * Drop-facet contract — pins the declared `droppable` / `dropPlacement` facets
 * (`CARD_REGISTRY`, drop-button SYNTHESIS §2) to the REAL drop mechanism
 * (`dropSpec.allowedPlacements`), so the static policy that gates the drop button
 * can never silently drift from what a drag session actually does.
 *
 * The facets are STATIC literals (not derived from `dropSpec != null`) because
 * `dropSpec` is folded onto the registry by the boot-time side-effect import
 * `@/cards/drop-specs`, which `predicates.ts` can't import without a cycle and
 * which may not have run when a card header first paints. This test imports that
 * side-effect explicitly (the bare import below) so `dropSpec` is populated, then
 * asserts the placement-keyed invariant against the live specs.
 *
 * The invariant is PLACEMENT-KEYED, NOT `droppable ⇔ dropSpec != null`:
 * `example` carries a `dropSpec` (`blockMoveSpec`, `["between-blocks"]`) yet is
 * `droppable:false`, because a `between-blocks` content-MOVE is not a card
 * re-anchor — the drop button is for (re)anchoring (SYNTHESIS §7 design call).
 * So in-text ⇔ the spec allows `inline-cursor`; margin ⇔ the spec allows
 * `paragraph-side`; null/no-button ⇔ the spec allows NEITHER (block-only, or no
 * spec). Mirrors the `isInlineAtomCardKind` invariant style in predicates.ts and
 * the `collab-claim-scope-contract` / `ai-request-routing-contract` pin tests.
 */
import { describe, it, expect } from "vitest";
import { CARD_REGISTRY } from "@/cards/card-registry";
import {
  CARD_KINDS,
  isDroppable,
  cardDropPlacement,
} from "@/cards/predicates";
import type { CardKind } from "@/cards/types";
// Side-effect: fold every card kind's DropSpec onto CARD_REGISTRY[kind].dropSpec.
// Without this, the spec-keyed assertions below would see `null` specs.
import "@/cards/drop-specs";

/**
 * The EXPECTED per-kind facets — the frozen policy. The drop button mounts iff
 * `droppable`; `dropPlacement` drives the in-text-vs-margin dispatch. Kept here
 * as an independent literal so a registry edit that flips a kind trips a test
 * (the registry is one source; this table is the second, deliberately).
 */
const EXPECTED: Record<CardKind, "in-text" | "margin" | null> = {
  footnote: "in-text",
  citation: "in-text",
  note: "margin",
  highlight: "margin",
  todo: "margin",
  archive: "margin",
  report: "margin",
  "report-request": "margin",
  "revision-comment": "margin",
  "revision-suggestion": "margin",
  "cutter-comment": "margin",
  "cutter-suggestion": "margin",
  example: null, // block-MOVE spec, not a re-anchor — no button (SYNTHESIS §7)
  bib: null,
  ai: null,
  error: null,
};

describe("drop-facet contract (drop-button SYNTHESIS §2)", () => {
  it("the registry covers exactly the 16 known kinds", () => {
    expect(CARD_KINDS.slice().sort()).toEqual(
      (Object.keys(EXPECTED) as CardKind[]).sort(),
    );
  });

  it("dropPlacement matches the frozen policy table for every kind", () => {
    for (const k of CARD_KINDS) {
      expect(cardDropPlacement(k)).toBe(EXPECTED[k]);
    }
  });

  it("predicates ≡ the registry facets (no second source)", () => {
    for (const k of CARD_KINDS) {
      expect(cardDropPlacement(k)).toBe(CARD_REGISTRY[k].dropPlacement);
      expect(isDroppable(k)).toBe(CARD_REGISTRY[k].droppable);
    }
  });

  it("droppable ⇔ dropPlacement !== null for every kind", () => {
    for (const k of CARD_KINDS) {
      expect(isDroppable(k)).toBe(cardDropPlacement(k) !== null);
    }
  });

  describe("facet ⇔ the real dropSpec.allowedPlacements mechanism", () => {
    // After the `@/cards/drop-specs` side-effect import, every re-anchor kind's
    // spec is folded on. This is the load-bearing pin: the declared facet must
    // agree with what a drag session can actually do.
    const allows = (k: CardKind, p: "inline-cursor" | "paragraph-side" | "between-blocks") =>
      CARD_REGISTRY[k].dropSpec?.allowedPlacements.includes(p) ?? false;

    it("in-text kinds have a spec that allows inline-cursor", () => {
      for (const k of CARD_KINDS) {
        if (cardDropPlacement(k) !== "in-text") continue;
        expect(allows(k, "inline-cursor")).toBe(true);
      }
    });

    it("margin kinds have a spec that allows paragraph-side", () => {
      for (const k of CARD_KINDS) {
        if (cardDropPlacement(k) !== "margin") continue;
        expect(allows(k, "paragraph-side")).toBe(true);
      }
    });

    it("placement is DERIVED-CONSISTENT with the spec for every kind", () => {
      // The exact inverse the dev assertion (assertDropFacetCoverage) pins:
      // in-text ⇔ allows inline-cursor; margin ⇔ allows paragraph-side; null ⇔
      // allows neither (block-only example, or no spec for bib/ai/error).
      for (const k of CARD_KINDS) {
        const derived = allows(k, "inline-cursor")
          ? "in-text"
          : allows(k, "paragraph-side")
            ? "margin"
            : null;
        expect(cardDropPlacement(k)).toBe(derived);
      }
    });

    it("example carries a spec but is NOT droppable (between-blocks ≠ re-anchor)", () => {
      // The crux: this is why droppable is NOT `dropSpec != null`. example has a
      // registered spec, yet takes no drop button.
      expect(CARD_REGISTRY.example.dropSpec).not.toBeNull();
      expect(allows("example", "between-blocks")).toBe(true);
      expect(allows("example", "inline-cursor")).toBe(false);
      expect(allows("example", "paragraph-side")).toBe(false);
      expect(isDroppable("example")).toBe(false);
      expect(cardDropPlacement("example")).toBeNull();
    });

    it("non-droppable kinds (bib/ai/error) have no spec at all", () => {
      for (const k of ["bib", "ai", "error"] as const) {
        expect(CARD_REGISTRY[k].dropSpec).toBeNull();
        expect(isDroppable(k)).toBe(false);
      }
    });
  });
});
