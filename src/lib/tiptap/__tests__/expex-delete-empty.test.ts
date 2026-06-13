// @vitest-environment jsdom
/**
 * Backlog #3 — Backspace/Delete on an empty expex line deletes the sub-item /
 * item. Locks the shared `deleteEmptyExampleStructure(state)` helper that both
 * the ExampleItem and ExampleBlock Backspace/Delete handlers call.
 *
 * The helper is pure (EditorState → Transaction | null); we build a real
 * EditorState from the ACTUAL editor schema, place the cursor in an empty
 * example paragraph, and inspect the resulting tr.doc WITHOUT dispatching.
 *
 * (The extension barrel transitively imports `@/lib/storage`, whose
 * `require("@/lib/storage-fsa")` vitest can't resolve — stubbed wholesale, the
 * same pattern the sibling expex tests use.)
 */

import { describe, expect, it, vi } from "vitest";

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

import { getSchema } from "@tiptap/core";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { deleteEmptyExampleStructure } from "@/lib/tiptap/expex";

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

function findByType(d: PMNode, typeName: string): { pos: number; node: PMNode }[] {
  const out: { pos: number; node: PMNode }[] = [];
  d.descendants((n, pos) => {
    if (n.type.name === typeName) out.push({ pos, node: n });
    return true;
  });
  return out;
}

function count(d: PMNode, typeName: string): number {
  return findByType(d, typeName).length;
}

/** Build a state with the cursor at the START of the empty paragraph that
 * lives inside the FIRST node of the given type (matched by an empty para). */
function stateWithCursorInEmptyParaOf(d: PMNode): EditorState {
  let cursor = -1;
  d.descendants((n, pos) => {
    if (cursor >= 0) return false;
    if (n.type.name === "paragraph" && n.content.size === 0) {
      cursor = pos + 1; // inside the empty paragraph
      return false;
    }
    return true;
  });
  const state = EditorState.create({ schema, doc: d });
  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, cursor)),
  );
}

const exItem = (text: string | null, uuid: string) => ({
  type: "exampleItem",
  attrs: { uuid },
  content: [
    text === null
      ? { type: "paragraph" }
      : { type: "paragraph", content: [{ type: "text", text }] },
  ],
});

describe("deleteEmptyExampleStructure — sub-item (3-way) branches", () => {
  it("one of several items: deletes JUST the empty item, others survive", () => {
    const d = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "exampleBlock",
          attrs: { uuid: "B", kind: "multi" },
          content: [
            {
              type: "exampleItemList",
              content: [
                exItem("alpha", "i1"),
                exItem(null, "i2"), // empty — the cursor target
                exItem("gamma", "i3"),
              ],
            },
          ],
        },
      ],
    });
    const state = stateWithCursorInEmptyParaOf(d);
    const tr = deleteEmptyExampleStructure(state);
    expect(tr).not.toBeNull();
    const result = tr!.doc;
    expect(() => result.check()).not.toThrow();
    expect(count(result, "exampleBlock")).toBe(1);
    expect(count(result, "exampleItem")).toBe(2); // i2 gone
    expect(count(result, "exampleItemList")).toBe(1);
    expect(result.textContent).toContain("alpha");
    expect(result.textContent).toContain("gamma");
    // Block stays multi (still has a list with >1 item).
    expect(findByType(result, "exampleBlock")[0].node.attrs.kind).toBe("multi");
  });

  it("only item in its list (block has other content): deletes the list, flips kind to single", () => {
    const d = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "exampleBlock",
          attrs: { uuid: "B", kind: "multi" },
          content: [
            { type: "paragraph", content: [{ type: "text", text: "preamble" }] },
            { type: "exampleItemList", content: [exItem(null, "i1")] },
          ],
        },
      ],
    });
    const state = stateWithCursorInEmptyParaOf(d);
    const tr = deleteEmptyExampleStructure(state);
    expect(tr).not.toBeNull();
    const result = tr!.doc;
    expect(() => result.check()).not.toThrow();
    expect(count(result, "exampleBlock")).toBe(1);
    expect(count(result, "exampleItemList")).toBe(0); // list removed
    expect(count(result, "exampleItem")).toBe(0);
    expect(result.textContent).toContain("preamble");
    // No list survives → kind flips back to single.
    expect(findByType(result, "exampleBlock")[0].node.attrs.kind).toBe("single");
  });

  it("only item, only list, nothing else: deletes the WHOLE block", () => {
    const d = schema.nodeFromJSON({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "before" }] },
        {
          type: "exampleBlock",
          attrs: { uuid: "B", kind: "multi" },
          content: [{ type: "exampleItemList", content: [exItem(null, "i1")] }],
        },
        { type: "paragraph", content: [{ type: "text", text: "after" }] },
      ],
    });
    const state = stateWithCursorInEmptyParaOf(d);
    const tr = deleteEmptyExampleStructure(state);
    expect(tr).not.toBeNull();
    const result = tr!.doc;
    expect(() => result.check()).not.toThrow();
    expect(count(result, "exampleBlock")).toBe(0); // block gone entirely
    expect(result.textContent).toContain("before");
    expect(result.textContent).toContain("after");
  });
});

describe("deleteEmptyExampleStructure — top-level (n) example branches", () => {
  it("empty block with a previous sibling: removes the block, lands before", () => {
    const d = schema.nodeFromJSON({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "intro" }] },
        {
          type: "exampleBlock",
          attrs: { uuid: "B", kind: "single" },
          content: [{ type: "paragraph" }],
        },
      ],
    });
    const state = stateWithCursorInEmptyParaOf(d);
    const tr = deleteEmptyExampleStructure(state);
    expect(tr).not.toBeNull();
    const result = tr!.doc;
    expect(() => result.check()).not.toThrow();
    expect(count(result, "exampleBlock")).toBe(0);
    // No stray empty paragraph left behind (the previous block absorbs the cursor).
    expect(count(result, "paragraph")).toBe(1);
    expect(result.textContent).toBe("intro");
  });

  it("empty block as the doc's ONLY content: dissolves to an empty paragraph", () => {
    const d = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "exampleBlock",
          attrs: { uuid: "B", kind: "single" },
          content: [{ type: "paragraph" }],
        },
      ],
    });
    const state = stateWithCursorInEmptyParaOf(d);
    const tr = deleteEmptyExampleStructure(state);
    expect(tr).not.toBeNull();
    const result = tr!.doc;
    expect(() => result.check()).not.toThrow();
    expect(count(result, "exampleBlock")).toBe(0);
    expect(count(result, "paragraph")).toBe(1); // doc never left empty
    expect(result.firstChild?.type.name).toBe("paragraph");
  });
});

describe("deleteEmptyExampleStructure — no-op outside an example", () => {
  it("returns null when the cursor is in a plain paragraph", () => {
    const d = schema.nodeFromJSON({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
    const state = stateWithCursorInEmptyParaOf(d);
    expect(deleteEmptyExampleStructure(state)).toBeNull();
  });

  it("returns null for a NON-empty top-level example paragraph", () => {
    const d = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "exampleBlock",
          attrs: { uuid: "B", kind: "single" },
          content: [{ type: "paragraph", content: [{ type: "text", text: "has text" }] }],
        },
      ],
    });
    // Cursor at start of the non-empty paragraph.
    const block = findByType(d, "exampleBlock")[0];
    const state = EditorState.create({ schema, doc: d });
    const cursorState = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, block.pos + 2)),
    );
    expect(deleteEmptyExampleStructure(cursorState)).toBeNull();
  });
});

describe("deleteEmptyExampleStructure — nested-content data-loss guard", () => {
  it("returns null when the empty leading line's item ALSO holds a nested list (no silent content loss)", () => {
    const d = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "exampleBlock",
          attrs: { uuid: "B", kind: "multi" },
          content: [
            {
              type: "exampleItemList",
              content: [
                {
                  type: "exampleItem",
                  attrs: { uuid: "i1" },
                  content: [
                    { type: "paragraph" }, // empty leading line — cursor target
                    {
                      type: "exampleItemList",
                      content: [exItem("nested-child", "i1a")],
                    },
                  ],
                },
                exItem("beta", "i2"),
              ],
            },
          ],
        },
      ],
    });
    const state = stateWithCursorInEmptyParaOf(d);
    // The item carries nested content beyond the empty paragraph → deleting the
    // item would destroy it, so the helper must bail (fall through to default).
    expect(deleteEmptyExampleStructure(state)).toBeNull();
  });
});
