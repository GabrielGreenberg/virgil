// @vitest-environment jsdom
//
// Chip A fold (#42) — `compressedBodyStyle` is the SSOT for the collapsed-card
// line clamp. The #42 fix made borrowed-body kinds (footnote/archive/example)
// pass a `var(--editor-line-height, …)` lineHeight so the maxHeight ceiling
// tracks the SAME unit-less factor the preview <p> renders at (instead of a
// literal that would drift from the prose pref and clip line 2). This pins:
//
//   • the BORROWED call emits a var-based maxHeight (a `calc(var(...) …)`) and
//     a var lineHeight — the ceiling rides the live `--editor-line-height`;
//   • the var FALLBACK is 1.8 (FOLD 2) so it matches the `.tiptap p` fallback
//     (globals.css:657) — an undefined var can't clamp tighter than the line;
//   • the DEFAULT (plain-summary) call keeps the literal 1.4-based ceiling.
//
// `panel-primitives.tsx` transitively imports `@/lib/storage` (the known
// barrel/storage gotcha) — stub it wholesale; nothing here calls a storage fn.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
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
  const mod: Record<string, unknown> = {};
  for (const name of STORAGE_FNS) mod[name] = name === "isDevStorage" ? false : vi.fn();
  return mod;
});

import { compressedBodyStyle, makeCompressedSummary } from "@/components/panel-primitives";

function docOf(text: string) {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }],
  };
}

describe("compressedBodyStyle — borrowed var ceiling (#42 / FOLD 2)", () => {
  it("the BORROWED call emits a var-based maxHeight + var lineHeight", () => {
    // The exact fallback Chip A passes after FOLD 2: the `.tiptap p` fallback.
    const style = compressedBodyStyle(2, {
      lineHeight: "var(--editor-line-height, 1.8)",
    });
    // lineHeight rides the live var (so the rendered text + clamp agree).
    expect(style.lineHeight).toBe("var(--editor-line-height, 1.8)");
    // The ceiling is a calc over the SAME var × 1em × N — NOT a literal factor.
    expect(style.maxHeight).toBe(
      "calc(var(--editor-line-height, 1.8) * 1em * 2)",
    );
    // The var is what tracks the prose pref; a literal would drift (#42).
    expect(String(style.maxHeight)).toContain("var(--editor-line-height");
    // FOLD 2 alignment: the fallback equals the `.tiptap p` fallback (1.8,
    // globals.css:657), never 1.6 (which would clamp tighter than the line).
    expect(String(style.maxHeight)).toContain("1.8");
    expect(String(style.maxHeight)).not.toContain("1.6");
  });

  it("the DEFAULT call (no opts) emits the literal 1.4-based ceiling", () => {
    const style = compressedBodyStyle(2);
    // Plain-summary kinds keep the unit-less 1.4 factor (no var).
    expect(style.lineHeight).toBe(1.4);
    expect(style.maxHeight).toBe("calc(1.4 * 1em * 2)");
    expect(String(style.maxHeight)).not.toContain("var(");
  });

  it("clamps lines to a floor of 1", () => {
    // Guards the `Math.max(1, lines)` floor the ceiling math depends on.
    expect(compressedBodyStyle(0).maxHeight).toBe("calc(1.4 * 1em * 1)");
    expect(compressedBodyStyle(-3).maxHeight).toBe("calc(1.4 * 1em * 1)");
  });
});

describe("makeCompressedSummary — ellipsis on truncation (C24 / OMNI-F1-03)", () => {
  it("returns a short body verbatim with NO ellipsis", () => {
    const short = "a quick summary";
    expect(makeCompressedSummary(docOf(short), 1)).toBe(short);
    expect(makeCompressedSummary(docOf(short), 1)).not.toContain("…");
  });

  it("appends an ellipsis when the projected text exceeds the 80×lines cap", () => {
    // 200 chars > 80×1 → truncated; the old `.slice` cut mid-word with no cue.
    const long = "x".repeat(200);
    const out = makeCompressedSummary(docOf(long), 1);
    expect(out.endsWith("…")).toBe(true);
    // Body (sans ellipsis) is clamped to the limit; the "…" is the only extra.
    expect(out.length).toBe(81); // 80 chars + the ellipsis glyph
  });

  it("scales the cap with the line count and still ellipsizes", () => {
    const long = "y".repeat(300);
    const out2 = makeCompressedSummary(docOf(long), 2); // cap 160
    expect(out2.endsWith("…")).toBe(true);
    expect(out2.length).toBe(161);
  });

  it("returns '' (falsy) for an empty body so the `||` sentinel can fire", () => {
    // The empty-sentinel fix relies on an empty body projecting to a falsy ''
    // (NOT undefined) so `compressedSummary || <CardEmptyText/>` substitutes.
    expect(makeCompressedSummary(docOf(""), 1)).toBe("");
  });
});
