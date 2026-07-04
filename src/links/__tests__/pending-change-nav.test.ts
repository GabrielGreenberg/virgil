import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { sortAppliedKeysByDocPos } from "@/links/pending-change-nav";
import type { PendingChangeIndex } from "@/components/PendingChangePill";

// Minimal schema carrying the `linkedAnchor` mark the sort resolves positions
// through — hand-rolled so the test needs no editor / extension barrel (mirrors
// linked-anchor-range.test.ts).
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
  },
});

const anchor = (anchorId: string) =>
  schema.marks.linkedAnchor.create({ anchorId, kind: null });

function para(...inline: ReturnType<typeof schema.text>[]) {
  return schema.nodes.paragraph.create(null, inline);
}
function doc(...blocks: ReturnType<typeof para>[]) {
  return schema.nodes.doc.create(null, blocks);
}

/** Build a `PendingChangeIndex` from `kind:id → anchorId` pairs. The onKeep /
 *  onDismiss closures are no-ops — the sort only reads `anchorId`. */
function index(
  pairs: Array<{ key: string; anchorId: string }>,
): PendingChangeIndex {
  const m: PendingChangeIndex = new Map();
  for (const { key, anchorId } of pairs) {
    m.set(key, { anchorId, onKeep: () => {}, onDismiss: () => {} });
  }
  return m;
}

describe("sortAppliedKeysByDocPos", () => {
  it("orders keys by the doc position of their blue range, NOT insertion order", () => {
    // Three changes, seeded into the index in a scrambled order. In the doc
    // their marks appear c1 (earliest) → c2 → c3, across three paragraphs.
    const d = doc(
      para(schema.text("first ", []), schema.text("aaa", [anchor("A")])),
      para(schema.text("bbb", [anchor("B")])),
      para(schema.text("tail ", []), schema.text("ccc", [anchor("C")])),
    );
    const idx = index([
      { key: "cutter-suggestion:c3", anchorId: "C" },
      { key: "revision-suggestion:c1", anchorId: "A" },
      { key: "revision-suggestion:c2", anchorId: "B" },
    ]);
    expect(sortAppliedKeysByDocPos(idx, d)).toEqual([
      "revision-suggestion:c1",
      "revision-suggestion:c2",
      "cutter-suggestion:c3",
    ]);
  });

  it("pushes keys whose mark is missing to the end, keeping resolved ones in doc order", () => {
    const d = doc(
      para(schema.text("x", [anchor("LATER")])),
      para(schema.text("y", [anchor("EARLIER")])),
    );
    // EARLIER is at a later paragraph? No — LATER's mark is in paragraph 1
    // (earlier pos), EARLIER's in paragraph 2. The names are intentionally the
    // opposite of doc order to prove the sort reads POSITIONS, not ids.
    const idx = index([
      { key: "a:gone", anchorId: "MISSING" }, // no mark in the doc
      { key: "a:earlier-pos", anchorId: "LATER" },
      { key: "a:later-pos", anchorId: "EARLIER" },
    ]);
    expect(sortAppliedKeysByDocPos(idx, d)).toEqual([
      "a:earlier-pos", // pos of the LATER mark = paragraph 1
      "a:later-pos", // pos of the EARLIER mark = paragraph 2
      "a:gone", // unresolved → end
    ]);
  });

  it("is deterministic for multiple unresolved keys (stable insertion order at the tail)", () => {
    const d = doc(para(schema.text("plain")));
    const idx = index([
      { key: "a:g1", anchorId: "NOPE1" },
      { key: "a:g2", anchorId: "NOPE2" },
    ]);
    expect(sortAppliedKeysByDocPos(idx, d)).toEqual(["a:g1", "a:g2"]);
  });

  it("returns [] for an empty index", () => {
    const d = doc(para(schema.text("plain")));
    expect(sortAppliedKeysByDocPos(index([]), d)).toEqual([]);
  });
});
