// @vitest-environment jsdom
//
// SR-F1-03 (matched-span clamp) + SR-F1-05 (skip-level breadcrumb ancestry).
//
//   • SR-F1-03: the matched run rendered inside the amber <mark> was unclamped,
//     so a multi-thousand-char pasted query blew out the result card. `clampMark`
//     caps the span (with an ellipsis) at the render sink — covering EVERY
//     scope's match uniformly. Short matches pass through verbatim.
//   • SR-F1-05: the breadcrumb popped ancestors by the running STACK LENGTH
//     (`stack.length >= level`), so with skipped heading levels (H1 → H4) a
//     second H4 sibling APPENDED under the first (`[H1, H4, H4]`) instead of
//     replacing it. `foldHeadingAncestry` pops by each ancestor's STORED level,
//     keeping the true ancestor chain.
//
// SearchPanel transitively pulls `@/lib/storage` (via panel-primitives) — stub
// it; these are pure functions that never touch a sidecar or the editor.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  const names = [
    "isDevStorage", "readSidecar", "readSidecarIfExists", "writeSidecar",
    "readTex", "writeTex", "readDocBundle", "writeDocBundle", "readBib",
    "writeBib", "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  return Object.fromEntries(names.map((n) => [n, noop]));
});

import { clampMark, foldHeadingAncestry } from "@/panels/Search/SearchPanel";

describe("SR-F1-03 — clampMark caps the matched <mark> span", () => {
  it("returns a short match verbatim (no clamp, no ellipsis)", () => {
    const short = "the quick brown fox";
    expect(clampMark(short)).toBe(short);
    expect(clampMark(short)).not.toContain("…");
  });

  it("truncates a multi-thousand-char match and appends an ellipsis", () => {
    const huge = "z".repeat(5000);
    const out = clampMark(huge);
    expect(out.endsWith("…")).toBe(true);
    // The render no longer dumps the whole match — it is bounded.
    expect(out.length).toBeLessThan(huge.length);
    expect(out.length).toBeLessThan(200);
  });

  it("a match exactly at the cap is NOT ellipsized", () => {
    // MARK_MAX = CTX(40) * 3 = 120.
    const atCap = "w".repeat(120);
    expect(clampMark(atCap)).toBe(atCap);
    expect(clampMark(atCap)).not.toContain("…");
  });
});

describe("SR-F1-05 — foldHeadingAncestry pops by stored level, not stack length", () => {
  it("nests strictly increasing levels (the simple case)", () => {
    const crumbs = foldHeadingAncestry([
      { level: 1, text: "Chapter" },
      { level: 2, text: "Section" },
      { level: 3, text: "Subsection" },
    ]);
    expect(crumbs.map((c) => c.text)).toEqual(["Chapter", "Section", "Subsection"]);
  });

  it("REPLACES a same-level sibling instead of appending under it", () => {
    const crumbs = foldHeadingAncestry([
      { level: 1, text: "H1" },
      { level: 2, text: "First section" },
      { level: 2, text: "Second section" },
    ]);
    // The second H2 is a SIBLING of the first → it replaces it.
    expect(crumbs.map((c) => c.text)).toEqual(["H1", "Second section"]);
  });

  it("handles skipped levels: a second skip-level sibling replaces the first (the bug)", () => {
    // H1 then H4 (skip H2/H3), then another H4. The old `stack.length >= level`
    // test (2 >= 4 false) appended → [H1, H4a, H4b]. Level-aware popping yields
    // the correct ancestry [H1, H4b].
    const crumbs = foldHeadingAncestry([
      { level: 1, text: "H1" },
      { level: 4, text: "H4-a" },
      { level: 4, text: "H4-b" },
    ]);
    expect(crumbs.map((c) => c.text)).toEqual(["H1", "H4-b"]);
  });

  it("a shallower heading pops every deeper ancestor", () => {
    const crumbs = foldHeadingAncestry([
      { level: 1, text: "A" },
      { level: 3, text: "B" },
      { level: 2, text: "C" }, // shallower than B → pops B, replaces nothing above A
    ]);
    expect(crumbs.map((c) => c.text)).toEqual(["A", "C"]);
  });

  it("stamps the stored level on each section segment", () => {
    const crumbs = foldHeadingAncestry([
      { level: 1, text: "A" },
      { level: 4, text: "B" },
    ]);
    expect(crumbs).toEqual([
      { text: "A", kind: "section", level: 1 },
      { text: "B", kind: "section", level: 4 },
    ]);
  });
});
