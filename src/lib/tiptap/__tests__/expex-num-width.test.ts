// @vitest-environment jsdom
/**
 * Backlog #25 — multi-digit example numbers must not wrap. The number column
 * adapts via a shared `--expex-num-width` CSS var (option c, doc-adaptive).
 *
 * Two layers under test:
 *
 *  1. The PURE derivation: `expexNumWidth` / `expexMarkerWidth` /
 *     `computeExpexWidths` — digit/marker count → ch width (or null = use the
 *     1.5em CSS default).
 *
 *  2. KEYSTROKE SANCTITY: a real Editor (observer + ExpexNumbering wired) only
 *     writes the var on a structural change that bumps the digit count. Plain
 *     typing inside an example must NOT touch the var (the appendTransaction is
 *     gated and the meta is only attached when a width string changes).
 *
 * (Storage stub: the extension barrel transitively imports `@/lib/storage`,
 * whose `require("@/lib/storage-fsa")` vitest can't resolve.)
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

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

import { Editor } from "@tiptap/core";
import { getSchema } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  expexNumWidth,
  expexMarkerWidth,
  computeExpexWidths,
  applyExpexWidthVars,
  expexWidthStyle,
} from "@/lib/tiptap/expex";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

const schema: Schema = getSchema(buildEditorExtensions(mainCtx()));

describe("expexNumWidth / expexMarkerWidth — pure derivation", () => {
  it("returns null for 1-digit numbers (keep the 1.5em default)", () => {
    expect(expexNumWidth(0)).toBeNull();
    expect(expexNumWidth(1)).toBeNull();
  });
  it("widens for 2+ digits in ch, monotonically", () => {
    expect(expexNumWidth(2)).toBe("4ch"); // (10)
    expect(expexNumWidth(3)).toBe("5ch"); // (100)
    // monotone non-decreasing
    expect(parseFloat(expexNumWidth(3)!)).toBeGreaterThan(
      parseFloat(expexNumWidth(2)!),
    );
  });
  it("marker width: null for short markers, widens for long romans", () => {
    expect(expexMarkerWidth(1)).toBeNull(); // a.
    expect(expexMarkerWidth(2)).toBeNull(); // ii.
    expect(expexMarkerWidth(3)).toBe("4.5ch"); // iii. / viii.
    expect(expexMarkerWidth(5)).toBe("6.5ch"); // xviii.
  });
});

describe("computeExpexWidths — walks a doc (or a bare exampleBlock)", () => {
  function docWithNumbers(...numbers: number[]) {
    return schema.nodeFromJSON({
      type: "doc",
      content: numbers.map((n) => ({
        type: "exampleBlock",
        attrs: { uuid: `b${n}`, kind: "single", number: n },
        content: [{ type: "paragraph" }],
      })),
    });
  }

  it("1-digit doc → both null", () => {
    const w = computeExpexWidths(docWithNumbers(1, 2, 9));
    expect(w.numWidth).toBeNull();
    expect(w.markerWidth).toBeNull();
  });

  it("picks the WIDEST number across the doc", () => {
    const w = computeExpexWidths(docWithNumbers(1, 9, 10));
    expect(w.numWidth).toBe("4ch"); // (10) dictates the shared width
  });

  it("reaches item markers for the marker width", () => {
    const d = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "exampleBlock",
          attrs: { uuid: "B", kind: "multi", number: 1 },
          content: [
            {
              type: "exampleItemList",
              content: [
                {
                  type: "exampleItem",
                  attrs: { uuid: "i1", subLabel: "i" },
                  content: [{ type: "paragraph" }],
                },
                {
                  type: "exampleItem",
                  attrs: { uuid: "i2", subLabel: "viii" },
                  content: [{ type: "paragraph" }],
                },
              ],
            },
          ],
        },
      ],
    });
    const w = computeExpexWidths(d);
    expect(w.markerWidth).toBe("5.5ch"); // "viii" (len 4) is widest -> 4 + 1.5
  });

  it("handles a BARE exampleBlock root (float surface)", () => {
    const block = schema.nodeFromJSON({
      type: "exampleBlock",
      attrs: { uuid: "B", kind: "single", number: 100 },
      content: [{ type: "paragraph" }],
    });
    const w = computeExpexWidths(block);
    expect(w.numWidth).toBe("5ch"); // (100) — root node inspected too
  });
});

describe("applyExpexWidthVars / expexWidthStyle — the shared apply (backlog #53b)", () => {
  // The drift class #53b fixes: `--expex-num-width` was applied by hand in 3
  // surfaces (main plugin, float body, card editor). These helpers are the SSOT
  // both the imperative (plugin / card editor) and declarative (float) surfaces
  // consume, so a 2-digit `(13)` widens the same way everywhere.

  it("applyExpexWidthVars sets both vars when non-null", () => {
    const el = document.createElement("div");
    applyExpexWidthVars(el, { numWidth: "5ch", markerWidth: "6.5ch" });
    expect(el.style.getPropertyValue("--expex-num-width")).toBe("5ch");
    expect(el.style.getPropertyValue("--expex-marker-width")).toBe("6.5ch");
  });

  it("applyExpexWidthVars REMOVES vars when null (restore the 1.5em default)", () => {
    const el = document.createElement("div");
    el.style.setProperty("--expex-num-width", "5ch");
    el.style.setProperty("--expex-marker-width", "6.5ch");
    applyExpexWidthVars(el, { numWidth: null, markerWidth: null });
    expect(el.style.getPropertyValue("--expex-num-width")).toBe("");
    expect(el.style.getPropertyValue("--expex-marker-width")).toBe("");
  });

  it("applyExpexWidthVars(computeExpexWidths(2-digit block)) widens the card editor (#53b)", () => {
    // The exact #53b scenario: a collapsed/expanded example CARD mounts a
    // standalone editor with NO ExpexNumbering plugin, so it relies on this
    // helper. A `(13)` block must yield a widened --expex-num-width.
    const block = schema.nodeFromJSON({
      type: "exampleBlock",
      attrs: { uuid: "B13", kind: "single", number: 13 },
      content: [{ type: "paragraph" }],
    });
    const el = document.createElement("div");
    applyExpexWidthVars(el, computeExpexWidths(block));
    expect(el.style.getPropertyValue("--expex-num-width")).toBe("4ch"); // 2 digits
  });

  it("expexWidthStyle returns only the non-null vars as a style object", () => {
    expect(expexWidthStyle({ numWidth: "5ch", markerWidth: null })).toEqual({
      "--expex-num-width": "5ch",
    });
    expect(expexWidthStyle({ numWidth: null, markerWidth: "6.5ch" })).toEqual({
      "--expex-marker-width": "6.5ch",
    });
    expect(expexWidthStyle({ numWidth: null, markerWidth: null })).toEqual({});
  });
});

describe("KEYSTROKE SANCTITY — the var is written only on a digit-count change", () => {
  function mountWithExamples(count: number): Editor {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const content = {
      type: "doc",
      content: Array.from({ length: count }, (_, i) => ({
        type: "exampleBlock",
        attrs: { uuid: `b${i}`, kind: "single", number: i + 1 },
        content: [
          { type: "paragraph", content: [{ type: "text", text: `ex ${i + 1}` }] },
        ],
      })),
    };
    return new Editor({
      element,
      editable: true,
      extensions: buildEditorExtensions(mainCtx()),
      content,
    });
  }

  let editor: Editor;
  beforeEach(() => {
    editor = mountWithExamples(9); // (1)..(9) — 1 digit, no var
  });

  function numVar(): string {
    return (editor.view.dom as HTMLElement).style.getPropertyValue(
      "--expex-num-width",
    );
  }

  it("9 examples → no --expex-num-width on the container (1.5em default)", () => {
    expect(numVar()).toBe("");
  });

  it("adding a 10th example writes the widened var", () => {
    // Append a new exampleBlock at the doc end → (10), 2 digits.
    const { state } = editor;
    const newBlock = state.schema.nodes.exampleBlock.create(
      { uuid: "b9", kind: "single", number: 0 },
      state.schema.nodes.paragraph.create(),
    );
    editor.view.dispatch(state.tr.insert(state.doc.content.size, newBlock));
    // The numberer renumbers + the width plugin maintains the var.
    expect(numVar()).toBe("4ch");
  });

  it("typing PLAIN TEXT inside an example does NOT rewrite the var", () => {
    // First get to the widened state.
    {
      const { state } = editor;
      const newBlock = state.schema.nodes.exampleBlock.create(
        { uuid: "b9", kind: "single", number: 0 },
        state.schema.nodes.paragraph.create(),
      );
      editor.view.dispatch(state.tr.insert(state.doc.content.size, newBlock));
    }
    expect(numVar()).toBe("4ch");

    // Spy on the container's setProperty: plain typing must not call it for
    // --expex-num-width (the var is unchanged → no DOM write).
    const dom = editor.view.dom as HTMLElement;
    const spy = vi.spyOn(dom.style, "setProperty");

    // Place the cursor inside the FIRST example's paragraph and type.
    const firstBlock = editor.state.doc.child(0);
    const cursor = 2; // inside doc -> block(+1) -> paragraph(+1)
    expect(firstBlock.type.name).toBe("exampleBlock");
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, cursor),
      ),
    );
    for (const ch of "hello") {
      editor.view.dispatch(editor.state.tr.insertText(ch));
    }

    const numWidthWrites = spy.mock.calls.filter(
      (c) => c[0] === "--expex-num-width",
    );
    expect(numWidthWrites).toHaveLength(0); // ZERO var writes on plain typing
    expect(numVar()).toBe("4ch"); // and the var is still the widened value
    spy.mockRestore();
  });

  it("deleting back below 10 narrows the var back to the default", () => {
    // Widen first.
    {
      const { state } = editor;
      const newBlock = state.schema.nodes.exampleBlock.create(
        { uuid: "b9", kind: "single", number: 0 },
        state.schema.nodes.paragraph.create(),
      );
      editor.view.dispatch(state.tr.insert(state.doc.content.size, newBlock));
    }
    expect(numVar()).toBe("4ch");

    // Delete the (10) example block → back to (1)..(9). Locate it by number
    // (the doc may carry an auto-inserted trailing paragraph after it).
    let tenStart = -1;
    let tenSize = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "exampleBlock" && node.attrs.number === 10) {
        tenStart = pos;
        tenSize = node.nodeSize;
        return false;
      }
      return true;
    });
    expect(tenStart).toBeGreaterThanOrEqual(0);
    editor.view.dispatch(
      editor.state.tr.delete(tenStart, tenStart + tenSize),
    );
    expect(numVar()).toBe(""); // var removed → 1.5em default restored
  });
});
