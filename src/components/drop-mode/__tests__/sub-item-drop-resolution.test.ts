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

// ── 1+2. The CANDIDATE LADDER — what R3's peer resolver became ──────────────
//
// RENEGOTIATED in place (task 416), with the reason at the site. R3 asked ONE
// question — "is the cursor inside a peer item of the DRAGGED kind, in a
// container that accepts it?" — and answered it with a bespoke resolver plus a
// `snapToMidpoint` flag whose single `true` call site was that resolver's. Both
// are retired: the ladder yields EVERY legal insert position at the row, filters
// them against the payload through the same `fitNodeInContainer` SSOT the commit
// reads, and snaps at each level's own midpoint for every payload.
//
// So the peer-item boundary is no longer a special case — it is simply the
// candidate whose container is the list. Three of R3's `null` legs are therefore
// renegotiated rather than kept: a null there meant "nothing painted", which for
// a cross-kind sub-item over a foreign container's item gap is the very silent
// refusal `AGENTS.md` records as the proxy half's residual. The ladder answers
// with the OUTERMOST level that can legally hold the payload instead.

import {
  chooseInsertCandidate,
  filterInsertCandidates,
  resolveInsertCandidates,
} from "../insert-candidates";

/** The whole ladder, as the hit-test runs it. */
function ladder(
  editor: Editor,
  floorPos: number,
  cursorY: number,
  payload: readonly string[],
  cursorX = 10_000,
) {
  return chooseInsertCandidate(
    filterInsertCandidates(
      editor,
      resolveInsertCandidates(editor, floorPos, cursorY),
      payload,
    ),
    cursorX,
  );
}

describe("the candidate ladder — peer-item resolution, for EVERY payload", () => {
  it("a listItem payload over a list item chooses the ITEM boundary, not the inner paragraph", () => {
    const d = doc(
      para("intro"),
      bulletList("L", li("one", "a"), li("two", "b"), li("three", "c")),
      para("outro"),
    );
    const { editor } = mockEditor(d, { top: 100, bottom: 140, height: 40 });
    const item2 = findByType(d, "listItem")[1];
    const chosen = ladder(editor, item2.pos, 110, ["listItem"]);
    expect(chosen).not.toBeNull();
    expect(chosen!.refPos).toBe(item2.pos);
    expect(chosen!.container.type.name).toBe("bulletList");
  });

  it("a PARAGRAPH payload over the same item is offered the same row — the F0 half", () => {
    // Pre-416 this answered NOTHING: `resolveSubItemPeerBlock` gated on the
    // dragged kind, and `between-blocks` matches the GAP only, so a paragraph
    // dragged over a list saw no bar anywhere over its body.
    const d = doc(bulletList("L", li("one", "a"), li("two", "b")));
    const { editor } = mockEditor(d, { top: 100, bottom: 140, height: 40 });
    const item2 = findByType(d, "listItem")[1];
    const chosen = ladder(editor, item2.pos, 110, ["paragraph"]);
    expect(chosen).not.toBeNull();
    expect(chosen!.container.type.name).toBe("bulletList");
  });

  it("a listItem payload over a top-level paragraph still offers the pull-out (wrap)", () => {
    const d = doc(
      para("intro"),
      bulletList("L", li("one", "a"), li("two", "b")),
    );
    const { editor } = mockEditor(d, { top: 100, bottom: 140, height: 40 });
    const intro = findByType(d, "paragraph")[0];
    const chosen = ladder(editor, intro.pos, 110, ["listItem"]);
    // `doc` cannot hold a bare listItem, but the wrap rung fabricates the list
    // around it — which is exactly what the commit's adapter does.
    expect(chosen).not.toBeNull();
    expect(chosen!.container.type.name).toBe("doc");
  });

  it("an exampleItem payload over an exampleItem chooses the exampleItem boundary", () => {
    const d = doc(
      exBlock("E", exItem("alpha", "ea"), exItem("beta", "eb"), exItem("gamma", "ec")),
    );
    const { editor } = mockEditor(d, { top: 100, bottom: 140, height: 40 });
    const ex2 = findByType(d, "exampleItem")[1];
    const chosen = ladder(editor, ex2.pos, 110, ["exampleItem"]);
    expect(chosen).not.toBeNull();
    expect(chosen!.refPos).toBe(ex2.pos);
    // The compatible container is the exampleItemList — the item's own parent,
    // which R3 could not name because it is not a registered TextObjectKind.
    expect(chosen!.container.type.name).toBe("exampleItemList");
  });

  it("a listItem payload over an exampleItem is offered the OUTERMOST legal level, not silence", () => {
    // R3 answered null here (its same-kind gate) and the pre-416 hit-test then
    // painted an ordinary between-blocks bar whose commit was refused — the
    // "bar painted, nothing happens, no message" residual. The ladder filters
    // the two inner levels out (no wrapper the expex containers accept can hold
    // a listItem) and offers the top-level pull-out, which the commit accepts.
    const d = doc(exBlock("E", exItem("alpha", "ea"), exItem("beta", "eb")));
    const { editor } = mockEditor(d, { top: 100, bottom: 140, height: 40 });
    const ex2 = findByType(d, "exampleItem")[1];
    const chosen = ladder(editor, ex2.pos, 110, ["listItem"]);
    expect(chosen).not.toBeNull();
    expect(chosen!.container.type.name).toBe("doc");
  });

  it("a listItem payload inside a blockquote is offered the blockquote's own level", () => {
    const d = doc(blockquote("Q", para("quoted")));
    const { editor } = mockEditor(d, { top: 100, bottom: 140, height: 40 });
    const quoted = findByType(d, "paragraph")[0];
    const chosen = ladder(editor, quoted.pos, 110, ["listItem"]);
    expect(chosen).not.toBeNull();
    // `blockquote` is `block+`, so the wrap rung builds the list inside it.
    expect(chosen!.container.type.name).toBe("blockquote");
  });
});

describe("the candidate ladder — Y snaps at the MIDPOINT, at every level", () => {
  const d = doc(bulletList("L", li("one", "a"), li("two", "b"), li("three", "c")));

  it("top half inserts BEFORE the item, bottom half AFTER — for every payload", () => {
    const { editor } = mockEditor(d, { top: 100, bottom: 140, height: 40 });
    const item2 = findByType(d, "listItem")[1];
    for (const payload of [["listItem"], ["paragraph"]]) {
      // midpoint = 120. Cursor at 110 (top half) → before this item.
      expect(ladder(editor, item2.pos, 110, payload)!.insertPos).toBe(item2.pos);
      // Cursor at 130 (bottom half) → after this item.
      expect(ladder(editor, item2.pos, 130, payload)!.insertPos).toBe(
        item2.pos + item2.size,
      );
    }
  });

  it("X chooses the LEVEL: far left walks out to the top-level sibling", () => {
    const { editor } = mockEditor(d, { top: 100, bottom: 140, height: 40 });
    const item2 = findByType(d, "listItem")[1];
    // This fixture's `nodeDOM` stub answers the SAME box for every level, so
    // the two candidates share a left edge and the deeper one wins at any X at
    // or right of it. What X can still prove here is the fallback: a cursor
    // LEFT of every candidate's box takes the shallowest level.
    const deep = ladder(editor, item2.pos, 110, ["paragraph"], 10_000);
    expect(deep!.container.type.name).toBe("bulletList");
    const shallow = ladder(editor, item2.pos, 110, ["paragraph"], -10_000);
    expect(shallow!.container.type.name).toBe("doc");
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
