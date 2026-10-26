/**
 * The structural-revision table (task 1301) — `useStructuralRevisions` listens
 * on ONE channel, `onAnyChange`, and bumps every category whose
 * `STRUCTURAL_REVISION_PREDICATES` row holds. That is only sound if every row
 * IMPLIES the bus's wake predicate: a row reading a field the bus does not
 * wake on would be a counter that can never bump for that field.
 *
 * Also pins each row to its kind's fields, so a new `StructureDiff` field for
 * an existing kind (the way `changedLabels` arrived in task 1128) is a
 * decision made here, not a silent miss.
 */
import { describe, expect, it } from "vitest";
import {
  EMPTY_DIFF,
  STRUCTURAL_REVISION_PREDICATES,
  type StructureDiff,
} from "../types";
import { diffWakesStructuralWatchers } from "../bus";

const FIELDS = Object.keys(EMPTY_DIFF) as (keyof StructureDiff)[];

function singleFieldDiff(field: keyof StructureDiff): StructureDiff {
  const empty = EMPTY_DIFF[field];
  let value: unknown;
  if (typeof empty === "boolean") value = true;
  else if (empty instanceof Set) value = new Set(["x"]);
  else value = [{}];
  return { ...EMPTY_DIFF, [field]: value } as StructureDiff;
}

/** Which single fields each category reacts to — the declared contract.
 *  Deliberate omissions: `changedBlocks` / `changedFootnotes` /
 *  `changedExamples` (their order/structure flag is co-set, and they do not
 *  wake the bus), `changedAnchors` (a moved anchor neither entered nor left —
 *  task 1128), `blockParTitleChanged` (not a doc-order input). */
const EXPECTED: Record<keyof typeof STRUCTURAL_REVISION_PREDICATES, (keyof StructureDiff)[]> = {
  footnotes: ["addedFootnotes", "removedFootnotes", "footnoteOrderChanged"],
  citations: [
    "addedCitations",
    "removedCitations",
    "changedCitations",
    "citationOrderChanged",
    "footnoteOrderChanged",
  ],
  examples: ["addedExamples", "removedExamples", "exampleStructureChanged"],
  anchors: ["addedAnchors", "removedAnchors"],
  blocks: ["addedBlocks", "removedBlocks", "blockOrderChanged"],
  headings: ["addedHeadings", "removedHeadings", "changedHeadings"],
  figures: ["addedFigures", "removedFigures", "changedFigures"],
  labels: ["addedLabels", "removedLabels", "changedLabels"],
};

describe("STRUCTURAL_REVISION_PREDICATES", () => {
  it("every row implies diffWakesStructuralWatchers (the hook listens on onAnyChange)", () => {
    for (const field of FIELDS) {
      const diff = singleFieldDiff(field);
      for (const [k, pred] of Object.entries(STRUCTURAL_REVISION_PREDICATES)) {
        if (pred(diff)) {
          expect({ k, field, wakes: diffWakesStructuralWatchers(diff) }).toEqual({
            k,
            field,
            wakes: true,
          });
        }
      }
    }
  });

  it("each row reacts to exactly its declared fields", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(
      Object.keys(STRUCTURAL_REVISION_PREDICATES).sort(),
    );
    for (const [k, pred] of Object.entries(STRUCTURAL_REVISION_PREDICATES)) {
      const actual = FIELDS.filter((f) => pred(singleFieldDiff(f))).sort();
      expect({ k, fields: actual }).toEqual({
        k,
        fields: [...EXPECTED[k as keyof typeof EXPECTED]].sort(),
      });
    }
  });

  it("no row reacts to the empty diff", () => {
    for (const pred of Object.values(STRUCTURAL_REVISION_PREDICATES)) {
      expect(pred(EMPTY_DIFF)).toBe(false);
    }
  });
});
