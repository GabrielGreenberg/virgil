// @vitest-environment jsdom
//
// L3f-7 — writeBackToMain multi-block write-back artifact.
//
// Editing a popped-out linkedRange float that spans >=2 top-level blocks (esp.
// one touching a list) and writing back left a structural artifact in the main
// doc — an extra wrapping list / split boundary paragraphs. This is the
// deterministic reproduction + the fix's round-trip law, against the REAL float
// schema (the same `getSchema(buildEditorExtensions({surface:"float"}))` the
// popout uses), so the cause is PROVEN, not inferred.
//
// THE ORACLE. `tr.docChanged` (steps.length > 0) is NOT a reliable "did the doc
// structurally change" signal: `tr.replace` over a non-empty range ALWAYS
// records a step, even when the result is byte-identical. The robust oracle is
// byte-identical doc equality (`tr.doc.eq(doc)`). An UNEDITED multi-block
// round-trip through write-back must be a structural NO-OP under that oracle.
//
//   - Pre-fix write-back (`tr.replaceWith(from,to, blocks)`, a CLOSED Slice
//     openStart=openEnd=0) MANGLES: it splits the boundary paragraphs and, at a
//     list boundary, wraps an extra list — `tr.doc.eq(doc)` is false.
//   - Post-fix write-back (`tr.replace(from,to, blocksToRangeSlice(...))`,
//     reusing the cut's open depths) is byte-identical when unedited and lands
//     exactly the edit otherwise.

import { describe, it, expect, vi } from "vitest";

// The extension barrel transitively imports `@/lib/storage`; stub it (we never
// CALL storage here) — same pattern as linked-range-popout-fidelity.test.ts.
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

import { getSchema, type JSONContent } from "@tiptap/core";
import { Fragment, Node as PMNode, Slice } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  blocksToRangeSlice,
  findLinkedAnchorRange,
  rangeSliceToBlocks,
} from "@/lib/linked-anchor-range";

function floatCtx(): EditorExtensionsCtx {
  return {
    surface: "float",
    editable: true,
    cardContext: true,
    callbacks: {},
    docIdRef: null,
    host: { getMainEditor: () => null },
  };
}

const schema = getSchema(buildEditorExtensions(floatCtx()));

const A = "wb1";
const mk = () => ({ type: "linkedAnchor", attrs: { anchorId: A, kind: "transient" } });
const text = (t: string, marked = false): JSONContent =>
  marked ? { type: "text", text: t, marks: [mk()] } : { type: "text", text: t };
const para = (...content: JSONContent[]): JSONContent => ({ type: "paragraph", content });
const li = (...content: JSONContent[]): JSONContent => ({ type: "listItem", content });
const ul = (...items: JSONContent[]): JSONContent => ({ type: "bulletList", content: items });
const makeDoc = (...content: JSONContent[]): PMNode =>
  PMNode.fromJSON(schema, { type: "doc", content });

/** The artifact-triggering shape: a range starting mid-paragraph-1, through a
 *  list, ending mid-paragraph-3. "WORLD"/"item"/"END" carry the linkedAnchor. */
function canonicalDoc(): PMNode {
  return makeDoc(
    para(text("Hello "), text("WORLD", true)),
    ul(li(para(text("item", true)))),
    para(text("END", true), text(" here")),
  );
}

function childTypes(node: PMNode): string[] {
  const out: string[] = [];
  node.forEach((c) => out.push(c.type.name));
  return out;
}
function countType(node: PMNode, name: string): number {
  let n = 0;
  node.descendants((d) => {
    if (d.type.name === name) n++;
    return true;
  });
  return n;
}
function paraTexts(node: PMNode): string[] {
  const out: string[] = [];
  node.descendants((d) => {
    if (d.type.name === "paragraph") out.push(d.textContent);
    return true;
  });
  return out;
}
/** Faithful to the float: blocks -> toJSON -> fromJSON (what writeBackToMain
 *  reconstructs from `floatEditor.getJSON()`), then optionally edited via a
 *  JSON transform so the round-trip carries the user's edit. */
function seedAsFloatBlocks(
  doc: PMNode,
  from: number,
  to: number,
  editJson: (j: JSONContent) => JSONContent = (j) => j,
): PMNode[] {
  return rangeSliceToBlocks(doc.slice(from, to), schema).map((b) =>
    PMNode.fromJSON(schema, editJson(b.toJSON() as JSONContent)),
  );
}
/** Recursively rewrite the first text node whose text === `oldText`. */
function editText(oldText: string, newText: string) {
  const walk = (j: JSONContent): JSONContent => {
    if (j.type === "text" && j.text === oldText) return { ...j, text: newText };
    if (Array.isArray(j.content)) return { ...j, content: j.content.map(walk) };
    return j;
  };
  return walk;
}

// ── The bug: closed-block replaceWith mangles a text-bounded multi-block range ─

describe("L3f-7 bug — closed-block replaceWith over a text-bounded range", () => {
  it("UNEDITED multi-block round-trip via replaceWith is NOT a no-op (splits the boundary paragraphs)", () => {
    const doc = canonicalDoc();
    const range = findLinkedAnchorRange(doc, A)!;
    const seedBlocks = seedAsFloatBlocks(doc, range.from, range.to);
    const tr = EditorState.create({ schema, doc }).tr.replaceWith(
      range.from,
      range.to,
      seedBlocks,
    );
    // The proven pre-fix failure: 3 blocks -> 5 (Hello | WORLD … END | here).
    expect(tr.doc.eq(doc)).toBe(false);
    expect(tr.doc.childCount).toBe(5);
    expect(childTypes(tr.doc)).toEqual([
      "paragraph", "paragraph", "bulletList", "paragraph", "paragraph",
    ]);
  });

  it("UNEDITED round-trip via replaceWith at a LIST boundary wraps an EXTRA list", () => {
    // Range starts mid-paragraph-1 and ends INSIDE the first list item.
    const doc = makeDoc(
      para(text("Hello "), text("WORLD", true)),
      ul(
        li(para(text("alpha ONE", true))),
        li(para(text("beta"))),
      ),
    );
    const range = findLinkedAnchorRange(doc, A)!;
    const seedBlocks = seedAsFloatBlocks(doc, range.from, range.to);
    const tr = EditorState.create({ schema, doc }).tr.replaceWith(
      range.from,
      range.to,
      seedBlocks,
    );
    expect(countType(doc, "bulletList")).toBe(1);
    expect(countType(tr.doc, "bulletList")).toBe(2); // the artifact: extra list
    expect(tr.doc.eq(doc)).toBe(false);
  });
});

// ── The fix: blocksToRangeSlice (the named inverse of rangeSliceToBlocks) ──────

describe("L3f-7 fix — blocksToRangeSlice (inverse of rangeSliceToBlocks)", () => {
  it("LAW: rebuilds the exact open cut for an unedited multi-block range", () => {
    const doc = canonicalDoc();
    const range = findLinkedAnchorRange(doc, A)!;
    const cut = doc.slice(range.from, range.to);
    const seedBlocks = seedAsFloatBlocks(doc, range.from, range.to);
    const slice = blocksToRangeSlice(doc, range, seedBlocks);
    // Open depths reused (mid-block cut), and the slice is the same as the cut.
    expect(slice.openStart).toBe(cut.openStart);
    expect(slice.openEnd).toBe(cut.openEnd);
    expect(slice.openStart).toBe(1);
    expect(slice.eq(cut)).toBe(true);
  });

  it("UNEDITED multi-block round-trip via the helper is byte-identical (the acceptance oracle)", () => {
    const doc = canonicalDoc();
    const range = findLinkedAnchorRange(doc, A)!;
    const seedBlocks = seedAsFloatBlocks(doc, range.from, range.to);
    const slice = blocksToRangeSlice(doc, range, seedBlocks);
    const tr = EditorState.create({ schema, doc }).tr.replace(range.from, range.to, slice);
    expect(tr.doc.eq(doc)).toBe(true); // structural no-op (docChanged is true, but irrelevant)
    expect(tr.doc.childCount).toBe(3);
  });

  it("EDITED multi-block round-trip lands exactly the edit — no extra list, boundaries intact", () => {
    const doc = canonicalDoc();
    const range = findLinkedAnchorRange(doc, A)!;
    // Edit the list item's text in the float's blocks: "item" -> "ITEM!".
    const editedBlocks = seedAsFloatBlocks(doc, range.from, range.to, editText("item", "ITEM!"));
    const slice = blocksToRangeSlice(doc, range, editedBlocks);
    const tr = EditorState.create({ schema, doc }).tr.replace(range.from, range.to, slice);
    const result = tr.doc;
    // Structure preserved: 3 blocks, one list, boundary paragraphs merged back.
    expect(result.childCount).toBe(3);
    expect(childTypes(result)).toEqual(["paragraph", "bulletList", "paragraph"]);
    expect(countType(result, "bulletList")).toBe(1); // NO extra wrapping list
    expect(paraTexts(result)).toEqual(["Hello WORLD", "ITEM!", "END here"]);
  });

  it("EDITED boundary block merges the edit into the host paragraph (no split)", () => {
    const doc = canonicalDoc();
    const range = findLinkedAnchorRange(doc, A)!;
    // Edit the FIRST (boundary-open) block: "WORLD" -> "WORLDX".
    const editedBlocks = seedAsFloatBlocks(doc, range.from, range.to, editText("WORLD", "WORLDX"));
    const slice = blocksToRangeSlice(doc, range, editedBlocks);
    const tr = EditorState.create({ schema, doc }).tr.replace(range.from, range.to, slice);
    expect(tr.doc.childCount).toBe(3);
    expect(paraTexts(tr.doc)).toEqual(["Hello WORLDX", "item", "END here"]);
  });

  it("LIST-boundary round-trip via the helper keeps a single list (artifact gone)", () => {
    const doc = makeDoc(
      para(text("Hello "), text("WORLD", true)),
      ul(
        li(para(text("alpha ONE", true))),
        li(para(text("beta"))),
      ),
    );
    const range = findLinkedAnchorRange(doc, A)!;
    const seedBlocks = seedAsFloatBlocks(doc, range.from, range.to);
    const slice = blocksToRangeSlice(doc, range, seedBlocks);
    const tr = EditorState.create({ schema, doc }).tr.replace(range.from, range.to, slice);
    expect(tr.doc.eq(doc)).toBe(true); // byte-identical — no extra list
    expect(countType(tr.doc, "bulletList")).toBe(1);
  });

  it("INLINE (within-one-paragraph) range: unwraps the single paragraph — no-op when unedited", () => {
    // "Hello WORLD!" with only "WORLD" marked → an inline cut (openStart=openEnd=0).
    const doc = makeDoc(para(text("Hello "), text("WORLD", true), text("!")));
    const range = findLinkedAnchorRange(doc, A)!;
    const cut = doc.slice(range.from, range.to);
    expect(cut.openStart).toBe(0); // inline cut
    const seedBlocks = seedAsFloatBlocks(doc, range.from, range.to);
    expect(seedBlocks.map((b) => b.type.name)).toEqual(["paragraph"]); // forward wrapped it
    const slice = blocksToRangeSlice(doc, range, seedBlocks);
    expect(slice.openStart).toBe(0); // inverse unwrapped it back to bare inline
    expect(slice.openEnd).toBe(0);
    const tr = EditorState.create({ schema, doc }).tr.replace(range.from, range.to, slice);
    expect(tr.doc.eq(doc)).toBe(true);
    expect(tr.doc.childCount).toBe(1);
  });

  it("ROBUST: a restructured edit (trailing paragraph after a list) never throws / drops the write-back", () => {
    // Range starts mid-paragraph-1 and ends INSIDE the first list item → openEnd 3.
    const doc = makeDoc(
      para(text("Hello "), text("WORLD", true)),
      ul(li(para(text("alpha ONE", true))), li(para(text("beta")))),
    );
    const range = findLinkedAnchorRange(doc, A)!;
    const cut = doc.slice(range.from, range.to);
    expect(cut.openEnd).toBe(3); // the cut expects a list openable 3 deep at its tail
    // Simulate a float edit that APPENDS a trailing paragraph after the list, so
    // the last block is now a paragraph (cannot open to depth 3).
    const editedBlocks = [
      PMNode.fromJSON(schema, para(text("WORLD", true))),
      PMNode.fromJSON(schema, ul(li(para(text("alpha ONE", true))))),
      PMNode.fromJSON(schema, para(text("appended"))),
    ];
    // The NAIVE inverse (reuse the cut's open depths unclamped) builds a
    // malformed Slice → tr.replace THROWS (which writeBackToMain's try/catch
    // would swallow, silently losing the edit).
    expect(() => {
      const bad = new Slice(Fragment.from(editedBlocks), cut.openStart, cut.openEnd);
      EditorState.create({ schema, doc }).tr.replace(range.from, range.to, bad);
    }).toThrow();
    // The helper clamps the depths to what the blocks support → no throw, and
    // the appended edit is preserved (not dropped).
    const slice = blocksToRangeSlice(doc, range, editedBlocks);
    let result: PMNode | null = null;
    expect(() => {
      result = EditorState.create({ schema, doc }).tr.replace(range.from, range.to, slice).doc;
    }).not.toThrow();
    // The robustness guarantee for a genuinely-restructured edit is: no throw,
    // no lost edit (the appended text survives). The exact block layout of a
    // user-restructured range is intentionally not asserted.
    expect(result!.textContent).toContain("appended");
    expect(result!.textContent).toContain("Hello WORLD"); // leading boundary intact
  });

  it("INLINE range edited: lands the edit in one paragraph, no split", () => {
    const doc = makeDoc(para(text("Hello "), text("WORLD", true), text("!")));
    const range = findLinkedAnchorRange(doc, A)!;
    const editedBlocks = seedAsFloatBlocks(doc, range.from, range.to, editText("WORLD", "WORLDX"));
    const slice = blocksToRangeSlice(doc, range, editedBlocks);
    const tr = EditorState.create({ schema, doc }).tr.replace(range.from, range.to, slice);
    expect(tr.doc.childCount).toBe(1);
    expect(paraTexts(tr.doc)).toEqual(["Hello WORLDX!"]);
  });
});
