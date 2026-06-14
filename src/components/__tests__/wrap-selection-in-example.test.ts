// @vitest-environment jsdom
/**
 * DA-1 — the example WRAP must never place block-level nodes into the example
 * template's inline-only paragraph slot.
 *
 * The grid `ex` cell and the slash `\ex` command both wrap the current selection
 * into a fresh single-example template and drop the selection's inline content
 * into the first item paragraph, whose content is `inline*`. The old code (grid)
 * shoveled the raw slice JSON in, guarded only by `Array.isArray` — but a slice
 * spanning a block boundary serializes to *block* nodes (paragraphs, lists,
 * displayMath), so that slot received block-level JSON → a ProseMirror schema
 * violation / document corruption.
 *
 * CHIP 5c — the harvest (`extractInlineFromSlice`) and the wrap+insert
 * (`exampleRun`) are now the SINGLE canonical creator in the action registry,
 * shared by both surfaces; this test locks them on the ACTUAL editor schema
 * (`buildEditorExtensions`) by driving `exampleRun` against a real `EditorState`
 * and inspecting the dispatched transaction's doc with `.check()`:
 *   (a) a plain inline selection            → wrapped, valid, words survive;
 *   (b) a multi-paragraph selection         → inline-only, valid, NO throw;
 *   (c) a selection containing a list       → inline-only, valid, NO throw;
 *   (d) an inline selection with an atom     → atom preserved inline;
 *   (e) a whitespace-only / collapsed sel    → empty ⇒ empty-template fallback.
 *
 * The extension barrel transitively imports `@/lib/storage` (whose
 * `require("@/lib/storage-fsa")` vitest can't resolve) — stubbed wholesale, the
 * same pattern editor-extensions.test.ts uses. We never call a storage fn.
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
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import type { Editor } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  exampleRun,
  extractInlineFromSlice,
  type ActionContext,
} from "@/lib/actions/action-registry";

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

/**
 * Drive the REAL `exampleRun` against a fresh `EditorState` seeded from `docJson`
 * with the selection set to `[from, to)`, capture the dispatched transaction's
 * doc, and return the new `exampleBlock` from it (so the caller can `check()`).
 */
function runExampleWrap(docJson: object, from: number, to: number): PMNode {
  const doc = schema.nodeFromJSON(docJson);
  let state = EditorState.create({ schema, doc });
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, from, to)),
  );
  let dispatched: Transaction | null = null;
  const view = {
    get state() {
      return state;
    },
    dispatch: (tr: Transaction) => {
      dispatched = tr;
    },
  } as unknown as EditorView;
  const ctx: ActionContext = {
    editor: { view, state } as unknown as Editor,
    view,
    ref: { kind: "selection", from, to, paragraphId: "" },
    surface: "lightning",
  };
  exampleRun(ctx);
  if (!dispatched) throw new Error("exampleRun did not dispatch");
  const result = (dispatched as Transaction).doc;
  expect(() => result.check()).not.toThrow(); // valid on the REAL schema
  let block: PMNode | null = null;
  result.descendants((n) => {
    if (!block && n.type.name === "exampleBlock") block = n;
    return !block;
  });
  if (!block) throw new Error("no exampleBlock produced");
  return block;
}

/** The text in the example template's first (and only) item paragraph. */
function firstItemText(block: PMNode): string {
  // single template → content is [{ paragraph }]
  return block.child(0).textContent;
}

describe("DA-1 — the slot is inline-only on the real schema", () => {
  it("the example template's first paragraph holds `inline*` (rejects blocks)", () => {
    const para = schema.nodes.paragraph;
    expect(para.contentMatch.matchType(schema.nodes.paragraph)).toBeNull();
    expect(para.contentMatch.matchType(schema.nodes.displayMath)).toBeNull();
    expect(para.contentMatch.matchType(schema.nodes.bulletList)).toBeNull();
    // …but it DOES accept text.
    expect(para.contentMatch.matchType(schema.nodes.text)).not.toBeNull();
  });
});

describe("DA-1 — exampleRun (the wrap) never corrupts the doc", () => {
  it("(a) plain inline selection → wrapped, valid, words survive", () => {
    const block = runExampleWrap(
      {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "hello world" }] },
        ],
      },
      2,
      10,
    );
    expect(block.type.name).toBe("exampleBlock");
    expect(block.attrs.kind).toBe("single");
    expect(firstItemText(block)).toBe("ello wor");
  });

  it("(b) MULTI-BLOCK selection (two paragraphs) → inline-only, no schema throw", () => {
    const block = runExampleWrap(
      {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "alpha" }] },
          { type: "paragraph", content: [{ type: "text", text: "beta" }] },
        ],
      },
      2,
      10,
    );
    // Inline content joined, block boundary collapsed — no nested paragraphs.
    expect(block.child(0).type.name).toBe("paragraph");
    expect(firstItemText(block)).toBe("lphabe");
    block.child(0).forEach((inline) => expect(inline.isInline).toBe(true));
  });

  it("(c) selection containing a LIST → inline-only, no schema throw", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "intro" }] },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "item1" }] },
              ],
            },
          ],
        },
      ],
    };
    const node = schema.nodeFromJSON(doc);
    const block = runExampleWrap(doc, 1, node.content.size);
    block.child(0).forEach((inline) => expect(inline.isInline).toBe(true));
    expect(firstItemText(block)).toBe("introitem1");
  });

  it("(d) inline selection with an inline atom (inline math) preserves the atom", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "see " },
            { type: "inlineMath", attrs: { latex: "x^2" } },
            { type: "text", text: " here" },
          ],
        },
      ],
    };
    const node = schema.nodeFromJSON(doc);
    const block = runExampleWrap(doc, 1, node.child(0).nodeSize - 1);
    let sawMath = false;
    block.child(0).forEach((inline) => {
      expect(inline.isInline).toBe(true);
      if (inline.type.name === "inlineMath") sawMath = true;
    });
    expect(sawMath).toBe(true);
  });

  it("(e) whitespace-only selection → empty-template fallback (blank item)", () => {
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a    b" }] },
      ],
    });
    // The harvest is the SSOT gate: a run of spaces yields no usable content.
    expect(extractInlineFromSlice(doc.slice(2, 6))).toEqual([]);
    const block = runExampleWrap(doc.toJSON(), 2, 6);
    expect(block.child(0).content.size).toBe(0);
  });

  it("(f) collapsed selection → empty single example (no throw)", () => {
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "hello" }] },
      ],
    });
    expect(extractInlineFromSlice(doc.slice(3, 3))).toEqual([]);
    const block = runExampleWrap(doc.toJSON(), 3, 3);
    expect(block.attrs.kind).toBe("single");
    expect(block.child(0).content.size).toBe(0);
  });
});
