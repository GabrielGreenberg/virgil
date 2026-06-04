import { describe, expect, it } from "vitest";
import { EditorState } from "@tiptap/pm/state";
import { Slice, Fragment } from "@tiptap/pm/model";
import { inspectSteps } from "../step-inspector";
import { buildInitial } from "../structure-index";
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

function stateOf(node: ReturnType<typeof doc>): EditorState {
  return EditorState.create({ schema: testSchema, doc: node });
}

/** Type the call sites — the diff is read-only-shaped. */
function expectEmpty(d: StructureDiff): void {
  expect(d).toBe(EMPTY_DIFF);
}

describe("inspectSteps — typing inside an existing paragraph", () => {
  it("returns EMPTY_DIFF for !tr.docChanged", () => {
    const s = stateOf(doc(paragraph("p1", "hello")));
    const tr = s.tr; // No changes.
    expect(inspectSteps(tr, s.doc, tr.doc)).toBe(EMPTY_DIFF);
  });

  it("treats typing within a paragraph as a structurally null edit", () => {
    const s = stateOf(doc(paragraph("p1", "hello")));
    // Insert a character at the end of the paragraph's text — pos 6
    // (1 for the paragraph's opening token, then 5 chars of "hello").
    const tr = s.tr.insertText("!", 6, 6);
    const d = inspectSteps(tr, s.doc, tr.doc);
    // Block identity unchanged.
    expect(d.addedBlocks).toHaveLength(0);
    expect(d.removedBlocks).toHaveLength(0);
    expect(d.addedHeadings).toHaveLength(0);
    expect(d.removedHeadings).toHaveLength(0);
    expect(d.changedHeadings).toHaveLength(0);
    // Content change attributed to p1.
    expect(d.contentChangedUuids.has("p1")).toBe(true);
  });
});

describe("inspectSteps — paragraph split / merge", () => {
  it("Enter to split a paragraph emits no addedBlocks (UUID clone is suppressed)", () => {
    const s = stateOf(doc(paragraph("p1", "hello world")));
    const prev = buildInitial(s.doc);
    // Split at "hello |world" → pos 7.
    const tr = s.tr.split(7);
    const d = inspectSteps(tr, s.doc, tr.doc, prev);
    // The cloned-UUID half is suppressed: prev.blocks already has p1,
    // so the diff routes it through contentChangedUuids and leaves
    // addedBlocks empty until lazy hydration assigns a fresh UUID.
    expect(d.addedBlocks).toHaveLength(0);
    expect(d.removedBlocks).toHaveLength(0);
    // p1's interior was touched.
    expect(d.contentChangedUuids.has("p1")).toBe(true);
  });

  it("Backspace merging two paragraphs removes the second's UUID", () => {
    const s = stateOf(doc(paragraph("p1", "hello"), paragraph("p2", "world")));
    // The boundary between p1 (ends at 6) and p2 (starts at 7) is at 7.
    // Joining via deleteRange(6, 8) removes the boundary tokens.
    const tr = s.tr.delete(6, 8);
    const d = inspectSteps(tr, s.doc, tr.doc);
    const removed = d.removedBlocks.map((b) => b.uuid).sort();
    expect(removed).toContain("p2");
    expect(removed).not.toContain("p1");
  });
});

describe("inspectSteps — heading delete", () => {
  it("removing a heading emits removedHeadings + removedBlocks", () => {
    const s = stateOf(
      doc(
        heading("h1", 1, "Intro"),
        paragraph("p1", "body"),
      ),
    );
    // Heading "Intro" sits at pos 0..7 (opening token + 5 chars + close).
    const tr = s.tr.delete(0, s.doc.firstChild!.nodeSize);
    const d = inspectSteps(tr, s.doc, tr.doc);
    expect(d.removedHeadings.map((h) => h.uuid)).toEqual(["h1"]);
    expect(d.removedBlocks.map((b) => b.uuid)).toEqual(["h1"]);
  });

  it("changing a heading's level emits changedHeadings, not added/removed", () => {
    const s = stateOf(doc(heading("h1", 1, "Title")));
    const tr = s.tr.setNodeMarkup(0, undefined, {
      ...s.doc.firstChild!.attrs,
      level: 2,
    });
    const d = inspectSteps(tr, s.doc, tr.doc);
    // setNodeMarkup is a ReplaceStep that swaps the node out — so it
    // shows up as both "added" and "removed" with the same UUID. Our
    // diff reconciler must collapse that into changedHeadings.
    expect(d.addedHeadings.filter((h) => h.uuid === "h1")).toHaveLength(0);
    expect(d.removedHeadings.filter((h) => h.uuid === "h1")).toHaveLength(0);
    expect(d.changedHeadings.find((h) => h.uuid === "h1")?.level).toBe(2);
  });

  it("changing only the sectionNumber attr (text-only delta) does NOT emit changedHeadings", () => {
    // This is the section-numberer's own renumber tx — it must not
    // wake the numberer back up, or we have an infinite loop.
    const s = stateOf(doc(heading("h1", 1, "Title")));
    const tr = s.tr.setNodeMarkup(0, undefined, {
      ...s.doc.firstChild!.attrs,
      sectionNumber: "1",
    });
    const d = inspectSteps(tr, s.doc, tr.doc);
    expect(d.changedHeadings).toHaveLength(0);
  });
});

describe("inspectSteps — pasting a multi-block slice", () => {
  it("pasting two paragraphs with UUIDs emits two addedBlocks", () => {
    const s = stateOf(doc(paragraph("p1", "host")));
    // Build a slice with two paragraphs that already have UUIDs (a
    // multi-block clipboard fragment from internal copy).
    const slice = new Slice(
      Fragment.from([
        paragraph("p2", "first"),
        paragraph("p3", "second"),
      ]),
      0,
      0,
    );
    const tr = s.tr.replace(s.doc.content.size, s.doc.content.size, slice);
    const d = inspectSteps(tr, s.doc, tr.doc);
    const added = d.addedBlocks.map((b) => b.uuid).sort();
    expect(added).toEqual(["p2", "p3"]);
    expect(d.removedBlocks).toHaveLength(0);
  });
});

describe("inspectSteps — footnotes", () => {
  it("inserting a footnote node emits addedFootnotes + footnoteOrderChanged", () => {
    const s = stateOf(doc(paragraph("p1", "before after")));
    const fn = footnoteNode("fn1");
    const tr = s.tr.insert(7, fn);
    const d = inspectSteps(tr, s.doc, tr.doc);
    expect(d.addedFootnotes.map((f) => f.id)).toEqual(["fn1"]);
    expect(d.footnoteOrderChanged).toBe(true);
  });

  it("deleting a footnote node emits removedFootnotes", () => {
    const fn = footnoteNode("fn1");
    const para = testSchema.nodes.paragraph.create(
      { uuid: "p1" },
      [testSchema.text("before "), fn, testSchema.text(" after")],
    );
    const s = stateOf(doc(para));
    // Find the footnote's pos and delete it (atom takes 1 position).
    let fnPos = -1;
    s.doc.descendants((n, p) => {
      if (n.type.name === "footnote") fnPos = p;
    });
    const tr = s.tr.delete(fnPos, fnPos + 1);
    const d = inspectSteps(tr, s.doc, tr.doc);
    expect(d.removedFootnotes.map((f) => f.id)).toEqual(["fn1"]);
  });

  it("MOVING a footnote (delete+insert, one tx) emits changedFootnotes at the new pos, not added/removed", () => {
    // Mirrors the inline-atom move spec: delete the atom, re-insert the
    // SAME node later. The same-id cancels in added/removed (so no orphan),
    // but the new position must surface as changedFootnotes so the
    // structure index / renumber don't read a stale snapshot.
    const fn = footnoteNode("fn1");
    const para = testSchema.nodes.paragraph.create(
      { uuid: "p1" },
      [testSchema.text("alpha "), fn, testSchema.text(" beta gamma delta")],
    );
    const s = stateOf(doc(para));
    let fnPos = -1;
    s.doc.descendants((n, p) => {
      if (n.type.name === "footnote") fnPos = p;
    });
    const node = s.doc.nodeAt(fnPos)!;
    const insertPos = fnPos + 6; // later in the same paragraph
    const adjustedInsert = insertPos > fnPos + 1 ? insertPos - 1 : insertPos;
    const tr = s.tr.delete(fnPos, fnPos + 1);
    tr.insert(adjustedInsert, node);
    const d = inspectSteps(tr, s.doc, tr.doc);
    expect(d.addedFootnotes.filter((f) => f.id === "fn1")).toHaveLength(0);
    expect(d.removedFootnotes.filter((f) => f.id === "fn1")).toHaveLength(0);
    const changed = d.changedFootnotes.find((f) => f.id === "fn1");
    expect(changed).toBeDefined();
    expect(changed!.pos).toBe(adjustedInsert);
    expect(d.footnoteOrderChanged).toBe(true);
  });
});

describe("inspectSteps — citations", () => {
  it("inserting a citation node emits addedCitations + citationOrderChanged", () => {
    const s = stateOf(doc(paragraph("p1", "before after")));
    const cit = citationNode("c1", "\\cite{smith2020}", "Smith 2020");
    const tr = s.tr.insert(7, cit);
    const d = inspectSteps(tr, s.doc, tr.doc);
    expect(d.addedCitations.map((c) => c.id)).toEqual(["c1"]);
    expect(d.addedCitations[0]?.command).toBe("\\cite{smith2020}");
    expect(d.citationOrderChanged).toBe(true);
    expect(d.changedCitations).toHaveLength(0);
  });

  it("deleting a citation node emits removedCitations", () => {
    const cit = citationNode("c1", "\\cite{smith2020}", "Smith 2020");
    const para = testSchema.nodes.paragraph.create(
      { uuid: "p1" },
      [testSchema.text("before "), cit, testSchema.text(" after")],
    );
    const s = stateOf(doc(para));
    let citPos = -1;
    s.doc.descendants((n, p) => {
      if (n.type.name === "citation") citPos = p;
    });
    const tr = s.tr.delete(citPos, citPos + 1);
    const d = inspectSteps(tr, s.doc, tr.doc);
    expect(d.removedCitations.map((c) => c.id)).toEqual(["c1"]);
    expect(d.addedCitations).toHaveLength(0);
  });

  it("editing a citation's command in place emits changedCitations, not added/removed", () => {
    const cit = citationNode("c1", "\\cite{old}", "Old");
    const para = testSchema.nodes.paragraph.create(
      { uuid: "p1" },
      [testSchema.text("see "), cit],
    );
    const s = stateOf(doc(para));
    let citPos = -1;
    s.doc.descendants((n, p) => {
      if (n.type.name === "citation") citPos = p;
    });
    // Leaf atom → setNodeMarkup is a ReplaceStep that swaps the node;
    // the reconciler must collapse same-id add+remove into changedCitations.
    const tr = s.tr.setNodeMarkup(citPos, undefined, {
      ...s.doc.nodeAt(citPos)!.attrs,
      command: "\\cite{new}",
      displayText: "New",
    });
    const d = inspectSteps(tr, s.doc, tr.doc);
    expect(d.addedCitations.filter((c) => c.id === "c1")).toHaveLength(0);
    expect(d.removedCitations.filter((c) => c.id === "c1")).toHaveLength(0);
    expect(d.changedCitations.find((c) => c.id === "c1")?.command).toBe("\\cite{new}");
  });

  it("typing next to a citation (no attr change) does NOT emit changedCitations", () => {
    const cit = citationNode("c1", "\\cite{x}", "X");
    const para = testSchema.nodes.paragraph.create(
      { uuid: "p1" },
      [testSchema.text("see "), cit],
    );
    const s = stateOf(doc(para));
    // Insert text at the very start, well clear of the atom.
    const tr = s.tr.insertText("a", 1, 1);
    const d = inspectSteps(tr, s.doc, tr.doc);
    expect(d.changedCitations).toHaveLength(0);
    expect(d.addedCitations).toHaveLength(0);
    expect(d.removedCitations).toHaveLength(0);
    expect(d.contentChangedUuids.has("p1")).toBe(true);
  });
});

describe("inspectSteps — linkedAnchor marks", () => {
  it("adding a linkedAnchor mark emits addedAnchors", () => {
    const s = stateOf(doc(paragraph("p1", "hello world")));
    // Mark "hello" with anchor a1.
    const mark = testSchema.marks.linkedAnchor.create({ anchorId: "a1", kind: "note" });
    const tr = s.tr.addMark(1, 6, mark);
    const d = inspectSteps(tr, s.doc, tr.doc);
    expect(d.addedAnchors.map((a) => a.id)).toEqual(["a1"]);
    expect(d.addedAnchors[0]?.kind).toBe("note");
  });

  it("removing a linkedAnchor mark emits removedAnchors", () => {
    const para = testSchema.nodes.paragraph.create(
      { uuid: "p1" },
      [anchoredText("anchored", "a1"), testSchema.text(" rest")],
    );
    const s = stateOf(doc(para));
    const mark = testSchema.marks.linkedAnchor.create({ anchorId: "a1", kind: "note" });
    const tr = s.tr.removeMark(1, 1 + "anchored".length, mark);
    const d = inspectSteps(tr, s.doc, tr.doc);
    expect(d.removedAnchors.map((a) => a.id)).toEqual(["a1"]);
  });
});

describe("inspectSteps — figures and examples", () => {
  it("inserting an exampleBlock emits addedExamples + exampleStructureChanged", () => {
    const s = stateOf(doc(paragraph("p1", "body")));
    const ex = exampleBlock("e1", { tag: "myex" }, [exampleItem({ label: "ex:a" })]);
    const tr = s.tr.insert(s.doc.content.size, ex);
    const d = inspectSteps(tr, s.doc, tr.doc);
    expect(d.addedExamples.map((e) => e.id)).toEqual(["e1"]);
    expect(d.exampleStructureChanged).toBe(true);
    // exampleItem with a label registers a labels entry too.
    expect([...d.addedLabels.map((l) => l.id)]).toContain("ex:a");
  });

  it("changing a figure's label emits changedFigures", () => {
    const s = stateOf(doc(figureBlock("fig1", "fig:old", true)));
    const tr = s.tr.setNodeMarkup(0, undefined, {
      ...s.doc.firstChild!.attrs,
      label: "fig:new",
    });
    const d = inspectSteps(tr, s.doc, tr.doc);
    expect(d.changedFigures.find((f) => f.uuid === "fig1")?.label).toBe("fig:new");
  });
});

describe("inspectSteps — undo invariants", () => {
  it("undo of a delete restores the same block UUID (round-trip empty)", () => {
    // Two-state simulation: tr1 deletes a paragraph; tr2 re-inserts it.
    const s1 = stateOf(doc(paragraph("p1", "first"), paragraph("p2", "second")));
    const deleteRange = s1.doc.firstChild!.nodeSize;
    const tr1 = s1.tr.delete(0, deleteRange);
    const d1 = inspectSteps(tr1, s1.doc, tr1.doc);
    expect(d1.removedBlocks.map((b) => b.uuid)).toEqual(["p1"]);
    const s2 = s1.apply(tr1);
    // Re-insert p1 at the start.
    const tr2 = s2.tr.insert(0, paragraph("p1", "first"));
    const d2 = inspectSteps(tr2, s2.doc, tr2.doc);
    expect(d2.addedBlocks.map((b) => b.uuid)).toEqual(["p1"]);
  });
});

describe("inspectSteps — selection-only transactions", () => {
  it("setSelection returns EMPTY_DIFF without inspecting steps", () => {
    const s = stateOf(doc(paragraph("p1", "hello")));
    const tr = s.tr.setSelection(s.selection); // no-op selection set
    expectEmpty(inspectSteps(tr, s.doc, tr.doc));
  });
});
