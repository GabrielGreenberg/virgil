/**
 * Task 285 — `BlockAddress`, the vocabulary the Outline's callback boundary
 * uses to name a live top-level block across an async gap.
 *
 * The three rules the module states, each asserted against a doc that has
 * MOVED since the address was captured (which is the whole point — an address
 * that only has to work against an unchanged document is an index):
 *
 *   1. a hydrated address resolves by uuid and NEVER by its carried index;
 *   2. an unhydrated one falls back to that index, bounds-checked;
 *   3. a span's extent is derived live, never carried.
 */

import { describe, it, expect } from "vitest";
import {
  DOC_START_BLOCK_INDEX,
  resolveBlockIndex,
  resolveBlockSpan,
  sectionExtentAt,
  topLevelIndexOfUuid,
} from "@/lib/tiptap/block-address";
import { doc, heading, paragraph } from "../doc-structure/__tests__/fixtures";

/** h1 · p · p · h2(level 2) · p · h3(level 1) · p — two top-level sections. */
function sampleDoc() {
  return doc(
    heading("h-a", 1, "Alpha"),
    paragraph("p-a1", "one"),
    paragraph("p-a2", "two"),
    heading("h-b", 2, "Beta"),
    paragraph("p-b1", "three"),
    heading("h-c", 1, "Gamma"),
    paragraph("p-c1", "four"),
  );
}

/** The same doc with two blocks inserted ABOVE everything — the concurrent
 *  write (an AI apply_response, a peer window, Gabriel typing) that shifts
 *  every index the outline snapshot captured. */
function shiftedDoc() {
  return doc(
    paragraph("p-new1", "inserted"),
    paragraph("p-new2", "inserted"),
    heading("h-a", 1, "Alpha"),
    paragraph("p-a1", "one"),
    paragraph("p-a2", "two"),
    heading("h-b", 2, "Beta"),
    paragraph("p-b1", "three"),
    heading("h-c", 1, "Gamma"),
    paragraph("p-c1", "four"),
  );
}

describe("topLevelIndexOfUuid", () => {
  it("finds a live block and reports -1 for one that is gone", () => {
    const d = sampleDoc();
    expect(topLevelIndexOfUuid(d, "h-b")).toBe(3);
    expect(topLevelIndexOfUuid(d, "nope")).toBe(-1);
  });
});

describe("resolveBlockIndex — rule 1: a hydrated address resolves by uuid ONLY", () => {
  it("follows the block through a concurrent insert above it", () => {
    // The address was captured when Gamma sat at index 5. Two blocks landed
    // above it since. The pre-285 callbacks handed over the 5 and moved/scrolled
    // to whatever now sits there (Beta's body paragraph).
    expect(resolveBlockIndex(shiftedDoc(), { uuid: "h-c", index: 5 })).toBe(7);
  });

  it("REFUSES when the addressed block was deleted — never degrades to the index", () => {
    // The index would resolve happily (5 is in bounds). Answering it is the
    // mis-address this module exists to prevent: "the thing you clicked is
    // gone" must not become "so here is a different one."
    expect(resolveBlockIndex(sampleDoc(), { uuid: "deleted", index: 5 })).toBeNull();
  });
});

describe("resolveBlockIndex — rule 2: the unhydrated positional fallback", () => {
  it("uses the snapshot index when the block has no uuid yet", () => {
    expect(resolveBlockIndex(sampleDoc(), { uuid: null, index: 2 })).toBe(2);
  });

  it("refuses an out-of-bounds or non-integer index", () => {
    const d = sampleDoc();
    expect(resolveBlockIndex(d, { uuid: null, index: 7 })).toBeNull();
    expect(resolveBlockIndex(d, { uuid: null, index: -1 })).toBeNull();
    expect(resolveBlockIndex(d, { uuid: null, index: 1.5 })).toBeNull();
  });

  it("addresses the document's FIRST block positionally — the Document-start row", () => {
    // "Document start" is a positional fact, so index 0 stays correct across an
    // insert above: it names whatever is first NOW, which is what the row means.
    expect(resolveBlockIndex(shiftedDoc(), { uuid: null, index: 0 })).toBe(0);
  });
});

describe("sectionExtentAt — rule 3: the extent is derived live", () => {
  it("runs a heading to the next heading of the same or a higher level", () => {
    const d = sampleDoc();
    expect(sectionExtentAt(d, 0)).toBe(5); // Alpha owns its body + nested Beta
    expect(sectionExtentAt(d, 3)).toBe(2); // Beta (level 2) stops at Gamma
    expect(sectionExtentAt(d, 5)).toBe(2); // Gamma runs to the end of the doc
  });

  it("gives a non-heading block an extent of exactly itself", () => {
    expect(sectionExtentAt(sampleDoc(), 1)).toBe(1);
  });

  it("GROWS when a block is inserted inside the section", () => {
    // The stale `blockCount` the pod captured is wrong in a way no amount of
    // correct index addressing would catch: a write INSIDE the section changes
    // how many blocks "this section" is, and the drag means the section.
    const grown = doc(
      heading("h-a", 1, "Alpha"),
      paragraph("p-a1", "one"),
      paragraph("p-new", "inserted mid-section"),
      paragraph("p-a2", "two"),
      heading("h-c", 1, "Gamma"),
    );
    expect(sectionExtentAt(grown, 0)).toBe(4);
  });

  it("reports 0 for an out-of-range index", () => {
    expect(sectionExtentAt(sampleDoc(), 99)).toBe(0);
  });
});

describe("resolveBlockSpan", () => {
  it("resolves a heading pod to its live start AND its live extent", () => {
    // Captured as {index: 0, count: 5}; two blocks have landed above since.
    expect(resolveBlockSpan(shiftedDoc(), { uuid: "h-a", index: 0, section: true })).toEqual({
      index: 2,
      count: 5,
    });
  });

  it("resolves a parTitle pod to exactly one block", () => {
    expect(resolveBlockSpan(shiftedDoc(), { uuid: "p-a2", index: 2, section: false })).toEqual({
      index: 4,
      count: 1,
    });
  });

  it("refuses a span whose block is gone", () => {
    expect(
      resolveBlockSpan(sampleDoc(), { uuid: "deleted", index: 0, section: true }),
    ).toBeNull();
  });
});

describe("DOC_START_BLOCK_INDEX", () => {
  it("is the -1 sentinel `EditorHandle.scrollToHeading` recognises", () => {
    expect(DOC_START_BLOCK_INDEX).toBe(-1);
  });
});
