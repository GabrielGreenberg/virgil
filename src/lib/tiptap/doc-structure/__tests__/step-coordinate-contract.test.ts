/**
 * Task 653 — the step inspector's COORDINATE CONTRACT.
 *
 * A step's positions live in the document BEFORE THAT STEP (`tr.docs[i]`), not
 * in the transaction's starting document. `inspectSteps` stated that rule in a
 * comment on its `Replace*` branch and enforced it only there; every other
 * branch read `oldDoc`/`newDoc` with step-local numbers, and an unrecognised
 * step kind contributed nothing at all.
 *
 * Every leg here drives a MULTI-STEP transaction, because that is the only
 * shape in which the two spaces come apart — every pre-existing `AttrStep` test
 * in `step-inspector.test.ts` is single-step, which is exactly why this was
 * invisible. The CONTROL legs at the bottom are single-step and must pass both
 * before and after the fix, so the suite pins the contract rather than merely
 * detecting that something changed.
 */

import { describe, expect, it } from "vitest";
import { EditorState } from "@tiptap/pm/state";
import { Slice, type Node as PMNode } from "@tiptap/pm/model";
import {
  AddNodeMarkStep,
  AttrStep,
  Step,
  StepMap,
  StepResult,
  type Mappable,
} from "@tiptap/pm/transform";
import { inspectSteps } from "../step-inspector";
import { applyDiff, buildInitial } from "../structure-index";
import { EMPTY_DIFF, diffHasStructuralEntries } from "../types";
import { doc, heading, paragraph, testSchema } from "./fixtures";

function stateOf(node: PMNode): EditorState {
  return EditorState.create({ schema: testSchema, doc: node });
}

/**
 * A step kind this module has never heard of. Deliberately NOT a subclass of
 * any handled type, so `instanceof` misses it exactly the way a future
 * prosemirror step (or `DocAttrStep`) would. It replaces a range with nothing —
 * a real, structural edit — so "the diff came back empty" can only mean the
 * inspector declined to look.
 */
class MysteryStep extends Step {
  constructor(
    readonly from: number,
    readonly to: number,
  ) {
    super();
  }
  apply(docNode: PMNode): StepResult {
    return StepResult.fromReplace(docNode, this.from, this.to, Slice.empty);
  }
  getMap(): StepMap {
    return new StepMap([this.from, this.to - this.from, 0]);
  }
  invert(): Step {
    return this;
  }
  map(mapping: Mappable): Step | null {
    return new MysteryStep(mapping.map(this.from), mapping.map(this.to));
  }
  toJSON(): { stepType: string; from: number; to: number } {
    return { stepType: "mystery", from: this.from, to: this.to };
  }
}

describe("task 653 — AttrStep resolves against the STEP'S document", () => {
  // doc: p1 = [0,7)  ("hello"), h1 = [7,14) ("Intro").
  const build = () =>
    stateOf(doc(paragraph("p1", "hello"), heading("h1", 1, "Intro")));

  it("a size-changing step BEFORE an AttrStep still reports the attr change", () => {
    const s = build();
    const prev = buildInitial(s.doc);
    const tr = s.tr.insertText("ABCDE", 1, 1); // +5 before the heading
    // In `tr.docs[1]` — the document this step addresses — the heading now
    // starts at 12. Reading `oldDoc.nodeAt(12)` (the pre-fix code) lands
    // INSIDE the heading's text in the old document and finds no heading at
    // all, so the level flip was dropped from the diff entirely.
    expect(tr.doc.nodeAt(12)?.type.name).toBe("heading");
    tr.step(new AttrStep(12, "level", 2));

    const d = inspectSteps(tr, s.doc, tr.doc, prev);
    const changed = d.changedHeadings.find((h) => h.uuid === "h1");
    expect(changed).toBeDefined();
    expect(changed!.level).toBe(2);
    // …and its position is a NEW-document coordinate, which is what
    // `applyDiff` folds into the index verbatim.
    expect(changed!.pos).toBe(12);
    expect(tr.doc.nodeAt(changed!.pos)?.type.name).toBe("heading");
  });

  it("a uuid re-mint after a size-changing step is not silently dropped", () => {
    const s = build();
    const prev = buildInitial(s.doc);
    const tr = s.tr.insertText("ABCDE", 1, 1);
    tr.step(new AttrStep(12, "uuid", "h1-fresh"));

    const d = inspectSteps(tr, s.doc, tr.doc, prev);
    expect(d.addedBlocks.map((b) => b.uuid)).toContain("h1-fresh");
    expect(d.removedBlocks.map((b) => b.uuid)).toContain("h1");
    // The re-minted identity must land in the index at its real position, or
    // the UuidAttrDecorator stamps `data-uuid` on the wrong block.
    const next = applyDiff(prev, d);
    expect(next.blocks.get("h1-fresh")?.pos).toBe(12);
    expect(next.blocks.has("h1")).toBe(false);
  });

  it("a `label` attr change updates structure.labels, not just the headings", () => {
    // The table `\ref` display resolves against is `structure.labels`. The
    // hand-rolled attr branch synthesised `headings`/`figures` for a label flip
    // and never touched `labels`, so the stale id survived until a reload.
    const s = stateOf(doc(heading("h1", 1, "Intro", { label: "sec:old" })));
    const prev = buildInitial(s.doc);
    expect(prev.labels.has("sec:old")).toBe(true);

    const tr = s.tr.step(new AttrStep(0, "label", "sec:new"));
    const d = inspectSteps(tr, s.doc, tr.doc, prev);
    expect(d.addedLabels.map((l) => l.id)).toEqual(["sec:new"]);
    expect(d.removedLabels.map((l) => l.id)).toEqual(["sec:old"]);

    const next = applyDiff(prev, d);
    expect(next.labels.has("sec:new")).toBe(true);
    expect(next.labels.has("sec:old")).toBe(false);
    expect(next.labels.get("sec:new")?.ownerUuid).toBe("h1");
  });
});

describe("task 653 — mark steps record their span in the right space", () => {
  it("an anchor added BEFORE a later edit lands on the text it marked", () => {
    // The `.chain().setMark().insertContent()` shape: the mark step runs first,
    // then the transaction edits earlier in the document. Stored raw, the span
    // is off by the later step's delta and the linked card highlights — and
    // scrolls to — the wrong text.
    const s = stateOf(doc(paragraph("p1", "hello world")));
    const mark = testSchema.marks.linkedAnchor.create({
      anchorId: "a1",
      kind: "note",
    });
    const tr = s.tr.addMark(7, 12, mark); // "world"
    expect(s.doc.textBetween(7, 12)).toBe("world");
    tr.insertText("ABC", 1, 1); // +3, entirely before the marked run

    const d = inspectSteps(tr, s.doc, tr.doc);
    const a = d.addedAnchors.find((x) => x.id === "a1");
    expect(a).toBeDefined();
    expect(tr.doc.textBetween(a!.from, a!.to)).toBe("world");
  });

  it("a node-mark step spans the NODE, not one token", () => {
    // `AddNodeMarkStep` names a node by position; its extent is that node's own
    // size. `pos + 1` assumed `nodeSize === 1` — true only of a leaf.
    const s = stateOf(doc(paragraph("p1", "hello")));
    const mark = testSchema.marks.linkedAnchor.create({
      anchorId: "a1",
      kind: "note",
    });
    const tr = s.tr.step(new AddNodeMarkStep(0, mark));

    const d = inspectSteps(tr, s.doc, tr.doc);
    const a = d.addedAnchors.find((x) => x.id === "a1");
    expect(a).toBeDefined();
    expect(a!.from).toBe(0);
    expect(a!.to).toBe(s.doc.child(0).nodeSize); // 7, not 1
  });
});

describe("task 653 — removed entries are recorded in oldDoc coordinates", () => {
  it("a removal in a LATER step still addresses the pre-transaction document", () => {
    // `footnote.ts` reads `oldState.doc.nodeAt(removed.pos)` and
    // `linked-anchor.ts`'s resurrection guard resolves `removedBlocks[].pos`
    // against the pre-batch document — both by documented contract. A step-local
    // position pointed those at the wrong node.
    const s = stateOf(
      doc(paragraph("p1", "hello"), paragraph("p2", "second"), paragraph("p3", "x")),
    );
    const prev = buildInitial(s.doc);
    const p2Start = 7;
    const p2End = p2Start + s.doc.child(1).nodeSize;
    expect(s.doc.nodeAt(p2Start)?.attrs.uuid).toBe("p2");

    const tr = s.tr.insertText("ABCDE", 1, 1); // +5 ahead of p2
    tr.delete(p2Start + 5, p2End + 5); // delete p2, in tr.docs[1] coordinates

    const d = inspectSteps(tr, s.doc, tr.doc, prev);
    const gone = d.removedBlocks.find((b) => b.uuid === "p2");
    expect(gone).toBeDefined();
    expect(s.doc.nodeAt(gone!.pos)?.attrs.uuid).toBe("p2");
  });

  it("an unmoved block is not reported as REORDERED by an unrelated earlier edit", () => {
    // The two sides used to be compared across coordinate spaces: `removed`
    // from `tr.docs[i]`, `added` from `newDoc`. A same-uuid pair then differed
    // by the other steps' delta and read as a MOVE — waking position-keyed
    // consumers and the O(doc) numberer walk on a non-event.
    const s = stateOf(doc(paragraph("p1", "hello"), paragraph("p2", "second")));
    const prev = buildInitial(s.doc);
    // Re-stamp p2's attrs (a ReplaceAroundStep that re-collects it on BOTH
    // sides), then edit earlier in the document.
    const tr = s.tr.setNodeMarkup(7, undefined, { uuid: "p2" });
    tr.insertText("ABCDE", 1, 1);

    const d = inspectSteps(tr, s.doc, tr.doc, prev);
    expect(d.changedBlocks.filter((b) => b.uuid === "p2")).toHaveLength(0);
    expect(d.blockOrderChanged).toBe(false);
  });
});

describe("task 653 — an unrecognised step FAILS SAFE", () => {
  it("reports the structural change instead of returning EMPTY_DIFF", () => {
    // `changed-ranges.ts` states the project's rule for a step type that did not
    // exist when the code was written: it "could have reached anywhere", and the
    // answer is "the whole document". The step inspector promised that in a
    // comment and implemented nothing, so a `docChanged` transaction came back
    // EMPTY and every diff-gated plugin treated it as a non-event.
    const s = stateOf(doc(paragraph("p1", "hello"), paragraph("p2", "second")));
    const prev = buildInitial(s.doc);
    const p2End = 7 + s.doc.child(1).nodeSize;
    const tr = s.tr.step(new MysteryStep(7, p2End));
    expect(tr.docChanged).toBe(true);
    expect(tr.doc.childCount).toBe(1);

    const d = inspectSteps(tr, s.doc, tr.doc, prev);
    expect(d).not.toBe(EMPTY_DIFF);
    expect(diffHasStructuralEntries(d)).toBe(true);
    expect(d.removedBlocks.map((b) => b.uuid)).toEqual(["p2"]);
    // …and the surviving block is marked content-changed, so the gates that key
    // off `contentChangedUuids` (title / label / latex-comment) wake too.
    expect(d.contentChangedUuids.has("p1")).toBe(true);

    const next = applyDiff(prev, d);
    expect(next.blocks.has("p2")).toBe(false);
    expect(next.blocks.has("p1")).toBe(true);
  });

  it("a headings/labels change carried by an unrecognised step still reaches the index", () => {
    const s = stateOf(
      doc(paragraph("p1", "hello"), heading("h1", 1, "Intro", { label: "sec:a" })),
    );
    const prev = buildInitial(s.doc);
    const hStart = 7;
    const tr = s.tr.step(new MysteryStep(hStart, hStart + s.doc.child(1).nodeSize));

    const d = inspectSteps(tr, s.doc, tr.doc, prev);
    expect(d.removedHeadings.map((h) => h.uuid)).toEqual(["h1"]);
    expect(d.removedLabels.map((l) => l.id)).toEqual(["sec:a"]);
  });
});

describe("task 653 — CONTROLS (single-step; green before and after)", () => {
  it("a single-step heading level AttrStep still reports changedHeadings", () => {
    const s = stateOf(doc(heading("h1", 1, "Intro")));
    const prev = buildInitial(s.doc);
    const tr = s.tr.step(new AttrStep(0, "level", 3));
    const d = inspectSteps(tr, s.doc, tr.doc, prev);
    expect(d.changedHeadings.map((h) => h.level)).toEqual([3]);
  });

  it("a single-step addMark still reports the anchor over its own range", () => {
    const s = stateOf(doc(paragraph("p1", "hello world")));
    const mark = testSchema.marks.linkedAnchor.create({
      anchorId: "a1",
      kind: "note",
    });
    const tr = s.tr.addMark(7, 12, mark);
    const d = inspectSteps(tr, s.doc, tr.doc);
    const a = d.addedAnchors.find((x) => x.id === "a1");
    expect(tr.doc.textBetween(a!.from, a!.to)).toBe("world");
  });

  it("typing stays structurally null (keystroke sanctity)", () => {
    const s = stateOf(doc(paragraph("p1", "hello"), paragraph("p2", "second")));
    const tr = s.tr.insertText("!", 6, 6);
    const d = inspectSteps(tr, s.doc, tr.doc);
    expect(diffHasStructuralEntries(d)).toBe(false);
    expect(d.blockOrderChanged).toBe(false);
    expect(d.contentChangedUuids.has("p1")).toBe(true);
  });

  it("an attr that changes nothing the diff reports stays silent", () => {
    // The attr branch no longer carries a hand-written list of "which attrs
    // matter": it collects both sides and the reconcilers cancel. An untracked
    // attr must therefore derive EQUAL entries and produce nothing.
    const s = stateOf(doc(heading("h1", 1, "Intro")));
    const prev = buildInitial(s.doc);
    const tr = s.tr.step(new AttrStep(0, "sectionNumber", "1"));
    const d = inspectSteps(tr, s.doc, tr.doc, prev);
    expect(diffHasStructuralEntries(d)).toBe(false);
  });
});
