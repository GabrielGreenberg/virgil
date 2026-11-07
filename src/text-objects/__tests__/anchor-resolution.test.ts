/**
 * Tests for `findPreviousAnchorableBlock` — the helper that resolves a
 * surviving anchor when a destructive-creative action (currently only
 * Archive) is about to delete the block it would otherwise anchor to.
 *
 * Uses a minimal PM schema covering the kinds the helper has to handle:
 * paragraph, heading, listItem inside bulletList, exampleItem inside
 * exampleBlock (which itself wraps in an invisible exampleItemList),
 * displayMath.
 */

import { describe, expect, it } from "vitest";
import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import {
  collectRemovedAnchorUuids,
  findNextAnchorableBlock,
  findPreviousAnchorableBlock,
  resolveDisplacedAnchorPlacement,
} from "../anchor-resolution";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      attrs: { uuid: { default: null } },
      toDOM: () => ["p", 0],
    },
    heading: {
      group: "block",
      content: "inline*",
      attrs: { uuid: { default: null }, level: { default: 1 } },
      toDOM: () => ["h1", 0],
    },
    bulletList: {
      group: "block",
      content: "listItem+",
      attrs: { uuid: { default: null } },
      toDOM: () => ["ul", 0],
    },
    listItem: {
      content: "paragraph+",
      attrs: { uuid: { default: null } },
      toDOM: () => ["li", 0],
    },
    exampleBlock: {
      group: "block",
      content: "exampleItemList",
      attrs: { uuid: { default: null } },
      toDOM: () => ["div", 0],
    },
    exampleItemList: {
      content: "exampleItem+",
      toDOM: () => ["div", 0],
    },
    exampleItem: {
      content: "inline*",
      attrs: { uuid: { default: null } },
      toDOM: () => ["span", 0],
    },
    displayMath: {
      group: "block",
      content: "",
      atom: true,
      attrs: { uuid: { default: null } },
      toDOM: () => ["div", { class: "math" }],
    },
    // Stand-in for the real `maketitleMarker`: a top-level block that is not
    // a TextObject kind (task 1507).
    maketitleMarker: {
      group: "block",
      atom: true,
      toDOM: () => ["div", { class: "maketitle" }],
    },
    text: { group: "inline" },
  },
});

function p(uuid: string | null, text = "p"): PMNode {
  return schema.nodes.paragraph.create({ uuid }, text ? schema.text(text) : null);
}
function h(uuid: string, text = "h"): PMNode {
  return schema.nodes.heading.create({ uuid }, schema.text(text));
}
function li(uuid: string, text = "i"): PMNode {
  return schema.nodes.listItem.create({ uuid }, p(`${uuid}p`, text));
}
function bl(uuid: string, items: PMNode[]): PMNode {
  return schema.nodes.bulletList.create({ uuid }, items);
}
function xi(uuid: string, text = "x"): PMNode {
  return schema.nodes.exampleItem.create({ uuid }, schema.text(text));
}
function xb(uuid: string, items: PMNode[]): PMNode {
  return schema.nodes.exampleBlock.create(
    { uuid },
    schema.nodes.exampleItemList.create({}, items),
  );
}
function dm(uuid: string): PMNode {
  return schema.nodes.displayMath.create({ uuid });
}
function mt(): PMNode {
  return schema.nodes.maketitleMarker.create();
}
/** An unminted (uuid-less) list — a container with nothing to answer. */
function blNoUuid(): PMNode {
  return schema.nodes.bulletList.create({ uuid: null }, [
    schema.nodes.listItem.create({ uuid: null }, p(null, "i")),
  ]);
}
function doc(...blocks: PMNode[]): PMNode {
  return schema.nodes.doc.create({}, blocks);
}

/** Resolve the position immediately BEFORE the given top-level block's
 *  outer-from. This mirrors how the dispatcher calls the helper:
 *  `findPreviousAnchorableBlock(doc, extended.from)`. */
function posBeforeTopBlock(d: PMNode, index: number): number {
  let pos = 0;
  d.forEach((_, offset, i) => {
    if (i === index) pos = offset;
  });
  return pos;
}

describe("findPreviousAnchorableBlock", () => {
  it("returns null for the first block in the doc", () => {
    const d = doc(p("fa1", "first"), p("fa2", "second"));
    const result = findPreviousAnchorableBlock(d, posBeforeTopBlock(d, 0));
    expect(result).toBeNull();
  });

  it("returns the previous paragraph for a middle paragraph", () => {
    const d = doc(p("fa1"), p("fa2"), p("fa3"));
    const result = findPreviousAnchorableBlock(d, posBeforeTopBlock(d, 1));
    expect(result).toEqual({ uuid: "fa1", kind: "paragraph" });
  });

  it("returns the heading when the source follows a heading", () => {
    const d = doc(p("fa1"), h("h1"), p("fa2"));
    const result = findPreviousAnchorableBlock(d, posBeforeTopBlock(d, 2));
    expect(result).toEqual({ uuid: "h1", kind: "heading" });
  });

  it("returns the last listItem when the source follows a bulletList", () => {
    const d = doc(p("fa1"), bl("ul1", [li("li1"), li("li2"), li("li3")]), p("fa2"));
    // posBeforeTopBlock(d, 2) is the position before the paragraph after
    // the bulletList — the previous-sibling walk lands on the list, then
    // descends to its last child.
    const result = findPreviousAnchorableBlock(d, posBeforeTopBlock(d, 2));
    expect(result).toEqual({ uuid: "li3", kind: "listItem" });
  });

  it("returns the previous listItem within the same list", () => {
    const d = doc(bl("ul1", [li("li1"), li("li2"), li("li3")]));
    // Position before listItem li2: inside the bulletList, sibling
    // index 1. The helper walks up depths until it finds a prior
    // sibling — here, li1 at depth 2.
    let pos = 0;
    d.descendants((node, p) => {
      if (node.type.name === "listItem" && node.attrs.uuid === "li2") {
        pos = p;
        return false;
      }
      return true;
    });
    const result = findPreviousAnchorableBlock(d, pos);
    expect(result).toEqual({ uuid: "li1", kind: "listItem" });
  });

  it("returns the last exampleItem when the source follows an exampleBlock", () => {
    const d = doc(p("fa1"), xb("xb1", [xi("xi1"), xi("xi2")]), p("fa2"));
    const result = findPreviousAnchorableBlock(d, posBeforeTopBlock(d, 2));
    // The walker descends through exampleBlock → exampleItemList →
    // exampleItem (last child).
    expect(result).toEqual({ uuid: "xi2", kind: "exampleItem" });
  });

  it("returns the displayMath atom-block when the source follows one", () => {
    const d = doc(p("fa1"), dm("dm1"), p("fa2"));
    const result = findPreviousAnchorableBlock(d, posBeforeTopBlock(d, 2));
    expect(result).toEqual({ uuid: "dm1", kind: "displayMath" });
  });

  it("handles archive-of-whole-list (cascade collapsed): looks above the list", () => {
    // Mirrors the dispatcher's cascade-extended call site: when the
    // cascade swallows the bulletList wrapper, `extended.from` is the
    // position of the LIST itself, not the listItem. The helper walks
    // backward from there → finds the paragraph above the list.
    const d = doc(p("above"), bl("ul1", [li("only")]), p("below"));
    const result = findPreviousAnchorableBlock(d, posBeforeTopBlock(d, 1));
    expect(result).toEqual({ uuid: "above", kind: "paragraph" });
  });

  it("returns null when there's nothing anchorable above", () => {
    // A doc whose only prior block has no uuid — the helper refuses to
    // anchor to a uuid-less node.
    const d = doc(p(null, "no-uuid"), p("fa1"));
    const result = findPreviousAnchorableBlock(d, posBeforeTopBlock(d, 1));
    expect(result).toBeNull();
  });
});

/** Task 1507 — "nearest" is honoured: a non-qualifying sibling is walked
 *  past, not the end of the walk. Each case runs in both directions. */
describe("neighbour walk passes non-qualifying siblings (task 1507)", () => {
  const afterTop = (d: PMNode, i: number) =>
    posBeforeTopBlock(d, i) + d.child(i).nodeSize;

  it("walks past a \\maketitle marker", () => {
    const d = doc(p("P1"), mt(), p("P2"), mt(), p("P3"));
    expect(findPreviousAnchorableBlock(d, posBeforeTopBlock(d, 2))?.uuid).toBe("P1");
    expect(findNextAnchorableBlock(d, afterTop(d, 2))?.uuid).toBe("P3");
  });

  it("walks past an unminted container", () => {
    const d = doc(p("P1"), blNoUuid(), p("P2"), blNoUuid(), p("P3"));
    expect(findPreviousAnchorableBlock(d, posBeforeTopBlock(d, 2))?.uuid).toBe("P1");
    expect(findNextAnchorableBlock(d, afterTop(d, 2))?.uuid).toBe("P3");
  });

  it("walks past a uuid-less paragraph", () => {
    const d = doc(p("P1"), p(null), p("P2"), p(null), p("P3"));
    expect(findPreviousAnchorableBlock(d, posBeforeTopBlock(d, 2))?.uuid).toBe("P1");
    expect(findNextAnchorableBlock(d, afterTop(d, 2))?.uuid).toBe("P3");
  });

  it("walks past a skipped (removed) sibling", () => {
    const d = doc(p("P1"), p("gone1"), p("P2"), p("gone2"), p("P3"));
    const skip = new Set(["gone1", "gone2"]);
    expect(findPreviousAnchorableBlock(d, posBeforeTopBlock(d, 2), skip)?.uuid).toBe("P1");
    expect(findNextAnchorableBlock(d, afterTop(d, 2), skip)?.uuid).toBe("P3");
  });

  it("passes over a container's unqualifying edge items to an inner one", () => {
    const list = bl("ul1", [li("li1"), schema.nodes.listItem.create({ uuid: null }, p(null))]);
    const d = doc(list, p("P2"));
    expect(findPreviousAnchorableBlock(d, posBeforeTopBlock(d, 1))?.uuid).toBe("li1");
  });

  it("forward from the end of a list's last item climbs past the list", () => {
    const d = doc(bl("ul1", [li("li1"), li("li2")]), p("P2"));
    // Position just inside the list, after its last item.
    const endOfList = d.child(0).nodeSize - 1;
    expect(findNextAnchorableBlock(d, endOfList)?.uuid).toBe("P2");
  });

  it("the reported case: archive P2 after \\maketitle with the block below also gone", () => {
    const d = doc(p("P1"), mt(), p("P2"), p("P3"));
    // Remove P2 and P3 — nothing survives below; P1 is the honest home.
    const from = posBeforeTopBlock(d, 2);
    const to = d.content.size;
    const removed = collectRemovedAnchorUuids(d, from, to);
    expect(resolveDisplacedAnchorPlacement(d, from, to, removed)).toEqual({
      target: { uuid: "P1", kind: "paragraph" },
      below: false,
    });
  });

  it("forward rung walks past a removed block to the survivor beyond", () => {
    const d = doc(mt(), p("P1"), p("P2"), p("P3"));
    const from = posBeforeTopBlock(d, 1);
    const to = afterTop(d, 1);
    const removed = new Set([...collectRemovedAnchorUuids(d, from, to), "P2"]);
    expect(resolveDisplacedAnchorPlacement(d, from, to, removed)).toEqual({
      target: { uuid: "P3", kind: "paragraph" },
      below: true,
    });
  });
});
