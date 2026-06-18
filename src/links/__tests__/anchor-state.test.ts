// W0c — the SSOT anchor-state derivation (PLAN.md D2; T2-anchor-orphan.md §3a).
//
// `resolveAnchorState` is a pure string function: given a card's resolved live
// position and its declared intent, return one of the three OmniItem
// anchor-states. These pins are the truth table the design (§7) requires —
// the full `pos × unanchored → 3 states` matrix — plus the two builder-shaped
// scenarios it calls out: a panel-created (unanchored) card resolves to
// `"free"`, a lost-marker card to `"orphaned"`, and a placed card to
// `"anchored"` regardless of a stale intent flag.
import { describe, it, expect } from "vitest";
import { resolveAnchorState, type AnchorState } from "../anchor-state";

describe("resolveAnchorState — the canonical anchor-state derivation (D2)", () => {
  describe("truth table: pos × intent.unanchored", () => {
    // A live position wins unconditionally — a card with a marker is anchored,
    // even if it carries a stale `unanchored: true`.
    it.each<[string, number | null | undefined, { unanchored?: boolean } | null | undefined, AnchorState]>([
      // pos non-null ⇒ anchored, intent ignored
      ["pos set, no intent", 12, undefined, "anchored"],
      ["pos set, intent null", 12, null, "anchored"],
      ["pos set, unanchored false", 12, { unanchored: false }, "anchored"],
      ["pos set, unanchored true (stale flag loses to live marker)", 12, { unanchored: true }, "anchored"],
      ["pos zero (a real position, not falsy-null)", 0, undefined, "anchored"],

      // pos null/undefined + free intent ⇒ free
      ["no pos (null), unanchored true", null, { unanchored: true }, "free"],
      ["no pos (undefined), unanchored true", undefined, { unanchored: true }, "free"],

      // pos null/undefined + no free intent ⇒ orphaned
      ["no pos (null), no intent", null, undefined, "orphaned"],
      ["no pos (null), intent null", null, null, "orphaned"],
      ["no pos (undefined), no intent", undefined, undefined, "orphaned"],
      ["no pos (null), unanchored false", null, { unanchored: false }, "orphaned"],
      ["no pos (null), empty intent object", null, {}, "orphaned"],
    ])("%s → %s", (_label, pos, intent, expected) => {
      expect(resolveAnchorState(pos, intent)).toBe(expected);
    });
  });

  describe("pos === 0 is a valid anchored position (no falsy bug)", () => {
    it("treats doc position 0 as anchored, not orphaned", () => {
      // `pos != null` (not `pos` truthiness) — guards against a 0-position
      // marker being mis-binned as orphaned.
      expect(resolveAnchorState(0, undefined)).toBe("anchored");
      expect(resolveAnchorState(0, { unanchored: true })).toBe("anchored");
    });
  });

  describe("builder-shaped scenarios (C19 — free vs orphaned no longer conflated)", () => {
    it("a panel-created citation (unanchored, never placed) is free, not orphaned", () => {
      // CI-A1-02 / OMNI-A2-01: the old `pos == null ? "orphaned" : "anchored"`
      // dropped a deliberately-free citation into the red orphan bin.
      const panelCreatedCitation = { unanchored: true };
      expect(resolveAnchorState(null, panelCreatedCitation)).toBe("free");
    });

    it("a citation whose in-text marker was deleted is orphaned", () => {
      // A genuine lost marker — no live pos, no free intent.
      const lostMarkerCitation = { unanchored: false };
      expect(resolveAnchorState(null, lostMarkerCitation)).toBe("orphaned");
    });

    it("an example (no free-intent concept, intent = null) is anchored when present, orphaned when gone", () => {
      // EX-F3-01 / EX-A1-01: examples are always-in-text — passing `null`
      // intent yields anchored (block present) or orphaned (block gone),
      // never free.
      expect(resolveAnchorState(40, null)).toBe("anchored");
      expect(resolveAnchorState(null, null)).toBe("orphaned");
    });
  });

  describe("return type is exhaustively one of the three states", () => {
    it("only ever returns anchored | free | orphaned", () => {
      const samples: AnchorState[] = [
        resolveAnchorState(1, undefined),
        resolveAnchorState(null, { unanchored: true }),
        resolveAnchorState(null, undefined),
      ];
      for (const s of samples) {
        expect(["anchored", "free", "orphaned"]).toContain(s);
      }
    });
  });
});
