// @vitest-environment jsdom
/**
 * Chip 4a — the drop INDICATOR shares the canonical block frame.
 *
 * Before chip 4a the drop-bar builders each computed their own x: the
 * between-blocks bar used `block.dom.getBoundingClientRect().left` (the block's
 * OWN box left), while the expex bars used the first content child's box left.
 * For a block whose OUTER box and TEXT-left differ — an exampleItem, whose box
 * starts at the "(2)" / "a." label column but whose prose is inset — those two
 * notions DIVERGE, so the reorder bar (between-blocks over a peer item) and the
 * into-item bar over the SAME item landed at different x (the §4 bug).
 *
 * Chip 4a routes BOTH through `resolveBlockFrame(…).contentLeft` — the SAME
 * source the grab handles read (block-frame.ts) — so the bar hugs the block's
 * TEXT-left by construction, and the two bars over one item coincide.
 *
 * These locks exercise the REAL builders (`makeBetweenBlocksPlacement`,
 * `resolveBlockIntoExpex`) and the REAL `resolveBlockFrame` against a FAITHFUL
 * expex-item DOM (the `.expex-item` → `.expex-item-body p` descent the frame
 * relies on), so the item's outer box (label column) and inner prose-left are
 * distinct — the only way to surface the divergence the bug was about. The
 * existing block-into-expex / sub-item tests use bare-div mocks (box == content)
 * and so can't show it.
 *
 * Static geometry only — the live drag is a trusted-hover gesture the
 * maintainer confirms; here we build placements with synthetic positions and
 * inspect `placement.rect` WITHOUT dispatching (non-destructive).
 */

import { describe, expect, it } from "vitest";
import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { resolveBlockFrame } from "@/text-objects/block-frame";
import {
  makeBetweenBlocksPlacement,
  resolveBlockIntoExpex,
} from "../hit-test";
import type { Placement } from "../types";

// Node names match TEXT_OBJECT_REGISTRY keys so the real resolvers recognize
// each context, mirroring the sibling drop tests' hand-rolled schema.
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
    if (n.type.name === typeName) {
      out.push({ pos, size: n.nodeSize, uuid: (n.attrs?.uuid as string) ?? null });
    }
    return true;
  });
  return out;
}

const rectOf = (box: Partial<DOMRect>): DOMRect => {
  const full = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, ...box };
  return { ...full, toJSON: () => full } as DOMRect;
};

// ── The geometry under test ────────────────────────────────────────────────
// An exampleItem's OUTER box opens at the label column; its prose is inset. A
// top-level paragraph's box IS its text. The bug: the item's bar used the
// label-column x; the fix: the prose-left x, the same the grab handle reads.
const ITEM_BOX_LEFT = 90; // the "(2)" / "a." label column (item's own box left)
const ITEM_PROSE_LEFT = 120; // where the item's prose actually starts
const ITEM_PROSE_WIDTH = 240;
const ITEM_TOP = 100;
const ITEM_BOTTOM = 160;
const ITEM_HEIGHT = ITEM_BOTTOM - ITEM_TOP;
const PARA_LEFT = 64; // a top-level paragraph: box left == text left
const PARA_WIDTH = 300;

/**
 * A FAITHFUL exampleItem element: outer `.expex-item` box at the label column,
 * an inner `.expex-item-body p` at the prose-left — so `resolveBlockFrame`'s
 * `expex-item` descent (text-metrics `resolveInlineContextElement`) lands on
 * the prose, exactly as it does for the live grab handle.
 */
function faithfulItemEl(): HTMLElement {
  const item = document.createElement("div");
  item.className = "expex-item";
  item.getBoundingClientRect = () =>
    rectOf({ left: ITEM_BOX_LEFT, top: ITEM_TOP, bottom: ITEM_BOTTOM, height: ITEM_HEIGHT, width: 300 });
  const body = document.createElement("div");
  body.className = "expex-item-body";
  const p = document.createElement("p");
  p.getBoundingClientRect = () =>
    rectOf({ left: ITEM_PROSE_LEFT, top: ITEM_TOP, bottom: ITEM_BOTTOM, height: ITEM_HEIGHT, width: ITEM_PROSE_WIDTH });
  body.appendChild(p);
  item.appendChild(body);
  return item;
}

/** A content-child element at the prose-left (what `nodeDOM(itemPos + 1)`
 *  returns) — a bare `<p>` whose own box IS the prose, so its frame contentLeft
 *  equals the item's descended contentLeft. */
function contentChildEl(): HTMLElement {
  const p = document.createElement("p");
  p.getBoundingClientRect = () =>
    rectOf({ left: ITEM_PROSE_LEFT, top: ITEM_TOP, bottom: ITEM_BOTTOM, height: ITEM_HEIGHT, width: ITEM_PROSE_WIDTH });
  return p;
}

function plainParaEl(): HTMLElement {
  const p = document.createElement("p");
  p.getBoundingClientRect = () =>
    rectOf({ left: PARA_LEFT, top: 300, bottom: 340, height: 40, width: PARA_WIDTH });
  return p;
}

function mockEditor(d: PMNode, domFor: (pos: number) => HTMLElement | null) {
  const state = EditorState.create({ schema, doc: d });
  return {
    state,
    view: {
      nodeDOM: (pos: number) => domFor(pos),
      dispatch: () => {},
      focus: () => {},
    },
  } as unknown as Editor;
}

function asBetween(p: Placement | null) {
  expect(p).not.toBeNull();
  expect(p!.kind).toBe("between-blocks");
  return p as Extract<Placement, { kind: "between-blocks" }>;
}

describe("chip 4a — drop bar reads resolveBlockFrame().contentLeft", () => {
  it("the frame descends an exampleItem to its PROSE-left, not its label-column box", () => {
    const item = faithfulItemEl();
    const frame = resolveBlockFrame(item, {} as Editor);
    // The §4 root: box left and prose left genuinely differ.
    expect(item.getBoundingClientRect().left).toBe(ITEM_BOX_LEFT); // 90 (the old x)
    expect(frame.contentLeft).toBe(ITEM_PROSE_LEFT); // 120 (the new, canonical x)
    expect(frame.contentLeft).not.toBe(item.getBoundingClientRect().left);
  });

  it("between-blocks bar over an exampleItem hugs the frame content-left (not the box left)", () => {
    const d = doc(exBlock("E", exItem("alpha", "a"), exItem("beta", "b")));
    const item = faithfulItemEl();
    const editor = mockEditor(d, () => item);
    const items = findByType(d, "exampleItem");

    const placement = makeBetweenBlocksPlacement(
      editor,
      { blockPos: items[0].pos, depth: 3, uuid: "a", dom: item },
      ITEM_TOP - 5, // above the top edge → insert before
    );
    // AFTER: the bar sits at the prose-left (the frame), the §4 fix.
    expect(placement.rect.x).toBe(ITEM_PROSE_LEFT); // 120
    expect(placement.rect.x).toBe(resolveBlockFrame(item, editor).contentLeft);
    // BEFORE this chip it would have been the box left (the divergence).
    expect(placement.rect.x).not.toBe(item.getBoundingClientRect().left); // ≠ 90
    // Width comes from the frame's content extent, not the outer box.
    expect(placement.rect.width).toBe(ITEM_PROSE_WIDTH); // 240
  });

  it("§4: the into-item bar and the between-blocks bar over the SAME item now COINCIDE", () => {
    // A single-item expex keeps the band selection unambiguous (one item, so the
    // thirds model resolves to it directly).
    const d = doc(exBlock("E", exItem("alpha", "a")));
    const items = findByType(d, "exampleItem");
    const i0 = items[0];
    const block = findByType(d, "exampleBlock")[0];

    // resolveBlockIntoExpex needs: nodeDOM(blockPos)=block box, nodeDOM(itemPos)
    // = the item box (for the band Y), nodeDOM(itemPos+1)= the content child (for
    // the frame content-left). The faithful item descends to the same prose-left.
    const editor = mockEditor(d, (pos) => {
      if (pos === block.pos)
        return Object.assign(document.createElement("div"), {
          getBoundingClientRect: () =>
            rectOf({ left: ITEM_BOX_LEFT, top: ITEM_TOP, bottom: ITEM_BOTTOM, height: ITEM_HEIGHT, width: 300 }),
        });
      if (pos === i0.pos) return faithfulItemEl();
      if (pos === i0.pos + 1) return contentChildEl();
      return null;
    });

    // into-item: cursor in the MIDDLE band of the item → vertical into-item bar.
    const into = asBetween(
      resolveBlockIntoExpex(editor, i0.pos + 1, ITEM_TOP + ITEM_HEIGHT / 2, "textobject:paragraph:psrc"),
    );
    // reorder: an exampleItem lifted over its peer → between-blocks over the item.
    const reorder = makeBetweenBlocksPlacement(
      editor,
      { blockPos: i0.pos, depth: 3, uuid: "a", dom: faithfulItemEl() },
      ITEM_TOP - 5,
    );

    const frameLeft = resolveBlockFrame(faithfulItemEl(), editor).contentLeft;
    expect(into.rect.x).toBe(ITEM_PROSE_LEFT); // 120
    expect(reorder.rect.x).toBe(ITEM_PROSE_LEFT); // 120
    expect(into.rect.x).toBe(reorder.rect.x); // §4: aligned (delta 0)
    expect(into.rect.x).toBe(frameLeft); // both == the grab handle's content-left
  });

  it("a plain paragraph is byte-stable: frame content-left == its box left (delta 0)", () => {
    const d = doc(para("solo", "p1"));
    const pEl = plainParaEl();
    const editor = mockEditor(d, () => pEl);
    const p = findByType(d, "paragraph")[0];

    const placement = makeBetweenBlocksPlacement(
      editor,
      { blockPos: p.pos, depth: 1, uuid: "p1", dom: pEl },
      290, // above the paragraph's top (300) → insert before
    );
    // No wrapper to descend → contentLeft == box left, so this chip does not
    // move the bar for ordinary paragraph text.
    expect(placement.rect.x).toBe(PARA_LEFT); // 64
    expect(placement.rect.x).toBe(pEl.getBoundingClientRect().left);
    expect(placement.rect.x).toBe(resolveBlockFrame(pEl, editor).contentLeft);
    expect(placement.rect.width).toBe(PARA_WIDTH);
  });
});
