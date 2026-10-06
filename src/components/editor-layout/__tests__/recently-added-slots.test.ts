import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  RECENTLY_ADDED_SELECTION_SLOT,
  driftedRecentlyAddedKinds,
} from "../recently-added-auto-clear";

// Task 975: the recently-added pin is released by ONE total table (pin bucket →
// selection slot). The old hand list missed `highlight` and `archive`, so a new
// highlight's pin never cleared and masked every later note's pin.

const none = {
  selectedNoteId: null,
  selectedCutterCardId: null,
  selectedReportCardId: null,
  selectedCommentId: null,
  selectedTodoId: null,
  selectedFootnoteId: null,
  selectedArchiveId: null,
  selectedCitationId: null,
  selectedExampleId: null,
  selectedBibKey: null,
};

describe("recently-added pin clearing (task 975)", () => {
  it("a new highlight's pin holds while selected, clears once selection moves", () => {
    const pinned = { highlight: "h1" };
    expect(driftedRecentlyAddedKinds(pinned, { ...none, selectedNoteId: "h1" })).toEqual([]);
    expect(driftedRecentlyAddedKinds(pinned, { ...none, selectedNoteId: "n2" })).toEqual([
      "highlight",
    ]);
    expect(driftedRecentlyAddedKinds(pinned, none)).toEqual(["highlight"]);
  });

  it("after the highlight pin clears, a following new note's pin is the one that holds", () => {
    // highlight h1 was pinned, then the user created note n2 (selected).
    const pinned = { highlight: "h1", note: "n2" };
    const drifted = driftedRecentlyAddedKinds(pinned, { ...none, selectedNoteId: "n2" });
    expect(drifted).toEqual(["highlight"]);
  });

  it("archive pins clear on selection drift too", () => {
    expect(
      driftedRecentlyAddedKinds({ archive: "a1" }, { ...none, selectedArchiveId: "a2" }),
    ).toEqual(["archive"]);
  });

  it("every finishCreate call selects through the slot its pin bucket clears on", () => {
    const src = readFileSync(
      join(__dirname, "../card-actions/card-creation.ts"),
      "utf8",
    );
    const calls = [
      ...src.matchAll(/finishCreate\(\s*"[^"]+",\s*"(\w+)",\s*setSelected(\w+),/g),
    ];
    expect(calls.length).toBeGreaterThanOrEqual(9);
    const buckets = new Set<string>();
    for (const [, bucket, rest] of calls) {
      buckets.add(bucket);
      expect(
        RECENTLY_ADDED_SELECTION_SLOT[bucket as keyof typeof RECENTLY_ADDED_SELECTION_SLOT],
        `finishCreate pins "${bucket}" but selects via setSelected${rest}`,
      ).toBe(`selected${rest}`);
    }
    // Every bucket the table declares is actually pinned somewhere.
    expect([...buckets].sort()).toEqual(Object.keys(RECENTLY_ADDED_SELECTION_SLOT).sort());
  });
});
