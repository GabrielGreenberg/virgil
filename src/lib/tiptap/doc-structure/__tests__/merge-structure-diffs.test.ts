// The composition table for folding a dispatch's transactions into one diff
// (task 650). `mergeStructureDiffs(a, b)` must read as "a THEN b" — the diff a
// single transaction doing both would have produced — because the bus emits it
// once per dispatch and every consumer reads it as one gesture's delta.

import { describe, it, expect } from "vitest";
import {
  EMPTY_DIFF,
  mapStructureDiffPositions,
  mergeStructureDiffs,
  type BlockEntry,
  type FootnoteEntry,
  type StructureDiff,
} from "../types";

function block(uuid: string, pos: number): BlockEntry {
  return { uuid, pos, typeName: "paragraph", parTitled: false };
}
function footnote(id: string, pos: number, number = 1): FootnoteEntry {
  return { id, pos, thanks: false, number };
}
function diff(partial: Partial<StructureDiff>): StructureDiff {
  return { ...EMPTY_DIFF, ...partial };
}

describe("mergeStructureDiffs — the composition table", () => {
  it("EMPTY_DIFF is the identity on both sides", () => {
    const d = diff({ addedBlocks: [block("a", 0)] });
    expect(mergeStructureDiffs(EMPTY_DIFF, d)).toBe(d);
    expect(mergeStructureDiffs(d, EMPTY_DIFF)).toBe(d);
  });

  it("added ∘ removed → neither: a block born and deleted inside one dispatch never existed", () => {
    const merged = mergeStructureDiffs(
      diff({ addedBlocks: [block("ghost", 0)] }),
      diff({ removedBlocks: [block("ghost", 0)] }),
    );
    // Nothing else happened, so the whole composition collapses to the shared
    // singleton — consumers' `=== EMPTY_DIFF` identity check must still work.
    expect(merged).toBe(EMPTY_DIFF);
  });

  it("removed ∘ added → changed: the same id leaving and re-entering is a MOVE, not an orphan", () => {
    const merged = mergeStructureDiffs(
      diff({ removedBlocks: [block("m", 0)] }),
      diff({ addedBlocks: [block("m", 40)] }),
    );
    expect(merged.removedBlocks).toEqual([]);
    expect(merged.addedBlocks).toEqual([]);
    expect(merged.changedBlocks.map((b) => [b.uuid, b.pos])).toEqual([["m", 40]]);
  });

  it("added ∘ changed → added, carrying the fresher entry", () => {
    const merged = mergeStructureDiffs(
      diff({ addedBlocks: [block("n", 0)] }),
      diff({ changedBlocks: [block("n", 12)] }),
    );
    expect(merged.changedBlocks).toEqual([]);
    expect(merged.addedBlocks.map((b) => b.pos)).toEqual([12]);
  });

  it("changed ∘ removed → removed", () => {
    const merged = mergeStructureDiffs(
      diff({ changedFootnotes: [footnote("f", 5)] }),
      diff({ removedFootnotes: [footnote("f", 5)] }),
    );
    expect(merged.changedFootnotes).toEqual([]);
    expect(merged.removedFootnotes.map((f) => f.id)).toEqual(["f"]);
  });

  it("keeps entries that only one side mentions, and ORs the flags", () => {
    const merged = mergeStructureDiffs(
      diff({ removedBlocks: [block("p-one", 0)], removedFootnotes: [footnote("fn-a", 3)] }),
      diff({ changedFootnotes: [footnote("fn-b", 20, 1)], footnoteOrderChanged: true }),
    );
    expect(merged.removedBlocks.map((b) => b.uuid)).toEqual(["p-one"]);
    expect(merged.removedFootnotes.map((f) => f.id)).toEqual(["fn-a"]);
    expect(merged.changedFootnotes.map((f) => f.id)).toEqual(["fn-b"]);
    expect(merged.footnoteOrderChanged).toBe(true);
  });

  it("an anchor removed then re-added reports NEITHER — the id never left the document", () => {
    // Anchors and labels have no `changed` bucket: their buckets mean "this id
    // entered / left". A `changed` verdict there is silence, not an event.
    const anchor = { id: "an-1", from: 1, to: 5, kind: "note" };
    const merged = mergeStructureDiffs(
      diff({ removedAnchors: [anchor] }),
      diff({ addedAnchors: [{ ...anchor, from: 9, to: 13 }] }),
    );
    expect(merged).toBe(EMPTY_DIFF);
  });

  it("a block deleted later in the dispatch drops out of contentChangedUuids", () => {
    const merged = mergeStructureDiffs(
      diff({ contentChangedUuids: new Set(["doomed", "kept"]) }),
      diff({ removedBlocks: [block("doomed", 0)] }),
    );
    expect([...merged.contentChangedUuids]).toEqual(["kept"]);
    expect(merged.removedBlocks.map((b) => b.uuid)).toEqual(["doomed"]);
  });
});

describe("mapStructureDiffPositions", () => {
  const shift = (by: number) => ({ map: (pos: number) => pos + by });

  it("carries LIVE positions forward and leaves the diff alone when nothing moved", () => {
    const d = diff({ addedBlocks: [block("a", 10)], changedBlocks: [block("b", 20)] });
    expect(mapStructureDiffPositions(d, { map: (p: number) => p })).toBe(d);
    const moved = mapStructureDiffPositions(d, shift(7));
    expect(moved.addedBlocks[0].pos).toBe(17);
    expect(moved.changedBlocks[0].pos).toBe(27);
  });

  it("does NOT remap `removed` entries — their positions are historical by construction", () => {
    // `inspectSteps` collects removals against the doc BEFORE the deleting
    // step, and `footnote.ts` resolves `removed.pos` against `oldState.doc`.
    const d = diff({ removedFootnotes: [footnote("gone", 30)] });
    expect(mapStructureDiffPositions(d, shift(7)).removedFootnotes[0].pos).toBe(30);
  });

  it("EMPTY_DIFF maps to itself", () => {
    expect(mapStructureDiffPositions(EMPTY_DIFF, shift(5))).toBe(EMPTY_DIFF);
  });
});
