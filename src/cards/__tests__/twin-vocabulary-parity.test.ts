// @vitest-environment node
//
// Guard (task 304, class: vocabulary-twin-drift). The Revisions and Cutter
// panels host structurally IDENTICAL twin card families — a comment kind and a
// suggestion kind with the same morph shape, the same lifecycle, the same
// content facets, the same drop placement. A twin pair presents ONE vocabulary
// to the user, because the two panels are the same operation in two domains:
// the comment sides have always both read "Request", and since 304 the
// suggestion sides both read "Revision" (Gabriel's decision — the shared
// `user_text` field placeholder already said "Your revision…" on both).
//
// Before 304 they diverged: `revision-suggestion` was "Revision" and
// `cutter-suggestion` was "Suggestion", so the same structural operation was
// named the domain NOUN on one panel and the speech-ACT on the other, in FOUR
// user-visible places apiece (`label` is the SSOT for the card overline, the
// kind-chevron option, the panel's +Add entry and the morph-confirm verb).
// Nothing failed, nothing was a type error, and no suite could see it: the
// registry data was the part that misbehaved, not any code that reads it.
//
// WHY A DERIVED PAIRING, NOT A HAND LIST OF FOUR KINDS. A hand list is the
// tautology this repo's exhaustiveness law (AGENTS.md, "The exhaustiveness
// half") names outright — it would pin today's four labels and say nothing
// about a fifth kind cloned from one of them. So twin-ness is read off the
// registry's OWN structural facets, with the per-FAMILY identity fields
// excluded (`panel`, `keyPrefix`, `themeKey`, `markerType`, `morph.to`, and
// `aiRequest.linkPanel` — each names WHICH family a kind belongs to, never what
// ROLE it plays inside one). Two kinds that agree on everything else are the
// same control in two panels and must be named the same thing.
//
// STATED LIMIT. The signature is coarser than "is a twin" in principle: a
// FUTURE kind could match an existing one on every censused facet without being
// its twin, and would then be forced to share its label. That failure is LOUD
// (a CI failure inviting a look) rather than silent, which is the right
// direction — and the accepting control below pins that today's grouping
// contains exactly the two known pairs, so a signature that collapses into
// uselessness is caught too.

import { describe, it, expect } from "vitest";
import { CARD_REGISTRY } from "@/cards/card-registry";
import type { CardKind } from "@/cards/types";

/**
 * The structural signature of a card kind: everything the registry declares
 * about HOW the kind behaves, with the fields that merely say WHICH family it
 * belongs to stripped out.
 */
function roleSignature(kind: CardKind): string {
  const e = CARD_REGISTRY[kind];
  return JSON.stringify({
    origin: e.origin,
    anchored: e.anchored,
    collabClaims: e.collabClaims,
    droppable: e.droppable,
    dropPlacement: e.dropPlacement,
    lifecycle: e.lifecycle,
    content: e.content,
    bodyClass: e.bodyClass,
    bodySchema: e.bodySchema,
    stackable: e.stackable,
    poppable: e.poppable,
    // `morph.to` names the twin's own counterpart — a family identity, not a
    // role — so only the SHAPE of the morph is censused.
    morph: e.morph ? { lossy: e.morph.lossy, drops: [...e.morph.drops].sort() } : null,
    // Likewise `aiRequest.linkPanel`: the wire KIND is the role.
    aiRequestKind: e.aiRequest ? e.aiRequest.kind : null,
  });
}

/** Kinds grouped by structural signature; only groups with >1 member matter. */
function structuralTwinGroups(): CardKind[][] {
  const groups = new Map<string, CardKind[]>();
  for (const kind of Object.keys(CARD_REGISTRY) as CardKind[]) {
    const sig = roleSignature(kind);
    groups.set(sig, [...(groups.get(sig) ?? []), kind]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

describe("structurally identical twin card kinds present one vocabulary", () => {
  it("the census actually finds the two known twin pairs (accepting control)", () => {
    // Without this leg a signature that grouped NOTHING would pass the real
    // assertion vacuously — a canary must not stand on the defect.
    const groups = structuralTwinGroups().map((g) => [...g].sort());
    expect(groups).toEqual(
      expect.arrayContaining([
        ["cutter-comment", "revision-comment"],
        ["cutter-suggestion", "revision-suggestion"],
      ]),
    );
  });

  it("every structural twin group shares one `label`", () => {
    const offenders: string[] = [];
    for (const group of structuralTwinGroups()) {
      const labels = new Set(group.map((k) => CARD_REGISTRY[k].label));
      if (labels.size > 1) {
        offenders.push(
          `${group.join(" / ")} are structurally identical but labeled ${group
            .map((k) => `${k}="${CARD_REGISTRY[k].label}"`)
            .join(", ")} — pick one vocabulary`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every structural twin group shares one `titleLabel`", () => {
    // The same rule one field over: `titleLabel` is user-visible too, so a twin
    // pair cannot title one side and not the other.
    const offenders: string[] = [];
    for (const group of structuralTwinGroups()) {
      const titles = new Set(group.map((k) => CARD_REGISTRY[k].titleLabel));
      if (titles.size > 1) {
        offenders.push(
          `${group.join(" / ")} disagree on titleLabel: ${group
            .map((k) => `${k}=${JSON.stringify(CARD_REGISTRY[k].titleLabel)}`)
            .join(", ")}`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the decided vocabulary is the one that shipped (defect pin)", () => {
    // The two legs above are satisfied by EITHER unification, so they cannot on
    // their own record which one Gabriel chose. This one does. The pre-304
    // value ("Suggestion" on the cutter side) fails it.
    expect(CARD_REGISTRY["cutter-suggestion"].label).toBe("Revision");
    expect(CARD_REGISTRY["revision-suggestion"].label).toBe("Revision");
    expect(CARD_REGISTRY["cutter-comment"].label).toBe("Request");
    expect(CARD_REGISTRY["revision-comment"].label).toBe("Request");
  });
});
