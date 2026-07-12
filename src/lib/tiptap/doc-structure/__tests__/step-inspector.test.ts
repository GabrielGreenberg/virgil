import { describe, expect, it } from "vitest";
import { EditorState } from "@tiptap/pm/state";
import { Slice, Fragment } from "@tiptap/pm/model";
import { AttrStep } from "@tiptap/pm/transform";
import { inspectSteps } from "../step-inspector";
import { buildInitial } from "../structure-index";
import { EMPTY_DIFF, type StructureDiff } from "../types";
import {
  anchoredText,
  citationLiteral,
  citationNode,
  doc,
  exampleBlock,
  exampleItem,
  figureBlock,
  footnoteNode,
  footnoteWithBody,
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

  it("post-split re-mint (uuid AttrStep on the CLONE) does NOT report the surviving original as removed", () => {
    // Reproduce the duplicate-uuid transient that a split leaves before
    // BlockUuidBackfill re-mints: TWO paragraphs both carry "p1". oldDoc is that
    // state; the backfill then issues a uuid AttrStep on the SECOND (clone) half,
    // changing its uuid "p1" → "fresh". The ORIGINAL first half keeps "p1".
    const oldDoc = doc(paragraph("p1", "hello"), paragraph("p1", "world"));
    const s = stateOf(oldDoc);
    const prev = buildInitial(oldDoc); // prev.blocks has "p1"
    // Second paragraph starts at pos 7 (para1 = open+5+close = 7 tokens).
    const tr = s.tr.step(new AttrStep(7, "uuid", "fresh"));
    const d = inspectSteps(tr, s.doc, tr.doc, prev);

    const removed = d.removedBlocks.map((b) => b.uuid);
    const added = d.addedBlocks.map((b) => b.uuid);
    // The original p1 SURVIVES (it's still on the first paragraph), so the
    // inspector must NOT claim it removed — doing so would desync structure.blocks
    // and strip the original's data-uuid decoration (the margin/omni-flash class).
    expect(removed).not.toContain("p1");
    // The freshly-minted clone identity is a real new block.
    expect(added).toContain("fresh");
  });

  it("a genuine uuid death (clone uuid not present elsewhere) STILL reports removal", () => {
    // Control: the same AttrStep shape, but the old uuid genuinely vanishes (no
    // surviving sibling carries it) → removal must still fire, so a real
    // identity change isn't masked by the survival guard.
    const oldDoc = doc(paragraph("only", "hello"));
    const s = stateOf(oldDoc);
    const prev = buildInitial(oldDoc);
    const tr = s.tr.step(new AttrStep(0, "uuid", "renamed"));
    const d = inspectSteps(tr, s.doc, tr.doc, prev);
    expect(d.removedBlocks.map((b) => b.uuid)).toContain("only");
    expect(d.addedBlocks.map((b) => b.uuid)).toContain("renamed");
  });
});

describe("inspectSteps — top-level block reorder", () => {
  it("MOVING a top-level paragraph (delete+insert, one tx) emits changedBlocks at the new pos + blockOrderChanged, not added/removed", () => {
    // Mirrors the footnote/citation move spec, one level up: a reorder is a
    // delete+insert of the SAME block (uuid preserved). The same-uuid cancels
    // in added/removed (no phantom add/remove), but the new position must
    // surface as changedBlocks (so the structure index doesn't keep the stale
    // mapped pos) and blockOrderChanged must fire (so position-keyed consumers
    // re-resolve).
    const s = stateOf(doc(paragraph("p1", "first"), paragraph("p2", "second")));
    const prev = buildInitial(s.doc);
    // p1 = [0,7); p2 = [7,15). Move p2 before p1: delete p2, re-insert at 0.
    const p2 = s.doc.child(1);
    const tr = s.tr.delete(7, 15);
    tr.insert(0, p2);
    const d = inspectSteps(tr, s.doc, tr.doc, prev);
    expect(d.addedBlocks.filter((b) => b.uuid === "p2")).toHaveLength(0);
    expect(d.removedBlocks.filter((b) => b.uuid === "p2")).toHaveLength(0);
    const moved = d.changedBlocks.find((b) => b.uuid === "p2");
    expect(moved).toBeDefined();
    expect(moved!.pos).toBe(0);
    expect(d.blockOrderChanged).toBe(true);
    // The unmoved block p1 just shifts via mapping — not part of the diff.
    expect(d.changedBlocks.filter((b) => b.uuid === "p1")).toHaveLength(0);
  });

  it("typing inside a paragraph does NOT set blockOrderChanged or changedBlocks (keystroke sanctity)", () => {
    const s = stateOf(doc(paragraph("p1", "hello"), paragraph("p2", "world")));
    const tr = s.tr.insertText("!", 6, 6); // end of "hello"
    const d = inspectSteps(tr, s.doc, tr.doc);
    expect(d.blockOrderChanged).toBe(false);
    expect(d.changedBlocks).toHaveLength(0);
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

describe("inspectSteps — footnote-nested citation (T3 / C10): per-tx path stays O(edit)", () => {
  // The load-only `buildInitial` descend surfaces a footnote-nested `\cite` in
  // structure.citations. Keystroke sanctity demands the PER-TRANSACTION step
  // path NEVER re-walk a footnote body: typing must not emit a citation
  // add/change for the cite hiding in `attrs.content`. These pins guard against
  // a future regression that wires the descent into the per-keystroke path.
  function paraWithNestedCiteFootnote() {
    const body = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [citationLiteral("nested-c", "\\cite{nested}", "Nested")],
        },
      ],
    };
    return testSchema.nodes.paragraph.create({ uuid: "p1" }, [
      testSchema.text("body "),
      footnoteWithBody("fn1", body, { linkId: "fn1" }),
    ]);
  }

  it("typing in a paragraph that holds a footnote-nested cite emits NO citation diff", () => {
    const s = stateOf(doc(paraWithNestedCiteFootnote()));
    // Insert a plain char at the very start, clear of the atom.
    const tr = s.tr.insertText("x", 1, 1);
    const d = inspectSteps(tr, s.doc, tr.doc);
    // The nested cite must NOT surface in the per-tx diff (it's inside the
    // footnote's opaque `attrs.content` — the step path doesn't walk it).
    expect(d.addedCitations).toHaveLength(0);
    expect(d.removedCitations).toHaveLength(0);
    expect(d.changedCitations).toHaveLength(0);
    expect(d.citationOrderChanged).toBe(false);
    // It's just a content edit to p1.
    expect(d.contentChangedUuids.has("p1")).toBe(true);
  });

  it("rewriting the footnote body (setNodeMarkup) does NOT surface the nested cite as a citation add/change", () => {
    const s = stateOf(doc(paraWithNestedCiteFootnote()));
    let fnPos = -1;
    s.doc.descendants((n, p) => {
      if (n.type.name === "footnote") fnPos = p;
    });
    // Swap the footnote's body literal (as the footnote editor / cite-strip
    // does). The cite lives in `attrs.content`, opaque to step inspection — so
    // even this real attr edit must not produce a citation diff entry.
    const newBody = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [citationLiteral("nested-c", "\\cite{nested}", "Nested 2")],
        },
      ],
    };
    const tr = s.tr.setNodeMarkup(fnPos, undefined, {
      ...s.doc.nodeAt(fnPos)!.attrs,
      content: newBody,
    });
    const d = inspectSteps(tr, s.doc, tr.doc);
    expect(d.addedCitations.filter((c) => c.id === "nested-c")).toHaveLength(0);
    expect(d.changedCitations.filter((c) => c.id === "nested-c")).toHaveLength(0);
    expect(d.removedCitations.filter((c) => c.id === "nested-c")).toHaveLength(0);
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

describe("inspectSteps — example reorder / renumber (changedExamples)", () => {
  // The stale-`(N)`-after-reorder class (task 2026-07-12-101). An example
  // drag-reorder is a same-uuid delete+insert MOVE and the ExpexNumbering
  // renumber is an in-place setNodeMarkup — before the `changedExamples`
  // bucket, BOTH reconciled to neither added nor removed, so
  // `exampleStructureChanged` stayed flat and docked/Omni ExampleCards never
  // re-seeded. These pin that a move AND a renumber now both surface as
  // `changedExamples` + `exampleStructureChanged` (which drives
  // `onExamplesRecomputable` → `rev.examples` → the card re-seed), while a
  // plain keystroke inside an example fires neither (keystroke sanctity).

  it("MOVING a top-level exampleBlock (delete+insert, one tx) emits changedExamples at the new pos, not added/removed", () => {
    // Mirrors the top-level-paragraph-reorder + footnote/citation-move specs:
    // the same-uuid cancels in added/removed (no phantom orphan), but the new
    // position must surface as changedExamples so the structure index drops the
    // stale mapped pos and the card re-derives.
    const s = stateOf(
      doc(exampleBlock("e1", { number: 1 }), exampleBlock("e2", { number: 2 })),
    );
    const prev = buildInitial(s.doc);
    const e1Size = s.doc.child(0).nodeSize;
    const e2 = s.doc.child(1);
    // Move e2 before e1: delete e2, re-insert at 0 (uuid preserved).
    const tr = s.tr.delete(e1Size, e1Size + e2.nodeSize);
    tr.insert(0, e2);
    const d = inspectSteps(tr, s.doc, tr.doc, prev);
    expect(d.addedExamples.filter((e) => e.id === "e2")).toHaveLength(0);
    expect(d.removedExamples.filter((e) => e.id === "e2")).toHaveLength(0);
    const moved = d.changedExamples.find((e) => e.id === "e2");
    expect(moved).toBeDefined();
    expect(moved!.pos).toBe(0);
    expect(d.exampleStructureChanged).toBe(true);
  });

  it("renumbering an exampleBlock in place (setNodeMarkup number 9→10) emits changedExamples, not added/removed", () => {
    // The ExpexNumbering appendTransaction path: a leapfrogged block's `number`
    // attr flips via setNodeMarkup. The card renders the seeded number, so this
    // must count as changed even though pos is unchanged.
    const s = stateOf(doc(exampleBlock("e1", { number: 9 })));
    const tr = s.tr.setNodeMarkup(0, undefined, {
      ...s.doc.firstChild!.attrs,
      number: 10,
    });
    const d = inspectSteps(tr, s.doc, tr.doc);
    expect(d.addedExamples.filter((e) => e.id === "e1")).toHaveLength(0);
    expect(d.removedExamples.filter((e) => e.id === "e1")).toHaveLength(0);
    expect(d.changedExamples.find((e) => e.id === "e1")?.number).toBe(10);
    expect(d.exampleStructureChanged).toBe(true);
  });

  it("keystroke sanctity: typing inside an example fires NO changedExamples / exampleStructureChanged", () => {
    const s = stateOf(
      doc(exampleBlock("exA", { tag: "a" }, [exampleItem({}, "alpha")])),
    );
    // "alpha" starts at pos 2 (block open 0, item open 1) → ends at 7.
    const tr = s.tr.insertText("!", 7, 7);
    const d = inspectSteps(tr, s.doc, tr.doc);
    expect(d.changedExamples).toHaveLength(0);
    expect(d.exampleStructureChanged).toBe(false);
    // The content-only signal still fires so the card re-seeds text (the #39
    // path) — this fix doesn't disturb it.
    expect(d.exampleContentChangedUuids.has("exA")).toBe(true);
  });
});

describe("inspectSteps — example content-change signal (#39 nit 1)", () => {
  // Two example blocks; the exampleItem (test schema) carries `inline*`,
  // so an edit inside one item is a pure-text content edit.
  function twoExamples() {
    const a = exampleBlock("exA", { tag: "a" }, [exampleItem({}, "alpha")]);
    const b = exampleBlock("exB", { tag: "b" }, [exampleItem({}, "beta")]);
    return doc(a, b);
  }

  it("typing inside example A attributes ONLY exA to exampleContentChangedUuids", () => {
    const s = stateOf(twoExamples());
    // exampleBlock A opens at 0, its exampleItem at 1, text "alpha" starts at
    // 2 → end of "alpha" is pos 7. Insert a char inside A's text.
    const tr = s.tr.insertText("!", 7, 7);
    const d = inspectSteps(tr, s.doc, tr.doc);
    expect(d.exampleContentChangedUuids.has("exA")).toBe(true);
    // The sibling example B is untouched — its card must NOT re-seed.
    expect(d.exampleContentChangedUuids.has("exB")).toBe(false);
    // It is NOT a structural example change (no add/remove/nesting change),
    // so the structural counter stays flat — proving the new signal is the
    // ONLY thing that fires for a content-only edit.
    expect(d.exampleStructureChanged).toBe(false);
    expect(d.addedExamples).toHaveLength(0);
    expect(d.removedExamples).toHaveLength(0);
  });

  it("a plain edit in a NON-example paragraph fires NO example-content signal", () => {
    const s = stateOf(doc(paragraph("p1", "hello"), exampleBlock("exA", { tag: "a" }, [exampleItem({}, "alpha")])));
    // Type inside the plain paragraph p1 (text "hello" ends at pos 6).
    const tr = s.tr.insertText("x", 6, 6);
    const d = inspectSteps(tr, s.doc, tr.doc);
    // Attributed to p1 (a normal block) only — no exampleBlock ancestor.
    expect(d.contentChangedUuids.has("p1")).toBe(true);
    expect(d.exampleContentChangedUuids.size).toBe(0);
  });

  it("keystroke sanctity: a non-example structural-null edit yields EMPTY_DIFF when nothing else changed", () => {
    // A doc with only a paragraph — typing in it produces contentChangedUuids
    // but NEVER an exampleContentChangedUuids entry.
    const s = stateOf(doc(paragraph("p1", "hi")));
    const tr = s.tr.insertText("!", 3, 3);
    const d = inspectSteps(tr, s.doc, tr.doc);
    expect(d.exampleContentChangedUuids.size).toBe(0);
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
