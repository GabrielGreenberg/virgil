// @vitest-environment jsdom
//
// Phase 3 — the PendingChangePill's target binding (`resolveTargetKey`). This is
// the load-bearing logic the live preview can't drive (the placement compute is
// RAF-gated): given the cardStore hover/selection + the caret-focus anchorIds,
// which applied-pending entry the pill acts on. Hover wins over selection; an
// id-only fallback bridges the cutter-vs-revision mark-kind flatten; the caret
// path matches by anchorId.

import { describe, it, expect, vi } from "vitest";

// Importing PendingChangePill transitively pulls `@/lib/storage`, whose backend
// `require("@/lib/storage-fsa")` isn't resolvable under vitest (jsdom). Stub the
// storage barrel — this test only exercises the pure `resolveTargetKey`, which
// touches none of it. (See the `vitest_extension_barrel_storage_mock` note.)
vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(),
  writeSidecar: vi.fn(),
}));

import {
  resolveTargetKey,
  type PendingChangeIndex,
} from "@/components/PendingChangePill";

function makeIndex(): PendingChangeIndex {
  const map: PendingChangeIndex = new Map();
  map.set("revision-suggestion:R1", {
    anchorId: "anc-rev",
    onKeep: () => {},
    onRevert: () => {},
  });
  map.set("cutter-suggestion:C1", {
    anchorId: "anc-cut",
    onKeep: () => {},
    onRevert: () => {},
  });
  return map;
}

describe("resolveTargetKey", () => {
  it("returns the exact kind:id match for a hovered applied card", () => {
    const idx = makeIndex();
    expect(
      resolveTargetKey({ kind: "revision-suggestion", id: "R1" }, null, [], idx),
    ).toBe("revision-suggestion:R1");
  });

  it("prefers hover over selection", () => {
    const idx = makeIndex();
    expect(
      resolveTargetKey(
        { kind: "revision-suggestion", id: "R1" },
        { kind: "cutter-suggestion", id: "C1" },
        [],
        idx,
      ),
    ).toBe("revision-suggestion:R1");
  });

  it("falls back to selection when nothing is hovered", () => {
    const idx = makeIndex();
    expect(
      resolveTargetKey(null, { kind: "cutter-suggestion", id: "C1" }, [], idx),
    ).toBe("cutter-suggestion:C1");
  });

  it("matches by id alone when the hovered kind is the family-flattened mark kind (cutter arrives as revision-suggestion)", () => {
    const idx = makeIndex();
    // The blue in-text mark stamps `revision-suggestion` for a CUTTER applied
    // change too; the id-only fallback still resolves the cutter index entry.
    expect(
      resolveTargetKey({ kind: "revision-suggestion", id: "C1" }, null, [], idx),
    ).toBe("cutter-suggestion:C1");
  });

  it("resolves the caret-focus target by matching a mark anchorId against the index", () => {
    const idx = makeIndex();
    expect(resolveTargetKey(null, null, ["anc-cut"], idx)).toBe(
      "cutter-suggestion:C1",
    );
    expect(resolveTargetKey(null, null, ["anc-rev"], idx)).toBe(
      "revision-suggestion:R1",
    );
  });

  it("returns null when nothing hovered/selected/caret resolves to an applied card", () => {
    const idx = makeIndex();
    expect(resolveTargetKey(null, null, [], idx)).toBeNull();
    // A hovered NON-applied card (not in the index) never summons the pill.
    expect(
      resolveTargetKey({ kind: "note", id: "N9" }, null, ["unknown-anchor"], idx),
    ).toBeNull();
  });
});
