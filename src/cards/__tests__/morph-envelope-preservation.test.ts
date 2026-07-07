import { describe, it, expect } from "vitest";
import { CARD_REGISTRY } from "../card-registry";
import type { CardKind } from "../types";
// Importing the morphs barrel registers every converter onto CARD_REGISTRY (+
// runs the boot assertions) — so `applyCardMorph` below dispatches to a real
// transform for each morphable kind.
import { applyCardMorph } from "../morphs";

/**
 * Task 072 — the morph converters hand-build object literals that enumerate the
 * fields they carry, so a record-level field the target shape CAN hold but the
 * literal forgets is silently dropped. `archived?: boolean` is exactly that
 * field: every morphable card interface carries it, none of the 8 converters
 * touch it, and the hooks apply the morph by wholesale record replacement — so
 * an archived card would morph back with `archived` undefined (≡ active),
 * silently un-archiving. `applyCardMorph` now carries the shared record
 * "envelope" (the `archived` flag) across at the single morph chokepoint.
 *
 * These tests close the whole CLASS: for EVERY `morph !== null` kind (both
 * directions + round-trip), an archived card stays archived through the morph.
 * A future converter rewrite that forgets `archived` again can't regress past
 * this. Mirrors the `assertMorphCoverage` discipline (enumerate the registry,
 * not a hardcoded pair list).
 */

const morphableKinds = (Object.keys(CARD_REGISTRY) as CardKind[]).filter(
  (k) => CARD_REGISTRY[k].morph != null,
);

/** A minimal card record: enough shared fields that any converter runs without
 *  crashing (they only read optional fields; undefined ones are handled). The
 *  `archived` flag is what we assert survives. */
function minimalArchivedCard(archived: boolean | undefined): Record<string, unknown> {
  return { id: "card-1", createdAt: "2026-07-06T00:00:00Z", links: [], archived };
}

describe("morph envelope preservation — the `archived` flag rides every morph (task 072)", () => {
  it("covers all 8 registered morph converters (sanity: the enumeration isn't empty)", () => {
    // 4 pairs × 2 directions — if the registry loses a morph declaration this
    // count drops and the coverage below silently shrinks.
    expect(morphableKinds).toHaveLength(8);
  });

  for (const fromKind of morphableKinds) {
    const toKind = CARD_REGISTRY[fromKind].morph!.to;

    it(`${fromKind} → ${toKind}: an archived card stays archived`, () => {
      const out = applyCardMorph(fromKind, minimalArchivedCard(true)) as {
        archived?: boolean;
      };
      expect(out.archived).toBe(true);
    });

    it(`${fromKind} → ${toKind} → ${fromKind}: archived survives the round-trip`, () => {
      const once = applyCardMorph(fromKind, minimalArchivedCard(true));
      const back = applyCardMorph(toKind, once) as { archived?: boolean };
      expect(back.archived).toBe(true);
    });

    it(`${fromKind} → ${toKind}: a NON-archived card is not spuriously archived`, () => {
      // The carry-over is targeted (only a truthy `archived` rides) — it must not
      // fabricate the flag on an active card, and it must not be a blanket
      // `...card` spread that leaks the source-shape fields the converter drops.
      const out = applyCardMorph(fromKind, minimalArchivedCard(undefined)) as {
        archived?: boolean;
      };
      expect(out.archived).toBeFalsy();
    });
  }
});
