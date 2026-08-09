/**
 * `BlockEntry.parTitled` — the section-path vocabulary flag (perf Wave 2).
 *
 * The breadcrumb derives the active section path from headings ∪ parTitled
 * blocks. Pre-wave-2 it re-walked the doc per RAF to find titled blocks; the
 * geometry service instead reads this flag off the structure snapshot, which
 * makes its correctness contract worth pinning:
 *
 *  - the tracked datum is the BOOLEAN "renders a par-title" (`deriveParTitled`),
 *    NOT the title text — so a FLIP (null/"" ↔ non-empty) is structural and
 *    wakes `blockParTitleChanged` + `onBlockParTitlesChanged`, while typing
 *    inside an existing title is structurally NULL (keystroke sanctity for
 *    title editing);
 *  - both write shapes answer identically: `setNodeAttribute` (AttrStep — the
 *    empty-StepMap trap: its transaction is docChanged but moves nothing) and
 *    `setNodeMarkup` (ReplaceAroundStep — the range-walk path);
 *  - a flip rides `changedBlocks` WITHOUT `blockOrderChanged`, so
 *    position-keyed consumers (focus band, fold filter) stay asleep;
 *  - a same-uuid MOVE carries the flag through `changedBlocks` with
 *    `blockOrderChanged` and WITHOUT `blockParTitleChanged`.
 */

import { describe, expect, it } from "vitest";
import { EditorState } from "@tiptap/pm/state";
import { inspectSteps } from "../step-inspector";
import { applyDiff, buildInitial } from "../structure-index";
import { asMutable, createDocStructureBus, diffWakesStructuralWatchers } from "../bus";
import { EMPTY_DIFF, deriveParTitled, type StructureDiff } from "../types";
import { doc, paragraph, testSchema } from "./fixtures";

function stateOf(node: ReturnType<typeof doc>): EditorState {
  return EditorState.create({ schema: testSchema, doc: node });
}

function titledParagraph(uuid: string, title: string, text: string) {
  return testSchema.nodes.paragraph.create(
    { uuid, parTitle: title },
    text ? testSchema.text(text) : null,
  );
}

describe("deriveParTitled — the shared boolean", () => {
  it("non-empty string is titled; null / empty / non-string are not", () => {
    expect(deriveParTitled({ parTitle: "Intro" })).toBe(true);
    expect(deriveParTitled({ parTitle: null })).toBe(false);
    expect(deriveParTitled({ parTitle: "" })).toBe(false);
    expect(deriveParTitled({})).toBe(false);
    expect(deriveParTitled({ parTitle: 3 })).toBe(false);
  });
});

describe("buildInitial — parTitled on the snapshot", () => {
  it("flags titled blocks true and untitled blocks false", () => {
    const s = stateOf(doc(titledParagraph("p1", "Intro", "hello"), paragraph("p2", "world")));
    const structure = buildInitial(s.doc);
    expect(structure.blocks.get("p1")?.parTitled).toBe(true);
    expect(structure.blocks.get("p2")?.parTitled).toBe(false);
  });
});

describe("inspectSteps — parTitle transitions via setNodeAttribute (AttrStep)", () => {
  it("a null → non-empty FLIP is structural: changedBlocks + blockParTitleChanged, no order change", () => {
    const s = stateOf(doc(paragraph("p1", "hello")));
    const tr = s.tr.setNodeAttribute(0, "parTitle", "Intro");
    const d = inspectSteps(tr, s.doc, tr.doc);
    expect(d.changedBlocks.map((b) => b.uuid)).toEqual(["p1"]);
    expect(d.changedBlocks[0].parTitled).toBe(true);
    expect(d.blockParTitleChanged).toBe(true);
    expect(d.blockOrderChanged).toBe(false);
    expect(d.addedBlocks).toHaveLength(0);
    expect(d.removedBlocks).toHaveLength(0);
    expect(diffWakesStructuralWatchers(d)).toBe(true);
  });

  it("a non-empty → null FLIP (title removed) is structural too", () => {
    const s = stateOf(doc(titledParagraph("p1", "Intro", "hello")));
    const tr = s.tr.setNodeAttribute(0, "parTitle", null);
    const d = inspectSteps(tr, s.doc, tr.doc);
    expect(d.changedBlocks.map((b) => b.uuid)).toEqual(["p1"]);
    expect(d.changedBlocks[0].parTitled).toBe(false);
    expect(d.blockParTitleChanged).toBe(true);
    expect(d.blockOrderChanged).toBe(false);
  });

  it("editing INSIDE an existing title is structurally NULL (the keystroke path)", () => {
    const s = stateOf(doc(titledParagraph("p1", "Intro", "hello")));
    const tr = s.tr.setNodeAttribute(0, "parTitle", "Introd");
    const d = inspectSteps(tr, s.doc, tr.doc);
    expect(d).toBe(EMPTY_DIFF);
    expect(diffWakesStructuralWatchers(d)).toBe(false);
  });
});

describe("inspectSteps — parTitle transitions via setNodeMarkup (ReplaceAroundStep)", () => {
  it("a FLIP through the range-walk path answers identically to the AttrStep path", () => {
    const s = stateOf(doc(paragraph("p1", "hello")));
    const node = s.doc.nodeAt(0)!;
    const tr = s.tr.setNodeMarkup(0, undefined, { ...node.attrs, parTitle: "Intro" });
    const d = inspectSteps(tr, s.doc, tr.doc);
    expect(d.changedBlocks.map((b) => b.uuid)).toEqual(["p1"]);
    expect(d.changedBlocks[0].parTitled).toBe(true);
    expect(d.blockParTitleChanged).toBe(true);
    expect(d.blockOrderChanged).toBe(false);
    expect(d.addedBlocks).toHaveLength(0);
    expect(d.removedBlocks).toHaveLength(0);
  });

  it("an in-place title edit through setNodeMarkup stays a content-only diff", () => {
    const s = stateOf(doc(titledParagraph("p1", "Intro", "hello")));
    const node = s.doc.nodeAt(0)!;
    const tr = s.tr.setNodeMarkup(0, undefined, { ...node.attrs, parTitle: "Introduction" });
    const d = inspectSteps(tr, s.doc, tr.doc);
    expect(d.changedBlocks).toHaveLength(0);
    expect(d.blockParTitleChanged).toBe(false);
    expect(diffWakesStructuralWatchers(d)).toBe(false);
  });
});

describe("inspectSteps — a MOVE carries the flag without waking parTitle consumers", () => {
  it("delete+insert of a titled block: changedBlocks keeps parTitled, blockOrderChanged only", () => {
    const s = stateOf(doc(titledParagraph("p1", "Intro", "hello"), paragraph("p2", "world")));
    // Move p1 below p2: delete p1 (0..7), re-insert it after p2.
    const p1 = s.doc.nodeAt(0)!;
    const tr = s.tr.delete(0, p1.nodeSize);
    tr.insert(tr.doc.content.size, p1.type.create(p1.attrs, p1.content));
    const d = inspectSteps(tr, s.doc, tr.doc);
    const moved = d.changedBlocks.find((b) => b.uuid === "p1");
    expect(moved?.parTitled).toBe(true);
    expect(d.blockOrderChanged).toBe(true);
    expect(d.blockParTitleChanged).toBe(false);
  });
});

describe("applyDiff — the flip folds into the snapshot", () => {
  it("structure.blocks reflects the new parTitled after a flip diff", () => {
    const s = stateOf(doc(paragraph("p1", "hello")));
    const prev = buildInitial(s.doc);
    expect(prev.blocks.get("p1")?.parTitled).toBe(false);
    const tr = s.tr.setNodeAttribute(0, "parTitle", "Intro");
    const d = inspectSteps(tr, s.doc, tr.doc, prev);
    const next = applyDiff(prev, d);
    expect(next.blocks.get("p1")?.parTitled).toBe(true);
    // Identity untouched — no add/remove churn.
    expect([...next.blocks.keys()]).toEqual([...prev.blocks.keys()]);
  });
});

describe("bus — onBlockParTitlesChanged", () => {
  it("fires on a flip diff and bumps emitCount; a content-only diff fires nothing", () => {
    const bus = createDocStructureBus();
    const seen: StructureDiff[] = [];
    bus.onBlockParTitlesChanged((d) => seen.push(d));

    const flip: StructureDiff = {
      ...EMPTY_DIFF,
      changedBlocks: [{ uuid: "p1", pos: 0, typeName: "paragraph", parTitled: true }],
      blockParTitleChanged: true,
    };
    const before = bus.emitCount;
    asMutable(bus)._emit(flip, bus.structure);
    expect(seen).toHaveLength(1);
    expect(bus.emitCount).toBe(before + 1);

    const contentOnly: StructureDiff = {
      ...EMPTY_DIFF,
      contentChangedUuids: new Set(["p1"]),
    };
    asMutable(bus)._emit(contentOnly, bus.structure);
    expect(seen).toHaveLength(1);
    expect(bus.emitCount).toBe(before + 1);
  });
});
