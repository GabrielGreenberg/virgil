// @vitest-environment node
//
// Task 1626: `cardKindNoun` is THE noun for a card kind (task 1581), and it
// pluralizes with a plain `s` — which turned the bib kind ("Bibliography")
// into "bibliographys". The panel-empty-sentence suite only reaches the kinds
// a panel HOSTS through `panelEmptySentence`, so nothing saw it. This census
// walks EVERY `CardKind`: a kind either DECLARES its `noun` forms in the
// registry, or its label must be one a plain `s` pluralizes correctly — so a
// future label like "Gloss" or "Summary" fails here instead of shipping.

import { describe, expect, it } from "vitest";
import { CARD_REGISTRY } from "@/cards/card-registry";
import { cardKindNoun } from "@/panels/panel-registry";
import type { CardKind } from "@/panels/_shared/types";

const KINDS = Object.keys(CARD_REGISTRY) as CardKind[];

/** Labels whose English plural is NOT `+s`: -s/-x/-z/-ch/-sh take "es", a
 *  consonant + y takes "ies". Such a label must declare its `noun`. */
const IRREGULAR_UNDER_PLAIN_S = /(?:s|x|z|ch|sh|[^aeiou]y)$/i;

describe("cardKindNoun census (task 1626)", () => {
  it("every kind's plural is declared or provably regular", () => {
    const offenders: string[] = [];
    for (const k of KINDS) {
      const meta = CARD_REGISTRY[k];
      if (meta.noun) {
        expect(cardKindNoun(k, 1), k).toBe(meta.noun.one);
        expect(cardKindNoun(k, 2), k).toBe(meta.noun.many);
        expect(cardKindNoun(k, 0), k).toBe(meta.noun.many);
        continue;
      }
      if (IRREGULAR_UNDER_PLAIN_S.test(meta.label)) {
        offenders.push(
          `${k}: label "${meta.label}" does not pluralize with a plain "s" — declare \`noun: { one, many }\` on its CARD_REGISTRY entry`,
        );
        continue;
      }
      expect(cardKindNoun(k, 2), k).toBe(`${meta.label.toLowerCase()}s`);
    }
    expect(offenders).toEqual([]);
  });

  it("pins every kind's singular and plural", () => {
    const table = Object.fromEntries(
      KINDS.map((k) => [k, [cardKindNoun(k, 1), cardKindNoun(k, 2)]]),
    );
    expect(table).toEqual({
      note: ["note", "notes"],
      highlight: ["highlight", "highlights"],
      footnote: ["footnote", "footnotes"],
      archive: ["archive", "archives"],
      todo: ["task", "tasks"],
      bib: ["bibliography entry", "bibliography entries"],
      citation: ["citation", "citations"],
      "revision-comment": ["request", "requests"],
      "cutter-comment": ["request", "requests"],
      "cutter-suggestion": ["revision", "revisions"],
      "revision-suggestion": ["revision", "revisions"],
      report: ["report", "reports"],
      "report-request": ["report request", "report requests"],
      example: ["example", "examples"],
      error: ["error", "errors"],
    });
  });
});
