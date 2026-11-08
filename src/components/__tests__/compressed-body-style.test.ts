// @vitest-environment jsdom
//
// Chip A fold (#42) — `compressedBodyStyle` is the SSOT for the collapsed-card
// line clamp. Borrowed-body kinds (footnote/archive/example) render their
// preview at the LIVE `--editor-line-height` prose pref, so their clamp
// ceiling must ride that same var — a literal factor would drift from the
// pref and clip line 2. This pins the PRODUCTION contract:
//
//   • `BORROWED_LINE_HEIGHT` is the bare live var — no fallback (`:root`
//     always declares the token; task 1381's fallback-agreement census
//     rejects one) and no literal factor;
//   • the borrowed call emits `calc(var(--editor-line-height) * 1em * N)`;
//   • both borrowed-body callers (the PanelCard compressed body and
//     ExampleCard's grid clamp) read the shared constant, not a restated
//     spelling — so a caller that drops the var goes red here;
//   • the DEFAULT (plain-summary) call keeps the literal 1.4-based ceiling.
//
// `panel-primitives.tsx` transitively imports `@/lib/storage` (the known
// barrel/storage gotcha) — stub it wholesale; nothing here calls a storage fn.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BORROWED_LINE_HEIGHT,
  clampCeiling,
  compressedBodyStyle,
  makeCompressedSummary,
} from "@/components/panel-primitives";

function docOf(text: string) {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }],
  };
}

describe("compressedBodyStyle — borrowed var ceiling (#42)", () => {
  it("BORROWED_LINE_HEIGHT is the bare live var (no fallback, no literal)", () => {
    expect(BORROWED_LINE_HEIGHT).toBe("var(--editor-line-height)");
  });

  it("the BORROWED call emits a ceiling over the live var × 1em × N", () => {
    const style = compressedBodyStyle(2, { lineHeight: BORROWED_LINE_HEIGHT });
    // lineHeight rides the live var (so the rendered text + clamp agree).
    expect(style.lineHeight).toBe("var(--editor-line-height)");
    expect(style.maxHeight).toBe("calc(var(--editor-line-height) * 1em * 2)");
    // ExampleCard's grid clamp builds the same ceiling through the same door.
    expect(clampCeiling(BORROWED_LINE_HEIGHT, 3)).toBe(
      "calc(var(--editor-line-height) * 1em * 3)",
    );
  });

  it("both borrowed-body callers read BORROWED_LINE_HEIGHT, not a restated spelling", () => {
    const src = (rel: string) =>
      readFileSync(resolve(__dirname, "..", "..", rel), "utf8");
    const primitives = src("components/panel-primitives.tsx");
    const example = src("panels/Examples/ExampleCard.tsx");
    // The PanelCard compressed body passes the constant on the borrowed branch.
    expect(primitives).toMatch(
      /useBorrowedCompressed\s*\?\s*\{\s*lineHeight:\s*BORROWED_LINE_HEIGHT\s*\}/,
    );
    // ExampleCard's grid clamp builds its ceiling from the constant.
    expect(example).toMatch(
      /maxHeight:\s*clampCeiling\(\s*BORROWED_LINE_HEIGHT\s*,/,
    );
    // The var is spelled ONCE — in the constant's own declaration. Comments
    // aside, neither caller restates it (a restated spelling is how the old
    // fallback doctrine drifted).
    const code = (t: string) =>
      t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code(primitives).match(/var\(--editor-line-height/g)).toHaveLength(1);
    expect(code(example)).not.toContain("var(--editor-line-height");
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
