/**
 * Congruence guardrail for the `DocStructureObserver` public surface (task 212).
 *
 * The module re-enumerates the same field/method sets in several hand-maintained
 * inline lists with no test tying them together, so a list can silently drift
 * from the others (one already had: the `inspectSteps` fast-path omitted
 * `changedFootnotes`, masked only by a co-set flag). This pins the intended
 * relationships so a future field/method addition that forgets a list fails CI
 * instead of silently misbehaving — the same grep/pin discipline the sibling
 * perf laws use (keystroke-sanctity subscriber allowlist, scroll-reposition
 * allowlist).
 *
 * Invariant family (the former M3 — `useDocStructureEvent`'s `SUB_METHODS`
 * parity with the bus — retired with the uncalled hook, task 924):
 *  - M2: the four diff-field emptiness/structural predicates
 *    (`EMPTY_DIFF` / `isEmptyDiff` / `diffHasStructuralEntries` /
 *    `diffWakesStructuralWatchers`) agree with a single field MANIFEST, whose
 *    deliberate divergences are documented alongside each flag.
 */

import { describe, expect, it } from "vitest";
import {
  EMPTY_DIFF,
  isEmptyDiff,
  diffHasStructuralEntries,
  diffTouchesNumberingInputs,
  diffHeadingsRecomputable,
  diffExamplesRecomputable,
  diffFiguresRecomputable,
  diffLabelsRecomputable,
  compareReturnedBlock,
  mergeStructureDiffs,
  type BlockEntry,
  type StructureDiff,
} from "../types";
import { asMutable, createDocStructureBus, diffWakesStructuralWatchers } from "../bus";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { inspectSteps } from "../step-inspector";
import { buildInitial } from "../structure-index";
import { doc, heading, paragraph, testSchema } from "./fixtures";
import { EMPTY_STRUCTURE } from "../types";

// ---------------------------------------------------------------------------
// The single field manifest. Adding a field to `StructureDiff` (and thus
// `EMPTY_DIFF`) without adding it here fails the key-completeness pin below,
// which forces you to declare its three flags — which are then checked against
// all three predicates.
// ---------------------------------------------------------------------------

type FieldKind = "array" | "boolean" | "set";

interface FieldSpec {
  name: keyof StructureDiff;
  kind: FieldKind;
  /** Contributes to `diffHasStructuralEntries` (what `applyDiff` folds).
   *  False only for the two content-only sets. */
  structural: boolean;
  /** Contributes to `diffWakesStructuralWatchers` (the bus `emitCount`
   *  predicate). Narrower than `structural`: also excludes `changedBlocks` /
   *  `changedFootnotes` / `changedExamples` (their order/structure flag is
   *  co-set) plus the two content-only sets. */
  busEmit: boolean;
}

const MANIFEST: FieldSpec[] = [
  { name: "addedBlocks", kind: "array", structural: true, busEmit: true },
  { name: "removedBlocks", kind: "array", structural: true, busEmit: true },
  // changedBlocks: structural (applyDiff folds it) but NOT a bus wake — one of
  // blockOrderChanged / blockParTitleChanged / blockKindChanged is ALWAYS
  // co-set (pinned by the "co-set invariant" block below, task 1638).
  { name: "changedBlocks", kind: "array", structural: true, busEmit: false },
  { name: "blockOrderChanged", kind: "boolean", structural: true, busEmit: true },
  // blockParTitleChanged: the co-set wake flag for an in-place parTitled FLIP
  // riding changedBlocks (same pattern as blockOrderChanged for moves). Typing
  // inside an existing title flips nothing, so this never fires per-keystroke.
  { name: "blockParTitleChanged", kind: "boolean", structural: true, busEmit: true },
  // blockKindChanged (task 1638): the co-set wake flag for a same-pos TYPE
  // change (`setNode`) riding changedBlocks — before it, a paragraph ↔ texBlock
  // change was a changedBlocks entry with NO flag and woke nothing.
  { name: "blockKindChanged", kind: "boolean", structural: true, busEmit: true },
  { name: "addedHeadings", kind: "array", structural: true, busEmit: true },
  { name: "removedHeadings", kind: "array", structural: true, busEmit: true },
  { name: "changedHeadings", kind: "array", structural: true, busEmit: true },
  { name: "addedFootnotes", kind: "array", structural: true, busEmit: true },
  { name: "removedFootnotes", kind: "array", structural: true, busEmit: true },
  // changedFootnotes: structural but NOT a bus wake — footnoteOrderChanged is
  // co-set. This is the field whose omission from the fast-path was the M1 bug.
  { name: "changedFootnotes", kind: "array", structural: true, busEmit: false },
  { name: "footnoteOrderChanged", kind: "boolean", structural: true, busEmit: true },
  { name: "addedCitations", kind: "array", structural: true, busEmit: true },
  { name: "removedCitations", kind: "array", structural: true, busEmit: true },
  { name: "changedCitations", kind: "array", structural: true, busEmit: true },
  { name: "citationOrderChanged", kind: "boolean", structural: true, busEmit: true },
  { name: "addedAnchors", kind: "array", structural: true, busEmit: true },
  { name: "removedAnchors", kind: "array", structural: true, busEmit: true },
  // changedAnchors (task 1128): applyDiff REPLACES the entry, but the id
  // neither entered nor left and every anchor reader resolves lazily — no wake.
  { name: "changedAnchors", kind: "array", structural: true, busEmit: false },
  { name: "addedExamples", kind: "array", structural: true, busEmit: true },
  { name: "removedExamples", kind: "array", structural: true, busEmit: true },
  // changedExamples: structural but NOT a bus wake — exampleStructureChanged is
  // co-set.
  { name: "changedExamples", kind: "array", structural: true, busEmit: false },
  { name: "exampleStructureChanged", kind: "boolean", structural: true, busEmit: true },
  { name: "addedFigures", kind: "array", structural: true, busEmit: true },
  { name: "removedFigures", kind: "array", structural: true, busEmit: true },
  { name: "changedFigures", kind: "array", structural: true, busEmit: true },
  { name: "addedLabels", kind: "array", structural: true, busEmit: true },
  { name: "removedLabels", kind: "array", structural: true, busEmit: true },
  // changedLabels (task 1128): a moved / re-won definition — a numbering
  // input, like changedHeadings.
  { name: "changedLabels", kind: "array", structural: true, busEmit: true },
  // The two content-only sets: never structural, never a bus wake (the
  // plain-keystroke case that must leave emitCount flat).
  { name: "contentChangedUuids", kind: "set", structural: false, busEmit: false },
  { name: "exampleContentChangedUuids", kind: "set", structural: false, busEmit: false },
  // Task 1127: the expex renumberer's shape wake — content-only like the two
  // sets (applyDiff folds nothing for it), never a bus wake.
  { name: "exampleShapeChanged", kind: "boolean", structural: false, busEmit: false },
];

/** A diff equal to EMPTY_DIFF except `name` is made non-empty. */
function withField(spec: FieldSpec): StructureDiff {
  const base: StructureDiff = { ...EMPTY_DIFF };
  const value =
    spec.kind === "array"
      ? // predicates only read `.length`, so a shape-free dummy entry is fine
        ([{}] as unknown as StructureDiff[typeof spec.name])
      : spec.kind === "boolean"
        ? (true as unknown as StructureDiff[typeof spec.name])
        : (new Set(["x"]) as unknown as StructureDiff[typeof spec.name]);
  (base as unknown as Record<string, unknown>)[spec.name] = value;
  return base;
}

describe("StructureDiff field manifest — key completeness (the pin)", () => {
  it("MANIFEST enumerates exactly the fields of EMPTY_DIFF", () => {
    const manifestNames = MANIFEST.map((f) => f.name).sort();
    const emptyNames = (Object.keys(EMPTY_DIFF) as (keyof StructureDiff)[]).sort();
    // If this fails, a field was added to StructureDiff/EMPTY_DIFF without a
    // MANIFEST entry (or vice-versa). Add it here with its three flags.
    expect(manifestNames).toEqual(emptyNames);
  });

  it("MANIFEST has no duplicate field names", () => {
    const names = MANIFEST.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("EMPTY_DIFF is empty by every predicate", () => {
  it("isEmptyDiff(EMPTY_DIFF) is true", () => {
    expect(isEmptyDiff(EMPTY_DIFF)).toBe(true);
  });
  it("diffHasStructuralEntries(EMPTY_DIFF) is false", () => {
    expect(diffHasStructuralEntries(EMPTY_DIFF)).toBe(false);
  });
  it("diffWakesStructuralWatchers(EMPTY_DIFF) is false", () => {
    expect(diffWakesStructuralWatchers(EMPTY_DIFF)).toBe(false);
  });
  it("every EMPTY_DIFF field is actually empty", () => {
    for (const spec of MANIFEST) {
      const v = EMPTY_DIFF[spec.name];
      if (spec.kind === "array") expect((v as unknown[]).length).toBe(0);
      else if (spec.kind === "set") expect((v as ReadonlySet<unknown>).size).toBe(0);
      else expect(v).toBe(false);
    }
  });
});

describe("single-field-nonempty diffs agree with the manifest", () => {
  for (const spec of MANIFEST) {
    describe(`field: ${spec.name}`, () => {
      const diff = withField(spec);

      it("is NOT empty per isEmptyDiff (every field gates emptiness — the M1 guarantee)", () => {
        expect(isEmptyDiff(diff)).toBe(false);
      });

      it(`diffHasStructuralEntries === ${spec.structural}`, () => {
        expect(diffHasStructuralEntries(diff)).toBe(spec.structural);
      });

      it(`diffWakesStructuralWatchers === ${spec.busEmit}`, () => {
        expect(diffWakesStructuralWatchers(diff)).toBe(spec.busEmit);
      });
    });
  }
});

describe("predicate breadth relationships hold across the manifest", () => {
  it("bus-wake ⊆ structural (never wakes without being structural)", () => {
    for (const spec of MANIFEST) {
      if (spec.busEmit) expect(spec.structural).toBe(true);
    }
  });

  it("the bus predicate omits exactly the three co-set changed-sets and changedAnchors", () => {
    const omitted = MANIFEST.filter((f) => f.structural && !f.busEmit).map((f) => f.name).sort();
    expect(omitted).toEqual(["changedAnchors", "changedBlocks", "changedExamples", "changedFootnotes"]);
  });
});

// ---------------------------------------------------------------------------
// Task 923 — the per-kind "recomputable" predicates and the numberer's
// `diffTouchesNumberingInputs` are their union. Each kind's field set is pinned
// here, and the bus's `on*Recomputable` emits are checked to ask the SAME
// predicates (so the numberer and the bus can never disagree about what makes
// headings/figures/examples/labels stale).
// ---------------------------------------------------------------------------

const RECOMPUTABLE: Record<
  "Headings" | "Examples" | "Figures" | "Labels",
  { predicate: (d: StructureDiff) => boolean; fields: (keyof StructureDiff)[] }
> = {
  Headings: {
    predicate: diffHeadingsRecomputable,
    fields: ["addedHeadings", "removedHeadings", "changedHeadings"],
  },
  Examples: {
    predicate: diffExamplesRecomputable,
    // changedExamples is deliberately absent: exampleStructureChanged is co-set.
    fields: ["addedExamples", "removedExamples", "exampleStructureChanged"],
  },
  Figures: {
    predicate: diffFiguresRecomputable,
    fields: ["addedFigures", "removedFigures", "changedFigures"],
  },
  Labels: {
    predicate: diffLabelsRecomputable,
    fields: ["addedLabels", "removedLabels", "changedLabels"],
  },
};

const NUMBERING_FIELDS = new Set(Object.values(RECOMPUTABLE).flatMap((k) => k.fields));

describe("per-kind recomputable predicates + diffTouchesNumberingInputs (task 923)", () => {
  for (const spec of MANIFEST) {
    const diff = withField(spec);
    for (const [kind, { predicate, fields }] of Object.entries(RECOMPUTABLE)) {
      it(`${kind}: ${spec.name} → ${fields.includes(spec.name)}`, () => {
        expect(predicate(diff)).toBe(fields.includes(spec.name));
      });
    }
    it(`diffTouchesNumberingInputs: ${spec.name} → ${NUMBERING_FIELDS.has(spec.name)}`, () => {
      expect(diffTouchesNumberingInputs(diff)).toBe(NUMBERING_FIELDS.has(spec.name));
    });
  }

  it("numbering inputs ⊆ bus-wake fields (a numbering change always wakes the bus)", () => {
    for (const spec of MANIFEST) {
      if (NUMBERING_FIELDS.has(spec.name)) expect(spec.busEmit).toBe(true);
    }
  });

  it("the bus's on*Recomputable emits fire exactly when the per-kind predicate says so", () => {
    for (const spec of MANIFEST) {
      const diff = withField(spec);
      const bus = createDocStructureBus();
      const fired: string[] = [];
      for (const kind of Object.keys(RECOMPUTABLE)) {
        const method = `on${kind}Recomputable` as const;
        (bus[method as keyof typeof bus] as (fn: () => void) => () => void)(() => fired.push(kind));
      }
      asMutable(bus)._emit(diff, EMPTY_STRUCTURE);
      const expected = Object.entries(RECOMPUTABLE)
        .filter(([, { predicate }]) => predicate(diff))
        .map(([k]) => k);
      expect(fired.sort()).toEqual(expected.sort());
    }
  });
});

// ---------------------------------------------------------------------------
// Task 1638 — the CO-SET INVARIANT the bus wake predicate rests on. The bus
// omits `changedBlocks` because a flag is supposed to ride every entry in it;
// that claim was false for a same-pos kind change (task 921) and three
// comments vouched for it anyway. Here it is a property, checked (a) over the
// ONE comparator's whole verdict space and (b) over real diffs produced by the
// inspector and the cross-transaction merge — so a future silent `changed`
// verdict fails CI instead of hiding behind a comment.
// ---------------------------------------------------------------------------

function blockMaskHolds(d: StructureDiff): boolean {
  return (
    d.changedBlocks.length === 0 ||
    d.blockOrderChanged ||
    d.blockParTitleChanged ||
    d.blockKindChanged
  );
}

describe("co-set invariant: changedBlocks never rides alone (task 1638)", () => {
  it("compareReturnedBlock: every `changed` verdict sets a flag (exhaustive)", () => {
    const entry = (typeName: string, parTitled: boolean): BlockEntry =>
      ({ uuid: "u", pos: 0, typeName, parTitled }) as BlockEntry;
    for (const moved of [false, true])
      for (const titleFlip of [false, true])
        for (const kindChange of [false, true]) {
          const v = compareReturnedBlock(
            entry("paragraph", false),
            entry(kindChange ? "texBlock" : "paragraph", titleFlip),
            moved,
          );
          expect(v.changed).toBe(moved || titleFlip || kindChange);
          if (v.changed) {
            expect(v.blockOrderChanged || v.blockParTitleChanged || v.blockKindChanged).toBe(true);
          }
        }
  });

  const P = testSchema.nodes.paragraph;
  const T = testSchema.nodes.texBlock;
  const H = testSchema.nodes.heading;
  const inspect = (oldDoc: PMNode, edit: (tr: Transaction) => Transaction) => {
    const s = EditorState.create({ schema: testSchema, doc: oldDoc });
    const tr = edit(s.tr);
    return inspectSteps(tr, s.doc, tr.doc, buildInitial(oldDoc));
  };
  const base = () => doc(paragraph("a", "one"), heading("h", 1, "Two"), paragraph("b", "three"));
  const CORPUS: [string, () => StructureDiff][] = [
    ["paragraph → texBlock", () => inspect(base(), (tr) => tr.setNodeMarkup(0, T, { uuid: "a" }))],
    ["heading → paragraph", () => inspect(base(), (tr) => tr.setNodeMarkup(5, P, { uuid: "h" }))],
    ["paragraph → heading", () =>
      inspect(base(), (tr) => tr.setNodeMarkup(0, H, { uuid: "a", level: 1 }))],
    ["par-title flip", () =>
      inspect(base(), (tr) => tr.setNodeMarkup(0, undefined, { uuid: "a", parTitle: "T" }))],
    ["move (delete + re-insert)", () =>
      inspect(base(), (tr) => {
        const node = tr.doc.child(0);
        tr.delete(0, node.nodeSize);
        return tr.insert(tr.doc.content.size, node);
      })],
    ["typing", () => inspect(base(), (tr) => tr.insertText("x", 2))],
    ["cross-transaction re-add as another kind", () => {
      const d0 = base();
      const s = EditorState.create({ schema: testSchema, doc: d0 });
      const t1 = s.tr.delete(0, d0.child(0).nodeSize);
      const a = inspectSteps(t1, d0, t1.doc, buildInitial(d0));
      const s1 = EditorState.create({ schema: testSchema, doc: t1.doc });
      const t2 = s1.tr.insert(0, T.create({ uuid: "a" }, testSchema.text("one")));
      const b = inspectSteps(t2, t1.doc, t2.doc, buildInitial(t1.doc));
      return mergeStructureDiffs(a, b);
    }],
  ];

  for (const [label, make] of CORPUS) {
    it(`${label}: changedBlocks ⇒ a co-set wake flag`, () => {
      const d = make();
      expect(blockMaskHolds(d)).toBe(true);
      // …and therefore the bus wakes for every diff the index folds a block for.
      if (d.changedBlocks.length > 0) expect(diffWakesStructuralWatchers(d)).toBe(true);
    });
  }

  it("the corpus actually exercises a sub-view-less kind change (not vacuous)", () => {
    const d = CORPUS[0][1]();
    expect(d.changedBlocks.length).toBe(1);
    expect(d.blockKindChanged).toBe(true);
    expect(d.addedHeadings.length + d.removedHeadings.length).toBe(0);
  });
});
