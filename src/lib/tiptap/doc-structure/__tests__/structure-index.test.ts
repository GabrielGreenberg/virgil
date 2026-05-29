import { describe, expect, it } from "vitest";
import { applyDiff, buildInitial } from "../structure-index";
import { EMPTY_DIFF, type StructureDiff } from "../types";
import {
  anchoredText,
  citationNode,
  doc,
  exampleBlock,
  exampleItem,
  figureBlock,
  footnoteNode,
  heading,
  paragraph,
  testSchema,
} from "./fixtures";

describe("buildInitial", () => {
  it("collects every entity in document order", () => {
    const d = doc(
      heading("h1", 1, "Intro"),
      paragraph("p1", "body"),
      figureBlock("fig1", "fig:fish", true),
      exampleBlock("e1", { tag: "ex", label: "ex:1" }, [
        exampleItem({ label: "ex:1:a" }),
      ]),
    );
    const s = buildInitial(d);
    expect([...s.blocks.keys()].sort()).toEqual(["e1", "fig1", "h1", "p1"]);
    expect(s.headings.map((h) => h.uuid)).toEqual(["h1"]);
    expect(s.figures.map((f) => f.uuid)).toEqual(["fig1"]);
    expect(s.examples.map((e) => e.uuid)).toEqual(["e1"]);
    expect([...s.labels.keys()].sort()).toEqual(["ex:1", "ex:1:a", "fig:fish"]);
  });

  it("captures inline footnote nodes and linked-anchor marks", () => {
    const para = testSchema.nodes.paragraph.create(
      { uuid: "p1" },
      [
        anchoredText("anchored", "a1"),
        testSchema.text(" "),
        footnoteNode("fn1", 1, false),
      ],
    );
    const s = buildInitial(doc(para));
    expect(s.footnotes.map((f) => f.id)).toEqual(["fn1"]);
    expect([...s.anchors.keys()]).toEqual(["a1"]);
  });

  it("captures inline citation nodes in document order", () => {
    const para = testSchema.nodes.paragraph.create(
      { uuid: "p1" },
      [
        testSchema.text("see "),
        citationNode("c1", "\\cite{a}", "A"),
        testSchema.text(" and "),
        citationNode("c2", "\\cite{b}", "B"),
      ],
    );
    const s = buildInitial(doc(para));
    expect(s.citations.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(s.citations[0]?.command).toBe("\\cite{a}");
  });

  it("returns EMPTY_STRUCTURE-shaped snapshot for an empty doc", () => {
    const s = buildInitial(doc(paragraph(null, "x")));
    // null-UUID block is not tracked as a block.
    expect(s.blocks.size).toBe(0);
    expect(s.headings).toHaveLength(0);
    expect(s.footnotes).toHaveLength(0);
    expect(s.anchors.size).toBe(0);
  });

  it("ignores headings with null UUID (lazy hydration)", () => {
    const lazyHeading = testSchema.nodes.heading.create(
      { uuid: null, level: 1 },
      testSchema.text("Unhydrated"),
    );
    const s = buildInitial(doc(lazyHeading));
    expect(s.headings).toHaveLength(0);
    expect(s.blocks.size).toBe(0);
  });
});

describe("applyDiff", () => {
  function makeBaseStructure() {
    return buildInitial(
      doc(
        heading("h1", 1, "Intro", { label: null }),
        paragraph("p1", "first body"),
        paragraph("p2", "second body"),
      ),
    );
  }

  it("EMPTY_DIFF leaves the snapshot intact (version still bumps)", () => {
    const prev = makeBaseStructure();
    const next = applyDiff(prev, EMPTY_DIFF);
    expect(next.version).toBe(prev.version + 1);
    expect([...next.blocks.keys()].sort()).toEqual(["h1", "p1", "p2"]);
  });

  it("adds and removes blocks idempotently", () => {
    const prev = makeBaseStructure();
    const removeP2: StructureDiff = {
      ...EMPTY_DIFF,
      removedBlocks: [{ uuid: "p2", pos: 99, typeName: "paragraph" }],
    };
    const afterRemove = applyDiff(prev, removeP2);
    expect([...afterRemove.blocks.keys()].sort()).toEqual(["h1", "p1"]);

    const addP3: StructureDiff = {
      ...EMPTY_DIFF,
      addedBlocks: [{ uuid: "p3", pos: 50, typeName: "paragraph" }],
    };
    const afterAdd = applyDiff(afterRemove, addP3);
    expect([...afterAdd.blocks.keys()].sort()).toEqual(["h1", "p1", "p3"]);
  });

  it("changedHeadings replaces the matching entry without touching others", () => {
    const prev = makeBaseStructure();
    const changeH1: StructureDiff = {
      ...EMPTY_DIFF,
      changedHeadings: [
        { uuid: "h1", pos: 0, level: 2, text: "Intro", label: null, numbered: true },
      ],
    };
    const next = applyDiff(prev, changeH1);
    expect(next.headings).toHaveLength(1);
    expect(next.headings[0]?.level).toBe(2);
  });

  it("addedFootnotes preserves doc order via sort by pos", () => {
    const prev = buildInitial(doc(paragraph("p1", "body")));
    const diff: StructureDiff = {
      ...EMPTY_DIFF,
      addedFootnotes: [
        { id: "fn-late", pos: 50, thanks: false, number: 0 },
        { id: "fn-early", pos: 10, thanks: false, number: 0 },
      ],
    };
    const next = applyDiff(prev, diff);
    expect(next.footnotes.map((f) => f.id)).toEqual(["fn-early", "fn-late"]);
  });

  it("citations: add, change-in-place, and remove keep the list correct + ordered", () => {
    const prev = buildInitial(doc(paragraph("p1", "body")));
    const add: StructureDiff = {
      ...EMPTY_DIFF,
      addedCitations: [
        { id: "c-late", pos: 50, command: "\\cite{z}", displayText: "Z" },
        { id: "c-early", pos: 10, command: "\\cite{a}", displayText: "A" },
      ],
    };
    const afterAdd = applyDiff(prev, add);
    expect(afterAdd.citations.map((c) => c.id)).toEqual(["c-early", "c-late"]);

    const change: StructureDiff = {
      ...EMPTY_DIFF,
      changedCitations: [{ id: "c-early", pos: 10, command: "\\cite{a2}", displayText: "A2" }],
    };
    const afterChange = applyDiff(afterAdd, change);
    expect(afterChange.citations.find((c) => c.id === "c-early")?.command).toBe("\\cite{a2}");
    expect(afterChange.citations).toHaveLength(2);

    const remove: StructureDiff = {
      ...EMPTY_DIFF,
      removedCitations: [{ id: "c-late", pos: 50, command: "\\cite{z}", displayText: "Z" }],
    };
    const afterRemove = applyDiff(afterChange, remove);
    expect(afterRemove.citations.map((c) => c.id)).toEqual(["c-early"]);
  });

  it("addedAnchors and removedAnchors update the anchors Map", () => {
    const prev = buildInitial(doc(paragraph("p1", "body")));
    const diff: StructureDiff = {
      ...EMPTY_DIFF,
      addedAnchors: [{ id: "a1", from: 1, to: 5, kind: "note" }],
    };
    const after = applyDiff(prev, diff);
    expect(after.anchors.get("a1")?.kind).toBe("note");

    const removeDiff: StructureDiff = {
      ...EMPTY_DIFF,
      removedAnchors: [{ id: "a1", from: 1, to: 5, kind: "note" }],
    };
    const back = applyDiff(after, removeDiff);
    expect(back.anchors.has("a1")).toBe(false);
  });

  it("addedLabels + removedLabels keep the labels Map in sync", () => {
    const prev = buildInitial(doc(paragraph("p1", "body")));
    const addDiff: StructureDiff = {
      ...EMPTY_DIFF,
      addedLabels: [
        { id: "fig:1", owner: "figure", ownerUuid: "fig1", pos: 10 },
        { id: "sec:1", owner: "heading", ownerUuid: "h1", pos: 0 },
      ],
    };
    const after = applyDiff(prev, addDiff);
    expect([...after.labels.keys()].sort()).toEqual(["fig:1", "sec:1"]);
  });

  it("monotonic version", () => {
    const prev = makeBaseStructure();
    const a = applyDiff(prev, EMPTY_DIFF);
    const b = applyDiff(a, EMPTY_DIFF);
    expect(b.version).toBe(prev.version + 2);
  });
});
