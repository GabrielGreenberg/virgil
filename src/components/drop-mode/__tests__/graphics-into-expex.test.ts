// @vitest-environment jsdom
/**
 * Feature A0 — drop a picture (graphicsBlock) into an expex example.
 *
 * The schema already accepts a `graphicsBlock` inside an `exampleItem`
 * (`(paragraph | graphicsBlock)+`, expex.ts:787). This feature surfaces and
 * commits two expex-aware drops for a lifted graphicsBlock, the drop bar's
 * position choosing which:
 *   (b) OVER an item's content  → the picture is inserted directly into that
 *       exampleItem's content (drop-direct, classifyParentAt → exampleItem);
 *   (a) BETWEEN items / below the last item → the picture is wrapped in a fresh
 *       exampleItem inserted as a sibling (wrap, classifyParentAt → exampleBlock).
 *
 * Everything is gated on the source being a `graphicsBlock`, so every other
 * drag — and the picture's own TOP-LEVEL drop — is byte-unchanged.
 *
 * Both halves are locked here, headless (the live drop BAR is a trusted-hover
 * gesture verified by the user, not in vitest):
 *   1. `resolveBlockIntoExpex` — the new hit-test resolution (into-item content
 *      boundary vs. item boundary vs. fall-through-null), exercised against the
 *      over-content-vs-gap threshold via controllable DOM rects.
 *   2. `textObjectDropSpec.applyDrop` — fed each resolved insertPos, the commit
 *      lands the picture inside the item (case b) or as a fresh sibling item
 *      (case a); a top-level drop still drops-direct; a non-graphics source over
 *      the same expex is unaffected. Non-destructive: build the dispatched tr
 *      and inspect its doc (the technique from `sub-item-drop-resolution.test`).
 */

import { describe, expect, it } from "vitest";
import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import {
  makeBetweenBlocksPlacement,
  resolveBlockIntoExpex,
} from "../hit-test";
import { classifyParentAt } from "../specs/drop-context";
import { textObjectDropSpec } from "../specs/textobject";
import type { DropCtx, Placement } from "../types";

// Hand-rolled schema — node names match TEXT_OBJECT_REGISTRY keys so the real
// `classifyParentAt` recognizes each context. `exampleItem` mirrors the real
// `(paragraph | graphicsBlock)+` content (expex.ts:787); `exampleItemList` is
// deliberately NOT a registry kind, so a between-items insert classifies as
// `exampleBlock` (incompatible → wrap) and an into-item insert as `exampleItem`
// (compatible → drop-direct).
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      attrs: { uuid: { default: null } },
      toDOM: () => ["p", 0],
    },
    graphicsBlock: {
      group: "block",
      atom: true,
      attrs: { uuid: { default: null } },
      toDOM: () => ["div", { class: "graphic" }],
    },
    exampleBlock: {
      group: "block",
      content: "exampleItemList+",
      attrs: { uuid: { default: null } },
      toDOM: () => ["div", 0],
    },
    exampleItemList: {
      content: "exampleItem+",
      toDOM: () => ["div", 0],
    },
    exampleItem: {
      content: "(paragraph | graphicsBlock)+",
      attrs: { uuid: { default: null } },
      toDOM: () => ["div", 0],
    },
    text: { group: "inline" },
  },
});

const t = (text: string) => schema.text(text);
const para = (text: string, uuid?: string) =>
  schema.nodes.paragraph.create(uuid ? { uuid } : null, text ? t(text) : undefined);
const gfx = (uuid: string) => schema.nodes.graphicsBlock.create({ uuid });
const exItem = (uuid: string, ...content: PMNode[]) =>
  schema.nodes.exampleItem.create({ uuid }, content);
const exList = (...items: PMNode[]) =>
  schema.nodes.exampleItemList.create(null, items);
const exBlock = (uuid: string, ...items: PMNode[]) =>
  schema.nodes.exampleBlock.create({ uuid }, exList(...items));
const doc = (...blocks: PMNode[]) => schema.nodes.doc.create(null, blocks);

const ZERO = { x: 0, y: 0, width: 0, height: 0 };

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

/**
 * `rects` maps a node's start position (the `pos` from `findByType`) to a
 * partial DOMRect. `nodeDOM(pos)` returns an element carrying that rect; the
 * resolver stores the element it gets and `makeBetweenBlocksPlacement` reuses
 * it, so a single map entry drives both the over-content-vs-gap decision and
 * the midpoint snap.
 */
function mockEditor(d: PMNode, rects: Record<number, Partial<DOMRect>> = {}) {
  const dispatched: Transaction[] = [];
  const state = EditorState.create({ schema, doc: d });
  const editor = {
    state,
    view: {
      nodeDOM: (pos: number) => {
        const el = document.createElement("div");
        const box = {
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          width: 0,
          height: 0,
          x: 0,
          y: 0,
          ...(rects[pos] ?? {}),
        };
        el.getBoundingClientRect = () => ({ ...box, toJSON: () => box }) as DOMRect;
        return el;
      },
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

// A canonical doc: a top-level picture followed by a packed 3-item example.
function packedDoc() {
  return doc(
    gfx("g1"),
    exBlock(
      "E",
      exItem("i1", para("alpha")),
      exItem("i2", para("beta")),
      exItem("i3", para("gamma")),
    ),
  );
}

// ── 1. resolveBlockIntoExpex — source-kind-aware resolution + threshold ──────

describe("resolveBlockIntoExpex — into-item vs between-item resolution", () => {
  it("graphicsBlock OVER an item's content resolves the content-block boundary INSIDE the item (case b)", () => {
    const d = packedDoc();
    const para1 = findByType(d, "paragraph")[0]; // "alpha", inside item i1
    // Paragraph rect spans y∈[100,140]; cursor at 120 sits over the content.
    const { editor } = mockEditor(d, {
      [para1.pos]: { top: 100, bottom: 140, height: 40 },
    });
    const block = resolveBlockIntoExpex(
      editor,
      para1.pos + 1, // a caret inside the paragraph's text
      120,
      "textobject:graphicsBlock:g1",
    );
    expect(block).not.toBeNull();
    // The resolved block is the CONTENT paragraph (depth 4), not the item.
    expect(block!.blockPos).toBe(para1.pos);
    // Top half of the content rect → insert before the paragraph, inside the
    // item → classifyParentAt sees the enclosing exampleItem (case b).
    const placement = makeBetweenBlocksPlacement(editor, block!, 110, true);
    expect(placement.kind).toBe("between-blocks");
    const insertPos = (placement as Extract<Placement, { kind: "between-blocks" }>).insertPos;
    expect(insertPos).toBe(para1.pos);
    expect(classifyParentAt(editor, insertPos)).toBe("exampleItem");
  });

  it("graphicsBlock inside an item but BELOW its content resolves the item boundary (case a)", () => {
    const d = packedDoc();
    const para1 = findByType(d, "paragraph")[0]; // "alpha"
    const item1 = findByType(d, "exampleItem")[0];
    // Content rect ends at y=140; item rect spans [100,200]. Cursor at 190 is
    // below the content but still inside the item → fall to the item boundary.
    const { editor } = mockEditor(d, {
      [para1.pos]: { top: 100, bottom: 140, height: 40 },
      [item1.pos]: { top: 100, bottom: 200, height: 100 },
    });
    const block = resolveBlockIntoExpex(
      editor,
      para1.pos + 1,
      190,
      "textobject:graphicsBlock:g1",
    );
    expect(block).not.toBeNull();
    expect(block!.blockPos).toBe(item1.pos); // the ITEM boundary, not the paragraph
    // Cursor below the item's midpoint (150) → insert AFTER the item.
    const placement = makeBetweenBlocksPlacement(editor, block!, 190, true);
    const insertPos = (placement as Extract<Placement, { kind: "between-blocks" }>).insertPos;
    expect(insertPos).toBe(item1.pos + item1.size);
    // A between-items insert classifies as the enclosing exampleBlock (case a).
    expect(classifyParentAt(editor, insertPos)).toBe("exampleBlock");
  });

  it("a NON-graphics source over the same expex returns null (resolution unchanged → falls through)", () => {
    const d = packedDoc();
    const para1 = findByType(d, "paragraph")[0];
    const { editor } = mockEditor(d, {
      [para1.pos]: { top: 100, bottom: 140, height: 40 },
    });
    // A paragraph / exampleItem / heading source is unaffected by A0.
    expect(
      resolveBlockIntoExpex(editor, para1.pos + 1, 120, "textobject:paragraph:x"),
    ).toBeNull();
    expect(
      resolveBlockIntoExpex(editor, para1.pos + 1, 120, "textobject:exampleItem:i9"),
    ).toBeNull();
  });

  it("a graphicsBlock NOT inside an exampleBlock returns null (top-level drop preserved)", () => {
    const d = doc(gfx("g1"), para("plain", "pp"));
    const plain = findByType(d, "paragraph")[0];
    const { editor } = mockEditor(d, {
      [plain.pos]: { top: 100, bottom: 140, height: 40 },
    });
    expect(
      resolveBlockIntoExpex(editor, plain.pos + 1, 120, "textobject:graphicsBlock:g1"),
    ).toBeNull();
  });
});

// ── 2. applyDrop commit — non-destructive tr.doc inspection ──────────────────

describe("textObjectDropSpec commit — picture into expex", () => {
  it("CASE b: a graphicsBlock dropped INTO an item lands in that item's content (drop-direct)", () => {
    const d = packedDoc();
    const { editor, dispatched, ctx } = mockEditor(d);
    const para1 = findByType(d, "paragraph")[0]; // "alpha" in item i1
    const insertPos = para1.pos; // before the paragraph, inside item i1
    const KEY = "textobject:graphicsBlock:g1";

    expect(textObjectDropSpec.classifyDrop(betweenBlocks(editor, insertPos), KEY, ctx)).toEqual({
      kind: "apply",
    });
    textObjectDropSpec.applyDrop(betweenBlocks(editor, insertPos), KEY, ctx);

    const result = dispatched[0].doc;
    // The picture left the top level — only the exampleBlock remains there.
    expect(result.childCount).toBe(1);
    expect(result.child(0).type.name).toBe("exampleBlock");
    const list = result.child(0).child(0); // exampleItemList
    expect(list.childCount).toBe(3); // still 3 items
    const item0 = list.child(0);
    expect(item0.type.name).toBe("exampleItem");
    expect(item0.childCount).toBe(2); // graphicsBlock + paragraph
    expect(item0.child(0).type.name).toBe("graphicsBlock");
    expect(item0.child(0).attrs.uuid).toBe("g1"); // same node, moved
    expect(item0.child(1).textContent).toBe("alpha");
    // No stray graphicsBlock anywhere else.
    expect(findByType(result, "graphicsBlock")).toHaveLength(1);
  });

  it("CASE a: a graphicsBlock dropped BETWEEN items becomes a fresh sibling exampleItem (wrap)", () => {
    const d = packedDoc();
    const { editor, dispatched, ctx } = mockEditor(d);
    const items = findByType(d, "exampleItem");
    const insertPos = items[1].pos; // boundary between i1 and i2
    textObjectDropSpec.applyDrop(betweenBlocks(editor, insertPos), "textobject:graphicsBlock:g1", ctx);

    const result = dispatched[0].doc;
    expect(result.childCount).toBe(1); // picture left top level
    const list = result.child(0).child(0); // exampleItemList
    expect(list.childCount).toBe(4); // one new item inserted
    expect(list.child(0).textContent).toBe("alpha"); // i1
    const newItem = list.child(1);
    expect(newItem.type.name).toBe("exampleItem");
    expect(newItem.childCount).toBe(1);
    expect(newItem.child(0).type.name).toBe("graphicsBlock");
    expect(newItem.child(0).attrs.uuid).toBe("g1");
    expect(typeof newItem.attrs.uuid).toBe("string"); // fresh, backfill-compatible uuid
    expect(newItem.attrs.uuid).not.toBe("i1");
    expect(list.child(2).textContent).toBe("beta"); // i2
    expect(list.child(3).textContent).toBe("gamma"); // i3
    expect(findByType(result, "graphicsBlock")).toHaveLength(1);
  });

  it("NON-REGRESSION: a graphicsBlock at a TOP-LEVEL gap still drops directly (unchanged)", () => {
    const d = doc(gfx("g1"), para("a", "pa"), para("b", "pb"));
    const { editor, dispatched, ctx } = mockEditor(d);
    const paras = findByType(d, "paragraph");
    const insertPos = paras[0].pos + paras[0].size; // between "a" and "b" at top level
    textObjectDropSpec.applyDrop(betweenBlocks(editor, insertPos), "textobject:graphicsBlock:g1", ctx);

    const result = dispatched[0].doc;
    expect(result.childCount).toBe(3);
    expect(result.child(0).textContent).toBe("a");
    expect(result.child(1).type.name).toBe("graphicsBlock"); // dropped direct, NOT wrapped
    expect(result.child(1).attrs.uuid).toBe("g1");
    expect(result.child(2).textContent).toBe("b");
  });

  it("NON-REGRESSION: a non-graphics (exampleItem) source over the expex still reorders as a sibling", () => {
    const d = doc(
      exBlock(
        "E",
        exItem("i1", para("alpha")),
        exItem("i2", para("beta")),
        exItem("i3", para("gamma")),
      ),
    );
    const { editor, dispatched, ctx } = mockEditor(d);
    const items = findByType(d, "exampleItem");
    // Move "gamma" (i3) to the boundary between i1 and i2 — pure R3 behavior,
    // unaffected by the A0 adapter/classify changes.
    const insertPos = items[1].pos;
    textObjectDropSpec.applyDrop(betweenBlocks(editor, insertPos), "textobject:exampleItem:i3", ctx);

    const list = dispatched[0].doc.firstChild!.firstChild!;
    expect(list.type.name).toBe("exampleItemList");
    expect(list.childCount).toBe(3); // reordered, not added
    expect([
      list.child(0).textContent,
      list.child(1).textContent,
      list.child(2).textContent,
    ]).toEqual(["alpha", "gamma", "beta"]);
  });
});
