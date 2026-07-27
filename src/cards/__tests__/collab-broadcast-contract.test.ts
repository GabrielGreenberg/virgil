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
  type CollabSlotKind,
} from "@/cards/collab-broadcast";

/** Every slot's selection populated with a distinct sentinel id, so the emitted
 *  set reflects the facet gate alone (not which slots happen to be selected). */
const ALL_SELECTED = Object.fromEntries(
  COLLAB_SELECTION_SLOT_KINDS.map((k) => [k, `id:${k}`]),
) as Record<CollabSlotKind, string>;

describe("collab broadcast writer contract (task 239)", () => {
  it("emits a claim for a slot IFF its kind is hasCollabClaims", () => {
    const emittedKinds = COLLAB_SELECTION_SLOT_KINDS.filter((k) => hasCollabClaims(k));
    const claims = collabClaimsFor(ALL_SELECTED);
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
    const writerTokens = new Set(collabClaimsFor(ALL_SELECTED).map((c) => c.panelKind));
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
    expect(collabClaimsFor(none)).toEqual([]);
  });
});
