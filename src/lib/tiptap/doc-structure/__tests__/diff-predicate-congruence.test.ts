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
 * Two invariant families:
 *  - M2: the four diff-field emptiness/structural predicates
 *    (`EMPTY_DIFF` / `isEmptyDiff` / `diffHasStructuralEntries` /
 *    `diffWakesStructuralWatchers`) agree with a single field MANIFEST, whose
 *    deliberate divergences are documented alongside each flag.
 *  - M3: the React hook's `SUB_METHODS` union covers exactly the bus's `on*`
 *    subscription surface (minus the two intentionally-excluded per-uuid ones).
 */

import { describe, expect, it } from "vitest";
import {
  EMPTY_DIFF,
  isEmptyDiff,
  diffHasStructuralEntries,
  type StructureDiff,
} from "../types";
import { createDocStructureBus, diffWakesStructuralWatchers } from "../bus";
import { SUB_METHODS, SUB_METHOD_UUID_EXCLUSIONS } from "../hook";

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
  // changedBlocks: structural (applyDiff folds it) but NOT a bus wake —
  // blockOrderChanged is co-set.
  { name: "changedBlocks", kind: "array", structural: true, busEmit: false },
  { name: "blockOrderChanged", kind: "boolean", structural: true, busEmit: true },
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
  // The two content-only sets: never structural, never a bus wake (the
  // plain-keystroke case that must leave emitCount flat).
  { name: "contentChangedUuids", kind: "set", structural: false, busEmit: false },
  { name: "exampleContentChangedUuids", kind: "set", structural: false, busEmit: false },
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

  it("the bus predicate omits exactly the three co-set changed-sets", () => {
    const omitted = MANIFEST.filter((f) => f.structural && !f.busEmit).map((f) => f.name).sort();
    expect(omitted).toEqual(["changedBlocks", "changedExamples", "changedFootnotes"]);
  });
});

// ---------------------------------------------------------------------------
// M3 — the React hook's SUB_METHODS union vs the live bus surface.
// ---------------------------------------------------------------------------

describe("useDocStructureEvent SUB_METHODS parity with the bus", () => {
  const bus = createDocStructureBus();
  const busOnMethods = Object.keys(bus)
    .filter((k) => k.startsWith("on"))
    .sort();
  const covered = [...SUB_METHODS, ...SUB_METHOD_UUID_EXCLUSIONS].sort();

  it("every bus on* method is covered (in SUB_METHODS or an explicit exclusion)", () => {
    // If this fails, a new bus.on* method was added without extending
    // SUB_METHODS (or the per-uuid exclusion list) — it would be silently
    // unreachable through the typed hook. This is exactly how onBlockOrderChanged
    // drifted out of the union before task 212.
    expect(covered).toEqual(busOnMethods);
  });

  it("no phantom SUB_METHODS name that the bus doesn't expose", () => {
    for (const name of SUB_METHODS) {
      expect(busOnMethods).toContain(name);
    }
  });

  it("onBlockOrderChanged is now reachable through the hook (the drifted member)", () => {
    expect(SUB_METHODS as readonly string[]).toContain("onBlockOrderChanged");
  });

  it("the per-uuid subscriptions are excluded on purpose, not merely forgotten", () => {
    for (const name of SUB_METHOD_UUID_EXCLUSIONS) {
      expect(busOnMethods).toContain(name);
      expect(SUB_METHODS as readonly string[]).not.toContain(name);
    }
  });
});
