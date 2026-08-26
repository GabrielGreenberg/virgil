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
import {
  chooseInsertCandidate,
  filterInsertCandidates,
  resolveInsertCandidates,
} from "../insert-candidates";
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
    // Renegotiated to the CANDIDATE LADDER (task 416): R3's peer resolver is
    // retired and the nested-tier boundary is simply the innermost candidate,
    // reached now for every payload rather than only a same-kind sub-item drag.
    // The claim this leg makes is unchanged — the affordance is offered where
    // the commit (the leg below) accepts it.
    const d = nestedDoc();
    const { editor } = mockEditor(d);
    const i2 = findByType(d, "exampleItem").find((i) => i.uuid === "i2")!;
    const chosen = chooseInsertCandidate(
      filterInsertCandidates(
        editor,
        resolveInsertCandidates(editor, i2.pos, 0),
        ["exampleItem"],
        // The source is a popped-out sub-item from another document in this
        // harness — no in-document range to be self against (task 480).
        null,
      ),
      10_000,
    );
    expect(chosen).not.toBeNull();
    expect(chosen!.refPos).toBe(i2.pos);
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

  it("NON-REGRESSION: a cross-kind sub-item neither lands nor tears at the nested gap", () => {
    // A listItem released in the same nested exampleItem gap: the true parent
    // rejects a bare listItem AND a fresh bulletList, so the drop is refused —
    // canDropDirect-first widens nothing for a payload the container can't hold.
    //
    // Scope, stated honestly: this leg pins the end-to-end OUTCOME (nothing
    // lands, nothing is torn) and NOT the task-065 adapter gate — the refusal is
    // over-determined here, since a lost gate would wrap into a `bulletList`
    // that `fitNodesAtInsert` then rejects on its own, and `dispatched` would
    // still be empty. The gate itself is pinned where it is decided, by the unit
    // leg in drop-adapters.test.ts ("the 065 gate is untouched where the schema
    // REFUSES the bare node"), which does fail if rung 4 loses it.
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

/**
 * The position half, surfaced by the adversarial review of the fix above.
 *
 * The same-editor commit deletes the source and then inserts, and it used to
 * PREDICT where the insert position had moved to: `insertPos - (to - from)`.
 * That assumes `tr.delete` removes exactly the source's declared node size, and
 * it does not when the source is the SOLE child of a container whose content
 * expression forbids emptiness — `exampleItemList` is `exampleItem+`, and
 * expex's own Tab keymap (single → multi) creates precisely that one-item shape.
 * ProseMirror keeps a minimal valid residue and removes only part of the range,
 * so the insert landed FOUR positions early, inside the preceding peer item —
 * which the fitter can only accommodate by closing that item, tearing one node
 * into two that both keep its uuid, on a document that still `check()`s clean.
 *
 * The defect is PRE-EXISTING (the top-tier leg below fails on `main` too), but
 * the nested tier is where task 234's rung 1 first routes a drop INTO it: before
 * the fix that gesture was a guaranteed no-op that left the document untouched.
 * So the two land together. Both legs fail against the `- (to - from)`
 * arithmetic and pass against `tr.mapping.map(insertPos)`.
 */
describe("a sole-item source: the insert position is MAPPED, never predicted", () => {
  //   exampleBlock M1 > exampleItemList > [exampleItem X "xx"]   ← X is the only item
  //   exampleBlock M2 > exampleItemList > [exampleItem a "aa"
  //                                          > exampleItemList > [n1 "nn1", n2 "nn2"]]
  const soleItemDoc = () =>
    schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "exampleBlock",
          attrs: { uuid: "M1", kind: "multi" },
          content: [
            { type: "exampleItemList", content: [item("X", "xx")] },
          ],
        },
        {
          type: "exampleBlock",
          attrs: { uuid: "M2", kind: "multi" },
          content: [
            {
              type: "exampleItemList",
              content: [
                item("a", "aa", [
                  {
                    type: "exampleItemList",
                    content: [item("n1", "nn1"), item("n2", "nn2")],
                  },
                ]),
              ],
            },
          ],
        },
      ],
    });

  it("lands in the NESTED gap without tearing the peer item or duplicating its uuid", () => {
    const d = soleItemDoc();
    const { editor, dispatched, ctx } = mockEditor(d);
    const insertPos = findByType(d, "exampleItem").find((i) => i.uuid === "n2")!
      .pos;
    textObjectDropSpec.applyDrop(
      betweenBlocks(editor, insertPos),
      "textobject:exampleItem:X",
      ctx,
    );

    expect(dispatched).toHaveLength(1);
    const result = dispatched[0].doc;
    expect(() => result.check()).not.toThrow();

    // The peer item survives WHOLE: one node, one uuid, its text intact.
    const items = findByType(result, "exampleItem");
    const n1s = items.filter((i) => i.uuid === "n1");
    expect(n1s).toHaveLength(1);
    expect(n1s[0].text).toBe("nn1");
    // …and the dragged item landed between the two nested peers, as pointed at.
    const nested = result.child(result.childCount - 1).child(0).child(0).child(1);
    expect(nested.type.name).toBe("exampleItemList");
    expect([
      nested.child(0).textContent,
      nested.child(1).textContent,
      nested.child(2).textContent,
    ]).toEqual(["nn1", "xx", "nn2"]);
  });

  it("PRE-EXISTING at the TOP tier too: the same sole-item source lands where the indicator pointed", () => {
    // This position was already drop-direct before task 234 (classifyParentAt
    // reports the compatible `exampleBlock`), so this leg fails on `main` —
    // the item silently landed back in its OWN list instead of the target's.
    const d = soleItemDoc();
    const { editor, dispatched, ctx } = mockEditor(d);
    const insertPos = findByType(d, "exampleItem").find((i) => i.uuid === "a")!
      .pos;
    textObjectDropSpec.applyDrop(
      betweenBlocks(editor, insertPos),
      "textobject:exampleItem:X",
      ctx,
    );

    expect(dispatched).toHaveLength(1);
    const result = dispatched[0].doc;
    expect(() => result.check()).not.toThrow();
    const target = result.child(result.childCount - 1).child(0);
    expect(target.type.name).toBe("exampleItemList");
    expect(target.child(0).textContent).toBe("xx"); // landed BEFORE item "a"
    expect(target.child(0).attrs.uuid).toBe("X");
  });
});
