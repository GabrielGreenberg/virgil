/**
 * Per-card archive predicates (`isArchivable` / `archiveRemovesAtom`).
 *
 * `isArchivable` is DERIVED from provenance (`origin === "user"`) with TWO
 * documented exceptions — `highlight` (a text-range tint with no body; archiving
 * would orphan its persistent tint) and `footnote` (pending a footnote-lifecycle
 * change to model unanchored footnotes). Both are delete-only. These pins freeze
 * that contract so a future registry/predicate edit that would (a) make a
 * system/derived kind archivable, or (b) silently re-enable highlight/footnote,
 * trips a test instead of shipping.
 */
import { describe, it, expect } from "vitest";
import { CARD_KINDS, isArchivable, archiveRemovesAtom } from "../predicates";
import { CARD_REGISTRY } from "../card-registry";
import type { CardKind } from "../types";

const ARCHIVABLE: CardKind[] = [
  "note",
  "citation",
  "archive",
  "todo",
  "report",
  "report-request",
  "revision-comment",
  "revision-suggestion",
  "cutter-comment",
  "cutter-suggestion",
];

const NOT_ARCHIVABLE: CardKind[] = [
  "highlight", // user decision: delete-only (tint has no archived state)
  "footnote", // pending follow-up: footnote subsystem doesn't model unanchored
  "example", // origin: derived
  "bib",
  "error", // origin: system
];

describe("isArchivable", () => {
  it("is true for exactly the user-authored kinds, minus highlight + footnote", () => {
    for (const k of ARCHIVABLE) expect(isArchivable(k)).toBe(true);
    for (const k of NOT_ARCHIVABLE) expect(isArchivable(k)).toBe(false);
  });

  it("covers every registry kind (no kind left unclassified)", () => {
    expect(new Set([...ARCHIVABLE, ...NOT_ARCHIVABLE])).toEqual(
      new Set(CARD_KINDS),
    );
  });

  it("tracks origin === 'user' except for the highlight + footnote exceptions", () => {
    for (const k of CARD_KINDS) {
      const expected =
        CARD_REGISTRY[k].origin === "user" &&
        k !== "highlight" &&
        k !== "footnote";
      expect(isArchivable(k)).toBe(expected);
    }
  });

  it("never marks a system kind archivable", () => {
    for (const k of CARD_KINDS) {
      if (CARD_REGISTRY[k].origin === "system") expect(isArchivable(k)).toBe(false);
    }
  });
});

describe("archiveRemovesAtom", () => {
  it("is true for exactly the inline-atom kinds", () => {
    expect(archiveRemovesAtom("footnote")).toBe(true);
    expect(archiveRemovesAtom("citation")).toBe(true);
    for (const k of CARD_KINDS) {
      if (k === "footnote" || k === "citation") continue;
      expect(archiveRemovesAtom(k)).toBe(false);
    }
  });

  it("citation is both archivable AND atom-removing (the full atom path)", () => {
    expect(isArchivable("citation")).toBe(true);
    expect(archiveRemovesAtom("citation")).toBe(true);
  });
});
