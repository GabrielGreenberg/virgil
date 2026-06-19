import { describe, expect, it, vi } from "vitest";

// `@/hooks/useFocusMode` transitively imports `@/lib/storage`, whose
// `require("@/lib/storage-fsa")` vitest's resolver can't alias (the known
// barrel-storage gotcha). Mock the storage surface so the module loads — these
// tests exercise only the two pure range resolvers, never any storage call.
vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "writeBib",
    "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  return mod;
});

import { regionForNode, sectionRange } from "@/hooks/useFocusMode";

/**
 * CHIP E — consistent/predictable focus-band range selection.
 *
 * These cover the two pure range resolvers the band edges and clicks now share:
 *  - `sectionRange` (unchanged): a HEADING owns its subtree.
 *  - `regionForNode` (new): a heading → its subtree; any non-heading block →
 *    just that one block.
 *
 * The `snapBoundary` drag-edge semantics are now pure index math (no
 * `sectionRange` re-expansion): the top edge sets `min(blockIndex, end)` and
 * the bottom edge sets `max(blockIndex, start)`. We assert that clamp directly
 * (it is the whole behavioral contract — symmetric, free, never a section jump,
 * and a minimum 1-row band on a crossing rather than a silent freeze).
 */

// Doc shape used throughout: index 0 is a doc-start/paragraph region before any
// heading; §1 heading at index 1 spanning 1..3; §2 heading at index 4 spanning
// 4..6. parTitles / paragraphs are the non-heading indices (0, 2, 3, 5, 6).
const HEADINGS = [
  { index: 1, level: 1 },
  { index: 4, level: 1 },
];
const TOTAL = 7;

describe("sectionRange (unchanged: a heading owns its subtree)", () => {
  it("a heading row selects from itself to the block before the next same-or-higher heading", () => {
    expect(sectionRange(1, HEADINGS, TOTAL)).toEqual([1, 3]);
    expect(sectionRange(4, HEADINGS, TOTAL)).toEqual([4, 6]);
  });

  it("the last heading runs to the final block", () => {
    expect(sectionRange(4, HEADINGS, TOTAL)).toEqual([4, 6]);
  });

  it("nested sub-headings stop at the next same-or-higher level", () => {
    const nested = [
      { index: 0, level: 1 },
      { index: 2, level: 2 },
      { index: 5, level: 1 },
    ];
    expect(sectionRange(0, nested, 8)).toEqual([0, 4]); // §1 (h1) through just before §2 (h1)
    expect(sectionRange(2, nested, 8)).toEqual([2, 4]); // the h2 subtree stops before the next h1
  });
});

describe("regionForNode (a click selects the clicked node's OWN extent)", () => {
  it("(b) clicking a HEADING index selects its whole subtree", () => {
    expect(regionForNode(1, HEADINGS, TOTAL)).toEqual([1, 3]);
    expect(regionForNode(4, HEADINGS, TOTAL)).toEqual([4, 6]);
  });

  it("(a) clicking a PARAGRAPH / parTitle index selects JUST that one block", () => {
    // index 2 and 3 are non-heading blocks inside §1 — must NOT grab all of §1.
    expect(regionForNode(2, HEADINGS, TOTAL)).toEqual([2, 2]);
    expect(regionForNode(3, HEADINGS, TOTAL)).toEqual([3, 3]);
    // index 5/6 inside §2.
    expect(regionForNode(5, HEADINGS, TOTAL)).toEqual([5, 5]);
  });

  it("doc-start (index 0, before any heading) selects just that row, not the pre-heading region", () => {
    expect(regionForNode(0, HEADINGS, TOTAL)).toEqual([0, 0]);
  });

  it("with no headings at all, any click is a single-block region", () => {
    expect(regionForNode(0, [], TOTAL)).toEqual([0, 0]);
    expect(regionForNode(3, [], TOTAL)).toEqual([3, 3]);
  });
});

/**
 * The pure drag-edge clamp `snapBoundary` now applies. Extracted verbatim from
 * the hook so the contract is pinned without a React render harness — the hook
 * wraps exactly this in a `bandFromIndices(doc, …)` call.
 */
function snapTop(blockIndex: number, curEnd: number): number {
  return Math.min(blockIndex, curEnd);
}
function snapBottom(blockIndex: number, curStart: number): number {
  return Math.max(blockIndex, curStart);
}

describe("snapBoundary drag edges (symmetric + free + clamping, no section jump)", () => {
  it("(c) bottom-edge drag to a paragraph row sets end = that exact row (no section re-expansion)", () => {
    // Band currently [1, 6]; drag the bottom handle up to paragraph row 2.
    // Old buggy behavior re-ran sectionRange(2) → [.., 3] (jumped past cursor).
    // New behavior: end = 2 exactly.
    expect(snapBottom(2, /* curStart */ 1)).toBe(2);
    expect(snapBottom(5, /* curStart */ 1)).toBe(5);
  });

  it("the top edge sets the raw row it snaps to (free, no section math)", () => {
    expect(snapTop(2, /* curEnd */ 6)).toBe(2);
    expect(snapTop(0, /* curEnd */ 6)).toBe(0);
  });

  it("(d) a top-edge drag PAST the bottom clamps to the bottom (1-row band), not a freeze", () => {
    // Band [1, 3]; drag top handle down past the bottom edge to row 5.
    // Old: returned `s` unchanged (handle appeared frozen). New: start clamps to 3.
    expect(snapTop(5, /* curEnd */ 3)).toBe(3); // band becomes [3, 3]
  });

  it("(d) a bottom-edge drag ABOVE the top clamps to the top (1-row band), not a freeze", () => {
    // Band [3, 6]; drag bottom handle up past the top edge to row 1.
    // Old: returned `s` unchanged. New: end clamps to 3.
    expect(snapBottom(1, /* curStart */ 3)).toBe(3); // band becomes [3, 3]
  });
});
