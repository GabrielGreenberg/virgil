import { describe, it, expect, afterEach } from "vitest";
import {
  CARD_REGISTRY,
  morphOptionsFor,
  resolveMorphTarget,
} from "../card-registry";
import { morphConfirmMessage } from "../lifecycle/run-event";
import { CARD_KINDS, cardKindsForPanel } from "../predicates";
import type { CardKind, CardMeta } from "../types";

/**
 * Task 722 — the morph TARGET is resolved from the registry, never written as a
 * literal at the chevron.
 *
 * The chevron used to take its OPTIONS from `cardKindsForPanel(panel)` (every
 * kind sharing the panel) and its ACTION from a hand-written literal behind a
 * not-me test: `if (k !== "report") onConvert(id, "report-request")`. The kind
 * the user selected was tested and then discarded at all 15 sites. Today every
 * morphing panel holds exactly a pair, so the literal and `morph.to` agreed by
 * coincidence — the dialog (generated from `morph.to`) and the mutation could
 * not disagree because there was nothing else to pick.
 *
 * Both halves now read one fact. `morphOptionsFor` derives the menu from the
 * morph route; `resolveMorphTarget` turns the SELECTION into the target the
 * chokepoint dispatches. The suite proves it with a third kind — the case the
 * old dialect got wrong — rather than by reasoning about it.
 */

const MORPHING = CARD_KINDS.filter((k) => CARD_REGISTRY[k].morph != null);

describe("morphOptionsFor: the menu is the morph route", () => {
  it("there are morphing kinds to speak of", () => {
    expect(MORPHING.length).toBeGreaterThan(0);
  });

  it("offers exactly the kind itself + its declared target", () => {
    for (const k of MORPHING) {
      expect(new Set(morphOptionsFor(k))).toEqual(
        new Set([k, CARD_REGISTRY[k].morph!.to]),
      );
    }
  });

  it("a non-morphing kind offers only itself (CardKindHeader then renders the plain label)", () => {
    for (const k of CARD_KINDS.filter((x) => CARD_REGISTRY[x].morph == null)) {
      expect(morphOptionsFor(k)).toEqual([k]);
    }
  });

  it("PARITY with the retired `cardKindsForPanel(panel)` menu — same list, same order, so no chevron changes today", () => {
    for (const k of MORPHING) {
      expect(morphOptionsFor(k)).toEqual(
        cardKindsForPanel(CARD_REGISTRY[k].panel!),
      );
    }
  });
});

describe("resolveMorphTarget: the selection IS the target", () => {
  it("resolves the declared target for every morphing kind", () => {
    for (const k of MORPHING) {
      const to = CARD_REGISTRY[k].morph!.to;
      expect(resolveMorphTarget(k, to)).toBe(to);
    }
  });

  it("re-picking the current kind resolves to nothing (the chevron's no-op leg)", () => {
    for (const k of MORPHING) expect(resolveMorphTarget(k, k)).toBeNull();
  });

  it("a kind no morph route reaches resolves to nothing rather than to the pair partner", () => {
    // `todo` shares no morph route with any reports kind.
    expect(resolveMorphTarget("report", "todo")).toBeNull();
    expect(resolveMorphTarget("note", "todo")).toBeNull();
    // A non-morphing kind resolves nothing at all.
    expect(resolveMorphTarget("todo", "note")).toBeNull();
  });
});

/**
 * The third-kind proof. A fixture kind is added to the reports panel and
 * `report`'s declared target is pointed at it, then the two questions the
 * chevron asks are put to the registry: what do I offer, and what does picking
 * it do. The old dialect answered the second with `"report-request"` whatever
 * the first said.
 */
describe("a third kind in a morphing panel", () => {
  const THIRD = "fixture-third" as CardKind;
  const reg = CARD_REGISTRY as Record<string, CardMeta>;
  const savedReportMorph = CARD_REGISTRY.report.morph;

  afterEach(() => {
    delete reg[THIRD];
    const i = CARD_KINDS.indexOf(THIRD);
    if (i !== -1) CARD_KINDS.splice(i, 1);
    (CARD_REGISTRY.report as { morph: CardMeta["morph"] }).morph = savedReportMorph;
  });

  function installThird(): void {
    reg[THIRD] = {
      ...CARD_REGISTRY["report-request"],
      label: "Fixture Third",
      morph: { to: "report", lossy: false, drops: [] },
    };
    CARD_KINDS.push(THIRD);
  }

  it("is NOT offered when no morph route reaches it — an option whose action goes elsewhere is unrepresentable", () => {
    installThird();
    // `report` still declares report-request; the third kind merely shares the panel.
    expect(cardKindsForPanel("reports")).toContain(THIRD); // it IS a panel member
    expect(morphOptionsFor("report")).not.toContain(THIRD); // …and still not offered
    expect(resolveMorphTarget("report", THIRD)).toBeNull();
  });

  it("when it IS the declared target, the menu offers it and selecting it morphs TO IT — not to the old partner", () => {
    installThird();
    (CARD_REGISTRY.report as { morph: CardMeta["morph"] }).morph = {
      to: THIRD,
      lossy: true,
      drops: ["title"],
    };
    expect(morphOptionsFor("report")).toContain(THIRD);
    expect(morphOptionsFor("report")).not.toContain("report-request");
    // The dispatch follows the selection…
    expect(resolveMorphTarget("report", THIRD)).toBe(THIRD);
    // …and the hardcoded partner is no longer reachable at all.
    expect(resolveMorphTarget("report", "report-request")).toBeNull();
  });

  it("the confirm copy names the SAME kind the dispatch resolves", () => {
    installThird();
    (CARD_REGISTRY.report as { morph: CardMeta["morph"] }).morph = {
      to: THIRD,
      lossy: true,
      drops: ["title"],
    };
    const target = resolveMorphTarget("report", THIRD)!;
    const copy = morphConfirmMessage("report")!;
    expect(copy.title).toContain(CARD_REGISTRY[target].label);
    expect(copy.confirmLabel).toContain(CARD_REGISTRY[target].label);
    // The old literal's target is named nowhere in the copy.
    expect(copy.title).not.toContain(CARD_REGISTRY["report-request"].label);
  });
});
