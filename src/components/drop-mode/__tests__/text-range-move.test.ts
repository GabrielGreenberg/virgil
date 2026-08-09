import { describe, expect, it } from "vitest";
import { Schema, type Mark, type Node as PMNode } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { textRangeMoveDropSpec } from "../specs/text-range-move";
import type { DropCtx, Placement } from "../types";

// A plain selection lifts as `linkedRange` and moves as a text SLICE. Two
// targets: over text → the run moves to the inline caret (L3f-2); in a block
// gap → the run drops as BLOCK content, fit to the gap's context (L3f-3).
//
// The inline-cursor move still needs a live editor (it can't be driven
// headlessly) and is exercised live. The between-blocks move IS unit-tested
// here against a real PM schema: build the dispatched transaction and inspect
// its doc WITHOUT applying it (the live doc is never touched), the
// non-destructive technique L3f-2 established.

const rect = { x: 0, y: 0, width: 0, height: 0 };
const nullEditor = null as unknown as Placement["editor"];

describe("text-range-move drop spec — scope + safe no-ops", () => {
  it("allows the inline-cursor (within-text) AND between-blocks placements", () => {
    expect(textRangeMoveDropSpec.allowedPlacements).toEqual([
      "inline-cursor",
      "between-blocks",
    ]);
  });

  it("targets any editor and closes the float after a drop", () => {
    expect(textRangeMoveDropSpec.targetScope).toBe("any-editor");
    expect(textRangeMoveDropSpec.postDrop).toBe("close");
  });

  it("no-ops a between-blocks placement when there is no editor to resolve from", () => {
    const placement: Placement = {
      kind: "between-blocks",
      editor: nullEditor,
      insertPos: 0,
      rect,
    };
    const ctx = { mainEditor: null } as unknown as DropCtx;
    expect(
      textRangeMoveDropSpec.classifyDrop(placement, "textobject:linkedRange:abcd", ctx),
    ).toEqual({ kind: "no-op" });
  });

  it("no-ops a paragraph-side placement (neither caret nor block gap)", () => {
    const placement: Placement = {
      kind: "paragraph-side",
      editor: nullEditor,
      paragraphId: "x",
      side: "left",
      rect,
    };
    const ctx = { mainEditor: null } as unknown as DropCtx;
    expect(
      textRangeMoveDropSpec.classifyDrop(placement, "textobject:linkedRange:abcd", ctx),
    ).toEqual({ kind: "no-op" });
  });

  it("no-ops when there is no main editor to resolve the range from", () => {
    const placement: Placement = { kind: "inline-cursor", editor: nullEditor, pos: 5, rect };
    const ctx = { mainEditor: null } as unknown as DropCtx;
    expect(
      textRangeMoveDropSpec.classifyDrop(placement, "textobject:linkedRange:abcd", ctx),
    ).toEqual({ kind: "no-op" });
  });

  it("no-ops a cardKey that isn't a linkedRange", () => {
    const placement: Placement = { kind: "inline-cursor", editor: nullEditor, pos: 5, rect };
    const ctx = { mainEditor: null } as unknown as DropCtx;
    expect(
      textRangeMoveDropSpec.classifyDrop(placement, "textobject:paragraph:abcd", ctx),
    ).toEqual({ kind: "no-op" });
  });
});

// ── Real-schema between-blocks behavior (L3f-3) ──────────────────────────────

// Minimal schema covering the contexts the wrap policy fits: top-level
// paragraphs, lists (bulletList > listItem > paragraph), blockquote — plus the
// `linkedAnchor` mark the range rides. Hand-rolled so the test needs no editor
// / extension barrel. Node names match TEXT_OBJECT_REGISTRY keys so the real
// `classifyParentAt` (imported via the spec) recognizes each context.
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
    text: { group: "inline" },
  },
  marks: {
    linkedAnchor: {
      attrs: { anchorId: {}, kind: { default: null } },
      toDOM: () => ["span", 0],
    },
  },
});

const anchor = (id: string) => schema.marks.linkedAnchor.create({ anchorId: id, kind: "transient" });
const t = (text: string, marks?: Mark[]) => schema.text(text, marks);
const para = (...inline: PMNode[]) => schema.nodes.paragraph.create(null, inline);
const li = (text: string) => schema.nodes.listItem.create(null, para(t(text)));
const bulletList = (...items: PMNode[]) => schema.nodes.bulletList.create(null, items);
const blockquote = (...paras: PMNode[]) => schema.nodes.blockquote.create(null, paras);
const doc = (...blocks: PMNode[]) => schema.nodes.doc.create(null, blocks);

const KEY = "textobject:linkedRange:a1";

function mockEditor(d: PMNode) {
  const dispatched: Transaction[] = [];
  const state = EditorState.create({ schema, doc: d });
  const editor = {
    state,
    view: { dispatch: (tr: Transaction) => dispatched.push(tr), focus: () => {} },
  } as unknown as Editor;
  return { editor, dispatched, ctx: { mainEditor: editor } as unknown as DropCtx };
}

function betweenBlocks(editor: Editor, insertPos: number): Placement {
  return { kind: "between-blocks", editor, insertPos, rect };
}

function paraTexts(d: PMNode): string[] {
  const out: string[] = [];
  d.descendants((n) => {
    if (n.type.name === "paragraph") out.push(n.textContent);
    return true;
  });
  return out;
}

function hasAnchorMark(d: PMNode): boolean {
  let found = false;
  d.descendants((n) => {
    if (n.marks.some((m) => m.type.name === "linkedAnchor")) found = true;
    return true;
  });
  return found;
}

describe("text-range-move between-blocks drop (L3f-3)", () => {
  it("top-level gap → the run becomes its OWN new paragraph (mark stripped, source emptied of it)", () => {
    // doc( p("alpha BETA gamma"), p("second") ) — "BETA" marked @a1
    const d = doc(
      para(t("alpha "), t("BETA", [anchor("a1")]), t(" gamma")),
      para(t("second")),
    );
    const { editor, dispatched, ctx } = mockEditor(d);
    const gap = d.firstChild!.nodeSize; // top-level boundary between p1 and p2

    expect(textRangeMoveDropSpec.classifyDrop(betweenBlocks(editor, gap), KEY, ctx)).toEqual({
      kind: "apply",
    });
    textRangeMoveDropSpec.applyDrop(betweenBlocks(editor, gap), KEY, ctx);

    expect(dispatched).toHaveLength(1);
    const result = dispatched[0].doc;
    // "BETA" lifted into its own paragraph at the gap; not merged into a neighbour.
    expect(paraTexts(result)).toEqual(["alpha  gamma", "BETA", "second"]);
    expect(hasAnchorMark(result)).toBe(false);
  });

  it("list gap → the run becomes a list item JOINING the list (not splitting it)", () => {
    // doc( ul(li one, li two), p("src ANCHOR") ) — "ANCHOR" marked @a1
    const d = doc(
      bulletList(li("one"), li("two")),
      para(t("src "), t("ANCHOR", [anchor("a1")])),
    );
    const { editor, dispatched, ctx } = mockEditor(d);
    const list = d.firstChild!;
    const listGap = 1 + list.firstChild!.nodeSize; // inside the list, after item one

    textRangeMoveDropSpec.applyDrop(betweenBlocks(editor, listGap), KEY, ctx);

    const result = dispatched[0].doc;
    const resultList = result.firstChild!;
    expect(resultList.type.name).toBe("bulletList");
    expect(resultList.childCount).toBe(3); // one item became three: list stayed whole
    expect(resultList.child(0).type.name).toBe("listItem");
    expect(resultList.child(1).type.name).toBe("listItem");
    expect([
      resultList.child(0).textContent,
      resultList.child(1).textContent,
      resultList.child(2).textContent,
    ]).toEqual(["one", "ANCHOR", "two"]);
    expect(result.lastChild!.textContent).toBe("src "); // source shed ANCHOR
    expect(hasAnchorMark(result)).toBe(false);
  });

  it("blockquote gap → the run becomes a paragraph INSIDE the quote", () => {
    const d = doc(
      blockquote(para(t("q1")), para(t("q2"))),
      para(t("src "), t("ANCHOR", [anchor("a1")])),
    );
    const { editor, dispatched, ctx } = mockEditor(d);
    const quote = d.firstChild!;
    const quoteGap = 1 + quote.firstChild!.nodeSize; // inside the quote, after q1

    textRangeMoveDropSpec.applyDrop(betweenBlocks(editor, quoteGap), KEY, ctx);

    const result = dispatched[0].doc;
    const resultQuote = result.firstChild!;
    expect(resultQuote.type.name).toBe("blockquote");
    expect(resultQuote.childCount).toBe(3);
    expect([
      resultQuote.child(0).textContent,
      resultQuote.child(1).textContent,
      resultQuote.child(2).textContent,
    ]).toEqual(["q1", "ANCHOR", "q2"]);
    expect(hasAnchorMark(result)).toBe(false);
  });

  it("multi-block range → preserves its block structure at a top-level gap", () => {
    // range spans two paragraphs; drop at a later top-level gap.
    const d = doc(
      para(t("one", [anchor("a1")])),
      para(t("two", [anchor("a1")])),
      para(t("tail")),
    );
    const { editor, dispatched, ctx } = mockEditor(d);
    const gap = d.content.size; // after the last block (end of doc)

    textRangeMoveDropSpec.applyDrop(betweenBlocks(editor, gap), KEY, ctx);

    const result = dispatched[0].doc;
    // The two source paragraphs moved (IN ORDER) to the end as two siblings —
    // the block structure is preserved.
    //
    // This assertion used to read `["", "tail", "one", "two"]` and CEMENTED the
    // task-320 bug: the range covered both paragraphs' entire CONTENT (not their
    // boundaries), and a text-bounded `delete(from, to)` can never remove its
    // first block, so the gesture left a blank paragraph behind — which was also
    // a second live block still answering to the first source block's `uuid`.
    // The blank is a residue of the gesture, not authored content; the move now
    // drops it, and the identity travels with the text. See
    // `range-move-identity.test.ts` for the identity half.
    expect(paraTexts(result)).toEqual(["tail", "one", "two"]);
    expect(paraTexts(result).slice(-2)).toEqual(["one", "two"]);
    expect(hasAnchorMark(result)).toBe(false);
  });

  it("no-ops a between-blocks self-drop (a gap inside the source range)", () => {
    // range spans p1+p2; the gap between them sits inside [from, to].
    const d = doc(para(t("A", [anchor("a1")])), para(t("B", [anchor("a1")])));
    const { editor, ctx } = mockEditor(d);
    const innerGap = d.firstChild!.nodeSize; // boundary between p1 and p2

    expect(textRangeMoveDropSpec.classifyDrop(betweenBlocks(editor, innerGap), KEY, ctx)).toEqual({
      kind: "no-op",
    });
  });
});
