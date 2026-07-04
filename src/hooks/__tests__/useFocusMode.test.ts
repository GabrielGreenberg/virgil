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
 * The `snapBoundary` drag edges are now SECTION-AWARE + edge-asymmetric (bug
 * sweep #7): the snapped row is resolved through `regionForNode`, the TOP edge
 * taking the region START and the BOTTOM edge the region END. So a bottom drag
 * onto a section HEADING confines to the whole section (ending at its last body
 * block) instead of stopping at the bare header row; a non-heading row still
 * resolves to itself. We assert the extracted clamp directly (the whole
 * behavioral contract — section-aware, edge-asymmetric, and a 1-row minimum on a
 * crossing rather than a silent freeze).
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
 * The drag-edge clamp `snapBoundary` now applies, extracted verbatim from the
 * hook so the contract is pinned without a React render harness — the hook wraps
 * exactly this `regionForNode`-resolved clamp in a `bandFromIndices(doc, …)` call.
 */
function snapTop(
  blockIndex: number,
  curEnd: number,
  headings = HEADINGS,
  total = TOTAL,
): number {
  return Math.min(regionForNode(blockIndex, headings, total)[0], curEnd);
}
function snapBottom(
  blockIndex: number,
  curStart: number,
  headings = HEADINGS,
  total = TOTAL,
): number {
  return Math.max(regionForNode(blockIndex, headings, total)[1], curStart);
}

/**
 * `activate` seed resolution (task 2026-07-03-027): enabling focus mode seeds
 * the CURRENT section, not `headings[0]`. Extracted verbatim from the hook's
 * `activate` branch (the hook wraps exactly this in `bandFromIndices(doc, …)`).
 * The seed is threaded from the live section-path:
 * `currentSectionPath.at(-1)?.index ?? currentParTitleIndex`, hence the
 * `number | null | undefined` shape and the `< 0` guard.
 */
function activateRange(
  headings: { index: number; level: number }[],
  total: number,
  seedBlockIndex?: number | null,
): [number, number] {
  if (headings.length === 0) return [0, total - 1];
  const seed =
    seedBlockIndex != null && seedBlockIndex >= 0 ? seedBlockIndex : headings[0].index;
  return sectionRange(seed, headings, total);
}

describe("activate seed resolution (seed the CURRENT section, not the first)", () => {
  it("no seed (null / undefined / negative) falls back to the FIRST section", () => {
    expect(activateRange(HEADINGS, TOTAL)).toEqual([1, 3]);
    expect(activateRange(HEADINGS, TOTAL, null)).toEqual([1, 3]);
    expect(activateRange(HEADINGS, TOTAL, -1)).toEqual([1, 3]);
  });

  it("a current-section HEADING seed scopes that section, not headings[0]", () => {
    // Caret in §2: section-path innermost = heading index 4 → §2, NOT §1.
    expect(activateRange(HEADINGS, TOTAL, 4)).toEqual([4, 6]);
  });

  it("a mid-section PARAGRAPH seed scopes the ENCLOSING section (not the bare block)", () => {
    // Non-heading blocks inside §1 (2,3) and §2 (5,6) → their whole section.
    expect(activateRange(HEADINGS, TOTAL, 2)).toEqual([1, 3]);
    expect(activateRange(HEADINGS, TOTAL, 3)).toEqual([1, 3]);
    expect(activateRange(HEADINGS, TOTAL, 5)).toEqual([4, 6]);
  });

  it("a doc-start par-title seed scopes the whole pre-heading region", () => {
    // §1 heading at index 2; index-0/1 par-titles sit before it → region [0,1].
    const heads = [{ index: 2, level: 1 }, { index: 5, level: 1 }];
    expect(activateRange(heads, 8, 0)).toEqual([0, 1]);
    expect(activateRange(heads, 8, 1)).toEqual([0, 1]);
  });

  it("with no headings, any seed scopes the whole doc", () => {
    expect(activateRange([], TOTAL, 3)).toEqual([0, TOTAL - 1]);
    expect(activateRange([], TOTAL)).toEqual([0, TOTAL - 1]);
  });
});

describe("snapBoundary drag edges (section-aware + edge-asymmetric + clamping)", () => {
  it("(c) bottom-edge drag to a paragraph row sets end = that exact row (precision kept)", () => {
    // Band currently [1, 6]; drag the bottom handle up to paragraph row 2 / 5.
    // Non-heading rows resolve to themselves, so end = the exact row.
    expect(snapBottom(2, /* curStart */ 1)).toBe(2);
    expect(snapBottom(5, /* curStart */ 1)).toBe(5);
  });

  it("(FIX) bottom-edge drag onto a HEADING extends to the section's END, not the header", () => {
    // The reported bug: dragging the bottom edge onto §2 (heading index 4) used
    // to stop at row 4 (header only). Now it ends at the section's last body
    // block (regionForNode(4) = [4, 6] → end 6).
    expect(snapBottom(4, /* curStart */ 0)).toBe(6);
    // §1 heading (index 1) spans 1..3 → bottom drag onto it ends at 3.
    expect(snapBottom(1, /* curStart */ 0)).toBe(3);
  });

  it("the top edge takes the snapped row's region START (heading → the heading row itself)", () => {
    expect(snapTop(2, /* curEnd */ 6)).toBe(2); // paragraph → itself
    expect(snapTop(0, /* curEnd */ 6)).toBe(0);
    expect(snapTop(4, /* curEnd */ 6)).toBe(4); // heading §2 → starts AT the header
  });

  it("(d) a top-edge drag PAST the bottom clamps to the bottom (1-row band), not a freeze", () => {
    // Band [1, 3]; drag top handle down past the bottom edge to paragraph row 5.
    expect(snapTop(5, /* curEnd */ 3)).toBe(3); // band becomes [3, 3]
  });

  it("(d) a bottom-edge drag ABOVE the top clamps to the top (1-row band), not a freeze", () => {
    // Band [3, 6]; drag bottom handle up past the top edge to paragraph row 2.
    expect(snapBottom(2, /* curStart */ 3)).toBe(3); // band becomes [3, 3]
  });
});
