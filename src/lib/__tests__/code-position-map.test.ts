/**
 * Unit tests for the cached UUID↔source position map
 * (`src/lib/code-position-map.ts`).
 *
 * The module's functions only ever read `view.state.doc` (an immutable
 * CodeMirror `Text`) and `view.state.selection`. We build a real
 * `EditorState` via `@codemirror/state` — giving a genuine `Text` doc
 * with `.line(n)`, `.lineAt(pos)`, `.lines`, `.toString()` — and cast it
 * to the `EditorView` shape the functions consume. No jsdom / full
 * `EditorView` needed.
 */
import { describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import * as paragraphMap from "@/lib/latex-paragraph-map";
import {
  getRanges,
  getLineRangeForUuid,
  getUuidForLine,
  getCharRangeForUuid,
  getActiveParagraphUuid,
} from "@/lib/code-position-map";

/**
 * Build a minimal stand-in for `EditorView` backed by a real
 * `EditorState`. The cursor (`head`) defaults to the document start.
 */
function makeView(doc: string, head = 0): EditorView {
  const state = EditorState.create({ doc, selection: { anchor: head } });
  return { state } as unknown as EditorView;
}

// Two content blocks, each tagged with a `%!v:<hex>` marker. Line
// numbers (1-based):
//   1: \section{One}            ← block "aaaa" start
//   2: First paragraph body. %!v:aaaa  ← block "aaaa" end (marker)
//   3: (blank)
//   4: Second paragraph body.    ← block "bbbb" start
//   5: More of the second. %!v:bbbb    ← block "bbbb" end (marker)
const SAMPLE = [
  "\\section{One}",
  "First paragraph body. %!v:aaaa",
  "",
  "Second paragraph body.",
  "More of the second. %!v:bbbb",
].join("\n");

describe("getRanges", () => {
  it("parses the UUID line ranges from the source", () => {
    const view = makeView(SAMPLE);
    const ranges = getRanges(view);
    expect(ranges).toEqual([
      { uuid: "aaaa", startLine: 1, endLine: 2 },
      { uuid: "bbbb", startLine: 4, endLine: 5 },
    ]);
  });

  it("reuses the cache for repeated calls on the same doc (same reference)", () => {
    const view = makeView(SAMPLE);
    const spy = vi.spyOn(paragraphMap, "findParagraphUuids");
    const first = getRanges(view);
    const second = getRanges(view);
    // Identical reference proves the cached array was returned.
    expect(second).toBe(first);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("re-parses when the doc object changes (cache auto-invalidates)", () => {
    const view = makeView(SAMPLE);
    const first = getRanges(view);
    // A fresh state → fresh immutable Text → cache miss.
    const view2 = makeView(SAMPLE);
    const second = getRanges(view2);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });
});

describe("getLineRangeForUuid", () => {
  it("returns the matching range", () => {
    const view = makeView(SAMPLE);
    expect(getLineRangeForUuid(view, "bbbb")).toEqual({
      uuid: "bbbb",
      startLine: 4,
      endLine: 5,
    });
  });

  it("returns null for an unknown uuid", () => {
    const view = makeView(SAMPLE);
    expect(getLineRangeForUuid(view, "ffff")).toBeNull();
  });
});

describe("getUuidForLine", () => {
  it("maps a line inside a block to its uuid", () => {
    const view = makeView(SAMPLE);
    expect(getUuidForLine(view, 1)).toBe("aaaa");
    expect(getUuidForLine(view, 2)).toBe("aaaa");
    expect(getUuidForLine(view, 4)).toBe("bbbb");
    expect(getUuidForLine(view, 5)).toBe("bbbb");
  });

  it("returns null for a line in no block (the blank gap)", () => {
    const view = makeView(SAMPLE);
    expect(getUuidForLine(view, 3)).toBeNull();
  });
});

describe("getCharRangeForUuid", () => {
  it("converts the line range to char positions spanning the block", () => {
    const view = makeView(SAMPLE);
    const doc = view.state.doc;
    const range = getCharRangeForUuid(view, "aaaa");
    expect(range).not.toBeNull();
    expect(range).toEqual({
      from: doc.line(1).from,
      to: doc.line(2).to,
    });
    // from is the very start of the doc; to is end of line 2.
    expect(range!.from).toBe(0);
    expect(range!.to).toBe(doc.line(2).to);
  });

  it("returns null for an unknown uuid", () => {
    const view = makeView(SAMPLE);
    expect(getCharRangeForUuid(view, "ffff")).toBeNull();
  });

  it("clamps out-of-range line numbers to the valid doc range", () => {
    // A block whose endLine would exceed the (shrunken) doc lines: build
    // ranges against a long doc, then resolve against a short one is not
    // possible through getRanges (it re-parses per doc), so instead drive
    // the clamp via a stub that returns an over-large endLine.
    const view = makeView("only one line %!v:aaaa");
    const spy = vi
      .spyOn(paragraphMap, "findParagraphUuids")
      .mockReturnValue([{ uuid: "aaaa", startLine: 1, endLine: 999 }]);
    const range = getCharRangeForUuid(view, "aaaa");
    spy.mockRestore();
    const doc = view.state.doc;
    // endLine clamped to doc.lines (1).
    expect(range).toEqual({ from: doc.line(1).from, to: doc.line(1).to });
  });
});

describe("getActiveParagraphUuid", () => {
  it("returns the uuid of the block containing the cursor", () => {
    // Place the cursor on line 4 (inside block "bbbb").
    const state = EditorState.create({ doc: SAMPLE });
    const line4 = state.doc.line(4);
    const view = makeView(SAMPLE, line4.from + 2);
    expect(getActiveParagraphUuid(view)).toBe("bbbb");
  });

  it("falls back to the closest block by mid-line distance", () => {
    // Cursor on line 3 (the blank gap, in no block). Block "aaaa" mid is
    // (1+2)/2 = 1.5 (dist 1.5); block "bbbb" mid is (4+5)/2 = 4.5
    // (dist 1.5) — tie. The loop keeps the first strictly-smaller, so
    // "aaaa" wins the tie (it's first and bbbb's dist is not < it).
    const state = EditorState.create({ doc: SAMPLE });
    const line3 = state.doc.line(3);
    const view = makeView(SAMPLE, line3.from);
    expect(getActiveParagraphUuid(view)).toBe("aaaa");
  });

  it("picks the nearer block when the cursor is clearly closer to one", () => {
    // A doc with a wide gap so the fallback is unambiguous.
    const doc = [
      "Alpha block. %!v:aaaa", // line 1
      "",
      "",
      "",
      "",
      "", // lines 2-6 blank
      "Beta block. %!v:bbbb", // line 7
    ].join("\n");
    const state = EditorState.create({ doc });
    const line6 = state.doc.line(6); // closest to block bbbb (line 7)
    const view = makeView(doc, line6.from);
    expect(getActiveParagraphUuid(view)).toBe("bbbb");
  });

  it("returns null when there are no UUID blocks", () => {
    const view = makeView("plain text, no markers here");
    expect(getActiveParagraphUuid(view)).toBeNull();
  });
});
