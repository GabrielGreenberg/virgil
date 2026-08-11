// @vitest-environment jsdom
/**
 * Residual bug R3 — source-kind-aware drop resolution for lifted sub-items.
 *
 * A lifted sub-item (listItem / exampleItem) should drop AMONG its peers, not
 * only inside one of them. The bug was purely in the hit-test's POSITION
 * resolution: `resolveAnchorableBlock` returns the innermost anchorable node,
 * which inside a list/expex item is the item's inner paragraph (depth 3), so a
 * dragged sub-item only ever got drop positions inside a single item — never
 * at the boundary BETWEEN peer items. The commit path (classifyDropTarget →
 * inside-compatible → drop-direct) already supported sibling drops.
 *
 * Two halves are locked here, both headless (the live drop INDICATOR is a
 * trusted-hover gesture and is verified by the user, not in vitest):
 *   1. `resolveSubItemPeerBlock` — the new resolution targets the peer ITEM
 *      boundary (depth 2 / 3), gated on isSubObject + isCompatibleParent, and
 *      returns null (fall-through to the old resolution) for every other case.
 *   2. `textObjectDropSpec.applyDrop` — fed an item-boundary insertPos, the
 *      UNTOUCHED commit reorders the item as a sibling within a list, across
 *      same-kind lists, and within an expex block; a top-level-gap drop still
 *      pulls the item OUT (wrap). The non-destructive technique from
 *      `text-range-move.test.ts`: build the dispatched tr and inspect its doc.
 */

import { describe, expect, it } from "vitest";
import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import {
  makeBetweenBlocksPlacement,
  resolveSubItemPeerBlock,
} from "../hit-test";
import { textObjectDropSpec } from "../specs/textobject";
import type { DropCtx, Placement } from "../types";

// Hand-rolled schema — node names match TEXT_OBJECT_REGISTRY keys so the real
// `classifyParentAt` recognizes each context. `exampleItemList` is
// deliberately NOT a registry kind: the commit skips it and classifies a
// beside-exampleItem insert as `exampleBlock` (inside-compatible).
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      attrs: { uuid: { default: null } },
      toDOM: () => ["p", 0],
    },
    blockquote: {
      group: "block",
      content: "block+",
      attrs: { uuid: { default: null } },
      toDOM: () => ["blockquote", 0],
    },
    bulletList: {
      group: "block",
      content: "listItem+",
      attrs: { uuid: { default: null } },
      toDOM: () => ["ul", 0],
    },
    orderedList: {
      group: "block",
      content: "listItem+",
      attrs: { uuid: { default: null } },
      toDOM: () => ["ol", 0],
    },
    listItem: {
      content: "paragraph block*",
      attrs: { uuid: { default: null } },
      toDOM: () => ["li", 0],
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
const li = (text: string, uuid: string) =>
  schema.nodes.listItem.create({ uuid }, para(text));
const bulletList = (uuid: string, ...items: PMNode[]) =>
  schema.nodes.bulletList.create({ uuid }, items);
const orderedList = (uuid: string, ...items: PMNode[]) =>
  schema.nodes.orderedList.create({ uuid }, items);
const exItem = (text: string, uuid: string) =>
  schema.nodes.exampleItem.create({ uuid }, para(text));
const exList = (...items: PMNode[]) =>
  schema.nodes.exampleItemList.create(null, items);
const exBlock = (uuid: string, ...items: PMNode[]) =>
  schema.nodes.exampleBlock.create({ uuid }, exList(...items));
const blockquote = (uuid: string, ...paras: PMNode[]) =>
  schema.nodes.blockquote.create({ uuid }, paras);
const doc = (...blocks: PMNode[]) => schema.nodes.doc.create(null, blocks);

const ZERO = { x: 0, y: 0, width: 0, height: 0 };

interface ItemInfo {
  pos: number;
  size: number;
  uuid: string | null;
  text: string;
}

function findByType(d: PMNode, typeName: string): ItemInfo[] {
  const out: ItemInfo[] = [];
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

function mockEditor(d: PMNode, rect?: Partial<DOMRect>) {
  const dispatched: Transaction[] = [];
  const state = EditorState.create({ schema, doc: d });
  const box = {
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    ...(rect ?? {}),
  };
  const editor = {
    state,
    view: {
      // The resolution only needs SOME HTMLElement; the placement constructor
      // reads its rect, so stub a controllable getBoundingClientRect.
      nodeDOM: () => {
        const el = document.createElement("li");
        el.getBoundingClientRect = () =>
          ({ ...box, toJSON: () => box }) as DOMRect;
        return el;
      },
      dispatch: (tr: Transaction) => dispatched.push(tr),
      focus: () => {},
    },
  } as unknown as Editor;
  return { editor, dispatched, ctx: { mainEditor: editor } as unknown as DropCtx };
}

// ── 1. resolveSubItemPeerBlock — source-kind-aware resolution ───────────────

describe("resolveSubItemPeerBlock — peer-item resolution + gates", () => {
  it("listItem source over a list item resolves the ITEM boundary, not the inner paragraph", () => {
    const d = doc(
      para("intro"),
      bulletList("L", li("one", "a"), li("two", "b"), li("three", "c")),
      para("outro"),
    );
    const { editor } = mockEditor(d);
    const items = findByType(d, "listItem");
    const item2 = items[1]; // "two"
    // A pos inside item2's inner paragraph text (depth 3).
    const peer = resolveSubItemPeerBlock(
      editor,
      item2.pos + 2,
      "textobject:listItem:c",
    );
    expect(peer).not.toBeNull();
    // Resolves the listItem (depth 2) at the item boundary — NOT the inner
    // paragraph, whose before-position would be item2.pos + 1 (depth 3).
    expect(peer!.blockPos).toBe(item2.pos);
    expect(peer!.depth).toBe(2);
  });

  it("listItem source over a top-level paragraph gap returns null (pull-out preserved)", () => {
    const d = doc(
      para("intro"),
      bulletList("L", li("one", "a"), li("two", "b")),
    );
    const { editor } = mockEditor(d);
    const intro = findByType(d, "paragraph")[0]; // top-level "intro" at pos 0
    const peer = resolveSubItemPeerBlock(
      editor,
      intro.pos + 1,
      "textobject:listItem:a",
    );
    expect(peer).toBeNull();
  });

  it("paragraph source (not a sub-object) returns null over a list item", () => {
    const d = doc(bulletList("L", li("one", "a"), li("two", "b")));
    const { editor } = mockEditor(d);
    const item2 = findByType(d, "listItem")[1];
    const peer = resolveSubItemPeerBlock(
      editor,
      item2.pos + 2,
      "textobject:paragraph:x",
    );
    expect(peer).toBeNull();
  });

  it("exampleItem source over an exampleItem resolves the exampleItem boundary", () => {
    const d = doc(
      exBlock("E", exItem("alpha", "ea"), exItem("beta", "eb"), exItem("gamma", "ec")),
    );
    const { editor } = mockEditor(d);
    const exItems = findByType(d, "exampleItem");
    const ex2 = exItems[1]; // "beta"
    const peer = resolveSubItemPeerBlock(
      editor,
      ex2.pos + 2,
      "textobject:exampleItem:ec",
    );
    expect(peer).not.toBeNull();
    // depth 3 here (doc > exampleBlock > exampleItemList > exampleItem); the
    // compatible container (exampleBlock) is the GRANDPARENT, not the
    // immediate parent (exampleItemList).
    expect(peer!.blockPos).toBe(ex2.pos);
    expect(peer!.depth).toBe(3);
  });

  it("listItem source over an exampleItem (cross-kind) returns null (same-kind gate)", () => {
    const d = doc(exBlock("E", exItem("alpha", "ea"), exItem("beta", "eb")));
    const { editor } = mockEditor(d);
    const ex2 = findByType(d, "exampleItem")[1];
    const peer = resolveSubItemPeerBlock(
      editor,
      ex2.pos + 2,
      "textobject:listItem:c",
    );
    expect(peer).toBeNull();
  });

  it("listItem source over a blockquote paragraph returns null (incompatible container)", () => {
    const d = doc(blockquote("Q", para("quoted")));
    const { editor } = mockEditor(d);
    const quoted = findByType(d, "paragraph")[0];
    const peer = resolveSubItemPeerBlock(
      editor,
      quoted.pos + 1,
      "textobject:listItem:c",
    );
    expect(peer).toBeNull();
  });
});

// ── 2. makeBetweenBlocksPlacement — Notion-style midpoint snapping ──────────

describe("makeBetweenBlocksPlacement — sub-item midpoint snapping", () => {
  const d = doc(bulletList("L", li("one", "a"), li("two", "b"), li("three", "c")));

  it("snapToMidpoint: top half inserts BEFORE the item, bottom half AFTER — both at sibling boundaries", () => {
    const { editor } = mockEditor(d, { top: 100, bottom: 140, height: 40 });
    const item2 = findByType(d, "listItem")[1];
    const peer = resolveSubItemPeerBlock(editor, item2.pos + 2, "textobject:listItem:c")!;

    // midpoint = 120. Cursor at 110 (top half) → insert before this item.
    const before = makeBetweenBlocksPlacement(editor, peer, 110, true);
    expect(before.kind).toBe("between-blocks");
    expect((before as Extract<Placement, { kind: "between-blocks" }>).insertPos).toBe(item2.pos);
    // Cursor at 130 (bottom half) → insert after this item.
    const after = makeBetweenBlocksPlacement(editor, peer, 130, true);
    expect((after as Extract<Placement, { kind: "between-blocks" }>).insertPos).toBe(item2.pos + item2.size);
  });

  it("default (snapToMidpoint=false) keeps the top-edge threshold — byte-identical to the top-level path", () => {
    const { editor } = mockEditor(d, { top: 100, bottom: 140, height: 40 });
    const item2 = findByType(d, "listItem")[1];
    const peer = resolveSubItemPeerBlock(editor, item2.pos + 2, "textobject:listItem:c")!;
    // Cursor at 110 is BELOW the top edge (100) → insert after (NOT before, as
    // midpoint snapping would). This is the unchanged top-level behavior.
    const p = makeBetweenBlocksPlacement(editor, peer, 110);
    expect((p as Extract<Placement, { kind: "between-blocks" }>).insertPos).toBe(item2.pos + item2.size);
  });
});

// ── 3. textObjectDropSpec.applyDrop — the UNTOUCHED commit, fed a boundary ──

function betweenBlocks(editor: Editor, insertPos: number): Placement {
  return { kind: "between-blocks", editor, insertPos, rect: ZERO };
}

describe("textObjectDropSpec commit — sibling reorder from an item-boundary insertPos", () => {
  it("listItem inter-item drop reorders within the same list (drop-direct sibling)", () => {
    const d = doc(bulletList("L", li("one", "a"), li("two", "b"), li("three", "c")));
    const { editor, dispatched, ctx } = mockEditor(d);
    const items = findByType(d, "listItem");
    // Move item "c" (last) to the boundary between "one" and "two".
    const insertPos = items[1].pos;
    const KEY = "textobject:listItem:c";

    expect(textObjectDropSpec.classifyDrop(betweenBlocks(editor, insertPos), KEY, ctx)).toEqual({
      kind: "apply",
    });
    textObjectDropSpec.applyDrop(betweenBlocks(editor, insertPos), KEY, ctx);

    const list = dispatched[0].doc.firstChild!;
    expect(list.type.name).toBe("bulletList");
    expect(list.childCount).toBe(3); // list stayed whole; item moved
    expect([
      list.child(0).textContent,
      list.child(1).textContent,
      list.child(2).textContent,
    ]).toEqual(["one", "three", "two"]);
  });

  it("listItem drop into a DIFFERENT same-kind list moves it in as a sibling (cross-list)", () => {
    const d = doc(
      bulletList("B", li("one", "a"), li("two", "b")),
      orderedList("O", li("x", "x1"), li("y", "y1")),
    );
    const { editor, dispatched, ctx } = mockEditor(d);
    const items = findByType(d, "listItem");
    const xItem = items.find((i) => i.uuid === "x1")!;
    // Move "b" (from the bulletList) into the orderedList, between x and y.
    const insertPos = xItem.pos + xItem.size;
    textObjectDropSpec.applyDrop(betweenBlocks(editor, insertPos), "textobject:listItem:b", ctx);

    const result = dispatched[0].doc;
    const bl = result.child(0);
    const ol = result.child(1);
    expect(bl.type.name).toBe("bulletList");
    expect(bl.childCount).toBe(1);
    expect(bl.child(0).textContent).toBe("one"); // "b" left the bulletList
    expect(ol.type.name).toBe("orderedList");
    expect([
      ol.child(0).textContent,
      ol.child(1).textContent,
      ol.child(2).textContent,
    ]).toEqual(["x", "two", "y"]); // "b" joined the orderedList between x and y
  });

  it("exampleItem inter-item drop reorders within the exampleBlock (drop-direct sibling)", () => {
    const d = doc(
      exBlock("E", exItem("alpha", "ea"), exItem("beta", "eb"), exItem("gamma", "ec")),
    );
    const { editor, dispatched, ctx } = mockEditor(d);
    const items = findByType(d, "exampleItem");
    // Move "gamma" (last) to the boundary between "alpha" and "beta".
    const insertPos = items[1].pos;
    textObjectDropSpec.applyDrop(betweenBlocks(editor, insertPos), "textobject:exampleItem:ec", ctx);

    const exListN = dispatched[0].doc.firstChild!.firstChild!;
    expect(exListN.type.name).toBe("exampleItemList");
    expect(exListN.childCount).toBe(3);
    expect([
      exListN.child(0).textContent,
      exListN.child(1).textContent,
      exListN.child(2).textContent,
    ]).toEqual(["alpha", "gamma", "beta"]);
  });

  it("NON-REGRESSION: a sub-item dropped at a top-level gap still PULLS OUT (wrap)", () => {
    const d = doc(
      para("first"),
      para("second"),
      bulletList("L", li("solo", "s"), li("keep", "k")),
    );
    const { editor, dispatched, ctx } = mockEditor(d);
    const first = findByType(d, "paragraph")[0]; // top-level "first" at pos 0
    // Top-level gap between "first" and "second".
    const insertPos = first.pos + first.size;
    textObjectDropSpec.applyDrop(betweenBlocks(editor, insertPos), "textobject:listItem:s", ctx);

    const result = dispatched[0].doc;
    expect(result.childCount).toBe(4);
    expect(result.child(0).textContent).toBe("first");
    // The pulled-out item is wrapped in a FRESH single-item bulletList.
    expect(result.child(1).type.name).toBe("bulletList");
    expect(result.child(1).childCount).toBe(1);
    expect(result.child(1).child(0).textContent).toBe("solo");
    expect(result.child(2).textContent).toBe("second");
    // The original list survives, minus the pulled-out item.
    expect(result.child(3).type.name).toBe("bulletList");
    expect(result.child(3).childCount).toBe(1);
    expect(result.child(3).child(0).textContent).toBe("keep");
  });
});

// ── 4. task 065 — cross-kind sub-object into a foreign container's item gap ──
//
// The corruption class this fixes: a sub-object dropped into the between-items
// gap of a FOREIGN container. `classifyParentAt` collapses the insert position
// onto the visible container kind (it skips the unregistered `exampleItemList`),
// so the pre-065 sub-object adapters fabricated a wrap (`bulletList` /
// `exampleBlock`) that is valid one level up but INVALID at the true immediate
// parent — ProseMirror then split the foreign container to fit it, tearing one
// example/list into two nodes both carrying the SAME uuid (a duplicate-uuid
// corruption that cascades into card-anchor / selection / float-key confusion).
//
// Resolved decision (Gabriel via catcher): option (a) — reject/no-op the invalid
// drop. The `canPlaceHere` gate now makes both sub-object adapters no-op here, so
// `applyDrop` dispatches NOTHING (no splitting insert). These two cases lock both
// directions end-to-end through the real `applyDrop` + the real expex-shaped
// schema (the `exampleItemList` wrapper above), the harness that reproduced the
// split. Pre-fix, each dispatched a container-splitting tr; post-fix, neither
// dispatches — and since task 321 neither is reported as `apply` either, so the
// gesture cancels instead of closing the float over an untouched document.
describe("textObjectDropSpec commit — cross-kind sub-object into a foreign gap NO-OPS (task 065)", () => {
  it("listItem into a between-exampleItems gap is REJECTED (no split, no duplicate uuid)", () => {
    const d = doc(
      bulletList("L", li("one", "a"), li("two", "b")),
      exBlock("E", exItem("alpha", "ea"), exItem("beta", "eb")),
    );
    const { editor, dispatched, ctx } = mockEditor(d);
    const exItems = findByType(d, "exampleItem");
    // Insert at the boundary BEFORE "beta" — immediate parent `exampleItemList`
    // (content `exampleItem+`), which rejects a bare `bulletList`.
    const insertPos = exItems[1].pos;
    const KEY = "textobject:listItem:a";

    // RENEGOTIATED by task 321. These two assertions used to read `apply` —
    // "the drop is genuinely attempted at this position", true of the gesture
    // and false of its outcome. That pairing (`classifyDrop` says apply, the
    // adapter's `no-op` dispatches nothing) IS the defect 321 names: the
    // controller sets `applied = true` because nothing threw, `postDrop:
    // "close"` dismisses the popped-out float, and the document is unchanged
    // with no feedback. The refusal is now resolved in `planDrop`, which both
    // doors derive from, so the DECISION reports it and the session cancels
    // with the float intact.
    expect(
      textObjectDropSpec.classifyDrop(betweenBlocks(editor, insertPos), KEY, ctx),
    ).toEqual({ kind: "no-op" });
    // The apply half is unchanged: the adapter no-ops it, so nothing is
    // dispatched, the exampleBlock is never split and no uuid is duplicated.
    textObjectDropSpec.applyDrop(betweenBlocks(editor, insertPos), KEY, ctx);
    expect(dispatched).toHaveLength(0);

    // The source doc is untouched: still exactly one exampleBlock (uuid "E") with
    // two items, and the original bulletList intact.
    const exBlocks = findByType(d, "exampleBlock");
    expect(exBlocks).toHaveLength(1);
    expect(exBlocks[0].uuid).toBe("E");
    expect(findByType(d, "exampleItem")).toHaveLength(2);
    expect(findByType(d, "bulletList")).toHaveLength(1);
  });

  it("exampleItem into a between-listItems gap is REJECTED (symmetric case)", () => {
    const d = doc(
      bulletList("L", li("one", "a"), li("two", "b")),
      exBlock("E", exItem("alpha", "ea"), exItem("beta", "eb")),
    );
    const { editor, dispatched, ctx } = mockEditor(d);
    const items = findByType(d, "listItem");
    // Insert at the boundary BEFORE "two" — immediate parent `bulletList`
    // (content `listItem+`), which rejects a bare `exampleBlock`.
    const insertPos = items[1].pos;
    const KEY = "textobject:exampleItem:ea";

    // `no-op`, not `apply` — see the note on the sibling case above (task 321).
    expect(
      textObjectDropSpec.classifyDrop(betweenBlocks(editor, insertPos), KEY, ctx),
    ).toEqual({ kind: "no-op" });
    textObjectDropSpec.applyDrop(betweenBlocks(editor, insertPos), KEY, ctx);
    expect(dispatched).toHaveLength(0);

    // The bulletList is never split into two lists sharing uuid "L".
    const lists = findByType(d, "bulletList");
    expect(lists).toHaveLength(1);
    expect(lists[0].uuid).toBe("L");
    expect(findByType(d, "listItem")).toHaveLength(2);
    expect(findByType(d, "exampleBlock")).toHaveLength(1);
  });
});
