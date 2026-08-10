// @vitest-environment jsdom
/**
 * Task 234 — a sub-item dropped into a NESTED tier of its own container.
 *
 * An expex example may nest: `exampleItem`'s real content expression ends in
 * `exampleItemList?`, and the Tab / `sinkListItem` keymap makes that tier
 * user-reachable. Popping out an `exampleItem` and releasing it in the gap
 * BETWEEN two nested items surfaced a valid-looking drop indicator
 * (`resolveSubItemPeerBlock` confirms a compatible container by climbing to the
 * enclosing `exampleBlock`) and then did NOTHING on release.
 *
 * The cause was the wrap adapters deciding wrap-vs-direct off `classifyParentAt`
 * — a LOSSY proxy that skips unregistered containers. `exampleItemList` is not a
 * registered `TextObjectKind`, so at the NESTED tier the walk-up lands on the
 * enclosing `exampleItem` (not the `exampleBlock`), classification reports
 * `inside-incompatible-parent`, and the adapter fell through to its wrap branch
 * — where task 065's gate correctly refuses a fresh `exampleBlock` inside an
 * `exampleItemList`, so the drop no-oped. All the while the schema at the TRUE
 * immediate parent said YES to a bare `exampleItem`.
 *
 * These legs run on the REAL editor schema (the sibling
 * `sub-item-drop-resolution.test.ts` hand-rolls `exampleItem` as `paragraph+`,
 * which makes the nested case impossible to even build), and they FAIL on the
 * pre-fix tree: the nested drop dispatches nothing.
 *
 * (The extension barrel transitively imports `@/lib/storage`, whose
 * `require("@/lib/storage-fsa")` vitest can't resolve — stubbed wholesale, the
 * same pattern `single-example-expex-real-schema.test.ts` uses.)
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
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { canDropDirectAt, classifyParentAt } from "../specs/drop-context";
import { textObjectDropSpec } from "../specs/textobject";
import { resolveSubItemPeerBlock } from "../hit-test";
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

const schema: Schema = getSchema(buildEditorExtensions(mainCtx()));

function mockEditor(d: PMNode) {
  const dispatched: Transaction[] = [];
  const state = EditorState.create({ schema, doc: d });
  const editor = {
    state,
    view: {
      // `resolveSubItemPeerBlock` needs SOME HTMLElement to report a hit.
      nodeDOM: () => document.createElement("div"),
      dispatch: (tr: Transaction) => dispatched.push(tr),
      focus: () => {},
    },
  } as unknown as Editor;
  return {
    editor,
    dispatched,
    ctx: { mainEditor: editor } as unknown as DropCtx,
  };
}

function betweenBlocks(editor: Editor, insertPos: number): Placement {
  return {
    kind: "between-blocks",
    editor,
    insertPos,
    rect: { x: 0, y: 0, width: 0, height: 0 },
  };
}

interface NodeInfo {
  pos: number;
  size: number;
  uuid: string | null;
  text: string;
}
function findByType(d: PMNode, typeName: string): NodeInfo[] {
  const out: NodeInfo[] = [];
  d.descendants((n, pos) => {
    if (n.type.name === typeName) {
      out.push({
        pos,
        size: n.nodeSize,
        uuid: (n.attrs?.uuid as string | null) ?? null,
        text: n.textContent,
      });
    }
    return true;
  });
  return out;
}

const item = (uuid: string, text: string, content?: object[]) => ({
  type: "exampleItem",
  attrs: { uuid },
  content: [
    { type: "paragraph", content: [{ type: "text", text }] },
    ...(content ?? []),
  ],
});

/**
 *   exampleBlock M (multi)
 *     exampleItemList  (L1)
 *       exampleItem A "alpha"
 *         paragraph "alpha"
 *         exampleItemList  (L2 — the NESTED tier)
 *           exampleItem i "one"
 *           exampleItem ii "two"
 *       exampleItem B "beta"
 */
const nestedDoc = () =>
  schema.nodeFromJSON({
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { uuid: "p0" },
        content: [{ type: "text", text: "intro" }],
      },
      {
        type: "exampleBlock",
        attrs: { uuid: "M", kind: "multi" },
        content: [
          {
            type: "exampleItemList",
            content: [
              item("iA", "alpha", [
                {
                  type: "exampleItemList",
                  content: [item("i1", "one"), item("i2", "two")],
                },
              ]),
              item("iB", "beta"),
            ],
          },
        ],
      },
    ],
  });

describe("nested xlist tier — preconditions on the REAL schema", () => {
  it("exampleItem's content expression admits a nested exampleItemList", () => {
    expect(schema.nodes.exampleItem.spec.content ?? "").toContain(
      "exampleItemList",
    );
    expect(() => nestedDoc().check()).not.toThrow();
  });

  it("the nested item gap: classifyParentAt reports exampleItem (LOSSY) while the schema accepts a bare exampleItem", () => {
    const d = nestedDoc();
    const { editor } = mockEditor(d);
    const insertPos = findByType(d, "exampleItem").find((i) => i.uuid === "i2")!
      .pos;
    // The lossy proxy skips the unregistered `exampleItemList` and lands on the
    // ENCLOSING item — which is NOT a compatible parent for an exampleItem, so
    // classification says "incompatible" …
    expect(classifyParentAt(editor, insertPos)).toBe("exampleItem");
    // … while the TRUE immediate parent (the nested exampleItemList, content
    // `exampleItem+`) accepts the bare item. This gap IS the bug.
    expect(canDropDirectAt(editor, insertPos, schema.nodes.exampleItem)).toBe(
      true,
    );
  });

  it("the drop indicator IS surfaced at the nested tier (so the affordance is honest, not a lie)", () => {
    const d = nestedDoc();
    const { editor } = mockEditor(d);
    const i2 = findByType(d, "exampleItem").find((i) => i.uuid === "i2")!;
    const peer = resolveSubItemPeerBlock(
      editor,
      i2.pos + 2, // inside the nested item's paragraph text
      "textobject:exampleItem:iB",
    );
    expect(peer).not.toBeNull();
    expect(peer!.blockPos).toBe(i2.pos);
  });
});

describe("task 234 — an exampleItem drops into a NESTED item gap", () => {
  it("lands as a sibling in the nested list (pre-fix: dispatched nothing)", () => {
    const d = nestedDoc();
    const { editor, dispatched, ctx } = mockEditor(d);
    const insertPos = findByType(d, "exampleItem").find((i) => i.uuid === "i2")!
      .pos;

    expect(
      textObjectDropSpec.classifyDrop(
        betweenBlocks(editor, insertPos),
        "textobject:exampleItem:iB",
        ctx,
      ),
    ).toEqual({ kind: "apply" });
    textObjectDropSpec.applyDrop(
      betweenBlocks(editor, insertPos),
      "textobject:exampleItem:iB",
      ctx,
    );

    expect(dispatched).toHaveLength(1);
    const result = dispatched[0].doc;
    expect(() => result.check()).not.toThrow();

    const block = result.child(result.childCount - 1);
    expect(block.type.name).toBe("exampleBlock");
    // The outer list kept its one remaining item; nothing was split.
    expect(findByType(result, "exampleBlock")).toHaveLength(1);
    const outer = block.child(0);
    expect(outer.type.name).toBe("exampleItemList");
    expect(outer.childCount).toBe(1);

    // The nested list gained the dragged item, between "one" and "two".
    const nested = outer.child(0).child(1);
    expect(nested.type.name).toBe("exampleItemList");
    expect(nested.childCount).toBe(3);
    expect([
      nested.child(0).textContent,
      nested.child(1).textContent,
      nested.child(2).textContent,
    ]).toEqual(["one", "beta", "two"]);
    // Moved, not copied — and no uuid was duplicated by a container split.
    const uuids = findByType(result, "exampleItem").map((i) => i.uuid);
    expect(uuids.filter((u) => u === "iB")).toHaveLength(1);
    expect(new Set(uuids).size).toBe(uuids.length);
  });

  it("CONTROL: the TOP tier still works (it always did — the failure was tier-specific)", () => {
    const d = nestedDoc();
    const { editor, dispatched, ctx } = mockEditor(d);
    // Drag the nested "two" out to the boundary before the OUTER item "beta".
    const insertPos = findByType(d, "exampleItem").find((i) => i.uuid === "iB")!
      .pos;
    textObjectDropSpec.applyDrop(
      betweenBlocks(editor, insertPos),
      "textobject:exampleItem:i2",
      ctx,
    );

    expect(dispatched).toHaveLength(1);
    const result = dispatched[0].doc;
    expect(() => result.check()).not.toThrow();
    const outer = result.child(result.childCount - 1).child(0);
    expect(outer.childCount).toBe(3);
    expect(outer.child(1).textContent).toBe("two");
  });

  it("NON-REGRESSION: a cross-kind sub-item still no-ops at the nested gap (task 065)", () => {
    // A listItem released in the same nested exampleItem gap: the true parent
    // rejects a bare listItem AND a fresh bulletList, so the drop is refused —
    // canDropDirect-first widens nothing for a payload the container can't hold.
    const d = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "bulletList",
          attrs: { uuid: "L" },
          content: [
            {
              type: "listItem",
              attrs: { uuid: "li1" },
              content: [
                { type: "paragraph", content: [{ type: "text", text: "one" }] },
              ],
            },
            {
              type: "listItem",
              attrs: { uuid: "li2" },
              content: [
                { type: "paragraph", content: [{ type: "text", text: "two" }] },
              ],
            },
          ],
        },
        nestedDoc().child(1).toJSON(),
      ],
    });
    const { editor, dispatched, ctx } = mockEditor(d);
    const insertPos = findByType(d, "exampleItem").find((i) => i.uuid === "i2")!
      .pos;
    textObjectDropSpec.applyDrop(
      betweenBlocks(editor, insertPos),
      "textobject:listItem:li1",
      ctx,
    );
    expect(dispatched).toHaveLength(0);
  });
});
