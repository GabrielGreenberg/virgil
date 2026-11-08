/**
 * Task 285 — the focus band's defect leg, which the fix's first cut did not
 * have. The three focus WRITES (`moveTo` / `expandTo` / `snapBoundary`) are the
 * member that commit called "the subtle one", and every existing suite around
 * them was blind to the conversion: `useFocusMode.test.ts` re-implements the
 * action bodies as local helpers, and the two focus-band-drag suites are
 * snapshot-internal by design (they assert the address is HANDED OVER, never
 * that it is RESOLVED against a document that moved).
 *
 * `regionForAddress` is where all three now enter, and it is pure, so this
 * drives it directly against a doc that has changed since the address was
 * captured — the only shape in which the two addressing models differ.
 *
 * The second half is the one the first cut got wrong: resolving the address
 * live was not enough while the HEADING LIST it is interpreted against still
 * came from a render-time memo. `regionForAddress` derives that list from the
 * same doc, so the legs below hold with no heading list supplied at all.
 */

import { describe, it, expect, vi } from "vitest";

// `useFocusMode` transitively imports `@/lib/storage`, whose `require("@/...")`
// backend select vitest's aliaser can't resolve (the storage-mock gotcha).
// `regionForAddress` is a pure function that touches none of it.
vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(async () => ({})),
  readSidecarIfExists: vi.fn(async () => ({})),
  writeSidecar: vi.fn(async () => undefined),
  readBib: vi.fn(async () => ({ bibText: "", detectedPackage: undefined })),
  mutateBib: vi.fn(async () => null),
}));

import { collectTitledBlocks, regionForAddress, regionForNode } from "@/hooks/useFocusMode";
import { collectTopLevelHeadings } from "@/lib/tiptap/block-address";
import { doc, heading, paragraph, testSchema } from "@/lib/tiptap/doc-structure/__tests__/fixtures";

/** A paragraph carrying a par-title — an outline row of its own. */
function titled(uuid: string, title: string, text: string) {
  return testSchema.nodes.paragraph.create({ uuid, parTitle: title }, testSchema.text(text));
}

/** Alpha [0..2] · Beta(level 2) [3..4] · Gamma [5..6]. */
function sections() {
  return doc(
    heading("h-alpha", 1, "Alpha"),
    paragraph("p-a1", "a1"),
    paragraph("p-a2", "a2"),
    heading("h-beta", 2, "Beta"),
    paragraph("p-b1", "b1"),
    heading("h-gamma", 1, "Gamma"),
    paragraph("p-c1", "c1"),
  );
}

/** The same document after a concurrent writer inserted two blocks at the top. */
function shifted() {
  return doc(
    paragraph("x-1", "intruder"),
    paragraph("x-2", "intruder"),
    heading("h-alpha", 1, "Alpha"),
    paragraph("p-a1", "a1"),
    paragraph("p-a2", "a2"),
    heading("h-beta", 2, "Beta"),
    paragraph("p-b1", "b1"),
    heading("h-gamma", 1, "Gamma"),
    paragraph("p-c1", "c1"),
  );
}

describe("regionForAddress — the focus band's live entry point", () => {
  it("confines to the section the user clicked, after a concurrent insert above", () => {
    // Captured when Gamma was block 5; two blocks landed above since. The
    // pre-285 call handed the 5 over and focused Beta's body instead.
    expect(regionForAddress(shifted(), { uuid: "h-gamma", index: 5 })).toEqual([7, 8]);
  });

  it("gives a non-heading row exactly itself, tracked through the shift", () => {
    expect(regionForAddress(shifted(), { uuid: "p-a2", index: 2 })).toEqual([4, 4]);
  });

  it("resolves a nested section to its own extent, not its parent's", () => {
    expect(regionForAddress(sections(), { uuid: "h-beta", index: 3 })).toEqual([3, 4]);
  });

  it("REFUSES an address whose block was deleted — never confines to a stand-in", () => {
    expect(regionForAddress(sections(), { uuid: "deleted", index: 3 })).toBeNull();
  });

  it("takes the Document-start row positionally, so it survives an insert above", () => {
    // `{uuid: null, index: 0}` means "whatever block is first", which after the
    // insert is the intruder — correct, and the row's stated intent. The row
    // owns the untitled blocks up to the first row (task 1530): both intruders.
    expect(regionForAddress(shifted(), { uuid: null, index: 0 })).toEqual([0, 1]);
  });

  it("gives a PAR-TITLE row its title block plus the untitled blocks under it (task 1530)", () => {
    const d = doc(
      heading("h-alpha", 1, "Alpha"),
      titled("t-1", "First", "t1"),
      paragraph("p-1", "under t1"),
      paragraph("p-2", "under t1"),
      titled("t-2", "Second", "t2"),
      paragraph("p-3", "under t2"),
      heading("h-beta", 2, "Beta"),
      paragraph("p-4", "b"),
    );
    expect(collectTitledBlocks(d)).toEqual([1, 4]);
    expect(regionForAddress(d, { uuid: "t-1", index: 1 })).toEqual([1, 3]);
    // Stops at the next row of ANY level — a sub-heading included.
    expect(regionForAddress(d, { uuid: "t-2", index: 4 })).toEqual([4, 5]);
  });

  it("refuses an unhydrated address whose index is out of bounds", () => {
    expect(regionForAddress(sections(), { uuid: null, index: 99 })).toBeNull();
  });

  it("derives the SAME region as the heading-list form, when both see one revision", () => {
    // The conversion must not have changed what a region IS — only which
    // document (and which heading list) it is computed against.
    const d = sections();
    const headings = collectTopLevelHeadings(d);
    for (const idx of [0, 1, 2, 3, 4, 5, 6]) {
      const viaList = regionForNode(idx, headings, d.childCount, collectTitledBlocks(d));
      const uuid = (d.child(idx).attrs?.uuid as string | null) ?? null;
      expect(regionForAddress(d, { uuid, index: idx })).toEqual(viaList);
    }
  });
});
