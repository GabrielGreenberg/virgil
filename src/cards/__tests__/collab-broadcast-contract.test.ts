/**
 * Task 239 — the collab selection-broadcast WRITER set is facet-derived.
 *
 * The reader (`CollabCardTrailing`) computes its claim scope as
 * `hasCollabClaims(kind) ? collabClaimScope(kind) : undefined` and never looks
 * up a claim for a `collabClaims:false` kind. Before this fix the writer
 * (`EditorLayout`'s soft-presence effect) was a hand-kept literal that pushed a
 * claim for ten kinds — four of them (`citation`/`todo`/`bib`/`example`) for
 * `collabClaims:false` kinds (dead writes), and it depended on report-request
 * sharing report's slot+themeKey to not silently omit a live kind.
 *
 * These pins freeze the invariant `writer-set ≡ { kinds where hasCollabClaims }`
 * in the scope-token space the wire actually uses (report/report-request
 * collapse to one token), so a future kind added to — or removed from — the
 * broadcast can't drift from the `hasCollabClaims` facet. They FAIL on `main`
 * (the four dead pushes make the writer a strict superset of the facet).
 */
import { describe, it, expect } from "vitest";
import { CARD_KINDS, collabClaimScope, hasCollabClaims } from "@/cards/predicates";
import {
  COLLAB_SELECTION_SLOT_KINDS,
  collabClaimsFor,
  selectedCardKind,
  type CollabSlotKind,
} from "@/cards/collab-broadcast";
import type { ModeBBag } from "@/cards/mode-b-collections";

/** A bag holding no card — every selected id falls back to its slot's kind. */
const EMPTY_BAG: ModeBBag = {
  notes: [],
  todoItems: [],
  comments: [],
  cutterCards: [],
  reportCards: [],
  highlights: [],
};

/** Every slot's selection populated with a distinct sentinel id, so the emitted
 *  set reflects the facet gate alone (not which slots happen to be selected). */
const ALL_SELECTED = Object.fromEntries(
  COLLAB_SELECTION_SLOT_KINDS.map((k) => [k, `id:${k}`]),
) as Record<CollabSlotKind, string>;

describe("collab broadcast writer contract (task 239)", () => {
  it("emits a claim for a slot IFF its kind is hasCollabClaims", () => {
    const emittedKinds = COLLAB_SELECTION_SLOT_KINDS.filter((k) => hasCollabClaims(k));
    const claims = collabClaimsFor(ALL_SELECTED, EMPTY_BAG);
    // One claim per claim-bearing slot; none for the four dead kinds.
    expect(claims).toHaveLength(emittedKinds.length);
    const emittedTokens = new Set(claims.map((c) => c.panelKind));
    for (const k of emittedKinds) {
      expect(emittedTokens.has(collabClaimScope(k))).toBe(true);
    }
    // No dead write: none of the collabClaims:false slots surface a claim.
    for (const k of COLLAB_SELECTION_SLOT_KINDS) {
      if (!hasCollabClaims(k)) {
        expect(claims.some((c) => c.cardId === `id:${k}`)).toBe(false);
      }
    }
  });

  it("the writer's scope-token set ≡ the reader's claim-bearing scope tokens", () => {
    // Reader side: the scope tokens the gated reader will ever look up.
    const readerTokens = new Set(
      CARD_KINDS.filter((k) => hasCollabClaims(k)).map((k) => collabClaimScope(k)),
    );
    // Writer side: the scope tokens the broadcast can emit.
    const writerTokens = new Set(collabClaimsFor(ALL_SELECTED, EMPTY_BAG).map((c) => c.panelKind));
    expect([...writerTokens].sort()).toEqual([...readerTokens].sort());
  });

  it("every claim-bearing kind is covered by a broadcast slot (no forgotten kind)", () => {
    // Coverage in scope-token space: report-request has no own slot but shares
    // report's themeKey, so it's covered. A NEW hasCollabClaims kind with its
    // own themeKey that nobody wired into COLLAB_SELECTION_SLOT_KINDS would trip
    // this — the symmetric "forgot to broadcast" hole this task closed.
    const coveredTokens = new Set(
      COLLAB_SELECTION_SLOT_KINDS.filter((k) => hasCollabClaims(k)).map((k) =>
        collabClaimScope(k),
      ),
    );
    for (const k of CARD_KINDS) {
      if (hasCollabClaims(k)) {
        expect(coveredTokens.has(collabClaimScope(k))).toBe(true);
      }
    }
  });

  it("a null / absent selection contributes no claim", () => {
    const none = Object.fromEntries(
      COLLAB_SELECTION_SLOT_KINDS.map((k) => [k, null]),
    ) as Record<CollabSlotKind, string | null>;
    expect(collabClaimsFor(none, EMPTY_BAG)).toEqual([]);
  });
});

/**
 * Task 1063 — three slots hold ids of more than one kind (`note` ← highlight
 * ids, `cutter-comment` ← cutter-suggestion ids, `revision-comment` ←
 * revision-suggestion ids; `report` ← report-request ids). The gate must judge
 * the selected CARD's kind, resolved from the pane's bag, not the slot's —
 * otherwise selecting a highlight or a suggestion sends a claim no reader reads.
 */
describe("collab broadcast gates on the selected card's kind (task 1063)", () => {
  const BAG: ModeBBag = {
    notes: [{ id: "n1", kind: "note" }],
    todoItems: [],
    comments: [
      { id: "rc1", kind: "comment" },
      { id: "rs1", kind: "suggestion" },
    ],
    cutterCards: [
      { id: "cc1", kind: "comment" },
      { id: "cs1", kind: "suggestion" },
    ],
    reportCards: [
      { id: "r1", kind: "report" },
      { id: "rr1", kind: "report-request" },
    ],
    highlights: [{ id: "h1", kind: "highlight" }],
  };
  const NONE = Object.fromEntries(
    COLLAB_SELECTION_SLOT_KINDS.map((k) => [k, null]),
  ) as Record<CollabSlotKind, string | null>;
  const select = (slot: CollabSlotKind, id: string) =>
    collabClaimsFor({ ...NONE, [slot]: id }, BAG);

  it.each([
    ["note", "h1", "highlight"],
    ["cutter-comment", "cs1", "cutter-suggestion"],
    ["revision-comment", "rs1", "revision-suggestion"],
  ] as const)("a %s slot holding a %s (%s) id emits no claim", (slot, id, kind) => {
    expect(selectedCardKind(slot, id, BAG)).toBe(kind);
    expect(select(slot, id)).toEqual([]);
  });

  it.each([
    ["note", "n1", "note"],
    ["cutter-comment", "cc1", "cut"],
    ["revision-comment", "rc1", "revision"],
    ["report", "r1", "report"],
    ["report", "rr1", "report"],
  ] as const)("a %s slot holding claim-bearing id %s emits one %s claim", (slot, id, scope) => {
    expect(select(slot, id)).toEqual([{ panelKind: scope, cardId: id }]);
  });

  it("a report-request selected through the report slot is judged as report-request", () => {
    expect(selectedCardKind("report", "rr1", BAG)).toBe("report-request");
  });

  it("a monomorphic slot never consults the bag", () => {
    // A footnote id that collides with a highlight id in the bag stays a footnote.
    expect(selectedCardKind("footnote", "h1", BAG)).toBe("footnote");
  });
});
