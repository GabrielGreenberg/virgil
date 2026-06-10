import { describe, it, expect } from "vitest";
import { CARD_REGISTRY } from "../card-registry";
import { CARD_KINDS, isInlineAtomCardKind, isAnchoredCardKind } from "../predicates";
import type { CardKind } from "../types";

/**
 * A3 Commit G (WS3) criterion pin-test. The `CardMeta.lifecycle` booleans drive
 * the anchor-text duplicate/delete CASCADE — the Mode-B `linkedAnchor`
 * text-range walker (`duplicate-slice` / `delete-range`) + the inline-atom
 * kinds whose markers ride the slice — NOT the card's own UI delete.
 *
 * The criterion (pinned here so a future chip can't silently "fill" a permanent
 * gap, nor un-wire a cascade kind):
 *
 *   • A kind is cascade-capable (`clone || delete`) IFF it is walker-reachable:
 *     it carries an inline atom (footnote / citation) OR sets `bindAnchor: true`
 *     (a Mode-B text-range anchor the slice can re-bind).
 *   • Every all-false kind is correctly OUT of the cascade — it is either a
 *     Mode-A paragraph-anchored kind / `archive` (R18: ratified NO cascade) or
 *     an origin:derived mirror (`example`, R19), or a non-anchored system kind.
 *     None of them is walker-reachable.
 */

const walkerReachable = (k: CardKind): boolean =>
  isInlineAtomCardKind(k) || CARD_REGISTRY[k].lifecycle.bindAnchor;

const cascadeCapable = (k: CardKind): boolean =>
  CARD_REGISTRY[k].lifecycle.clone || CARD_REGISTRY[k].lifecycle.delete;

describe("lifecycle cascade criterion (A3/WS3)", () => {
  it("every cascade-capable kind is walker-reachable (inline-atom OR bindAnchor)", () => {
    for (const k of CARD_KINDS) {
      if (cascadeCapable(k)) {
        expect(walkerReachable(k), `${k}: clone/delete but not walker-reachable`).toBe(true);
      }
    }
  });

  it("every all-false kind is OUT of the cascade (not walker-reachable)", () => {
    for (const k of CARD_KINDS) {
      if (!cascadeCapable(k)) {
        expect(walkerReachable(k), `${k}: all-false but walker-reachable`).toBe(false);
        // An all-false ANCHORED kind must be Mode-A (no bindAnchor, no inline
        // atom — its anchor is the paragraph) or origin:derived. System kinds
        // (bib/ai/error) are non-anchored and exempt.
        if (isAnchoredCardKind(k)) {
          const origin = CARD_REGISTRY[k].origin;
          const modeA = !CARD_REGISTRY[k].lifecycle.bindAnchor && !isInlineAtomCardKind(k);
          expect(modeA || origin === "derived", `${k}: not Mode-A nor derived`).toBe(true);
        }
      }
    }
  });

  it("pins the 4 permanent gaps + R18 archive as all-false (a future 'fill' trips this)", () => {
    // These MUST stay all-false (the cascade-vs-UI-delete criterion). archive is
    // R18 (ratified NO cascade); todo/report/report-request are Mode-A; example
    // is R19 (origin:derived mirror of its exampleBlock TextObject).
    for (const k of ["archive", "todo", "report", "report-request", "example"] as const) {
      expect(CARD_REGISTRY[k].lifecycle).toEqual({
        clone: false,
        delete: false,
        bindAnchor: false,
      });
    }
  });

  it("pins the cascade-capable set (inline-atoms + Mode-B kinds)", () => {
    const capable = CARD_KINDS.filter(cascadeCapable).sort();
    expect(capable).toEqual(
      [
        "citation",
        "cutter-comment",
        "cutter-suggestion",
        "footnote",
        "highlight",
        "note",
        "revision-comment",
        "revision-suggestion",
      ].sort(),
    );
  });
});
