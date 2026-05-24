/**
 * Minimal PM schema for doc-structure tests.
 *
 * Mirrors the shape of the production schema for the node types the
 * observer cares about, but trimmed to what tests need.
 */

import { Schema, type Node as PMNode } from "@tiptap/pm/model";

export const testSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      attrs: { uuid: { default: null }, parTitle: { default: null } },
      toDOM: () => ["p", 0],
    },
    heading: {
      group: "block",
      content: "inline*",
      attrs: {
        uuid: { default: null },
        level: { default: 1 },
        label: { default: null },
        numbered: { default: true },
        sectionNumber: { default: null },
      },
      toDOM: (node) => [`h${node.attrs.level}`, 0],
    },
    figureBlock: {
      group: "block",
      content: "inline*",
      attrs: {
        uuid: { default: null },
        label: { default: "" },
        numbered: { default: true },
        figureNumber: { default: null },
      },
      toDOM: () => ["figure", 0],
    },
    exampleBlock: {
      group: "block",
      content: "exampleItem+",
      attrs: {
        uuid: { default: null },
        tag: { default: "" },
        label: { default: "" },
        number: { default: null },
      },
      toDOM: () => ["div", { class: "expex" }, 0],
    },
    exampleItem: {
      content: "inline*",
      attrs: { uuid: { default: null }, label: { default: "" }, subLabel: { default: "" } },
      toDOM: () => ["span", 0],
    },
    footnote: {
      group: "inline",
      inline: true,
      atom: true,
      attrs: {
        footnoteId: { default: "" },
        number: { default: 1 },
        thanks: { default: false },
      },
      toDOM: () => ["span", { class: "footnote" }],
    },
    text: { group: "inline" },
  },
  marks: {
    linkedAnchor: {
      attrs: { anchorId: { default: "" }, kind: { default: "note" } },
      toDOM: () => ["span", { class: "linked-anchor" }],
    },
  },
});

// ---------------------------------------------------------------------------
// Small helpers — build a doc, find positions, dispatch transactions.
// ---------------------------------------------------------------------------

export function paragraph(uuid: string | null, text: string): PMNode {
  return testSchema.nodes.paragraph.create({ uuid }, text ? testSchema.text(text) : null);
}

export function heading(
  uuid: string,
  level: number,
  text: string,
  attrs: Record<string, unknown> = {},
): PMNode {
  return testSchema.nodes.heading.create(
    { uuid, level, ...attrs },
    testSchema.text(text),
  );
}

export function figureBlock(uuid: string, label = "", numbered = true): PMNode {
  return testSchema.nodes.figureBlock.create({ uuid, label, numbered });
}

export function exampleBlock(
  uuid: string,
  attrs: Record<string, unknown> = {},
  items: PMNode[] = [],
): PMNode {
  const itemNodes = items.length > 0 ? items : [testSchema.nodes.exampleItem.create()];
  return testSchema.nodes.exampleBlock.create({ uuid, ...attrs }, itemNodes);
}

export function exampleItem(attrs: Record<string, unknown> = {}): PMNode {
  return testSchema.nodes.exampleItem.create(attrs);
}

export function footnoteNode(footnoteId: string, number = 1, thanks = false): PMNode {
  return testSchema.nodes.footnote.create({ footnoteId, number, thanks });
}

export function doc(...blocks: PMNode[]): PMNode {
  return testSchema.nodes.doc.create({}, blocks);
}

export function anchoredText(text: string, anchorId: string, kind = "note"): PMNode {
  return testSchema.text(text, [
    testSchema.marks.linkedAnchor.create({ anchorId, kind }),
  ]);
}
