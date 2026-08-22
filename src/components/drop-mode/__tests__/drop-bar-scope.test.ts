// @vitest-environment jsdom
/**
 * Task 007 — the drop bar's WIDTH encodes the insert SCOPE, decoupled from the
 * neighbor block's text length.
 *
 * The bug: dropping to insert a top-level SIBLING below an `ex` example drew a
 * SHORT bar (it read like the "add a sub-example" affordance), because the
 * between-blocks bar took its width from `resolveContentEdges(block.dom)` — which
 * for a CONTAINER (exampleBlock / list) descends to the narrow, indented inner
 * item. A sibling below a full-width paragraph, by contrast, got the full column.
 * Same affordance ("a new top-level block lands here"), two different widths.
 *
 * The fix (hit-test.ts):
 *   • TOP-LEVEL sibling (block at doc depth 0)   → bar spans the block's own
 *     COLUMN box (`block.dom`'s border box). Full column for EVERY kind — the
 *     example's `(n)` marker sits at column-left, so its outer box IS the column.
 *   • SUB-TIER peer (an item among peers, depth ≥ 1) → keep the indented
 *     content-edge (chip 4a): the item's text-left + width is the correct scope.
 *   • NEW-ITEM within an example → the horizontal bar spans the example's BODY
 *     column (item text-left → example body right), not the one-line item width.
 *   • INTO-item (a sub-block) → the SHORT vertical tick, reserved & unchanged.
 *
 * Static geometry only (the live drag is a trusted-hover gesture): build
 * placements with synthetic rects and inspect `placement.rect` — no dispatch.
 */

import { describe, expect, it } from "vitest";
import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { resolveContentEdges } from "@/text-objects/block-frame";
import {
  makeBetweenBlocksPlacement,
  resolveBlockIntoExpex,
} from "../hit-test";
import type { Placement } from "../types";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      attrs: { uuid: { default: null } },
      toDOM: () => ["p", 0],
    },
    exampleBlock: {
      group: "block",
      content: "exampleItemList+",
      attrs: { uuid: { default: null } },
      toDOM: () => ["div", 0],
    },
    exampleItemList: { content: "exampleItem+", toDOM: () => ["div", 0] },
    exampleItem: {
      content: "paragraph+",
      attrs: { uuid: { default: null } },
      toDOM: () => ["div", 0],
    },
    text: { group: "inline" },
  },
});

const t = (text: string) => schema.text(text);
const para = (text: string, uuid?: string) =>
  schema.nodes.paragraph.create(uuid ? { uuid } : null, t(text));
const exItem = (text: string, uuid: string) =>
  schema.nodes.exampleItem.create({ uuid }, para(text));
const exList = (...items: PMNode[]) =>
  schema.nodes.exampleItemList.create(null, items);
const exBlock = (uuid: string, ...items: PMNode[]) =>
  schema.nodes.exampleBlock.create({ uuid }, exList(...items));
const doc = (...blocks: PMNode[]) => schema.nodes.doc.create(null, blocks);

interface NodeInfo {
  pos: number;
  size: number;
  uuid: string | null;
}
function findByType(d: PMNode, typeName: string): NodeInfo[] {
  const out: NodeInfo[] = [];
  d.descendants((n, pos) => {
    if (n.type.name === typeName)
      out.push({ pos, size: n.nodeSize, uuid: (n.attrs?.uuid as string) ?? null });
    return true;
  });
  return out;
}

const rectOf = (box: Partial<DOMRect>): DOMRect => {
  const full = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, ...box };
  return { ...full, toJSON: () => full } as DOMRect;
};

// ── Geometry ────────────────────────────────────────────────────────────────
// The prose column: a top-level block fills it (a paragraph's box, and an
// example's OUTER box whose `(n)` marker sits at column-left, both span it).
const COLUMN_LEFT = 64;
const COLUMN_WIDTH = 300;
const COLUMN_RIGHT = COLUMN_LEFT + COLUMN_WIDTH; // 364
// An example item's PROSE is inset past the marker column, and one narrow line
// is far shorter than the column — the two facts the bug conflated.
const ITEM_PROSE_LEFT = 120;
const SHORT_ITEM_WIDTH = 90; // a one-line example → short text run
const EX_TOP = 100;
const EX_BOTTOM = 140;
const EX_HEIGHT = EX_BOTTOM - EX_TOP;

/**
 * A faithful top-level `.expex-block`: its OUTER box is the full column; its
 * first grabbable child is a narrow, indented item (so `resolveContentEdges`
 * container-descends to the SHORT inner prose — the pre-fix width source).
 */
function faithfulExampleBlockEl(itemWidth: number): HTMLElement {
  const block = document.createElement("div");
  block.setAttribute("data-uuid", "E");
  block.setAttribute("data-text-object-kind", "exampleBlock");
  block.getBoundingClientRect = () =>
    rectOf({ left: COLUMN_LEFT, right: COLUMN_RIGHT, width: COLUMN_WIDTH, top: EX_TOP, bottom: EX_BOTTOM, height: EX_HEIGHT });
  const item = document.createElement("div");
  item.setAttribute("data-uuid", "a");
  item.setAttribute("data-text-object-kind", "exampleItem");
  item.className = "expex-item";
  const body = document.createElement("div");
  body.className = "expex-item-body";
  const p = document.createElement("p");
  p.getBoundingClientRect = () =>
    rectOf({ left: ITEM_PROSE_LEFT, width: itemWidth, top: EX_TOP, bottom: EX_BOTTOM, height: EX_HEIGHT });
  body.appendChild(p);
  item.appendChild(body);
  block.appendChild(item);
  return block;
}

function faithfulItemEl(): HTMLElement {
  const item = document.createElement("div");
  item.className = "expex-item";
  item.getBoundingClientRect = () =>
    rectOf({ left: 50, top: EX_TOP, bottom: EX_BOTTOM, height: EX_HEIGHT, width: COLUMN_WIDTH });
  const body = document.createElement("div");
  body.className = "expex-item-body";
  const p = document.createElement("p");
  p.getBoundingClientRect = () =>
    rectOf({ left: ITEM_PROSE_LEFT, width: 240, top: EX_TOP, bottom: EX_BOTTOM, height: EX_HEIGHT });
  body.appendChild(p);
  item.appendChild(body);
  return item;
}

function mockEditor(d: PMNode, domFor: (pos: number) => HTMLElement | null) {
  const state = EditorState.create({ schema, doc: d });
  return {
    state,
    view: { nodeDOM: (pos: number) => domFor(pos), dispatch: () => {}, focus: () => {} },
  } as unknown as Editor;
}

function asBetween(p: Placement | null) {
  expect(p).not.toBeNull();
  expect(p!.kind).toBe("between-blocks");
  return p as Extract<Placement, { kind: "between-blocks" }>;
}

describe("task 007 — between-blocks bar width = insert SCOPE", () => {
  it("a TOP-LEVEL sibling below an example spans the full COLUMN, not the narrow inner item", () => {
    const d = doc(exBlock("E", exItem("alpha", "a")));
    const blockEl = faithfulExampleBlockEl(SHORT_ITEM_WIDTH);
    const editor = mockEditor(d, () => blockEl);
    const block = findByType(d, "exampleBlock")[0];

    // Pre-fix source (the narrow, indented inner item) — what the bar USED to be.
    const descended = resolveContentEdges(blockEl);
    expect(descended.contentLeft).toBe(ITEM_PROSE_LEFT); // 120 — indented
    expect(descended.contentWidth).toBe(SHORT_ITEM_WIDTH); // 90 — short

    const placement = makeBetweenBlocksPlacement(
      editor,
      { blockPos: block.pos, uuid: "E", dom: blockEl },
      EX_BOTTOM + 5, // below the example → sibling insert after
    );
    // AFTER: full column — left at column-left, width the whole column.
    expect(placement.rect.x).toBe(COLUMN_LEFT); // 64, not 120
    expect(placement.rect.width).toBe(COLUMN_WIDTH); // 300, not 90
    // And decisively NOT the old narrow source.
    expect(placement.rect.width).not.toBe(SHORT_ITEM_WIDTH);
    // Horizontal (a full-width sibling bar), never the short vertical tick.
    expect(placement.rect.width).toBeGreaterThan(placement.rect.height);
  });

  it("a SHORT one-line and a WIDE example give the SAME full-column sibling bar", () => {
    const d = doc(exBlock("E", exItem("alpha", "a")));
    const block = findByType(d, "exampleBlock")[0];
    const shortEl = faithfulExampleBlockEl(SHORT_ITEM_WIDTH); // 90
    const wideEl = faithfulExampleBlockEl(260); // a long wrapped example

    const shortBar = makeBetweenBlocksPlacement(
      mockEditor(d, () => shortEl),
      { blockPos: block.pos, uuid: "E", dom: shortEl },
      EX_BOTTOM + 5,
    );
    const wideBar = makeBetweenBlocksPlacement(
      mockEditor(d, () => wideEl),
      { blockPos: block.pos, uuid: "E", dom: wideEl },
      EX_BOTTOM + 5,
    );
    // Width tracks the COLUMN, not the example's text length — the bug's core.
    expect(shortBar.rect.width).toBe(COLUMN_WIDTH);
    expect(wideBar.rect.width).toBe(COLUMN_WIDTH);
    expect(shortBar.rect.width).toBe(wideBar.rect.width);
  });

  it("a SUB-TIER peer item keeps the indented content-edge (regression guard, chip 4a)", () => {
    const d = doc(exBlock("E", exItem("alpha", "a"), exItem("beta", "b")));
    const items = findByType(d, "exampleItem");
    const itemEl = faithfulItemEl();
    const editor = mockEditor(d, () => itemEl);

    const placement = makeBetweenBlocksPlacement(
      editor,
      { blockPos: items[0].pos, uuid: "a", dom: itemEl },
      EX_TOP - 5,
    );
    // The item sits at doc depth ≥ 1 → NOT a top-level sibling → indented edge.
    expect(placement.rect.x).toBe(ITEM_PROSE_LEFT); // 120, not the column-left
    expect(placement.rect.width).toBe(240); // the item's own content width
  });

  it("a plain paragraph is byte-stable: its box IS the column (no widening)", () => {
    const d = doc(para("solo", "p1"));
    const pEl = document.createElement("p");
    pEl.getBoundingClientRect = () =>
      rectOf({ left: COLUMN_LEFT, width: COLUMN_WIDTH, top: 300, bottom: 340, height: 40 });
    const editor = mockEditor(d, () => pEl);
    const p = findByType(d, "paragraph")[0];

    const placement = makeBetweenBlocksPlacement(
      editor,
      { blockPos: p.pos, uuid: "p1", dom: pEl },
      290,
    );
    expect(placement.rect.x).toBe(COLUMN_LEFT); // 64
    expect(placement.rect.width).toBe(COLUMN_WIDTH); // 300 — unchanged
  });
});

describe("wave-2b C8 — the builder honors a pre-read rect (one layout read per move)", () => {
  it("with preReadRect: ZERO own rect reads, identical placement; without: exactly one", () => {
    const d = doc(para("solo", "p1"));
    const box = rectOf({
      left: COLUMN_LEFT,
      width: COLUMN_WIDTH,
      top: 300,
      bottom: 340,
      height: 40,
    });
    let reads = 0;
    const pEl = document.createElement("p");
    pEl.getBoundingClientRect = () => {
      reads++;
      return box;
    };
    const editor = mockEditor(d, () => pEl);
    const p = findByType(d, "paragraph")[0];
    const info = { blockPos: p.pos, uuid: "p1", dom: pEl };

    const threaded = asBetween(
      makeBetweenBlocksPlacement(editor, info, 290, box),
    );
    expect(reads).toBe(0); // hitTest's classification read is REUSED
    const reRead = asBetween(makeBetweenBlocksPlacement(editor, info, 290));
    expect(reads).toBe(1); // a rect-less caller pays the one read here instead
    expect(threaded.rect).toEqual(reRead.rect);
    expect(threaded.insertPos).toBe(reRead.insertPos);
  });
});

describe("task 007 — expex new-item bar spans the BODY column", () => {
  // A single-item example; a text block dragged into its top / bottom edge band
  // → a HORIZONTAL new-item bar. Its width must reach the example body's RIGHT
  // edge, not stop at the one-line item's short text run.
  function singleShortExample() {
    const d = doc(exBlock("E", exItem("x", "a")));
    const block = findByType(d, "exampleBlock")[0];
    const item = findByType(d, "exampleItem")[0];
    const editor = mockEditor(d, (pos) => {
      if (pos === block.pos)
        return Object.assign(document.createElement("div"), {
          getBoundingClientRect: () =>
            rectOf({ left: COLUMN_LEFT, right: COLUMN_RIGHT, width: COLUMN_WIDTH, top: EX_TOP, bottom: EX_BOTTOM, height: EX_HEIGHT }),
        });
      if (pos === item.pos)
        return Object.assign(document.createElement("div"), {
          getBoundingClientRect: () =>
            rectOf({ left: COLUMN_LEFT, top: EX_TOP, bottom: EX_BOTTOM, height: EX_HEIGHT, width: COLUMN_WIDTH }),
        });
      if (pos === item.pos + 1) {
        const p = document.createElement("p");
        p.getBoundingClientRect = () =>
          rectOf({ left: ITEM_PROSE_LEFT, width: SHORT_ITEM_WIDTH, top: EX_TOP, bottom: EX_BOTTOM, height: EX_HEIGHT });
        return p;
      }
      return null;
    });
    return { editor, item };
  }

  it("new-item bar reaches the body RIGHT edge, not the short item text width", () => {
    const { editor, item } = singleShortExample();
    // Y in the item's TOP band (frac < 0.3) → a horizontal new-item bar above.
    const p = asBetween(
      resolveBlockIntoExpex(editor, item.pos + 1, EX_TOP + 2, "textobject:paragraph:psrc"),
    );
    expect(p.rect.width).toBeGreaterThan(p.rect.height); // HORIZONTAL
    expect(p.rect.x).toBe(ITEM_PROSE_LEFT); // 120 — indented body-left
    // Spans body-left → body-right (364 − 120 = 244), NOT the short 90.
    expect(p.rect.width).toBe(COLUMN_RIGHT - ITEM_PROSE_LEFT); // 244
    expect(p.rect.width).toBeGreaterThan(SHORT_ITEM_WIDTH); // > 90
  });

  it("the INTO-item bar stays the SHORT vertical tick (reserved shape, unchanged)", () => {
    const { editor, item } = singleShortExample();
    // Y in the MIDDLE band → the vertical into-item bar.
    const p = asBetween(
      resolveBlockIntoExpex(editor, item.pos + 1, EX_TOP + EX_HEIGHT / 2, "textobject:paragraph:psrc"),
    );
    expect(p.rect.height).toBeGreaterThan(p.rect.width); // VERTICAL
    expect(p.rect.width).toBeLessThanOrEqual(4); // a thin tick
    expect(p.rect.x).toBe(ITEM_PROSE_LEFT); // down the item's text-left
  });
});
