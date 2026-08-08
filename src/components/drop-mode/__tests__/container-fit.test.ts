// @vitest-environment jsdom
/**
 * Task 257 — ONE container fit for every between-blocks insert.
 *
 * "How does this block fit the container I released it over?" used to be
 * answered in two divergent places and not at all in two others: the text-range
 * move restated a LIST-ONLY literal, the whole-node move went through the
 * registry adapters (which know expex and the sub-object containers but not
 * lists), and `util/block-move.ts` + `stack-pull.ts` asked nothing. Both
 * half-answers produced the SAME corruption from opposite directions — the
 * container torn in two, both halves keeping the original uuid, the payload
 * stranded at top level between them:
 *
 *   • a text selection released in an expex item gap  → the example split (257);
 *   • a paragraph released in a list-item gap         → the list split (mirror).
 *
 * Everything now routes through `fitNodesAtInsert` → `fitNodeInContainer`:
 * direct where the parent accepts the bare node, wrapped in a fresh
 * `listItem` / `exampleItem` / list / example where a wrapper does, direct
 * where ProseMirror's fitter can PAD without tearing (the shipped A1/065
 * displayMath-at-index-0 behavior), and refused where the only landing is a
 * tear — because a between-blocks move deletes its source in the same
 * transaction, so an unrepresentable insert is content loss, not a mis-fit.
 *
 * Run against the REAL editor schema (`buildEditorExtensions`), so the expex
 * and list content expressions are the authentic ones. Non-destructive
 * throughout: build the dispatched transaction and inspect `tr.doc`; the live
 * doc is never touched.
 *
 * (The extension barrel transitively imports `@/lib/storage`, whose
 * `require("@/lib/storage-fsa")` vitest can't resolve — stubbed wholesale, the
 * same pattern the sibling real-schema test uses.)
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
import { fitNodeInContainer } from "@/text-objects/drop-adapters";
import { blockMoveSpec } from "../util/block-move";
import { fitNodesAtInsert } from "../specs/drop-context";
import { textObjectDropSpec } from "../specs/textobject";
import { textRangeMoveDropSpec } from "../specs/text-range-move";
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
  } as unknown as EditorExtensionsCtx;
}

const schema: Schema = getSchema(buildEditorExtensions(mainCtx()));

const ZERO = { x: 0, y: 0, width: 0, height: 0 };
const RANGE_KEY = "textobject:linkedRange:a1";

function mockEditor(d: PMNode) {
  const dispatched: Transaction[] = [];
  const state = EditorState.create({ schema, doc: d });
  const editor = {
    state,
    view: {
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
  return { kind: "between-blocks", editor, insertPos, rect: ZERO };
}

interface NodeInfo {
  pos: number;
  size: number;
  uuid: string | null;
  text: string;
  node: PMNode;
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
        node: n,
      });
    }
    return true;
  });
  return out;
}

/** The corruption signature this whole task is about: one container torn into
 *  two nodes that BOTH carry the original uuid. */
function uuidsAreUnique(d: PMNode): boolean {
  const seen = new Set<string>();
  let ok = true;
  d.descendants((n) => {
    const u = n.attrs?.uuid as string | undefined;
    if (!u) return true;
    if (seen.has(u)) ok = false;
    seen.add(u);
    return true;
  });
  return ok;
}

/** A doc with a 2-item example and a source paragraph carrying a transient
 *  `linkedAnchor` over the word MOVED — the exact shape of the reported drag. */
function docWithExampleAndMarkedRange(): PMNode {
  return schema.nodeFromJSON({
    type: "doc",
    content: [
      {
        type: "exampleBlock",
        attrs: { uuid: "E", kind: "multi" },
        content: [
          {
            type: "exampleItemList",
            content: [
              {
                type: "exampleItem",
                attrs: { uuid: "i1" },
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "alpha" }] },
                ],
              },
              {
                type: "exampleItem",
                attrs: { uuid: "i2" },
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "beta" }] },
                ],
              },
            ],
          },
        ],
      },
      {
        type: "paragraph",
        attrs: { uuid: "src" },
        content: [
          { type: "text", text: "keep " },
          {
            type: "text",
            text: "MOVED",
            marks: [
              {
                type: "linkedAnchor",
                attrs: { anchorId: "a1", kind: "transient" },
              },
            ],
          },
        ],
      },
    ],
  });
}

// ── 1. The reported bug: a text selection into an expex between-items gap ────

describe("text-range move into an expex example (task 257)", () => {
  it("lands as a fresh exampleItem inside the SAME example — never a bare paragraph in exampleItemList", () => {
    const d = docWithExampleAndMarkedRange();
    const { editor, dispatched, ctx } = mockEditor(d);
    const items = findByType(d, "exampleItem");
    const gap = items[1].pos; // the boundary between item 1 and item 2

    textRangeMoveDropSpec.applyDrop(betweenBlocks(editor, gap), RANGE_KEY, ctx);

    expect(dispatched).toHaveLength(1);
    const result = dispatched[0].doc;
    expect(() => result.check()).not.toThrow();

    // ONE example still — pre-fix the fitter split it in two.
    const blocks = findByType(result, "exampleBlock");
    expect(blocks).toHaveLength(1);
    expect(uuidsAreUnique(result)).toBe(true);

    // Three items now, the moved run as the middle one, in order.
    const list = findByType(result, "exampleItemList")[0].node;
    expect(list.childCount).toBe(3);
    expect([
      list.child(0).textContent,
      list.child(1).textContent,
      list.child(2).textContent,
    ]).toEqual(["alpha", "MOVED", "beta"]);
    expect(list.child(1).type.name).toBe("exampleItem");
    expect(typeof list.child(1).attrs.uuid).toBe("string"); // fresh, backfill-compatible

    // Nothing stranded at top level, and the source shed the run + its mark.
    const topParagraphs = [];
    for (let i = 0; i < result.childCount; i++) {
      if (result.child(i).type.name === "paragraph") {
        topParagraphs.push(result.child(i).textContent);
      }
    }
    expect(topParagraphs).toEqual(["keep "]);
    let anyAnchorMark = false;
    result.descendants((n) => {
      if (n.marks.some((m) => m.type.name === "linkedAnchor")) anyAnchorMark = true;
      return true;
    });
    expect(anyAnchorMark).toBe(false);
  });

  it("a SINGLE example's widened body takes the run BARE (drop-direct, still one example)", () => {
    // `exampleBlock`'s real content admits a paragraph directly (Feature A2), so
    // the A2 body position must NOT be wrapped into a new numbered item.
    const d = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "exampleBlock",
          attrs: { uuid: "E", kind: "single" },
          content: [{ type: "paragraph", content: [{ type: "text", text: "body" }] }],
        },
        {
          type: "paragraph",
          attrs: { uuid: "src" },
          content: [
            { type: "text", text: "keep " },
            {
              type: "text",
              text: "MOVED",
              marks: [{ type: "linkedAnchor", attrs: { anchorId: "a1", kind: "transient" } }],
            },
          ],
        },
      ],
    });
    const { editor, dispatched, ctx } = mockEditor(d);
    const body = findByType(d, "paragraph")[0]; // the example's own body paragraph
    const insertPos = body.pos + body.size; // after it, still inside the exampleBlock

    textRangeMoveDropSpec.applyDrop(betweenBlocks(editor, insertPos), RANGE_KEY, ctx);

    const result = dispatched[0].doc;
    expect(() => result.check()).not.toThrow();
    expect(findByType(result, "exampleBlock")).toHaveLength(1);
    expect(findByType(result, "exampleItem")).toHaveLength(0); // no item machinery
    const block = findByType(result, "exampleBlock")[0].node;
    expect(block.childCount).toBe(2);
    expect(block.child(1).type.name).toBe("paragraph");
    expect(block.child(1).textContent).toBe("MOVED");
  });

  it("a MULTI-block range into the item gap becomes ONE item PER block (the wrap semantics every other site uses)", () => {
    const d = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "exampleBlock",
          attrs: { uuid: "E", kind: "multi" },
          content: [
            {
              type: "exampleItemList",
              content: [
                {
                  type: "exampleItem",
                  attrs: { uuid: "i1" },
                  content: [{ type: "paragraph", content: [{ type: "text", text: "alpha" }] }],
                },
              ],
            },
          ],
        },
        {
          type: "paragraph",
          attrs: { uuid: "s1" },
          content: [
            {
              type: "text",
              text: "one",
              marks: [{ type: "linkedAnchor", attrs: { anchorId: "a1", kind: "transient" } }],
            },
          ],
        },
        {
          type: "paragraph",
          attrs: { uuid: "s2" },
          content: [
            {
              type: "text",
              text: "two",
              marks: [{ type: "linkedAnchor", attrs: { anchorId: "a1", kind: "transient" } }],
            },
          ],
        },
      ],
    });
    const { editor, dispatched, ctx } = mockEditor(d);
    const item = findByType(d, "exampleItem")[0];
    const gap = item.pos + item.size; // after the only item, inside the list

    textRangeMoveDropSpec.applyDrop(betweenBlocks(editor, gap), RANGE_KEY, ctx);

    const result = dispatched[0].doc;
    expect(() => result.check()).not.toThrow();
    const list = findByType(result, "exampleItemList")[0].node;
    expect(list.childCount).toBe(3);
    expect([
      list.child(0).textContent,
      list.child(1).textContent,
      list.child(2).textContent,
    ]).toEqual(["alpha", "one", "two"]);
    expect(list.child(1).type.name).toBe("exampleItem");
    expect(list.child(2).type.name).toBe("exampleItem");
    // The container survived whole and each new item got its own fresh uuid.
    // (Global uuid uniqueness is NOT asserted here: a multi-block range move
    // copies the source blocks' own uuids into the moved slice while the cut
    // leaves an empty shell behind carrying the first one — a pre-existing
    // property of the range move's cut semantics, orthogonal to the container
    // fit and filed separately.)
    expect(findByType(result, "exampleBlock")).toHaveLength(1);
    const itemUuids = [list.child(1).attrs.uuid, list.child(2).attrs.uuid];
    expect(new Set(itemUuids).size).toBe(2);
    expect(itemUuids).not.toContain("i1");
  });
});

// ── 2. The list contexts the old literal handled — unchanged ────────────────

describe("text-range move — the pre-existing contexts are byte-compatible", () => {
  function docWithListAndMarkedRange(listType: "bulletList" | "orderedList"): PMNode {
    return schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: listType,
          attrs: { uuid: "L" },
          content: [
            {
              type: "listItem",
              attrs: { uuid: "li1" },
              content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }],
            },
            {
              type: "listItem",
              attrs: { uuid: "li2" },
              content: [{ type: "paragraph", content: [{ type: "text", text: "two" }] }],
            },
          ],
        },
        {
          type: "paragraph",
          attrs: { uuid: "src" },
          content: [
            { type: "text", text: "keep " },
            {
              type: "text",
              text: "MOVED",
              marks: [{ type: "linkedAnchor", attrs: { anchorId: "a1", kind: "transient" } }],
            },
          ],
        },
      ],
    });
  }

  for (const listType of ["bulletList", "orderedList"] as const) {
    it(`a ${listType} item gap still wraps the run in a fresh listItem (list stays whole)`, () => {
      const d = docWithListAndMarkedRange(listType);
      const { editor, dispatched, ctx } = mockEditor(d);
      const items = findByType(d, "listItem");

      textRangeMoveDropSpec.applyDrop(betweenBlocks(editor, items[1].pos), RANGE_KEY, ctx);

      const result = dispatched[0].doc;
      expect(() => result.check()).not.toThrow();
      expect(findByType(result, listType)).toHaveLength(1); // NOT split
      const list = findByType(result, listType)[0].node;
      expect(list.childCount).toBe(3);
      expect([
        list.child(0).textContent,
        list.child(1).textContent,
        list.child(2).textContent,
      ]).toEqual(["one", "MOVED", "two"]);
      expect(uuidsAreUnique(result)).toBe(true);
    });
  }

  it("a top-level gap still takes the run as a bare paragraph", () => {
    const d = schema.nodeFromJSON({
      type: "doc",
      content: [
        { type: "paragraph", attrs: { uuid: "p1" }, content: [{ type: "text", text: "first" }] },
        {
          type: "paragraph",
          attrs: { uuid: "src" },
          content: [
            { type: "text", text: "keep " },
            {
              type: "text",
              text: "MOVED",
              marks: [{ type: "linkedAnchor", attrs: { anchorId: "a1", kind: "transient" } }],
            },
          ],
        },
      ],
    });
    const { editor, dispatched, ctx } = mockEditor(d);
    const gap = d.firstChild!.nodeSize;

    textRangeMoveDropSpec.applyDrop(betweenBlocks(editor, gap), RANGE_KEY, ctx);

    const result = dispatched[0].doc;
    expect(() => result.check()).not.toThrow();
    expect(result.child(1).type.name).toBe("paragraph");
    expect(result.child(1).textContent).toBe("MOVED");
    expect(findByType(result, "listItem")).toHaveLength(0);
    expect(findByType(result, "exampleItem")).toHaveLength(0);
  });
});

// ── 3. The MIRROR bug: a whole-block move into a list-item gap ──────────────

describe("whole-node move into a list (the mirror of 257)", () => {
  function docWithParagraphAndList(): PMNode {
    return schema.nodeFromJSON({
      type: "doc",
      content: [
        { type: "paragraph", attrs: { uuid: "p1" }, content: [{ type: "text", text: "dragged" }] },
        {
          type: "bulletList",
          attrs: { uuid: "L" },
          content: [
            {
              type: "listItem",
              attrs: { uuid: "li1" },
              content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }],
            },
            {
              type: "listItem",
              attrs: { uuid: "li2" },
              content: [{ type: "paragraph", content: [{ type: "text", text: "two" }] }],
            },
          ],
        },
      ],
    });
  }

  it("a paragraph released in a list-item gap JOINS the list as a fresh item — it no longer tears it in two", () => {
    const d = docWithParagraphAndList();
    const { editor, dispatched, ctx } = mockEditor(d);
    const items = findByType(d, "listItem");

    textObjectDropSpec.applyDrop(
      betweenBlocks(editor, items[1].pos),
      "textobject:paragraph:p1",
      ctx,
    );

    const result = dispatched[0].doc;
    expect(() => result.check()).not.toThrow();
    // Pre-fix: TWO bulletLists, both with uuid "L", the paragraph stranded
    // between them at top level.
    expect(findByType(result, "bulletList")).toHaveLength(1);
    expect(uuidsAreUnique(result)).toBe(true);
    const list = findByType(result, "bulletList")[0].node;
    expect(list.childCount).toBe(3);
    expect([
      list.child(0).textContent,
      list.child(1).textContent,
      list.child(2).textContent,
    ]).toEqual(["one", "dragged", "two"]);
    expect(list.child(1).type.name).toBe("listItem");
    expect(result.childCount).toBe(1); // nothing left at top level
  });

  it("an exampleBlock card released in ANOTHER example's item gap REFUSES — the doc is untouched", () => {
    // Nothing in the wrap vocabulary can hold an exampleBlock inside an
    // `exampleItemList`, and the fitter's only landing is a tear — so the drop
    // dispatches nothing rather than splitting the host example.
    const d = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "exampleBlock",
          attrs: { uuid: "HOST", kind: "multi" },
          content: [
            {
              type: "exampleItemList",
              content: [
                {
                  type: "exampleItem",
                  attrs: { uuid: "i1" },
                  content: [{ type: "paragraph", content: [{ type: "text", text: "alpha" }] }],
                },
                {
                  type: "exampleItem",
                  attrs: { uuid: "i2" },
                  content: [{ type: "paragraph", content: [{ type: "text", text: "beta" }] }],
                },
              ],
            },
          ],
        },
        {
          type: "exampleBlock",
          attrs: { uuid: "MOVER", kind: "single" },
          content: [{ type: "paragraph", content: [{ type: "text", text: "mover" }] }],
        },
      ],
    });
    const { editor, dispatched, ctx } = mockEditor(d);
    const items = findByType(d, "exampleItem");
    const gap = items[1].pos;

    // Both doors — the text-object move spec and the block-move factory.
    textObjectDropSpec.applyDrop(
      betweenBlocks(editor, gap),
      "textobject:exampleBlock:MOVER",
      ctx,
    );
    blockMoveSpec({ nodeName: "exampleBlock" }).applyDrop(
      betweenBlocks(editor, gap),
      "example:MOVER",
      ctx,
    );

    expect(dispatched).toHaveLength(0);
  });
});

// ── 4. The fit itself — the ladder, in isolation ────────────────────────────

describe("fitNodeInContainer — the ladder", () => {
  const para = (text: string) =>
    schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined);

  function parentAt(d: PMNode, insertPos: number) {
    const $pos = d.resolve(insertPos);
    return { parent: $pos.parent, index: $pos.index() };
  }

  it("DIRECT where the parent accepts the bare node", () => {
    const d = schema.nodeFromJSON({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }],
    });
    const { parent, index } = parentAt(d, d.content.size);
    expect(fitNodeInContainer(parent, index, para("x"), schema).kind).toBe("direct");
  });

  it("WRAP in a listItem at a list gap, and in an exampleItem at an expex item gap", () => {
    const d = docWithExampleAndMarkedRange();
    const items = findByType(d, "exampleItem");
    const ex = parentAt(d, items[1].pos);
    const exFit = fitNodeInContainer(ex.parent, ex.index, para("x"), schema);
    expect(exFit).toMatchObject({ kind: "wrap", parentKind: "exampleItem" });

    const withList = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "bulletList",
          attrs: { uuid: "L" },
          content: [
            {
              type: "listItem",
              attrs: { uuid: "li1" },
              content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }],
            },
          ],
        },
      ],
    });
    const li = findByType(withList, "listItem")[0];
    const lg = parentAt(withList, li.pos + li.size);
    expect(fitNodeInContainer(lg.parent, lg.index, para("x"), schema)).toMatchObject({
      kind: "wrap",
      parentKind: "listItem",
    });
  });

  it("`prefer` breaks the container tie: a pulled-out listItem rebuilds the list it came FROM", () => {
    const d = schema.nodeFromJSON({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }],
    });
    const { parent, index } = parentAt(d, d.content.size);
    const item = schema.nodes.listItem.create({ uuid: "li9" }, para("x"));
    expect(fitNodeInContainer(parent, index, item, schema)).toMatchObject({
      kind: "wrap",
      parentKind: "bulletList", // vocabulary order — the default
    });
    expect(
      fitNodeInContainer(parent, index, item, schema, { prefer: "orderedList" }),
    ).toMatchObject({ kind: "wrap", parentKind: "orderedList" });
  });

  it("REJECT with no probe, DIRECT when the probe says the fitter only PADS", () => {
    // An exampleItem is valid nowhere at top level and no wrapper but an
    // exampleBlock can hold it — which IS valid at top level, so this wraps.
    // The reject case needs a node no wrapper can hold: an exampleBlock inside
    // an exampleItemList.
    const d = docWithExampleAndMarkedRange();
    const items = findByType(d, "exampleItem");
    const { parent, index } = parentAt(d, items[1].pos);
    const block = schema.nodes.exampleBlock.create({ uuid: "X" }, para("y"));
    expect(fitNodeInContainer(parent, index, block, schema).kind).toBe("reject");
    // Same position, but a probe that reports the bare insert harmless → direct.
    expect(
      fitNodeInContainer(parent, index, block, schema, {
        bareInsertIsSafe: () => true,
      }).kind,
    ).toBe("direct");
  });
});

// ── 5. Atomicity — one unfittable node refuses the whole payload ────────────

describe("fitNodesAtInsert — atomic over the payload", () => {
  it("rejects the WHOLE run when a single node cannot land (a partial move would lose content)", () => {
    const d = docWithExampleAndMarkedRange();
    const { editor } = mockEditor(d);
    const items = findByType(d, "exampleItem");
    const gap = items[1].pos;
    const ok = schema.nodes.paragraph.create(null, schema.text("fits"));
    const bad = schema.nodes.exampleBlock.create(
      { uuid: "X" },
      schema.nodes.paragraph.create(null, schema.text("nope")),
    );

    expect(fitNodesAtInsert(editor, gap, [ok]).kind).toBe("ok");
    expect(fitNodesAtInsert(editor, gap, [ok, bad])).toEqual({
      kind: "reject",
      nodeType: "exampleBlock",
    });
  });

  it("PAD is allowed, TEAR is refused — the two fitter outcomes the probe separates", () => {
    // Both payloads are schema-INVALID as bare nodes at their target index and
    // no wrapper in the vocabulary fits either, so both reach the probe. They
    // must NOT get the same answer.
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
              content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }],
            },
            {
              type: "listItem",
              attrs: { uuid: "li2" },
              content: [{ type: "paragraph", content: [{ type: "text", text: "two" }] }],
            },
          ],
        },
      ],
    });
    const { editor } = mockEditor(d);
    const items = findByType(d, "listItem");

    // PAD — a displayMath at a listItem's index 0: `(paragraph|graphicsBlock)
    // block*` rejects it, but the fitter supplies the required paragraph and the
    // equation stays INSIDE the item. Shipped A1/065 behavior; must survive.
    const math = schema.nodes.displayMath.create({ uuid: "m1", latex: "a = b" });
    const padPos = items[0].pos + 1;
    const padFit = fitNodesAtInsert(editor, padPos, [math]);
    expect(padFit.kind).toBe("ok");
    if (padFit.kind === "ok") expect(padFit.nodes[0]).toBe(math); // unwrapped
    // …and the real insert keeps the list whole.
    const padded = editor.state.tr.insert(padPos, math).doc;
    expect(findByType(padded, "bulletList")).toHaveLength(1);
    expect(findByType(padded, "listItem")).toHaveLength(2);

    // TEAR — a heading at the gap BETWEEN two list items: `listItem+` rejects it
    // and no wrapper can hold a heading, so the fitter's only landing splits the
    // list in two (both keeping uuid "L"). Refused.
    const heading = schema.nodes.heading.create({ uuid: "h1", level: 1 }, schema.text("Title"));
    const tearPos = items[1].pos;
    expect(fitNodesAtInsert(editor, tearPos, [heading])).toEqual({
      kind: "reject",
      nodeType: "heading",
    });
    // Proof the refusal is warranted: the bare insert really does tear it.
    const torn = editor.state.tr.insert(tearPos, heading).doc;
    expect(findByType(torn, "bulletList")).toHaveLength(2);
    expect(findByType(torn, "bulletList").every((n) => n.uuid === "L")).toBe(true);
  });

  it("an out-of-range insert position rejects rather than throwing", () => {
    const d = docWithExampleAndMarkedRange();
    const { editor } = mockEditor(d);
    const para = schema.nodes.paragraph.create(null, schema.text("x"));
    expect(fitNodesAtInsert(editor, 99999, [para]).kind).toBe("reject");
    expect(fitNodesAtInsert(editor, -1, [para]).kind).toBe("reject");
    expect(fitNodesAtInsert(editor, 0, []).kind).toBe("ok");
  });
});
