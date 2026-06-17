// @vitest-environment jsdom
/**
 * DEFERRING_PARENTS regression — the drop hit-test must NOT mint an anchor UUID
 * on a container-INNER paragraph.
 *
 * `resolveAnchorableBlock` (drop hit-test) used to walk up to the FIRST
 * anchorable node and mint there. Inside a list item / blockquote / expex item
 * that first node is the inner `paragraph` — but `assignUuids` (latex-serializer)
 * STRIPS inner-container-paragraph UUIDs on the very next save, so a card
 * re-anchored into a list/blockquote was a deterministic orphan on reload,
 * independent of any timing race.
 *
 * The fix collapses the drop resolver onto the SAME SSOT the normal anchor path
 * uses (`resolveAnchorableNode` / `ensureAnchorUuid` in `@/lib/anchor-uuid`),
 * which honors `DEFERRING_PARENTS` — so a cursor inside a container-nested
 * paragraph resolves the CONTAINER (listItem / blockquote / exampleItem), NOT
 * the inner paragraph. These tests lock that:
 *   - a cursor inside a list item resolves the listItem, mints on the listItem;
 *   - same for a blockquote and an exampleItem;
 *   - a plain top-level paragraph still resolves the paragraph (unchanged);
 *   - the mint transaction is tagged with the anchor-mint flush signal.
 */

import { describe, expect, it } from "vitest";
import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { resolveAnchorableBlock } from "../hit-test";
import { isAnchorMintTransaction } from "@/lib/anchor-mint-signal";

// Hand-rolled schema; node names match the production `DEFERRING_PARENTS` set
// and `isAnchorableNode` (a node is anchorable iff its spec declares a `uuid`
// attr). exampleItem/blockquote/listItem all carry a uuid attr AND nest a
// paragraph that ALSO carries one — exactly the mis-mint surface.
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
const li = (...paras: PMNode[]) => schema.nodes.listItem.create(null, paras);
const bulletList = (...items: PMNode[]) =>
  schema.nodes.bulletList.create(null, items);
const blockquote = (...paras: PMNode[]) =>
  schema.nodes.blockquote.create(null, paras);
const exItem = (...paras: PMNode[]) =>
  schema.nodes.exampleItem.create(null, paras);
const exList = (...items: PMNode[]) =>
  schema.nodes.exampleItemList.create(null, items);
const exBlock = (...items: PMNode[]) =>
  schema.nodes.exampleBlock.create(null, items);
const doc = (...blocks: PMNode[]) => schema.nodes.doc.create(null, blocks);

interface NodeInfo {
  pos: number;
  size: number;
  type: string;
}
function findByType(d: PMNode, typeName: string): NodeInfo[] {
  const out: NodeInfo[] = [];
  d.descendants((n, pos) => {
    if (n.type.name === typeName)
      out.push({ pos, size: n.nodeSize, type: n.type.name });
    return true;
  });
  return out;
}

/**
 * A mock editor whose `view` carries a LIVE EditorState — `state` is read by
 * both `editor.state` (hit-test) AND `editor.view.state` (the delegated
 * resolveAnchorableNode / ensureAnchorUuid). Dispatched mint transactions are
 * recorded (and applied so `view.state.doc` reflects the uuid). `nodeDOM`
 * returns a fresh element with a stub bounding rect.
 */
function mockEditor(d: PMNode) {
  const dispatched: Transaction[] = [];
  let state = EditorState.create({ schema, doc: d });
  const box = {
    top: 0, bottom: 10, left: 0, right: 100, width: 100, height: 10, x: 0, y: 0,
  };
  const view = {
    get state() {
      return state;
    },
    nodeDOM: (_pos: number) => {
      const el = document.createElement("div");
      el.getBoundingClientRect = () =>
        ({ ...box, toJSON: () => box }) as DOMRect;
      return el;
    },
    dispatch: (tr: Transaction) => {
      dispatched.push(tr);
      state = state.apply(tr);
    },
    focus: () => {},
  };
  const editor = {
    get state() {
      return state;
    },
    view,
  } as unknown as Editor;
  return { editor, dispatched };
}

describe("resolveAnchorableBlock — honors DEFERRING_PARENTS (SSOT delegation)", () => {
  it("cursor inside a LIST ITEM paragraph resolves the listItem, NOT the inner paragraph", () => {
    const d = doc(
      para("intro"),
      bulletList(li(para("item text")), li(para("second"))),
    );
    const { editor, dispatched } = mockEditor(d);
    const listItems = findByType(d, "listItem");
    const innerParas = findByType(d, "paragraph");
    const firstItem = listItems[0];
    // Inner paragraph of the first list item: its position is firstItem.pos + 1.
    const innerPara = innerParas.find((p) => p.pos === firstItem.pos + 1)!;

    // A pos inside the first list item's inner paragraph text.
    const info = resolveAnchorableBlock(editor, innerPara.pos + 1);
    expect(info).not.toBeNull();
    // Resolves the CONTAINER listItem boundary, NOT the inner paragraph.
    expect(info!.blockPos).toBe(firstItem.pos);
    expect(info!.blockPos).not.toBe(innerPara.pos);
    // The minted UUID landed on the listItem node, not the paragraph.
    const mintedNode = editor.state.doc.nodeAt(firstItem.pos)!;
    expect(mintedNode.type.name).toBe("listItem");
    expect(mintedNode.attrs.uuid).toBe(info!.uuid);
    // The inner paragraph stayed uuid-less (so assignUuids has nothing to strip).
    const innerNode = editor.state.doc.nodeAt(innerPara.pos)!;
    expect(innerNode.type.name).toBe("paragraph");
    expect(innerNode.attrs.uuid).toBeNull();
    // The mint tx was tagged for the immediate-flush gate.
    expect(dispatched).toHaveLength(1);
    expect(isAnchorMintTransaction(dispatched[0])).toBe(true);
  });

  it("cursor inside a BLOCKQUOTE paragraph resolves the blockquote, NOT the inner paragraph", () => {
    const d = doc(para("intro"), blockquote(para("quoted line")));
    const { editor } = mockEditor(d);
    const bq = findByType(d, "blockquote")[0];
    const innerPara = findByType(d, "paragraph").find(
      (p) => p.pos === bq.pos + 1,
    )!;

    const info = resolveAnchorableBlock(editor, innerPara.pos + 1);
    expect(info).not.toBeNull();
    expect(info!.blockPos).toBe(bq.pos);
    const mintedNode = editor.state.doc.nodeAt(bq.pos)!;
    expect(mintedNode.type.name).toBe("blockquote");
    expect(mintedNode.attrs.uuid).toBe(info!.uuid);
  });

  it("cursor inside an EXPEX item paragraph resolves the exampleItem, NOT the inner paragraph", () => {
    const d = doc(exBlock(exList(exItem(para("alpha")), exItem(para("beta")))));
    const { editor } = mockEditor(d);
    const exItems = findByType(d, "exampleItem");
    const firstItem = exItems[0];
    const innerPara = findByType(d, "paragraph").find(
      (p) => p.pos === firstItem.pos + 1,
    )!;

    const info = resolveAnchorableBlock(editor, innerPara.pos + 1);
    expect(info).not.toBeNull();
    expect(info!.blockPos).toBe(firstItem.pos);
    const mintedNode = editor.state.doc.nodeAt(firstItem.pos)!;
    expect(mintedNode.type.name).toBe("exampleItem");
    expect(mintedNode.attrs.uuid).toBe(info!.uuid);
  });

  it("a plain TOP-LEVEL paragraph still resolves the paragraph itself (unchanged)", () => {
    const d = doc(para("first"), para("second"));
    const { editor, dispatched } = mockEditor(d);
    const paras = findByType(d, "paragraph");
    const second = paras[1];

    const info = resolveAnchorableBlock(editor, second.pos + 1);
    expect(info).not.toBeNull();
    expect(info!.blockPos).toBe(second.pos);
    const mintedNode = editor.state.doc.nodeAt(second.pos)!;
    expect(mintedNode.type.name).toBe("paragraph");
    expect(mintedNode.attrs.uuid).toBe(info!.uuid);
    expect(isAnchorMintTransaction(dispatched[0])).toBe(true);
  });

  it("an ALREADY-anchored container is reused (no re-mint, no extra tx)", () => {
    // listItem carries a uuid; its inner paragraph does too (the kind of stale
    // inner uuid assignUuids would strip). Re-anchoring must reuse the
    // container's existing uuid and mint NOTHING.
    const liNode = schema.nodes.listItem.create(
      { uuid: "L1" },
      para("text", "P1"),
    );
    const d = doc(bulletList(liNode));
    const { editor, dispatched } = mockEditor(d);
    const item = findByType(d, "listItem")[0];
    const innerPara = findByType(d, "paragraph").find(
      (p) => p.pos === item.pos + 1,
    )!;

    const info = resolveAnchorableBlock(editor, innerPara.pos + 1);
    expect(info).not.toBeNull();
    expect(info!.blockPos).toBe(item.pos);
    // Reused the container uuid (not the inner paragraph's "P1").
    expect(info!.uuid).toBe("L1");
    // No mint transaction dispatched at all.
    expect(dispatched).toHaveLength(0);
  });
});
