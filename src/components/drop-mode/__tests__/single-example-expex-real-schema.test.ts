// @vitest-environment jsdom
/**
 * Feature A2 — REAL-SCHEMA lock for the single-example expex drop.
 *
 * The sibling `single-example-expex-drop.test.ts` runs against a hand-rolled
 * schema that MIRRORS the A2 widen. This file proves the same thing on the
 * ACTUAL editor schema built from `buildEditorExtensions` (the real
 * `exampleBlock` / `exampleItem` / `exampleItemList` / `displayMath` /
 * `graphicsBlock` nodes, with their real attrs + content expressions) — the
 * equivalent of the spec's "build the applyDrop tr, inspect tr.doc WITHOUT
 * dispatch, on the REAL live schema; run tr.doc.check()". Committed + headless,
 * so it can't drift the way a one-off preview eval would.
 *
 * (The extension barrel transitively imports `@/lib/storage`, whose
 * `require("@/lib/storage-fsa")` vitest can't resolve — stubbed wholesale, the
 * same pattern editor-extensions.test.ts uses. We never call a storage fn.)
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
import { EditorState, type Transaction } from "@tiptap/pm/state";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { canDropDirectAt, classifyParentAt } from "../specs/drop-context";
import { textObjectDropSpec } from "../specs/textobject";
import type { DropCtx, Placement } from "../types";

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

// The REAL editor schema — every expex node with its real content expression.
const schema: Schema = getSchema(buildEditorExtensions(mainCtx()));

function mockEditor(d: PMNode) {
  const dispatched: Transaction[] = [];
  const state = EditorState.create({ schema, doc: d });
  const editor = {
    state,
    view: {
      nodeDOM: () => null,
      dispatch: (tr: Transaction) => dispatched.push(tr),
      focus: () => {},
    },
  } as unknown as Editor;
  return { editor, dispatched, ctx: { mainEditor: editor } as unknown as DropCtx };
}

function betweenBlocks(editor: Editor, insertPos: number): Placement {
  return { kind: "between-blocks", editor, insertPos, rect: { x: 0, y: 0, width: 0, height: 0 } };
}

interface NodeInfo { pos: number; size: number; uuid: string | null }
function findByType(d: PMNode, typeName: string): NodeInfo[] {
  const out: NodeInfo[] = [];
  d.descendants((n, pos) => {
    if (n.type.name === typeName) {
      out.push({ pos, size: n.nodeSize, uuid: (n.attrs?.uuid as string | null) ?? null });
    }
    return true;
  });
  return out;
}

const singleDoc = (bodyJson: object[]) =>
  schema.nodeFromJSON({
    type: "doc",
    content: [
      { type: "paragraph", attrs: { uuid: "psrc" }, content: [{ type: "text", text: "dragged text" }] },
      { type: "displayMath", attrs: { uuid: "dsrc", latex: "a = b" } },
      { type: "graphicsBlock", attrs: { uuid: "gsrc", command: "\\includegraphics{fig}" } },
      { type: "exampleBlock", attrs: { uuid: "S", kind: "single" }, content: bodyJson },
    ],
  });

describe("Feature A2 — REAL editor schema accepts the widen", () => {
  it("exampleBlock's real content expression includes graphicsBlock + displayMath", () => {
    const content = schema.nodes.exampleBlock.spec.content ?? "";
    expect(content).toContain("graphicsBlock");
    expect(content).toContain("displayMath");
    expect(content).toContain("paragraph"); // was already valid
  });

  it("a single exampleBlock with [paragraph, displayMath, graphicsBlock] is a VALID real node", () => {
    const block = schema.nodeFromJSON({
      type: "exampleBlock",
      attrs: { uuid: "S", kind: "single" },
      content: [
        { type: "paragraph", content: [{ type: "text", text: "the sentence" }] },
        { type: "displayMath", attrs: { latex: "x = 1" } },
        { type: "graphicsBlock", attrs: { command: "\\includegraphics{fig}" } },
      ],
    });
    expect(() => block.check()).not.toThrow(); // schema-valid on the real model
    expect(block.attrs.kind).toBe("single");
    expect(block.childCount).toBe(3);
  });

  it("THE TRAP on the real schema: exampleBlock accepts a bare block, exampleItemList rejects it", () => {
    // Single body (immediate parent exampleBlock) → ACCEPTS each of the 3 kinds.
    expect(schema.nodes.exampleBlock.contentMatch.matchType(schema.nodes.paragraph)).not.toBeNull();
    expect(schema.nodes.exampleBlock.contentMatch.matchType(schema.nodes.displayMath)).not.toBeNull();
    expect(schema.nodes.exampleBlock.contentMatch.matchType(schema.nodes.graphicsBlock)).not.toBeNull();
    // Between items (immediate parent exampleItemList, content `exampleItem+`)
    // → REJECTS a bare block. This is why a widened exampleBlock does NOT make
    // the multi new-item drop go drop-direct.
    expect(schema.nodes.exampleItemList.contentMatch.matchType(schema.nodes.paragraph)).toBeNull();
    expect(schema.nodes.exampleItemList.contentMatch.matchType(schema.nodes.displayMath)).toBeNull();
  });
});

describe("Feature A2 — applyDrop on the REAL schema (non-destructive tr.doc)", () => {
  for (const { kind, key, uuid } of [
    { kind: "paragraph", key: "textobject:paragraph:psrc", uuid: "psrc" },
    { kind: "displayMath", key: "textobject:displayMath:dsrc", uuid: "dsrc" },
    { kind: "graphicsBlock", key: "textobject:graphicsBlock:gsrc", uuid: "gsrc" },
  ] as const) {
    it(`a ${kind} drops DIRECTLY into a single example's body (stays single, valid)`, () => {
      const d = singleDoc([{ type: "paragraph", content: [{ type: "text", text: "original" }] }]);
      const { editor, dispatched, ctx } = mockEditor(d);
      const block = findByType(d, "exampleBlock")[0];
      const insertPos = block.pos + block.size - 1; // single example body slot
      expect(classifyParentAt(editor, insertPos)).toBe("exampleBlock");
      expect(canDropDirectAt(editor, insertPos, schema.nodes[kind])).toBe(true);

      textObjectDropSpec.applyDrop(betweenBlocks(editor, insertPos), key, ctx);
      const result = dispatched[0].doc;
      expect(() => result.check()).not.toThrow(); // valid on the REAL schema

      const ex = result.child(result.childCount - 1);
      expect(ex.type.name).toBe("exampleBlock");
      expect(ex.attrs.kind).toBe("single"); // NOT converted to multi
      expect(ex.child(ex.childCount - 1).type.name).toBe(kind); // joined the body
      expect(ex.child(ex.childCount - 1).attrs.uuid).toBe(uuid);
      expect(findByType(result, "exampleItem")).toHaveLength(0); // no item machinery
    });
  }

  it("REGRESSION LOCK (real schema): a multi between-items drop STILL wraps into a fresh exampleItem", () => {
    const d = schema.nodeFromJSON({
      type: "doc",
      content: [
        { type: "paragraph", attrs: { uuid: "psrc" }, content: [{ type: "text", text: "dragP" }] },
        {
          type: "exampleBlock",
          attrs: { uuid: "M", kind: "multi" },
          content: [
            {
              type: "exampleItemList",
              content: [
                { type: "exampleItem", attrs: { uuid: "i1" }, content: [{ type: "paragraph", content: [{ type: "text", text: "alpha" }] }] },
                { type: "exampleItem", attrs: { uuid: "i2" }, content: [{ type: "paragraph", content: [{ type: "text", text: "beta" }] }] },
              ],
            },
          ],
        },
      ],
    });
    const { editor, dispatched, ctx } = mockEditor(d);
    const items = findByType(d, "exampleItem");
    const insertPos = items[1].pos; // between i1 and i2 (immediate parent exampleItemList)
    expect(canDropDirectAt(editor, insertPos, schema.nodes.paragraph)).toBe(false);

    textObjectDropSpec.applyDrop(betweenBlocks(editor, insertPos), "textobject:paragraph:psrc", ctx);
    const result = dispatched[0].doc;
    expect(() => result.check()).not.toThrow(); // would THROW if a bare block were inserted into the list

    const list = result.child(result.childCount - 1).child(0);
    expect(list.type.name).toBe("exampleItemList");
    expect(list.childCount).toBe(3); // one NEW item, not a bare block
    for (let i = 0; i < list.childCount; i++) {
      expect(list.child(i).type.name).toBe("exampleItem");
    }
    expect(list.child(1).child(0).type.name).toBe("paragraph"); // the dropped block, wrapped
    expect(list.child(1).child(0).textContent).toBe("dragP");
  });

  it("EDGE-FIX LOCK (real schema): a displayMath dropped at a listItem's index 0 drops-DIRECT — NOT wrapped into a here-invalid exampleItem", () => {
    // OUTSIDE any expex. `listItem` content is `(paragraph | graphicsBlock) block*`,
    // so a bare `displayMath` is rejected at index 0 (canDropDirect=false) — yet an
    // `exampleItem` is ALSO invalid there (it's valid only inside an
    // `exampleItemList`), so the A2 wrap must NOT fire. Pre-fix the adapter wrapped
    // on `canDropDirect === false` alone: the fitter then promoted the equation into
    // a freestanding `exampleBlock` and split the list — the bug. The `canWrapHere`
    // gate restores A1's drop-direct here.
    const d = schema.nodeFromJSON({
      type: "doc",
      content: [
        { type: "displayMath", attrs: { uuid: "dsrc", latex: "a = b" } },
        {
          type: "bulletList",
          attrs: { uuid: "L" },
          content: [
            {
              type: "listItem",
              attrs: { uuid: "li1" },
              content: [{ type: "paragraph", content: [{ type: "text", text: "list text" }] }],
            },
          ],
        },
      ],
    });
    const { editor, dispatched, ctx } = mockEditor(d);
    const li = findByType(d, "listItem")[0];
    const insertPos = li.pos + 1; // just inside the listItem, before its paragraph (index 0)

    // The wrap trigger fires (bare block rejected here) — but the wrap target is
    // ALSO invalid here, so `canWrapHere` is false and the wrap must be suppressed.
    expect(canDropDirectAt(editor, insertPos, schema.nodes.displayMath)).toBe(false); // canDropDirect=false
    expect(canDropDirectAt(editor, insertPos, schema.nodes.exampleItem)).toBe(false); // canWrapHere=false ⇒ no wrap

    textObjectDropSpec.applyDrop(betweenBlocks(editor, insertPos), "textobject:displayMath:dsrc", ctx);
    const result = dispatched[0].doc;
    expect(() => result.check()).not.toThrow();

    // FIXED: drop-direct ⇒ no exampleItem machinery is fabricated here…
    expect(findByType(result, "exampleItem")).toHaveLength(0);
    // …and the dragged equation survives the drop (the fitter places the bare
    // displayMath validly — A1's behavior — instead of burying it in an example).
    expect(findByType(result, "displayMath").map((n) => n.uuid)).toContain("dsrc");
  });
});
