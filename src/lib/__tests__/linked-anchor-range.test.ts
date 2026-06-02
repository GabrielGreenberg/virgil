import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import {
  findLinkedAnchorRange,
  rangeSliceToBlocks,
  stripLinkedAnchorMarks,
} from "@/lib/linked-anchor-range";

// A minimal schema with the marks the helpers care about — `linkedAnchor`
// (the range handle) plus a sibling mark (`bold`) to prove the strip is
// surgical. Hand-rolled so the test needs no editor / extension barrel.
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      toDOM: () => ["p", 0],
      parseDOM: [{ tag: "p" }],
    },
    text: { group: "inline" },
  },
  marks: {
    linkedAnchor: {
      attrs: { anchorId: {}, kind: { default: null } },
      toDOM: () => ["span", 0],
      parseDOM: [{ tag: "span" }],
    },
    bold: {
      toDOM: () => ["strong", 0],
      parseDOM: [{ tag: "strong" }],
    },
  },
});

const anchor = (anchorId: string, kind?: string) =>
  schema.marks.linkedAnchor.create({ anchorId, kind: kind ?? null });
const bold = schema.marks.bold.create();

function para(...inline: ReturnType<typeof schema.text>[]) {
  return schema.nodes.paragraph.create(null, inline);
}
function doc(...blocks: ReturnType<typeof para>[]) {
  return schema.nodes.doc.create(null, blocks);
}

describe("findLinkedAnchorRange", () => {
  it("returns the [start, end) of a single marked run", () => {
    // p( "Hello " [1,7) | "world"@a1 [7,12) | "!" [12,13) )
    const d = doc(
      para(schema.text("Hello "), schema.text("world", [anchor("a1")]), schema.text("!")),
    );
    expect(findLinkedAnchorRange(d, "a1")).toEqual({ from: 7, to: 12 });
  });

  it("spans the bounding range across a gap (two marked runs, unmarked middle)", () => {
    // "AA"@a1 [1,3) | "  "  [3,5) | "BB"@a1 [5,7)  → bounding [1,7)
    const d = doc(
      para(
        schema.text("AA", [anchor("a1")]),
        schema.text("  "),
        schema.text("BB", [anchor("a1")]),
      ),
    );
    expect(findLinkedAnchorRange(d, "a1")).toEqual({ from: 1, to: 7 });
  });

  it("spans across a paragraph break (multi-paragraph range)", () => {
    // p1: "x"@a1 [1,2); p2: "y"@a1 [4,5)  → bounding [1,5)
    const d = doc(
      para(schema.text("x", [anchor("a1")])),
      para(schema.text("y", [anchor("a1")])),
    );
    expect(findLinkedAnchorRange(d, "a1")).toEqual({ from: 1, to: 5 });
  });

  it("ignores marks with a different anchorId", () => {
    const d = doc(
      para(schema.text("a", [anchor("other")]), schema.text("b", [anchor("a1")])),
    );
    expect(findLinkedAnchorRange(d, "a1")).toEqual({ from: 2, to: 3 });
  });

  it("returns null when the anchor is absent", () => {
    const d = doc(para(schema.text("plain")));
    expect(findLinkedAnchorRange(d, "missing")).toBeNull();
  });
});

describe("stripLinkedAnchorMarks", () => {
  it("removes every linkedAnchor mark from the slice's text", () => {
    const d = doc(
      para(schema.text("hello "), schema.text("world", [anchor("a1", "transient")])),
    );
    const stripped = stripLinkedAnchorMarks(d.slice(1, d.content.size));
    let sawAnchor = false;
    stripped.content.descendants((n) => {
      if (n.marks.some((m) => m.type.name === "linkedAnchor")) sawAnchor = true;
      return true;
    });
    expect(sawAnchor).toBe(false);
  });

  it("preserves sibling marks (bold survives, anchor removed)", () => {
    const d = doc(para(schema.text("bolded", [bold, anchor("a1")])));
    const stripped = stripLinkedAnchorMarks(d.slice(1, d.content.size));
    let sawBold = false;
    let sawAnchor = false;
    stripped.content.descendants((n) => {
      if (!n.isText) return true;
      if (n.marks.some((m) => m.type.name === "bold")) sawBold = true;
      if (n.marks.some((m) => m.type.name === "linkedAnchor")) sawAnchor = true;
      return true;
    });
    expect(sawBold).toBe(true);
    expect(sawAnchor).toBe(false);
  });

  it("preserves the slice's open depths (inline range stays inline)", () => {
    const d = doc(
      para(schema.text("Hello "), schema.text("world", [anchor("a1")]), schema.text("!")),
    );
    const slice = d.slice(7, 12); // inside the paragraph → openStart/openEnd 1
    const stripped = stripLinkedAnchorMarks(slice);
    expect(stripped.openStart).toBe(slice.openStart);
    expect(stripped.openEnd).toBe(slice.openEnd);
    expect(stripped.content.textBetween(0, stripped.content.size)).toBe("world");
  });
});

describe("rangeSliceToBlocks", () => {
  it("wraps an inline run (a slice cut within one paragraph) in a single paragraph", () => {
    const d = doc(para(schema.text("Hello "), schema.text("world"), schema.text("!")));
    const blocks = rangeSliceToBlocks(d.slice(7, 12), schema); // "world"
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type.name).toBe("paragraph");
    expect(blocks[0].textContent).toBe("world");
  });

  it("keeps whole blocks for a multi-paragraph range", () => {
    const d = doc(para(schema.text("aaa")), para(schema.text("bbb")));
    const blocks = rangeSliceToBlocks(d.slice(2, 8), schema); // tail of p1 + head of p2
    expect(blocks.map((b) => b.type.name)).toEqual(["paragraph", "paragraph"]);
    expect(blocks.map((b) => b.textContent)).toEqual(["aa", "bb"]);
  });

  it("returns one empty paragraph for an empty slice", () => {
    const d = doc(para(schema.text("x")));
    const blocks = rangeSliceToBlocks(d.slice(2, 2), schema);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type.name).toBe("paragraph");
    expect(blocks[0].textContent).toBe("");
  });
});
