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
        // Unified link id — production footnote carries this; the host-id used
        // for a footnote-nested citation prefers it (`linkId ?? footnoteId`).
        linkId: { default: "" },
        number: { default: 1 },
        thanks: { default: false },
        // The footnote BODY — a JSONContent literal (NOT PM child nodes), so
        // `descendants()` can't enter it. Mirrors production's
        // `content: { default: null }`. Where a footnote-nested `\cite` lives.
        content: { default: null },
      },
      toDOM: () => ["span", { class: "footnote" }],
    },
    citation: {
      group: "inline",
      inline: true,
      atom: true,
      attrs: {
        citationId: { default: "" },
        command: { default: "" },
        displayText: { default: "" },
      },
      toDOM: () => ["span", { class: "citation" }],
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

export function exampleItem(
  attrs: Record<string, unknown> = {},
  text = "",
): PMNode {
  return testSchema.nodes.exampleItem.create(
    attrs,
    text ? testSchema.text(text) : null,
  );
}

/** An exampleItem whose inline content is arbitrary PM nodes (so a test can put
 *  a `citationNode` INSIDE an example — the example-nested-cite case). */
export function exampleItemWith(
  attrs: Record<string, unknown>,
  content: PMNode[],
): PMNode {
  return testSchema.nodes.exampleItem.create(attrs, content);
}

export function footnoteNode(footnoteId: string, number = 1, thanks = false): PMNode {
  return testSchema.nodes.footnote.create({ footnoteId, number, thanks });
}

/**
 * A footnote whose body (`attrs.content`) is a JSONContent literal — the place
 * a footnote-nested `\cite` lives, opaque to `descendants()`. `body` is the raw
 * JSONContent (a `doc`/`paragraph` tree with `citation` literals inside).
 */
export function footnoteWithBody(
  footnoteId: string,
  body: unknown,
  opts: { number?: number; thanks?: boolean; linkId?: string } = {},
): PMNode {
  return testSchema.nodes.footnote.create({
    footnoteId,
    number: opts.number ?? 1,
    thanks: opts.thanks ?? false,
    linkId: opts.linkId ?? "",
    content: body,
  });
}

/** A citation JSONContent literal (the shape stored inside a footnote body). */
export function citationLiteral(
  citationId: string,
  command = "",
  displayText = "",
): Record<string, unknown> {
  return {
    type: "citation",
    attrs: { citationId, command, displayText },
  };
}

export function citationNode(
  citationId: string,
  command = "",
  displayText = "",
): PMNode {
  return testSchema.nodes.citation.create({ citationId, command, displayText });
}

export function doc(...blocks: PMNode[]): PMNode {
  return testSchema.nodes.doc.create({}, blocks);
}

export function anchoredText(text: string, anchorId: string, kind = "note"): PMNode {
  return testSchema.text(text, [
    testSchema.marks.linkedAnchor.create({ anchorId, kind }),
  ]);
}
