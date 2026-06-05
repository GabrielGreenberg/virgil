// @vitest-environment jsdom
/**
 * Feature A1 — the unified expex drop: any of three block kinds (paragraph =
 * text, graphicsBlock = picture, displayMath = equation) lands in an example
 * behind ONE forgiving left-edge VERTICAL bar that snaps to the nearest slot.
 *
 * A1 evolves A0 (graphics-only, hard-to-hit horizontal item-bars). The COMMIT
 * half is reused unchanged — drop-direct into an item [case b] or wrap into a
 * fresh sibling exampleItem [case a], chosen by which slot the bar snapped to.
 * The AFFORDANCE half is new: `resolveBlockIntoExpex` now returns a vertical-bar
 * `Placement` (height > width, x at the exampleBlock's left edge) whose insertPos
 * is the nearest of the block's enumerated slots to the cursor Y.
 *
 * Everything is gated on the source kind ∈ the three kinds AND the cursor being
 * inside an exampleBlock, so every other drag — and each kind's own TOP-LEVEL
 * drop — is byte-unchanged.
 *
 * Both halves are locked here, headless (the live drop BAR is a trusted-hover
 * gesture verified by the user, not in vitest):
 *   1. `resolveBlockIntoExpex` — the vertical-bar resolution + nearest-slot snap
 *      (new-item gap vs into-item content) across controllable DOM rects, for all
 *      three kinds; null for every other source / outside an expex.
 *   2. `textObjectDropSpec.applyDrop` — fed each resolved insertPos, the commit
 *      lands the block inside the item (case b) or as a fresh sibling item
 *      (case a); a top-level drop still drops-direct; a non-{three-kind} source
 *      over the same expex is unaffected. Non-destructive: build the dispatched
 *      tr and inspect its doc.
 */

import { describe, expect, it } from "vitest";
import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { resolveBlockIntoExpex } from "../hit-test";
import { classifyParentAt } from "../specs/drop-context";
import { textObjectDropSpec } from "../specs/textobject";
import type { DropCtx, Placement } from "../types";

// Hand-rolled schema — node names match TEXT_OBJECT_REGISTRY keys so the real
// `classifyParentAt` recognizes each context. `exampleItem` mirrors the real
// A1 `(paragraph | graphicsBlock | displayMath)+` content (expex.ts);
// `exampleItemList` is deliberately NOT a registry kind, so a between-items
// insert classifies as `exampleBlock` (incompatible → wrap) and an into-item
// insert as `exampleItem` (compatible → drop-direct).
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
    displayMath: {
      group: "block",
      atom: true,
      attrs: { uuid: { default: null }, latex: { default: "" } },
      toDOM: () => ["div", { class: "math" }],
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
      content: "(paragraph | graphicsBlock | displayMath)+",
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
const dm = (uuid: string, latex = "x = 1") =>
  schema.nodes.displayMath.create({ uuid, latex });
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

/** `rects` maps a node's start position to a partial DOMRect; `nodeDOM(pos)`
 *  returns an element carrying that rect. The resolver reads the exampleBlock
 *  rect (for the bar's left edge) and each top-tier item's rect (for the slot
 *  Y values), so one map drives the whole snap. */
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

function asBetween(p: Placement | null) {
  expect(p).not.toBeNull();
  expect(p!.kind).toBe("between-blocks");
  return p as Extract<Placement, { kind: "between-blocks" }>;
}

// A canonical doc: a draggable block of each kind at the top, then a packed
// 3-item example. Block left edge = 50; items tile [100,140] [140,180] [180,220].
function packedDoc() {
  return doc(
    para("dragP", "psrc"),
    dm("dsrc", "a = b"),
    gfx("g1"),
    exBlock(
      "E",
      exItem("i1", para("alpha")),
      exItem("i2", para("beta")),
      exItem("i3", para("gamma")),
    ),
  );
}

function packedRects(d: PMNode): Record<number, Partial<DOMRect>> {
  const block = findByType(d, "exampleBlock")[0];
  const items = findByType(d, "exampleItem");
  return {
    [block.pos]: { left: 50, top: 100, bottom: 220, height: 120, width: 300 },
    [items[0].pos]: { left: 50, top: 100, bottom: 140, height: 40, width: 300 },
    [items[1].pos]: { left: 50, top: 140, bottom: 180, height: 40, width: 300 },
    [items[2].pos]: { left: 50, top: 180, bottom: 220, height: 40, width: 300 },
  };
}

const THREE_KINDS = [
  { kind: "paragraph", key: "textobject:paragraph:psrc", uuid: "psrc" },
  { kind: "graphicsBlock", key: "textobject:graphicsBlock:g1", uuid: "g1" },
  { kind: "displayMath", key: "textobject:displayMath:dsrc", uuid: "dsrc" },
] as const;

// ── 1. resolveBlockIntoExpex — vertical bar + nearest-slot snap ──────────────

describe("resolveBlockIntoExpex — vertical-bar affordance + snap", () => {
  for (const { kind, key } of THREE_KINDS) {
    it(`${kind}: returns a VERTICAL bar (height > width) at the block's left edge`, () => {
      const d = packedDoc();
      const { editor } = mockEditor(d, packedRects(d));
      // A caret inside item i1's content; cursor anywhere on the left band.
      const caret = findByType(d, "exampleItem")[0].pos + 1;
      const p = asBetween(resolveBlockIntoExpex(editor, caret, 120, key));
      expect(p.rect.height).toBeGreaterThan(p.rect.width);
      expect(p.rect.x).toBe(50); // the exampleBlock's left edge
      expect(p.rect.width).toBeLessThanOrEqual(4); // a thin bar
    });

    it(`${kind}: snaps to the nearest slot as the cursor moves up/down`, () => {
      const d = packedDoc();
      const { editor } = mockEditor(d, packedRects(d));
      const caret = findByType(d, "exampleItem")[0].pos + 1;

      // Near the TOP edge of item i1 → a new-item gap (classify → exampleBlock).
      const top = asBetween(resolveBlockIntoExpex(editor, caret, 101, key));
      expect(classifyParentAt(editor, top.insertPos)).toBe("exampleBlock");

      // Over the MIDDLE of item i1's body → into-content (classify → exampleItem).
      const mid = asBetween(resolveBlockIntoExpex(editor, caret, 120, key));
      expect(classifyParentAt(editor, mid.insertPos)).toBe("exampleItem");

      // BELOW the last item → the trailing new-item gap at the list end.
      const below = asBetween(resolveBlockIntoExpex(editor, caret, 219, key));
      expect(classifyParentAt(editor, below.insertPos)).toBe("exampleBlock");

      // The snap genuinely moves the insert point as Y changes.
      expect(mid.insertPos).not.toBe(top.insertPos);
      expect(below.insertPos).not.toBe(mid.insertPos);
    });
  }

  it("the trailing new-item slot inserts AFTER the last item (end of the list)", () => {
    const d = packedDoc();
    const { editor } = mockEditor(d, packedRects(d));
    const items = findByType(d, "exampleItem");
    const caret = items[0].pos + 1;
    const below = asBetween(
      resolveBlockIntoExpex(editor, caret, 219, "textobject:paragraph:psrc"),
    );
    expect(below.insertPos).toBe(items[2].pos + items[2].size);
  });

  it("a non-{three-kind} source over the same expex returns null (no expex bar)", () => {
    const d = packedDoc();
    const { editor } = mockEditor(d, packedRects(d));
    const caret = findByType(d, "exampleItem")[0].pos + 1;
    for (const key of [
      "textobject:exampleItem:i9",
      "textobject:heading:h1",
      "textobject:listItem:l1",
      "textobject:figureBlock:f1",
    ]) {
      expect(resolveBlockIntoExpex(editor, caret, 120, key)).toBeNull();
    }
  });

  it("a three-kind source NOT inside an exampleBlock returns null (top-level drop preserved)", () => {
    const d = doc(para("plain", "pp"), gfx("g1"), dm("dd", "z"));
    const { editor } = mockEditor(d, {
      [findByType(d, "paragraph")[0].pos]: { top: 100, bottom: 140 },
    });
    const caret = findByType(d, "paragraph")[0].pos + 1;
    for (const { key } of THREE_KINDS) {
      expect(resolveBlockIntoExpex(editor, caret, 120, key)).toBeNull();
    }
  });
});

// ── 2. applyDrop commit — non-destructive tr.doc inspection, all 3 kinds ─────

describe("textObjectDropSpec commit — block into expex (3 kinds × 2 modes)", () => {
  for (const { kind, key, uuid } of THREE_KINDS) {
    it(`CASE b: a ${kind} dropped INTO an item joins that item's content (drop-direct)`, () => {
      const d = packedDoc();
      const { editor, dispatched, ctx } = mockEditor(d);
      const item1 = findByType(d, "exampleItem")[0];
      // A position inside item i1, after its paragraph (into-content boundary).
      const insertPos = item1.pos + item1.size - 1;
      expect(classifyParentAt(editor, insertPos)).toBe("exampleItem");

      expect(
        textObjectDropSpec.classifyDrop(betweenBlocks(editor, insertPos), key, ctx),
      ).toEqual({ kind: "apply" });
      textObjectDropSpec.applyDrop(betweenBlocks(editor, insertPos), key, ctx);

      const result = dispatched[0].doc;
      const list = result.child(result.childCount - 1).child(0); // exampleItemList
      expect(list.childCount).toBe(3); // still 3 items — joined, not added
      const item0 = list.child(0);
      expect(item0.childCount).toBe(2); // its paragraph + the dropped block
      // The dropped block joined item i1 as its new last content sibling.
      expect(item0.child(1).type.name).toBe(kind);
      expect(item0.child(1).attrs.uuid).toBe(uuid);
      // The same node moved — it appears exactly once (no clone, left top level).
      expect(findByType(result, kind).filter((n) => n.uuid === uuid)).toHaveLength(1);
    });

    it(`CASE a: a ${kind} dropped BETWEEN items becomes a fresh sibling exampleItem (wrap)`, () => {
      const d = packedDoc();
      const { editor, dispatched, ctx } = mockEditor(d);
      const items = findByType(d, "exampleItem");
      const insertPos = items[1].pos; // boundary between i1 and i2
      expect(classifyParentAt(editor, insertPos)).toBe("exampleBlock");
      textObjectDropSpec.applyDrop(betweenBlocks(editor, insertPos), key, ctx);

      const result = dispatched[0].doc;
      const list = result.child(result.childCount - 1).child(0);
      expect(list.childCount).toBe(4); // one new item inserted
      expect(list.child(0).textContent).toBe("alpha"); // i1 unchanged
      const newItem = list.child(1);
      expect(newItem.type.name).toBe("exampleItem");
      expect(newItem.childCount).toBe(1);
      expect(newItem.child(0).type.name).toBe(kind); // wraps the dropped block
      expect(typeof newItem.attrs.uuid).toBe("string"); // fresh, backfill-compatible
      expect(list.child(2).textContent).toBe("beta"); // i2 shifted down
      expect(list.child(3).textContent).toBe("gamma");
    });
  }

  it("CASE b detail: a graphicsBlock keeps its uuid when it joins an item", () => {
    const d = packedDoc();
    const { editor, dispatched, ctx } = mockEditor(d);
    const item1 = findByType(d, "exampleItem")[0];
    const insertPos = item1.pos + item1.size - 1;
    textObjectDropSpec.applyDrop(
      betweenBlocks(editor, insertPos),
      "textobject:graphicsBlock:g1",
      ctx,
    );
    const result = dispatched[0].doc;
    const gfxs = findByType(result, "graphicsBlock");
    expect(gfxs).toHaveLength(1);
    expect(gfxs[0].uuid).toBe("g1"); // same node, moved (not cloned)
  });

  it("CASE a detail: a displayMath wrapped into a new item keeps its latex", () => {
    const d = packedDoc();
    const { editor, dispatched, ctx } = mockEditor(d);
    const items = findByType(d, "exampleItem");
    textObjectDropSpec.applyDrop(
      betweenBlocks(editor, items[1].pos),
      "textobject:displayMath:dsrc",
      ctx,
    );
    const result = dispatched[0].doc;
    const list = result.child(result.childCount - 1).child(0);
    const newMath = list.child(1).child(0);
    expect(newMath.type.name).toBe("displayMath");
    expect(newMath.attrs.latex).toBe("a = b");
    expect(newMath.attrs.uuid).toBe("dsrc");
  });
});

// ── 3. Non-regression — top-level drops + non-{three-kind} source ────────────

describe("non-regression — gated strictly to expex", () => {
  for (const { kind, key, uuid, make } of [
    { kind: "paragraph", key: "textobject:paragraph:psrc", uuid: "psrc", make: () => para("dragP", "psrc") },
    { kind: "displayMath", key: "textobject:displayMath:dsrc", uuid: "dsrc", make: () => dm("dsrc", "q") },
    { kind: "graphicsBlock", key: "textobject:graphicsBlock:g1", uuid: "g1", make: () => gfx("g1") },
  ] as const) {
    it(`a ${kind} at a TOP-LEVEL gap still drops directly (NOT wrapped)`, () => {
      // Source at index 0, then two plain paragraphs; drop into the real gap
      // between them — a genuine top-level move away from the source.
      const d = doc(make(), para("a", "pa"), para("b", "pb"));
      const { editor, dispatched, ctx } = mockEditor(d);
      const pa = findByType(d, "paragraph").find((n) => n.uuid === "pa")!;
      const insertPos = pa.pos + pa.size; // between "a" and "b"
      expect(classifyParentAt(editor, insertPos)).toBeNull(); // top level

      expect(
        textObjectDropSpec.classifyDrop(betweenBlocks(editor, insertPos), key, ctx),
      ).toEqual({ kind: "apply" });
      textObjectDropSpec.applyDrop(betweenBlocks(editor, insertPos), key, ctx);

      const result = dispatched[0].doc;
      // The dropped node lands as a bare top-level sibling, not inside any item.
      const moved = findByType(result, kind).filter((n) => n.uuid === uuid);
      expect(moved).toHaveLength(1);
      expect(findByType(result, "exampleBlock")).toHaveLength(0); // none created
      expect(findByType(result, "exampleItem")).toHaveLength(0); // not wrapped
    });
  }

  it("a non-{three-kind} (exampleItem) source over the expex still reorders as a sibling (R3)", () => {
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
    const insertPos = items[1].pos; // move i3 to the boundary between i1 and i2
    textObjectDropSpec.applyDrop(
      betweenBlocks(editor, insertPos),
      "textobject:exampleItem:i3",
      ctx,
    );
    const list = dispatched[0].doc.firstChild!.firstChild!;
    expect(list.childCount).toBe(3); // reordered, not added
    expect([
      list.child(0).textContent,
      list.child(1).textContent,
      list.child(2).textContent,
    ]).toEqual(["alpha", "gamma", "beta"]);
  });
});
