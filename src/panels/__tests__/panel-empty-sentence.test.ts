// @vitest-environment node
//
// Task 1526: a card panel's empty-state NOUN is derived from the labels of the
// kinds it hosts (`panelEmptySentence`), so it names what the panel's "+" menu
// offers. The census that every non-exempt slot USES it lives in
// `src/__tests__/panel-empty-state-contract.test.ts` (leg 6); this pins the
// derivation's output.

import { describe, expect, it } from "vitest";
import { CARD_REGISTRY } from "@/cards/card-registry";
import { cardTypeLabel, panelEmptySentence } from "@/panels/panel-registry";
import type { CardKind } from "@/panels/_shared/types";

describe("panelEmptySentence", () => {
  it.each([
    ["cutter", "No requests or revisions yet."],
    ["revisions", "No requests or revisions yet."],
    ["notes", "No notes or highlights yet."],
    ["todo", "No tasks yet."],
    ["reports", "No reports or report requests yet."],
    ["footnotes", "No footnotes yet."],
    ["citations", "No citations yet."],
    ["examples", "No examples yet."],
  ] as const)("%s → %s", (panel, sentence) => {
    expect(panelEmptySentence(panel)).toBe(sentence);
  });

  it("names every label the panel hosts — a rename moves the sentence", () => {
    for (const k of Object.keys(CARD_REGISTRY) as CardKind[]) {
      const panel = CARD_REGISTRY[k].panel;
      if (!panel) continue;
      expect(panelEmptySentence(panel)).toContain(`${cardTypeLabel(k).toLowerCase()}s`);
    }
  });

  it("refuses a panel that hosts no card kind", () => {
    expect(() => panelEmptySentence("outline")).toThrow(/hosts no card kind/);
  });
});
