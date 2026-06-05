// @vitest-environment jsdom
/**
 * Feature A2 — single-example expex drop: the SAME left-edge vertical bar A1
 * gave multi examples now welcomes text / picture / equation into a SINGLE `\ex`
 * example (an exampleBlock with direct content, zero items). A1 did nothing
 * there — `collectExpexSlots` enumerated only `exampleItem` nodes, so a single
 * example yielded 0 slots → `resolveBlockIntoExpex` returned null → no bar.
 *
 * Two halves are locked here, headless (the live drop BAR is a trusted-hover
 * gesture the user verifies):
 *   1. `resolveBlockIntoExpex` — a single example (and the gloss-only ee03
 *      shape) now yields a VERTICAL body bar; the snap stays on the body slot as
 *      the cursor sweeps up/down (a single example has no new-item ticks).
 *   2. `textObjectDropSpec.applyDrop` — each of the 3 kinds drops DIRECTLY into
 *      the single example's body as its new FIRST child, pushing the existing
 *      body content down (A3 — insert at the content START, not the end; the
 *      example stays `kind:"single"`, NOT converted to a multi `\pex` with items).
 *      Non-destructive: build the dispatched tr and inspect its doc + run
 *      `doc.check()` on the real PM model.
 *
 * ⚠️ REGRESSION LOCK (the trap): `classifyParentAt` collapses the multi
 * between-items gap (immediate parent `exampleItemList`) and a single example's
 * direct body (immediate parent `exampleBlock`) onto the SAME `parentKind:
 * "exampleBlock"`. The wrap-vs-direct decision is therefore SCHEMA-DRIVEN
 * (`canDropDirectAt`), not a parentKind string match. The lock below proves:
 * with the exampleBlock schema WIDENED, the multi between-items drop STILL wraps
 * into a fresh exampleItem (canDropDirect false) — it does NOT become a bare
 * block inside the `exampleItemList` (which the naive
 * `isCompatibleParent(kind, exampleBlock) → true` flip would have caused).
 */

import { describe, expect, it } from "vitest";
import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { resolveBlockIntoExpex } from "../hit-test";
import { canDropDirectAt, classifyParentAt } from "../specs/drop-context";
import { textObjectDropSpec } from "../specs/textobject";
import type { DropCtx, Placement } from "../types";

// Hand-rolled schema — node names match TEXT_OBJECT_REGISTRY keys so the real
// `classifyParentAt` recognizes each context. `exampleBlock` mirrors the REAL
// A2 widened content (paragraph | graphicsBlock | displayMath | exampleGloss |
// exampleItemList)*; `exampleItemList` is deliberately NOT a registry kind and
// keeps its `exampleItem+` content, so a between-items insert still REJECTS a
// bare block (the wrap path) even with the block itself widened.
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
      attrs: { uuid: { default: null }, command: { default: "" } },
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
      content:
        "(paragraph | graphicsBlock | displayMath | exampleGloss | exampleItemList)*",
      attrs: { uuid: { default: null }, kind: { default: "single" } },
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
    exampleGloss: {
      content: "inline*",
      attrs: { uuid: { default: null } },
      toDOM: () => ["div", { class: "gloss" }, 0],
    },
    text: { group: "inline" },
  },
});

const t = (text: string) => schema.text(text);
const para = (text: string, uuid?: string) =>
  schema.nodes.paragraph.create(uuid ? { uuid } : null, text ? t(text) : undefined);
const gfx = (uuid: string, command = "\\includegraphics{fig}") =>
  schema.nodes.graphicsBlock.create({ uuid, command });
const dm = (uuid: string, latex = "x = 1") =>
  schema.nodes.displayMath.create({ uuid, latex });
const gloss = (text: string) => schema.nodes.exampleGloss.create(null, t(text));
const exItem = (uuid: string, ...content: PMNode[]) =>
  schema.nodes.exampleItem.create({ uuid }, content);
const exList = (...items: PMNode[]) =>
  schema.nodes.exampleItemList.create(null, items);
/** A single `\ex` example — direct body content, `kind:"single"`, no items. */
const singleBlock = (uuid: string, ...body: PMNode[]) =>
  schema.nodes.exampleBlock.create({ uuid, kind: "single" }, body);
/** A multi `\pex` example — items inside an exampleItemList, `kind:"multi"`. */
const multiBlock = (uuid: string, ...items: PMNode[]) =>
  schema.nodes.exampleBlock.create({ uuid, kind: "multi" }, exList(...items));
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

const THREE_KINDS = [
  { kind: "paragraph", key: "textobject:paragraph:psrc", uuid: "psrc", make: () => para("dragged text", "psrc") },
  { kind: "graphicsBlock", key: "textobject:graphicsBlock:gsrc", uuid: "gsrc", make: () => gfx("gsrc") },
  { kind: "displayMath", key: "textobject:displayMath:dsrc", uuid: "dsrc", make: () => dm("dsrc", "a = b") },
] as const;

// ── 1. resolveBlockIntoExpex — single + gloss-only yield a body bar ──────────

describe("resolveBlockIntoExpex — single example body bar", () => {
  for (const { kind, key } of THREE_KINDS) {
    it(`${kind}: a single example yields a VERTICAL body bar at the body text-left`, () => {
      const d = doc(THREE_KINDS[0].make(), gfx("gsrc"), dm("dsrc", "a = b"), singleBlock("S", para("the example sentence")));
      const block = findByType(d, "exampleBlock")[0];
      const { editor } = mockEditor(d, {
        [block.pos]: { left: 70, top: 200, bottom: 260, height: 60, width: 300 },
        // the body's first content child (the paragraph) — its TEXT-left is inset
        // from the block's far-left, where expex draws the "(1)" label.
        [block.pos + 1]: { left: 92, top: 206, bottom: 254, height: 48, width: 270 },
      });
      const caret = block.pos + 2; // inside the single example's paragraph
      const p = asBetween(resolveBlockIntoExpex(editor, caret, 230, key));
      expect(p.rect.height).toBeGreaterThan(p.rect.width); // vertical bar
      expect(p.rect.x).toBe(92); // the BODY text-left, not the block far-left (70)
      expect(p.rect.width).toBeLessThanOrEqual(4); // thin
      // The bar inserts at the body content START (push the existing down) and
      // classifies exampleBlock → drop-direct at commit.
      expect(p.insertPos).toBe(block.pos + 1);
      expect(classifyParentAt(editor, p.insertPos)).toBe("exampleBlock");
    });

    it(`${kind}: the body slot stays put as the cursor sweeps up/down (no new-item ticks)`, () => {
      const d = doc(THREE_KINDS[0].make(), gfx("gsrc"), dm("dsrc", "a = b"), singleBlock("S", para("the example sentence")));
      const block = findByType(d, "exampleBlock")[0];
      const { editor } = mockEditor(d, {
        [block.pos]: { left: 70, top: 200, bottom: 260, height: 60, width: 300 },
      });
      const caret = block.pos + 2;
      const top = asBetween(resolveBlockIntoExpex(editor, caret, 205, key));
      const mid = asBetween(resolveBlockIntoExpex(editor, caret, 230, key));
      const bot = asBetween(resolveBlockIntoExpex(editor, caret, 258, key));
      // A single example has exactly one slot (the body) — the same insertPos
      // regardless of cursor Y; the bar never snaps to a (nonexistent) item gap.
      expect(top.insertPos).toBe(mid.insertPos);
      expect(mid.insertPos).toBe(bot.insertPos);
    });
  }

  it("the gloss-only single example (ee03 shape) still yields a body bar — insert lands ABOVE the gloss", () => {
    const d = doc(para("dragged text", "psrc"), singleBlock("G", gloss("in principio erat verbum")));
    const block = findByType(d, "exampleBlock")[0];
    const glossInfo = findByType(d, "exampleGloss")[0];
    const { editor } = mockEditor(d, {
      [block.pos]: { left: 80, top: 300, bottom: 360, height: 60, width: 300 },
      // the body's first content child here is the gloss itself — its box is the
      // body's text-left.
      [block.pos + 1]: { left: 104, top: 306, bottom: 354, height: 48, width: 260 },
    });
    const caret = block.pos + 2; // inside the gloss
    const p = asBetween(resolveBlockIntoExpex(editor, caret, 330, "textobject:paragraph:psrc"));
    expect(p.rect.height).toBeGreaterThan(p.rect.width);
    expect(p.rect.x).toBe(104); // the body text-left (the gloss box)
    // The body content START is just inside the block at the gloss's own
    // position (index 0), so a drop lands ABOVE the gloss (the commit test below
    // confirms the resulting child order).
    expect(p.insertPos).toBe(glossInfo.pos);
    expect(classifyParentAt(editor, p.insertPos)).toBe("exampleBlock");
  });
});

// ── 2. applyDrop — 3 kinds drop-direct into a single example's body ──────────

describe("textObjectDropSpec commit — block into a SINGLE example (drop-direct)", () => {
  for (const { kind, key, uuid, make } of THREE_KINDS) {
    it(`a ${kind} dropped into a single example joins the body as its new FIRST child and stays kind:"single"`, () => {
      const d = doc(make(), singleBlock("S", para("original sentence")));
      const { editor, dispatched, ctx } = mockEditor(d);
      const block = findByType(d, "exampleBlock")[0];
      // The body slot: the body content START (A3 — push the existing down).
      const insertPos = block.pos + 1;
      expect(classifyParentAt(editor, insertPos)).toBe("exampleBlock");

      expect(
        textObjectDropSpec.classifyDrop(betweenBlocks(editor, insertPos), key, ctx),
      ).toEqual({ kind: "apply" });
      textObjectDropSpec.applyDrop(betweenBlocks(editor, insertPos), key, ctx);

      const result = dispatched[0].doc;
      result.check(); // schema-valid on the real PM model
      const ex = result.child(result.childCount - 1); // the exampleBlock (last block)
      expect(ex.type.name).toBe("exampleBlock");
      expect(ex.attrs.kind).toBe("single"); // NOT converted to multi
      expect(ex.childCount).toBe(2); // the dropped block + original paragraph
      expect(ex.child(0).type.name).toBe(kind); // dropped block is the new FIRST child
      expect(ex.child(0).attrs.uuid).toBe(uuid);
      expect(ex.child(1).textContent).toBe("original sentence"); // pushed down
      // No item machinery was created — it stays a single example.
      expect(findByType(result, "exampleItemList")).toHaveLength(0);
      expect(findByType(result, "exampleItem")).toHaveLength(0);
      // The same node moved (no clone left at top level).
      expect(findByType(result, kind).filter((n) => n.uuid === uuid)).toHaveLength(1);
    });
  }

  it("a displayMath joins a single example's body keeping its latex", () => {
    const d = doc(dm("dsrc", "E = mc^2"), singleBlock("S", para("the claim")));
    const { editor, dispatched, ctx } = mockEditor(d);
    const block = findByType(d, "exampleBlock")[0];
    const insertPos = block.pos + 1; // body content START
    textObjectDropSpec.applyDrop(
      betweenBlocks(editor, insertPos),
      "textobject:displayMath:dsrc",
      ctx,
    );
    const result = dispatched[0].doc;
    result.check();
    const math = findByType(result, "displayMath");
    expect(math).toHaveLength(1);
    const ex = result.child(result.childCount - 1);
    expect(ex.child(0).type.name).toBe("displayMath"); // new FIRST child
    expect(ex.child(0).attrs.latex).toBe("E = mc^2");
  });

  it("a drop into a gloss-only single example lands ABOVE the gloss (still single, valid)", () => {
    const d = doc(para("dragged", "psrc"), singleBlock("G", gloss("the gloss")));
    const { editor, dispatched, ctx } = mockEditor(d);
    const block = findByType(d, "exampleBlock")[0];
    // The body content START for a gloss-only block = just inside it (index 0).
    const insertPos = block.pos + 1;
    textObjectDropSpec.applyDrop(
      betweenBlocks(editor, insertPos),
      "textobject:paragraph:psrc",
      ctx,
    );
    const result = dispatched[0].doc;
    result.check();
    const ex = result.child(result.childCount - 1);
    expect(ex.attrs.kind).toBe("single");
    expect(ex.childCount).toBe(2);
    expect(ex.child(0).type.name).toBe("paragraph"); // dropped block, above…
    expect(ex.child(0).textContent).toBe("dragged");
    expect(ex.child(1).type.name).toBe("exampleGloss"); // …the gloss
  });
});

// ── 3. REGRESSION LOCK — the trap: widened block, multi still wraps ──────────

describe("REGRESSION LOCK — schema-driven wrap-vs-direct (the exampleBlock trap)", () => {
  it("multi between-items + single body BOTH classify as exampleBlock, yet canDropDirect separates them", () => {
    const d = doc(
      singleBlock("S", para("solo")),
      multiBlock("M", exItem("i1", para("alpha")), exItem("i2", para("beta"))),
    );
    const { editor } = mockEditor(d);
    const single = findByType(d, "exampleBlock")[0];
    const items = findByType(d, "exampleItem");

    const singleBodyPos = single.pos + single.size - 1; // single example body
    const betweenItemsPos = items[1].pos; // multi between i1 and i2

    // Same classification — the collapse the trap warns about.
    expect(classifyParentAt(editor, singleBodyPos)).toBe("exampleBlock");
    expect(classifyParentAt(editor, betweenItemsPos)).toBe("exampleBlock");

    // …but the schema at the IMMEDIATE parent tells them apart.
    expect(canDropDirectAt(editor, singleBodyPos, schema.nodes.paragraph)).toBe(true);
    expect(canDropDirectAt(editor, betweenItemsPos, schema.nodes.paragraph)).toBe(false);
  });

  it("with exampleBlock WIDENED, a multi between-items drop STILL wraps into a fresh exampleItem", () => {
    // The naive fix (isCompatibleParent(kind, exampleBlock) → true + old adapter
    // compatible→drop-direct) would insert a bare block into the exampleItemList
    // here → `doc.check()` would throw / the list would hold a non-item child.
    const d = doc(
      para("dragP", "psrc"),
      multiBlock("M", exItem("i1", para("alpha")), exItem("i2", para("beta")), exItem("i3", para("gamma"))),
    );
    const { editor, dispatched, ctx } = mockEditor(d);
    const items = findByType(d, "exampleItem");
    const insertPos = items[1].pos; // between i1 and i2

    textObjectDropSpec.applyDrop(
      betweenBlocks(editor, insertPos),
      "textobject:paragraph:psrc",
      ctx,
    );
    const result = dispatched[0].doc;
    result.check(); // would THROW under the naive bare-block-into-list approach

    const list = result.child(result.childCount - 1).child(0); // exampleItemList
    expect(list.type.name).toBe("exampleItemList");
    expect(list.childCount).toBe(4); // one NEW item inserted (not 3 + a bare block)
    // Every child is an exampleItem — never a bare paragraph.
    for (let i = 0; i < list.childCount; i++) {
      expect(list.child(i).type.name).toBe("exampleItem");
    }
    // The new item (index 1) wraps the dropped paragraph.
    const newItem = list.child(1);
    expect(newItem.childCount).toBe(1);
    expect(newItem.child(0).type.name).toBe("paragraph");
    expect(newItem.child(0).textContent).toBe("dragP");
    expect(list.child(0).textContent).toBe("alpha"); // i1 unchanged
    expect(list.child(2).textContent).toBe("beta"); // i2 shifted down
    // The example stays a multi example (no spurious extra exampleBlock).
    expect(findByType(result, "exampleBlock")).toHaveLength(1);
  });

  it("a multi into-item drop still drops-direct (A1 behavior unchanged)", () => {
    const d = doc(
      para("dragP", "psrc"),
      multiBlock("M", exItem("i1", para("alpha")), exItem("i2", para("beta"))),
    );
    const { editor, dispatched, ctx } = mockEditor(d);
    const items = findByType(d, "exampleItem");
    const into = items[0].pos + items[0].size - 1; // inside i1, after its paragraph
    expect(canDropDirectAt(editor, into, schema.nodes.paragraph)).toBe(true);
    textObjectDropSpec.applyDrop(
      betweenBlocks(editor, into),
      "textobject:paragraph:psrc",
      ctx,
    );
    const result = dispatched[0].doc;
    result.check();
    const list = result.child(result.childCount - 1).child(0);
    expect(list.childCount).toBe(2); // joined i1, not a new item
    expect(list.child(0).childCount).toBe(2); // alpha paragraph + dropped paragraph
    expect(list.child(0).child(1).textContent).toBe("dragP");
  });
});

// ── 4. Non-regression — gated strictly; top-level + non-3-kind unaffected ────

describe("non-regression — single-example drop stays gated", () => {
  it("a three-kind source NOT inside any exampleBlock returns null (top-level drop preserved)", () => {
    const d = doc(para("plain", "pp"), gfx("gsrc"), dm("dsrc", "z"));
    const { editor } = mockEditor(d, {
      [findByType(d, "paragraph")[0].pos]: { top: 100, bottom: 140 },
    });
    const caret = findByType(d, "paragraph")[0].pos + 1;
    for (const { key } of THREE_KINDS) {
      expect(resolveBlockIntoExpex(editor, caret, 120, key)).toBeNull();
    }
  });

  it("a non-{three-kind} source over a single example returns null (no expex bar)", () => {
    const d = doc(singleBlock("S", para("solo")));
    const block = findByType(d, "exampleBlock")[0];
    const { editor } = mockEditor(d, {
      [block.pos]: { left: 70, top: 200, bottom: 260, height: 60, width: 300 },
    });
    const caret = block.pos + 2;
    for (const key of [
      "textobject:heading:h1",
      "textobject:listItem:l1",
      "textobject:figureBlock:f1",
      "textobject:exampleItem:i9",
    ]) {
      expect(resolveBlockIntoExpex(editor, caret, 230, key)).toBeNull();
    }
  });

  it("a three-kind source dropped at a TOP-LEVEL gap still drops-direct (not wrapped)", () => {
    const d = doc(para("dragP", "psrc"), para("a", "pa"), para("b", "pb"));
    const { editor, dispatched, ctx } = mockEditor(d);
    const pa = findByType(d, "paragraph").find((n) => n.uuid === "pa")!;
    const insertPos = pa.pos + pa.size; // between "a" and "b" (top level)
    expect(classifyParentAt(editor, insertPos)).toBeNull();
    expect(canDropDirectAt(editor, insertPos, schema.nodes.paragraph)).toBe(true);
    textObjectDropSpec.applyDrop(
      betweenBlocks(editor, insertPos),
      "textobject:paragraph:psrc",
      ctx,
    );
    const result = dispatched[0].doc;
    result.check();
    expect(findByType(result, "exampleBlock")).toHaveLength(0); // none created
    expect(findByType(result, "paragraph").filter((n) => n.uuid === "psrc")).toHaveLength(1);
  });
});
